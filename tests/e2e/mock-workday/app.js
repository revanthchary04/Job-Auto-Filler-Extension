/**
 * Mock Workday application (React 18, no build step) for end-to-end tests.
 * Mirrors the markup and widget behaviour of Workday's candidate apply flow:
 * formField-* wrappers, button dropdowns rendered in a body-level popup, searchable
 * "prompt" fields that search on Enter, keyboard-driven month/year boxes, repeating
 * sections behind "Add" buttons, a résumé drop zone and a 6-step progress bar.
 *
 * window.__mockState holds every field value so tests can assert on React state.
 */
(function () {
  'use strict';

  const { useState, useEffect, useRef } = React;
  const h = React.createElement;

  window.__mockState = {};
  window.__mockEvents = [];

  let nextId = 1;
  const genId = () => `input-${nextId++}`;

  function useField(key, initial) {
    const [value, setValue] = useState(() => (key in window.__mockState ? window.__mockState[key] : initial));
    useEffect(() => { window.__mockState[key] = value; }, [key, value]);
    return [value, setValue];
  }

  function useStableId() {
    const ref = useRef(null);
    if (!ref.current) ref.current = genId();
    return ref.current;
  }

  // ─── Field wrapper ─────────────────────────────────────────────

  function FormField({ name, label, required, inputId, children, legend }) {
    const labelEl = legend ? null : h('label', { htmlFor: inputId },
      h('span', null, label, required ? h('abbr', { 'aria-hidden': 'true', title: 'required' }, '*') : null));
    return h('div', { 'data-automation-id': `formField-${name}` }, labelEl, h('div', null, children));
  }

  // ─── Text input (controlled) ───────────────────────────────────

  function TextField({ name, label, fieldKey, required, multiline, id }) {
    const generated = useStableId();
    const inputId = id || generated;
    const [value, setValue] = useField(fieldKey, '');
    const props = {
      id: inputId,
      type: multiline ? undefined : 'text',
      value,
      'aria-required': required ? 'true' : undefined,
      onChange: (e) => setValue(e.target.value),
      onBlur: () => window.__mockEvents.push(`blur:${fieldKey}`)
    };
    return h(FormField, { name, label, required, inputId },
      multiline ? h('textarea', props) : h('input', props));
  }

  // ─── Button dropdown (popup listbox at end of <body>) ─────────

  function Dropdown({ name, label, fieldKey, options, required, virtualize }) {
    const inputId = useStableId();
    const listId = `${inputId}-listbox`;
    const [value, setValue] = useField(fieldKey, '');
    const [open, setOpen] = useState(false);
    const [scrollTop, setScrollTop] = useState(0);

    useEffect(() => {
      if (!open) return undefined;
      const onDown = (e) => {
        if (!e.target.closest(`#${listId}`) && e.target.id !== inputId) setOpen(false);
      };
      document.addEventListener('mousedown', onDown);
      return () => document.removeEventListener('mousedown', onDown);
    }, [open]);

    const ROW = 28;
    const VISIBLE = 8;
    let rendered = options.map((opt, i) => ({ opt, i }));
    if (virtualize) {
      const first = Math.floor(scrollTop / ROW);
      rendered = rendered.slice(first, first + VISIBLE + 2);
    }

    const list = open && ReactDOM.createPortal(
      h('div', { 'data-automation-widget': 'wd-popup', style: { position: 'absolute', top: '120px', left: '40px', background: '#fff', border: '1px solid #ccc', zIndex: 10 } },
        h('ul', {
          role: 'listbox',
          id: listId,
          tabIndex: -1,
          style: { maxHeight: `${ROW * VISIBLE}px`, overflowY: 'auto', margin: 0, padding: 0, listStyle: 'none', width: '320px', position: 'relative' },
          onScroll: (e) => setScrollTop(e.currentTarget.scrollTop),
          onKeyDown: (e) => { if (e.key === 'Escape') setOpen(false); }
        },
        virtualize ? h('li', { 'aria-hidden': 'true', style: { height: `${options.length * ROW}px`, position: 'absolute', width: '1px' } }) : null,
        rendered.map(({ opt, i }) => h('li', {
          key: opt,
          role: 'option',
          'aria-selected': String(opt === value),
          tabIndex: -1,
          style: virtualize ? { position: 'absolute', top: `${i * ROW}px`, height: `${ROW}px`, width: '100%' } : { height: `${ROW}px` },
          onMouseDown: (e) => e.preventDefault(),
          onClick: () => { setValue(opt); setOpen(false); }
        }, h('div', null, opt))))),
      document.body
    );

    return h(FormField, { name, label, required, inputId },
      h('button', {
        type: 'button',
        id: inputId,
        'aria-haspopup': 'listbox',
        'aria-expanded': String(open),
        'aria-controls': open ? listId : undefined,
        onClick: () => setOpen(o => !o),
        onKeyDown: (e) => {
          if (e.key === 'Escape') setOpen(false);
          if (e.key === 'ArrowDown') setOpen(true);
        }
      }, value || 'Select One'),
      list);
  }

  // ─── Searchable prompt (search runs on Enter) ──────────────────
  // Markup follows a live Workday capture: pills are role=option "selectedItem"s holding a
  // promptOption, result rows are role=option wrappers around a promptLeafNode (which owns the
  // click handler), and the highlighted row is named by aria-activedescendant on the list.
  // Like Workday, the previous search's list is shown again while a new search runs (and when
  // typing re-opens the box), Enter on an open list ticks the highlighted row, and clicking a
  // ticked row unticks it. ?strictClicks=1 ignores clicks dispatched by scripts.

  const STRICT_CLICKS = new URLSearchParams(window.location.search).get('strictClicks') === '1';

  function Prompt({ name, label, fieldKey, catalog, multi, required }) {
    const inputId = useStableId();
    const containerId = `${inputId}-container`;
    const [selected, setSelected] = useField(fieldKey, []);
    const [query, setQuery] = useState('');
    const [results, setResults] = useState(null);
    const [loading, setLoading] = useState(false);
    const [active, setActive] = useState(-1);
    const lastResults = useRef(null);
    const rowId = (i) => `${inputId}-option-${i}`;

    useEffect(() => {
      if (results === null) return undefined;
      const onDown = (e) => {
        if (!e.target.closest('[data-automation-widget="wd-popup"]') && !e.target.closest(`#${containerId}`)) close();
      };
      document.addEventListener('mousedown', onDown);
      return () => document.removeEventListener('mousedown', onDown);
    }, [results]);

    const close = () => { setResults(null); setActive(-1); };

    const search = (q) => {
      setLoading(true);
      setActive(-1);
      setResults(lastResults.current || catalog.top || []); // The previous list, until the new one arrives
      setTimeout(() => {
        const needle = q.trim().toLowerCase();
        const found = needle ? catalog.leaves.filter(x => x.toLowerCase().includes(needle)) : (catalog.top || catalog.leaves);
        lastResults.current = found;
        setResults(found);
        setLoading(false);
      }, 350);
    };

    const choose = (item, how) => {
      window.__mockEvents.push(`pick:${how}:${item}`);
      if (catalog.children && catalog.children[item]) {
        setActive(-1);
        setResults(catalog.children[item]);
        return;
      }
      if (multi) {
        setSelected(selected.includes(item) ? selected.filter(s => s !== item) : [...selected, item]);
      } else {
        setSelected([item]);
        setQuery('');
        close();
      }
    };

    const clicked = (item) => (e) => {
      if (STRICT_CLICKS && !e.nativeEvent.isTrusted) return;
      choose(item, 'click');
    };

    const open = results !== null && results.length > 0;
    const popup = results !== null && ReactDOM.createPortal(
      h('div', { 'data-automation-widget': 'wd-popup', 'data-associated-widget': containerId, style: { position: 'absolute', top: '200px', left: '40px', background: '#fff', border: '1px solid #ccc', zIndex: 10 } },
        loading ? h('div', { 'data-automation-id': 'loadingIndicator' }, 'Loading…') : null,
        !loading && results.length === 0 ? h('div', { 'data-automation-id': 'promptEmptyText' }, 'No Items.') : null,
        h('div', {
          'data-automation-id': 'activeListContainer',
          role: 'listbox',
          'aria-multiselectable': multi ? 'true' : undefined,
          'aria-activedescendant': active >= 0 ? rowId(active) : undefined
        },
        results.map((r, i) => h('div', {
          key: r,
          id: rowId(i),
          role: 'option',
          'aria-selected': String(i === active), // The keyboard highlight, not the ticked state
          tabIndex: -1,
          style: i === active ? { background: '#def' } : undefined,
          onMouseDown: (e) => e.preventDefault()
        },
        h('div', { 'data-automation-id': 'promptLeafNode', onClick: clicked(r) },
          multi ? h('input', { type: 'checkbox', tabIndex: -1, readOnly: true, checked: selected.includes(r) }) : null,
          h('div', { 'data-automation-id': 'promptOption', 'data-automation-label': r },
            r, catalog.children && catalog.children[r] ? ' ›' : '')))))),
      document.body
    );

    return h(FormField, { name, label, required, inputId },
      h('div', { 'data-automation-id': 'multiSelectContainer', id: containerId },
        h('ul', { role: 'listbox', tabIndex: 0, 'data-automation-id': 'selectedItemList', 'aria-label': 'items selected' },
          selected.map(s => h('li', { key: s, role: 'presentation', 'data-automation-id': 'menuItem' },
            h('div', { role: 'option', 'aria-selected': 'false', 'data-automation-id': 'selectedItem', title: s },
              h('p', { 'data-automation-id': 'promptOption', 'data-automation-label': s }, s),
              h('div', { role: 'presentation', 'data-automation-id': 'DELETE_charm', 'aria-label': `Remove ${s}`, onClick: () => setSelected(selected.filter(x => x !== s)) }))))),
        h('input', {
          id: inputId,
          'data-uxi-widget-type': 'selectinput',
          'data-automation-id': 'searchBox',
          placeholder: 'Search',
          value: query,
          onChange: (e) => {
            setQuery(e.target.value);
            // Typing re-opens the last list
            if (results === null && lastResults.current && lastResults.current.length) setResults(lastResults.current);
          },
          onKeyDown: (e) => {
            if (e.key === 'ArrowDown' && open) { e.preventDefault(); setActive(a => Math.min(results.length - 1, a + 1)); return; }
            if (e.key === 'ArrowUp' && open) { e.preventDefault(); setActive(a => Math.max(0, a - 1)); return; }
            if ((e.key === 'Enter' || e.key === ' ') && open && active >= 0) { e.preventDefault(); choose(results[active], 'keyboard'); return; }
            if (e.key === 'Enter') { e.preventDefault(); search(query); }
            if (e.key === 'Escape') close();
          }
        })),
      popup);
  }

  // ─── Month/Year date (keyboard only, like Workday's spin boxes) ─

  function DateField({ name, label, fieldKey, parts, required }) {
    const firstId = useStableId();
    const [value, setValue] = useField(fieldKey, { month: '', year: '' });

    const onKeyDown = (part) => (e) => {
      const width = part === 'year' ? 4 : 2;
      const current = String(value[part] || '');
      if (/^\d$/.test(e.key)) {
        e.preventDefault();
        const next = (current.length >= width ? '' : current) + e.key;
        setValue({ ...value, [part]: next });
      } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        const shown = parseInt(e.target.value, 10); // Reads what the box currently shows
        const base = Number.isNaN(shown) ? (part === 'month' ? 0 : new Date().getFullYear()) : shown;
        let next = base + (e.key === 'ArrowUp' ? 1 : -1);
        if (part === 'month') next = Math.min(12, Math.max(1, next));
        if (part === 'day') next = Math.min(31, Math.max(1, next));
        setValue({ ...value, [part]: String(next).padStart(width, '0') });
      } else if (e.key === 'Backspace') {
        e.preventDefault();
        setValue({ ...value, [part]: '' });
      }
    };

    const segment = (part, ariaLabel, autoId, first) => h('input', {
      key: part,
      id: first ? firstId : undefined,
      'aria-label': ariaLabel,
      'data-automation-id': autoId,
      role: 'spinbutton',
      'aria-valuenow': value[part] ? String(parseInt(value[part], 10)) : '', // Workday's state, not the box's text
      value: value[part] || '',
      placeholder: part === 'month' ? 'MM' : part === 'day' ? 'DD' : 'YYYY',
      onChange: () => {}, // Controlled: only keys change it
      onKeyDown: onKeyDown(part)
    });

    return h(FormField, { name, label, required, inputId: firstId },
      h('div', { 'data-automation-id': 'dateInputWrapper' },
        parts.includes('month') ? segment('month', 'Month', 'dateSectionMonth-input', true) : null,
        parts.includes('day') ? segment('day', 'Day', 'dateSectionDay-input', false) : null,
        parts.includes('year') ? segment('year', 'Year', 'dateSectionYear-input', !parts.includes('month')) : null));
  }

  // ─── Checkbox & radio ──────────────────────────────────────────

  function Checkbox({ name, label, fieldKey }) {
    const inputId = useStableId();
    const [checked, setChecked] = useField(fieldKey, false);
    return h('div', { 'data-automation-id': `formField-${name}` },
      h('input', { type: 'checkbox', id: inputId, checked, onChange: (e) => setChecked(e.target.checked) }),
      h('label', { htmlFor: inputId }, label));
  }

  function RadioGroup({ name, question, fieldKey, options, required }) {
    const [value, setValue] = useField(fieldKey, '');
    const base = useStableId();
    return h('div', { 'data-automation-id': `formField-${name}` },
      h('fieldset', null,
        h('legend', null, question, required ? h('abbr', { 'aria-hidden': 'true' }, '*') : null),
        options.map((opt, i) => h(React.Fragment, { key: opt.value },
          h('input', { type: 'radio', id: `${base}-${i}`, name, value: opt.value, checked: value === opt.value, onChange: () => setValue(opt.value) }),
          h('label', { htmlFor: `${base}-${i}` }, opt.label)))));
  }

  // ─── Questionnaire widgets: question as rich text, no <label> ──

  function RichQuestion({ name, question, children }) {
    return h('div', { 'data-automation-id': `formField-${name}` },
      h('div', { 'data-automation-id': 'richText' }, h('p', null, question, h('abbr', { 'aria-hidden': 'true' }, '*'))),
      children);
  }

  function RichDropdown({ name, question, fieldKey, options }) {
    // Reuses Dropdown's popup behaviour; the question is rich text instead of a label
    return h(RichQuestion, { name, question }, h(DropdownControl, { fieldKey, options }));
  }

  function DropdownControl({ fieldKey, options }) {
    const inputId = useStableId();
    const listId = `${inputId}-listbox`;
    const [value, setValue] = useField(fieldKey, '');
    const [open, setOpen] = useState(false);
    useEffect(() => {
      if (!open) return undefined;
      const onDown = (e) => { if (!e.target.closest(`#${listId}`) && e.target.id !== inputId) setOpen(false); };
      document.addEventListener('mousedown', onDown);
      return () => document.removeEventListener('mousedown', onDown);
    }, [open]);
    return h(React.Fragment, null,
      h('button', { type: 'button', id: inputId, 'aria-haspopup': 'listbox', 'aria-expanded': String(open), 'aria-controls': open ? listId : undefined, onClick: () => setOpen(o => !o) }, value || 'Select One'),
      open && ReactDOM.createPortal(
        h('div', { 'data-automation-widget': 'wd-popup' },
          h('ul', { role: 'listbox', id: listId },
            options.map(opt => h('li', { key: opt, role: 'option', onMouseDown: (e) => e.preventDefault(), onClick: () => { setValue(opt); setOpen(false); } }, h('div', null, opt))))),
        document.body));
  }

  function RichRadio({ name, question, fieldKey, options }) {
    const [value, setValue] = useField(fieldKey, '');
    const base = useStableId();
    return h(RichQuestion, { name, question },
      options.map((opt, i) => h(React.Fragment, { key: opt.value },
        h('input', { type: 'radio', id: `${base}-${i}`, name, value: opt.value, checked: value === opt.value, onChange: () => setValue(opt.value) }),
        h('label', { htmlFor: `${base}-${i}` }, opt.label))));
  }

  function CheckboxGroup({ name, legend, fieldKey, options }) {
    const [checked, setChecked] = useField(fieldKey, []);
    const base = useStableId();
    return h('div', { 'data-automation-id': `formField-${name}` },
      h('fieldset', null,
        h('legend', null, legend),
        options.map((opt, i) => h('div', { key: opt },
          h('input', {
            type: 'checkbox', id: `${base}-${i}`, checked: checked.includes(opt),
            // Workday's form behaves like radio buttons: one box at a time
            onChange: (e) => setChecked(e.target.checked ? [opt] : checked.filter(c => c !== opt))
          }),
          h('label', { htmlFor: `${base}-${i}` }, opt)))));
  }

  function DateMDY({ name, label, fieldKey }) {
    return h(DateField, { name, label, fieldKey, parts: ['month', 'day', 'year'] });
  }

  // ─── Catalogs ──────────────────────────────────────────────────

  const COUNTRIES = ['Afghanistan', 'Argentina', 'Australia', 'Austria', 'Belgium', 'Brazil', 'Canada', 'Chile', 'China',
    'Colombia', 'Denmark', 'Egypt', 'Finland', 'France', 'Germany', 'Greece', 'India', 'Indonesia', 'Ireland', 'Israel',
    'Italy', 'Japan', 'Kenya', 'Mexico', 'Netherlands', 'New Zealand', 'Nigeria', 'Norway', 'Poland', 'Portugal',
    'Singapore', 'South Africa', 'Spain', 'Sweden', 'Switzerland', 'Turkey', 'Ukraine', 'United Arab Emirates',
    'United Kingdom', 'United States Minor Outlying Islands', 'United States of America', 'Vietnam'];
  const STATES = ['Alabama', 'Alaska', 'Arizona', 'California', 'Colorado', 'Florida', 'Georgia', 'Illinois', 'New York', 'Texas', 'Washington'];
  const SOURCES = {
    top: ['Job Board', 'Social Media', 'Referral', 'Company Website'],
    children: { 'Job Board': ['Indeed', 'Glassdoor'], 'Social Media': ['LinkedIn', 'Twitter'] },
    leaves: ['Indeed', 'Glassdoor', 'LinkedIn', 'Twitter', 'Employee Referral', 'Company Website']
  };
  const PHONE_CODES = { leaves: ['Canada (+1)', 'India (+91)', 'United Kingdom (+44)', 'United States of America (+1)'] };
  const SCHOOLS = { leaves: ['Massachusetts Institute of Technology', 'Other', 'Stanford University', 'University of Texas at Austin', 'University of Washington'] };
  const FIELDS_OF_STUDY = { leaves: ['Computer Engineering', 'Computer Science', 'Electrical Engineering', 'Mathematics', 'Other - Not Listed'] };
  const SKILLS = { leaves: ['Java', 'JavaScript', 'Python', 'React', 'SQL', 'TypeScript'] };

  // ─── Pages ─────────────────────────────────────────────────────

  function MyInformation() {
    return h('div', { 'data-automation-id': 'contactInformationPage' },
      h('h2', null, 'My Information'),
      h(Prompt, { name: 'source', label: 'How Did You Hear About Us?', fieldKey: 'source', catalog: SOURCES, required: true }),
      h(RadioGroup, { name: 'candidateIsPreviousWorker', question: 'Have you previously worked for Acme?', fieldKey: 'previousWorker', required: true,
        options: [{ value: 'true', label: 'Yes' }, { value: 'false', label: 'No' }] }),
      h(Dropdown, { name: 'country', label: 'Country', fieldKey: 'country', options: COUNTRIES, required: true, virtualize: true }),
      h(TextField, { name: 'legalName--firstName', label: 'First Name', fieldKey: 'firstName', required: true }),
      h(TextField, { name: 'legalName--middleName', label: 'Middle Name', fieldKey: 'middleName' }),
      h(TextField, { name: 'legalName--lastName', label: 'Last Name', fieldKey: 'lastName', required: true }),
      h(Checkbox, { name: 'preferredCheck', label: 'I have a preferred name', fieldKey: 'preferredCheck' }),
      h(TextField, { name: 'addressLine1', label: 'Address Line 1', fieldKey: 'address1', required: true }),
      h(TextField, { name: 'city', label: 'City', fieldKey: 'city', required: true }),
      h(Dropdown, { name: 'countryRegion', label: 'State', fieldKey: 'state', options: STATES, required: true }),
      h(TextField, { name: 'postalCode', label: 'Postal Code', fieldKey: 'postalCode', required: true }),
      h(TextField, { name: 'email', label: 'Email Address', fieldKey: 'email', required: true }),
      h(Dropdown, { name: 'phoneType', label: 'Phone Device Type', fieldKey: 'phoneType', options: ['Home', 'Mobile', 'Work'], required: true }),
      h(Prompt, { name: 'countryPhoneCode', label: 'Country Phone Code', fieldKey: 'countryPhoneCode', catalog: PHONE_CODES, required: true }),
      h(TextField, { name: 'phoneNumber', label: 'Phone Number', fieldKey: 'phone', required: true }),
      h(TextField, { name: 'extension', label: 'Phone Extension', fieldKey: 'extension' }));
  }

  /** Workday numbers entries with an internal counter (workExperience-26), not 1, 2, 3 */
  const ENTRY_COUNTER = { work: 26, education: 41, web: 57 };
  const entryNumber = (sectionKey, i) => ENTRY_COUNTER[sectionKey] + i * 5;

  function RepeatingSection({ title, entryLabel, entryAutomationId, initial, renderEntry, sectionKey }) {
    const [count, setCount] = useField(`${sectionKey}Count`, initial);
    const headingId = `${sectionKey}-section`;
    return h('div', { role: 'group', 'aria-labelledby': headingId },
      h('h3', { id: headingId }, title),
      Array.from({ length: count }, (_, i) => h('div', {
        key: i,
        role: 'group',
        'data-automation-id': `${entryAutomationId}-${entryNumber(sectionKey, i)}`,
        'aria-labelledby': `${headingId}-${i + 1}`
      },
      h('h4', { id: `${headingId}-${i + 1}` }, `${entryLabel} ${i + 1}`),
      renderEntry(i))),
      h('button', { type: 'button', 'data-automation-id': 'add-button', onClick: () => setCount(count + 1) }, count === 0 ? 'Add' : 'Add Another'));
  }

  /**
   * Workday's résumé widget as seen live (Adobe tenant, 2026): a formField wrapper with no label,
   * a drop zone (onDrop) and a hidden file input next to it (onChange).
   */
  function ResumeUpload() {
    const [files, setFiles] = useField('resumeFiles', []);
    const inputRef = useRef(null);
    const add = (list) => setFiles(prev => [...prev, ...Array.from(list).map(f => ({ name: f.name, size: f.size, type: f.type }))]);
    return h('div', { 'data-automation-id': 'formField-' },
      h('div', null,
        h('div', null, 'Upload either DOC, DOCX, HTML, PDF, or TXT file types (5MB max)'),
        h('div', { 'data-automation-id': 'resumeUpload' },
          h('div', null,
            h('div', {
              'data-automation-id': 'file-upload-drop-zone',
              style: { border: '1px dashed #999', padding: '12px' },
              onDragEnter: (e) => e.preventDefault(),
              onDragOver: (e) => e.preventDefault(),
              onDragLeave: () => {},
              onDrop: (e) => { e.preventDefault(); add(e.dataTransfer.files); },
              onClick: () => inputRef.current && inputRef.current.click()
            },
            h('div', null, 'Drop file here'),
            h('div', null, h('div', null, 'or'), h('button', { type: 'button', 'data-automation-id': 'select-files' }, h('span', null, 'Select file')))),
            h('input', { ref: inputRef, 'data-automation-id': 'file-upload-input-ref', type: 'file', style: { display: 'none' }, onChange: (e) => add(e.target.files) })),
          files.map(f => h('div', { key: f.name, 'data-automation-id': 'file-upload-item' },
            h('div', { 'data-automation-id': 'file-upload-item-name' }, f.name),
            h('div', null, 'Successfully Uploaded!'))))));
  }

  function WorkEntry({ i }) {
    const checkboxId = useStableId();
    const [current, setCurrent] = useField(`work${i}.current`, false);
    return h(React.Fragment, null,
      h(TextField, { name: 'jobTitle', label: 'Job Title', fieldKey: `work${i}.jobTitle`, required: true, id: `workExperience-${entryNumber('work', i)}--jobTitle` }),
      h(TextField, { name: 'companyName', label: 'Company', fieldKey: `work${i}.company`, required: true }),
      h(TextField, { name: 'location', label: 'Location', fieldKey: `work${i}.location` }),
      h('div', { 'data-automation-id': 'formField-currentlyWorkHere' },
        h('input', { type: 'checkbox', id: checkboxId, checked: current, onChange: (e) => setCurrent(e.target.checked) }),
        h('label', { htmlFor: checkboxId }, 'I currently work here')),
      h(DateField, { name: 'startDate', label: 'From', fieldKey: `work${i}.from`, parts: ['month', 'year'], required: true }),
      current ? null : h(DateField, { name: 'endDate', label: 'To', fieldKey: `work${i}.to`, parts: ['month', 'year'], required: true }),
      h(TextField, { name: 'roleDescription', label: 'Role Description', fieldKey: `work${i}.description`, multiline: true }));
  }

  function MyExperience() {
    return h('div', { 'data-automation-id': 'myExperiencePage' },
      h('h2', null, 'My Experience'),
      h(RepeatingSection, {
        title: 'Work Experience', entryLabel: 'Work Experience', entryAutomationId: 'workExperience', sectionKey: 'work', initial: 0,
        renderEntry: (i) => h(WorkEntry, { i })
      }),
      h(RepeatingSection, {
        title: 'Education', entryLabel: 'Education', entryAutomationId: 'education', sectionKey: 'education', initial: 0,
        renderEntry: (i) => h(React.Fragment, null,
          h(Prompt, { name: 'schoolItem', label: 'School or University', fieldKey: `edu${i}.school`, catalog: SCHOOLS, required: true }),
          h(Dropdown, { name: 'degree', label: 'Degree', fieldKey: `edu${i}.degree`, options: ["Associate's Degree", "Bachelor's Degree", "Master's Degree", 'Doctorate'], required: true }),
          h(Prompt, { name: 'fieldOfStudy', label: 'Field of Study', fieldKey: `edu${i}.fieldOfStudy`, catalog: FIELDS_OF_STUDY }),
          h(TextField, { name: 'gradeAverage', label: 'Overall Result (GPA)', fieldKey: `edu${i}.gpa` }),
          h(DateField, { name: 'firstYearAttended', label: 'From', fieldKey: `edu${i}.from`, parts: ['year'] }),
          h(DateField, { name: 'lastYearAttended', label: 'To (Actual or Expected)', fieldKey: `edu${i}.to`, parts: ['year'] }))
      }),
      h(Prompt, { name: 'skills', label: 'Type to Add Skills', fieldKey: 'skills', catalog: SKILLS, multi: true }),
      h('div', { role: 'group', 'aria-labelledby': 'resume-section' }, h('h3', { id: 'resume-section' }, 'Resume/CV'), h(ResumeUpload)),
      h(RepeatingSection, {
        title: 'Websites', entryLabel: 'Websites', entryAutomationId: 'webAddress', sectionKey: 'web', initial: 0,
        renderEntry: (i) => h(TextField, { name: 'url', label: 'URL', fieldKey: `web${i}.url`, required: true })
      }),
      h('div', { role: 'group', 'aria-labelledby': 'social-section' },
        h('h3', { id: 'social-section' }, 'Social Network URLs'),
        h(TextField, { name: 'linkedInAccount', label: 'LinkedIn', fieldKey: 'linkedIn' })));
  }

  function ApplicationQuestions() {
    return h('div', { 'data-automation-id': 'primaryQuestionnairePage' },
      h('h2', null, 'Application Questions'),
      h(RadioGroup, { name: 'q1', question: 'Are you legally authorized to work in the country where this job is located?', fieldKey: 'authorized', required: true,
        options: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }] }),
      h(Dropdown, { name: 'q2', label: 'Will you now or in the future require sponsorship for employment visa status?', fieldKey: 'sponsorship', options: ['Yes', 'No'], required: true }),
      h(TextField, { name: 'q3', label: 'What interests you about this role?', fieldKey: 'interest', multiline: true, required: true }),
      h(TextField, { name: 'q4', label: 'Desired salary', fieldKey: 'salary' }),
      h(RichDropdown, { name: 'q5', question: 'Country/Region of Residence', fieldKey: 'residence', options: COUNTRIES }),
      h(RichDropdown, { name: 'q6', question: 'Do you have a disability, either visible or invisible?', fieldKey: 'disabilityQ', options: ['Yes', 'No'] }),
      h(RichRadio, { name: 'q7', question: 'Have you suffered from any major illness/surgery/accident?', fieldKey: 'illness',
        options: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }] }),
      h(TextField, { name: 'q8', label: 'What is your notice period?', fieldKey: 'notice' }),
      h(RichDropdown, { name: 'q9', question: 'Total years of experience', fieldKey: 'experience', options: ['0-2 years', '3-5 years', '6-10 years', 'More than 10 years'] }),
      h(RichRadio, { name: 'q10', question: 'Are you willing to relocate?', fieldKey: 'relocate',
        options: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }] }));
  }

  function VoluntaryDisclosures() {
    return h('div', { 'data-automation-id': 'voluntaryDisclosuresPage' },
      h('h2', null, 'Voluntary Disclosures'),
      h(Dropdown, { name: 'gender', label: 'Gender', fieldKey: 'gender', options: ['Female', 'Male', 'I do not wish to answer'] }),
      h(Dropdown, { name: 'veteranStatus', label: 'Veteran Status', fieldKey: 'veteran', options: ['I am not a protected veteran', 'I identify as one or more of the classifications of protected veteran', 'I do not wish to self-identify'] }),
      h(Checkbox, { name: 'agreementCheckbox', label: 'I consent to the terms and conditions', fieldKey: 'consent' }),
      h('h3', null, 'Voluntary Self-Identification of Disability'),
      h(TextField, { name: 'selfName', label: 'Name', fieldKey: 'selfName', required: true }),
      h(DateMDY, { name: 'dateSignedOn', label: 'Date', fieldKey: 'selfDate' }),
      h(CheckboxGroup, {
        name: 'disabilityStatus',
        legend: 'Please check one of the boxes below:',
        fieldKey: 'disabilityBoxes',
        options: ['Yes, I have a disability (or previously had a disability)', 'No, I do not have a disability and have not had one in the past', 'I do not want to answer']
      }));
  }

  function SignIn() {
    return h('div', { 'data-automation-id': 'signInContent' },
      h('h3', null, 'Sign In'),
      h(TextField, { name: 'email', label: 'Email Address', fieldKey: 'signInEmail', required: true }),
      h('div', { 'data-automation-id': 'formField-password' },
        h('label', { htmlFor: 'pw' }, 'Password'),
        h('input', { type: 'password', id: 'pw', 'data-automation-id': 'password', defaultValue: '' })));
  }

  function AutofillWithResume() {
    return h('div', { 'data-automation-id': 'applyFlowAutoFillPage' }, h(ResumeUpload));
  }

  const FLOW_START = new URLSearchParams(window.location.search).get('flow') === 'autofill'
    ? { slug: 'autofill-resume', name: 'Autofill with Resume', Component: AutofillWithResume }
    : { slug: 'signin', name: 'Create Account/Sign In', Component: () => h(SignIn) };

  const STEPS = [
    FLOW_START,
    { slug: 'my-information', name: 'My Information', Component: MyInformation },
    { slug: 'my-experience', name: 'My Experience', Component: MyExperience },
    { slug: 'questions', name: 'Application Questions', Component: ApplicationQuestions },
    { slug: 'disclosures', name: 'Voluntary Disclosures', Component: VoluntaryDisclosures },
    { slug: 'review', name: 'Review', Component: () => h('div', { 'data-automation-id': 'reviewJobApplicationPage' }, h('h2', null, 'Review')) }
  ];

  function stepFromUrl() {
    const slug = new URLSearchParams(window.location.search).get('step') || FLOW_START.slug;
    return Math.max(0, STEPS.findIndex(s => s.slug === slug));
  }

  function App() {
    const [step, setStep] = useState(stepFromUrl);
    const [expired, setExpired] = useState(false);

    useEffect(() => {
      const onPop = () => setStep(stepFromUrl());
      window.addEventListener('popstate', onPop);
      window.__mockGoTo = (slug) => {
        const i = STEPS.findIndex(s => s.slug === slug);
        history.pushState({}, '', `?step=${slug}`);
        setStep(i);
      };
      window.__mockExpire = () => setExpired(true);
      return () => window.removeEventListener('popstate', onPop);
    }, []);

    const goNext = () => {
      const next = Math.min(step + 1, STEPS.length - 1);
      const flow = new URLSearchParams(window.location.search).get('flow');
      history.pushState({}, '', `?${flow ? `flow=${flow}&` : ''}step=${STEPS[next].slug}`);
      setStep(next);
    };

    const { Component } = STEPS[step];
    return h('div', { 'data-automation-id': 'applyFlowPage' },
      h('h2', { 'data-automation-id': 'jobTitleHeading' }, 'Software Engineer'),
      h('ol', { 'data-automation-id': 'progressBar' },
        STEPS.map((s, i) => h('li', {
          key: s.slug,
          'data-automation-id': i === step ? 'progressBarActiveStep' : i < step ? 'progressBarCompletedStep' : 'progressBarInactiveStep'
        }, `${i === step ? 'current ' : ''}step ${i + 1} of ${STEPS.length} ${s.name}`))),
      h('div', { key: step }, h(Component)),
      h('div', { 'data-automation-id': 'bottom-navigation-footer', style: { position: 'fixed', left: 0, right: 0, bottom: 0, padding: '12px 24px', background: '#f3f4f6', textAlign: 'right' } },
        h('button', { type: 'button', 'data-automation-id': 'bottom-navigation-next-button', onClick: goNext }, 'Save and Continue')),
      expired ? h('div', { role: 'dialog', 'data-automation-id': 'wd-popup-content' }, 'Your session has expired. Please sign in again.') : null);
  }

  ReactDOM.createRoot(document.getElementById('root')).render(h(App));
})();
