/**
 * OriginFill — Background Service Worker
 * Handles script injection, résumé retrieval, badges, notifications, stats and lifecycle.
 * Runs as a Manifest V3 service worker: it can be stopped at any time, so nothing important
 * lives in memory — per-tab state goes to chrome.storage.session.
 *
 * @license AGPL-3.0
 * @author CharyWorld
 */

// Profiles are encrypted; only extension contexts (this worker, popup, settings) hold the key.
// Content scripts ask for the decrypted active profile with GET_PROFILE.
importScripts('../utils/constants.js', '../utils/logger.js', '../storage/encryption.js', '../storage/store.js');

// ─── Constants (duplicated since SW can't access content script globals) ──
const SW_StorageKeys = Object.freeze({
  PROFILES: 'originfill_profiles',
  SETTINGS: 'originfill_settings',
  SESSION_RECOVERY: 'originfill_session_recovery',
  STATS: 'originfill_stats',
  ENCRYPTION_KEY: 'originfill_enc_key',
  FIRST_RUN: 'originfill_first_run'
});

const SW_Messages = Object.freeze({
  PORTAL_DETECTED: 'PORTAL_DETECTED',
  DETECT_ON_DEMAND: 'DETECT_ON_DEMAND',
  INJECT_RUNTIME: 'INJECT_RUNTIME',
  FILL_ALL: 'FILL_ALL',
  FILL_SECTION: 'FILL_SECTION',
  FILL_COMPLETE: 'FILL_COMPLETE',
  FILL_ERROR: 'FILL_ERROR',
  GET_RESUME: 'GET_RESUME',
  GET_PROFILE: 'GET_PROFILE',
  SAVE_FAQ_ANSWER: 'SAVE_FAQ_ANSWER',
  GET_STATE: 'GET_STATE',
  SESSION_TIMEOUT: 'SESSION_TIMEOUT',
  SESSION_RESTORE: 'SESSION_RESTORE',
  STATS_UPDATED: 'STATS_UPDATED',
  SHOW_NOTIFICATION: 'SHOW_NOTIFICATION',
  OPEN_SETTINGS: 'OPEN_SETTINGS',
  GET_LAST_REPORT: 'GET_LAST_REPORT',
  PING: 'PING',
  PONG: 'PONG'
});

const SW_Portals = Object.freeze({
  WORKDAY: 'workday',
  GREENHOUSE: 'greenhouse',
  LEVER: 'lever',
  ICIMS: 'icims',
  TALEO: 'taleo',
  GENERIC: 'generic',
  NONE: 'none'
});

const SW_DefaultSettings = Object.freeze({
  activeProfileId: '',
  autoDetect: true,
  autoFillOnDetect: false,
  showFloatingButton: true,
  overwriteExisting: true,
  showNotifications: true,
  recoveryEnabled: true,
  fillDelay: 150,
  theme: 'system',
  debugLogging: false,
  useEncryption: true,
  usePassphrase: false
});

const SW_DefaultStats = Object.freeze({
  totalFills: 0,
  totalFieldsFilled: 0,
  totalRecoveries: 0,
  totalTimeSavedMinutes: 0,
  portalsUsed: {},
  fillSuccessRate: 0,
  lastFillDate: ''
});

/** Content scripts in load order — the same list the manifest injects. */
const CONTENT_SCRIPTS = chrome.runtime.getManifest().content_scripts[0].js;

// ─── Extension Lifecycle ─────────────────────────────────────────

/**
 * Handle extension install or update.
 */
