/**
 * OriginFill — Portal Detection Engine
 * Automatically detect which job portal the user is on.
 * Uses URL patterns + DOM confirmation for confidence scoring.
 *
 * @license AGPL-3.0
 * @author CharyWorld
 */

var OriginFillDetector = (() => {
  'use strict';

  /** @type {{ type: string, confidence: string, pageName: string, url: string } | null} */
  let _lastDetection = null;

  // ─── URL-Based Detection ───────────────────────────────────────

  /**
   * Detect portal type from URL.
   * @param {string} url
   * @returns {{ type: string, confidence: string } | null}
   */
  function detectFromURL(url) {
    if (!url) return null;

    let hostname = '';
    try {
      hostname = new URL(url).hostname.toLowerCase();
    } catch (e) {
      return null;
    }

    const isHost = (domain) => hostname === domain || hostname.endsWith(`.${domain}`);

    if (isHost('myworkdayjobs.com') || isHost('myworkday.com') || isHost('myworkdaysite.com')) {
      return { type: OriginFillPortals.WORKDAY, confidence: OriginFillConfidence.MEDIUM };
    }
    if (isHost('greenhouse.io')) {
      return { type: OriginFillPortals.GREENHOUSE, confidence: OriginFillConfidence.MEDIUM };
    }
    if (isHost('lever.co')) {
      return { type: OriginFillPortals.LEVER, confidence: OriginFillConfidence.MEDIUM };
    }
    if (isHost('icims.com')) {
      return { type: OriginFillPortals.ICIMS, confidence: OriginFillConfidence.MEDIUM };
    }
    if (isHost('taleo.net')) {
      return { type: OriginFillPortals.TALEO, confidence: OriginFillConfidence.MEDIUM };
    }

    return null;
  }

  // ─── DOM-Based Confirmation ────────────────────────────────────

  /**
   * Confirm portal type by inspecting DOM structure.
   * Each portal has unique DOM fingerprints.
   *
   * @param {string} portalType - Suspected portal type from URL detection
   * @returns {{ confirmed: boolean, pageName: string, confidence: string }}
   */
  function confirmFromDOM(portalType) {
    switch (portalType) {
      case OriginFillPortals.WORKDAY:
        return confirmWorkday();
      case OriginFillPortals.GREENHOUSE:
        return confirmGreenhouse();
      case OriginFillPortals.LEVER:
        return confirmLever();
      case OriginFillPortals.ICIMS:
        return confirmICIMS();
      case OriginFillPortals.TALEO:
        return confirmTaleo();
      default:
        return { confirmed: false, pageName: '', confidence: OriginFillConfidence.NONE };
    }
  }

  /**
   * Confirm Workday portal.
   * Workday uses `data-automation-id` attributes extensively.
   */
  function confirmWorkday() {
    // Workday uses `data-automation-id` attributes on nearly every element
    const hasAutomationIds = document.querySelector('[data-automation-id]') !== null;
    const hasApplyFlow = document.querySelector(
      '[data-automation-id="applyFlowPage"], [data-automation-id="applicationForm"], [data-automation-id="jobPostingPage"], [data-automation-id="progressBar"]'
    ) !== null;

    const { pageName } = getWorkdayStep();

    return {
      confirmed: hasAutomationIds || hasApplyFlow,
      pageName,
      confidence: (hasAutomationIds || hasApplyFlow) ? OriginFillConfidence.HIGH : OriginFillConfidence.MEDIUM
    };
  }

  /**
   * Read the current step of a Workday application from its progress bar.
   * Workday renders: <li data-automation-id="progressBarActiveStep">current step 2 of 6 My Information</li>
   *
   * @returns {{ pageName: string, pageNumber: number, totalPages: number }}
   */
  function getWorkdayStep() {
    const active = document.querySelector('[data-automation-id="progressBarActiveStep"]');
    if (active) {
      const text = (active.textContent || '').replace(/\s+/g, ' ').trim();
      const match = text.match(/step\s+(\d+)\s+of\s+(\d+)\s*(.*)$/i);
      if (match) {
        return {
          pageName: match[3].trim() || `Step ${match[1]}`,
          pageNumber: parseInt(match[1], 10),
          totalPages: parseInt(match[2], 10)
        };
      }
      const steps = document.querySelectorAll('[data-automation-id="progressBar"] li');
      return {
        pageName: text.replace(/^current\s+step\s*/i, '') || 'Application Form',
        pageNumber: Array.from(steps).indexOf(active) + 1 || 1,
        totalPages: steps.length || 1
      };
    }

    return { pageName: detectWorkdayPage(), pageNumber: 1, totalPages: 1 };
  }

  /**
   * Fallback page name for Workday pages without a progress bar (older tenants).
   * @returns {string}
   */
  function detectWorkdayPage() {
    const sectionHeaders = [
      { selector: '[data-automation-id="contactInformationPage"], [data-automation-id="legalNameSection"]', name: 'My Information' },
      { selector: '[data-automation-id="myExperiencePage"], [data-automation-id="workExperienceSection"]', name: 'My Experience' },
      { selector: '[data-automation-id="primaryQuestionnairePage"], [data-automation-id="questionSection"]', name: 'Application Questions' },
      { selector: '[data-automation-id="voluntaryDisclosuresPage"]', name: 'Voluntary Disclosures' },
      { selector: '[data-automation-id="selfIdentificationPage"]', name: 'Self Identify' },
      { selector: '[data-automation-id="reviewJobApplicationPage"], [data-automation-id="reviewSection"]', name: 'Review' }
    ];

    for (const { selector, name } of sectionHeaders) {
      const el = document.querySelector(selector);
      if (el && isVisible(el)) return name;
    }

    // Fallback: check h2/h3 text content
    const headings = document.querySelectorAll('h2, h3');
    for (const h of headings) {
      const text = h.textContent.trim().toLowerCase();
      if (text.includes('my information') || text.includes('personal')) return 'My Information';
      if (text.includes('experience')) return 'My Experience';
      if (text.includes('question')) return 'Application Questions';
      if (text.includes('review')) return 'Review';
    }

    return 'Application Form';
  }

  /**
   * Whether the Workday page is a step of an application (as opposed to a job listing).
   * @returns {boolean}
   */
  function isWorkdayApplication() {
    return document.querySelector('[data-automation-id="applyFlowPage"], [data-automation-id="progressBar"]') !== null ||
      /\/apply(\/|$)/i.test(window.location.pathname);
  }

  /**
   * Confirm Greenhouse portal.
   */
  function confirmGreenhouse() {
    const hasAppForm = document.querySelector('#application') !== null
      || document.querySelector('#application_form') !== null
      || document.querySelector('.application--form') !== null;

    return {
      confirmed: hasAppForm,
      pageName: hasAppForm ? 'Application Form' : '',
      confidence: hasAppForm ? OriginFillConfidence.HIGH : OriginFillConfidence.NONE
    };
  }

  /**
   * Confirm Lever portal.
   */
  function confirmLever() {
    const hasLeverForm = document.querySelector('.application-form') !== null
      || document.querySelector('.application-page') !== null
      || document.querySelector('[class*="lever"]') !== null;

    return {
      confirmed: hasLeverForm,
      pageName: hasLeverForm ? 'Application Form' : '',
      confidence: hasLeverForm ? OriginFillConfidence.HIGH : OriginFillConfidence.NONE
    };
  }

  /**
   * Confirm iCIMS portal.
   */
  function confirmICIMS() {
    const hasICIMS = document.querySelector('.iCIMS_MainWrapper') !== null
      || document.querySelector('[id*="icims"]') !== null;

    return {
      confirmed: hasICIMS,
      pageName: hasICIMS ? 'Application Form' : '',
      confidence: hasICIMS ? OriginFillConfidence.HIGH : OriginFillConfidence.NONE
    };
  }

  /**
   * Confirm Taleo portal.
   */
  function confirmTaleo() {
    const hasTaleo = document.querySelector('.taleo-form') !== null
      || document.querySelector('[id*="taleo"]') !== null
      || document.querySelector('form[action*="taleo"]') !== null;

    return {
      confirmed: hasTaleo,
      pageName: hasTaleo ? 'Application Form' : '',
      confidence: hasTaleo ? OriginFillConfidence.HIGH : OriginFillConfidence.NONE
    };
  }

  // ─── Generic Portal Detection ─────────────────────────────────

  /**
   * Attempt generic detection on unknown sites.
   * Counts visible fields that look like job-application fields (with or without a <form>).
   *
   * @returns {{ type: string, confidence: string, pageName: string }}
   */
  function detectGeneric() {
    const none = { type: OriginFillPortals.NONE, confidence: OriginFillConfidence.NONE, pageName: '' };

    const inputs = Array.from(document.querySelectorAll(
      'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="search"]), select, textarea'
    )).filter(isVisible);
    if (inputs.length === 0) return none;

    // Job-application signals: the field types we know how to fill, plus résumé uploads
    let matchCount = 0;
    inputs.forEach(input => {
      if (input.type === 'file') {
        if (/\b(resume|résumé|cv)\b/i.test(`${getInputLabel(input)} ${input.name} ${input.id}`)) matchCount++;
        return;
      }
      if (OriginFillFieldMapper.detectFieldType(input).fieldType) matchCount++;
    });

    const matchRatio = matchCount / inputs.length;

    if (matchCount >= 3 && matchRatio >= 0.3) {
      return {
        type: OriginFillPortals.GENERIC,
        confidence: matchRatio >= 0.5 ? OriginFillConfidence.MEDIUM : OriginFillConfidence.LOW,
        pageName: 'Application Form'
      };
    }

    return none;
  }

  // ─── Utility ───────────────────────────────────────────────────

  /**
   * Get the visible label text for an input element.
   * @param {HTMLElement} input
   * @returns {string}
   */
  function getInputLabel(input) {
    const clean = (text) => (text || '')
      .replace(/\*/g, ' ')
      .replace(/\s+/g, ' ')
      .replace(/[\s:]+$/, '')
      .trim();

    // 1. Explicit <label for="...">
    if (input.id) {
      const label = document.querySelector(`label[for="${CSS.escape(input.id)}"]`);
      if (label && clean(label.textContent)) return clean(label.textContent);
    }

    // 2. aria-labelledby (may reference several elements)
    const ariaLabelledBy = input.getAttribute('aria-labelledby');
    if (ariaLabelledBy) {
      const text = ariaLabelledBy.split(/\s+/)
        .map(id => document.getElementById(id))
        .filter(el => el && el !== input)
        .map(el => el.textContent)
        .join(' ');
      if (clean(text)) return clean(text);
    }

    // 3. Parent <label>
    const parentLabel = input.closest('label');
    if (parentLabel) {
      // Clone and remove the input to get just the label text
      const clone = parentLabel.cloneNode(true);
      clone.querySelectorAll('input, select, textarea').forEach(el => el.remove());
      if (clean(clone.textContent)) return clean(clone.textContent);
    }

    // 4. aria-label
    const ariaLabel = input.getAttribute('aria-label');
    if (ariaLabel) return clean(ariaLabel);

    // 5. Previous sibling text
    const prevSibling = input.previousElementSibling;
    if (prevSibling && (prevSibling.tagName === 'LABEL' || prevSibling.tagName === 'SPAN')) {
      return clean(prevSibling.textContent);
    }

    // 6. Label of the surrounding field wrapper (Workday formField-*, generic .form-group)
    const wrapper = input.closest('[data-automation-id^="formField-"], .form-group, .field, .application-question');
    if (wrapper) {
      const label = wrapper.querySelector('label, legend');
      if (label && !label.contains(input) && clean(label.textContent)) return clean(label.textContent);
    }

    // 7. Text in the smallest container that holds only this input:
    //    <div class="control-group"><label>Legal First Name</label><div><input></div></div>
    const nearby = nearbyText(input, clean);
    if (nearby) return nearby;

    // 8. Placeholder
    return clean(input.placeholder || '');
  }

  const FORM_CONTROLS = 'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"]):not([type="image"]), select, textarea, [contenteditable="true"]';

  /** Text that can't be a label: dial codes, separators, required markers. */
  const NOT_A_LABEL = /^[\s\d+()\-–—.,:;*#/\\|]*$/;

  /**
   * Many forms (Yello, Rails/Bootstrap, tables) put the label next to the input without
   * linking them. Walk up while the container holds no other field and use its text.
   */
  function nearbyText(input, clean) {
    let node = input.parentElement;
    for (let depth = 0; node && node !== document.body && depth < 5; depth++) {
      const others = Array.from(node.querySelectorAll(FORM_CONTROLS)).filter(c =>
        c !== input && !(input.type === 'radio' && c.type === 'radio' && c.name === input.name));
      if (others.length > 0) break;

      const clone = node.cloneNode(true);
      clone.querySelectorAll(
        'input, select, textarea, button, option, script, style, [aria-hidden="true"], ' +
        '.iti__flag-container, .flag-container, .select2-container, .chosen-container, .selectize-control'
      ).forEach(el => el.remove());
      const text = clean(clone.textContent);
      if (text && !NOT_A_LABEL.test(text)) return text.slice(0, 200);

      node = node.parentElement;
    }
    return '';
  }

  /**
   * Check if an element is visible in the DOM.
   * @param {HTMLElement} el
   * @returns {boolean}
   */
  function isVisible(el) {
    return OriginFillDom.isVisible(el);
  }

  // ─── Master Detection Function ────────────────────────────────

  /**
   * Run full portal detection on the current page.
   * @returns {{ type: string, confidence: string, pageName: string, url: string }}
   */
  function detect() {
    const url = window.location.href;

    // 1. URL-based detection
    const urlResult = detectFromURL(url);

    if (urlResult) {
      // 2. DOM confirmation for known portals
      const domResult = confirmFromDOM(urlResult.type);

      const detection = {
        type: urlResult.type,
        confidence: domResult.confirmed
          ? OriginFillConfidence.HIGH
          : urlResult.confidence,
        pageName: domResult.pageName || 'Application Form',
        pageNumber: 1,
        totalPages: 1,
        url
      };

      if (urlResult.type === OriginFillPortals.WORKDAY) {
        Object.assign(detection, getWorkdayStep());
        detection.isApplication = isWorkdayApplication();
      }

      _lastDetection = detection;
      OriginFillLogger.info(
        `Portal detected: ${detection.type} (${detection.confidence})`,
        detection.pageName
      );

      return detection;
    }

    // 3. Generic detection for unknown portals
    const genericResult = detectGeneric();
    const detection = {
      type: genericResult.type,
      confidence: genericResult.confidence,
      pageName: genericResult.pageName,
      pageNumber: 1,
      totalPages: 1,
      url
    };

    _lastDetection = detection;

    if (detection.type !== OriginFillPortals.NONE) {
      OriginFillLogger.info(
        `Generic portal detected (${detection.confidence})`,
        detection.pageName
      );
    }

    return detection;
  }

  /**
   * Get the last detection result (cached).
   * @returns {{ type: string, confidence: string, pageName: string, url: string } | null}
   */
  function getLastDetection() {
    return _lastDetection;
  }

  /**
   * Get a display name for a portal type.
   * @param {string} type
   * @returns {string}
   */
  function getPortalDisplayName(type) {
    const names = {
      [OriginFillPortals.WORKDAY]: 'Workday',
      [OriginFillPortals.GREENHOUSE]: 'Greenhouse',
      [OriginFillPortals.LEVER]: 'Lever',
      [OriginFillPortals.ICIMS]: 'iCIMS',
      [OriginFillPortals.TALEO]: 'Taleo',
      [OriginFillPortals.GENERIC]: 'Generic Portal',
      [OriginFillPortals.NONE]: 'No Portal'
    };
    return names[type] || 'Unknown';
  }

  // ─── Public API ─────────────────────────────────────────────────
  return Object.freeze({
    detect,
    getLastDetection,
    getPortalDisplayName,
    getInputLabel,
    isVisible,

    // Exposed for on-demand generic detection via chrome.scripting
    detectGeneric,
    detectFromURL,
    confirmFromDOM,
    detectWorkdayPage,
    getWorkdayStep,
    isWorkdayApplication
  });
})();
