/**
 * OriginFill — Shared Constants
 * Loaded first in every context (content scripts, popup, settings).
 *
 * Declared with `var` so the content-script bundle can be injected again into a tab whose
 * earlier copy was orphaned by an extension update, without "already declared" errors.
 *
 * @license AGPL-3.0
 * @author CharyWorld
 */

// ─── Portal Types ────────────────────────────────────────────────
var OriginFillPortals = Object.freeze({
  WORKDAY: 'workday',
  GREENHOUSE: 'greenhouse',
  LEVER: 'lever',
  ICIMS: 'icims',
  TALEO: 'taleo',
  GENERIC: 'generic',
  NONE: 'none'
});

// ─── Portal URL Patterns ─────────────────────────────────────────
var OriginFillPortalPatterns = Object.freeze([
  { type: OriginFillPortals.WORKDAY,    pattern: /myworkday(jobs|site)?\.com/i },
  { type: OriginFillPortals.GREENHOUSE, pattern: /greenhouse\.io/i },
  { type: OriginFillPortals.LEVER,      pattern: /lever\.co/i },
  { type: OriginFillPortals.ICIMS,      pattern: /icims\.com/i },
  { type: OriginFillPortals.TALEO,      pattern: /taleo\.net/i }
]);

// ─── Detection Confidence Levels ─────────────────────────────────
var OriginFillConfidence = Object.freeze({
  HIGH: 'high',       // URL + DOM confirmation
  MEDIUM: 'medium',   // URL match only
  LOW: 'low',         // DOM heuristics only
  NONE: 'none'        // Nothing detected
});

// ─── Fill Status ─────────────────────────────────────────────────
var OriginFillStatus = Object.freeze({
  SUCCESS: 'success',
  ATTENTION: 'attention',   // Filled but may need review (fuzzy match, fallback)
  FAILED: 'failed',
  SKIPPED: 'skipped',
  PENDING: 'pending'
});

// ─── Field Types ─────────────────────────────────────────────────
var OriginFillFieldTypes = Object.freeze({
  TEXT: 'text',
  EMAIL: 'email',
  PHONE: 'phone',
  URL: 'url',
  TEXTAREA: 'textarea',
  SELECT: 'select',
  RADIO: 'radio',
  CHECKBOX: 'checkbox',
  DATE: 'date',
  FILE: 'file',
  RICHTEXT: 'richtext',      // contenteditable divs
  COMBOBOX: 'combobox',       // Custom dropdowns
  NUMBER: 'number'
});

// ─── Message Types (content ↔ popup ↔ background) ────────────────
var OriginFillMessages = Object.freeze({
  // Detection
  GET_PORTAL_INFO: 'GET_PORTAL_INFO',
  PORTAL_DETECTED: 'PORTAL_DETECTED',
  DETECT_ON_DEMAND: 'DETECT_ON_DEMAND',
  INJECT_RUNTIME: 'INJECT_RUNTIME',

  // Filling
  FILL_ALL: 'FILL_ALL',
  FILL_SECTION: 'FILL_SECTION',
  FILL_PROGRESS: 'FILL_PROGRESS',
  FILL_COMPLETE: 'FILL_COMPLETE',
  FILL_ERROR: 'FILL_ERROR',
  CANCEL_FILL: 'CANCEL_FILL',

  // Profiles (encrypted) and résumés (IndexedDB) stay in the extension; content scripts ask for them
  GET_PROFILE: 'GET_PROFILE',
  GET_RESUME: 'GET_RESUME',
  SAVE_FAQ_ANSWER: 'SAVE_FAQ_ANSWER', // A common question answered in the page's report

  // Session
  SESSION_TIMEOUT: 'SESSION_TIMEOUT',
  SESSION_SNAPSHOT_SAVED: 'SESSION_SNAPSHOT_SAVED',
  SESSION_RESTORE: 'SESSION_RESTORE',
  SESSION_RESTORED: 'SESSION_RESTORED',
  SHOW_NOTIFICATION: 'SHOW_NOTIFICATION',

  // Observer
  PAGE_CHANGED: 'PAGE_CHANGED',

  // Storage
  PROFILE_UPDATED: 'PROFILE_UPDATED',
  SETTINGS_UPDATED: 'SETTINGS_UPDATED',
  OPEN_SETTINGS: 'OPEN_SETTINGS',

  // Stats
  STATS_UPDATED: 'STATS_UPDATED',

  // Generic
  PING: 'PING',
  PONG: 'PONG',
  GET_STATE: 'GET_STATE'
});

