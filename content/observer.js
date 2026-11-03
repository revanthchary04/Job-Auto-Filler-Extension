/**
 * OriginFill — Multi-Page Form Observer
 * Watches for SPA navigation and new form sections appearing, e.g. Workday moving from
 * "My Information" to "My Experience" without a page load.
 *
 * Content scripts run in an isolated world, so wrapping history.pushState here would never see
 * the page's own calls. Instead every (debounced) DOM change re-checks the URL and current step.
 *
 * @license AGPL-3.0
 * @author CharyWorld
 */

var OriginFillObserver = (() => {
  'use strict';

  /** @type {MutationObserver|null} */
  let _observer = null;

  /** @type {number|null} Debounce timer ID */
  let _debounceTimer = null;

  /** @type {string} Key of the current page/step (URL + step name) */
  let _lastPageKey = '';

  /** @type {Object|null} Last page info sent out */
  let _lastPageInfo = null;

  /** @type {number} Last known form field count */
  let _lastFieldCount = 0;

  /** @type {boolean} Observer is active */
  let _active = false;

  /** @type {Set<string>} Pages already auto-filled */
  const _autoFilledPages = new Set();

  /** @type {Object} Stored options reference for dynamic updates */
  let _options = {
    onPageChange: () => {},
    onAutoFill: null,
    autoFillOnChange: false,
    profile: null,
    portalType: OriginFillPortals.GENERIC
  };

  // ─── Observer Setup ────────────────────────────────────────────

  /**
   * Start observing the page for multi-step form changes.
   *
   * @param {Object} [options]
   * @param {Function} [options.onPageChange] - Callback(pageInfo) when the page/step changes
   * @param {Function} [options.onAutoFill] - Callback(pageInfo) to fill a new page when auto-fill is on
   * @param {boolean} [options.autoFillOnChange] - Auto-fill new pages
   * @param {Object} [options.profile] - Active profile
   * @param {string} [options.portalType] - Detected portal type
   */
  function start(options = {}) {
    if (_active) {
      OriginFillLogger.debug('Observer already active');
      return;
    }

    _options = {
      onPageChange: options.onPageChange || (() => {}),
      onAutoFill: options.onAutoFill || null,
      autoFillOnChange: options.autoFillOnChange || false,
      profile: options.profile || null,
      portalType: options.portalType || OriginFillPortals.GENERIC
    };

    _observer = new MutationObserver(() => {
      if (_debounceTimer) clearTimeout(_debounceTimer);
      _debounceTimer = setTimeout(checkForPageChange, OriginFillTiming.OBSERVER_DEBOUNCE);
    });

    _observer.observe(document.body, {
      childList: true,
      subtree: true
    });

    window.addEventListener('popstate', checkForPageChange);
    window.addEventListener('hashchange', checkForPageChange);

    _active = true;
    OriginFillLogger.info('Multi-page observer started');

    checkForPageChange();
  }

  /**
   * Stop the observer and clean up.
   */
  function stop() {
    if (_observer) {
      _observer.disconnect();
      _observer = null;
    }

    if (_debounceTimer) {
      clearTimeout(_debounceTimer);
      _debounceTimer = null;
    }

    window.removeEventListener('popstate', checkForPageChange);
    window.removeEventListener('hashchange', checkForPageChange);

    _active = false;
    OriginFillLogger.info('Multi-page observer stopped');
  }

  // ─── Change Detection ──────────────────────────────────────────

  /**
   * Compare the current URL/step with the last one and react to changes.
   */
  function checkForPageChange() {
    const pageInfo = getPageInfo(_options.portalType);
    const pageKey = `${window.location.origin}${window.location.pathname}#${pageInfo.pageName}`;
    const fieldCountChanged = Math.abs(pageInfo.fieldCount - _lastFieldCount) >= 3;

    if (pageKey === _lastPageKey && !fieldCountChanged) return;

    const isNewPage = pageKey !== _lastPageKey;
    _lastPageKey = pageKey;
    _lastFieldCount = pageInfo.fieldCount;
    _lastPageInfo = pageInfo;

    if (isNewPage) {
      OriginFillLogger.info(`Page change detected: "${pageInfo.pageName}"`);
      sendMessage(OriginFillMessages.PAGE_CHANGED, pageInfo);
    }

    _options.onPageChange(pageInfo, { isNewPage });

    // Auto-fill once per page, after the fields have rendered
    if (_options.autoFillOnChange && _options.onAutoFill && pageInfo.fieldCount > 0 && !_autoFilledPages.has(pageKey)) {
      _autoFilledPages.add(pageKey);
      setTimeout(() => {
        if (!OriginFillFiller.isFilling()) _options.onAutoFill(pageInfo);
      }, 800);
    }
  }

  /**
   * Describe the current page.
   * @param {string} portalType
   * @returns {{ pageName: string, pageNumber: number, totalPages: number, fieldCount: number, url: string }}
   */
  function getPageInfo(portalType) {
    const step = portalType === OriginFillPortals.WORKDAY
      ? OriginFillDetector.getWorkdayStep()
      : { pageName: detectCurrentPage(portalType), pageNumber: 1, totalPages: 1 };

    return {
      ...step,
      fieldCount: countFormFields(),
      url: window.location.href
    };
  }

  // ─── Profile Update Propagation ────────────────────────────────

  /**
   * Update the profile used by the observer.
   * Called when the user switches active profile from the popup.
   *
   * @param {Object} newProfile - New active profile
   */
  function updateProfile(newProfile) {
    _options.profile = newProfile;
    OriginFillLogger.debug('Observer profile updated');
  }

  /**
   * Update the portal type (e.g., after re-detection).
   * @param {string} newPortalType
   */
  function updatePortalType(newPortalType) {
    _options.portalType = newPortalType;
    OriginFillLogger.debug(`Observer portal type updated: ${newPortalType}`);
  }

  /**
   * Update auto-fill settings.
   * @param {boolean} autoFill
   */
  function setAutoFillOnChange(autoFill) {
    _options.autoFillOnChange = autoFill;
  }

  // ─── Page Detection ────────────────────────────────────────────

  /**
   * Detect the current page/section name.
   *
   * @param {string} portalType
   * @returns {string}
   */
  function detectCurrentPage(portalType) {
    if (portalType === OriginFillPortals.WORKDAY) {
      return OriginFillDetector.getWorkdayStep().pageName;
    }

    // Generic: use heading text or URL
    const headings = document.querySelectorAll('h1, h2, h3');
    for (const h of headings) {
      if (OriginFillDetector.isVisible(h)) {
        const text = h.textContent.trim();
        if (text.length > 0 && text.length < 100) {
          return text;
        }
      }
    }

    // Use URL path as fallback
    const path = window.location.pathname;
    const lastSegment = path.split('/').filter(Boolean).pop() || '';
    return lastSegment.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) || 'Application Form';
  }

  /**
   * Get the current page number (for Workday step indicators).
   * @param {string} portalType
   * @returns {number}
   */
  function getPageNumber(portalType) {
    return portalType === OriginFillPortals.WORKDAY ? OriginFillDetector.getWorkdayStep().pageNumber : 1;
  }

  /**
   * Get the total number of pages.
   * @param {string} portalType
   * @returns {number}
   */
  function getTotalPages(portalType) {
    return portalType === OriginFillPortals.WORKDAY ? OriginFillDetector.getWorkdayStep().totalPages : 1;
  }

  /**
   * Count visible form fields on the page.
   * @returns {number}
   */
  function countFormFields() {
    const fields = document.querySelectorAll(
      'input:not([type="hidden"]):not([type="submit"]):not([type="button"]), select, textarea, button[aria-haspopup="listbox"], ' +
      '[data-automation-id="file-upload-drop-zone"]'
    );

    let count = 0;
    fields.forEach(f => {
      if (!f.closest('[data-originfill-ui]') && OriginFillDetector.isVisible(f)) count++;
    });
    return count;
  }

  /**
   * The last page info (for popup state queries).
   * @returns {Object|null}
   */
  function getLastPageInfo() {
    return _lastPageInfo || getPageInfo(_options.portalType);
  }

  /**
   * Check if the observer is currently active.
   * @returns {boolean}
   */
  function isActive() {
    return _active;
  }

  // ─── Utility ───────────────────────────────────────────────────

  /**
   * Send message to popup/background.
   * @param {string} type
   * @param {Object} data
   */
  function sendMessage(type, data) {
    try {
      chrome.runtime.sendMessage({ type, data }).catch(() => {});
    } catch (err) {
      OriginFillLogger.debug('Observer message failed:', err.message);
    }
  }

  // ─── Public API ─────────────────────────────────────────────────
  return Object.freeze({
    start,
    stop,
    isActive,
    detectCurrentPage,
    getPageNumber,
    getTotalPages,
    getPageInfo,
    getLastPageInfo,
    countFormFields,

    // Dynamic update methods
    updateProfile,
    updatePortalType,
    setAutoFillOnChange
  });
})();