chrome.runtime.onInstalled.addListener(async (details) => {
  console.log(`[OriginFill] Extension ${details.reason}: v${chrome.runtime.getManifest().version}`);

  if (details.reason === 'install') {
    // First install — mark for onboarding
    await chrome.storage.local.set({ [SW_StorageKeys.FIRST_RUN]: true });

    // Initialize default settings
    const existingSettings = await getStorageValue(SW_StorageKeys.SETTINGS);
    if (!existingSettings) {
      await chrome.storage.local.set({
        [SW_StorageKeys.SETTINGS]: { ...SW_DefaultSettings }
      });
    }

    // Initialize stats
    const existingStats = await getStorageValue(SW_StorageKeys.STATS);
    if (!existingStats) {
      await chrome.storage.local.set({
        [SW_StorageKeys.STATS]: { ...SW_DefaultStats }
      });
    }

    // Onboarding: the profile is the only setup step
    openSettings('personal', { welcome: true });
  }

  if (details.reason === 'update') {
    console.log(`[OriginFill] Updated from v${details.previousVersion}`);
  }

  // Tabs opened before this install/update have no (or an orphaned) content script
  reinjectIntoOpenTabs();
});

// ─── Message Router ──────────────────────────────────────────────

/**
 * Handle messages from content scripts and popup.
 * Returns true only when sendResponse will be called asynchronously.
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const { type, data } = message || {};
  const tabId = sender.tab?.id;

  switch (type) {
    // ─── Portal Detection ────────────────
    case SW_Messages.PORTAL_DETECTED:
      if (tabId && data) updateBadge(tabId, data.type);
      return false;

    case SW_Messages.INJECT_RUNTIME:
    case SW_Messages.DETECT_ON_DEMAND:
      resolveTabId(data?.tabId ?? message.tabId)
        .then(id => id ? ensureRuntime(id) : { ok: false, error: 'No active tab' })
        .then(sendResponse, err => sendResponse({ ok: false, error: err.message }));
      return true;

    // ─── Active profile (decrypted here, never in the page) ────
    case SW_Messages.GET_PROFILE:
      getActiveProfileForTab()
        .then(sendResponse, err => sendResponse({ profile: null, error: err.message }));
      return true;

    // ─── A common question answered in the page's report ────
    case SW_Messages.SAVE_FAQ_ANSWER:
      saveFaqAnswer(data)
        .then(sendResponse, err => sendResponse({ ok: false, error: err.message }));
      return true;

    // ─── Résumé (extension IndexedDB) ────
    case SW_Messages.GET_RESUME:
      getResume(data?.profileId, data?.resumeId)
        .then(resume => sendResponse(resume ? { resume } : { resume: null, error: 'No résumé saved — add one in Settings → Resume' }))
        .catch(err => sendResponse({ resume: null, error: err.message }));
      return true;

    // ─── Fill Events ─────────────────────
    case SW_Messages.FILL_COMPLETE:
    case SW_Messages.FILL_ERROR:
      if (tabId && data) saveLastReport(tabId, data);
      return false;

    case SW_Messages.GET_LAST_REPORT:
      loadLastReport(data?.tabId).then(sendResponse, () => sendResponse(null));
      return true;

    // Legacy: popup asking the background to forward a fill or restore
    case SW_Messages.FILL_ALL:
    case SW_Messages.FILL_SECTION:
    case SW_Messages.SESSION_RESTORE:
      resolveTabId(tabId || data?.tabId || message.tabId)
        .then(async id => {
          if (!id) return { started: false, error: 'No active tab' };
          const runtime = await ensureRuntime(id);
          if (!runtime.ok) return { started: false, error: runtime.error };
          return chrome.tabs.sendMessage(id, { type, data });
        })
        .then(sendResponse, err => sendResponse({ started: false, error: err.message }));
      return true;

    // ─── Session Timeout ─────────────────
    case SW_Messages.SESSION_TIMEOUT:
      handleSessionTimeout(data);
      return false;

    // ─── Stats Update ────────────────────
    case SW_Messages.STATS_UPDATED:
      updateStats(data || {});
      return false;

    // ─── Notifications ───────────────────
    case SW_Messages.SHOW_NOTIFICATION:
      showNotification(data || {});
      return false;

    case SW_Messages.OPEN_SETTINGS:
      openSettings(data?.section || '');
      return false;

    // ─── Ping (health check) ─────────────
    case SW_Messages.PING:
      sendResponse({ type: SW_Messages.PONG, timestamp: Date.now() });
      return false;
  }

  return false;
});

// ─── Script Injection ────────────────────────────────────────────

/**
 * Helper to determine if a URL is restricted from script injection.
 * @param {string} url
 * @returns {boolean}
 */