// ─── Fill Sections ───────────────────────────────────────────────
var OriginFillSections = Object.freeze({
  PERSONAL: 'personal',
  EDUCATION: 'education',
  WORK_EXPERIENCE: 'workExperience',
  SKILLS: 'skills',
  RESUME: 'resume',
  ALL: 'all'
});

// ─── Storage Keys ────────────────────────────────────────────────
var OriginFillStorageKeys = Object.freeze({
  PROFILES: 'originfill_profiles',
  SETTINGS: 'originfill_settings',
  SESSION_RECOVERY: 'originfill_session_recovery',
  STATS: 'originfill_stats',
  ENCRYPTION_KEY: 'originfill_enc_key',
  FIRST_RUN: 'originfill_first_run'
});

// ─── Default Profile Template ────────────────────────────────────
var OriginFillDefaultProfile = Object.freeze({
  id: '',
  label: 'Default Profile',
  isDefault: true,
  colorTag: '#2563EB',
  schemaVersion: 4,
  personal: {
    firstName: '',
    middleName: '',
    lastName: '',
    fullName: '',
    prefix: '',
    email: '',
    phone: '',
    phoneType: 'Mobile',
    phoneCountryCode: '',
    address: '',
    address2: '',
    city: '',
    state: '',
    country: '',
    zipCode: '',
    linkedIn: '',
    github: '',
    portfolio: '',
    websites: []
  },
  // Answers to questions most applications ask the same way
  application: {
    referralSource: '',       // "How did you hear about us?"
    previouslyEmployed: ''    // "Have you previously worked for …?" — '', 'Yes' or 'No'
  },
  // User-written answers for screening questions: [{ question: 'require sponsorship', answer: 'No' }]
  answers: [],
  // Answers to OriginFill's built-in common questions (utils/faq.js): { disability: 'No', noticePeriod: '30 days' }
  faq: {},
  education: [
    {
      institution: '',
      degree: '',
      fieldOfStudy: '',
      startYear: '',
      endYear: '',
      gpa: '',
      location: ''
    }
  ],
  workExperience: [
    {
      company: '',
      jobTitle: '',
      startDate: '',
      endDate: '',
      isCurrent: false,
      location: '',
      bullets: ['']
    }
  ],
  skills: [],
  certifications: [],
  languages: [],
  resume: {
    defaultId: '',   // Resume used for autofill (first upload when empty)
    fileName: '',
    fileData: '',    // Stored in IndexedDB, not here
    uploadedAt: ''
  }
});

// ─── Default Settings ────────────────────────────────────────────
var OriginFillDefaultSettings = Object.freeze({
  activeProfileId: '',
  autoDetect: true,
  autoFillOnDetect: false,
  showFloatingButton: true,  // In-page "Autofill" button on application pages
  overwriteExisting: true,   // Replace values already in a field with profile values
  showNotifications: true,
  recoveryEnabled: true,
  fillDelay: 150,            // ms between field fills
  theme: 'system',           // 'light' | 'dark' | 'system'
  debugLogging: false,       // Verbose [OriginFill] console logs for troubleshooting
  useEncryption: true,
  usePassphrase: false       // Advanced: user-defined passphrase
});

// ─── Default Stats ───────────────────────────────────────────────
var OriginFillDefaultStats = Object.freeze({
  totalFills: 0,
  totalFieldsFilled: 0,
  totalRecoveries: 0,
  totalTimeSavedMinutes: 0,
  portalsUsed: {},
  fillSuccessRate: 0,
  lastFillDate: ''
});

