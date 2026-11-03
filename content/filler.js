/**
 * OriginFill — Core Auto-Fill Engine
 * Orchestrates form filling using portal-specific adapters.
 * Reports progress, handles retries, and generates fill reports.
 *
 * @license AGPL-3.0
 * @author CharyWorld
 */

var OriginFillFiller = (() => {
  'use strict';

  /** @type {boolean} Fill operation in progress */
  let _filling = false;

  /** @type {boolean} Cancel requested */
  let _cancelRequested = false;

  /** @type {Array} Fill results for current operation */
  let _currentResults = [];

  /** @type {HTMLElement[]} Field elements of the last report (same order as results) */
  let _resultElements = [];

  /** @type {Object|null} Last completed report */
  let _lastReport = null;

  /** @type {number} Fields seen in the last fill that OriginFill didn't recognise */
  let _unrecognized = 0;

  /** @type {number} Fill start timestamp */
  let _fillStartTime = 0;

  /** Input types never captured in recovery snapshots */
  const SNAPSHOT_EXCLUDED_TYPES = new Set(['hidden', 'password', 'file', 'submit', 'button', 'reset', 'image', 'search']);

  /** Extra passes after the first one, for fields that appear while filling */
  const MAX_EXTRA_PASSES = 2;

  // ─── Master Fill Function ──────────────────────────────────────

  /**
   * Fill all detected fields on the current page.
   *
   * @param {Object} profile - Active profile data
   * @param {string} portalType - Detected portal type
   * @param {Object} [options]
   * @param {string} [options.section='all'] - Section to fill (personal, education, workExperience, all)
   * @param {number} [options.fillDelay=150] - Delay between fields in ms
   * @param {boolean} [options.overwriteExisting=true] - Replace values already in fields
   * @param {Function} [options.onProgress] - Progress callback(current, total, fieldName)
   * @param {Function} [options.onComplete] - Completion callback(report)
   * @returns {Promise<Object>} Fill report
   */
  async function fillAll(profile, portalType, options = {}) {
    if (_filling) {
      OriginFillLogger.warn('Fill already in progress');
      return { error: 'Fill already in progress' };
    }

    _filling = true;
    _cancelRequested = false;
    _unrecognized = 0;
    _currentResults = [];
    _resultElements = [];
    _fillStartTime = performance.now();

    const section = options.section || OriginFillSections.ALL;
    const fillDelay = options.fillDelay ?? OriginFillTiming.FILL_DELAY_DEFAULT;
    const overwrite = options.overwriteExisting !== false;
    const onProgress = options.onProgress || (() => {});
    const onComplete = options.onComplete || (() => {});
    const adapter = getAdapter(portalType);

    OriginFillLogger.time('Fill operation');
    OriginFillLogger.info(`Starting fill: portal=${portalType}, section=${section}`);

    // Notify popup that fill has started
    sendMessage(OriginFillMessages.FILL_PROGRESS, {
      phase: 'started',
      current: 0,
      total: 0,
      section
    });

    try {
      // Workday shows no Work Experience / Education entries until "Add" is clicked
      if (portalType === OriginFillPortals.WORKDAY) {
        const sections = sectionsToPrepare(section);
        if (sections.length) {
          onProgress(0, 0, 'Adding work & education entries');
          await OriginFillWorkday.prepareSections(profile, { sections });
        }
      }

      let fields = await waitForFillableFields(adapter, section, profile);

      if (fields.length === 0) {
        OriginFillLogger.warn('No fillable fields found after wait');

        // Log "Detected Fields" diagnostic snapshot in debug mode
        if (OriginFillLogger.isEnabled()) logDiagnosticSnapshot();

        const errorReport = {
          success: false,
          status: 'no_fields',
          portalType,
          portalName: OriginFillDetector.getPortalDisplayName(portalType),
          totalFields: 0,
          successCount: 0,
          attentionCount: 0,
          failedCount: 0,
          skippedCount: 0,
          results: [],
          error: 'No fillable fields were detected on the current application page.'
        };

        _lastReport = errorReport;
        onComplete(errorReport);
        sendMessage(OriginFillMessages.FILL_ERROR, errorReport);
        return errorReport;
      }

      const handled = new Set();
      let processed = 0;

      for (let pass = 0; pass <= MAX_EXTRA_PASSES && fields.length > 0; pass++) {
        const total = processed + fields.length;

        for (const field of fields) {
          if (_cancelRequested) break;
          handled.add(field.element);

          const label = field.label || field.automationId || field.fieldType || 'field';
          processed++;
          onProgress(processed, total, label);
          sendMessage(OriginFillMessages.FILL_PROGRESS, {
            phase: 'filling',
            current: processed,
            total,
            fieldName: label,
            section
          });

          const outcome = await processField(field, profile, { adapter, overwrite });
          if (!outcome) { // Nothing worth reporting
            _unrecognized++;
            continue;
          }

          const { followUp, ...result } = outcome;
          recordResult(result, field.element, field);
          // The "Please specify" box filled after picking "Other" gets its own row
          if (followUp) {
            handled.add(followUp.element);
            recordResult(followUp.row, followUp.element, field);
          }

          if (result.status === OriginFillStatus.SUCCESS && result.changed && fillDelay > 0) {
            await delay(fillDelay);
          }
        }

        if (_cancelRequested) {
          OriginFillLogger.warn('Fill cancelled by user');
          break;
        }

        // Filling can reveal new fields: picking a Country rebuilds the address block,
        // answering "Yes" opens follow-up questions.
        await delay(300);
        fields = filterBySection(adapter.getFields({ profile }), section)
          .filter(f => !handled.has(f.element) && f.element.isConnected);
      }

      // Generate report
      const report = generateReport(_currentResults, portalType);
      report.cancelled = _cancelRequested;

      OriginFillLogger.timeEnd('Fill operation');
      OriginFillLogger.fillReport(_currentResults);

      _lastReport = report;
      _filling = false;
      onComplete(report);
      sendMessage(OriginFillMessages.FILL_COMPLETE, report);

      // Update stats (≈20 seconds saved per field filled)
      sendMessage(OriginFillMessages.STATS_UPDATED, {
        totalFills: 1,
        totalFieldsFilled: report.successCount + report.attentionCount,
        totalTimeSavedMinutes: Math.max(1, Math.round((report.successCount + report.attentionCount) / 3)),
        portal: portalType,
        fillSuccessRate: report.successRate
      });

      return report;

    } catch (err) {
      OriginFillLogger.error('Fill operation failed:', err);
      _filling = false;

      const errorReport = {
        ...generateReport(_currentResults, portalType),
        success: false,
        error: err.message
      };

      _lastReport = errorReport;
      sendMessage(OriginFillMessages.FILL_ERROR, errorReport);
      onComplete(errorReport);

      return errorReport;

    } finally {
      _filling = false;
    }
  }

  function getAdapter(portalType) {
    return portalType === OriginFillPortals.WORKDAY ? OriginFillWorkday : OriginFillGeneric;
  }

  /**
   * Add a report row. A field re-rendered between passes (e.g. the address block after picking
   * a Country) keeps a single row in the report: the latest one.
   */
  function recordResult(result, element, field) {
    const key = `${result.field}|${field.section || ''}|${field.index ?? ''}`;
    const existing = _currentResults.findIndex(r => r.key === key);
    if (existing >= 0) {
      _currentResults[existing] = { ...result, key };
      _resultElements[existing] = element;
    } else {
      _currentResults.push({ ...result, key });
      _resultElements.push(element);
    }
  }

  function sectionsToPrepare(section) {
    switch (section) {
      case OriginFillSections.ALL: return ['work', 'education', 'website'];
      case OriginFillSections.WORK_EXPERIENCE: return ['work'];
      case OriginFillSections.EDUCATION: return ['education'];
      case OriginFillSections.PERSONAL: return ['website'];
      default: return [];
    }
  }

  // ─── Single Field ──────────────────────────────────────────────

  /**
   * Decide what to do with one field and do it.
   * @returns {Promise<Object|null>} Result row for the report, or null to leave it out
   */
  async function processField(field, profile, { adapter, overwrite }) {
    const label = field.label || field.automationId || field.fieldType || 'Field';
    const row = (status, value, note, extra = {}) => ({
      field: label,
      fieldType: field.fieldType || 'question',
      status,
      value,
      note,
      ...extra
    });

    if (field.ignore || !field.element || !field.element.isConnected) return null;

    // ─── Résumé upload ───
    if (field.fieldType === 'resume' || field.control === 'file') {
      const upload = await handleResumeUpload(field, profile, adapter);
      let status = OriginFillStatus.SUCCESS;
      if (!upload.fileName) status = OriginFillStatus.SKIPPED;          // Nothing saved to upload
      else if (!upload.success || upload.note) status = OriginFillStatus.ATTENTION;
      return row(status, upload.fileName || '—', upload.note, { changed: upload.success });
    }

    // ─── What does the user want here? ───
    // 1. A Saved Answer the user wrote for this question  2. A Common Question they answered
    // 3. Profile data. Sensitive questions are only ever answered from 1 or 2.
    const saved = OriginFillFieldMapper.findSavedAnswer(profile, label);
    const common = OriginFillFAQ.find(profile, label, field.contextText);
    const sensitive = OriginFillFieldMapper.isSensitiveText(
      `${label} | ${OriginFillFieldMapper.hintToWords(field.automationId || '')}`,
      { isTextarea: field.control === 'textarea' }
    );
    const isQuestion = sensitive.isSensitive || !field.fieldType;

    let value;
    let candidates = null;
    let answerNote = '';

    if (saved && isQuestion) {
      value = saved.answer;
      answerNote = 'From your saved answers';
    } else if (common && common.answer && isQuestion) {
      value = common.answer;
      candidates = common.candidates;
      answerNote = common.derived ? 'Worked out from your profile — please check' : 'From your common answers';
    } else if (common && isQuestion) {
      if (common.short) {
        return field.required ? row(OriginFillStatus.SKIPPED, '—', 'Add more preferred locations in Settings → Common Questions') : null;
      }
      return row(OriginFillStatus.SKIPPED, '—', `Answer "${common.entry.question}" once in Settings → Common Questions`, { faq: faqPrompt(common.entry) });
    } else if (sensitive.isSensitive) {
      return row(OriginFillStatus.SKIPPED, '—', sensitive.reason);
    } else if (!field.fieldType) {
      // An unrecognised question: only worth reporting when the page requires an answer
      return field.required
        ? row(OriginFillStatus.SKIPPED, '—', 'Not in your profile — answer it yourself (or add a Saved Answer)')
        : null;
    } else {
      value = OriginFillFieldMapper.resolveFieldValue(profile, field.fieldType, field.index);
      if (isEmpty(value) && saved) {
        value = saved.answer;
        answerNote = 'From your saved answers';
      } else if (isEmpty(value) && common && common.answer) {
        value = common.answer;
        candidates = common.candidates;
        answerNote = 'From your common answers';
      }
    }

    if (isEmpty(value)) {
      // Unchecked "I currently work here" with no current job is simply correct
      if (field.fieldType === 'isCurrent') return null;
      return field.required || field.source === 'workday-exact'
        ? row(OriginFillStatus.SKIPPED, '—', missingValueNote(profile, field))
        : null;
    }

    // ─── Already filled? ───
    const existing = typeof adapter.readValue === 'function' ? adapter.readValue(field) : null;
    if (field.control === 'checkbox') {
      if (existing === toBoolean(value)) return row(OriginFillStatus.SUCCESS, maskSensitiveValue(value, field.fieldType), 'Already set');
    } else if (!isEmpty(existing)) {
      if (valueMatches(existing, value, field) || (candidates && candidates.some(c => valueMatches(existing, c, field)))) {
        return row(OriginFillStatus.SUCCESS, maskSensitiveValue(value, field.fieldType), 'Already filled');
      }
      if (!overwrite) {
        return row(OriginFillStatus.SKIPPED, maskSensitiveValue(existing, field.fieldType), 'Kept the value already in the field');
      }
    }

    // ─── Fill (one retry) ───
    // A college or course the list lacks gets "Other"; note the text boxes on show first, so the
    // "Please specify" box that picking it reveals can be told apart
    const boxesBefore = OriginFillFieldMapper.allowsOtherOption(field.fieldType) ? visibleTextBoxes() : null;
    let result = await adapter.fillField(field, value, { profile, candidates });
    if (!result.success && field.element.isConnected) {
      await delay(OriginFillTiming.FIELD_RETRY_DELAY);
      result = await adapter.fillField(field, value, { profile, candidates });
    }

    // The user's own answers are exact; only label-guessed fields, fuzzy option picks and
    // worked-out answers need a second look
    const fromAnswers = !!answerNote;
    const guessedField = !fromAnswers &&
      OriginFillFieldMapper.getConfidenceScore(field.confidence || 'high') < OriginFillConfidenceThresholds.AUTO_FILL;
    const notes = [result.note, answerNote];
    if (result.success && guessedField) notes.push('Matched by label — please verify');

    // A worked-out answer the form doesn't offer (your city isn't one of its offices): ask
    // instead of reporting a failure
    if (!result.success && common && common.derived && /^Worked out/.test(answerNote)) {
      return row(OriginFillStatus.SKIPPED, '—', `Answer "${common.entry.question}" once in Settings → Common Questions`, { faq: faqPrompt(common.entry) });
    }

    let status = result.success ? OriginFillStatus.SUCCESS : OriginFillStatus.FAILED;
    if (result.success && (result.note || guessedField || /please check/.test(answerNote))) {
      status = OriginFillStatus.ATTENTION;
    }

    // "Other" usually comes with a box for the real answer ("Enter your college name")
    const followUp = result.success && result.usedOther ? await fillSpecifyBox(field, value, boxesBefore) : null;

    // What the field looks like (no values), for "Copy details" when it didn't work
    const debug = status === OriginFillStatus.FAILED || /no suggestions/i.test(result.note || '')
      ? (result.debug || OriginFillDom.sketch(field.wrapper || field.element.parentElement, 3))
      : undefined;

    return row(status, maskSensitiveValue(value, field.fieldType), notes.filter(Boolean).join('; '), { changed: result.success, followUp, debug });
  }

  /** What the report needs to let the person answer a common question on the spot. */
  function faqPrompt(entry) {
    return {
      id: entry.id,
      question: entry.question,
      choices: entry.choices ? Object.keys(entry.choices) : null,
      placeholder: entry.placeholder || ''
    };
  }

  /**
   * Fill some fields again, e.g. after their question was answered in the report, and update
   * their rows in the last report.
   * @param {HTMLElement[]} elements - Elements of rows in the last report
   * @param {Object} profile
   * @param {string} portalType
   * @returns {Promise<Object|null>} The updated report
   */
  async function refillFields(elements, profile, portalType) {
    if (_filling || !_lastReport) return null;
    const adapter = getAdapter(portalType);
    const fields = adapter.getFields({ profile });
    _filling = true;
    try {
      for (const element of elements) {
        const index = _resultElements.indexOf(element);
        const field = fields.find(f => f.element === element || (f.controls || []).includes(element));
        if (index < 0 || !field) continue;
        const outcome = await processField(field, profile, { adapter, overwrite: true });
        if (!outcome) continue;
        const { followUp, ...result } = outcome;
        _currentResults[index] = { ...result, key: _currentResults[index].key };
        if (followUp) recordResult(followUp.row, followUp.element, field);
      }
      const { elapsed, elapsedFormatted } = _lastReport;
      _lastReport = { ...generateReport(_currentResults, portalType), elapsed, elapsedFormatted };
      sendMessage(OriginFillMessages.FILL_COMPLETE, _lastReport);
      return _lastReport;
    } finally {
      _filling = false;
    }
  }

  // ─── "Other" → "Please specify" ────────────────────────────────

  const TEXT_BOX = 'input:not([type]), input[type="text"], input[type="search"], textarea';
  const FORM_CONTROL = 'input:not([type="hidden"]), select, textarea, button[aria-haspopup]';
  // Search boxes inside open dropdowns (Select2, Chosen, Workday) are never the answer box
  const POPUP_PARTS = '.select2-dropdown, .select2-search, .chosen-drop, [data-automation-widget="wd-popup"], [role="listbox"]';
  const SPECIFY_LABEL = /\b(specify|others?|not\s+(listed|found|in\s+(the\s+)?list)|unlisted|enter\s+(your\s+|the\s+)?(college|school|university|institut\w*|course|degree|branch|major|stream|field|specialization|source)|name\s+of\s+(your\s+|the\s+)?(college|school|university|institut\w*))\b/i;

  function visibleTextBoxes() {
    return new Set(Array.from(document.querySelectorAll(TEXT_BOX))
      .filter(box => OriginFillDom.isVisible(box) && !box.disabled && !box.readOnly));
  }

  /**
   * The box a form shows for the real answer after "Other" is picked. It is one of the next two
   * controls after the list, and it just appeared (or became editable) or its label says so
   * ("Please specify", "Enter your college name").
   * @param {Object} field - The list that was set to "Other"
   * @param {Set<HTMLElement>|null} before - Text boxes on show before the pick
   * @param {boolean} newOnly - Only accept a box that wasn't there before
   */
  function findSpecifyBox(field, before, newOnly) {
    const anchor = field.element;
    const controls = Array.from(document.querySelectorAll(FORM_CONTROL)).filter(el => el === anchor ||
      (OriginFillDom.isVisible(el) && !(field.wrapper && field.wrapper.contains(el)) && !el.closest(POPUP_PARTS)));
    const start = controls.indexOf(anchor);
    if (start < 0) return null;

    const next = controls.slice(start + 1, start + 3)
      .filter(el => el.matches(TEXT_BOX) && !el.disabled && !el.readOnly);
    const isNew = (box) => !!before && !before.has(box);
    const saysSo = (box) => SPECIFY_LABEL.test(`${OriginFillDetector.getInputLabel(box) || ''} ${box.placeholder || ''}`);
    return next.find(box => isNew(box) && saysSo(box)) || next.find(isNew) ||
      (newOnly ? null : next.find(saysSo)) || null;
  }

  /**
   * Type the real answer into the box a form shows after "Other" is picked.
   * @returns {Promise<{ row: Object, element: HTMLElement }|null>}
   */
  async function fillSpecifyBox(field, value, before) {
    const text = Array.isArray(value) ? value.filter(Boolean).join(', ') : String(value);
    // Give the form a moment to reveal it; a box that was always there counts after that
    const box = await OriginFillDom.waitFor(() => findSpecifyBox(field, before, true), { timeout: 1200, interval: 100 }) ||
      findSpecifyBox(field, before, false);
    if (!box) return null;

    const row = (status, note, changed = false) => ({
      field: OriginFillDetector.getInputLabel(box) || box.placeholder || 'Please specify',
      fieldType: `${field.fieldType}Other`,
      status,
      value: text,
      note,
      changed
    });

    if (box.value) {
      return {
        element: box,
        row: OriginFillFuzzyMatch.isSameText(box.value, text)
          ? row(OriginFillStatus.SUCCESS, 'Already filled')
          : row(OriginFillStatus.SKIPPED, 'Kept the value already in the field')
      };
    }

    const typed = await OriginFillDom.fillText(box, text);
    return {
      element: box,
      row: typed.success
        ? row(OriginFillStatus.SUCCESS, `Typed here because "${field.label || 'the list'}" is set to Other`, true)
        : row(OriginFillStatus.FAILED, typed.note || 'Could not type here')
    };
  }

  /**
   * Why a field has nothing to fill, in words that say what to do about it.
   */
  function missingValueNote(profile, field) {
    if (field.fieldType === 'referralSource') return 'Set "How did you hear about us?" once in Settings → Application Answers';
    const section = OriginFillFieldMapper.SECTION_OF_FIELD[field.fieldType];
    if (section === 'work' || section === 'education') {
      const isWork = section === 'work';
      const entries = isWork ? OriginFillFieldMapper.getWorkEntries(profile) : OriginFillFieldMapper.getEducationEntries(profile);
      const place = isWork ? 'Work Experience' : 'Education';
      if (entries.length === 0) {
        return `Your profile has no ${isWork ? 'work experience' : 'education'} — add it in Settings → ${place}`;
      }
      if ((field.index || 0) >= entries.length) {
        const noun = isWork ? (entries.length === 1 ? 'job' : 'jobs') : (entries.length === 1 ? 'school' : 'schools');
        return `Your profile has ${entries.length} ${noun}; this is entry ${(field.index || 0) + 1}`;
      }
      if (field.fieldType === 'eduEndMonth') return 'Add the month to End Year in Settings → Education (e.g. 05/2026)';
      return `Not set for this ${isWork ? 'job' : 'school'} in Settings → ${place}`;
    }
    return 'No value in your profile';
  }

  /**
   * Whether the value already in a field is what the profile would put there.
   */
  function valueMatches(existing, desired, field) {
    const haveItems = Array.isArray(existing) ? existing.map(String) : String(existing).split(/\s*,\s*/);
    if (Array.isArray(desired)) {
      return desired.every(d => haveItems.some(h => OriginFillFuzzyMatch.isSameText(h, String(d))));
    }
    if (Array.isArray(existing)) {
      const candidates = OriginFillFieldMapper.getValueAliases(field.fieldType, desired);
      return haveItems.some(h => candidates.some(c => OriginFillFuzzyMatch.isSameText(h, String(c))));
    }

    const have = String(existing).trim();
    if (field.control === 'date' || /StartDate|EndDate|Year$/.test(field.fieldType || '')) {
      const a = OriginFillFieldMapper.parseDate(have);
      const b = OriginFillFieldMapper.parseDate(desired);
      if (a && b && !a.current && !b.current) {
        return a.year === b.year && (!a.month || !b.month || a.month === b.month);
      }
    }
    if (field.fieldType === 'phone') {
      const digits = (s) => String(s).replace(/\D/g, '');
      return digits(desired).endsWith(digits(have)) && digits(have).length >= 7;
    }

    const candidates = OriginFillFieldMapper.getValueAliases(field.fieldType, desired);
    return candidates.some(c => OriginFillFuzzyMatch.isSameText(have, String(c)));
  }

  function isEmpty(value) {
    return value === undefined || value === null || value === '' ||
      (Array.isArray(value) && value.filter(v => v !== undefined && v !== null && String(v).trim()).length === 0);
  }

  function toBoolean(value) {
    if (typeof value === 'boolean') return value;
    return /^(true|yes|y|1|checked)$/i.test(String(value).trim());
  }

  // ─── Field Discovery by Portal ─────────────────────────────────

  /**
   * Get fillable fields based on portal type and section filter.
   *
   * @param {string} portalType
   * @param {string} section
   * @returns {Array<Object>}
   */
  function getFieldsForPortal(portalType, section) {
    return filterBySection(getAdapter(portalType).getFields(), section);
  }

  function filterBySection(fields, section) {
    if (section === OriginFillSections.ALL) return fields;

    return fields.filter(f => {
      const path = f.profilePath || '';
      switch (section) {
        case OriginFillSections.PERSONAL:
          return path.startsWith('personal.') || path.startsWith('application.');
        case OriginFillSections.EDUCATION:
          return path.startsWith('education');
        case OriginFillSections.WORK_EXPERIENCE:
          return path.startsWith('workExperience');
        case OriginFillSections.RESUME:
          return path === 'resume';
        case OriginFillSections.SKILLS:
          return path === 'skills';
        default:
          return true;
      }
    });
  }

  /**
   * Wait for fillable fields to appear, with bounded retries.
   * Helps with SPAs and asynchronous form loading.
   */
  async function waitForFillableFields(adapter, section, profile) {
    const retryDelays = [0, 300, 700, 1500];

    for (const waitTime of retryDelays) {
      if (waitTime > 0) await delay(waitTime);

      const fields = filterBySection(adapter.getFields({ profile }), section)
        .filter(f => !f.ignore && (f.fieldType || f.required));
      if (fields.length > 0) return fields;
    }

    return [];
  }

  /**
   * Log a diagnostic snapshot of inputs when no fields are found.
   */
  function logDiagnosticSnapshot() {
    const inputs = document.querySelectorAll('input:not([type="hidden"]):not([type="submit"]):not([type="button"]), select, textarea');
    OriginFillLogger.debug(`\n--- DIAGNOSTIC SNAPSHOT ---`);
    OriginFillLogger.debug(`Inputs found: ${inputs.length}`);

    Array.from(inputs).slice(0, 10).forEach((input, idx) => {
      OriginFillLogger.debug(`
${idx + 1}. tag=${input.tagName}
   type=${input.type || 'N/A'}
   name=${input.name || 'N/A'}
   id=${input.id || 'N/A'}
   automationId=${input.getAttribute('data-automation-id') || 'N/A'}
   label=${OriginFillDetector.getInputLabel(input) || 'N/A'}`);
    });
    OriginFillLogger.debug(`---------------------------\n`);
  }

  // ─── Resume Upload ─────────────────────────────────────────────

  /**
   * Fetch the résumé from the extension (it lives in the extension's IndexedDB, which the
   * job site can't reach) and attach it.
   *
   * @returns {Promise<{ success: boolean, note: string, fileName: string }>}
   */
  async function handleResumeUpload(field, profile, adapter) {
    try {
      const response = await chrome.runtime.sendMessage({
        type: OriginFillMessages.GET_RESUME,
        data: { profileId: profile.id, resumeId: profile.resume?.defaultId || '' }
      });

      if (!response || !response.resume) {
        return {
          success: false,
          note: response?.error || 'No résumé saved — add one in Settings → Resume',
          fileName: ''
        };
      }

      const file = OriginFillDom.base64ToFile(response.resume);
      const result = await adapter.uploadFile(field, file);
      return { success: result.success, note: result.note, fileName: response.resume.fileName };

    } catch (err) {
      OriginFillLogger.error('Resume upload failed:', err);
      return { success: false, note: `Résumé upload failed: ${err.message}`, fileName: '' };
    }
  }

  // ─── Fill Report ───────────────────────────────────────────────

  /**
   * Generate a fill report from results.
   *
   * @param {Array<{ field: string, status: string, value: string, note: string }>} results
   * @param {string} portalType
   * @returns {Object}
   */
  function generateReport(results, portalType) {
    const elapsed = performance.now() - _fillStartTime;
    const clean = results.map(({ changed, key, ...rest }) => rest);

    const successCount = clean.filter(r => r.status === OriginFillStatus.SUCCESS).length;
    const attentionCount = clean.filter(r => r.status === OriginFillStatus.ATTENTION).length;
    const failedCount = clean.filter(r => r.status === OriginFillStatus.FAILED).length;
    const skippedCount = clean.filter(r => r.status === OriginFillStatus.SKIPPED).length;

    const successRate = (successCount + attentionCount + failedCount) > 0
      ? Math.round(((successCount + attentionCount) / (successCount + attentionCount + failedCount)) * 100)
      : 0;

    return {
      success: failedCount === 0 && (successCount + attentionCount) > 0,
      portalType,
      portalName: OriginFillDetector.getPortalDisplayName(portalType),
      pageName: OriginFillDetector.getLastDetection()?.pageName || '',
      url: window.location.href,
      timestamp: new Date().toISOString(),
      elapsed: Math.round(elapsed),
      elapsedFormatted: formatDuration(elapsed),
      detectedFields: clean.length,
      attemptedFields: successCount + attentionCount + failedCount,
      totalFields: clean.length,
      successCount,
      attentionCount,
      failedCount,
      skippedCount,
      unrecognizedCount: _unrecognized,
      successRate,
      results: clean,
      successResults: clean.filter(r => r.status === OriginFillStatus.SUCCESS),
      attentionResults: clean.filter(r => r.status === OriginFillStatus.ATTENTION),
      failedResults: clean.filter(r => r.status === OriginFillStatus.FAILED),
      skippedResults: clean.filter(r => r.status === OriginFillStatus.SKIPPED)
    };
  }

  // ─── Session Snapshot ──────────────────────────────────────────

  /**
   * A key for an input that survives page reloads. Workday's ids ("input-6") are regenerated
   * on every render, so those are ignored in favour of automation ids, names and labels.
   */
  function stableKey(input) {
    const automationId = input.getAttribute('data-automation-id');
    if (automationId && !/^(searchBox|textInputBox|dateSection\w*)$/.test(automationId)) return `aid:${automationId}`;
    if (input.name && !/^\d+$|^input-\d+$/.test(input.name)) return `name:${input.name}`;
    if (input.id && !/^input-\d+$|^\d+$|[0-9a-f]{16,}/i.test(input.id)) return `id:${input.id}`;
    return '';
  }

  function snapshotInputs() {
    return Array.from(document.querySelectorAll('input, select, textarea')).filter(input => {
      if (SNAPSHOT_EXCLUDED_TYPES.has((input.type || '').toLowerCase())) return false;
      if (/^(cc-|one-time-code|current-password|new-password)/.test(input.getAttribute('autocomplete') || '')) return false;
      return !input.closest('[data-originfill-ui]');
    });
  }

  function labelKey(input) {
    return OriginFillFuzzyMatch.normalize(OriginFillDetector.getInputLabel(input)).slice(0, 80);
  }

  /**
   * Capture a snapshot of all currently filled fields on the page.
   * Used for session recovery on field blur. Passwords, files and payment fields are never captured.
   *
   * @returns {Object} Snapshot of field values
   */
  function captureFieldSnapshot() {
    const snapshot = {};
    const occurrences = {};

    snapshotInputs().forEach(input => {
      const isToggle = input.type === 'checkbox' || input.type === 'radio';
      const value = isToggle ? input.checked : input.value;
      if (!value) return;

      const label = OriginFillDetector.getInputLabel(input);
      const base = stableKey(input) || `label:${labelKey(input)}:${input.type || input.tagName.toLowerCase()}`;
      const occurrence = (occurrences[base] || 0) + 1;
      occurrences[base] = occurrence;

      snapshot[occurrence > 1 ? `${base}#${occurrence}` : base] = {
        value,
        type: input.type || input.tagName.toLowerCase(),
        label,
        base,
        occurrence,
        optionValue: input.type === 'radio' ? input.value : undefined
      };
    });

    return snapshot;
  }

  /**
   * Find the input a snapshot entry came from.
   */
  function findSnapshotTarget(entry, inputs) {
    const base = entry.base || '';
    let matches;

    if (base.startsWith('aid:')) {
      matches = inputs.filter(i => i.getAttribute('data-automation-id') === base.slice(4));
    } else if (base.startsWith('name:')) {
      matches = inputs.filter(i => i.name === base.slice(5));
    } else if (base.startsWith('id:')) {
      matches = inputs.filter(i => i.id === base.slice(3));
    } else {
      const wanted = OriginFillFuzzyMatch.normalize(entry.label).slice(0, 80);
      matches = inputs.filter(i => (i.type || i.tagName.toLowerCase()) === entry.type && labelKey(i) === wanted);
    }

    if (entry.type === 'radio') {
      return matches.find(i => i.value === entry.optionValue) || null;
    }
    return matches[(entry.occurrence || 1) - 1] || null;
  }

  /**
   * How many snapshot entries have a matching field on the current page.
   * @param {Object} snapshot
   * @returns {number}
   */
  function countRestorable(snapshot) {
    const inputs = snapshotInputs();
    return Object.values(snapshot || {}).filter(entry => {
      const element = findSnapshotTarget(entry, inputs);
      return element && OriginFillDetector.isVisible(element) && needsRestore(entry, element);
    }).length;
  }

  /** Whether the field on the page no longer holds the saved value. */
  function needsRestore(entry, element) {
    if (element.type === 'checkbox' || element.type === 'radio') return element.checked !== !!entry.value;
    return (element.value || '') !== String(entry.value ?? '');
  }

  /**
   * Restore fields from a session snapshot.
   *
   * @param {Object} snapshot - Field snapshot from captureFieldSnapshot()
   * @param {string} portalType - Detected portal type
   * @returns {Promise<Object>} Detailed restore report
   */
  async function restoreFromSnapshot(snapshot, portalType) {
    if (!snapshot || Object.keys(snapshot).length === 0) {
      return { success: false, restored: 0, failed: 0, skipped: 0, total: 0, results: [] };
    }
    if (_filling) {
      return { success: false, busy: true, restored: 0, failed: 0, skipped: 0, total: 0, results: [] };
    }

    _filling = true;
    try {
      return await restoreEntries(snapshot, portalType);
    } finally {
      _filling = false;
    }
  }

  async function restoreEntries(snapshot, portalType) {
    const entries = Object.entries(snapshot);
    const total = entries.length;
    const inputs = snapshotInputs();
    let restored = 0;
    let failed = 0;
    const results = [];

    OriginFillLogger.info(`Starting restore of ${total} fields on ${portalType}`);

    for (let i = 0; i < total; i++) {
      const [key, entry] = entries[i];
      const label = entry.label || key;
      let note = '';
      let ok = false;

      sendMessage(OriginFillMessages.FILL_PROGRESS, {
        phase: 'restore',
        current: i + 1,
        total,
        fieldName: label,
        section: 'recovery'
      });

      try {
        const element = findSnapshotTarget(entry, inputs);

        if (!element || !OriginFillDetector.isVisible(element)) {
          note = 'Field not found on this page';
        } else if (!needsRestore(entry, element)) {
          ok = true; // Already holds the saved value
        } else if (element.type === 'checkbox') {
          ok = (await OriginFillDom.setCheckbox(element, !!entry.value)).success;
        } else if (element.type === 'radio') {
          if (!element.checked) element.click();
          ok = element.checked;
        } else if (element.tagName === 'SELECT') {
          const option = Array.from(element.options).find(o => o.value === entry.value);
          ok = option ? (await OriginFillDom.selectNativeOption(element, option.textContent.trim())).success : false;
        } else {
          const result = await OriginFillDom.fillText(element, entry.value);
          ok = result.success;
          note = result.note;
        }
      } catch (err) {
        note = err.message;
        OriginFillLogger.debug(`Restore failed for ${key}:`, err.message);
      }

      if (ok) restored++;
      else failed++;

      results.push({
        field: label,
        fieldType: entry.type,
        status: ok ? OriginFillStatus.SUCCESS : OriginFillStatus.FAILED,
        value: maskSensitiveValue(entry.value, entry.type),
        note: ok ? '' : (note || 'Could not restore')
      });

      await delay(30);
    }

    OriginFillLogger.info(`Snapshot restored: ${restored} success, ${failed} failed`);
    return {
      success: restored > 0,
      partial: failed > 0,
      restored,
      failed,
      skipped: 0,
      total,
      results
    };
  }

  // ─── Control ───────────────────────────────────────────────────

  /**
   * Cancel the current fill operation.
   */
  function cancel() {
    if (_filling) {
      _cancelRequested = true;
      OriginFillLogger.warn('Fill cancel requested');
    }
  }

  /**
   * Check if a fill operation is currently in progress.
   * @returns {boolean}
   */
  function isFilling() {
    return _filling;
  }

  /**
   * Get the current fill results (live during fill).
   * @returns {Array}
   */
  function getCurrentResults() {
    return [..._currentResults];
  }

  /**
   * The last report and the elements of its rows (for "show me this field").
   * @returns {{ report: Object|null, elements: HTMLElement[] }}
   */
  function getLastReport() {
    return { report: _lastReport, elements: [..._resultElements] };
  }

  // ─── Utilities ─────────────────────────────────────────────────

  /**
   * Mask sensitive values for display in reports.
   * @param {any} value
   * @param {string} fieldType
   * @returns {string}
   */
  function maskSensitiveValue(value, fieldType) {
    if (value === true) return 'Yes';
    if (value === false) return 'No';
    if (!value) return '—';
    const str = Array.isArray(value) ? value.join(', ') : String(value);

    // Mask email: show first 2 chars + domain
    if ((fieldType === 'email' || fieldType === 'text') && str.includes('@')) {
      const [local, domain] = str.split('@');
      return local.slice(0, 2) + '***@' + domain;
    }

    // Mask phone: show last 4 digits
    if (fieldType === 'phone' || fieldType === 'tel') {
      return '***' + str.slice(-4);
    }

    // Truncate long values
    if (str.length > 40) {
      return str.slice(0, 37) + '...';
    }

    return str;
  }

  /**
   * Format duration in ms to human-readable string.
   * @param {number} ms
   * @returns {string}
   */
  function formatDuration(ms) {
    if (ms < 1000) return `${Math.round(ms)}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  }

  /**
   * Simple delay helper.
   * @param {number} ms
   * @returns {Promise<void>}
   */
  function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Send a message to the background/popup.
   * @param {string} type - Message type
   * @param {Object} data - Message data
   */
  function sendMessage(type, data) {
    try {
      // Nobody may be listening (popup closed) — that's fine
      chrome.runtime.sendMessage({ type, data }).catch(() => {});
    } catch (err) {
      // Extension context may be invalidated
      OriginFillLogger.debug('Message send failed:', err.message);
    }
  }

  // ─── Public API ─────────────────────────────────────────────────
  return Object.freeze({
    fillAll,
    cancel,
    isFilling,
    getCurrentResults,
    getLastReport,
    refillFields,
    captureFieldSnapshot,
    countRestorable,
    restoreFromSnapshot,
    generateReport,
    getFieldsForPortal,
    maskSensitiveValue,
    formatDuration,
    valueMatches
  });
})();