function isRestrictedUrl(url) {
  if (!url) return false; // Unknown without the tabs permission — let executeScript decide
  return url.startsWith('chrome://') ||
         url.startsWith('chrome-extension://') ||
         url.startsWith('edge://') ||
         url.startsWith('about:') ||
         url.startsWith('devtools://') ||
         url.startsWith('view-source:') ||
         url.startsWith('https://chromewebstore.google.com') ||
         url.startsWith('https://chrome.google.com/webstore');
}

/**
 * Whether the tab's content script is alive and answering.
 * @param {number} tabId
 * @returns {Promise<boolean>}
 */
async function pingTab(tabId) {
  try {
    const response = await chrome.tabs.sendMessage(tabId, { type: SW_Messages.PING });
    return !!response;
  } catch (e) {
    return false;
  }
}

/**
 * Make sure OriginFill is running in a tab, injecting it when needed (pages opened before the
 * extension was installed/updated, or sites outside the built-in list via activeTab).
 *
 * @param {number} tabId
 * @returns {Promise<{ ok: boolean, injected?: boolean, error?: string }>}
 */
async function ensureRuntime(tabId) {
  if (await pingTab(tabId)) return { ok: true, injected: false };

  try {
    const tab = await chrome.tabs.get(tabId);
    if (isRestrictedUrl(tab.url || '')) {
      return { ok: false, error: 'OriginFill can\'t run on this page.', reason: 'restricted_url' };
    }

    // A fresh boot token lets init.js replace an orphaned copy left by an extension update
    await chrome.scripting.executeScript({
      target: { tabId },
      func: () => { window.__originfillBootToken = `${Date.now()}-${Math.random().toString(36).slice(2)}`; }
    });
    await chrome.scripting.executeScript({ target: { tabId }, files: CONTENT_SCRIPTS });
  } catch (err) {
    console.warn('[OriginFill][SW] Injection failed:', err.message);
    return { ok: false, error: 'OriginFill can\'t access this page. Reload it and try again.', reason: 'injection_failed' };
  }

  // Give init.js a moment to register its listeners
  for (let i = 0; i < 10; i++) {
    if (await pingTab(tabId)) return { ok: true, injected: true };
    await new Promise(r => setTimeout(r, 100));
  }
  return { ok: false, error: 'OriginFill didn\'t start on this page. Reload it and try again.', reason: 'no_response' };
}

/**
 * Re-inject into already-open job portal tabs after install/update.
 */
async function reinjectIntoOpenTabs() {
  try {
    const patterns = chrome.runtime.getManifest().content_scripts.flatMap(entry => entry.matches);
    const tabs = await chrome.tabs.query({ url: patterns });
    for (const tab of tabs) {
      if (tab.id && !tab.discarded) ensureRuntime(tab.id).catch(() => {});
    }
  } catch (err) {
    console.debug('[OriginFill][SW] Re-inject skipped:', err.message);
  }
}

async function resolveTabId(tabId) {
  if (tabId) return tabId;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.id || null;
}

// ─── Profile & Résumés ───────────────────────────────────────────

/**
 * The active profile and settings, for a content script about to fill a page.
 * @returns {Promise<{ profile: Object|null, settings: Object }>}
 */
async function getActiveProfileForTab() {
  const settings = await OriginFillStore.getSettings();
  const profiles = await OriginFillStore.getProfiles();
  const profile = profiles.find(p => p.id === settings.activeProfileId) ||
    profiles.find(p => p.isDefault) || profiles[0] || null;
  return { profile, settings };
}

