/**
 * OriginFill — Generic Portal Field Mapper & Filler
 * Used for Greenhouse, Lever, iCIMS, Taleo and any other application form. Detects fields
 * from labels, placeholders, names and IDs, and fills native controls plus simple
 * type-to-search comboboxes.
 *
 * @license AGPL-3.0
 * @author CharyWorld
 */

var OriginFillGeneric = (() => {
  'use strict';

  const CONTROL_SELECTOR =
    'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"]):not([type="image"]):not([type="search"]):not([type="password"]), ' +
    'select, ' +
    'textarea, ' +
    '[contenteditable="true"]';

  // ─── Generic Field Discovery ───────────────────────────────────

  /**
   * Find all fillable fields on an unknown portal.
   * Returns descriptors in the same shape as the Workday adapter.
   *
   * @param {{ root?: ParentNode }} [options]
   * @returns {Array<Object>}
   */
  function getFields({ root = document, profile = null } = {}) {
    const results = [];
    const seenRadioGroups = new Set();

    root.querySelectorAll(CONTROL_SELECTOR).forEach(element => {
      if (element.disabled || element.readOnly) return;
      if (element.tagName !== 'SELECT' && element.closest(WIDGET.container)) return;

      const isFile = element.type === 'file';
      const isEnhancedSelect = element.tagName === 'SELECT' && enhancedWidget(element);
      if (!isFile && !isEnhancedSelect && !OriginFillDetector.isVisible(element)) return;

      // Radio buttons: one field per group
      if (element.type === 'radio') {
        const groupKey = element.name || element.closest('fieldset, [role="radiogroup"]');
        if (!groupKey || seenRadioGroups.has(groupKey)) return;
        seenRadioGroups.add(groupKey);
      }

      const field = describe(element, profile);
      if (field) results.push(field);
    });

    assignEntryIndexes(results);
    OriginFillLogger.info(`Generic: Found ${results.length} fillable fields`);
    return results;
  }

  /**
   * Build a field descriptor for one control.
   * @param {HTMLElement} element
   * @param {Object|null} profile - Lets unrecognised questions through when a saved answer fits
   * @returns {Object|null}
   */
  function describe(element, profile) {
    const control = controlKind(element);
    let label = OriginFillDetector.getInputLabel(element);
    let radios = null;

    if (control === 'radio') {
      radios = element.name
        ? Array.from(document.querySelectorAll(`input[type="radio"][name="${CSS.escape(element.name)}"]`))
        : Array.from((element.closest('fieldset, [role="radiogroup"]') || element.parentElement).querySelectorAll('input[type="radio"]'));
      label = groupQuestion(element) || label;
    }

    let detection;
    if (control === 'radio') {
      const hints = [element.name].filter(Boolean);
      const { section } = OriginFillFieldMapper.detectSectionContext(element);
      const result = OriginFillFieldMapper.classifyText({ label, hints, control: 'text', section });
      detection = { ...result, profilePath: OriginFillFieldMapper.FIELD_TO_PROFILE[result.fieldType] || null };
    } else {
      detection = OriginFillFieldMapper.detectFieldType(element);
    }

    const savedAnswer = !detection.fieldType && profile && label
      ? OriginFillFieldMapper.findSavedAnswer(profile, label)
      : null;
    const contextText = radios ? `${label} ${radios.map(radioLabel).join(' ')}` : '';
    const commonQuestion = !detection.fieldType && label ? OriginFillFAQ.match(label, contextText) : null;
    if (!detection.fieldType && !savedAnswer && !commonQuestion) return null;

    const { section, index, entry } = OriginFillFieldMapper.detectSectionContext(element);
    return {
      element,
      wrapper: element.closest('.form-group, .field, .application-question, fieldset, li, div') || element.parentElement,
      control,
      controls: radios || [element],
      parts: radios ? { radios } : null,
      dropZone: null,
      label: label || element.name || element.id || detection.fieldType,
      contextText,
      automationId: element.getAttribute('data-automation-id') || '',
      fieldType: detection.fieldType,
      required: element.required || element.getAttribute('aria-required') === 'true',
      section: section || OriginFillFieldMapper.SECTION_OF_FIELD[detection.fieldType] || null,
      index,
      entry,
      profilePath: detection.profilePath,
      inputType: OriginFillFieldMapper.getInputType(element),
      confidence: detection.confidence,
      source: 'generic'
    };
  }

  /**
   * The visible replacement of a hidden <select> (Select2, Chosen, Selectize, Tom Select).
   * They keep the real <select> in the page and follow its change events. Select2 4 and
   * Chosen put their box after the <select>, Select2 3 before it (with id "s2id_<id>").
   */
  function enhancedWidget(select) {
    const candidates = [
      select.nextElementSibling,
      select.previousElementSibling,
      select.id ? document.getElementById(`s2id_${select.id}`) : null
    ];
    return candidates.find(el => el && el.matches(WIDGET.container) && OriginFillDom.isVisible(el)) || null;
  }

  function controlKind(element) {
    const tag = element.tagName;
    if (tag === 'SELECT') return 'select';
    if (tag === 'TEXTAREA') return 'textarea';
    if (element.getAttribute('contenteditable') === 'true') return 'richtext';
    switch ((element.type || 'text').toLowerCase()) {
      case 'checkbox': return 'checkbox';
      case 'radio': return 'radio';
      case 'file': return 'file';
      case 'date':
      case 'month': return 'native-date';
    }
    if (element.getAttribute('role') === 'combobox' || element.getAttribute('aria-autocomplete') === 'list') return 'combobox';
    return 'text';
  }

  /**
   * The question a radio group answers (fieldset legend or labelled group).
   */
  function groupQuestion(radio) {
    const group = radio.closest('fieldset, [role="radiogroup"]');
    if (!group) return '';
    const legend = group.querySelector('legend');
    if (legend) return OriginFillDom.cleanLabel(legend.textContent);
    const labelledBy = group.getAttribute('aria-labelledby');
    if (labelledBy) {
      return OriginFillDom.cleanLabel(labelledBy.split(/\s+/).map(id => document.getElementById(id)?.textContent || '').join(' '));
    }
    return OriginFillDom.cleanLabel(group.getAttribute('aria-label') || '');
  }

  /**
   * Repeating fields without an explicit entry number get one by position.
   */
  function assignEntryIndexes(fields) {
    OriginFillFieldMapper.assignEntryIndexes(fields);
  }

  /**
   * The value a field currently holds, for "already filled" checks.
   * @param {Object} field
   * @returns {string|boolean|null}
   */
  function readValue(field) {
    const el = field.element;
    if (!el || !el.isConnected) return null;
    switch (field.control) {
      case 'checkbox':
        return el.checked;
      case 'radio': {
        const checked = field.parts.radios.find(r => r.checked);
        return checked ? radioLabel(checked) : null;
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

  // ─── Generic Fill Logic ────────────────────────────────────────

  /**
   * Fill a generic form field.
   *
   * @param {Object} field - Descriptor from getFields()
   * @param {any} value
   * @returns {Promise<{ success: boolean, note: string }>}
   */
  async function fillField(field, value, context = {}) {
    if (value === undefined || value === null || value === '') {
      return { success: false, note: 'Empty value' };
    }

    const element = field.element;
    const candidates = context.candidates && context.candidates.length
      ? context.candidates
      : OriginFillFieldMapper.getValueAliases(field.fieldType, value);
    // A college or course the list doesn't have gets "Other" / "Not listed"
    const allowOther = OriginFillFieldMapper.allowsOtherOption(field.fieldType);
    try {
      switch (field.control) {
        case 'select': {
          // A list that loads its options as you type has (almost) none in the page yet
          const widget = enhancedWidget(element);
          if (widget && loadsOptionsAsYouType(element)) return await fillWidgetList(field, widget, candidates, { allowOther });
          return await OriginFillDom.selectNativeOption(element, candidates, { allowOther, fieldType: field.fieldType });
        }
        case 'checkbox':
          return await OriginFillDom.setCheckbox(element, value === true || /^(true|yes|y|1)$/i.test(String(value)));
        case 'radio':
          return await OriginFillDom.chooseRadio(field.parts.radios, candidates.map(c => c === true ? 'Yes' : c === false ? 'No' : String(c)), radioLabel);
        case 'richtext':
          return await OriginFillDom.fillRichText(element, toText(field, value));
        case 'native-date':
          return await OriginFillDom.fillText(element, OriginFillWorkday.normalizeDate(String(value), element));
        case 'combobox':
          return await fillCombobox(field, value, { allowOther });
        case 'file':
          return { success: false, note: 'File uploads are handled by the filler' };
        default:
          if (field.fieldType === 'phone' && element.closest('.iti, .intl-tel-input')) {
            return await fillFlagPhone(field, String(value), context.profile);
          }
          return await OriginFillDom.fillText(element, toText(field, value));
      }
    } catch (err) {
      OriginFillLogger.error('Generic fillField error:', err);
      return { success: false, note: err.message };
    }
  }

  function toText(field, value) {
    if (Array.isArray(value)) return field.fieldType === 'skills' ? value.join(', ') : value.filter(Boolean).join('\n');
    if (typeof value === 'boolean') return value ? 'Yes' : 'No';
    if (['workStartDate', 'workEndDate'].includes(field.fieldType)) {
      return OriginFillWorkday.normalizeDate(String(value), field.element) || String(value);
    }
    if (['eduStartYear', 'eduEndYear'].includes(field.fieldType)) {
      const date = OriginFillFieldMapper.parseDate(value);
      return date && date.year ? String(date.year) : String(value);
    }
    return String(value);
  }

  function radioLabel(radio) {
    if (radio.id) {
      const label = document.querySelector(`label[for="${CSS.escape(radio.id)}"]`);
      if (label) return OriginFillDom.cleanLabel(label.textContent);
    }
    const parent = radio.closest('label');
    return OriginFillDom.cleanLabel(parent ? parent.textContent : (radio.getAttribute('aria-label') || radio.value));
  }

  /**
   * Phone inputs with a country-flag picker (intl-tel-input, used by Yello and many others):
   * choose the country in the picker, then type the national number.
   */
  async function fillFlagPhone(field, phone, profile) {
    const input = field.element;
    const picker = input.closest('.iti, .intl-tel-input');
    const configured = String(profile?.personal?.phoneCountryCode || '').match(/\d{1,4}/);
    const inNumber = phone.trim().match(/^\+\s*(\d{1,4})[\s.-]/);
    const dialCode = configured ? configured[0]
      : inNumber ? inNumber[1]
      : OriginFillFieldMapper.dialCodeForCountry(profile?.personal?.country);
    const national = inNumber ? phone.trim().slice(inNumber[0].length).trim() : phone.trim();

    let note = '';
    const shown = OriginFillDom.getText(picker.querySelector('.iti__selected-dial-code, .selected-dial-code'));
    if (dialCode && shown.replace(/\D/g, '') !== dialCode) {
      const switched = await chooseDialCode(picker, dialCode, profile?.personal?.country);
      if (!switched) note = `Couldn't switch the country code to +${dialCode}`;
    }

    const result = await OriginFillDom.fillText(input, dialCode ? national : phone);
    return { success: result.success, note: [result.note, note].filter(Boolean).join('; ') };
  }

  async function chooseDialCode(picker, dialCode, countryName) {
    const flag = picker.querySelector('.iti__selected-flag, .iti__selected-country, .selected-flag');
    if (!flag) return false;
    OriginFillDom.click(flag);

    const items = await OriginFillDom.waitFor(() => {
      const found = Array.from(document.querySelectorAll(`[data-dial-code="${dialCode}"]`));
      return found.length ? found : null;
    }, { timeout: 1500 });
    if (!items) return false;

    // Several countries share a code (+1): prefer the profile's country
    const names = OriginFillFieldMapper.getValueAliases('country', countryName || '');
    const item = items.find(li => names.some(n => n && OriginFillDom.getText(li).toLowerCase().includes(n.toLowerCase()))) || items[0];
    OriginFillDom.scrollIntoView(item);
    OriginFillDom.click(item);

    return !!(await OriginFillDom.waitFor(() =>
      OriginFillDom.getText(picker.querySelector('.iti__selected-dial-code, .selected-dial-code')).replace(/\D/g, '') === dialCode ||
      picker.querySelector(`.iti__selected-flag[title*="+${dialCode}"], .iti__selected-country[title*="+${dialCode}"]`), { timeout: 1000 }));
  }

  /**
   * Type-to-search comboboxes (react-select and friends): type, wait for options, click one.
   */
  // ─── Searchable lists (Select2, Chosen) ────────────────────────

  const WIDGET = Object.freeze({
    container: '.select2-container, .select2, .chosen-container, .selectize-control, .ts-wrapper',
    // What to press to open the list
    opener: '.select2-selection, .select2-choice, .select2-choices, .chosen-single, .chosen-choices',
    // The search box of the open list (Select2 4 / Select2 3 / Chosen)
    search: '.select2-container--open .select2-search__field, .select2-drop-active .select2-input, .chosen-with-drop .chosen-search input, .chosen-with-drop .chosen-search-input',
    // Results that can be picked
    result: '.select2-container--open .select2-results__option[aria-selected], .select2-drop-active .select2-result-selectable, .chosen-with-drop .chosen-results li.active-result',
    // "Searching…" and "No results found"
    busy: '.select2-container--open .loading-results, .select2-drop-active .select2-searching',
    empty: '.select2-container--open .select2-results__message, .select2-drop-active .select2-no-results, .chosen-with-drop .chosen-results li.no-results',
    // What the closed list shows as its value
    shown: '.select2-selection__rendered, .select2-chosen, .chosen-single span',
    highlighted: '.select2-results__option--highlighted, .select2-highlighted, .highlighted'
  });

  /**
   * Whether a Select2 / Chosen list fetches its options as you type: the <select> holds no
   * more than a placeholder and the current value, or names its data source.
   */
  function loadsOptionsAsYouType(select) {
    if (select.matches('[data-ajax--url], [data-ajax-url], [data-url], [data-source], [data-remote]')) return true;
    return Array.from(select.options).filter(o => o.value !== '' && !o.disabled).length <= 1;
  }

  /**
   * Fill a Select2 / Chosen list through its own search box: open it, type the answer and
   * pick the matching result (or "Other" / "Not listed" for a college the list lacks).
   * @param {Object} field - Its element is the <select> (or hidden input) holding the value
   * @param {HTMLElement} widget - The list's visible box
   * @param {string[]} candidates
   * @returns {Promise<{ success: boolean, note: string, usedOther?: boolean, debug?: string }>}
   */
  async function fillWidgetList(field, widget, candidates, { allowOther = false } = {}) {
    const holder = field.element;
    const before = holder.value;
    const took = (text) => (!!holder.value && holder.value !== before) ||
      OriginFillFuzzyMatch.isSameText(widgetValue(widget), text);

    let results = [];
    let match = null;
    for (const term of searchTerms(field.fieldType, candidates)) {
      results = await searchWidget(widget, term, candidates, field.fieldType);
      if (results === null) return { success: false, note: 'The list did not open', debug: OriginFillDom.sketch(widget, 3) };
      match = OriginFillFuzzyMatch.pickOption(results, candidates, { fieldType: field.fieldType });
      if (match) break;
    }
    if (!match && allowOther) {
      match = OriginFillFuzzyMatch.pickOtherOption(results);
      for (const term of ['Other', 'Not Listed']) {
        if (match) break;
        results = (await searchWidget(widget, term, [term])) || [];
        match = OriginFillFuzzyMatch.pickOtherOption(results);
      }
    }
    if (!match) {
      const sample = results.slice(0, 3).map(o => o.text).join(', ');
      closeWidget(widget);
      return { success: false, note: `No option matches "${candidates[0]}"${sample ? ` (e.g. ${sample})` : ''}` };
    }

    OriginFillDom.scrollIntoView(match.el);
    OriginFillDom.click(match.el); // Select2 and Chosen pick on mouseup
    let ok = await OriginFillDom.waitFor(() => took(match.text), { timeout: 1500 });
    if (!ok && match.el.isConnected && match.el.matches(WIDGET.highlighted)) {
      // Enter picks the highlighted result
      const search = openSearchBox(widget);
      if (search) {
        OriginFillDom.pressKey(search, 'Enter');
        ok = await OriginFillDom.waitFor(() => took(match.text), { timeout: 1000 });
      }
    }
    closeWidget(widget);

    if (!ok) return { success: false, note: `Could not select "${match.text}"`, debug: OriginFillDom.sketch(widget, 3) };
    if (match.confidence === 'other') {
      return { success: true, usedOther: true, note: `"${candidates[0]}" isn't in the list — chose "${match.text}"` };
    }
    return { success: true, note: match.confidence === 'exact' ? '' : `Selected "${match.text}"` };
  }

  /**
   * What to type into a list's search box, best first: country lists search full names ("USA"
   * finds nothing), and a college is also tried by its distinctive word ("Vaageshwari") in
   * case the list spells the rest differently.
   * @returns {string[]} At most three searches
   */
  function searchTerms(fieldType, candidates) {
    const terms = fieldType === 'country' ? candidates.filter(c => c.length > 3) : [candidates[0], candidates[1]];
    const distinctive = OriginFillFuzzyMatch.distinctiveWord(candidates[0], fieldType);
    if (distinctive && distinctive !== candidates[0]) terms.push(distinctive);
    return [...new Set(terms.filter(Boolean))].slice(0, 3);
  }

  /**
   * Open a Select2 / Chosen list if needed, type a search and wait for its results. The list
   * shows the last search's results until the new ones arrive, so those only count when they
   * already hold a match.
   * @returns {Promise<Array<{el: HTMLElement, text: string}>|null>} null when it didn't open
   */
  async function searchWidget(widget, term, candidates, fieldType) {
    let search = openSearchBox(widget);
    if (!search) {
      const opener = widget.querySelector(WIDGET.opener) || widget;
      OriginFillDom.scrollIntoView(opener);
      OriginFillDom.click(opener); // Opens on mousedown
      search = await OriginFillDom.waitFor(() => openSearchBox(widget), { timeout: 1500 });
    }
    if (!search) return null;

    const previous = widgetResults().map(o => o.text).join('|');
    OriginFillDom.focus(search);
    OriginFillDom.setNativeValue(search, term);
    search.dispatchEvent(new InputEvent('input', { bubbles: true, data: term, inputType: 'insertText' }));
    search.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: term.slice(-1) })); // Chosen searches on keyup

    let last = null;
    let emptyChecks = 0;
    const results = await OriginFillDom.waitFor(() => {
      if (visible(WIDGET.busy)) return null;
      const options = widgetResults();
      if (options.length === 0) {
        emptyChecks = visible(WIDGET.empty) ? emptyChecks + 1 : 0;
        return emptyChecks >= 2 ? 'empty' : null;
      }
      const signature = options.map(o => o.text).join('|');
      const stable = signature === last;
      last = signature;
      if (!stable) return null;
      if (signature === previous && !OriginFillFuzzyMatch.pickOption(options, candidates, { fieldType })) return null;
      return options;
    }, { timeout: OriginFillTiming.SEARCH_TIMEOUT, interval: 150 });

    if (results === 'empty') return [];
    return results || widgetResults();
  }

  function visible(selector) {
    return Array.from(document.querySelectorAll(selector)).some(el => OriginFillDom.isVisible(el));
  }

  function openSearchBox(widget) {
    // Multi-selects keep their search box inside the box itself
    const inline = widget.querySelector('.select2-search--inline .select2-search__field, .select2-search-field input, .chosen-choices input');
    if (inline && widget.matches('.select2-container--open, .select2-container-active, .chosen-with-drop')) return inline;
    return Array.from(document.querySelectorAll(WIDGET.search)).find(el => OriginFillDom.isVisible(el)) || null;
  }

  function widgetResults() {
    return Array.from(document.querySelectorAll(WIDGET.result))
      .filter(el => OriginFillDom.isVisible(el) && el.getAttribute('aria-disabled') !== 'true' && !el.matches('.loading-results, .select2-results__message'))
      .map(el => ({ el, text: OriginFillDom.cleanLabel(OriginFillDom.getText(el)) }))
      .filter(o => o.text);
  }

  function widgetValue(widget) {
    const shown = widget.querySelector(WIDGET.shown);
    return shown ? OriginFillDom.cleanLabel(shown.getAttribute('title') || OriginFillDom.getText(shown)) : '';
  }

  function closeWidget(widget) {
    const search = openSearchBox(widget);
    if (search) OriginFillDom.pressKey(search, 'Escape');
  }

  // ─── Type-ahead boxes ──────────────────────────────────────────

  // Suggestions of ARIA comboboxes and the common type-ahead libraries (typeahead.js,
  // jQuery UI, Google Places, Bootstrap typeahead, autoComplete.js, Awesomplete)
  const SUGGESTION = '[role="option"], .tt-suggestion, .ui-menu-item, .pac-item, .autocomplete-suggestion, ul.typeahead li, .awesomplete li';

  async function fillCombobox(field, value, { allowOther = false } = {}) {
    const input = field.element;
    const candidates = OriginFillFieldMapper.getValueAliases(field.fieldType, Array.isArray(value) ? value[0] : value);

    const typeAndList = async (text) => {
      OriginFillDom.scrollIntoView(input);
      OriginFillDom.focus(input);
      OriginFillDom.click(input);
      OriginFillDom.setNativeValue(input, text);
      input.dispatchEvent(new InputEvent('input', { bubbles: true, data: text, inputType: 'insertText' }));

      const listId = input.getAttribute('aria-controls') || input.getAttribute('aria-owns');
      return OriginFillDom.waitFor(() => {
        const scope = (listId && document.getElementById(listId)) || document;
        const found = Array.from(scope.querySelectorAll(SUGGESTION))
          .filter(o => OriginFillDom.isVisible(o))
          .map(el => ({ el, text: OriginFillDom.cleanLabel(OriginFillDom.getText(el)) }))
          .filter(o => o.text);
        return found.length ? found : null;
      }, { timeout: 4000 });
    };

    let options = await typeAndList(candidates[0]);
    if (!options && !allowOther) {
      // Free-text combobox: keep what we typed
      OriginFillDom.blur(input);
      return input.value ? { success: true, note: 'Typed — no suggestions appeared' } : { success: false, note: 'No suggestions' };
    }

    let match = options ? OriginFillFuzzyMatch.pickOption(options, candidates, { fieldType: field.fieldType }) : null;
    if (!match && allowOther) {
      // Not in the list: its "Other" / "Not listed" entry, already shown or found by searching
      match = (options && OriginFillFuzzyMatch.pickOtherOption(options)) || null;
      // A box that suggested nothing for the real answer gets one look for "Other"
      for (const search of options ? ['Other', 'Not listed'] : ['Other']) {
        if (match) break;
        const found = await typeAndList(search);
        match = found ? OriginFillFuzzyMatch.pickOtherOption(found) : null;
      }
      if (!match && !options) {
        // Free-text combobox after all: type the real answer
        OriginFillDom.setNativeValue(input, candidates[0]);
        input.dispatchEvent(new InputEvent('input', { bubbles: true, data: candidates[0], inputType: 'insertText' }));
        OriginFillDom.blur(input);
        return { success: true, note: 'Typed — no suggestions appeared' };
      }
    }
    if (!match) {
      OriginFillDom.pressKey(input, 'Escape');
      return { success: false, note: `No option matches "${candidates[0]}"`, debug: OriginFillDom.sketch(field.wrapper || input.parentElement, 3) };
    }

    OriginFillDom.scrollIntoView(match.el);
    OriginFillDom.click(match.el);
    await OriginFillDom.delay(150);
    OriginFillDom.blur(input);
    if (match.confidence === 'other') {
      return { success: true, usedOther: true, note: `"${candidates[0]}" isn't in the list — chose "${match.text}"` };
    }
    return { success: true, note: OriginFillFuzzyMatch.isSameText(match.text, candidates[0]) ? '' : `Selected "${match.text}"` };
  }

  /**
   * Attach a résumé to a native file input.
   * @param {Object} field
   * @param {File} file
   * @returns {Promise<{ success: boolean, note: string }>}
   */
  async function uploadFile(field, file) {
    OriginFillDom.attachFile(field.element, null, file);
    await OriginFillDom.delay(300);
    const attached = field.element.files && field.element.files.length > 0;
    return attached
      ? { success: true, note: '' }
      : { success: false, note: 'File not attached — upload it manually' };
  }

  // ─── Form Structure Analysis ───────────────────────────────────

  /**
   * Analyze the form structure of a generic portal.
   * Identifies sections (personal, education, work) by grouping fields.
   *
   * @returns {{ sections: Array<{ name: string, fields: HTMLElement[] }>, totalFields: number }}
   */
  function analyzeFormStructure() {
    const forms = document.querySelectorAll('form');
    const sections = [];
    let totalFields = 0;

    forms.forEach(form => {
      // Look for fieldsets or section dividers
      const fieldsets = form.querySelectorAll('fieldset, [role="group"], .form-section, .form-group');

      if (fieldsets.length > 0) {
        fieldsets.forEach(fieldset => {
          const legend = fieldset.querySelector('legend, h2, h3, h4, .section-title');
          const name = legend ? legend.textContent.trim() : 'Form Section';
          const fields = fieldset.querySelectorAll('input, select, textarea');
          totalFields += fields.length;

          sections.push({
            name,
            fields: Array.from(fields)
          });
        });
      } else {
        // No fieldsets — treat entire form as one section
        const fields = form.querySelectorAll(
          'input:not([type="hidden"]):not([type="submit"]):not([type="button"]), select, textarea'
        );
        totalFields += fields.length;

        sections.push({
          name: 'Application Form',
          fields: Array.from(fields)
        });
      }
    });

    return { sections, totalFields };
  }

  // ─── Public API ─────────────────────────────────────────────────
  return Object.freeze({
    getFields,
    fillField,
    readValue,
    uploadFile,
    analyzeFormStructure
  });
})();
