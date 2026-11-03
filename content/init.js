/**
 * OriginFill — Content Script Entry Point
 * Initializes portal detection, observer, session guard, the in-page panel and message handlers.
 * This file runs after all other content scripts are loaded (document_idle).
 *
 * Initialization order:
 *   1. Register message + storage listeners (so PING works even if something below fails)
 *   2. Detect portal
 *   3. Load settings and the active profile
 *   4. Start observer, session guard and in-page panel
 *   5. Offer session recovery if the page lost data
 *
 * @license AGPL-3.0
 * @author CharyWorld
 */

(function OriginFillContentInit() {
  'use strict';

  // Prevent double initialization. The background sets a fresh boot token when it re-injects
  // into a tab whose earlier copy was orphaned by an extension update; that copy is shut down.
  const bootToken = window.__originfillBootToken || 'manifest';
  if (window.__originfillInitToken === bootToken) {
    return;
  }
  if (typeof window.__originfillTeardown === 'function') {
    try { window.__originfillTeardown(); } catch (e) { /* previous copy already gone */ }
  }
  window.__originfillInitToken = bootToken;

  // ─── Startup Health Check ──────────────────────────────────────
  const missing = [];
  if (typeof OriginFillDom === 'undefined') missing.push('OriginFillDom');
  if (typeof OriginFillDetector === 'undefined') missing.push('OriginFillDetector');
  if (typeof OriginFillFiller === 'undefined') missing.push('OriginFillFiller');
  if (typeof OriginFillWorkday === 'undefined') missing.push('OriginFillWorkday');
  if (typeof OriginFillGeneric === 'undefined') missing.push('OriginFillGeneric');
  if (typeof OriginFillPanel === 'undefined') missing.push('OriginFillPanel');
  if (missing.length > 0) {
    console.error(`[OriginFill][Init] Missing dependenc${missing.length > 1 ? 'ies' : 'y'}: ${missing.join(', ')}`);
    return;
  }

  let settings = { ...OriginFillDefaultSettings };
  let activeProfile = null;
  let detection = { type: OriginFillPortals.NONE, confidence: 'none', pageName: '', url: window.location.href };
  let started = false;

  // ─── 1. Message Handler ────────────────────────────────────────

  function onMessage(message, sender, sendResponse) {
    const { type, data } = message || {};

    switch (type) {
      case OriginFillMessages.PING:
        sendResponse({
          type: OriginFillMessages.PONG,
          timestamp: Date.now(),
          version: chrome.runtime.getManifest().version
        });
        return false;

      case OriginFillMessages.GET_PORTAL_INFO:
        sendResponse(OriginFillDetector.detect());
        return false;

      case OriginFillMessages.GET_STATE:
        getState().then(sendResponse, err => sendResponse({ error: err.message }));
        return true;

      case OriginFillMessages.FILL_ALL:
      case OriginFillMessages.FILL_SECTION:
        startFill(data?.section || OriginFillSections.ALL, data?.fillDelay)
          .then(sendResponse, err => sendResponse({ started: false, reason: 'error', error: err.message }));
        return true;

      case OriginFillMessages.CANCEL_FILL:
        OriginFillFiller.cancel();
        sendResponse({ ok: true });
        return false;

      case OriginFillMessages.SESSION_RESTORE:
        sendResponse({ started: true });
        startRestore();
        return false;

      case OriginFillMessages.PROFILE_UPDATED:
      case OriginFillMessages.SETTINGS_UPDATED:
        loadState().then(applySettings);
        return false;
    }
    return false;
  }

  // Profiles and settings are edited in the settings page and popup; keep this tab in sync
  function onStorageChanged(changes, area) {
    if (area !== 'local') return;
    if (changes[OriginFillStorageKeys.PROFILES] || changes[OriginFillStorageKeys.SETTINGS]) {
      loadState().then(applySettings);
    }
  }

  chrome.runtime.onMessage.addListener(onMessage);
  chrome.storage.onChanged.addListener(onStorageChanged);

  window.__originfillTeardown = () => {
    try { chrome.runtime.onMessage.removeListener(onMessage); } catch (e) { /* context gone */ }
    try { chrome.storage.onChanged.removeListener(onStorageChanged); } catch (e) { /* context gone */ }
    if (OriginFillObserver.isActive()) OriginFillObserver.stop();
    if (OriginFillSessionGuard.isActive()) OriginFillSessionGuard.stop();
    OriginFillFiller.cancel();
    OriginFillPanel.unmount();
    window.__originfillTeardown = null;
  };

  /** After an extension update this copy can no longer reach the extension. */
  function isContextValid() {
    try {
      return !!(chrome.runtime && chrome.runtime.id);
    } catch (e) {
      return false;
    }
  }

  // ─── 2. State ──────────────────────────────────────────────────

  /**
   * Load settings and the active profile. Profiles are encrypted and the key never enters the
   * page, so the background decrypts and sends the active profile.
   */
  async function loadState() {
    if (!isContextValid()) {
      if (window.__originfillTeardown) window.__originfillTeardown();
      return;
    }

    try {
      const response = await chrome.runtime.sendMessage({ type: OriginFillMessages.GET_PROFILE });
      settings = { ...OriginFillDefaultSettings, ...(response?.settings || {}) };
      activeProfile = response?.profile || null;
    } catch (e) {
      OriginFillLogger.warn('Could not load profile:', e.message);
      activeProfile = null;
    }

    OriginFillLogger.setEnabled(settings.debugLogging);
    if (activeProfile) {
      OriginFillLogger.info(`Active profile loaded: ${activeProfile.label} (${activeProfile.id})`);
    } else {
      OriginFillLogger.warn('No profile available');
    }
  }

  function hasProfileData(profile) {
    const p = profile && profile.personal;
    return !!(p && (p.firstName || p.lastName || p.email));
  }

  function applySettings() {
    if (!started) return;
    OriginFillObserver.setAutoFillOnChange(!!settings.autoFillOnDetect);
    OriginFillObserver.updateProfile(activeProfile);
    updatePanel(OriginFillObserver.getLastPageInfo(), { force: true });
  }

  async function getState() {
    detection = OriginFillDetector.detect();
    const pageInfo = started ? OriginFillObserver.getLastPageInfo() : null;
    const recovery = started ? await OriginFillSessionGuard.checkRecoveryAvailable() : null;
    const { report } = OriginFillFiller.getLastReport();

    return {
      ...detection,
      portalType: detection.type,
      pageName: pageInfo?.pageName || detection.pageName,
      pageNumber: pageInfo?.pageNumber || detection.pageNumber || 1,
      totalPages: pageInfo?.totalPages || detection.totalPages || 1,
      fieldCount: pageInfo?.fieldCount ?? null,
      filling: OriginFillFiller.isFilling(),
      lastFillReport: report && report.url === window.location.href ? report : null,
      recovery: recovery ? {
        fieldCount: recovery.restorableCount,
        savedAt: recovery.savedAt,
        timedOut: !!recovery.timedOut
      } : null
    };
  }

  // ─── 3. Fill & Restore ─────────────────────────────────────────

  /**
   * Start filling the page. Resolves as soon as the fill has started (or was refused).
   */
  async function startFill(section, fillDelayOverride) {
    if (OriginFillFiller.isFilling()) return { started: false, reason: 'busy' };

    await loadState();
    if (!activeProfile || !hasProfileData(activeProfile)) {
      const error = { error: 'Your profile is empty. Add your details in OriginFill Settings first.', status: 'no_profile' };
      sendMessage(OriginFillMessages.FILL_ERROR, error);
      if (settings.showFloatingButton !== false) {
        ensurePanel();
        OriginFillPanel.resetDismissal();
        OriginFillPanel.show({ needsSetup: true });
      }
      return { started: false, reason: 'no_profile' };
    }

    detection = OriginFillDetector.detect();
    const portalType = detection.type === OriginFillPortals.NONE ? OriginFillPortals.GENERIC : detection.type;
    const usePanel = settings.showFloatingButton !== false;
    if (usePanel) {
      ensurePanel();
      OriginFillPanel.resetDismissal();
      OriginFillPanel.show({});
    }

    OriginFillFiller.fillAll(activeProfile, portalType, {
      section,
      fillDelay: fillDelayOverride ?? settings.fillDelay,
      overwriteExisting: settings.overwriteExisting !== false,
      onProgress: (current, total, name) => { if (usePanel) OriginFillPanel.showProgress(current, total, name); },
      onComplete: (report) => {
        if (!usePanel) return;
        const { elements } = OriginFillFiller.getLastReport();
        OriginFillPanel.showReport(report, elements);
      }
    });

    return { started: true, portalType };
  }

  async function startRestore() {
    if (OriginFillFiller.isFilling()) return;
    detection = OriginFillDetector.detect();
    const recovery = await OriginFillSessionGuard.checkRecoveryAvailable();

    if (!recovery) {
      sendMessage(OriginFillMessages.SESSION_RESTORED, {
        success: false,
        status: 'nothing_to_restore',
        error: 'Nothing to restore on this page.',
        successCount: 0, failedCount: 0, attentionCount: 0, skippedCount: 0, totalFields: 0,
        portalName: OriginFillDetector.getPortalDisplayName(detection.type),
        timestamp: new Date().toISOString(),
        results: []
      });
      return;
    }

    const result = await OriginFillFiller.restoreFromSnapshot(recovery.savedFields, detection.type);
    if (result.restored > 0) await OriginFillSessionGuard.clearRecovery();

    const results = result.results || [];
    const report = {
      success: result.restored > 0,
      successCount: result.restored,
      failedCount: result.failed,
      attentionCount: 0,
      skippedCount: 0,
      totalFields: result.total,
      successRate: result.total > 0 ? Math.round((result.restored / result.total) * 100) : 0,
      elapsedFormatted: 'instant',
      portalName: OriginFillDetector.getPortalDisplayName(detection.type),
      url: window.location.href,
      timestamp: new Date().toISOString(),
      results,
      successResults: results.filter(r => r.status === OriginFillStatus.SUCCESS),
      attentionResults: [],
      failedResults: results.filter(r => r.status === OriginFillStatus.FAILED),
      skippedResults: []
    };

    sendMessage(OriginFillMessages.SESSION_RESTORED, report);
    sendMessage(OriginFillMessages.STATS_UPDATED, { totalRecoveries: result.restored > 0 ? 1 : 0 });
    if (settings.showFloatingButton !== false && started) OriginFillPanel.showReport(report, []);
  }

  async function checkRecovery() {
    const recovery = await OriginFillSessionGuard.checkRecoveryAvailable();
    if (!recovery) {
      OriginFillPanel.hideRecovery();
      return;
    }
    OriginFillLogger.info('Session recovery available:', recovery.restorableCount, 'fields');
    if (settings.showFloatingButton !== false) OriginFillPanel.showRecovery(recovery);
  }

  // ─── 4. In-Page Panel ──────────────────────────────────────────

  function ensurePanel() {
    OriginFillPanel.mount({
      onFill: () => startFill(OriginFillSections.ALL),
      onCancel: () => OriginFillFiller.cancel(),
      onRestore: () => startRestore(),
      onDismissRecovery: () => OriginFillSessionGuard.clearRecovery(),
      onOpenSettings: (section) => sendMessage(OriginFillMessages.OPEN_SETTINGS, { section: section || 'personal' }),
      onAnswer: (id, answer, elements) => answerQuestion(id, answer, elements)
    });
  }

  /**
   * Save an answer given in the report ("Do you have a disability?" → No) for every future
   * application, then fill the questions on this page that it answers.
   * @returns {Promise<boolean>}
   */
  async function answerQuestion(id, answer, elements) {
    const saved = await chrome.runtime.sendMessage({ type: OriginFillMessages.SAVE_FAQ_ANSWER, data: { id, answer } }).catch(() => null);
    if (!saved || !saved.ok) return false;

    await loadState();
    detection = OriginFillDetector.detect();
    const portalType = detection.type === OriginFillPortals.NONE ? OriginFillPortals.GENERIC : detection.type;
    const report = await OriginFillFiller.refillFields(elements, activeProfile, portalType);
    if (report) OriginFillPanel.showReport(report, OriginFillFiller.getLastReport().elements);
    return true;
  }

  /**
   * Show the floating button on application pages only.
   */
  function updatePanel(pageInfo, { force = false } = {}) {
    if (settings.showFloatingButton === false) {
      OriginFillPanel.hide();
      return;
    }
    if (OriginFillFiller.isFilling() || !pageInfo) return;

    let eligible = pageInfo.fieldCount > 0;
    if (detection.type === OriginFillPortals.WORKDAY) {
      eligible = eligible && OriginFillDetector.isWorkdayApplication() &&
        !/\b(sign\s*in|create\s+account|review)\b/i.test(pageInfo.pageName || '');
    }

    if (!eligible) {
      OriginFillPanel.hide();
      return;
    }

    if (force || !OriginFillPanel.isVisible()) {
      ensurePanel();
      const label = detection.type === OriginFillPortals.WORKDAY && pageInfo.pageName && pageInfo.pageName.length <= 24
        ? pageInfo.pageName
        : '';
      // Workday's "Autofill with Resume" step is just the upload
      const text = /\bresume\b|\brésumé\b|\bcv\b/i.test(pageInfo.pageName || '') ? 'Upload my résumé' : '';
      OriginFillPanel.show({ label, text, needsSetup: !hasProfileData(activeProfile) });
    }
  }

  // ─── 5. Start ──────────────────────────────────────────────────

  function startWatching() {
    if (started) return;
    started = true;

    OriginFillObserver.start({
      portalType: detection.type,
      autoFillOnChange: !!settings.autoFillOnDetect,
      profile: activeProfile,
      onAutoFill: () => {
        if (hasProfileData(activeProfile)) startFill(OriginFillSections.ALL);
      },
      onPageChange: (pageInfo, { isNewPage }) => {
        if (isNewPage) {
          OriginFillPanel.resetDismissal();
          OriginFillPanel.clearCard();
          detection = OriginFillDetector.detect();
          sendMessage(OriginFillMessages.PORTAL_DETECTED, detection);
          checkRecovery();
        }
        updatePanel(pageInfo, { force: isNewPage });
      }
    });

    if (settings.recoveryEnabled !== false) {
      OriginFillSessionGuard.start({
        portalType: detection.type,
        applicationUrl: window.location.href
      });
    }
  }

  function sendMessage(type, data) {
    try {
      chrome.runtime.sendMessage({ type, data }).catch(() => {});
    } catch (e) {
      // Extension updated or reloaded — this copy is orphaned
      if (window.__originfillTeardown) window.__originfillTeardown();
    }
  }

  // ─── Run Initialization ────────────────────────────────────────

  detection = OriginFillDetector.detect();

  if (detection.type === OriginFillPortals.NONE) {
    OriginFillLogger.info('No job portal detected on this page. Listening for on-demand requests.');
    return; // Don't start observer or session guard on non-portal pages
  }

  sendMessage(OriginFillMessages.PORTAL_DETECTED, detection);

  loadState().then(() => {
    startWatching();
    OriginFillLogger.success(
      `Initialized on ${OriginFillDetector.getPortalDisplayName(detection.type)} ` +
      `(${detection.confidence} confidence)`
    );
  });

})();
