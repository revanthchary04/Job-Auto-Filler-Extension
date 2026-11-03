/**
 * OriginFill — DOM Interaction Helpers
 * Simulates the input sequences that React-based portals (Workday, Greenhouse, …) listen for.
 *
 * Content scripts run in an isolated world: we cannot call the page's React handlers directly,
 * but every DOM event we dispatch reaches the page's listeners. These helpers dispatch the same
 * events a person's mouse and keyboard would, and provide small native-control fillers that the
 * portal adapters share.
 *
 * @license AGPL-3.0
 * @author CharyWorld
 */

var OriginFillDom = (() => {
  'use strict';

  const KEY_CODES = Object.freeze({
    Enter: 13, Escape: 27, Tab: 9, Backspace: 8, ' ': 32,
    ArrowUp: 38, ArrowDown: 40, ArrowLeft: 37, ArrowRight: 39, Home: 36, End: 35
  });

  // ─── Timing ────────────────────────────────────────────────────

  function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Poll until predicate returns a truthy value.
   * @param {Function} predicate
   * @param {{ timeout?: number, interval?: number }} [options]
   * @returns {Promise<any>} The truthy value, or null on timeout
   */
  async function waitFor(predicate, { timeout = 3000, interval = 50 } = {}) {
    const start = Date.now();
    for (;;) {
      try {
        const result = predicate();
        if (result) return result;
      } catch (e) { /* element may be mid-render */ }
      if (Date.now() - start >= timeout) return null;
      await delay(interval);
    }
  }

  // ─── Visibility & Text ─────────────────────────────────────────

  /**
   * Whether an element is rendered and visible to the user.
   * Opacity is deliberately ignored: portals often hide native checkboxes/radios behind styled
   * replacements, and those inputs still need to be filled.
   * @param {Element} el
   * @returns {boolean}
   */
  function isVisible(el) {
    if (!el || !el.isConnected) return false;
    if (typeof el.checkVisibility === 'function') {
      return el.checkVisibility({ visibilityProperty: true });
    }
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    return el.getClientRects().length > 0;
  }

  /**
   * Visible text of an element with whitespace collapsed.
   * @param {Element} el
   * @returns {string}
   */
  function getText(el) {
    if (!el) return '';
    return (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
  }

  /**
   * Strip required markers and trailing punctuation from a label ("First Name*" → "First Name").
   * @param {string} text
   * @returns {string}
   */
  function cleanLabel(text) {
    return (text || '')
      .replace(/\*/g, ' ')
      .replace(/\(\s*required\s*\)|\brequired\b/gi, ' ')
      .replace(/\s+/g, ' ')
      .replace(/[\s:]+$/, '')
      .trim();
  }

  function scrollIntoView(el) {
    try {
      el.scrollIntoView({ block: 'center', inline: 'nearest' });
    } catch (e) { /* detached */ }
  }

  // ─── Focus ─────────────────────────────────────────────────────

  /**
   * Focus an element. When the page itself isn't focused (e.g. the extension popup is open),
   * browsers skip focus events, so we dispatch them ourselves — React listens for focusin.
   * @param {HTMLElement} el
   */
  function focus(el) {
    try {
      el.focus({ preventScroll: true });
    } catch (e) { /* not focusable */ }
    if (document.activeElement !== el || !document.hasFocus()) {
      el.dispatchEvent(new FocusEvent('focus', { bubbles: false }));
      el.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    }
  }

  /**
   * Blur an element (portals validate and commit values on blur; React listens for focusout).
   * @param {HTMLElement} el
   */
  function blur(el) {
    const nativeBlur = document.activeElement === el && document.hasFocus();
    try {
      el.blur();
    } catch (e) { /* not focusable */ }
    if (!nativeBlur) {
      el.dispatchEvent(new FocusEvent('blur', { bubbles: false }));
      el.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    }
  }

  // ─── Mouse ─────────────────────────────────────────────────────

  /**
   * Dispatch the full pointer → mouse → click sequence on an element.
   * Some widgets open on mousedown, others on click; this covers both.
   * @param {HTMLElement} el
   */
  function click(el) {
    const rect = el.getBoundingClientRect();
    const base = {
      bubbles: true,
      cancelable: true,
      composed: true,
      view: window,
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2,
      button: 0
    };
    const Pointer = typeof PointerEvent === 'function' ? PointerEvent : MouseEvent;
    const pointer = { ...base, pointerId: 1, pointerType: 'mouse', isPrimary: true };

    el.dispatchEvent(new Pointer('pointerover', pointer));
    el.dispatchEvent(new MouseEvent('mouseover', base));
    el.dispatchEvent(new Pointer('pointerdown', { ...pointer, buttons: 1 }));
    el.dispatchEvent(new MouseEvent('mousedown', { ...base, buttons: 1 }));
    el.dispatchEvent(new Pointer('pointerup', pointer));
    el.dispatchEvent(new MouseEvent('mouseup', base));
    el.dispatchEvent(new MouseEvent('click', { ...base, detail: 1 }));
  }

  // ─── Keyboard ──────────────────────────────────────────────────

  function keyEvent(type, key) {
    const keyCode = KEY_CODES[key] ?? (key.length === 1 ? key.toUpperCase().charCodeAt(0) : 0);
    let code = key;
    if (/^[a-z]$/i.test(key)) code = `Key${key.toUpperCase()}`;
    else if (/^\d$/.test(key)) code = `Digit${key}`;
    else if (key === ' ') code = 'Space';

    return new KeyboardEvent(type, {
      key,
      code,
      keyCode,
      which: keyCode,
      charCode: type === 'keypress' ? keyCode : 0,
      bubbles: true,
      cancelable: true,
      composed: true,
      view: window
    });
  }

  /**
   * Press and release a key on an element.
   * @param {HTMLElement} el
   * @param {string} key - KeyboardEvent.key value ("Enter", "ArrowUp", "a", …)
   * @returns {boolean} false if the page called preventDefault on keydown
   */
  function pressKey(el, key) {
    const notCancelled = el.dispatchEvent(keyEvent('keydown', key));
    if (key.length === 1 || key === 'Enter') {
      el.dispatchEvent(keyEvent('keypress', key));
    }
    el.dispatchEvent(keyEvent('keyup', key));
    return notCancelled;
  }

  /**
   * Type text one character at a time. If the page doesn't handle a key itself
   * (keydown not cancelled), we perform the browser's default insertion.
   * @param {HTMLInputElement|HTMLTextAreaElement} el
   * @param {string} text
   * @param {number} [perKeyDelay=10]
   */
  async function typeText(el, text, perKeyDelay = 10) {
    for (const ch of String(text)) {
      const notCancelled = el.dispatchEvent(keyEvent('keydown', ch));
      el.dispatchEvent(keyEvent('keypress', ch));
      if (notCancelled) {
        setNativeValue(el, (el.value || '') + ch);
        el.dispatchEvent(new InputEvent('input', { bubbles: true, data: ch, inputType: 'insertText' }));
      }
      el.dispatchEvent(keyEvent('keyup', ch));
      if (perKeyDelay) await delay(perKeyDelay);
    }
  }

  // ─── Values ────────────────────────────────────────────────────

  /**
   * Set a form control's value through the native prototype setter so frameworks that track
   * values (React's value tracker) notice the change on the next input event.
   * @param {HTMLInputElement|HTMLTextAreaElement|HTMLSelectElement} el
   * @param {string} value
   */
  function setNativeValue(el, value) {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype
      : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype
      : HTMLInputElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
    if (descriptor && descriptor.set) {
      descriptor.set.call(el, value);
    } else {
      el.value = value;
    }
  }

  // ─── Native Control Fillers ────────────────────────────────────

  /**
   * Fill a text input or textarea the way a person would: focus, set, input, change, blur.
   * @param {HTMLInputElement|HTMLTextAreaElement} el
   * @param {string} value
   * @returns {Promise<{ success: boolean, note: string }>}
   */
  async function fillText(el, value) {
    const text = String(value);
    if (el.value === text) return { success: true, note: '' };

    scrollIntoView(el);
    focus(el);
    setNativeValue(el, text);
    el.dispatchEvent(new InputEvent('input', { bubbles: true, data: text, inputType: 'insertText' }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    await delay(30);

    // Masked inputs (phone numbers) sometimes reject a bulk value; type it instead
    if (el.value !== text && digitsOf(el.value) !== digitsOf(text)) {
      setNativeValue(el, '');
      el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward' }));
      await typeText(el, text);
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }

    blur(el);
    await delay(30);

    const current = el.value || '';
    if (current === text) return { success: true, note: '' };
    if (current && digitsOf(current) && digitsOf(current) === digitsOf(text)) {
      return { success: true, note: '' }; // Same number, portal applied its own formatting
    }
    if (current.trim()) return { success: true, note: `Portal changed the value to "${current}"` };
    return { success: false, note: 'Value did not stick' };
  }

  /**
   * Fill a contenteditable rich-text editor.
   * @param {HTMLElement} el
   * @param {string} value
   * @returns {Promise<{ success: boolean, note: string }>}
   */
  async function fillRichText(el, value) {
    const text = String(value);
    scrollIntoView(el);
    focus(el);

    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(el);
    selection.removeAllRanges();
    selection.addRange(range);

    // execCommand keeps editors (Draft.js, Quill, ProseMirror) in sync with their own models
    const inserted = document.execCommand && document.execCommand('insertText', false, text);
    if (!inserted) {
      el.textContent = text;
      el.dispatchEvent(new InputEvent('input', { bubbles: true, data: text, inputType: 'insertText' }));
    }
    blur(el);
    await delay(30);

    const ok = getText(el).length > 0;
    return { success: ok, note: ok ? '' : 'Rich text editor stayed empty' };
  }

  /**
   * Check or uncheck a native or ARIA checkbox.
   * @param {HTMLElement} el
   * @param {boolean} shouldBeChecked
   * @returns {Promise<{ success: boolean, note: string }>}
   */
  async function setCheckbox(el, shouldBeChecked) {
    const isChecked = () => (el.getAttribute('role') === 'checkbox' && !('checked' in el))
      ? el.getAttribute('aria-checked') === 'true'
      : !!el.checked;

    if (isChecked() === shouldBeChecked) return { success: true, note: '' };

    scrollIntoView(el);
    el.click();
    await waitFor(() => isChecked() === shouldBeChecked, { timeout: 1000 });

    if (isChecked() !== shouldBeChecked) {
      // Styled checkboxes sometimes only react to their label
      const label = el.id ? document.querySelector(`label[for="${CSS.escape(el.id)}"]`) : el.closest('label');
      if (label) {
        label.click();
        await waitFor(() => isChecked() === shouldBeChecked, { timeout: 1000 });
      }
    }

    const ok = isChecked() === shouldBeChecked;
    return { success: ok, note: ok ? '' : 'Checkbox did not change' };
  }

  /**
   * Pick a radio option whose label best matches the value.
   * @param {HTMLElement[]} radios - Radio inputs (or role="radio" elements) in one group
   * @param {string|string[]} values - The answer, or its wordings best first
   * @param {Function} labelOf - Returns the label text for a radio
   * @returns {Promise<{ success: boolean, note: string }>}
   */
  async function chooseRadio(radios, values, labelOf) {
    const candidates = (Array.isArray(values) ? values : [values]).map(String);
    const options = radios.map(el => ({ el, text: labelOf(el) || el.value || '' }));
    const match = OriginFillFuzzyMatch.pickOption(options, candidates);
    if (!match) {
      return { success: false, note: `No option matches "${candidates[0]}" (options: ${options.map(o => o.text).join(', ')})` };
    }

    if (isChecked(match.el)) return { success: true, note: '' };

    scrollIntoView(match.el);
    match.el.click();
    await waitFor(() => isChecked(match.el), { timeout: 1000 });
    const ok = isChecked(match.el);
    return { success: ok, note: ok ? '' : 'Radio selection did not stick' };
  }

  /**
   * Tick the box(es) in a group whose labels match the answer, e.g. "No, I do not have a
   * disability…" on a self-identification form. Several answers can be comma separated.
   * @param {HTMLElement[]} boxes
   * @param {string[]} values - The answer, or its wordings best first
   * @param {Function} labelOf
   * @returns {Promise<{ success: boolean, note: string }>}
   */
  async function chooseCheckboxes(boxes, values, labelOf) {
    const candidates = (Array.isArray(values) ? values : [values]).map(String);
    const options = boxes.map(el => ({ el, text: labelOf(el) || el.value || '' }));
    const answers = candidates.length === 1 && candidates[0].includes(',')
      ? candidates[0].split(',').map(a => [a.trim()])
      : [candidates];

    const missing = [];
    for (const wordings of answers) {
      const match = OriginFillFuzzyMatch.pickOption(options, wordings);
      if (!match) {
        missing.push(wordings[0]);
        continue;
      }
      if (!isChecked(match.el)) {
        const result = await setCheckbox(match.el, true);
        if (!result.success) missing.push(wordings[0]);
      }
    }

    if (missing.length === answers.length) {
      return { success: false, note: `No option matches "${missing[0]}" (options: ${options.map(o => o.text).join(', ')})` };
    }
    return { success: true, note: missing.length ? `Not found: ${missing.join(', ')}` : '' };
  }

  function isChecked(el) {
    return ('checked' in el) ? !!el.checked : el.getAttribute('aria-checked') === 'true';
  }

  /**
   * Select the <option> that best matches the value.
   * @param {HTMLSelectElement} select
   * @param {string|string[]} values - Value plus aliases, in priority order
   * @param {{ allowOther?: boolean }} [options] - allowOther: pick "Other" / "Not listed" when
   *   nothing matches (colleges and courses a form doesn't list)
   * @returns {Promise<{ success: boolean, note: string, usedOther?: boolean }>}
   */
  async function selectNativeOption(select, values, { allowOther = false, fieldType } = {}) {
    const candidates = (Array.isArray(values) ? values : [values]).map(String);
    const options = Array.from(select.options)
      .filter(o => !o.disabled && o.value !== '')
      .map(o => ({ el: o, text: o.textContent.trim() }));

    const match = OriginFillFuzzyMatch.pickOption(options, candidates, { fieldType }) ||
      (allowOther ? OriginFillFuzzyMatch.pickOtherOption(options) : null);
    if (!match) return { success: false, note: `No option matches "${candidates[0]}"` };
    const usedOther = match.confidence === 'other';
    const otherNote = `"${candidates[0]}" isn't in the list — chose "${match.text}"`;
    if (select.value === match.el.value) return usedOther ? { success: true, usedOther, note: otherNote } : { success: true, note: '' };

    scrollIntoView(select);
    focus(select);
    setNativeValue(select, match.el.value);
    select.dispatchEvent(new Event('input', { bubbles: true }));
    select.dispatchEvent(new Event('change', { bubbles: true }));
    blur(select);
    await delay(30);

    const ok = select.value === match.el.value;
    if (!ok) return { success: false, note: 'Selection did not stick' };
    if (usedOther) return { success: true, usedOther, note: otherNote };
    return { success: true, note: match.confidence === 'exact' ? '' : `Selected "${match.text}"` };
  }

  // ─── Bug reports ───────────────────────────────────────────────

  // Attributes that can carry what the person typed or picked are left out
  const SKETCH_SKIP = new Set(['value', 'title', 'aria-label', 'aria-valuetext', 'aria-valuenow', 'alt', 'data-value', 'style']);

  /**
   * A value-free outline of an element's markup for bug reports, e.g.
   * span.select2[role=combobox]{ul.select2-results__options[role=listbox]{…}}. Tag names,
   * classes and structural attributes only: no text, no values.
   * @param {Element} el
   * @param {number} [depth=2]
   * @returns {string}
   */
  function sketch(el, depth = 2) {
    if (!el || !el.tagName) return '';
    const classes = Array.from(el.classList || []).slice(0, 3).map(c => `.${c}`).join('');
    const attrs = Array.from(el.attributes || [])
      .filter(a => !SKETCH_SKIP.has(a.name) && a.name !== 'class' && a.name !== 'id' && !a.name.startsWith('on'))
      .slice(0, 6)
      .map(a => `[${a.name}${/^(role|type|aria-[a-z]+|data-[a-z0-9-]+)$/.test(a.name) ? `=${a.value.slice(0, 30)}` : ''}]`)
      .join('');
    const kids = depth > 0 ? Array.from(el.children).slice(0, 6).map(child => sketch(child, depth - 1)).filter(Boolean) : [];
    const more = el.children.length > 6 ? ' …' : '';
    return `${el.tagName.toLowerCase()}${classes}${attrs}${kids.length ? `{${kids.join(' ')}${more}}` : ''}`;
  }

  // ─── Files ─────────────────────────────────────────────────────

  /**
   * Build a File from base64 data.
   * @param {{ fileName: string, fileData: string, mimeType?: string }} data
   * @returns {File}
   */
  function base64ToFile({ fileName, fileData, mimeType }) {
    const binary = atob(fileData);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new File([bytes], fileName, { type: mimeType || guessMimeType(fileName) });
  }

  function guessMimeType(fileName) {
    const ext = (fileName.split('.').pop() || '').toLowerCase();
    return {
      pdf: 'application/pdf',
      doc: 'application/msword',
      docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      rtf: 'application/rtf',
      txt: 'text/plain'
    }[ext] || 'application/octet-stream';
  }

  /**
   * Attach a file to a file input (or drop it on a drop zone when there's no input).
   * @param {HTMLInputElement|null} input
   * @param {HTMLElement|null} dropZone
   * @param {File} file
   */
  function attachFile(input, dropZone, file) {
    const dt = new DataTransfer();
    dt.items.add(file);

    if (input) {
      input.files = dt.files;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return;
    }

    for (const type of ['dragenter', 'dragover', 'drop']) {
      dropZone.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, composed: true, dataTransfer: dt }));
    }
  }

  // ─── Utility ───────────────────────────────────────────────────

  function digitsOf(str) {
    return String(str || '').replace(/\D/g, '');
  }

  // ─── Public API ─────────────────────────────────────────────────
  return Object.freeze({
    delay,
    waitFor,
    isVisible,
    getText,
    cleanLabel,
    scrollIntoView,
    focus,
    blur,
    click,
    pressKey,
    typeText,
    setNativeValue,
    fillText,
    fillRichText,
    setCheckbox,
    chooseRadio,
    chooseCheckboxes,
    selectNativeOption,
    sketch,
    base64ToFile,
    attachFile
  });
})();
