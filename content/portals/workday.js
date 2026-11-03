/**
 * OriginFill — Workday Adapter
 * Finds the fields of a Workday application step and fills Workday's custom widgets:
 * button dropdowns, searchable "prompt" lists, segmented month/year dates, repeating
 * Work Experience / Education / Website sections and the résumé drop zone.
 *
 * Workday markup (2024–2026). Every question sits in a formField wrapper, e.g. the live
 * sign-in step:
 *   <div data-automation-id="formField-email">
 *     <label for="input-6"><span>Email Address<abbr aria-hidden="true">*</abbr></span></label>
 *     <input type="text" data-automation-id="email" id="input-6">
 * Older tenants also put semantic automation ids on the controls themselves
 * (legalNameSection_firstName, addressSection_city, phone-device-type, …).
 *
 * @license AGPL-3.0
 * @author CharyWorld
 */

var OriginFillWorkday = (() => {
  'use strict';

  // ─── Selectors ─────────────────────────────────────────────────

  const SEL = Object.freeze({
    FORM_FIELD: '[data-automation-id^="formField-"]',
    DROPDOWN_BUTTON: 'button[aria-haspopup="listbox"]',
    PROMPT: '[data-automation-id="multiSelectContainer"], [data-automation-id="multiselectInputContainer"], input[data-automation-id="searchBox"], input[data-uxi-widget-type="selectinput"]',
    PROMPT_INPUT: 'input[data-automation-id="searchBox"], input[data-uxi-widget-type="selectinput"]',
    PROMPT_OPTION: '[data-automation-id="promptOption"], [data-automation-id="promptLeafNode"], [role="option"]',
    SELECTED_ITEM: '[data-automation-id="selectedItem"], [data-automation-id="selectedItemList"] > li, [data-automation-id="selectedItemList"] [role="option"]',
    POPUP: '[data-automation-widget="wd-popup"], [data-automation-id="wd-popup-content"], [data-automation-id="activeListContainer"], [role="listbox"]',
    LISTBOX: '[role="listbox"], [data-automation-id="activeListContainer"], [data-automation-widget="wd-popup"] ul',
    DATE_MONTH: 'input[aria-label="Month" i], input[data-automation-id*="dateSectionMonth"], input[id*="dateSectionMonth"]',
    DATE_DAY: 'input[aria-label="Day" i], input[data-automation-id*="dateSectionDay"], input[id*="dateSectionDay"]',
    DATE_YEAR: 'input[aria-label="Year" i], input[data-automation-id*="dateSectionYear"], input[id*="dateSectionYear"]',
    FILE_INPUT: 'input[type="file"]',
    DROP_ZONE: '[data-automation-id="file-upload-drop-zone"], [data-automation-id="attachments-FileUpload"]',
    UPLOADED_FILE: '[data-automation-id="file-upload-item"], [data-automation-id="file-upload-successful"], [data-automation-id="file-upload-item-name"]',
    TEXT_INPUT: 'input:not([type]), input[type="text"], input[type="email"], input[type="tel"], input[type="url"], input[type="number"], input[type="search"]',
    NEXT_BUTTON: '[data-automation-id="bottom-navigation-next-button"], [data-automation-id="pageFooterNextButton"]'
  });

  // ─── Workday Field Map ─────────────────────────────────────────

  /**
   * Normalized Workday keys → field types. Keys come from wrapper automation ids
   * ("formField-legalName--firstName"), control automation ids ("phone-device-type"),
   * ids ("workExperience-1--jobTitle") and names. Lower-cased, punctuation removed.
   */
  const FIELD_MAP = Object.freeze({
    // Personal
    legalnamesectionfirstname: 'firstName', firstname: 'firstName', givenname: 'firstName',
    legalnamesectionmiddlename: 'middleName', middlename: 'middleName',
    legalnamesectionlastname: 'lastName', lastname: 'lastName', familyname: 'lastName',
    legalnamesectiontitle: 'prefix', prefix: 'prefix', salutation: 'prefix',
    legalnamesectionsocial: 'suffix', suffix: 'suffix',
    email: 'email', emailaddress: 'email',
    phonenumber: 'phone',
    phonedevicetype: 'phoneType', phonetype: 'phoneType', devicetype: 'phoneType',
    countryphonecode: 'phoneCountryCode', phonecode: 'phoneCountryCode',
    phoneextension: 'phoneExtension', extension: 'phoneExtension',
    addresssectionaddressline1: 'address', addressline1: 'address',
    addresssectionaddressline2: 'address2', addressline2: 'address2',
    addresssectioncity: 'city', city: 'city',
    addresssectioncountryregion: 'state', countryregion: 'state',
    addresssectionpostalcode: 'zipCode', postalcode: 'zipCode',
    countrydropdown: 'country', country: 'country',
    source: 'referralSource', sourceprompt: 'referralSource', sourcedropdown: 'referralSource',
    previousworker: 'previouslyEmployed', candidateispreviousworker: 'previouslyEmployed',

    // Work Experience
    jobtitle: 'jobTitle', company: 'company', companyname: 'company',
    currentlyworkhere: 'isCurrent', roledescription: 'workBullets',

    // Education
    school: 'institution', schoolname: 'institution', schoolitem: 'institution',
    degree: 'degree', fieldofstudy: 'fieldOfStudy', gpa: 'gpa', gradeaverage: 'gpa',
    firstyearattended: 'eduStartYear', lastyearattended: 'eduEndYear',

    // Links & skills
    linkedinquestion: 'linkedIn', linkedinaccount: 'linkedIn', linkedin: 'linkedIn',
    skills: 'skills', skillsprompt: 'skills',

    // Résumé
    fileuploadinputref: 'resume', resume: 'resume', resumesection: 'resume'
  });

  /** Keys whose meaning depends on the section they sit in. */
  const CONTEXT_KEYS = Object.freeze({
    location: { work: 'workLocation', education: 'eduLocation' },
    startdate: { work: 'workStartDate', education: 'eduStartYear' },
    enddate: { work: 'workEndDate', education: 'eduEndYear' },
    description: { work: 'workBullets' },
    title: { work: 'jobTitle' },
    url: { website: 'website' },
    website: { website: 'website', default: 'website' }
  });

  /** Field types we recognise but never fill (no profile data, or not ours to answer). */
  const NEVER_FILL = new Set(['phoneExtension', 'suffix']);

  const MAX_SECTION_ENTRIES = 10;

  // ─── Field Discovery ───────────────────────────────────────────

  /**
   * Find all fillable fields on the current Workday page.
   *
   * @param {{ root?: ParentNode }} [options]
   * @returns {Array<Object>} Field descriptors (element, wrapper, control, label, fieldType,
   *   section, index, profilePath, inputType, confidence, source, …)
   */
  function getFields({ root = document } = {}) {
    const fields = [];
    const claimed = new Set();

    // ─── Layer 1: formField wrappers (current Workday UI) ───
    root.querySelectorAll(SEL.FORM_FIELD).forEach(wrapper => {
      if (wrapper.querySelector(SEL.FORM_FIELD)) return; // Only innermost wrappers
      const field = describeField(wrapper);
      if (!field) return;
      claimed.add(wrapper);
      field.controls.forEach(el => claimed.add(el));
      fields.push(field);
    });

    // ─── Layer 2: controls outside wrappers (older tenants, custom questions) ───
    root.querySelectorAll(
      `${SEL.TEXT_INPUT}, textarea, select, ${SEL.DROPDOWN_BUTTON}, input[type="checkbox"], input[type="radio"]`
    ).forEach(el => {
      if (claimed.has(el) || el.closest(SEL.FORM_FIELD)) return;
      if (el.type === 'radio' && fields.some(f => f.controls.includes(el))) return;
      const wrapper = el.type === 'radio'
        ? (el.closest('fieldset, [role="radiogroup"]') || el.parentElement)
        : (el.closest('[data-automation-id]:not(input):not(button):not(textarea)') || el.parentElement);
      const field = describeField(wrapper, el);
      if (!field) return;
      field.controls.forEach(c => claimed.add(c));
      fields.push(field);
    });

    // ─── Layer 3: résumé upload ───
    const resume = findResumeField(root, claimed);
    if (resume && !fields.some(f => f.fieldType === 'resume')) fields.push(resume);

    assignEntryIndexes(fields);

    // Unrecognised questions stay in the list (saved answers may cover them) when they have a label
    const usable = fields.filter(f => f.fieldType || (f.label && !f.ignore));
    const known = usable.filter(f => f.fieldType);
    OriginFillLogger.debug(`Workday: Found ${known.length} known fields (${known.filter(f => f.source === 'workday-exact').length} exact), ${usable.length - known.length} other questions`);
    return usable;
  }

  /**
   * Build a field descriptor for one wrapper (or a single control inside it).
   * @param {HTMLElement} wrapper
   * @param {HTMLElement} [onlyControl]
   * @returns {Object|null}
   */
  function describeField(wrapper, onlyControl) {
    if (!wrapper) return null;
    const control = detectControl(wrapper, onlyControl);
    if (!control) return null;

    const { element } = control;
    const visibleTarget = control.kind === 'file' ? (control.dropZone || wrapper) : element;
    if (!OriginFillDom.isVisible(visibleTarget)) return null;
    if (control.kind !== 'file' && (element.disabled || element.readOnly || element.getAttribute('aria-disabled') === 'true')) return null;

    // Controls found outside a formField wrapper describe themselves; their container may be a
    // whole page section whose first label belongs to some other field.
    const isGroup = control.kind === 'radio' || control.kind === 'checkboxGroup';
    const keySource = onlyControl && !isGroup ? element : wrapper;
    const label = onlyControl && !isGroup
      ? OriginFillDetector.getInputLabel(element)
      : getFieldLabel(wrapper, control);
    const automationId = keySource.getAttribute('data-automation-id') || element.getAttribute('data-automation-id') || '';
    const context = OriginFillFieldMapper.detectSectionContext(element);
    const { fieldType, confidence, source } = classify(keySource, control, label, context.section);

    return {
      element,
      wrapper,
      control: control.kind,
      controls: control.all,
      parts: control.parts || null,
      dropZone: control.dropZone || null,
      label: label || (fieldType === 'resume' ? 'Résumé' : OriginFillFieldMapper.hintToWords(automationId.replace(/^formField-/, ''))),
      contextText: isGroup ? `${label} ${control.all.map(optionLabel).join(' ')} ${pageHeading()}` : '',
      automationId,
      fieldType: NEVER_FILL.has(fieldType) ? null : fieldType,
      ignore: NEVER_FILL.has(fieldType),
      required: isRequired(wrapper, element, onlyControl),
      section: context.section || OriginFillFieldMapper.SECTION_OF_FIELD[fieldType] || null,
      index: context.index,
      entry: context.entry,
      inputType: legacyInputType(control.kind),
      confidence,
      source
    };
  }

  /**
   * Workday marks required questions with aria-required and an <abbr>*</abbr> in the label.
   */
  function isRequired(wrapper, element, onlyControl) {
    if (element.getAttribute('aria-required') === 'true' || element.required) return true;
    if (onlyControl) return false;
    const labelEl = wrapper.querySelector('label, legend');
    return !!(labelEl && (labelEl.querySelector('abbr') || labelEl.textContent.includes('*')));
  }

  /**
   * Work out which Workday widget a wrapper holds.
   * @returns {{ kind: string, element: HTMLElement, all: HTMLElement[], parts?: Object, dropZone?: HTMLElement }|null}
   */
  function detectControl(wrapper, onlyControl) {
    const within = (sel) => onlyControl ? (onlyControl.matches(sel) ? onlyControl : null) : wrapper.querySelector(sel);

    if (!onlyControl) {
      const fileInput = wrapper.querySelector(SEL.FILE_INPUT);
      const dropZone = wrapper.querySelector(SEL.DROP_ZONE);
      if (fileInput || dropZone) {
        return { kind: 'file', element: fileInput || dropZone, all: [fileInput, dropZone].filter(Boolean), dropZone };
      }

      const month = wrapper.querySelector(SEL.DATE_MONTH);
      const day = wrapper.querySelector(SEL.DATE_DAY);
      const year = wrapper.querySelector(SEL.DATE_YEAR);
      if (month || day || year) {
        const all = [month, day, year].filter(Boolean);
        return { kind: 'date', element: all[0], all, parts: { month, day, year } };
      }

      const prompt = wrapper.querySelector(SEL.PROMPT);
      if (prompt) {
        const input = prompt.matches('input') ? prompt
          : (wrapper.querySelector(SEL.PROMPT_INPUT) || prompt.querySelector('input:not([type="hidden"])') || wrapper.querySelector('input:not([type="hidden"])'));
        if (input) return { kind: 'prompt', element: input, all: [input] };
      }
    }

    const button = within(SEL.DROPDOWN_BUTTON);
    if (button) return { kind: 'dropdown', element: button, all: [button] };

    const select = within('select');
    if (select) return { kind: 'select', element: select, all: [select] };

    const radios = onlyControl
      ? (onlyControl.type === 'radio' ? Array.from(wrapper.querySelectorAll(`input[type="radio"][name="${CSS.escape(onlyControl.name || '')}"]`)) : [])
      : Array.from(wrapper.querySelectorAll('input[type="radio"], [role="radio"]'));
    if (radios.length > 0) {
      return { kind: 'radio', element: radios[0], all: radios.length ? radios : [onlyControl], parts: { radios: radios.length ? radios : [onlyControl] } };
    }

    const checkboxes = onlyControl
      ? (onlyControl.type === 'checkbox' ? [onlyControl] : [])
      : Array.from(wrapper.querySelectorAll('input[type="checkbox"], [role="checkbox"]'));
    if (checkboxes.length === 1) return { kind: 'checkbox', element: checkboxes[0], all: checkboxes };
    if (checkboxes.length > 1) {
      // A question answered by ticking one (or more) boxes, e.g. the disability self-identification form
      return { kind: 'checkboxGroup', element: checkboxes[0], all: checkboxes, parts: { checkboxes } };
    }

    const textarea = within('textarea');
    if (textarea) return { kind: 'textarea', element: textarea, all: [textarea] };

    const input = within(SEL.TEXT_INPUT);
    if (input) return { kind: 'text', element: input, all: [input] };

    const editable = within('[contenteditable="true"]');
    if (editable) return { kind: 'richtext', element: editable, all: [editable] };

    return null;
  }

  /**
   * The question a wrapper asks. For radio/checkbox groups that's the legend, not the option
   * labels. Workday often renders questions as rich text instead of a <label>, so this falls back
   * to aria-labelledby, the wrapper's own text and the text just before the wrapper.
   */
  function getFieldLabel(wrapper, control) {
    const clean = (t) => OriginFillDom.cleanLabel(t);
    const el = control.element;

    if (control.kind === 'radio' || control.kind === 'checkboxGroup') {
      const legend = wrapper.querySelector('legend') || wrapper.closest('fieldset')?.querySelector('legend');
      if (legend && clean(legend.textContent)) return clean(legend.textContent);
      const group = wrapper.querySelector('[role="radiogroup"][aria-labelledby], [role="group"][aria-labelledby], fieldset[aria-labelledby]') || wrapper;
      const fromAria = textOfIds(group.getAttribute('aria-labelledby'));
      if (fromAria) return fromAria;
      const optionIds = new Set(control.all.map(r => r.id).filter(Boolean));
      const label = Array.from(wrapper.querySelectorAll('label')).find(l => !optionIds.has(l.htmlFor) && !l.querySelector('input'));
      if (label && clean(label.textContent)) return clean(label.textContent);
      return questionText(wrapper);
    }

    if (control.kind === 'file') {
      const label = wrapper.querySelector('label, h3, h4, legend');
      return label ? clean(label.textContent) : '';
    }

    if (el.id) {
      const forLabel = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (forLabel && clean(forLabel.textContent)) return clean(forLabel.textContent);
    }

    const wrapperLabel = wrapper.querySelector('label, legend');
    if (wrapperLabel && clean(wrapperLabel.textContent)) return clean(wrapperLabel.textContent);

    return textOfIds(el.getAttribute('aria-labelledby'), el) ||
      questionText(wrapper) ||
      clean((el.getAttribute('aria-label') || '').replace(/\bselect one\b/gi, '')) ||
      OriginFillDetector.getInputLabel(el);
  }

  /** Text of the elements an aria-labelledby attribute points to. */
  function textOfIds(ids, except) {
    if (!ids) return '';
    const text = ids.split(/\s+/)
      .map(id => document.getElementById(id))
      .filter(node => node && node !== except && !node.contains(except || null))
      .map(node => node.textContent)
      .join(' ');
    return OriginFillDom.cleanLabel(text);
  }

  /**
   * Question text rendered as plain/rich text: the wrapper's text without its controls, options,
   * selections and messages — or, when the wrapper has none, the text right before it.
   */
  function questionText(wrapper) {
    const clone = wrapper.cloneNode(true);
    clone.querySelectorAll(
      'input, select, textarea, button, [role="listbox"], [role="option"], [role="radio"], [role="checkbox"], ' +
      '[data-automation-id="selectedItemList"], [data-automation-id="errorMessage"], [role="alert"], ' +
      '[aria-live], abbr, svg, label[for], [data-automation-id="file-upload-drop-zone"]'
    ).forEach(node => node.remove());
    const own = OriginFillDom.cleanLabel(clone.textContent);
    if (own) return own.slice(0, 300);

    // Text in the element just before the wrapper (or before its only-child parent)
    let anchor = wrapper;
    for (let depth = 0; anchor && depth < 3; depth++) {
      const previous = anchor.previousElementSibling;
      if (previous && !previous.matches(SEL.FORM_FIELD) && !previous.querySelector('input, select, textarea, button')) {
        const text = OriginFillDom.cleanLabel(previous.textContent);
        if (text && text.length <= 400) return text;
      }
      if (previous) break;
      anchor = anchor.parentElement;
    }
    return '';
  }

  /** The label of one radio/checkbox option. */
  function optionLabel(option) {
    return radioLabel(option);
  }

  /** The current page's heading (gives checkbox groups like the disability form their context). */
  function pageHeading() {
    const heading = document.querySelector('[data-automation-id="applyFlowPage"] h2:not([data-automation-id="jobTitleHeading"]), main h1, main h2');
    return heading ? OriginFillDom.cleanLabel(heading.textContent) : '';
  }

  /**
   * Normalized keys for a wrapper/control, most specific first.
   * "formField-legalName--firstName" → ["firstname", "legalnamefirstname"]
   */
  function collectKeys(wrapper, element) {
    const sources = [
      (wrapper.getAttribute('data-automation-id') || '').replace(/^formField-/, ''),
      element.getAttribute('data-automation-id'),
      element.id,
      element.getAttribute('name')
    ];

    const keys = [];
    for (const raw of sources) {
      if (!raw) continue;
      const segments = raw.split('--').filter(Boolean);
      const last = segments[segments.length - 1] || raw;
      keys.push(normalizeKey(last.replace(/^(workExperience|education|webAddress|website|language|certification)-\d+$/i, '')));
      keys.push(normalizeKey(raw));
    }
    return keys.filter(Boolean);
  }

  function normalizeKey(raw) {
    return String(raw || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  /**
   * Decide the field type: exact Workday keys first, then the label, then attribute hints.
   */
  function classify(wrapper, control, label, section) {
    // Self-identification forms are signed with today's date
    if (control.kind === 'date' && /^(today'?s\s+)?date$|\bdate\s+signed\b|\bsignature\s+date\b/i.test(label.trim())) {
      return { fieldType: 'todayDate', confidence: 'high', source: 'workday-label' };
    }

    if (control.kind === 'file') {
      const text = `${label} ${wrapper.getAttribute('data-automation-id') || ''}`.toLowerCase();
      const isOther = /\b(cover\s*letter|transcript|portfolio|photo|certificate)\b/.test(text);
      return { fieldType: isOther ? null : 'resume', confidence: 'high', source: 'workday-exact' };
    }

    for (const key of collectKeys(wrapper, control.element)) {
      if (FIELD_MAP[key]) return { fieldType: FIELD_MAP[key], confidence: 'high', source: 'workday-exact' };
      const byContext = CONTEXT_KEYS[key];
      if (byContext && (byContext[section] || byContext.default)) {
        return { fieldType: byContext[section] || byContext.default, confidence: 'high', source: 'workday-exact' };
      }
    }

    const classifyControl = control.kind === 'checkbox' ? 'checkbox' : 'text';
    const hints = [
      (wrapper.getAttribute('data-automation-id') || '').replace(/^formField-/, ''),
      control.element.getAttribute('aria-label'),
      control.element.getAttribute('placeholder')
    ].filter(Boolean);
    const result = OriginFillFieldMapper.classifyText({ label, hints, control: classifyControl, section });
    return { ...result, source: 'workday-label' };
  }

  /**
   * Repeating-section fields without an explicit entry number get one by position:
   * the 2nd "Job Title" on the page belongs to work entry 2.
   */
  function assignEntryIndexes(fields) {
    OriginFillFieldMapper.assignEntryIndexes(fields);
  }

  /**
   * Résumé upload controls are usually hidden inputs behind a drop zone, sometimes outside
   * any formField wrapper.
   */
  function findResumeField(root, claimed) {
    const inputs = Array.from(root.querySelectorAll(SEL.FILE_INPUT)).filter(i => !claimed.has(i));
    const zones = Array.from(root.querySelectorAll(SEL.DROP_ZONE)).filter(z => !claimed.has(z));
    const element = inputs.find(i => i.getAttribute('data-automation-id') === 'file-upload-input-ref') || inputs[0] || zones[0];
    if (!element) return null;

    // The section around the upload control (it also lists already-uploaded files)
    const zoneOfInput = zones.find(z => z.contains(element)) || null;
    const anchor = zoneOfInput || element;
    const container = anchor.parentElement?.closest('[role="group"], section, fieldset, [data-automation-id$="Section"], [data-automation-id^="formField-"]') ||
      anchor.parentElement || anchor;
    const dropZone = zoneOfInput || zones.find(z => container.contains(z)) || zones[0] || null;
    const visibleTarget = dropZone || container;
    if (!OriginFillDom.isVisible(visibleTarget)) return null;

    const heading = container.querySelector('h2, h3, h4, label') || null;
    const label = OriginFillDom.cleanLabel(heading ? heading.textContent : '') || 'Resume/CV';
    if (/\b(cover\s*letter|transcript|photo)\b/i.test(label)) return null;

    return {
      element,
      wrapper: container,
      control: 'file',
      controls: [element],
      parts: null,
      dropZone,
      label,
      automationId: element.getAttribute('data-automation-id') || '',
      fieldType: 'resume',
      section: 'resume',
      index: 0,
      profilePath: 'resume',
      inputType: OriginFillFieldTypes.FILE,
      confidence: 'high',
      source: 'workday-exact'
    };
  }

  function legacyInputType(kind) {
    switch (kind) {
      case 'dropdown': return 'WORKDAY_SINGLE_SELECT';
      case 'prompt': return 'WORKDAY_PROMPT';
      case 'date': return OriginFillFieldTypes.DATE;
      case 'checkbox':
      case 'checkboxGroup': return OriginFillFieldTypes.CHECKBOX;
      case 'radio': return OriginFillFieldTypes.RADIO;
      case 'select': return OriginFillFieldTypes.SELECT;
      case 'textarea': return OriginFillFieldTypes.TEXTAREA;
      case 'file': return OriginFillFieldTypes.FILE;
      case 'richtext': return OriginFillFieldTypes.RICHTEXT;
      default: return OriginFillFieldTypes.TEXT;
    }
  }

  // ─── Repeating Sections ("Add" buttons) ────────────────────────

  const SECTION_HEADINGS = Object.freeze({
    work: /^work\s+experience$/i,
    education: /^education$/i,
    website: /^(websites?|web\s*sites?|web\s*address(es)?)$/i
  });

  const LEGACY_SECTION_IDS = Object.freeze({
    work: 'workExperienceSection',
    education: 'educationSection',
    website: 'websiteSection'
  });

  const ENTRY_ID = Object.freeze({
    work: /^workExperience-\d+$/,
    education: /^education-\d+$/,
    website: /^(webAddress|websitePanelSet)-\d+$/
  });

  const ENTRY_HEADING = Object.freeze({
    work: /^work\s+experience\s+\d+$/i,
    education: /^education\s+\d+$/i,
    website: /^(websites?|web\s*address(es)?)\s+\d+$/i
  });

  const PRIMARY_FIELDS = Object.freeze({
    work: ['jobTitle', 'company'],
    education: ['institution', 'degree'],
    website: ['website']
  });

  /**
   * On "My Experience", Workday shows no Work Experience / Education / Website entries until you
   * click "Add". Click it until the page has one entry per profile entry.
   *
   * @param {Object} profile
   * @param {{ sections?: string[] }} [options]
   * @returns {Promise<Array<{ section: string, added: number }>>}
   */
  async function prepareSections(profile, { sections = ['work', 'education', 'website'] } = {}) {
    const wanted = {
      work: OriginFillFieldMapper.getWorkEntries(profile).length,
      education: OriginFillFieldMapper.getEducationEntries(profile).length,
      website: OriginFillFieldMapper.getWebsites(profile).length
    };

    const summary = [];
    for (const section of sections) {
      const target = Math.min(wanted[section] || 0, MAX_SECTION_ENTRIES);
      if (!target) continue;

      const container = findSectionContainer(section);
      if (!container) continue;

      let count = countEntries(container, section);
      let added = 0;

      while (count < target && added < MAX_SECTION_ENTRIES) {
        const addButton = findAddButton(container);
        if (!addButton) break;

        OriginFillDom.scrollIntoView(addButton);
        OriginFillDom.click(addButton);
        const grew = await OriginFillDom.waitFor(
          () => countEntries(container, section) > count,
          { timeout: OriginFillTiming.SECTION_ADD_TIMEOUT }
        );
        if (!grew) break;

        count = countEntries(container, section);
        added++;
        await OriginFillDom.delay(150);
      }

      if (added > 0) {
        OriginFillLogger.info(`Workday: added ${added} ${section} entr${added === 1 ? 'y' : 'ies'}`);
        summary.push({ section, added });
      }
    }

    return summary;
  }

  /**
   * Find the container of a repeating section (Work Experience, Education, Websites).
   * @param {'work'|'education'|'website'} section
   * @returns {HTMLElement|null}
   */
  function findSectionContainer(section) {
    const legacy = document.querySelector(`[data-automation-id="${LEGACY_SECTION_IDS[section]}"]`);
    if (legacy) return legacy;

    const heading = SECTION_HEADINGS[section];
    const clean = (t) => OriginFillDom.cleanLabel(t);

    // Labelled groups: <div role="group" aria-labelledby="Work-Experience-section">
    for (const group of document.querySelectorAll('[role="group"][aria-labelledby], section[aria-labelledby], fieldset[aria-labelledby]')) {
      const text = group.getAttribute('aria-labelledby').split(/\s+/)
        .map(id => document.getElementById(id)?.textContent || '').join(' ');
      if (heading.test(clean(text))) return group;
    }

    // A heading followed by its entries and an Add button
    for (const h of document.querySelectorAll('h2, h3, h4')) {
      if (!heading.test(clean(OriginFillDom.getText(h)))) continue;
      let container = h.parentElement;
      for (let depth = 0; container && depth < 5; depth++) {
        if (containsOtherSection(container, section)) break;
        if (findAddButton(container)) return container;
        container = container.parentElement;
      }
    }

    return null;
  }

  function containsOtherSection(container, section) {
    return Array.from(container.querySelectorAll('h2, h3, h4')).some(h => {
      const text = OriginFillDom.cleanLabel(OriginFillDom.getText(h));
      return Object.entries(SECTION_HEADINGS).some(([name, re]) => name !== section && re.test(text));
    });
  }

  /**
   * The section's "Add" / "Add Another" button.
   * @param {HTMLElement} container
   * @returns {HTMLElement|null}
   */
  function findAddButton(container) {
    const buttons = Array.from(container.querySelectorAll('button, [role="button"]'))
      .filter(b => !b.disabled && OriginFillDom.isVisible(b));

    const adds = buttons.filter(b => {
      const aid = (b.getAttribute('data-automation-id') || '').toLowerCase();
      const text = OriginFillDom.getText(b).toLowerCase();
      const aria = (b.getAttribute('aria-label') || '').toLowerCase();
      if (/\b(delete|remove)\b/.test(`${aid} ${text} ${aria}`)) return false;
      return aid === 'add' || aid === 'add-button' || aid === 'add another' ||
        /^add( another)?$/.test(text) || /^add\b/.test(aria);
    });

    return adds[adds.length - 1] || null;
  }

  /**
   * How many entries a section currently shows.
   */
  function countEntries(container, section) {
    const byId = Array.from(container.querySelectorAll('[data-automation-id]'))
      .filter(el => ENTRY_ID[section].test(el.getAttribute('data-automation-id'))).length;

    const byHeading = Array.from(container.querySelectorAll('h3, h4, h5, [role="heading"]'))
      .filter(h => ENTRY_HEADING[section].test(OriginFillDom.cleanLabel(OriginFillDom.getText(h)))).length;

    const fields = getFieldsQuiet(container);
    const byField = Math.max(0, ...PRIMARY_FIELDS[section].map(type => fields.filter(f => f.fieldType === type).length));

    return Math.max(byId, byHeading, byField);
  }

  function getFieldsQuiet(root) {
    try {
      return getFields({ root });
    } catch (e) {
      return [];
    }
  }

  // ─── Fill Dispatch ─────────────────────────────────────────────

  /**
   * Fill a Workday field.
   *
   * @param {Object} field - Descriptor from getFields()
   * @param {any} value - Resolved profile value
   * @param {{ profile?: Object }} [context]
   * @returns {Promise<{ success: boolean, note: string }>}
   */
  async function fillField(field, value, context = {}) {
    if (value === undefined || value === null || value === '') {
      return { success: false, note: 'Empty value' };
    }

    // Wordings of the answer, best first (saved/common answers bring their own)
    const candidates = context.candidates && context.candidates.length
      ? context.candidates
      : OriginFillFieldMapper.getValueAliases(field.fieldType, value);

    // A college or course the list doesn't have gets "Other" / "Not listed"
    const allowOther = OriginFillFieldMapper.allowsOtherOption(field.fieldType);

    try {
      switch (field.control) {
        case 'dropdown':
          return await fillDropdown(field.element, candidates, { allowOther, fieldType: field.fieldType });
        case 'prompt':
          return await fillPrompt(field, value, context.profile, context.candidates);
        case 'date':
          return await fillDate(field, value);
        case 'checkbox':
          return await OriginFillDom.setCheckbox(field.element, toBoolean(value));
        case 'radio':
          return await OriginFillDom.chooseRadio(field.parts.radios, candidates.map(toChoice), radioLabel);
        case 'checkboxGroup':
          return await OriginFillDom.chooseCheckboxes(field.parts.checkboxes, candidates.map(toChoice), radioLabel);
        case 'select':
          return await OriginFillDom.selectNativeOption(field.element, candidates, { allowOther, fieldType: field.fieldType });
        case 'richtext':
          return await OriginFillDom.fillRichText(field.element, formatText(field, value, context.profile));
        case 'file':
          return { success: false, note: 'File uploads are handled by the filler' };
        default:
          return await OriginFillDom.fillText(field.element, formatText(field, value, context.profile));
      }
    } catch (err) {
      OriginFillLogger.error('Workday fillField error:', err);
      return { success: false, note: err.message };
    }
  }

  /**
   * Text value for a field — arrays become lines, phone numbers lose a duplicated country code.
   */
  function formatText(field, value, profile) {
    if (Array.isArray(value)) {
      return field.fieldType === 'skills' ? value.join(', ') : value.filter(Boolean).join('\n');
    }
    if (typeof value === 'boolean') return toChoice(value);
    if (field.fieldType === 'phone') return nationalPhone(String(value), profile);
    if (field.fieldType === 'eduStartYear' || field.fieldType === 'eduEndYear') {
      const date = OriginFillFieldMapper.parseDate(value);
      return date && date.year ? String(date.year) : String(value);
    }
    if (field.fieldType === 'workStartDate' || field.fieldType === 'workEndDate') {
      return normalizeDate(String(value), field.element) || String(value);
    }
    return String(value);
  }

  /**
   * Workday has a separate "Country Phone Code" field, so "+1 (555) 123-4567" goes in as
   * "(555) 123-4567".
   */
  function nationalPhone(phone, profile) {
    const trimmed = phone.trim();
    if (!trimmed.startsWith('+')) return trimmed;

    const configured = String(profile?.personal?.phoneCountryCode || '').match(/\+?\s*(\d{1,4})/);
    if (configured && trimmed.replace(/[^\d+]/g, '').startsWith(`+${configured[1]}`)) {
      return trimmed.replace(new RegExp(`^\\+\\s*${configured[1]}[\\s.-]*`), '').trim() || trimmed;
    }
    const generic = trimmed.match(/^\+\d{1,3}[\s.-]+(.+)$/);
    return generic ? generic[1].trim() : trimmed;
  }

  function toBoolean(value) {
    if (typeof value === 'boolean') return value;
    return /^(true|yes|y|1|checked)$/i.test(String(value).trim());
  }

  function toChoice(value) {
    if (value === true) return 'Yes';
    if (value === false) return 'No';
    return String(value);
  }

  function radioLabel(radio) {
    if (radio.id) {
      const label = document.querySelector(`label[for="${CSS.escape(radio.id)}"]`);
      if (label) return OriginFillDom.cleanLabel(label.textContent);
    }
    const parentLabel = radio.closest('label');
    if (parentLabel) return OriginFillDom.cleanLabel(parentLabel.textContent);
    return OriginFillDom.cleanLabel(radio.getAttribute('aria-label') || radio.textContent || radio.value);
  }

  /**
   * The value a field currently holds, for "already filled" checks.
   * @param {Object} field
   * @returns {string|string[]|boolean|null}
   */
  function readValue(field) {
    const el = field.element;
    if (!el || !el.isConnected) return null;

    switch (field.control) {
      case 'dropdown':
        return getButtonValue(el) || null;
      case 'prompt': {
        const selected = selectedTexts(field);
        return selected.length ? selected : null;
      }
      case 'date': {
        const { month, day, year } = field.parts;
        const y = year ? readSegment(year) : null;
        if (!y) return null;
        const m = month ? readSegment(month) : null;
        const d = day ? readSegment(day) : null;
        if (m && d) return `${m}/${d}/${y}`;
        return m ? `${m}/${y}` : String(y);
      }
      case 'checkbox':
        return ('checked' in el) ? el.checked : el.getAttribute('aria-checked') === 'true';
      case 'radio': {
        const checked = field.parts.radios.find(r => ('checked' in r) ? r.checked : r.getAttribute('aria-checked') === 'true');
        return checked ? radioLabel(checked) : null;
      }
      case 'checkboxGroup': {
        const checked = field.parts.checkboxes.filter(c => ('checked' in c) ? c.checked : c.getAttribute('aria-checked') === 'true');
        return checked.length ? checked.map(radioLabel) : null;
      }
      case 'select':
        return el.value ? (el.options[el.selectedIndex]?.textContent.trim() || el.value) : null;
      case 'richtext':
        return OriginFillDom.getText(el) || null;
      case 'file':
        return null;
      default:
        return el.value || null;
    }
  }

  // ─── Button Dropdowns ──────────────────────────────────────────

  /**
   * The value a dropdown button currently shows ("" while it says "Select One").
   */
  function getButtonValue(button) {
    const text = OriginFillDom.cleanLabel(OriginFillDom.getText(button) || button.getAttribute('value') || '');
    return /^(select( one)?|choose( one)?|none selected)$/i.test(text) ? '' : text;
  }

  /**
   * Choose an option in a Workday button dropdown (Country, State, Phone Device Type, Degree…).
   * Workday renders the list in a popup at the end of <body>; the button's aria-controls points to it.
   *
   * @param {HTMLElement} button
   * @param {string[]} candidates - Profile value followed by aliases
   * @returns {Promise<{ success: boolean, note: string }>}
   */
  async function fillDropdown(button, candidates, { allowOther = false, fieldType } = {}) {
    const current = getButtonValue(button);
    if (current && candidates.some(c => OriginFillFuzzyMatch.isSameText(current, c))) {
      return { success: true, note: '' };
    }

    const listbox = await openListbox(button);
    if (!listbox) return { success: false, note: 'Dropdown did not open' };

    const match = await findOptionInList(listbox, candidates, { allowOther, fieldType });
    if (!match) {
      const sample = listOptions(listbox).slice(0, 4).map(o => o.text).join(', ');
      await closeListbox(button, listbox);
      return { success: false, note: `No option matches "${candidates[0]}"${sample ? ` (e.g. ${sample})` : ''}` };
    }

    OriginFillDom.scrollIntoView(match.el);
    OriginFillDom.click(match.el);

    let committed = await OriginFillDom.waitFor(
      () => OriginFillFuzzyMatch.isSameText(getButtonValue(button), match.text),
      { timeout: 1500 }
    );

    if (!committed) {
      // Keyboard fallback: focus the option and press Enter
      try { match.el.focus(); } catch (e) { /* not focusable */ }
      OriginFillDom.pressKey(match.el, 'Enter');
      committed = await OriginFillDom.waitFor(
        () => OriginFillFuzzyMatch.isSameText(getButtonValue(button), match.text),
        { timeout: 1000 }
      );
    }

    if (isListOpen(listbox)) await closeListbox(button, listbox);

    if (!committed) return { success: false, note: `Could not select "${match.text}"` };
    if (match.confidence === 'other') {
      return { success: true, usedOther: true, note: `"${candidates[0]}" isn't in the list — chose "${match.text}"` };
    }
    // Known equivalents ("CA" → "California") are exact alias matches; only fuzzy picks need a look
    return { success: true, note: match.confidence === 'exact' ? '' : `Selected "${match.text}"` };
  }

  async function openListbox(button) {
    const existing = findOpenListbox(button);
    if (existing) return existing;

    OriginFillDom.scrollIntoView(button);
    OriginFillDom.focus(button);
    OriginFillDom.click(button);

    let listbox = await OriginFillDom.waitFor(() => findOpenListbox(button), { timeout: OriginFillTiming.DROPDOWN_TIMEOUT });
    if (!listbox) {
      // Some lists open from the keyboard only
      OriginFillDom.pressKey(button, 'ArrowDown');
      listbox = await OriginFillDom.waitFor(() => findOpenListbox(button), { timeout: 1000 });
    }
    return listbox;
  }

  function findOpenListbox(button) {
    const ids = `${button.getAttribute('aria-controls') || ''} ${button.getAttribute('aria-owns') || ''}`
      .split(/\s+/).filter(Boolean);
    for (const id of ids) {
      const el = document.getElementById(id);
      if (el && OriginFillDom.isVisible(el) && listOptions(el).length > 0) return el;
    }

    const ownWrapper = button.closest(SEL.FORM_FIELD);
    const lists = Array.from(document.querySelectorAll(SEL.LISTBOX)).filter(el => {
      if (button.contains(el) || el.matches('[data-automation-id="selectedItemList"]')) return false;
      const wrapper = el.closest(SEL.FORM_FIELD);
      if (wrapper && wrapper !== ownWrapper) return false;
      return OriginFillDom.isVisible(el) && listOptions(el).length > 0;
    });
    return lists[lists.length - 1] || null;
  }

  function isListOpen(listbox) {
    return listbox.isConnected && OriginFillDom.isVisible(listbox);
  }

  /**
   * Options in a list as { el, text }.
   */
  function listOptions(listbox) {
    let els = listbox.querySelectorAll('[role="option"]');
    if (els.length === 0) els = listbox.querySelectorAll('li');
    return Array.from(els)
      .map(el => ({ el, text: optionText(el) }))
      .filter(o => o.text && !/^(select( one)?|none)$/i.test(o.text));
  }

  function optionText(el) {
    // Workday keeps the canonical label in data-automation-label, on the option or a child of it
    const labelled = el.hasAttribute('data-automation-label') ? el : el.querySelector('[data-automation-label]');
    return OriginFillDom.cleanLabel(
      (labelled && labelled.getAttribute('data-automation-label')) || OriginFillDom.getText(el) || el.getAttribute('aria-label') || ''
    );
  }

  /**
   * Find the best option, scrolling long virtualised lists (countries, states) as needed.
   * An exact match wins immediately; otherwise the whole list is scanned so a weak early match
   * ("United Arab Emirates") can't beat a better one further down ("United States of America").
   */
  async function findOptionInList(listbox, candidates, { allowOther = false, fieldType } = {}) {
    const rank = { exact: 3, high: 2, medium: 1 };
    const scroller = findScrollable(listbox);
    const atEnd = () => !scroller || scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2;
    let best = null;
    let other = null; // "Other" / "Not listed", if the real answer never turns up

    for (let pass = 0; pass < 80; pass++) {
      const options = listOptions(listbox);
      const match = OriginFillFuzzyMatch.pickOption(options, candidates, { fieldType });
      if (match && match.confidence === 'exact') return match;
      if (match && (!best || rank[match.confidence] > rank[best.confidence])) {
        best = { ...match, scrollTop: scroller ? scroller.scrollTop : 0 };
      }
      const otherHere = allowOther ? OriginFillFuzzyMatch.pickOtherOption(options) : null;
      if (otherHere && (!other || OriginFillFuzzyMatch.otherOptionScore(otherHere.text) > OriginFillFuzzyMatch.otherOptionScore(other.text))) {
        other = { ...otherHere, scrollTop: scroller ? scroller.scrollTop : 0 };
      }

      if (atEnd()) break;
      scroller.scrollTop += Math.max(scroller.clientHeight * 0.8, 100);
      await OriginFillDom.delay(60);
    }

    const chosen = best || other;
    if (!chosen) return null;
    if (chosen.el.isConnected) return chosen;

    // A virtualised list unmounted the option while scrolling — go back and find it again
    scroller.scrollTop = chosen.scrollTop;
    await OriginFillDom.delay(100);
    const again = listOptions(listbox).find(o => o.text === chosen.text);
    return again ? { ...again, confidence: chosen.confidence } : null;
  }

  function findScrollable(el) {
    let current = el;
    for (let depth = 0; current && depth < 4; depth++) {
      if (current.scrollHeight > current.clientHeight + 4) return current;
      current = current.parentElement;
    }
    const inner = Array.from(el.querySelectorAll('*')).find(c => c.scrollHeight > c.clientHeight + 4);
    return inner || null;
  }

  async function closeListbox(button, listbox) {
    OriginFillDom.pressKey(listbox, 'Escape');
    OriginFillDom.pressKey(button, 'Escape');
    await OriginFillDom.waitFor(() => !isListOpen(listbox), { timeout: 500 });
    if (isListOpen(listbox)) {
      OriginFillDom.click(button);
      await OriginFillDom.delay(100);
    }
  }

  // ─── Prompt (searchable) Fields ────────────────────────────────

  /**
   * Fill a Workday prompt: type a search, press Enter, click the matching result.
   * Used for "How Did You Hear About Us?", School, Field of Study, Skills, Country Phone Code.
   *
   * @param {Object} field
   * @param {string|string[]} value
   * @param {Object} profile
   * @returns {Promise<{ success: boolean, note: string }>}
   */
  async function fillPrompt(field, value, profile, candidates) {
    const values = (Array.isArray(value) ? value : [value]).map(v => String(v).trim()).filter(Boolean);
    const missing = [];
    const notes = [];

    let refusedInARow = 0;
    let usedOther = false;
    for (let i = 0; i < values.length; i++) {
      const v = values[i];
      const query = buildPromptQuery(field.fieldType, v, profile);
      if (candidates && candidates.length && values.length === 1) query.candidates = candidates;
      const result = await selectPromptValue(field, query);
      if (!result.success) missing.push(v);
      if (result.note) notes.push(result.note);
      if (result.usedOther) usedOther = true;

      // Clicking options isn't working on this page — don't spend seconds on every remaining value
      refusedInARow = result.refused ? refusedInARow + 1 : 0;
      if (refusedInARow >= 2 && i < values.length - 1) {
        missing.push(...values.slice(i + 1));
        notes.unshift('Workday didn\'t accept the selections — add these yourself');
        break;
      }
    }

    closePrompt(field);

    if (missing.length === values.length) {
      return { success: false, note: notes[0] || `No match for "${values[0]}"` };
    }
    if (missing.length > 0) {
      return { success: true, note: `Added ${values.length - missing.length}/${values.length}. Not found: ${missing.join(', ')}` };
    }
    return { success: true, usedOther: usedOther || undefined, note: values.length === 1 ? (notes[0] || '') : '' };
  }

  /**
   * What to type into a prompt and which results count as a match.
   */
  function buildPromptQuery(fieldType, value, profile) {
    if (fieldType === 'phoneCountryCode') {
      const codeMatch = value.match(/\+?\s*(\d{1,4})/);
      const code = codeMatch ? `+${codeMatch[1]}` : '';
      const countryNames = OriginFillFieldMapper.getValueAliases('country', profile?.personal?.country || '');
      const named = value.replace(/\(.*?\)|\+?\d+/g, '').trim();
      // Workday searches by country name ("USA" finds nothing, "United States of America" does)
      const fullName = countryNames.find(n => n.length > 3);
      const searches = [named, fullName, code.replace('+', '')].filter(Boolean);
      const candidates = [value];
      [named, ...countryNames].filter(Boolean).forEach(name => {
        if (code) candidates.push(`${name} (${code})`);
        candidates.push(name);
      });
      return { searches: [...new Set(searches)], candidates, codeHint: code, fieldType };
    }

    const candidates = OriginFillFieldMapper.getValueAliases(fieldType, value);
    const searches = fieldType === 'country' ? candidates.filter(c => c.length > 3) : [value];
    // A college or subject the list spells differently is still found by its distinctive word
    const distinctive = OriginFillFuzzyMatch.distinctiveWord(value, fieldType);
    if (distinctive && distinctive !== value) searches.push(distinctive);
    return { searches: searches.length ? searches : [value], candidates, fieldType, allowOther: OriginFillFieldMapper.allowsOtherOption(fieldType) };
  }

  // How this page accepts a pick ('click' or 'keyboard'), learnt from the first value that
  // worked so later values don't wait out the method the page ignores
  let promptPickMethod = null;
  // The last result list each search box showed (Workday re-shows it before new results arrive)
  const lastPromptResults = new WeakMap();

  async function selectPromptValue(field, query) {
    const input = field.element;
    if (!input || !input.isConnected) return { success: false, note: 'Search box not found' };

    if (hasSelection(field, query.candidates)) return { success: true, note: '' };

    let pick = (list) => {
      const match = OriginFillFuzzyMatch.pickOption(list, query.candidates, { fieldType: query.fieldType });
      return match || (query.codeHint ? list.find(o => o.text.includes(`(${query.codeHint})`)) || null : null);
    };

    let options = null;
    for (const search of query.searches) {
      options = await runPromptSearch(field, search, query.candidates);
      // A search with exactly one result may select it straight away
      if (hasSelection(field, query.candidates)) return { success: true, note: '' };
      if (options.length && pick(options)) break;
    }

    // A college or course Workday doesn't list: its "Other" / "Not listed" entry
    if (query.allowOther && !(options && options.length && pick(options))) {
      const withOther = await searchForOther(field, options);
      if (withOther) {
        options = withOther;
        pick = (list) => OriginFillFuzzyMatch.pickOtherOption(list);
      }
    }

    if (!options || options.length === 0) {
      return { success: false, note: `Workday has no "${query.searches[0]}" option` };
    }

    for (let depth = 0; depth < 3; depth++) {
      const match = pick(options);
      if (!match) {
        return { success: false, note: `No option matches "${query.candidates[0]}" (e.g. ${options.slice(0, 3).map(o => o.text).join(', ')})` };
      }

      const outcome = await pickPromptOption(field, match);
      if (outcome === 'selected' && match.confidence === 'other') {
        return { success: true, usedOther: true, note: `"${query.candidates[0]}" isn't in Workday's list — chose "${match.text}"` };
      }
      if (outcome === 'selected') {
        return { success: true, note: match.confidence === 'exact' ? '' : `Selected "${match.text}"` };
      }
      if (outcome !== 'drilled') return { success: false, refused: true, note: `Could not select "${match.text}"` };
      options = promptOptions(field);
    }

    return { success: false, note: 'Too many nested categories' };
  }

  /**
   * Results holding an "Other" / "Not listed" entry: the list already showing, or a search for one.
   * @returns {Promise<Array|null>}
   */
  async function searchForOther(field, current) {
    if (current && OriginFillFuzzyMatch.pickOtherOption(current)) return current;
    for (const search of ['Other', 'Not Listed']) {
      const options = await runPromptSearch(field, search, [search]);
      if (OriginFillFuzzyMatch.pickOtherOption(options)) return options;
    }
    return null;
  }

  /**
   * Type a search into a prompt and wait for its results. Workday keeps the previous list
   * around (and Enter on an open list ticks its highlighted row instead of searching), so an
   * open list is closed first and the old list doesn't count as the answer.
   */
  async function runPromptSearch(field, search, candidates) {
    const input = field.element;
    const previous = lastPromptResults.get(input) || '';
    await closeOpenList(field);

    OriginFillDom.scrollIntoView(input);
    OriginFillDom.focus(input);
    OriginFillDom.click(input);
    const type = () => {
      OriginFillDom.setNativeValue(input, search);
      input.dispatchEvent(new InputEvent('input', { bubbles: true, data: search, inputType: 'insertText' }));
    };
    type();
    await OriginFillDom.delay(120);

    // Typing can re-open the last list
    if (await closeOpenList(field) && input.value !== search) type();
    OriginFillDom.pressKey(input, 'Enter');

    const options = await waitForStableOptions(field, candidates, previous);
    lastPromptResults.set(input, optionSignature(options));
    return options;
  }

  /**
   * Close this prompt's result list if one is open.
   * @returns {Promise<boolean>} whether a list was open
   */
  async function closeOpenList(field) {
    const isOpen = () => promptOptions(field).length > 0 || promptSaysEmpty();
    if (!isOpen()) return false;
    OriginFillDom.pressKey(field.element, 'Escape');
    if (await OriginFillDom.waitFor(() => !isOpen(), { timeout: 700, interval: 100 })) return true;
    // Escape didn't do it: a click outside the list does
    OriginFillDom.click(document.body);
    await OriginFillDom.waitFor(() => !isOpen(), { timeout: 700, interval: 100 });
    return true;
  }

  /**
   * Pick one search result and confirm Workday took it: a pill appears or its box is ticked.
   * Clicks go to the label first (Workday's handler sits on it or on the leaf node around it;
   * events bubble up, never down), then the checkbox and the row. Sites that ignore clicks
   * from scripts get the keyboard instead.
   * @returns {Promise<'selected'|'drilled'|null>}
   */
  async function pickPromptOption(field, match) {
    const row = optionRow(match.el);
    // Ticking a ticked row would remove it
    if (isRowTicked(row)) return 'selected';

    const before = selectedTexts(field).length;
    const listBefore = optionSignature(promptOptions(field));
    let clickedBox = null;
    const picked = () => selectedTexts(field).length > before || hasSelection(field, [match.text]) || isRowTicked(row, clickedBox);
    const settled = () => {
      if (picked()) return 'selected';
      // A category swaps the list for its children
      const now = promptOptions(field);
      return now.length && optionSignature(now) !== listBefore ? 'drilled' : null;
    };

    const tryClicks = async () => {
      for (const target of optionClickTargets(match.el)) {
        if (!target.isConnected) continue;
        if (picked()) return 'selected';
        if (target.matches('input[type="checkbox"], [role="checkbox"]')) clickedBox = target;
        OriginFillDom.scrollIntoView(target);
        OriginFillDom.click(target);
        const outcome = await OriginFillDom.waitFor(settled, { timeout: 1000 });
        if (outcome) return outcome;
      }
      return null;
    };
    const tryKeys = () => pickWithKeyboard(field, match, settled);

    const attempts = promptPickMethod === 'keyboard' ? [tryKeys, tryClicks] : [tryClicks, tryKeys];
    for (const attempt of attempts) {
      let outcome = await attempt();
      if (outcome === 'drilled') {
        // Some lists drop a picked item as its pill appears; give the pill a moment
        await OriginFillDom.delay(300);
        if (picked()) outcome = 'selected';
      }
      if (outcome === 'selected') promptPickMethod = attempt === tryKeys ? 'keyboard' : 'click';
      if (outcome) return outcome;
    }

    if (OriginFillLogger.isEnabled()) {
      const active = activeOption(field);
      OriginFillLogger.warn(`Workday didn't take "${match.text}". Markup (no values) for a bug report:`,
        `row: ${OriginFillDom.sketch(row, 4)}`, `| list: ${OriginFillDom.sketch(row.parentElement, 1)}`, `| highlight: ${active ? OriginFillDom.sketch(active, 0) : 'none'}`);
    }
    return null;
  }

  /**
   * Move Workday's highlight to the result with the arrow keys, then press Enter (Space for
   * tick-box lists). For pages that ignore clicks dispatched by scripts.
   */
  async function pickWithKeyboard(field, match, settled) {
    const row = optionRow(match.el);
    const isTarget = (el) => !!el && (el === row || row.contains(el) || el.contains(row) ||
      OriginFillFuzzyMatch.isSameText(optionText(el), match.text));
    const steps = promptOptions(field).length + 2;
    let key = 'ArrowDown';

    OriginFillDom.focus(field.element);
    for (let step = 0; step <= steps * 2; step++) {
      const active = activeOption(field);
      if (isTarget(active)) {
        for (const press of ['Enter', ' ']) {
          OriginFillDom.pressKey(keyTarget(field), press);
          const outcome = await OriginFillDom.waitFor(settled, { timeout: 800 });
          if (outcome) return outcome;
        }
        return null;
      }
      OriginFillDom.pressKey(keyTarget(field), key);
      await OriginFillDom.delay(80);
      const moved = activeOption(field);
      if (!moved && step >= 2) return null; // The keys don't move a highlight here
      if (moved === active && key === 'ArrowDown') key = 'ArrowUp'; // Reached the end: go back up
    }
    return null;
  }

  /** The result Workday's keyboard highlight is on (aria-activedescendant, or focus in the list). */
  function activeOption(field) {
    const holders = [field.element, ...Array.from(document.querySelectorAll(SEL.POPUP)).filter(p => OriginFillDom.isVisible(p))];
    for (const holder of holders) {
      const owner = holder.hasAttribute('aria-activedescendant') ? holder : holder.querySelector('[aria-activedescendant]');
      const id = owner && owner.getAttribute('aria-activedescendant');
      const el = id ? document.getElementById(id) : null;
      if (el && !el.closest(SEL.SELECTED_ITEM)) return optionRow(el);
    }
    const focused = document.activeElement;
    if (focused && focused !== document.body && focused.closest(SEL.POPUP) && !focused.closest(SEL.SELECTED_ITEM)) {
      return optionRow(focused);
    }
    return null;
  }

  /** Keys go wherever Workday moved focus (the list), else to the search box. */
  function keyTarget(field) {
    const focused = document.activeElement;
    return focused && focused !== document.body && focused.closest(SEL.POPUP) && !focused.closest(SEL.SELECTED_ITEM)
      ? focused
      : field.element;
  }

  function optionRow(el) {
    return el.closest('[role="option"]') || el.closest('[data-automation-id="promptLeafNode"]') || el;
  }

  /**
   * Whether a result's tick box shows it picked. `ignore` is a box we clicked ourselves: a
   * script click flips a checkbox even when the page ignores it, so it proves nothing.
   */
  function isRowTicked(row, ignore = null) {
    if (!row) return false;
    if (row.getAttribute('aria-checked') === 'true') return true;
    const box = row.querySelector('input[type="checkbox"], [role="checkbox"]');
    if (!box || box === ignore) return false;
    return box.checked === true || box.getAttribute('aria-checked') === 'true';
  }

  /**
   * Elements to click for a search result, best first.
   */
  function optionClickTargets(option) {
    const row = optionRow(option);
    const label = option.matches('[data-automation-id="promptOption"]') ? option : row.querySelector('[data-automation-id="promptOption"]');
    const leaf = option.closest('[data-automation-id="promptLeafNode"]') || row.querySelector('[data-automation-id="promptLeafNode"]');
    const checkbox = row.querySelector('input[type="checkbox"], [role="checkbox"]');
    return [...new Set([label || option, leaf, checkbox, row].filter(Boolean))];
  }

  function optionSignature(options) {
    return (options || []).map(o => o.text).join('|');
  }

  /**
   * Wait for this search's results and return them once they stop changing. The previous
   * search's list (shown first) only counts if it already holds a match. Returns [] as soon
   * as Workday says "No Items".
   */
  async function waitForStableOptions(field, candidates = [], previous = '') {
    let last = null;
    let emptyChecks = 0;
    const result = await OriginFillDom.waitFor(() => {
      const options = promptOptions(field);
      if (options.length === 0) {
        if (promptSaysEmpty()) {
          emptyChecks++;
          return emptyChecks >= 2 ? 'empty' : null;
        }
        return null;
      }
      emptyChecks = 0;
      const signature = optionSignature(options);
      const stable = signature === last;
      last = signature;
      if (!stable) return null;
      if (signature === previous && !OriginFillFuzzyMatch.pickOption(options, candidates, { fieldType: field.fieldType })) return null;
      return options;
    }, { timeout: OriginFillTiming.SEARCH_TIMEOUT, interval: 200 });
    if (result === 'empty') return [];
    return result || promptOptions(field);
  }

  function promptSaysEmpty() {
    return Array.from(document.querySelectorAll(SEL.POPUP)).some(popup =>
      OriginFillDom.isVisible(popup) && /\b(no items|no results|no matches|nothing found)\b/i.test(OriginFillDom.getText(popup)));
  }

  /**
   * Visible search results for a prompt field.
   */
  function promptOptions(field) {
    const ids = new Set(Array.from(field.wrapper.querySelectorAll('[id]')).map(el => el.id));
    let popups = Array.from(document.querySelectorAll(SEL.POPUP)).filter(p => OriginFillDom.isVisible(p));
    const associated = popups.filter(p => {
      const owner = p.getAttribute('data-associated-widget') || p.querySelector('[data-associated-widget]')?.getAttribute('data-associated-widget');
      return owner && ids.has(owner);
    });
    if (associated.length) popups = associated;
    popups.push(field.wrapper);

    const seen = new Set();
    const options = [];
    popups.forEach(popup => {
      popup.querySelectorAll(SEL.PROMPT_OPTION).forEach(el => {
        const optionEl = el.matches('[data-automation-id="promptOption"]') ? el : (el.querySelector('[data-automation-id="promptOption"]') || el);
        if (seen.has(optionEl) || optionEl.closest(SEL.SELECTED_ITEM)) return;
        if (!OriginFillDom.isVisible(optionEl)) return;
        seen.add(optionEl);
        const text = optionText(optionEl);
        if (text && !/^no items\.?$/i.test(text)) options.push({ el: optionEl, text });
      });
    });
    return options;
  }

  function selectedTexts(field) {
    const texts = Array.from(field.wrapper.querySelectorAll(SEL.SELECTED_ITEM))
      .map(el => optionText(el))
      .filter(Boolean);
    return [...new Set(texts)];
  }

  function hasSelection(field, candidates) {
    const selected = selectedTexts(field);
    return selected.some(s => candidates.some(c => {
      if (!c) return false;
      if (OriginFillFuzzyMatch.isSameText(s, c)) return true;
      // Hierarchical choices show as "Job Board > LinkedIn"
      const escaped = String(c).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return new RegExp(`[>/:–-]\\s*${escaped}$`, 'i').test(s);
    }));
  }

  function closePrompt(field) {
    const input = field.element;
    if (!input || !input.isConnected) return;
    // Don't leave an unmatched search ("Rust") typed in the box
    if (input.value) {
      OriginFillDom.setNativeValue(input, '');
      input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward' }));
    }
    OriginFillDom.pressKey(input, 'Escape');
    OriginFillDom.blur(input);
  }

  // ─── Dates ─────────────────────────────────────────────────────

  /**
   * Fill a Workday date (separate Month / Day / Year spin boxes, or a single text box).
   * @param {Object} field
   * @param {string} value
   * @returns {Promise<{ success: boolean, note: string }>}
   */
  async function fillDate(field, value) {
    const date = OriginFillFieldMapper.parseDate(value);
    if (!date || date.current) {
      return { success: false, note: date && date.current ? 'Current role — no end date' : `Unrecognized date "${value}"` };
    }

    const { month, day, year } = field.parts;
    const notes = [];
    const targets = [];
    if (month) {
      if (!date.month) notes.push('month assumed January');
      targets.push([month, date.month || 1, 2]);
    }
    if (day) targets.push([day, date.day || 1, 2]);
    if (year) targets.push([year, date.year, 4]);

    let ok = true;
    for (const [input, number, width] of targets) {
      ok = (await setDateSegment(input, number, width)) && ok;
    }

    const last = targets[targets.length - 1];
    if (last) OriginFillDom.blur(last[0]);

    return ok
      ? { success: true, note: notes.join('; ') }
      : { success: false, note: 'Date did not stick' };
  }

  function readSegment(input) {
    // Workday's own state (aria-valuenow) beats the box's text, which a script can set without
    // Workday noticing ("The field From is required" on save)
    const raw = input.hasAttribute('aria-valuenow') ? input.getAttribute('aria-valuenow') : input.value;
    const n = parseInt(String(raw || '').replace(/\D/g, ''), 10);
    return Number.isNaN(n) ? null : n;
  }

  /**
   * Set one date segment. Workday's spin boxes ignore pasted values but react to keys:
   * the reliable path is "value n-1, then ArrowUp" (the box increments what it shows).
   */
  async function setDateSegment(input, number, width) {
    if (readSegment(input) === number) return true;

    OriginFillDom.scrollIntoView(input);
    OriginFillDom.focus(input);
    OriginFillDom.click(input);

    // Strategy 1: n-1 then ArrowUp. No input event in between: React would restore the
    // controlled value before the keydown handler reads it.
    OriginFillDom.setNativeValue(input, String(number - 1));
    OriginFillDom.pressKey(input, 'ArrowUp');
    OriginFillDom.click(input);
    await OriginFillDom.delay(40);
    if (readSegment(input) === number) return true;

    // Strategy 2: type the digits
    OriginFillDom.setNativeValue(input, '');
    input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward' }));
    await OriginFillDom.typeText(input, String(number).padStart(width, '0'), 15);
    await OriginFillDom.delay(40);
    if (readSegment(input) === number) return true;

    // Strategy 3: plain value + change
    OriginFillDom.setNativeValue(input, String(number).padStart(width, '0'));
    input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await OriginFillDom.delay(40);
    return readSegment(input) === number;
  }

  /**
   * Normalize a date value to the format expected by a single text/date input.
   * Kept for single-box date fields and backwards compatibility.
   *
   * @param {string} value - Profile date (YYYY-MM-DD, MM/DD/YYYY, YYYY-MM, June 2024, etc.)
   * @param {HTMLElement} input - The target input element
   * @returns {string|null} Formatted date string, or the original value if it can't be parsed
   */
  function normalizeDate(value, input) {
    if (!value) return null;
    const date = OriginFillFieldMapper.parseDate(value);
    if (!date || date.current) return value;

    const year = String(date.year);
    const month = date.month ? String(date.month).padStart(2, '0') : null;
    const day = date.day ? String(date.day).padStart(2, '0') : null;
    const placeholder = (input.placeholder || '').toUpperCase();

    if (input.type === 'date') return `${year}-${month || '01'}-${day || '01'}`;
    if (input.type === 'month') return `${year}-${month || '01'}`;
    if (placeholder.includes('MM/DD/YYYY') || placeholder.includes('MM-DD-YYYY')) return `${month || '01'}/${day || '01'}/${year}`;
    if (placeholder.includes('DD/MM/YYYY')) return `${day || '01'}/${month || '01'}/${year}`;
    if (placeholder.includes('YYYY-MM-DD')) return `${year}-${month || '01'}-${day || '01'}`;
    if (placeholder.includes('MM/YYYY')) return `${month || '01'}/${year}`;
    if (placeholder.includes('YYYY')) return year;

    if (month && day) return `${month}/${day}/${year}`;
    if (month) return `${month}/${year}`;
    return year;
  }

  // ─── Résumé Upload ─────────────────────────────────────────────

  /**
   * Attach a résumé to Workday's upload control and wait for Workday to accept it.
   *
   * @param {Object} field - Resume field descriptor
   * @param {File} file
   * @returns {Promise<{ success: boolean, note: string }>}
   */
  async function uploadFile(field, file) {
    // With a single upload control on the page, any uploaded file belongs to it
    const scope = document.querySelectorAll(SEL.FILE_INPUT).length <= 1 ? document : (field.wrapper || document);
    const existing = Array.from(scope.querySelectorAll(SEL.UPLOADED_FILE));
    if (existing.some(el => OriginFillDom.getText(el).includes(file.name))) return { success: true, note: '' };
    if (existing.length > 0) return { success: true, note: 'A résumé is already attached — kept it' };

    const input = field.element.matches(SEL.FILE_INPUT) ? field.element : scope.querySelector(SEL.FILE_INPUT);
    // Workday lists the file (name + "Successfully Uploaded") in the upload area once it has it
    const area = field.wrapper && field.wrapper !== document.body ? field.wrapper : null;
    const before = area ? OriginFillDom.getText(area) : '';
    const uploaded = () => {
      if (Array.from(document.querySelectorAll(SEL.UPLOADED_FILE))
        .some(el => OriginFillDom.getText(el).includes(file.name) || el.matches('[data-automation-id="file-upload-successful"]'))) return true;
      if (!area || !area.isConnected) return false;
      const now = OriginFillDom.getText(area);
      return now !== before && (now.includes(file.name) || /successfully\s+uploaded|upload\s+complete/i.test(now));
    };

    OriginFillDom.attachFile(input, input ? null : field.dropZone, file);
    let confirmed = await OriginFillDom.waitFor(uploaded, { timeout: input && field.dropZone ? 6000 : OriginFillTiming.UPLOAD_TIMEOUT });

    // Some tenants only react to a drop on the zone
    if (!confirmed && input && field.dropZone) {
      OriginFillDom.attachFile(null, field.dropZone, file);
      confirmed = await OriginFillDom.waitFor(uploaded, { timeout: OriginFillTiming.UPLOAD_TIMEOUT });
    }

    if (confirmed) return { success: true, note: '' };
    if (input && input.files && input.files.length > 0) {
      return { success: true, note: 'Attached — check that Workday shows the file' };
    }
    return { success: false, note: 'Workday did not accept the file — upload it manually' };
  }

  // ─── Navigation ────────────────────────────────────────────────

  /**
   * The "Save and Continue" button of the current step (never clicked automatically).
   * @returns {HTMLElement|null}
   */
  function getNextButton() {
    return document.querySelector(SEL.NEXT_BUTTON);
  }

  // ─── Public API ─────────────────────────────────────────────────
  return Object.freeze({
    FIELD_MAP,
    SELECTORS: SEL,
    getFields,
    prepareSections,
    fillField,
    readValue,
    uploadFile,
    getNextButton,
    normalizeDate,
    nationalPhone,

    // Exposed for tests
    findSectionContainer,
    findAddButton,
    countEntries,
    fillDropdown,
    fillPrompt,
    fillDate
  });
})();
