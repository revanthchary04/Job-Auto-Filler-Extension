/**
 * OriginFill — Popup Logic
 * Talks to the content script in the active tab (injecting it when needed), shows what it found,
 * starts fills and restores, and displays progress and reports.
 *
 * @license AGPL-3.0
 * @author CharyWorld
 */

(async function PopupInit() {
  'use strict';

  // ─── DOM References ────────────────────────────────────────────

  const $ = (sel) => document.getElementById(sel);

  const els = {
    popup: $('popup'),
    // Header
    profileSelect: $('profileSelect'),
    settingsBtn: $('settingsBtn'),
    // Badge
    portalBadge: $('portalBadge'),
    badgeIcon: $('badgeIcon'),
    badgeText: $('badgeText'),
    // States
    stateWelcome: $('stateWelcome'),
    stateNoForm: $('stateNoForm'),
    stateDetected: $('stateDetected'),
    stateFilling: $('stateFilling'),
    stateComplete: $('stateComplete'),
    stateMessage: $('stateMessage'),
    // Welcome
    setupProfileBtn: $('setupProfileBtn'),
    // No Form
    noFormText: $('noFormText'),
    noFormSub: $('noFormSub'),
    goSettingsBtn: $('goSettingsBtn'),
    detectDemandBtn: $('detectDemandBtn'),
    // Detected
    pageText: $('pageText'),
    pageIndicator: $('pageIndicator'),
    fillAllBtn: $('fillAllBtn'),
    fillPersonalBtn: $('fillPersonalBtn'),
    fillEducationBtn: $('fillEducationBtn'),
    fillWorkBtn: $('fillWorkBtn'),
    fillSummary: $('fillSummary'),
    fillSummaryText: $('fillSummaryText'),
    viewReportBtn: $('viewReportBtn'),
    // Recovery
    recoveryBanner: $('recoveryBanner'),
    recoveryMeta: $('recoveryMeta'),
    restoreBtn: $('restoreBtn'),
    dismissRecoveryBtn: $('dismissRecoveryBtn'),
    // Filling
    fillingTitle: $('fillingTitle'),
    progressBar: $('progressBar'),
    progressFill: $('progressFill'),
    progressText: $('progressText'),
    fillingField: $('fillingField'),
    cancelFillBtn: $('cancelFillBtn'),
    // Complete
    completeIcon: $('completeIcon'),
    completeTitle: $('completeTitle'),
    statSuccess: $('statSuccess'),
    statAttention: $('statAttention'),
    statFailed: $('statFailed'),
    completeTime: $('completeTime'),
    viewFullReportBtn: $('viewFullReportBtn'),
    fillAgainBtn: $('fillAgainBtn'),
    // Message
    messageIcon: $('messageIcon'),
    messageTitle: $('messageTitle'),
    messageText: $('messageText'),
    messageActionBtn: $('messageActionBtn'),
    messageBackBtn: $('messageBackBtn'),
    // Report
    fillReport: $('fillReport'),
    reportMeta: $('reportMeta'),
    reportBody: $('reportBody'),
    closeReportBtn: $('closeReportBtn'),
    // Update waiting for a reload
    updateBanner: $('updateBanner'),
    updateMeta: $('updateMeta'),
    reloadExtensionBtn: $('reloadExtensionBtn'),
    // Footer stats
    timeSavedValue: $('timeSavedValue'),
    recoveriesValue: $('recoveriesValue'),
    fillCountValue: $('fillCountValue')
  };

  // ─── State ─────────────────────────────────────────────────────

  let activeTab = null;
  let tabState = null;
  let currentReport = null;
  let profiles = [];
  let settings = {};
  let messageAction = null;

  // ─── Initialize ────────────────────────────────────────────────

  async function init() {
    try {
      await applyTheme();
      await loadProfilesAndSettings();
      loadStats();
      checkForUpdatedFiles();

      [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });

      if (!activeProfileHasData()) {
        showState('welcome');
        updateBadge('none', '👋', 'Profile setup needed');
        return;
      }

      await refreshTabState({ inject: isPortalUrl(activeTab?.url) });
    } catch (err) {
      console.error('[OriginFill Popup] Init error:', err);
      showMessage('❌', 'Something went wrong', 'OriginFill could not load. Try reopening the popup.');
    }
  }

  /**
   * An unpacked install keeps running its old code after the folder is updated, until the
   * extension is reloaded. Extension pages are read from disk, so compare the two versions.
   */
  async function checkForUpdatedFiles() {
    try {
      const running = chrome.runtime.getManifest().version;
      const response = await fetch(chrome.runtime.getURL('manifest.json'), { cache: 'no-store' });
      const onDisk = (await response.json()).version;
      if (!onDisk || onDisk === running) return;
      els.updateMeta.textContent = `Chrome is still running version ${running}; version ${onDisk} is in the OriginFill folder. After reloading, reload your job application tab too.`;
      els.updateBanner.hidden = false;
    } catch (e) { /* Store installs always match */ }
  }

  /**
   * Ask the content script what's on the page; inject it first when allowed.
   * @param {{ inject?: boolean }} [options]
   */
  async function refreshTabState({ inject = false } = {}) {
    if (!activeTab) {
      showNoForm();
      return;
    }

    if (isRestrictedUrl(activeTab.url)) {
      showNoForm('OriginFill can\'t run on this page.', 'Browser pages and the Chrome Web Store don\'t allow extensions. Open a job application to get started.', false);
      return;
    }

    let state = await sendToTab({ type: OriginFillMessages.GET_STATE });
    if (!state && inject) {
      const injected = await chrome.runtime.sendMessage({ type: OriginFillMessages.INJECT_RUNTIME, data: { tabId: activeTab.id } });
      if (injected && injected.ok) {
        state = await sendToTab({ type: OriginFillMessages.GET_STATE });
      } else if (isPortalUrl(activeTab.url)) {
        showMessage('🔄', 'Reload this page', injected?.error || 'OriginFill needs the page to be reloaded once after installing or updating.', {
          label: 'Reload page',
          run: () => { chrome.tabs.reload(activeTab.id); window.close(); }
        });
        return;
      }
    }

    tabState = state;

    if (state && state.filling) {
      showFilling('Filling form...');
      return;
    }

    if (state && state.portalType && state.portalType !== OriginFillPortals.NONE) {
      showDetectedState(state);
      const report = state.lastFillReport ||
        await chrome.runtime.sendMessage({ type: 'GET_LAST_REPORT', data: { tabId: activeTab.id } }).catch(() => null);
      if (report && report.url === activeTab.url) showFillSummary(report);
    } else {
      showNoForm();
    }
  }

  // ─── State Management ──────────────────────────────────────────

  /**
   * Show a specific state section, hiding all others.
   * @param {'welcome'|'noForm'|'detected'|'filling'|'complete'|'message'} stateName
   */
  function showState(stateName) {
    const stateMap = {
      'welcome': 'stateWelcome',
      'noForm': 'stateNoForm',
      'detected': 'stateDetected',
      'filling': 'stateFilling',
      'complete': 'stateComplete',
      'message': 'stateMessage'
    };

    Object.values(stateMap).forEach(s => {
      els[s].hidden = (s !== stateMap[stateName]);
    });

    // Hide report when changing states
    if (stateName !== 'complete' && stateName !== 'detected') {
      els.fillReport.hidden = true;
    }
  }

  function showNoForm(text, sub, canTry = true) {
    els.noFormText.textContent = text || 'No job application form detected on this page.';
    els.noFormSub.textContent = sub || 'Open a Workday (or other) job application. If this page is one, you can still try filling it.';
    els.detectDemandBtn.hidden = !canTry;
    updateBadge('none', '📋', 'No job form detected');
    showState('noForm');
  }

  /**
   * Show an explanation with an optional action button.
   */
  function showMessage(icon, title, text, action = null) {
    els.messageIcon.textContent = icon;
    els.messageTitle.textContent = title;
    els.messageText.textContent = text;
    messageAction = action;
    els.messageActionBtn.hidden = !action;
    if (action) els.messageActionBtn.textContent = action.label;
    showState('message');
  }

  // ─── Tab Messaging ─────────────────────────────────────────────

  /**
   * Send a message to the active tab's content script.
   * @returns {Promise<any|null>} null when nothing is listening
   */
  async function sendToTab(message) {
    if (!activeTab) return null;
    try {
      return await chrome.tabs.sendMessage(activeTab.id, message);
    } catch (e) {
      return null;
    }
  }

  function isRestrictedUrl(url) {
    if (!url) return false;
    return /^(chrome|chrome-extension|edge|about|devtools|view-source):/.test(url) ||
      url.startsWith('https://chromewebstore.google.com') ||
      url.startsWith('https://chrome.google.com/webstore');
  }

  function isPortalUrl(url) {
    if (!url) return true; // Unknown — try
    return /^https?:/.test(url);
  }

  // ─── Detected State ────────────────────────────────────────────

  /**
   * Show the detected state with portal info.
   * @param {Object} info
   */
  function showDetectedState(info) {
    const portalName = getPortalDisplayName(info.portalType);

    if (info.portalType === OriginFillPortals.GENERIC) {
      updateBadge('warning', '⚠️', `${portalName} — field matching may vary`);
    } else {
      updateBadge('success', '✅', `${portalName} detected`);
    }

    // Page indicator
    if (info.portalType === OriginFillPortals.WORKDAY && info.isApplication === false) {
      els.pageText.textContent = 'Job posting — click Apply, then Autofill each step';
      els.pageIndicator.hidden = false;
    } else if (info.pageName) {
      const pageNum = info.pageNumber || 1;
      const totalPages = info.totalPages || 1;
      els.pageText.textContent = totalPages > 1
        ? `Step ${pageNum} of ${totalPages} · ${info.pageName}`
        : info.pageName;
      els.pageIndicator.hidden = false;
    } else {
      els.pageIndicator.hidden = true;
    }

    // Session recovery offer
    if (info.recovery && info.recovery.fieldCount > 0) {
      const count = info.recovery.fieldCount;
      els.recoveryMeta.textContent = `${count} field${count === 1 ? '' : 's'} saved ${getTimeAgo(new Date(info.recovery.savedAt))}${info.recovery.timedOut ? ' before your session expired' : ''}.`;
      els.recoveryBanner.hidden = false;
    } else {
      els.recoveryBanner.hidden = true;
    }

    els.fillSummary.hidden = true;
    showState('detected');
  }

  // ─── Fill Commands ─────────────────────────────────────────────

  /**
   * Send a fill command to the content script.
   * @param {string} section - 'all', 'personal', 'education', 'workExperience'
   */
  async function sendFillCommand(section) {
    if (!activeProfileHasData()) {
      showState('welcome');
      return;
    }

    showFilling('Filling form...');

    let response = await sendToTab({
      type: section === 'all' ? OriginFillMessages.FILL_ALL : OriginFillMessages.FILL_SECTION,
      data: { section }
    });

    if (!response) {
      // Not injected yet (e.g. "Fill anyway" on an unknown site)
      const injected = await chrome.runtime.sendMessage({ type: OriginFillMessages.INJECT_RUNTIME, data: { tabId: activeTab.id } });
      if (injected && injected.ok) {
        response = await sendToTab({ type: OriginFillMessages.FILL_ALL, data: { section } });
      } else {
        showMessage('🔄', 'Couldn\'t reach the page', injected?.error || 'Reload the page and try again.', {
          label: 'Reload page',
          run: () => { chrome.tabs.reload(activeTab.id); window.close(); }
        });
        return;
      }
    }

    if (!response || !response.started) {
      const reason = response?.reason;
      if (reason === 'no_profile') {
        showState('welcome');
      } else if (reason === 'busy') {
        showFilling('Already filling...');
      } else {
        showMessage('⚠️', 'Couldn\'t start', response?.error || 'OriginFill could not start filling this page.');
      }
    }
  }

  async function sendRestoreCommand() {
    showFilling('Restoring saved answers...');
    const response = await sendToTab({ type: OriginFillMessages.SESSION_RESTORE });
    if (!response) {
      showMessage('🔄', 'Couldn\'t reach the page', 'Reload the application page and open OriginFill again.');
    }
  }

  function showFilling(title) {
    els.fillingTitle.textContent = title;
    setProgress(0);
    els.fillingField.textContent = 'Preparing...';
    showState('filling');
  }

  function setProgress(pct) {
    els.progressFill.style.width = `${pct}%`;
    els.progressText.textContent = `${pct}%`;
    els.progressBar.setAttribute('aria-valuenow', String(pct));
  }

  // ─── Fill Progress & Complete ──────────────────────────────────

  /**
   * Update fill progress in the UI.
   * @param {Object} data - { current, total, fieldName, phase }
   */
  function updateFillProgress(data) {
    if (els.stateFilling.hidden) showFilling(data.phase === 'restore' ? 'Restoring saved answers...' : 'Filling form...');
    if (data.phase === 'started') return;

    const pct = data.total > 0 ? Math.round((data.current / data.total) * 100) : 0;
    setProgress(pct);
    els.fillingField.textContent = data.fieldName ? `${data.phase === 'restore' ? 'Restoring' : 'Filling'}: ${data.fieldName}` : '...';
  }

  /**
   * Show fill complete state.
   * @param {Object} report
   */
  function showFillComplete(report) {
    currentReport = report;

    if (report.status === 'no_profile') {
      showState('welcome');
      return;
    }

    if (report.status === 'no_fields') {
      showMessage('🔍', 'No fields found', `OriginFill detected ${getPortalDisplayName(report.portalType)}, but couldn't find fillable fields on this page yet. If the form is still loading, wait a moment and try again.`);
      return;
    }

    if (report.status === 'nothing_to_restore') {
      showMessage('🔄', 'Nothing to restore', 'There are no saved answers for this page.');
      return;
    }

    const filled = (report.successCount || 0) + (report.attentionCount || 0);
    els.completeIcon.textContent = report.failedCount > 0 ? '⚠️' : '✅';
    els.completeTitle.textContent = filled > 0 ? `Filled ${filled} field${filled === 1 ? '' : 's'}` : 'Nothing was filled';
    els.statSuccess.textContent = report.successCount || 0;
    els.statAttention.textContent = report.attentionCount || 0;
    els.statFailed.textContent = report.failedCount || 0;
    els.completeTime.textContent = filled === 0 && !(report.results && report.results.length)
      ? 'No fields on this page were recognised. Turn on Debug logging in Settings to report the site.'
      : (report.elapsedFormatted ? `⏱ ${report.elapsedFormatted}` : '');
    els.viewFullReportBtn.hidden = !(report.results && report.results.length);

    showState('complete');
    loadStats();
  }

  /**
   * Show fill summary in the detected state.
   * @param {Object} report
   */
  function showFillSummary(report) {
    currentReport = report;
    if (!report.results || report.results.length === 0) return;

    const filled = (report.successCount || 0) + (report.attentionCount || 0);
    els.fillSummaryText.textContent = report.failedCount > 0
      ? `Last fill: ${filled} filled, ${report.failedCount} failed`
      : `Last fill: ${filled} fields ✅`;
    els.fillSummary.hidden = false;
  }

  // ─── Fill Report ───────────────────────────────────────────────

  /**
   * Render the detailed fill report.
   * @param {Object} report
   */
  function renderReport(report) {
    if (!report) return;

    const when = report.timestamp ? new Date(report.timestamp).toLocaleString() : '';
    els.reportMeta.textContent = [report.portalName, report.pageName, when, report.elapsedFormatted].filter(Boolean).join(' · ');

    const sections = [
      ['✅ Filled', 'success', report.successResults],
      ['⚠️ Please check', 'attention', report.attentionResults],
      ['❌ Failed', 'failed', report.failedResults],
      ['⏭ Fill yourself', 'skipped', report.skippedResults]
    ];

    els.reportBody.textContent = '';
    sections.forEach(([title, type, results]) => {
      if (results && results.length) els.reportBody.appendChild(renderReportSection(title, type, results));
    });
    els.fillReport.hidden = false;
  }

  /**
   * Render a single report section.
   */
  function renderReportSection(title, type, results) {
    const section = document.createElement('div');
    section.className = 'popup__report-section';

    const heading = document.createElement('div');
    heading.className = `popup__report-section-title popup__report-section-title--${type}`;
    heading.textContent = `${title} (${results.length})`;
    section.appendChild(heading);

    results.forEach(r => {
      const item = document.createElement('div');
      item.className = 'popup__report-item';
      const field = document.createElement('span');
      field.className = 'popup__report-field';
      field.textContent = r.field;
      const value = document.createElement('span');
      value.className = 'popup__report-value';
      value.textContent = r.value || '—';
      item.append(field, value);
      if (r.note) {
        const note = document.createElement('span');
        note.className = 'popup__report-note';
        note.textContent = r.note;
        item.appendChild(note);
      }
      section.appendChild(item);
    });

    return section;
  }

  // ─── Profile & Settings ────────────────────────────────────────

  /**
   * Load profiles and settings from storage.
   */
  async function loadProfilesAndSettings() {
    try {
      settings = await OriginFillStore.getSettings();
      profiles = await OriginFillStore.getProfiles();
    } catch (err) {
      console.error('[OriginFill Popup] Failed to load data:', err);
      profiles = [];
      settings = { ...OriginFillDefaultSettings };
    }
    populateProfileSelector();
  }

  function getActiveProfile() {
    return profiles.find(p => p.id === settings.activeProfileId) ||
      profiles.find(p => p.isDefault) || profiles[0] || null;
  }

  function activeProfileHasData() {
    const p = getActiveProfile()?.personal;
    return !!(p && (p.firstName || p.lastName || p.email));
  }

  /**
   * Populate the profile dropdown.
   */
  function populateProfileSelector() {
    els.profileSelect.textContent = '';

    if (profiles.length === 0) {
      const option = document.createElement('option');
      option.value = '';
      option.textContent = 'No profiles';
      els.profileSelect.appendChild(option);
      return;
    }

    const active = getActiveProfile();
    profiles.forEach(p => {
      const option = document.createElement('option');
      option.value = p.id;
      option.textContent = p.label;
      option.selected = active && p.id === active.id;
      els.profileSelect.appendChild(option);
    });
  }

  // ─── Stats ─────────────────────────────────────────────────────

  async function loadStats() {
    try {
      const stats = await OriginFillStore.getStats();

      const minutes = Math.round(stats.totalTimeSavedMinutes || 0);
      els.timeSavedValue.textContent = minutes >= 60 ? `${(minutes / 60).toFixed(1)}h` : `${minutes} min`;
      els.recoveriesValue.textContent = stats.totalRecoveries || 0;
      els.fillCountValue.textContent = stats.totalFills || 0;
    } catch (err) {
      console.error('[OriginFill Popup] Stats load error:', err);
    }
  }

  // ─── Theme ─────────────────────────────────────────────────────

  async function applyTheme() {
    const s = await OriginFillStore.getSettings();
    if (s.theme === 'dark' || s.theme === 'light') {
      document.documentElement.setAttribute('data-theme', s.theme);
    }
    // 'system' = no data-theme attribute, CSS media query handles it
  }

  // ─── Badge ─────────────────────────────────────────────────────

  /**
   * Update the portal badge in the popup.
   * @param {'success'|'warning'|'none'} type
   * @param {string} icon
   * @param {string} text
   */
  function updateBadge(type, icon, text) {
    els.portalBadge.className = `popup__badge popup__badge--${type}`;
    els.badgeIcon.textContent = icon;
    els.badgeText.textContent = text;
  }

  // ─── Event Listeners ──────────────────────────────────────────

  const openSettings = (section) => {
    chrome.runtime.sendMessage({ type: OriginFillMessages.OPEN_SETTINGS, data: { section } });
    window.close();
  };

  els.settingsBtn.addEventListener('click', () => openSettings(''));
  els.reloadExtensionBtn.addEventListener('click', () => chrome.runtime.reload());
  els.setupProfileBtn.addEventListener('click', () => openSettings('personal'));
  els.goSettingsBtn.addEventListener('click', () => openSettings(''));

  // Profile switcher
  els.profileSelect.addEventListener('change', async () => {
    const newId = els.profileSelect.value;
    if (!newId) return;
    await OriginFillStore.setActiveProfile(newId);
    settings.activeProfileId = newId;
    if (!activeProfileHasData()) showState('welcome');
    else if (tabState && tabState.portalType !== OriginFillPortals.NONE) showDetectedState(tabState);
  });

  // Real-time synchronization when settings or profiles change in settings page
  chrome.storage.onChanged.addListener(async (changes, areaName) => {
    if (areaName !== 'local') return;
    if (changes[OriginFillStorageKeys.PROFILES] || changes[OriginFillStorageKeys.SETTINGS]) {
      await loadProfilesAndSettings();
    }
    if (changes[OriginFillStorageKeys.STATS]) loadStats();
  });

  // Fill on a page we didn't recognise
  els.detectDemandBtn.addEventListener('click', () => sendFillCommand('all'));

  // Fill all
  els.fillAllBtn.addEventListener('click', () => sendFillCommand('all'));

  // Section fills
  els.fillPersonalBtn.addEventListener('click', () => sendFillCommand('personal'));
  els.fillEducationBtn.addEventListener('click', () => sendFillCommand('education'));
  els.fillWorkBtn.addEventListener('click', () => sendFillCommand('workExperience'));

  // Stop
  els.cancelFillBtn.addEventListener('click', () => sendToTab({ type: OriginFillMessages.CANCEL_FILL }));

  // Session restore
  els.restoreBtn.addEventListener('click', () => sendRestoreCommand());

  // Dismiss recovery
  els.dismissRecoveryBtn.addEventListener('click', async () => {
    await chrome.storage.local.remove(OriginFillStorageKeys.SESSION_RECOVERY);
    els.recoveryBanner.hidden = true;
  });

  // View report buttons
  els.viewReportBtn.addEventListener('click', () => renderReport(currentReport));
  els.viewFullReportBtn.addEventListener('click', () => renderReport(currentReport));

  // Close report
  els.closeReportBtn.addEventListener('click', () => {
    els.fillReport.hidden = true;
  });

  // Fill again / back
  els.fillAgainBtn.addEventListener('click', () => refreshTabState());
  els.messageBackBtn.addEventListener('click', () => refreshTabState());
  els.messageActionBtn.addEventListener('click', () => messageAction && messageAction.run());

  // ─── Message Listener ─────────────────────────────────────────

  chrome.runtime.onMessage.addListener((message, sender) => {
    // Only listen to the tab this popup belongs to
    if (!sender.tab || !activeTab || sender.tab.id !== activeTab.id) return;
    const { type, data } = message;

    switch (type) {
      case OriginFillMessages.FILL_PROGRESS:
        updateFillProgress(data);
        break;

      case OriginFillMessages.FILL_COMPLETE:
      case OriginFillMessages.FILL_ERROR:
      case OriginFillMessages.SESSION_RESTORED:
        showFillComplete(data);
        break;

      case OriginFillMessages.PAGE_CHANGED:
        if (data.pageName && tabState && els.stateFilling.hidden && els.stateComplete.hidden) {
          tabState = { ...tabState, ...data };
          showDetectedState(tabState);
        }
        break;
    }
  });

  // ─── Utility Functions ─────────────────────────────────────────

  function getPortalDisplayName(type) {
    const names = {
      workday: 'Workday',
      greenhouse: 'Greenhouse',
      lever: 'Lever',
      icims: 'iCIMS',
      taleo: 'Taleo',
      generic: 'Job form',
      none: 'No portal'
    };
    return names[type] || 'Job form';
  }

  function getTimeAgo(date) {
    const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
    if (seconds < 60) return 'just now';
    if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)} hours ago`;
    return `${Math.floor(seconds / 86400)} days ago`;
  }

  // ─── Initialize ────────────────────────────────────────────────
  await init();

})();
