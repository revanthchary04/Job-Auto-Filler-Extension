const fs = require('fs');
const path = require('path');

// Mock Chrome API
global.chrome = {
  runtime: {
    id: 'test-extension',
    sendMessage: jest.fn(() => Promise.resolve()),
    getManifest: jest.fn(() => ({ version: '0.0.0-test' })),
    onMessage: {
      addListener: jest.fn()
    }
  },
  storage: {
    local: {
      get: jest.fn().mockResolvedValue({}),
      set: jest.fn().mockResolvedValue({}),
      remove: jest.fn().mockResolvedValue({})
    },
    onChanged: {
      addListener: jest.fn()
    }
  }
};

// Add standard DOM globals needed by tests
global.NodeFilter = {
  SHOW_ELEMENT: 1,
  SHOW_TEXT: 4,
};

global.DataTransfer = class DataTransfer {
  constructor() {
    this.items = {
      add: jest.fn()
    };
    this.files = [];
  }
};

// Mock CSS.escape (not implemented in JSDOM)
global.CSS = {
  escape: jest.fn(str => str)
};

// jsdom has no layout: treat connected elements as visible unless hidden by CSS or [hidden]
Element.prototype.checkVisibility = function checkVisibility() {
  if (!this.isConnected) return false;
  for (let el = this; el; el = el.parentElement) {
    if (el.hidden) return false;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
  }
  return true;
};

// Mock OriginFillDetector
global.OriginFillDetector = {
  getInputLabel: jest.fn((el) => {
    // Basic mock implementation for testing
    if (el.id) {
      const label = document.querySelector(`label[for="${el.id}"]`);
      if (label) return label.textContent;
    }
    return '';
  }),
  isVisible: jest.fn(() => true)
};

// Helper to load extension scripts into global scope for testing
global.loadExtensionScript = function(filePath) {
  const fs = require('fs');
  let code = fs.readFileSync(filePath, 'utf8');
  // Convert const OriginFillXXX = ... to global.OriginFillXXX = ...
  code = code.replace(/(?:const|let|var)\s+(OriginFill[a-zA-Z0-9_]+)\s*=/g, 'global.$1 =');
  eval(code);
};

/** Load the content-script bundle in manifest order (constants → … → filler). */
global.loadContentScripts = function(...extra) {
  const root = path.join(__dirname, '..');
  [
    'utils/constants.js',
    'utils/logger.js',
    'utils/dom-actions.js',
    'utils/fuzzy-match.js',
    'utils/field-mapper.js',
    'content/portals/workday.js',
    'content/portals/generic.js',
    'content/detector.js',
    'content/filler.js',
    ...extra
  ].forEach(file => global.loadExtensionScript(path.join(root, file)));
};