/**
 * Save a common-question answer given in a page's report ("Do you have a disability?" → No)
 * to the active profile, so every later application gets it too.
 * @param {{ id: string, answer: string }} data
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
async function saveFaqAnswer(data) {
  const id = String(data?.id || '');
  const answer = String(data?.answer || '').trim().slice(0, 200);
  if (!/^[A-Za-z0-9]{1,40}$/.test(id) || !answer) return { ok: false, error: 'Invalid answer' };

  const { profile } = await getActiveProfileForTab();
  if (!profile) return { ok: false, error: 'No profile' };
  await OriginFillStore.replaceProfileFields(profile.id, { faq: { ...(profile.faq || {}), [id]: answer } });
  return { ok: true };
}

/**
 * Get the résumé to upload for a profile: the chosen default, else the first uploaded.
 * Résumés live in the extension's IndexedDB, which job sites can't reach.
 *
 * @param {string} profileId
 * @param {string} [resumeId]
 * @returns {Promise<{ fileName: string, fileData: string, mimeType: string }|null>}
 */
async function getResume(profileId, resumeId) {
  if (!profileId) return null;
  const resumes = await OriginFillStore.getResumes(profileId);
  if (resumes.length === 0) return null;

  const sorted = resumes.sort((a, b) => String(a.uploadedAt || '').localeCompare(String(b.uploadedAt || '')));
  const chosen = sorted.find(r => r.id === resumeId) || sorted[0];
  return { fileName: chosen.fileName, fileData: chosen.fileData, mimeType: chosen.mimeType || '' };
}

// ─── Per-Tab Last Report ─────────────────────────────────────────

async function saveLastReport(tabId, report) {
  try {
    await chrome.storage.session.set({ [`lastReport_${tabId}`]: report });
  } catch (e) { /* session storage full or unavailable */ }
}

async function loadLastReport(tabId) {
  if (!tabId) return null;
  const key = `lastReport_${tabId}`;
  const result = await chrome.storage.session.get(key);
  return result[key] || null;
}

chrome.tabs.onRemoved.addListener((tabId) => {
  chrome.storage.session.remove(`lastReport_${tabId}`).catch(() => {});
});

// ─── Badge Management ────────────────────────────────────────────

/**
 * Update the extension badge for a tab. Chrome clears tab badges on navigation.
 *
 * @param {number} tabId
 * @param {string|null} portalType
 */
function updateBadge(tabId, portalType) {
  if (!portalType || portalType === SW_Portals.NONE) {
    chrome.action.setBadgeText({ text: '', tabId }).catch(() => {});
    return;
  }

  const badgeConfig = {
    [SW_Portals.WORKDAY]:    { text: 'W', color: '#2563EB' },
    [SW_Portals.GREENHOUSE]: { text: 'G', color: '#16A34A' },
    [SW_Portals.LEVER]:      { text: 'L', color: '#7C3AED' },
    [SW_Portals.ICIMS]:      { text: 'I', color: '#D97706' },
    [SW_Portals.TALEO]:      { text: 'T', color: '#0891B2' },
    [SW_Portals.GENERIC]:    { text: '•', color: '#6B7280' }
  };

  const config = badgeConfig[portalType] || badgeConfig[SW_Portals.GENERIC];

  chrome.action.setBadgeText({ text: config.text, tabId }).catch(() => {});
  chrome.action.setBadgeBackgroundColor({ color: config.color, tabId }).catch(() => {});
}

// ─── Notifications ───────────────────────────────────────────────

/**
 * Show a Chrome notification.
 *
 * @param {{ title: string, message: string, url?: string }} data
 */
async function showNotification(data) {
  const settings = await getStorageValue(SW_StorageKeys.SETTINGS) || SW_DefaultSettings;
  if (settings.showNotifications === false) return;

  const notificationId = 'originfill_' + Date.now();

  try {
    await chrome.notifications.create(notificationId, {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('assets/icons/logo128.png'),
      title: data.title || 'OriginFill',
      message: data.message || '',
      priority: 1
    });
    if (data.url) {
      await chrome.storage.session.set({ [`notify_${notificationId}`]: data.url });
    }
  } catch (error) {
    console.warn('[OriginFill] Notification failed:', error.message);
  }
}