// ─── Timing Constants ────────────────────────────────────────────
var OriginFillTiming = Object.freeze({
  FILL_DELAY_DEFAULT: 150,       // ms between each field fill
  FILL_DELAY_MIN: 0,
  FILL_DELAY_MAX: 1000,
  OBSERVER_DEBOUNCE: 300,        // ms debounce for MutationObserver
  FIELD_RETRY_DELAY: 400,        // ms before retrying failed field
  FIELD_RETRY_MAX: 2,            // max attempts per field
  DROPDOWN_TIMEOUT: 2500,        // ms to wait for a dropdown list to open
  SEARCH_TIMEOUT: 5000,          // ms to wait for search results in prompt fields
  UPLOAD_TIMEOUT: 15000,         // ms to wait for a résumé upload to be confirmed
  SECTION_ADD_TIMEOUT: 4000,     // ms to wait for an added Work/Education entry to render
  SESSION_PING_INTERVAL: 60000,  // 60s background ping
  VALIDATION_WAIT: 500,          // ms to wait for validation to clear
  POPUP_RENDER_TARGET: 100       // ms target for popup render
});

// ─── Fuzzy Match Thresholds ──────────────────────────────────────
var OriginFillFuzzyConfig = Object.freeze({
  MAX_DISTANCE_RATIO: 0.30,     // Max Levenshtein distance as % of string length
  MIN_KEYWORD_MATCH_RATIO: 0.5, // Min keywords that must match
  FALLBACK_OPTIONS: [
    'other', 'not listed', 'not found', 'unlisted',
    'other institution', 'not applicable', 'n/a',
    'prefer not to say', 'not specified', 'please select'
  ]
});

// ─── Confidence Thresholds (numeric) ─────────────────────────────
var OriginFillConfidenceThresholds = Object.freeze({
  AUTO_FILL: 0.80,    // >= 80% confidence → safe automatic fill
  FLAG_REVIEW: 0.60,  // 60-79% → fill but flag for review
  SKIP: 0.40          // < 40% → do not fill
});

// ─── Confidence String → Numeric Map ─────────────────────────────
var OriginFillConfidenceScores = Object.freeze({
  exact: 1.00,
  high: 0.95,
  medium: 0.80,
  low: 0.65,
  none: 0.00
});

// ─── UI Constants ────────────────────────────────────────────────
var OriginFillUI = Object.freeze({
  POPUP_WIDTH: 340,
  POPUP_MAX_HEIGHT: 480,
  MAX_RESUME_SIZE_MB: 5,
  MAX_RESUME_COUNT: 3,
  MAX_BULLET_POINTS: 6,
  BULLET_CHAR_LIMIT: 500,
  PROFILE_COLORS: [
    '#2563EB', '#7C3AED', '#059669', '#D97706',
    '#DC2626', '#0891B2', '#4F46E5', '#BE185D'
  ]
});

// ─── Encryption Constants ────────────────────────────────────────
var OriginFillCrypto = Object.freeze({
  ALGORITHM: 'AES-GCM',
  KEY_LENGTH: 256,
  IV_LENGTH: 12,                  // bytes
  SALT_LENGTH: 16,                // bytes
  PBKDF2_ITERATIONS: 100000,
  KEY_USAGE: ['encrypt', 'decrypt']
});

// ─── IndexedDB Constants ─────────────────────────────────────────
var OriginFillIDB = Object.freeze({
  DB_NAME: 'OriginFillDB',
  DB_VERSION: 1,
  STORE_RESUMES: 'resumes'
});

// ─── Dev Mode ────────────────────────────────────────────────────
var ORIGINFILL_DEV_MODE = false; // Set to true for debug logging (or enable it in Settings)

// ─── Average manual fill time (for stats calculation) ────────────
var ORIGINFILL_AVG_MANUAL_FILL_MINUTES = 5; // per application page
