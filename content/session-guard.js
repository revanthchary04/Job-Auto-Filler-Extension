/**
 * OriginFill — Session Timeout Detection & Recovery Guard
 * Saves what you type (never passwords, files or payment fields) so it can be restored if the
 * portal logs you out, and detects those logouts.
 *
 * A timeout is reported only on real evidence: a "session expired" dialog, or a sign-in form
 * appearing after you had entered data. Workday's normal "Create Account/Sign In" step is not one.
 *
 * @license AGPL-3.0
 * @author CharyWorld
 */

var OriginFillSessionGuard = (() => {
  'use strict';

  /** @type {boolean} Guard is active */
  let _active = false;

  /** @type {string} URL of the active application page */
  let _applicationUrl = '';

  /** @type {string} Detected portal type */
  let _portalType = '';

  /** @type {MutationObserver|null} DOM watcher for login forms / timeout dialogs */
  let _domObserver = null;

  /** @type {number|null} Debounce timer for DOM checks */
  let _domCheckTimer = null;

  /** @type {number|null} URL check interval ID */
  let _urlCheckInterval = null;

  /** @type {number|null} Debounce timer for blur snapshots */
  let _blurDebounce = null;

  /** @type {boolean} Whether a timeout has already been detected */
  let _timeoutDetected = false;

  /** @type {boolean} The user has entered enough data on this page to be worth protecting */
  let _hasUserData = false;

  /** @type {boolean} Whether a password field was visible at the last check */
  let _passwordVisible = false;

  /** @type {string} URL at the last check */
  let _lastUrl = '';

  /** Snapshots with fewer fields aren't treated as "work in progress" */
  const MIN_FIELDS_TO_PROTECT = 3;

  /** Recovery data older than this is discarded */
  const MAX_AGE_MS = 24 * 60 * 60 * 1000;

  // ─── Session Timeout Signals ───────────────────────────────────

  const LOGIN_URL_PATTERNS = [
    /\/login\b/i,
    /\/signin\b/i,
    /\/sign-in\b/i,
    /\/session[-_]?expired/i,
    /\/session[-_]?timeout/i,
    /\/logout\b/i
  ];

  const TIMEOUT_PHRASES = [
    /\bsession\s+(has\s+)?(expired|timed\s*out|ended)\b/i,
    /\byour\s+session\s+(will\s+|is\s+about\s+to\s+)?(expire|time\s*out)/i,
    /\byou\s+(have\s+|'ve\s+)?been\s+(signed|logged)\s+out\b/i,
    /\b(please\s+)?(sign|log)\s*in\s+again\b/i,
    /\bdue\s+to\s+inactivity\b/i
  ];

  const DIALOG_SELECTOR = '[role="dialog"], [role="alertdialog"], [role="alert"], [aria-live="assertive"], ' +
    '[data-automation-id="wd-popup-content"], [data-automation-id="errorMessage"], .modal, .modal-dialog';

  // ─── Guard Lifecycle ───────────────────────────────────────────

  /**
   * Start the session guard.
   *
   * @param {Object} options
   * @param {string} options.portalType - Detected portal type
   * @param {string} [options.applicationUrl] - Current application URL
   */
  function start(options = {}) {
    if (_active) {
      OriginFillLogger.debug('Session guard already active');
      return;
    }

    _portalType = options.portalType || '';
    _applicationUrl = options.applicationUrl || window.location.href;
    _lastUrl = window.location.href;
    _timeoutDetected = false;
    _hasUserData = false;
    _passwordVisible = isPasswordFormVisible();

    // 1. Watch for redirects to login pages
    _urlCheckInterval = setInterval(checkURL, 3000);
    window.addEventListener('beforeunload', handleBeforeUnload);

    // 2. Watch the DOM for timeout dialogs and sign-in forms
    _domObserver = new MutationObserver(() => {
      if (_timeoutDetected || _domCheckTimer) return;
      _domCheckTimer = setTimeout(() => {
        _domCheckTimer = null;
        checkDOM();
      }, 1000);
    });
    _domObserver.observe(document.body, { childList: true, subtree: true });

    // 3. Save a snapshot whenever a field loses focus
    document.addEventListener('focusout', handleFieldBlur, true);

    _active = true;
    OriginFillLogger.info('Session guard started');
  }

  /**
   * Stop the session guard and clean up all watchers.
   */
  function stop() {
    if (_urlCheckInterval) {
      clearInterval(_urlCheckInterval);
      _urlCheckInterval = null;
    }

    if (_domObserver) {
      _domObserver.disconnect();
      _domObserver = null;
    }

    clearTimeout(_domCheckTimer);
    _domCheckTimer = null;
    clearTimeout(_blurDebounce);
    _blurDebounce = null;

    window.removeEventListener('beforeunload', handleBeforeUnload);
    document.removeEventListener('focusout', handleFieldBlur, true);

    _active = false;
    OriginFillLogger.info('Session guard stopped');
  }

  // ─── Detection ─────────────────────────────────────────────────

  /**
   * A redirect to a login URL after the user entered data means the session ended.
   */
  function checkURL() {
    const currentUrl = window.location.href;
    if (currentUrl === _lastUrl) return;

    const previous = _lastUrl;
    _lastUrl = currentUrl;

    const isLoginUrl = LOGIN_URL_PATTERNS.some(p => p.test(currentUrl));
    const wasLoginUrl = LOGIN_URL_PATTERNS.some(p => p.test(previous));
    if (_hasUserData && isLoginUrl && !wasLoginUrl) {
      OriginFillLogger.warn(`Session timeout detected via URL redirect: ${currentUrl}`);
      onTimeoutDetected('url_redirect');
    }
  }

  /**
   * Look for timeout dialogs, and for a sign-in form that wasn't there before.
   */
  function checkDOM() {
    if (_timeoutDetected) return;

    const dialogs = Array.from(document.querySelectorAll(DIALOG_SELECTOR)).filter(d => OriginFillDetector.isVisible(d));
    for (const dialog of dialogs) {
      const text = (dialog.textContent || '').slice(0, 1000);
      if (TIMEOUT_PHRASES.some(p => p.test(text))) {
        OriginFillLogger.warn('Session timeout detected via dialog text');
        onTimeoutDetected('dialog');
        return;
      }
    }

    const passwordVisible = isPasswordFormVisible();
    if (passwordVisible && !_passwordVisible && _hasUserData) {
      OriginFillLogger.warn('Session timeout detected: sign-in form replaced the application');
      onTimeoutDetected('login_form');
    }
    _passwordVisible = passwordVisible;
  }

  function isPasswordFormVisible() {
    return Array.from(document.querySelectorAll('input[type="password"]')).some(i => OriginFillDetector.isVisible(i));
  }

  /**
   * Handle beforeunload — save snapshot before navigation.
   */
  function handleBeforeUnload() {
    saveSnapshotNow();
  }

  // ─── Field Blur Snapshot ───────────────────────────────────────

  /**
   * Handle field blur — debounce and save snapshot.
   *
   * @param {FocusEvent} event
   */
  function handleFieldBlur(event) {
    const target = event.target;

    // Only snapshot if the target is a form field
    if (!target || !['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName)) return;
    if (['hidden', 'submit', 'button', 'password', 'file'].includes(target.type)) return;
    if (target.closest('[data-originfill-ui]')) return;

    clearTimeout(_blurDebounce);
    _blurDebounce = setTimeout(() => {
      saveSnapshotAsync();
    }, 800);
  }

  // ─── Snapshot Functions ────────────────────────────────────────

  /**
   * Save a field snapshot asynchronously.
   */
  async function saveSnapshotAsync() {
    try {
      const snapshot = OriginFillFiller.captureFieldSnapshot();
      const fieldCount = Object.keys(snapshot).length;
      if (fieldCount === 0) return;

      _hasUserData = fieldCount >= MIN_FIELDS_TO_PROTECT;
      await writeSnapshot(snapshot, false);
      OriginFillLogger.debug(`Snapshot saved: ${fieldCount} fields`);
    } catch (err) {
      OriginFillLogger.debug('Snapshot save failed:', err.message);
    }
  }

  /**
   * Save a snapshot immediately (for beforeunload and timeouts). The storage write may not
   * finish before the page unloads; the last blur snapshot is the safety net.
   *
   * @param {boolean} [timedOut=false]
   */
  function saveSnapshotNow(timedOut = false) {
    try {
      const snapshot = OriginFillFiller.captureFieldSnapshot();
      if (Object.keys(snapshot).length > 0) {
        writeSnapshot(snapshot, timedOut).catch(() => {});
      } else if (timedOut) {
        markTimedOut().catch(() => {});
      }
    } catch (err) {
      // Suppress errors during unload
    }
  }

  /**
   * Store a snapshot — but never let an emptier page (e.g. the form after signing back in)
   * overwrite a snapshot taken when the session expired.
   */
  async function writeSnapshot(snapshot, timedOut) {
    const key = OriginFillStorageKeys.SESSION_RECOVERY;
    const fieldCount = Object.keys(snapshot).length;
    const existing = (await chrome.storage.local.get(key))[key];

    if (existing && existing.timedOut && !timedOut && isFresh(existing) &&
        (existing.fieldCount || Object.keys(existing.savedFields || {}).length) > fieldCount) {
      return;
    }

    await chrome.storage.local.set({
      [key]: {
        lastUrl: window.location.href,
        lastPortal: _portalType,
        savedFields: snapshot,
        fieldCount,
        timedOut,
        savedAt: new Date().toISOString()
      }
    });
  }

  async function markTimedOut() {
    const key = OriginFillStorageKeys.SESSION_RECOVERY;
    const existing = (await chrome.storage.local.get(key))[key];
    if (existing) await chrome.storage.local.set({ [key]: { ...existing, timedOut: true } });
  }

  function isFresh(recovery) {
    return Date.now() - new Date(recovery.savedAt).getTime() < MAX_AGE_MS;
  }

  // ─── Timeout Handler ───────────────────────────────────────────

  /**
   * Handle detected session timeout.
   *
   * @param {string} method - Detection method used
   */
  function onTimeoutDetected(method) {
    if (_timeoutDetected) return;
    _timeoutDetected = true;

    OriginFillLogger.warn(`⚠️ Session timeout detected via: ${method}`);

    // Keep what was typed; the form on screen may already be gone
    saveSnapshotNow(true);

    // Background shows a notification and counts the recovery
    sendMessage(OriginFillMessages.SESSION_TIMEOUT, {
      url: _applicationUrl,
      portal: _portalType,
      method,
      timestamp: new Date().toISOString()
    });
  }

  // ─── Recovery Check ────────────────────────────────────────────

  /**
   * Check if there's a session recovery available for the current page:
   * same site, less than a day old, the page looks unfilled and the saved fields exist here.
   *
   * @returns {Promise<Object|null>} Recovery data (with restorableCount), or null if none
   */
  async function checkRecoveryAvailable() {
    try {
      const result = await chrome.storage.local.get(OriginFillStorageKeys.SESSION_RECOVERY);
      const recovery = result[OriginFillStorageKeys.SESSION_RECOVERY];
      if (!recovery || !recovery.savedFields || !recovery.lastUrl) return null;

      // Same site only
      if (new URL(recovery.lastUrl).hostname !== window.location.hostname) return null;

      if (!isFresh(recovery)) {
        OriginFillLogger.debug('Recovery data expired (>24h)');
        await clearRecovery();
        return null;
      }

      // The form on screen must be (nearly) empty — otherwise there's nothing to recover
      const current = OriginFillFiller.captureFieldSnapshot();
      if (Object.keys(current).length > 3) return null;

      const restorableCount = OriginFillFiller.countRestorable(recovery.savedFields);
      if (restorableCount === 0) return null;

      OriginFillLogger.info(`Recovery available: ${restorableCount} fields from ${recovery.savedAt}`);
      return { ...recovery, restorableCount };

    } catch (err) {
      OriginFillLogger.debug('Recovery check failed:', err.message);
      return null;
    }
  }

  /**
   * Clear saved recovery data.
   * @returns {Promise<void>}
   */
  async function clearRecovery() {
    await chrome.storage.local.remove(OriginFillStorageKeys.SESSION_RECOVERY);
    OriginFillLogger.debug('Recovery data cleared');
  }

  // ─── Utility ───────────────────────────────────────────────────

  /**
   * Check if the guard is active.
   * @returns {boolean}
   */
  function isActive() {
    return _active;
  }

  /**
   * Check if a timeout was detected.
   * @returns {boolean}
   */
  function wasTimeoutDetected() {
    return _timeoutDetected;
  }

  /**
   * Send message to background/popup.
   */
  function sendMessage(type, data) {
    try {
      chrome.runtime.sendMessage({ type, data }).catch(() => {});
    } catch (err) {
      OriginFillLogger.debug('Session guard message failed:', err.message);
    }
  }

  // ─── Public API ─────────────────────────────────────────────────
  return Object.freeze({
    start,
    stop,
    isActive,
    wasTimeoutDetected,
    checkRecoveryAvailable,
    clearRecovery,
    saveSnapshotAsync,
    saveSnapshotNow
  });
})();