// Registered at top level so it works after the service worker restarts
chrome.notifications.onClicked.addListener(async (notificationId) => {
  const key = `notify_${notificationId}`;
  const result = await chrome.storage.session.get(key);
  if (result[key]) {
    chrome.tabs.create({ url: result[key] });
    chrome.storage.session.remove(key);
  }
  chrome.notifications.clear(notificationId);
});

// ─── Session Timeout Handling ────────────────────────────────────

/**
 * Handle a session timeout event from content script.
 *
 * @param {Object} data - Timeout details
 */
async function handleSessionTimeout(data = {}) {
  console.log('[OriginFill] Session timeout:', data.method);

  showNotification({
    title: 'Session expired — your answers are saved',
    message: `Your ${getPortalName(data.portal)} session ended. Sign back in and open the application: OriginFill will offer to restore what you typed.`,
    url: data.url
  });
}

// ─── Settings Page ───────────────────────────────────────────────

/**
 * Open (or focus) the settings page at a section.
 * @param {string} section
 * @param {{ welcome?: boolean }} [options]
 */
async function openSettings(section, { welcome = false } = {}) {
  const base = chrome.runtime.getURL('settings/settings.html');
  const url = `${base}${welcome ? '?welcome=1' : ''}${section ? `#${section}` : ''}`;
  try {
    const [existing] = await chrome.tabs.query({ url: `${base}*` });
    if (existing) {
      await chrome.tabs.update(existing.id, { url, active: true });
      await chrome.windows.update(existing.windowId, { focused: true });
      return;
    }
  } catch (e) { /* fall through to a new tab */ }
  chrome.tabs.create({ url });
}

// ─── Helper Functions ────────────────────────────────────────────

/**
 * Get storage value by key.
 * @param {string} key
 * @returns {Promise<any>}
 */
async function getStorageValue(key) {
  const result = await chrome.storage.local.get(key);
  return result[key] ?? null;
}

/**
 * Get display name for a portal type.
 * @param {string} type
 * @returns {string}
 */
function getPortalName(type) {
  const names = {
    workday: 'Workday',
    greenhouse: 'Greenhouse',
    lever: 'Lever',
    icims: 'iCIMS',
    taleo: 'Taleo',
    generic: 'job portal',
    none: 'job portal'
  };
  return names[type] || 'job portal';
}

/**
 * Update usage stats.
 * @param {Object} delta
 */
async function updateStats(delta) {
  const stats = { ...SW_DefaultStats, ...(await getStorageValue(SW_StorageKeys.STATS) || {}) };

  if (delta.totalFills) stats.totalFills += delta.totalFills;
  if (delta.totalFieldsFilled) stats.totalFieldsFilled += delta.totalFieldsFilled;
  if (delta.totalRecoveries) stats.totalRecoveries += delta.totalRecoveries;
  if (delta.totalTimeSavedMinutes) stats.totalTimeSavedMinutes += delta.totalTimeSavedMinutes;
  if (delta.portal) {
    stats.portalsUsed = stats.portalsUsed || {};
    stats.portalsUsed[delta.portal] = (stats.portalsUsed[delta.portal] || 0) + 1;
  }
  if (delta.fillSuccessRate !== undefined && delta.totalFills) {
    const total = stats.totalFills || 1;
    stats.fillSuccessRate = (
      (stats.fillSuccessRate * (total - 1) + delta.fillSuccessRate) / total
    );
  }

  if (delta.totalFills) stats.lastFillDate = new Date().toISOString();
  await chrome.storage.local.set({ [SW_StorageKeys.STATS]: stats });
}

console.log('[OriginFill] Service worker initialized');
