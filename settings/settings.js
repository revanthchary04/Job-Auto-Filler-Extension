/**
 * OriginFill — Settings Page Logic
 * Full settings management: profiles, personal info, education, work experience,
 * resume upload, skills, extension settings, data export/import, and about.
 *
 * @license AGPL-3.0
 * @author CharyWorld
 */

(async function SettingsInit() {
  'use strict';

  // ─── DOM Helpers ───────────────────────────────────────────────
  const $ = (id) => document.getElementById(id);
  const $$ = (sel) => document.querySelectorAll(sel);

  // ─── State ─────────────────────────────────────────────────────
  let profiles = [];
  let activeProfile = null;
  let settings = {};
  let currentSection = 'profiles';

  // ─── Initialize ────────────────────────────────────────────────
  async function init() {
    try {
      // Initialize UI first so the page is usable even if storage fails
      applyTheme();
      setupNavigation();
      setupEventListeners();

      // Initialize storage
      await OriginFillStore.initialize();
      profiles = await OriginFillStore.getProfiles();
      settings = await OriginFillStore.getSettings();
      activeProfile = profiles.find(p => p.id === settings.activeProfileId) || profiles[0] || null;

      // Populate data
      renderProfiles();
      if (activeProfile) loadProfileData(activeProfile);
      loadExtensionSettings();

      // First visit from onboarding
      const params = new URLSearchParams(window.location.search);
      const profileIsEmpty = !activeProfile?.personal?.firstName && !activeProfile?.personal?.email;
      $('welcomeBanner').hidden = !(params.get('welcome') || profileIsEmpty);

      // Set version
      $('versionText').textContent = `v${chrome.runtime.getManifest().version}`;
      $('aboutVersion').textContent = `Version ${chrome.runtime.getManifest().version}`;
      checkForUpdatedFiles();

      // Mark first run as complete
      await OriginFillStore.completeFirstRun();
    } catch (error) {
      console.error('[OriginFill][Settings] Initialization failed:', error);
      
      // Ensure basic UI is visible if everything crashed
      $('versionText').textContent = `v${chrome.runtime.getManifest().version}`;
      showToast('❌', 'Failed to load settings data. See console.');
    }
  }

  /**
   * An unpacked install keeps running its old code after the folder is updated, until the
   * extension is reloaded. This page is read from disk, so compare the two versions.
   */
  async function checkForUpdatedFiles() {
    try {
      const running = chrome.runtime.getManifest().version;
      const response = await fetch(chrome.runtime.getURL('manifest.json'), { cache: 'no-store' });
      const onDisk = (await response.json()).version;
      if (!onDisk || onDisk === running) return;
      $('updateMeta').textContent = `Chrome is still running version ${running}, so autofill works the old way. ` +
        `Version ${onDisk} is in the OriginFill folder. Reload it here (this page will close), then reload your job application tab.`;
      $('reloadExtensionBtn').onclick = () => chrome.runtime.reload();
      $('updateBanner').hidden = false;
    } catch (e) { /* Store installs always match */ }
  }

  // ─── Navigation ────────────────────────────────────────────────
  function setupNavigation() {
    const navItems = $$('.settings__nav-item');
    navItems.forEach(item => {
      item.addEventListener('click', (e) => {
        e.preventDefault();
        const section = item.dataset.section;
        showSection(section);
        // Update active nav
        navItems.forEach(n => n.classList.remove('settings__nav-item--active'));
        item.classList.add('settings__nav-item--active');
        item.setAttribute('aria-current', 'page');
      });
    });

    // Handle hash navigation
    const hash = window.location.hash.slice(1);
    if (hash) {
      showSection(hash);
      updateNavHighlight(hash);
    }
    window.addEventListener('hashchange', () => {
      const section = window.location.hash.slice(1);
      if (section) {
        showSection(section);
        updateNavHighlight(section);
      }
    });
  }

  function showSection(name) {
    const sections = $$('.settings__section');
    sections.forEach(s => s.hidden = true);
    const target = $(`section-${name}`);
    if (target) {
      target.hidden = false;
      currentSection = name;
    }
  }

  // ─── Profiles ──────────────────────────────────────────────────
  function renderProfiles() {
    const list = $('profilesList');
    if (!list) return;

    list.innerHTML = profiles.map(p => `
      <div class="settings__profile-card ${p.id === activeProfile?.id ? 'settings__profile-card--active' : ''}"
           data-profile-id="${p.id}">
        <div class="settings__profile-color" style="background: ${p.colorTag || '#2563EB'}"></div>
        <div class="settings__profile-info">
          <div class="settings__profile-name">${escapeHtml(p.label)}</div>
          ${p.isDefault ? '<div class="settings__profile-default">Default</div>' : ''}
        </div>
        <div class="settings__profile-actions">
          <button class="settings__btn settings__btn--sm settings__btn--ghost" data-action="edit" data-id="${p.id}" title="Edit">✏️</button>
          <button class="settings__btn settings__btn--sm settings__btn--ghost" data-action="duplicate" data-id="${p.id}" title="Duplicate">📋</button>
          ${profiles.length > 1 ? `<button class="settings__btn settings__btn--sm settings__btn--ghost" data-action="delete" data-id="${p.id}" title="Delete">🗑️</button>` : ''}
        </div>
      </div>
    `).join('');

    // Profile card click — switch active
    list.querySelectorAll('.settings__profile-card').forEach(card => {
      card.addEventListener('click', async (e) => {
        if (e.target.closest('[data-action]')) return; // Don't switch on button click
        const id = card.dataset.profileId;
        await switchProfile(id);
      });
    });

    // Profile action buttons
    list.querySelectorAll('[data-action]').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const action = btn.dataset.action;
        const id = btn.dataset.id;
        if (action === 'edit') { await switchProfile(id); showSection('personal'); updateNavHighlight('personal'); }
        if (action === 'duplicate') { await duplicateProfile(id); }
        if (action === 'delete') { await deleteProfileWithConfirm(id); }
      });
    });
  }

  async function switchProfile(id) {
    activeProfile = profiles.find(p => p.id === id);
    if (!activeProfile) return;
    await OriginFillStore.setActiveProfile(id);
    settings.activeProfileId = id;
    loadProfileData(activeProfile);
    renderProfiles();
  }

  async function duplicateProfile(id) {
    const dup = await OriginFillStore.duplicateProfile(id);
    profiles = await OriginFillStore.getProfiles();
    renderProfiles();
    showToast('✅', `Profile "${dup.label}" created`);
  }

  async function deleteProfileWithConfirm(id) {
    const profile = profiles.find(p => p.id === id);
    if (!profile) return;
    showDialog(
      'Delete Profile',
      `Are you sure you want to delete "${profile.label}"? This cannot be undone.`,
      async () => {
        await OriginFillStore.deleteProfile(id);
        profiles = await OriginFillStore.getProfiles();
        settings = await OriginFillStore.getSettings();
        activeProfile = profiles.find(p => p.id === settings.activeProfileId) || profiles[0];
        if (activeProfile) loadProfileData(activeProfile);
        renderProfiles();
        showToast('🗑️', 'Profile deleted');
      }
    );
  }

  function updateNavHighlight(section) {
    $$('.settings__nav-item').forEach(n => {
      const active = n.dataset.section === section;
      n.classList.toggle('settings__nav-item--active', active);
      if (active) n.setAttribute('aria-current', 'page');
      else n.removeAttribute('aria-current');
    });
  }

  // ─── Load Profile Data into Forms ──────────────────────────────
  function loadProfileData(profile) {
    if (!profile) return;
    // Personal
    const p = profile.personal || {};
    setVal('personalFirstName', p.firstName);
    setVal('personalLastName', p.lastName);
    setVal('personalFullName', p.fullName);
    setVal('personalEmail', p.email);
    setVal('personalPhone', p.phone);
    setVal('personalAddress', p.address);
    setVal('personalAddress2', p.address2);
    setVal('personalPhoneType', p.phoneType || 'Mobile');
    setVal('personalPhoneCountryCode', p.phoneCountryCode);
    setVal('personalCity', p.city);
    setVal('personalState', p.state);
    setVal('personalZipCode', p.zipCode);
    setVal('personalCountry', p.country);
    setVal('personalLinkedIn', p.linkedIn);
    setVal('personalGithub', p.github);
    setVal('personalPortfolio', p.portfolio || (p.websites && p.websites.length > 0 ? p.websites[0] : ''));
    setVal('personalWebsites', (p.websites || []).join('\n') || (p.portfolio ? p.portfolio : ''));

    // Application answers
    const app = profile.application || {};
    setVal('appReferralSource', app.referralSource);
    setVal('appPreviouslyEmployed', app.previouslyEmployed);
    renderCommonQuestions(profile);
    renderAnswers(profile.answers || []);

    // Skills
    setVal('skillsInput', (profile.skills || []).join(', '));
    setVal('languagesInput', (profile.languages || []).join(', '));
    setVal('certificationsInput', (profile.certifications || []).join(', '));

    // Education entries
    renderEducationEntries(profile.education || []);

    // Work entries
    renderWorkEntries(profile.workExperience || []);

    // Resumes
    loadResumes();
  }

  function setVal(id, value) {
    const el = $(id);
    if (el) el.value = value || '';
  }

  // ─── Education Entries ─────────────────────────────────────────
  function renderEducationEntries(entries) {
    const container = $('educationEntries');
    if (!container) return;

    container.innerHTML = entries.map((edu, i) => `
      <div class="settings__entry" data-index="${i}">
        <div class="settings__entry-header">
          <div>
            <div class="settings__entry-title">${escapeHtml(edu.institution || `Education ${i + 1}`)}</div>
            <div class="settings__entry-subtitle">${escapeHtml(edu.degree || '')} ${edu.fieldOfStudy ? '· ' + escapeHtml(edu.fieldOfStudy) : ''}</div>
          </div>
        </div>
        <div class="settings__entry-body">
          <div class="settings__field">
            <label class="settings__label">College / University</label>
            <input class="settings__input edu-field" type="text" data-field="institution" data-index="${i}" value="${escapeHtml(edu.institution || '')}" placeholder="Full name, e.g. Vasavi College of Engineering">
          </div>
          <div class="settings__row settings__row--2col">
            <div class="settings__field">
              <label class="settings__label">Degree / Course</label>
              <input class="settings__input edu-field" type="text" data-field="degree" data-index="${i}" value="${escapeHtml(edu.degree || '')}" list="degreeOptions" placeholder="B.Tech or Bachelor's Degree">
            </div>
            <div class="settings__field">
              <label class="settings__label">Field of Study / Branch</label>
              <input class="settings__input edu-field" type="text" data-field="fieldOfStudy" data-index="${i}" value="${escapeHtml(edu.fieldOfStudy || '')}" placeholder="Computer Science">
            </div>
          </div>
          <div class="settings__row settings__row--3col">
            <div class="settings__field">
              <label class="settings__label">Start Year</label>
              <input class="settings__input edu-field" type="text" data-field="startYear" data-index="${i}" value="${escapeHtml(edu.startYear || '')}" placeholder="2018">
            </div>
            <div class="settings__field">
              <label class="settings__label">End Year <span class="settings__label-hint">(or month/year)</span></label>
              <input class="settings__input edu-field" type="text" data-field="endYear" data-index="${i}" value="${escapeHtml(edu.endYear || '')}" placeholder="2026 or 05/2026">
              <span class="settings__date-hint" aria-live="polite"></span>
            </div>
            <div class="settings__field">
              <label class="settings__label">GPA</label>
              <input class="settings__input edu-field" type="text" data-field="gpa" data-index="${i}" value="${escapeHtml(edu.gpa || '')}" placeholder="3.8">
            </div>
          </div>
          <div class="settings__field">
            <label class="settings__label">Location</label>
            <input class="settings__input edu-field" type="text" data-field="location" data-index="${i}" value="${escapeHtml(edu.location || '')}" placeholder="San Francisco, CA">
          </div>
        </div>
        <div class="settings__entry-actions">
          <button class="settings__btn settings__btn--sm settings__btn--ghost edu-save" data-index="${i}">Save</button>
          ${entries.length > 1 ? `<button class="settings__btn settings__btn--sm settings__btn--danger edu-delete" data-index="${i}">Remove</button>` : ''}
        </div>
      </div>
    `).join('');

    // "Month of Graduation" questions need the month: show how the end is read
    container.querySelectorAll('[data-field="endYear"]').forEach(input => {
      updateDateHint(input);
      input.addEventListener('input', () => updateDateHint(input));
    });

    // Save buttons
    container.querySelectorAll('.edu-save').forEach(btn => {
      btn.addEventListener('click', () => saveEducation(parseInt(btn.dataset.index)));
    });

    // Delete buttons
    container.querySelectorAll('.edu-delete').forEach(btn => {
      btn.addEventListener('click', () => deleteEducation(parseInt(btn.dataset.index)));
    });
  }

  /** Read every education entry from the form, so adding/removing entries keeps unsaved edits. */
  function collectEducationForm() {
    if (!activeProfile) return;
    if (!activeProfile.education) activeProfile.education = [];
    document.querySelectorAll('#educationEntries .settings__entry').forEach(entry => {
      const index = parseInt(entry.dataset.index, 10);
      const edu = {};
      entry.querySelectorAll('.edu-field').forEach(f => { edu[f.dataset.field] = f.value.trim(); });
      activeProfile.education[index] = { ...(activeProfile.education[index] || {}), ...edu };
    });
  }

  async function saveEducation(index) {
    if (!activeProfile) return;
    collectEducationForm();

    await OriginFillStore.updateProfile(activeProfile.id, { education: activeProfile.education });
    profiles = await OriginFillStore.getProfiles();
    activeProfile = profiles.find(p => p.id === activeProfile.id);
    renderEducationEntries(activeProfile.education);
    showToast('✅', 'Education saved');
  }

  async function addEducation() {
    if (!activeProfile) return;
    collectEducationForm();
    activeProfile.education.push({ institution: '', degree: '', fieldOfStudy: '', startYear: '', endYear: '', gpa: '', location: '' });
    await OriginFillStore.updateProfile(activeProfile.id, { education: activeProfile.education });
    profiles = await OriginFillStore.getProfiles();
    activeProfile = profiles.find(p => p.id === activeProfile.id);
    renderEducationEntries(activeProfile.education);
  }

  async function deleteEducation(index) {
    if (!activeProfile || !activeProfile.education) return;
    collectEducationForm();
    activeProfile.education.splice(index, 1);
    if (activeProfile.education.length === 0) {
      activeProfile.education.push({ institution: '', degree: '', fieldOfStudy: '', startYear: '', endYear: '', gpa: '', location: '' });
    }
    await OriginFillStore.updateProfile(activeProfile.id, { education: activeProfile.education });
    profiles = await OriginFillStore.getProfiles();
    activeProfile = profiles.find(p => p.id === activeProfile.id);
    renderEducationEntries(activeProfile.education);
    showToast('🗑️', 'Education entry removed');
  }

  // ─── Work Experience Entries ───────────────────────────────────

  const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  /**
   * Say how a typed work date will be read ("December 2020"), so a day-first or month-first
   * mix-up shows here instead of on an application.
   */
  function updateDateHint(input) {
    const hint = input.parentElement.querySelector('.settings__date-hint');
    if (!hint) return;
    const value = input.value.trim();
    let text = '';
    let bad = false;
    if (value && !input.disabled) {
      const date = OriginFillFieldMapper.parseDate(value, OriginFillFieldMapper.dateOrderFor(activeProfile));
      if (!date) {
        bad = true;
        text = 'Can\'t read this date. Try 12/2020 or Dec 2020.';
      } else if (date.current) {
        text = 'Read as: still working here';
      } else {
        const month = date.month ? `${MONTH_NAMES[date.month - 1]} ` : '';
        text = `Read as: ${date.day ? `${date.day} ` : ''}${month}${date.year}`;
      }
    }
    hint.textContent = text;
    hint.classList.toggle('settings__date-hint--bad', bad);
  }

  function renderWorkEntries(entries) {
    const container = $('workEntries');
    if (!container) return;

    container.innerHTML = entries.map((work, i) => `
      <div class="settings__entry" data-index="${i}">
        <div class="settings__entry-header">
          <div>
            <div class="settings__entry-title">${escapeHtml(work.jobTitle || `Position ${i + 1}`)}</div>
            <div class="settings__entry-subtitle">${escapeHtml(work.company || '')}</div>
          </div>
        </div>
        <div class="settings__entry-body">
          <div class="settings__row settings__row--2col">
            <div class="settings__field">
              <label class="settings__label">Company</label>
              <input class="settings__input work-field" type="text" data-field="company" data-index="${i}" value="${escapeHtml(work.company || '')}" placeholder="Google">
            </div>
            <div class="settings__field">
              <label class="settings__label">Job Title</label>
              <input class="settings__input work-field" type="text" data-field="jobTitle" data-index="${i}" value="${escapeHtml(work.jobTitle || '')}" placeholder="Software Engineer">
            </div>
          </div>
          <div class="settings__row settings__row--2col">
            <div class="settings__field">
              <label class="settings__label">Start Date</label>
              <input class="settings__input work-field" type="text" data-field="startDate" data-index="${i}" value="${escapeHtml(work.startDate || '')}" placeholder="12/2020 or Dec 2020">
              <span class="settings__date-hint" aria-live="polite"></span>
            </div>
            <div class="settings__field">
              <label class="settings__label">End Date</label>
              <input class="settings__input work-field" type="text" data-field="endDate" data-index="${i}" value="${escapeHtml(work.isCurrent ? '' : (work.endDate || ''))}" placeholder="${work.isCurrent ? 'Present' : '06/2024 or Jun 2024'}" ${work.isCurrent ? 'disabled' : ''}>
              <span class="settings__date-hint" aria-live="polite"></span>
            </div>
          </div>
          <div class="settings__toggle-row" style="padding: 8px 0; border: none;">
            <span class="settings__toggle-label" style="font-size: 13px;">Currently working here</span>
            <label class="settings__switch">
              <input type="checkbox" class="work-field" data-field="isCurrent" data-index="${i}" ${work.isCurrent ? 'checked' : ''}>
              <span class="settings__switch-slider"></span>
            </label>
          </div>
          <div class="settings__field">
            <label class="settings__label">Location</label>
            <input class="settings__input work-field" type="text" data-field="location" data-index="${i}" value="${escapeHtml(work.location || '')}" placeholder="Mountain View, CA">
          </div>
          <div class="settings__field">
            <label class="settings__label">Description / Bullet Points <span class="settings__label-hint">(one per line, max 6)</span></label>
            <textarea class="settings__textarea work-field" data-field="bullets" data-index="${i}" rows="4" placeholder="• Led development of...">${(work.bullets || []).join('\n')}</textarea>
          </div>
        </div>
        <div class="settings__entry-actions">
          <button class="settings__btn settings__btn--sm settings__btn--ghost work-save" data-index="${i}">Save</button>
          ${entries.length > 1 ? `<button class="settings__btn settings__btn--sm settings__btn--danger work-delete" data-index="${i}">Remove</button>` : ''}
        </div>
      </div>
    `).join('');

    // Save
    container.querySelectorAll('.work-save').forEach(btn => {
      btn.addEventListener('click', () => saveWork(parseInt(btn.dataset.index)));
    });

    // Delete
    container.querySelectorAll('.work-delete').forEach(btn => {
      btn.addEventListener('click', () => deleteWork(parseInt(btn.dataset.index)));
    });

    // Show how each date will be read
    container.querySelectorAll('[data-field="startDate"], [data-field="endDate"]').forEach(input => {
      updateDateHint(input);
      input.addEventListener('input', () => updateDateHint(input));
    });

    // isCurrent toggle — disable end date
    container.querySelectorAll('[data-field="isCurrent"]').forEach(toggle => {
      toggle.addEventListener('change', () => {
        const idx = toggle.dataset.index;
        const endDate = container.querySelector(`[data-field="endDate"][data-index="${idx}"]`);
        if (endDate) {
          endDate.disabled = toggle.checked;
          endDate.placeholder = toggle.checked ? 'Present' : '06/2024 or Jun 2024';
          if (toggle.checked) endDate.value = '';
          updateDateHint(endDate);
        }
      });
    });
  }

  /** Read every work entry from the form, so adding/removing entries keeps unsaved edits. */
  function collectWorkForm() {
    if (!activeProfile) return;
    if (!activeProfile.workExperience) activeProfile.workExperience = [];
    document.querySelectorAll('#workEntries .settings__entry').forEach(entry => {
      const index = parseInt(entry.dataset.index, 10);
      const work = {};
      entry.querySelectorAll('.work-field').forEach(f => {
        if (f.dataset.field === 'isCurrent') {
          work.isCurrent = f.checked;
        } else if (f.dataset.field === 'bullets') {
          work.bullets = f.value.split('\n').map(l => l.replace(/^[•\-*]\s*/, '').trim()).filter(Boolean).slice(0, OriginFillUI.MAX_BULLET_POINTS);
        } else if (f.dataset.field === 'endDate' && entry.querySelector('[data-field="isCurrent"]')?.checked) {
          work.endDate = '';
        } else {
          work[f.dataset.field] = f.value.trim();
        }
      });
      activeProfile.workExperience[index] = { ...(activeProfile.workExperience[index] || {}), ...work };
    });
  }

  async function saveWork(index) {
    if (!activeProfile) return;
    collectWorkForm();

    await OriginFillStore.updateProfile(activeProfile.id, { workExperience: activeProfile.workExperience });
    profiles = await OriginFillStore.getProfiles();
    activeProfile = profiles.find(p => p.id === activeProfile.id);
    renderWorkEntries(activeProfile.workExperience);
    showToast('✅', 'Work experience saved');
  }

  async function addWork() {
    if (!activeProfile) return;
    collectWorkForm();
    activeProfile.workExperience.push({ company: '', jobTitle: '', startDate: '', endDate: '', isCurrent: false, location: '', bullets: [''] });
    await OriginFillStore.updateProfile(activeProfile.id, { workExperience: activeProfile.workExperience });
    profiles = await OriginFillStore.getProfiles();
    activeProfile = profiles.find(p => p.id === activeProfile.id);
    renderWorkEntries(activeProfile.workExperience);
  }

  async function deleteWork(index) {
    if (!activeProfile || !activeProfile.workExperience) return;
    collectWorkForm();
    activeProfile.workExperience.splice(index, 1);
    if (activeProfile.workExperience.length === 0) {
      activeProfile.workExperience.push({ company: '', jobTitle: '', startDate: '', endDate: '', isCurrent: false, location: '', bullets: [''] });
    }
    await OriginFillStore.updateProfile(activeProfile.id, { workExperience: activeProfile.workExperience });
    profiles = await OriginFillStore.getProfiles();
    activeProfile = profiles.find(p => p.id === activeProfile.id);
    renderWorkEntries(activeProfile.workExperience);
    showToast('🗑️', 'Work entry removed');
  }

  // ─── Resume Upload ─────────────────────────────────────────────
  let pendingResumeFile = null;

  async function loadResumes() {
    if (!activeProfile) return;
    const resumes = await OriginFillStore.getResumes(activeProfile.id);
    const list = $('resumesList');
    if (!list) return;

    resumes.sort((a, b) => String(a.uploadedAt || '').localeCompare(String(b.uploadedAt || '')));
    const defaultId = resumes.some(r => r.id === activeProfile.resume?.defaultId)
      ? activeProfile.resume.defaultId
      : resumes[0]?.id;

    list.innerHTML = resumes.map(r => `
      <div class="settings__resume-card" data-resume-id="${escapeHtml(r.id)}">
        <span class="settings__resume-icon">📄</span>
        <div class="settings__resume-info">
          <div class="settings__resume-name">${escapeHtml(r.label || r.fileName)}${r.id === defaultId ? '<span class="settings__resume-badge">Default</span>' : ''}</div>
          <div class="settings__resume-meta">${escapeHtml(r.fileName)} · Uploaded ${new Date(r.uploadedAt).toLocaleDateString()}</div>
        </div>
        ${r.id === defaultId ? '' : `<button class="settings__btn settings__btn--sm settings__btn--ghost resume-default" data-id="${escapeHtml(r.id)}" title="Upload this one to applications">Make default</button>`}
        <button class="settings__btn settings__btn--sm settings__btn--ghost resume-delete" data-id="${escapeHtml(r.id)}" title="Delete" aria-label="Delete resume">🗑️</button>
      </div>
    `).join('') || '<p class="settings__answers-empty">No resume uploaded yet.</p>';

    // Check limit
    const uploadBtn = $('uploadResumeBtn');
    const atLimit = resumes.length >= OriginFillUI.MAX_RESUME_COUNT;
    uploadBtn.disabled = atLimit || !pendingResumeFile;
    uploadBtn.title = atLimit ? `Maximum ${OriginFillUI.MAX_RESUME_COUNT} resumes — delete one first` : '';

    list.querySelectorAll('.resume-default').forEach(btn => {
      btn.addEventListener('click', async () => {
        await OriginFillStore.updateProfile(activeProfile.id, { resume: { ...(activeProfile.resume || {}), defaultId: btn.dataset.id } });
        profiles = await OriginFillStore.getProfiles();
        activeProfile = profiles.find(p => p.id === activeProfile.id);
        loadResumes();
        showToast('✅', 'Default resume updated');
      });
    });

    // Delete buttons
    list.querySelectorAll('.resume-delete').forEach(btn => {
      btn.addEventListener('click', async () => {
        await OriginFillStore.deleteResume(btn.dataset.id);
        loadResumes();
        showToast('🗑️', 'Resume deleted');
      });
    });
  }

  function selectResumeFile(file) {
    if (!/\.(pdf|docx?|rtf|txt)$/i.test(file.name)) {
      showToast('⚠️', 'Use a PDF or Word document');
      return;
    }
    if (file.size > OriginFillUI.MAX_RESUME_SIZE_MB * 1024 * 1024) {
      showToast('⚠️', `File too large (max ${OriginFillUI.MAX_RESUME_SIZE_MB}MB)`);
      return;
    }
    pendingResumeFile = file;
    $('uploadResumeBtn').disabled = false;
    $('uploadZone').querySelector('.settings__upload-hint').textContent = `Selected: ${file.name}`;
    if (!$('resumeLabel').value) $('resumeLabel').value = file.name.replace(/\.[^.]+$/, '');
  }

  async function uploadResume() {
    if (!pendingResumeFile || !activeProfile) return;

    const label = $('resumeLabel').value.trim() || pendingResumeFile.name;

    // Read file as base64
    const reader = new FileReader();
    reader.onload = async () => {
      const base64 = reader.result.split(',')[1]; // Remove data:... prefix

      const resumeData = {
        id: 'resume_' + Date.now().toString(36),
        label,
        fileName: pendingResumeFile.name,
        mimeType: pendingResumeFile.type || '',
        fileData: base64,
        uploadedAt: new Date().toISOString()
      };

      try {
        await OriginFillStore.saveResume(activeProfile.id, resumeData);
      } catch (err) {
        showToast('⚠️', err.message);
        return;
      }
      pendingResumeFile = null;
      $('resumeLabel').value = '';
      $('uploadResumeBtn').disabled = true;
      loadResumes();
      showToast('✅', `Resume "${label}" uploaded`);
    };

    reader.readAsDataURL(pendingResumeFile);
  }

  // ─── Event Listeners ──────────────────────────────────────────
  function setupEventListeners() {
    // Add profile
    $('addProfileBtn').addEventListener('click', async () => {
      const label = prompt('Profile name:');
      if (label && label.trim()) {
        await OriginFillStore.createProfile(label.trim());
        profiles = await OriginFillStore.getProfiles();
        renderProfiles();
        showToast('✅', `Profile "${label.trim()}" created`);
      }
    });

    // Save personal info
    $('savePersonalBtn').addEventListener('click', async () => {
      if (!activeProfile) return;
      const personal = {
        firstName: $('personalFirstName').value,
        lastName: $('personalLastName').value,
        fullName: $('personalFullName').value || `${$('personalFirstName').value} ${$('personalLastName').value}`.trim(),
        email: $('personalEmail').value,
        phone: $('personalPhone').value,
        address: $('personalAddress').value,
        address2: $('personalAddress2').value,
        phoneType: $('personalPhoneType').value,
        phoneCountryCode: $('personalPhoneCountryCode').value.trim(),
        city: $('personalCity').value,
        state: $('personalState').value,
        zipCode: $('personalZipCode').value,
        country: $('personalCountry').value,
        linkedIn: $('personalLinkedIn').value,
        github: $('personalGithub').value,
        portfolio: $('personalPortfolio').value,
        websites: $('personalWebsites').value.split('\n').map(s => s.trim()).filter(Boolean)
      };
      await OriginFillStore.updateProfile(activeProfile.id, { personal, websites: personal.websites });

      profiles = await OriginFillStore.getProfiles();
      activeProfile = profiles.find(p => p.id === activeProfile.id);
      $('welcomeBanner').hidden = true;
      showToast('✅', 'Personal info saved');
    });

    // Save skills
    $('saveSkillsBtn').addEventListener('click', async () => {
      if (!activeProfile) return;
      
      const normalizeInput = (raw) => {
        if (!raw) return [];
        // 1. Replace newlines with commas to avoid concatenating lines
        // 2. Replace colons (categories) with commas
        let text = raw.replace(/[\n\r]+/g, ',').replace(/:\s*/g, ',');
        return text.split(',')
          .map(s => s.trim().replace(/\.+$/, '').trim())
          .filter(Boolean);
      };

      const skills = normalizeInput($('skillsInput').value);
      const languages = normalizeInput($('languagesInput').value);
      const certifications = normalizeInput($('certificationsInput').value);
      
      await OriginFillStore.updateProfile(activeProfile.id, { skills, languages, certifications });
      profiles = await OriginFillStore.getProfiles();
      activeProfile = profiles.find(p => p.id === activeProfile.id);
      showToast('✅', 'Skills saved');
    });

    // Application answers
    $('addAnswerBtn').addEventListener('click', () => {
      const answers = collectAnswers();
      answers.push({ question: '', answer: '' });
      renderAnswers(answers);
      const rows = $('answersList').querySelectorAll('.answer-question');
      if (rows.length) rows[rows.length - 1].focus();
    });

    $('saveAnswersBtn').addEventListener('click', async () => {
      if (!activeProfile) return;
      const application = {
        referralSource: $('appReferralSource').value.trim(),
        previouslyEmployed: $('appPreviouslyEmployed').value
      };
      const answers = collectAnswers().filter(a => a.question && a.answer);
      // Replace (not merge) so cleared answers are removed
      await OriginFillStore.replaceProfileFields(activeProfile.id, { application, answers, faq: collectCommonQuestions() });
      profiles = await OriginFillStore.getProfiles();
      activeProfile = profiles.find(p => p.id === activeProfile.id);
      renderAnswers(activeProfile.answers || []);
      showToast('✅', 'Answers saved');
    });

    // Add education / work
    $('addEducationBtn').addEventListener('click', addEducation);
    $('addWorkBtn').addEventListener('click', addWork);

    // Resume upload
    const fileInput = $('resumeFileInput');
    $('browseBtn').addEventListener('click', (e) => { e.preventDefault(); fileInput.click(); });

    fileInput.addEventListener('change', () => {
      if (fileInput.files[0]) selectResumeFile(fileInput.files[0]);
    });

    $('uploadResumeBtn').addEventListener('click', uploadResume);

    // Drag & drop
    const uploadZone = $('uploadZone');
    uploadZone.addEventListener('dragover', (e) => { e.preventDefault(); uploadZone.classList.add('settings__upload-zone--dragover'); });
    uploadZone.addEventListener('dragleave', () => { uploadZone.classList.remove('settings__upload-zone--dragover'); });
    uploadZone.addEventListener('drop', (e) => {
      e.preventDefault();
      uploadZone.classList.remove('settings__upload-zone--dragover');
      if (e.dataTransfer.files[0]) selectResumeFile(e.dataTransfer.files[0]);
    });

    // Extension settings
    $('fillDelaySlider').addEventListener('input', (e) => {
      $('fillDelayValue').textContent = e.target.value;
    });

    $('saveExtSettingsBtn').addEventListener('click', async () => {
      settings.autoDetect = $('toggleAutoDetect').checked;
      settings.autoFillOnDetect = $('toggleAutoFill').checked;
      settings.showFloatingButton = $('toggleFloatingButton').checked;
      settings.overwriteExisting = $('toggleOverwrite').checked;
      settings.debugLogging = $('toggleDebug').checked;
      settings.showNotifications = $('toggleNotifications').checked;
      settings.recoveryEnabled = $('toggleRecovery').checked;
      settings.fillDelay = parseInt($('fillDelaySlider').value, 10);
      settings.theme = $('themeSelect').value;
      const { activeProfileId, ...changes } = settings;
      settings = await OriginFillStore.updateSettings(changes);
      applyTheme();
      showToast('✅', 'Settings saved');
    });

    // Export
    $('exportDataBtn').addEventListener('click', async () => {
      const data = await OriginFillStore.exportAllData();
      const json = JSON.stringify(data, null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `originfill_backup_${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      showToast('✅', 'Data exported');
    });

    // Import
    $('importDataBtn').addEventListener('click', () => $('importFileInput').click());
    $('importFileInput').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const text = await file.text();
      try {
        const data = JSON.parse(text);
        await OriginFillStore.importData(data, false);
        profiles = await OriginFillStore.getProfiles();
        settings = await OriginFillStore.getSettings();
        activeProfile = profiles.find(p => p.id === settings.activeProfileId) || profiles[0];
        renderProfiles();
        if (activeProfile) loadProfileData(activeProfile);
        loadExtensionSettings();
        showToast('✅', 'Data imported');
      } catch (err) {
        showToast('❌', 'Invalid file: ' + err.message);
      }
    });

    // Clear all data
    $('clearDataBtn').addEventListener('click', () => {
      showDialog(
        'Clear All Data',
        'Are you sure? This will permanently delete all profiles, settings, and saved data. This action cannot be undone.',
        async () => {
          await OriginFillStore.clearAllData();
          await OriginFillStore.initialize();
          profiles = await OriginFillStore.getProfiles();
          settings = await OriginFillStore.getSettings();
          activeProfile = profiles[0] || null;
          renderProfiles();
          if (activeProfile) loadProfileData(activeProfile);
          loadExtensionSettings();
          showToast('🗑️', 'All data cleared');
        }
      );
    });
  }

  // ─── Common Questions ──────────────────────────────────────────
  function renderCommonQuestions(profile) {
    const list = $('faqList');
    if (!list || typeof OriginFillFAQ === 'undefined') return;
    const answers = profile.faq || {};

    list.innerHTML = OriginFillFAQ.groupedForSettings().map(({ group, entries }) => `
      <div class="settings__faq-group">
        <div class="settings__faq-group-title">${escapeHtml(group.title)}</div>
        ${entries.map(entry => {
          const current = answers[entry.id] || '';
          const controlId = `faq-${entry.id}`;
          if (entry.type === 'text') {
            const suggestion = entry.derive ? entry.derive(profile, answers) : '';
            const placeholder = suggestion ? `Auto: ${suggestion}` : (entry.placeholder || '');
            return `
              <div class="settings__faq-row">
                <label class="settings__faq-question" for="${controlId}">${escapeHtml(entry.question)}</label>
                <input class="settings__input settings__faq-input" type="text" id="${controlId}" data-faq-id="${escapeHtml(entry.id)}"
                       value="${escapeHtml(current)}" placeholder="${escapeHtml(placeholder)}">
              </div>`;
          }
          const options = ['', ...Object.keys(entry.choices)];
          return `
            <div class="settings__faq-row">
              <span class="settings__faq-question" id="${controlId}-label">${escapeHtml(entry.question)}</span>
              <div class="settings__segmented" role="radiogroup" aria-labelledby="${controlId}-label" data-faq-id="${escapeHtml(entry.id)}">
                ${options.map(option => `
                  <label class="settings__segment${option ? '' : ' settings__segment--unset'}">
                    <input type="radio" name="${controlId}" value="${escapeHtml(option)}" ${option === current ? 'checked' : ''}>
                    <span>${option ? escapeHtml(option) : 'Not set'}</span>
                  </label>`).join('')}
              </div>
            </div>`;
        }).join('')}
      </div>
    `).join('');
  }

  function collectCommonQuestions() {
    const faq = {};
    document.querySelectorAll('#faqList .settings__faq-input').forEach(input => {
      if (input.value.trim()) faq[input.dataset.faqId] = input.value.trim();
    });
    document.querySelectorAll('#faqList .settings__segmented').forEach(group => {
      const checked = group.querySelector('input:checked');
      if (checked && checked.value) faq[group.dataset.faqId] = checked.value;
    });
    return faq;
  }

  // ─── Saved Answers ─────────────────────────────────────────────
  function renderAnswers(answers) {
    const list = $('answersList');
    if (!list) return;

    if (!answers.length) {
      list.innerHTML = '<p class="settings__answers-empty">No saved answers yet.</p>';
      return;
    }

    list.innerHTML = answers.map((a, i) => `
      <div class="settings__answer-row" data-index="${i}">
        <input class="settings__input answer-question" type="text" value="${escapeHtml(a.question || '')}" placeholder="Question words, e.g. require sponsorship" aria-label="Question ${i + 1}">
        <input class="settings__input answer-answer" type="text" value="${escapeHtml(a.answer || '')}" placeholder="Answer, e.g. No" aria-label="Answer ${i + 1}">
        <button class="settings__btn settings__btn--sm settings__btn--ghost answer-delete" title="Remove" aria-label="Remove answer ${i + 1}">🗑️</button>
      </div>
    `).join('');

    list.querySelectorAll('.answer-delete').forEach(btn => {
      btn.addEventListener('click', () => {
        const index = parseInt(btn.closest('.settings__answer-row').dataset.index, 10);
        const current = collectAnswers();
        current.splice(index, 1);
        renderAnswers(current);
      });
    });
  }

  function collectAnswers() {
    return Array.from(document.querySelectorAll('#answersList .settings__answer-row')).map(row => ({
      question: row.querySelector('.answer-question').value.trim(),
      answer: row.querySelector('.answer-answer').value.trim()
    }));
  }

  // ─── Load Extension Settings into Form ─────────────────────────
  function loadExtensionSettings() {
    $('toggleAutoDetect').checked = settings.autoDetect !== false;
    $('toggleAutoFill').checked = settings.autoFillOnDetect === true;
    $('toggleFloatingButton').checked = settings.showFloatingButton !== false;
    $('toggleOverwrite').checked = settings.overwriteExisting !== false;
    $('toggleDebug').checked = settings.debugLogging === true;
    $('toggleNotifications').checked = settings.showNotifications !== false;
    $('toggleRecovery').checked = settings.recoveryEnabled !== false;
    $('fillDelaySlider').value = settings.fillDelay ?? 150;
    $('fillDelayValue').textContent = settings.fillDelay ?? 150;
    $('themeSelect').value = settings.theme || 'system';
  }

  // ─── Theme ─────────────────────────────────────────────────────
  function applyTheme() {
    chrome.storage.local.get('originfill_settings', (result) => {
      const s = result.originfill_settings || {};
      if (s.theme === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
      else if (s.theme === 'light') document.documentElement.setAttribute('data-theme', 'light');
      else document.documentElement.removeAttribute('data-theme');
    });
  }

  // ─── Dialog ────────────────────────────────────────────────────
  let dialogCallback = null;

  function showDialog(title, text, onConfirm) {
    $('dialogTitle').textContent = title;
    $('dialogText').textContent = text;
    dialogCallback = onConfirm;
    $('confirmDialog').showModal();
  }

  $('dialogConfirmBtn').addEventListener('click', async () => {
    $('confirmDialog').close();
    if (dialogCallback) await dialogCallback();
    dialogCallback = null;
  });

  $('dialogCancelBtn').addEventListener('click', () => {
    $('confirmDialog').close();
    dialogCallback = null;
  });

  // ─── Toast ─────────────────────────────────────────────────────
  let toastTimer = null;

  function showToast(icon, text) {
    $('toastIcon').textContent = icon;
    $('toastText').textContent = text;
    $('toast').hidden = false;

    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { $('toast').hidden = true; }, 3000);
  }

  // ─── Utility ───────────────────────────────────────────────────
  function escapeHtml(str) {
    if (str === undefined || str === null) return '';
    return String(str).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // ─── Run ───────────────────────────────────────────────────────
  await init();
})();
