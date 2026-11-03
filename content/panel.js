/**
 * OriginFill — In-Page Autofill Panel
 * A small floating control on application pages: one click fills the current step, shows
 * progress, and lists what still needs your attention (click an item to jump to the field).
 * Rendered in a shadow root so the portal's CSS can't affect it (and it can't affect the portal).
 *
 * @license AGPL-3.0
 * @author CharyWorld
 */

var OriginFillPanel = (() => {
  'use strict';

  /** @type {HTMLElement|null} */
  let _host = null;

  /** @type {ShadowRoot|null} */
  let _root = null;

  /** @type {Object} Callbacks supplied by init.js */
  let _handlers = {};

  /** @type {boolean} User closed the panel for this page */
  let _dismissed = false;

  /** @type {Object|null} */
  let _recovery = null;

  const STYLES = `
    :host { all: initial; }
    * { box-sizing: border-box; }
    .wrap {
      --font: -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'SF Pro Display', 'Helvetica Neue', 'Segoe UI', system-ui, sans-serif;
      --text: #0B1220; --muted: rgba(11, 18, 32, 0.64); --faint: rgba(11, 18, 32, 0.46); --hairline: rgba(11, 18, 32, 0.09);
      --glass: rgba(255, 255, 255, 0.58); --glass-soft: rgba(255, 255, 255, 0.4); --glass-strong: rgba(255, 255, 255, 0.78);
      --stroke: rgba(255, 255, 255, 0.78);
      --sheen: linear-gradient(160deg, rgba(255, 255, 255, 0.6) 0%, rgba(255, 255, 255, 0) 42%);
      --edge: inset 0 1px 0 rgba(255, 255, 255, 0.95), inset 0 -1px 0 rgba(255, 255, 255, 0.35);
      --shadow: 0 22px 60px rgba(15, 23, 42, 0.22), 0 3px 10px rgba(15, 23, 42, 0.1);
      --blur: blur(30px) saturate(190%);
      --tile: rgba(120, 120, 128, 0.1);
      --blue: #0A84FF; --violet: #5E5CE6; --green: #248A3D; --orange: #B25000; --red: #D70015;
      --spring: cubic-bezier(0.2, 0.8, 0.2, 1);
      position: fixed; right: 20px; bottom: 20px; z-index: 2147483646;
      font: 13px/1.45 var(--font); color: var(--text);
      display: flex; flex-direction: column; align-items: flex-end; gap: 10px;
      -webkit-font-smoothing: antialiased;
    }
    @media (prefers-color-scheme: dark) {
      .wrap {
        --text: #F4F6FB; --muted: rgba(244, 246, 251, 0.7); --faint: rgba(244, 246, 251, 0.5); --hairline: rgba(255, 255, 255, 0.1);
        --glass: rgba(26, 29, 40, 0.84); --glass-soft: rgba(255, 255, 255, 0.07); --glass-strong: rgba(52, 56, 72, 0.86);
        --stroke: rgba(255, 255, 255, 0.14);
        --sheen: linear-gradient(160deg, rgba(255, 255, 255, 0.12) 0%, rgba(255, 255, 255, 0) 42%);
        --edge: inset 0 1px 0 rgba(255, 255, 255, 0.16), inset 0 -1px 0 rgba(255, 255, 255, 0.04);
        --shadow: 0 22px 60px rgba(0, 0, 0, 0.55), 0 3px 10px rgba(0, 0, 0, 0.35);
        --green: #30D158; --orange: #FFB340; --red: #FF6961;
      }
    }
    @media (prefers-reduced-transparency: reduce) {
      .wrap { --glass: rgba(255, 255, 255, 0.96); --glass-soft: rgba(242, 244, 248, 0.96); --blur: none; }
    }

    /* Glass card */
    .card {
      width: 340px; max-height: min(460px, 70vh); overflow: auto; padding: 16px;
      border-radius: 26px; border: 1px solid var(--stroke);
      background: var(--sheen), var(--glass);
      backdrop-filter: var(--blur); -webkit-backdrop-filter: var(--blur);
      box-shadow: var(--shadow), var(--edge);
      animation: rise 320ms var(--spring);
      scrollbar-width: thin;
    }
    .card[hidden], .pill[hidden] { display: none; }
    .row { display: flex; align-items: center; gap: 8px; }
    .title { font-weight: 700; font-size: 15px; letter-spacing: -0.01em; flex: 1; }
    .muted { color: var(--muted); }
    p { margin: 6px 0 0; }

    /* Floating capsule */
    .pill {
      display: inline-flex; align-items: center; gap: 9px; height: 48px; padding: 0 22px 0 16px;
      border-radius: 999px; border: 1px solid rgba(255, 255, 255, 0.55); cursor: pointer;
      font: 650 14px/1 var(--font); letter-spacing: -0.005em; color: #fff;
      background:
        linear-gradient(180deg, rgba(255, 255, 255, 0.38) 0%, rgba(255, 255, 255, 0) 52%),
        linear-gradient(135deg, rgba(10, 132, 255, 0.94) 0%, rgba(94, 92, 230, 0.92) 115%);
      backdrop-filter: var(--blur); -webkit-backdrop-filter: var(--blur);
      box-shadow:
        0 12px 32px rgba(10, 132, 255, 0.38), 0 3px 8px rgba(10, 132, 255, 0.22),
        inset 0 1px 0 rgba(255, 255, 255, 0.7), inset 0 -3px 8px rgba(0, 40, 120, 0.25);
      text-shadow: 0 1px 1px rgba(0, 40, 120, 0.3);
      transition: transform 260ms var(--spring), box-shadow 260ms var(--spring), filter 200ms;
    }
    .pill:hover { transform: translateY(-2px) scale(1.02); filter: brightness(1.05); }
    .pill:active { transform: scale(0.96); }
    .pill:disabled { cursor: default; }
    .pill:focus-visible, button:focus-visible { outline: 3px solid rgba(10, 132, 255, 0.5); outline-offset: 3px; }
    #pillIcon { display: grid; place-items: center; width: 22px; height: 22px; border-radius: 50%; background: rgba(255, 255, 255, 0.22); box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.5); font-size: 12px; }

    .close-pill {
      display: grid; place-items: center; width: 30px; height: 30px; border-radius: 50%; cursor: pointer;
      border: 1px solid var(--stroke); color: var(--muted); font-size: 12px;
      background: var(--sheen), var(--glass);
      backdrop-filter: var(--blur); -webkit-backdrop-filter: var(--blur);
      box-shadow: 0 6px 16px rgba(15, 23, 42, 0.14), var(--edge);
      transition: transform 200ms var(--spring), color 200ms;
    }
    .close-pill:hover { color: var(--text); transform: scale(1.06); }
    .icon-btn {
      display: grid; place-items: center; width: 28px; height: 28px; border-radius: 50%; cursor: pointer;
      border: 1px solid var(--stroke); background: var(--glass-soft); color: var(--muted); font-size: 12px; box-shadow: var(--edge);
    }
    .icon-btn:hover { background: var(--glass-strong); color: var(--text); }

    /* Buttons */
    .btn {
      height: 34px; padding: 0 16px; border-radius: 999px; cursor: pointer; white-space: nowrap;
      border: 1px solid var(--stroke); background: var(--sheen), var(--glass-soft); box-shadow: var(--edge);
      font: 600 12.5px/1 var(--font); color: var(--text);
      transition: transform 200ms var(--spring), background-color 200ms;
    }
    .btn:hover { background-color: var(--glass-strong); transform: translateY(-1px); }
    .btn:active { transform: scale(0.97); }
    .btn.primary {
      color: #fff; border-color: rgba(255, 255, 255, 0.5);
      background: linear-gradient(180deg, rgba(255, 255, 255, 0.32) 0%, rgba(255, 255, 255, 0) 52%), linear-gradient(135deg, var(--blue), var(--violet) 120%);
      box-shadow: 0 6px 16px rgba(10, 132, 255, 0.32), inset 0 1px 0 rgba(255, 255, 255, 0.6);
    }
    .actions { display: flex; flex-wrap: wrap; gap: 6px; justify-content: flex-end; margin-top: 14px; }
    .actions .btn { padding: 0 12px; }

    /* Progress */
    .bar { height: 8px; border-radius: 999px; overflow: hidden; margin: 12px 0 8px; background: var(--glass-soft); border: 1px solid var(--stroke); box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.06); }
    .bar > div { height: 100%; border-radius: inherit; width: 0; background: linear-gradient(90deg, var(--blue), var(--violet)); box-shadow: 0 0 12px rgba(10, 132, 255, 0.55); transition: width 240ms var(--spring); }

    /* Result tiles */
    .stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; margin: 12px 0 4px; }
    .stat { text-align: center; padding: 8px 4px; border-radius: 16px; background: var(--sheen), var(--tile); border: 1px solid var(--stroke); box-shadow: var(--edge); }
    .stat b { display: block; font-size: 19px; letter-spacing: -0.02em; font-variant-numeric: tabular-nums; }
    .stat span { font-size: 10.5px; font-weight: 600; color: var(--faint); }
    .ok b { color: var(--green); } .warn b { color: var(--orange); } .bad b { color: var(--red); }

    /* Lists */
    ul { list-style: none; margin: 4px 0 0; padding: 0; }
    li + li { border-top: 1px solid var(--hairline); }
    li button.item { all: unset; display: block; width: 100%; padding: 8px 4px; cursor: pointer; box-sizing: border-box; border-radius: 10px; }
    li button.item:hover { background: var(--glass-soft); }
    li button.item:hover .name { text-decoration: underline; }
    li button.item:focus-visible { outline: 2px solid var(--blue); }

    /* One-tap answers for common questions */
    .answers { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; padding: 0 4px 9px; }
    .chip {
      height: 26px; padding: 0 12px; border-radius: 999px; cursor: pointer;
      border: 1px solid var(--stroke); background: var(--sheen), var(--glass-soft); box-shadow: var(--edge);
      font: 600 12px/1 var(--font); color: var(--text);
      transition: transform 160ms var(--spring), background-color 160ms;
    }
    .chip:hover { background-color: var(--glass-strong); transform: translateY(-1px); }
    .chip:focus-visible { outline: 2px solid var(--blue); outline-offset: 1px; }
    .chip.primary { color: #fff; border-color: transparent; background: linear-gradient(135deg, var(--blue), var(--violet) 120%); }
    .chip:disabled { opacity: 0.55; cursor: default; transform: none; }
    .chip-input {
      flex: 1 1 140px; min-width: 0; height: 26px; padding: 0 10px; border-radius: 999px; box-sizing: border-box;
      border: 1px solid var(--stroke); background: var(--glass-soft); color: var(--text); font: 500 12px/1 var(--font);
    }
    .chip-input:focus { outline: 2px solid var(--blue); outline-offset: 0; }
    .answers-hint { flex-basis: 100%; font-size: 10.5px; color: var(--faint); }
    .answers-hint:empty { display: none; }
    .answers[data-state="error"] .answers-hint { color: var(--red); }
    .name { font-weight: 600; }
    .note { display: block; font-size: 11.5px; color: var(--muted); margin-top: 1px; }
    .tag { display: inline-block; font-size: 10px; font-weight: 700; letter-spacing: 0.02em; border-radius: 999px; padding: 2px 7px; margin-right: 6px; vertical-align: 1px; }
    .tag.attention { background: rgba(255, 149, 0, 0.16); color: var(--orange); }
    .tag.failed { background: rgba(255, 59, 48, 0.14); color: var(--red); }
    .tag.skipped { background: rgba(120, 120, 128, 0.16); color: var(--muted); }
    .section-title { font-size: 10.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.07em; color: var(--faint); margin-top: 12px; }

    .spinner { width: 14px; height: 14px; border-radius: 50%; border: 2px solid rgba(255, 255, 255, 0.4); border-top-color: #fff; animation: spin 0.8s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }
    @keyframes rise { from { opacity: 0; transform: translateY(10px) scale(0.98); } to { opacity: 1; transform: none; } }
    @media (prefers-reduced-motion: reduce) { .spinner, .card { animation: none; } .bar > div, .pill, .btn, .close-pill { transition: none; } }
  `;

  // ─── Mount / Unmount ───────────────────────────────────────────

  /**
   * Create the panel (hidden until show() is called).
   * @param {{ onFill: Function, onCancel: Function, onRestore: Function, onDismissRecovery: Function, onOpenSettings: Function }} handlers
   */
  function mount(handlers) {
    _handlers = handlers || {};
    if (_host && _host.isConnected) return;

    _host = document.createElement('div');
    _host.setAttribute('data-originfill-ui', '');
    _host.id = 'originfill-panel-host';
    _root = _host.attachShadow({ mode: 'open' });
    _root.innerHTML = `
      <style>${STYLES}</style>
      <div class="wrap" role="region" aria-label="OriginFill autofill" hidden>
        <div class="card" id="card" hidden></div>
        <div class="row">
          <button class="close-pill" id="hide" title="Hide OriginFill on this page" aria-label="Hide OriginFill on this page">✕</button>
          <button class="pill" id="pill" type="button">
            <span id="pillIcon" aria-hidden="true">⚡</span><span id="pillText">Autofill</span>
          </button>
        </div>
      </div>
    `;

    $('pill').addEventListener('click', onPillClick);
    window.addEventListener('scroll', queueReposition, { passive: true, capture: true });
    window.addEventListener('resize', queueReposition, { passive: true });
    $('hide').addEventListener('click', () => {
      _dismissed = true;
      hide();
    });

    (document.body || document.documentElement).appendChild(_host);
  }

  function unmount() {
    window.removeEventListener('scroll', queueReposition, { capture: true });
    window.removeEventListener('resize', queueReposition);
    if (_host) _host.remove();
    _host = null;
    _root = null;
  }

  function $(id) {
    return _root ? _root.getElementById(id) : null;
  }

  function wrap() {
    return _root ? _root.querySelector('.wrap') : null;
  }

  // ─── Visibility ────────────────────────────────────────────────

  /**
   * Show the panel unless the user hid it on this page.
   * @param {{ label?: string, text?: string, needsSetup?: boolean }} [options]
   */
  function show({ label, text, needsSetup } = {}) {
    if (!_root || _dismissed) return;
    if (_host && !_host.isConnected) (document.body || document.documentElement).appendChild(_host);
    wrap().hidden = false;
    setIdle({ label, text, needsSetup });
    queueReposition();
  }

  function hide() {
    if (wrap()) wrap().hidden = true;
  }

  /**
   * Move up when the page's own bottom buttons (Workday's "Save and Continue" footer, a sticky
   * Submit bar) sit under the panel.
   */
  function reposition() {
    const el = wrap();
    if (!el || el.hidden) return;

    const blockers = document.querySelectorAll(
      '[data-automation-id="bottom-navigation-next-button"], [data-automation-id="bottom-navigation-back-button"], ' +
      '[data-automation-id="pageFooterNextButton"], [data-automation-id="pageFooterBackButton"], ' +
      'button[type="submit"], [data-automation-id="bottom-navigation-footer"]'
    );
    const panelWidth = 360;
    let bottom = 20;
    blockers.forEach(b => {
      if (b.closest('[data-originfill-ui]')) return;
      const r = b.getBoundingClientRect();
      const nearBottom = r.height > 0 && r.top < window.innerHeight && r.bottom > window.innerHeight - 160;
      const underPanel = r.right > window.innerWidth - panelWidth;
      if (nearBottom && underPanel) bottom = Math.max(bottom, window.innerHeight - r.top + 12);
    });
    el.style.bottom = `${Math.min(bottom, window.innerHeight - 80)}px`;
  }

  let _repositionQueued = false;
  function queueReposition() {
    if (_repositionQueued) return;
    _repositionQueued = true;
    requestAnimationFrame(() => {
      _repositionQueued = false;
      reposition();
    });
  }

  function isVisible() {
    return !!(wrap() && !wrap().hidden);
  }

  /** Re-allow the panel after navigation to a new page. */
  function resetDismissal() {
    _dismissed = false;
  }

  /** Hide the report/progress card (e.g. when moving to the next application step). */
  function clearCard() {
    const card = $('card');
    if (card && _mode !== 'filling') card.hidden = true;
  }

  // ─── States ────────────────────────────────────────────────────

  let _mode = 'idle';
  let _needsSetup = false;

  function setIdle({ label, text, needsSetup } = {}) {
    _mode = 'idle';
    _needsSetup = !!needsSetup;
    const pill = $('pill');
    if (!pill) return;
    pill.disabled = false;
    $('pillIcon').innerHTML = _needsSetup ? '⚙️' : '⚡';
    $('pillText').textContent = _needsSetup ? 'Set up OriginFill' : (text || (label ? `Autofill ${label}` : 'Autofill this page'));
    pill.title = _needsSetup ? 'Add your details once, then fill applications in one click' : 'Fill this page with your OriginFill profile';
    if (_recovery) renderRecovery();
  }

  function onPillClick() {
    if (_mode === 'filling') {
      if (_handlers.onCancel) _handlers.onCancel();
      return;
    }
    if (_needsSetup) {
      if (_handlers.onOpenSettings) _handlers.onOpenSettings();
      return;
    }
    if (_handlers.onFill) _handlers.onFill();
  }

  /**
   * Show fill progress.
   * @param {number} current
   * @param {number} total
   * @param {string} fieldName
   */
  function showProgress(current, total, fieldName) {
    if (!_root) return;
    _mode = 'filling';
    const pill = $('pill');
    $('pillIcon').innerHTML = '<span class="spinner"></span>';
    $('pillText').textContent = total > 0 ? `Filling ${current}/${total} · Stop` : 'Preparing… · Stop';
    pill.title = 'Stop filling';

    const card = $('card');
    const pct = total > 0 ? Math.round((current / total) * 100) : 5;
    card.hidden = false;
    card.innerHTML = `
      <div class="row"><div class="title">Filling this page…</div></div>
      <div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><div style="width:${pct}%"></div></div>
      <div class="muted" id="current"></div>
    `;
    card.querySelector('#current').textContent = fieldName || '';
  }

  /**
   * Show the result of a fill.
   * @param {Object} report
   * @param {HTMLElement[]} elements - Field elements in report.results order
   */
  function showReport(report, elements = []) {
    if (!_root) return;
    setIdle({ label: '' });
    $('pillText').textContent = 'Autofill again';

    const card = $('card');
    card.hidden = false;
    queueReposition();

    if (!report || report.status === 'no_fields') {
      card.innerHTML = `
        <div class="row"><div class="title">No fields found</div><button class="icon-btn" id="close" aria-label="Close">✕</button></div>
        <p class="muted">OriginFill couldn't find application fields on this page yet. If the form is still loading, try again in a moment.</p>
      `;
      card.querySelector('#close').addEventListener('click', () => { card.hidden = true; });
      return;
    }

    if ((report.results || []).length === 0) {
      card.innerHTML = `
        <div class="row"><div class="title">Nothing filled</div><button class="icon-btn" id="close" aria-label="Close">✕</button></div>
        <p class="muted">OriginFill didn't recognise the fields on this page${report.unrecognizedCount ? ` (${report.unrecognizedCount} looked at)` : ''}. If they're ordinary questions like name or email, please report the site: turn on <b>Debug logging</b> in Settings, try again, and send the [OriginFill] lines from the console.</p>
      `;
      card.querySelector('#close').addEventListener('click', () => { card.hidden = true; });
      return;
    }

    const indexed = (report.results || []).map((r, i) => ({ ...r, element: elements[i] || null }));
    const review = indexed.filter(r => r.status === OriginFillStatus.ATTENTION || r.status === OriginFillStatus.FAILED);
    const skipped = indexed.filter(r => r.status === OriginFillStatus.SKIPPED);
    const filled = report.successCount + report.attentionCount;

    card.innerHTML = `
      <div class="row">
        <div class="title">${filled > 0 ? `Filled ${filled} field${filled === 1 ? '' : 's'}` : 'Nothing filled'}</div>
        <span class="muted">${escapeHtml(report.elapsedFormatted || '')}</span>
        <button class="icon-btn" id="close" aria-label="Close">✕</button>
      </div>
      <div class="stats">
        <div class="stat ok"><b>${report.successCount}</b><span>Filled</span></div>
        <div class="stat warn"><b>${report.attentionCount}</b><span>Review</span></div>
        <div class="stat bad"><b>${report.failedCount}</b><span>Failed</span></div>
        <div class="stat"><b>${report.skippedCount}</b><span>Skipped</span></div>
      </div>
      <div id="lists"></div>
      <p class="muted" style="margin:10px 0 0">Check the page, then click <b>Save and Continue</b> yourself — OriginFill never submits for you.</p>
      <div class="actions">
        ${indexed.some(r => r.debug) ? '<button class="btn" id="copyDetails" title="Copies how these fields are built (no values) for a bug report">Copy details</button>' : ''}
        ${skipped.some(r => /profile|settings/i.test(r.note || '')) ? '<button class="btn" id="settings">Open Settings</button>' : ''}
        <button class="btn primary" id="done">Done</button>
      </div>
    `;

    const lists = card.querySelector('#lists');
    if (review.length) lists.appendChild(renderList('Needs a look', review));
    if (skipped.length) lists.appendChild(renderList('Fill these yourself', skipped));

    card.querySelector('#close').addEventListener('click', () => { card.hidden = true; });
    card.querySelector('#done').addEventListener('click', () => { card.hidden = true; });
    const copy = card.querySelector('#copyDetails');
    if (copy) copy.addEventListener('click', () => copyDetails(report, indexed, copy));
    const settings = card.querySelector('#settings');
    if (settings) {
      const section = skipped.some(r => /common questions/i.test(r.note || '')) ? 'answers' : 'personal';
      settings.addEventListener('click', () => _handlers.onOpenSettings && _handlers.onOpenSettings(section));
    }
  }

  function renderList(title, rows) {
    const frag = document.createDocumentFragment();
    const heading = document.createElement('div');
    heading.className = 'section-title';
    heading.textContent = `${title} (${rows.length})`;
    frag.appendChild(heading);

    const ul = document.createElement('ul');
    rows.forEach(r => {
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'item';
      const tag = r.status === OriginFillStatus.FAILED ? 'failed' : r.status === OriginFillStatus.ATTENTION ? 'attention' : 'skipped';
      const tagText = tag === 'failed' ? 'Failed' : tag === 'attention' ? 'Check' : 'To do';
      btn.innerHTML = `<span class="tag ${tag}">${tagText}</span><span class="name"></span><span class="note"></span>`;
      btn.querySelector('.name').textContent = r.field;
      const answerable = r.faq && _handlers.onAnswer && !rows.some(o => o !== r && o.faq && o.faq.id === r.faq.id && rows.indexOf(o) < rows.indexOf(r));
      btn.querySelector('.note').textContent = r.faq && _handlers.onAnswer
        ? (answerable ? 'Answer once here — OriginFill remembers it:' : 'Answered by the question above')
        : (r.note || '');
      btn.title = r.element ? 'Show this field' : '';
      btn.addEventListener('click', () => highlight(r.element));
      li.appendChild(btn);
      if (answerable) li.appendChild(answerChips(r, rows));
      ul.appendChild(li);
    });
    frag.appendChild(ul);
    return frag;
  }

  /**
   * One-tap answers for a common question ("Do you have a disability?" → No / Yes / Prefer not
   * to say), or a box for a typed one ("Notice period"). The answer is saved to the profile for
   * every future application, and the questions it answers are filled straight away.
   * @param {Object} row - Report row with a `faq` prompt
   * @param {Object[]} rows - All rows of the list (the same question can appear twice)
   */
  function answerChips(row, rows) {
    const box = document.createElement('div');
    box.className = 'answers';
    const elements = rows.filter(r => r.faq && r.faq.id === row.faq.id && r.element).map(r => r.element);
    // Only says something while saving, or if saving failed
    const hint = document.createElement('span');
    hint.className = 'answers-hint';

    const send = async (answer) => {
      box.querySelectorAll('button, input').forEach(el => { el.disabled = true; });
      box.dataset.state = 'saving';
      hint.textContent = 'Saving and filling…';
      const ok = await _handlers.onAnswer(row.faq.id, answer, elements);
      if (!ok) {
        box.dataset.state = 'error';
        hint.textContent = 'Couldn\'t save that — try again, or answer it in Settings';
        box.querySelectorAll('button, input').forEach(el => { el.disabled = false; });
      }
    };

    if (row.faq.choices && row.faq.choices.length) {
      row.faq.choices.forEach(choice => {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'chip';
        chip.textContent = choice;
        chip.addEventListener('click', () => send(choice));
        box.appendChild(chip);
      });
    } else {
      const input = document.createElement('input');
      input.className = 'chip-input';
      input.placeholder = row.faq.placeholder ? `e.g. ${row.faq.placeholder}` : 'Your answer';
      input.setAttribute('aria-label', row.faq.question);
      const save = document.createElement('button');
      save.type = 'button';
      save.className = 'chip primary';
      save.textContent = 'Save';
      const submit = () => { if (input.value.trim()) send(input.value.trim()); };
      save.addEventListener('click', submit);
      // Keep typing inside the panel: some sites react to keys anywhere on the page
      ['keydown', 'keypress', 'keyup'].forEach(type => input.addEventListener(type, (e) => {
        e.stopPropagation();
        if (type === 'keydown' && e.key === 'Enter') submit();
      }));
      box.append(input, save);
    }
    box.appendChild(hint);
    return box;
  }

  /**
   * Copy what the fields that failed look like (tags and structure, no values) for a bug report.
   */
  async function copyDetails(report, rows, button) {
    const lines = [
      `OriginFill ${chrome.runtime.getManifest().version} · ${location.hostname} · ${report.portalName || ''}`,
      ...rows.filter(r => r.debug).map(r => `• ${r.field} — ${r.note || r.status}\n  ${r.debug}`)
    ];
    const text = lines.join('\n');
    let copied = false;
    try {
      await navigator.clipboard.writeText(text);
      copied = true;
    } catch (e) {
      // Pages can block the clipboard API; a selected textarea still copies
      const area = document.createElement('textarea');
      area.value = text;
      _root.appendChild(area);
      area.select();
      copied = document.execCommand('copy');
      area.remove();
    }
    button.textContent = copied ? 'Copied — paste it in your bug report' : 'Couldn\'t copy';
  }

  /**
   * Scroll to a field and outline it briefly.
   * @param {HTMLElement|null} element
   */
  function highlight(element) {
    if (!element || !element.isConnected) return;
    const target = element.closest('[data-automation-id^="formField-"]') || element;
    target.scrollIntoView({ block: 'center', behavior: 'smooth' });
    const previous = target.style.outline;
    const previousOffset = target.style.outlineOffset;
    target.style.outline = '3px solid #F59E0B';
    target.style.outlineOffset = '3px';
    setTimeout(() => {
      target.style.outline = previous;
      target.style.outlineOffset = previousOffset;
    }, 2500);
    try { element.focus({ preventScroll: true }); } catch (e) { /* not focusable */ }
  }

  // ─── Session Recovery ──────────────────────────────────────────

  /**
   * Offer to restore fields saved before a session timeout.
   * @param {Object} recovery - From OriginFillSessionGuard.checkRecoveryAvailable()
   */
  function showRecovery(recovery) {
    _recovery = recovery;
    if (isVisible()) renderRecovery();
  }

  function hideRecovery() {
    _recovery = null;
    const card = $('card');
    if (card && card.dataset.kind === 'recovery') card.hidden = true;
  }

  function renderRecovery() {
    const card = $('card');
    if (!card || !_recovery || _mode === 'filling') return;
    const count = _recovery.restorableCount || Object.keys(_recovery.savedFields || {}).length;
    card.dataset.kind = 'recovery';
    card.hidden = false;
    card.innerHTML = `
      <div class="row"><div class="title">Restore your answers?</div></div>
      <p class="muted" style="margin:6px 0 0">OriginFill saved ${count} field${count === 1 ? '' : 's'} you entered on this page ${escapeHtml(timeAgo(_recovery.savedAt))}${_recovery.timedOut ? ', before your session expired' : ''}.</p>
      <div class="actions">
        <button class="btn" id="dismiss">Dismiss</button>
        <button class="btn primary" id="restore">Restore</button>
      </div>
    `;
    card.querySelector('#restore').addEventListener('click', () => {
      card.hidden = true;
      _recovery = null;
      if (_handlers.onRestore) _handlers.onRestore();
    });
    card.querySelector('#dismiss').addEventListener('click', () => {
      card.hidden = true;
      _recovery = null;
      if (_handlers.onDismissRecovery) _handlers.onDismissRecovery();
    });
  }

  // ─── Utility ───────────────────────────────────────────────────

  function timeAgo(iso) {
    const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
    if (!Number.isFinite(seconds) || seconds < 60) return 'just now';
    if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)} h ago`;
    return `${Math.floor(seconds / 86400)} days ago`;
  }

  function escapeHtml(str) {
    return String(str ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // ─── Public API ─────────────────────────────────────────────────
  return Object.freeze({
    mount,
    unmount,
    show,
    hide,
    isVisible,
    resetDismissal,
    clearCard,
    showProgress,
    showReport,
    showRecovery,
    hideRecovery,
    highlight
  });
})();
