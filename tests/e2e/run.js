/**
 * End-to-end test: loads the unpacked extension into Chromium / Chrome for Testing and fills a
 * mock Workday application (tests/e2e/mock-workday) served on a *.myworkdayjobs.com hostname,
 * plus a plain form on a jobs.lever.co hostname.
 *
 *   npm run test:e2e                 headless
 *   HEADED=1 npm run test:e2e        watch it
 *   CHROME_PATH=/path/to/chrome …    pick the browser (branded Google Chrome ignores --load-extension)
 *
 * Needs playwright-core (devDependency) and a Chromium build: `npx playwright install chromium`.
 */
'use strict';

const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright-core');

const ROOT = path.join(__dirname, '..', '..');
const MOCK_DIR = path.join(__dirname, 'mock-workday');
const WORKDAY_HOST = 'acme.wd5.myworkdayjobs.com';
const LEVER_HOST = 'jobs.lever.co';
const YELLO_HOST = 'eyglobal.yello.co';

// ─── Test data ───────────────────────────────────────────────────

const PROFILE = {
  id: 'profile_e2e',
  label: 'E2E Profile',
  isDefault: true,
  schemaVersion: 4,
  personal: {
    firstName: 'Ada', middleName: '', lastName: 'Lovelace', fullName: '',
    email: 'ada@example.com', phone: '+1 (555) 123-4567', phoneType: 'Mobile', phoneCountryCode: '+1',
    address: '12 Analytical Way', address2: '', city: 'Austin', state: 'CA', zipCode: '78701', country: 'USA',
    linkedIn: 'https://linkedin.com/in/ada', github: '', portfolio: '', websites: ['https://ada.dev']
  },
  application: { referralSource: 'LinkedIn', previouslyEmployed: 'No' },
  answers: [
    { question: 'authorized to work', answer: 'Yes' },
    { question: 'require sponsorship', answer: 'No' }
  ],
  // Common questions answered once in Settings (utils/faq.js)
  faq: { disability: 'No', majorIllness: 'No', noticePeriod: '30 days', preferredLocation: 'Hyderabad, Pune' },
  workExperience: [
    { company: 'Analytical Engines', jobTitle: 'Staff Engineer', location: 'Austin, TX', isCurrent: true, startDate: '2021-03', endDate: '', bullets: ['Led the engine team', 'Shipped v2'] },
    { company: 'Difference Labs', jobTitle: 'Software Engineer', location: 'Remote', isCurrent: false, startDate: 'Jun 2018', endDate: '15-02-2021', bullets: ['Built tools'] }
  ],
  education: [
    { institution: 'Stanford University', degree: "Master's", fieldOfStudy: 'Computer Science', startYear: '2016', endYear: '05/2018', gpa: '3.9', location: '' }
  ],
  skills: ['Python', 'JavaScript', 'SQL', 'Rust'],
  certifications: [],
  languages: [],
  resume: { defaultId: '', fileName: '', fileData: '', uploadedAt: '' }
};

// "%PDF-1.4 test" — enough to be a file
const RESUME_BASE64 = Buffer.from('%PDF-1.4\n% OriginFill e2e résumé\n').toString('base64');

// ─── Helpers ─────────────────────────────────────────────────────

const failures = [];
let passes = 0;

function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    passes++;
    console.log(`  ✓ ${name}`);
  } else {
    failures.push(name);
    console.log(`  ✗ ${name}\n      expected ${JSON.stringify(expected)}\n      actual   ${JSON.stringify(actual)}`);
  }
}

function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const cacheDirs = [
    path.join(os.homedir(), 'Library', 'Caches', 'ms-playwright'),
    path.join(os.homedir(), '.cache', 'ms-playwright'),
    path.join(process.env.LOCALAPPDATA || '', 'ms-playwright')
  ];
  const candidates = [
    'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
    'chrome-mac/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
    'chrome-mac/Chromium.app/Contents/MacOS/Chromium',
    'chrome-linux64/chrome',
    'chrome-linux/chrome',
    'chrome-win64/chrome.exe',
    'chrome-win/chrome.exe'
  ];
  for (const dir of cacheDirs) {
    if (!dir || !fs.existsSync(dir)) continue;
    const builds = fs.readdirSync(dir).filter(d => /^chromium-\d+$/.test(d)).sort().reverse();
    for (const build of builds) {
      for (const rel of candidates) {
        const full = path.join(dir, build, rel);
        if (fs.existsSync(full)) return full;
      }
    }
  }
  throw new Error('No Chromium found. Run `npx playwright install chromium` or set CHROME_PATH.');
}

function startServer() {
  // React 18 ships UMD builds (not in its package "exports", so resolve the package folder)
  const pkgDir = (name) => path.dirname(require.resolve(`${name}/package.json`));
  const vendor = {
    '/vendor/react.js': path.join(pkgDir('react'), 'umd', 'react.development.js'),
    '/vendor/react-dom.js': path.join(pkgDir('react-dom'), 'umd', 'react-dom.development.js'),
    '/vendor/jquery.js': path.join(pkgDir('jquery'), 'dist', 'jquery.js'),
    '/vendor/select2.js': path.join(pkgDir('select2'), 'dist', 'js', 'select2.js'),
    '/vendor/select2.css': path.join(pkgDir('select2'), 'dist', 'css', 'select2.css')
  };
  // Option lists the Yello mock's Select2 boxes fetch as you type
  const OPTION_LISTS = {
    schools: ['IIT Bombay', 'Massachusetts Institute of Technology', 'Other', 'Stanford University', 'University of Washington'],
    majors: ['Computer Science', 'Electrical Engineering', 'Mathematics', 'Other'],
    countries: ['Canada', 'India', 'United Kingdom', 'United States of America'],
    cities: ['Bengaluru', 'Hyderabad', 'Pune']
  };
  const genericForm = fs.readFileSync(path.join(__dirname, 'generic-form.html'));
  const yelloForm = fs.readFileSync(path.join(__dirname, 'yello-form.html'));

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const send = (body, type) => { res.writeHead(200, { 'Content-Type': type }); res.end(body); };

    if (vendor[url.pathname]) return send(fs.readFileSync(vendor[url.pathname]), url.pathname.endsWith('.css') ? 'text/css' : 'text/javascript');
    if (url.pathname === '/api/options') {
      const list = OPTION_LISTS[url.searchParams.get('list')] || [];
      const q = (url.searchParams.get('q') || '').toLowerCase();
      const results = list.map((text, i) => ({ id: String(100 + i), text })).filter(o => o.text.toLowerCase().includes(q));
      setTimeout(() => send(JSON.stringify({ results }), 'application/json'), 300); // Network delay
      return undefined;
    }
    if (url.pathname === '/app.js') return send(fs.readFileSync(path.join(MOCK_DIR, 'app.js')), 'text/javascript');
    if ((req.headers.host || '').startsWith(LEVER_HOST)) return send(genericForm, 'text/html');
    if ((req.headers.host || '').startsWith(YELLO_HOST)) return send(yelloForm, 'text/html');
    return send(fs.readFileSync(path.join(MOCK_DIR, 'index.html')), 'text/html');
  });

  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

async function panelText(page, selector) {
  return page.evaluate((sel) => {
    const root = document.querySelector('#originfill-panel-host')?.shadowRoot;
    const el = root && root.querySelector(sel);
    return el ? el.textContent.trim() : null;
  }, selector);
}

async function panelVisible(page) {
  return page.evaluate(() => {
    const wrap = document.querySelector('#originfill-panel-host')?.shadowRoot?.querySelector('.wrap');
    return !!(wrap && !wrap.hidden);
  });
}

/** Click the in-page Autofill button and wait for the result card. */
async function autofill(page, sw) {
  await page.waitForFunction(() => {
    const root = document.querySelector('#originfill-panel-host')?.shadowRoot;
    return root && !root.querySelector('.wrap').hidden && /^(Autofill|Upload)/.test(root.querySelector('#pillText').textContent);
  }, null, { timeout: 15000 });

  const before = Date.now();
  await page.evaluate(() => {
    document.querySelector('#originfill-panel-host').shadowRoot.querySelector('#pillText').textContent = '';
  });
  await page.locator('#originfill-panel-host #pill').click();
  await page.waitForFunction(() => {
    const root = document.querySelector('#originfill-panel-host')?.shadowRoot;
    return root && root.querySelector('#pillText').textContent === 'Autofill again';
  }, null, { timeout: 120000 });

  // The full report is kept by the background per tab
  const report = await sw.evaluate(async (since) => {
    const all = await chrome.storage.session.get(null);
    return Object.entries(all)
      .filter(([k, v]) => k.startsWith('lastReport_') && Date.parse(v.timestamp) >= since - 1000)
      .map(([, v]) => v)
      .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))[0] || null;
  }, before);
  return report;
}

function rowsWith(report, status) {
  return (report?.results || []).filter(r => r.status === status).map(r => r.field);
}

const state = (page) => page.evaluate(() => JSON.parse(JSON.stringify(window.__mockState)));

// ─── Test run ────────────────────────────────────────────────────

async function main() {
  const server = await startServer();
  const port = server.address().port;
  const base = `http://${WORKDAY_HOST}:${port}/en-US/External/job/Austin-TX/Software-Engineer_JR123/apply/applyManually`;
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'originfill-e2e-'));

  const context = await chromium.launchPersistentContext(userDataDir, {
    executablePath: findChrome(),
    headless: !process.env.HEADED,
    viewport: { width: 1280, height: 900 },
    args: [
      `--disable-extensions-except=${ROOT}`,
      `--load-extension=${ROOT}`,
      `--host-resolver-rules=MAP ${WORKDAY_HOST} 127.0.0.1, MAP ${LEVER_HOST} 127.0.0.1, MAP ${YELLO_HOST} 127.0.0.1`
    ]
  });

  const pageErrors = [];
  const watch = (page, label) => {
    if (process.env.DEBUG) page.on('console', m => { if (/OriginFill/.test(m.text())) console.log(`    [${label}] ${m.text().replace(/%c/g, '')}`); });
    page.on('pageerror', e => pageErrors.push(`${label}: ${e.message}`));
    page.on('console', m => {
      if (m.type() === 'error' && /OriginFill|chrome-extension/.test(m.text())) pageErrors.push(`${label}: ${m.text()}`);
    });
  };

  try {
    let [sw] = context.serviceWorkers();
    if (!sw) sw = await context.waitForEvent('serviceworker');
    const extensionId = new URL(sw.url()).host;
    console.log(`Extension loaded: ${extensionId}`);

    // Onboarding opens Settings on install
    await new Promise(r => setTimeout(r, 1000));
    console.log('\nInstall');
    check('opens Settings for onboarding', context.pages().some(p => p.url().includes('/settings/settings.html')), true);

    // ─── Seed profile, settings and résumé ───
    await sw.evaluate(async ({ profile, debug }) => {
      await chrome.storage.local.set({
        originfill_profiles: [profile],
        originfill_settings: {
          activeProfileId: profile.id, autoDetect: true, autoFillOnDetect: false, showFloatingButton: true,
          overwriteExisting: true, showNotifications: true, recoveryEnabled: true, fillDelay: 0, theme: 'system',
          debugLogging: debug, useEncryption: true, usePassphrase: false
        }
      });
    }, { profile: PROFILE, debug: !!process.env.DEBUG });

    const settingsPage = context.pages().find(p => p.url().includes('/settings/settings.html')) || await context.newPage();
    watch(settingsPage, 'settings');
    await settingsPage.goto(`chrome-extension://${extensionId}/settings/settings.html#resume`);
    await settingsPage.waitForFunction(() => typeof OriginFillStore !== 'undefined');
    await settingsPage.evaluate(async ({ profileId, data }) => {
      await OriginFillStore.saveResume(profileId, {
        id: 'resume_e2e', label: 'Main', fileName: 'Ada_Lovelace_Resume.pdf', mimeType: 'application/pdf',
        fileData: data, uploadedAt: new Date().toISOString()
      });
    }, { profileId: PROFILE.id, data: RESUME_BASE64 });

    // ─── Settings page renders the profile ───
    console.log('\nSettings page');
    await settingsPage.reload();
    await settingsPage.waitForFunction(() => document.getElementById('personalFirstName').value !== '');
    check('loads the profile into the form', await settingsPage.inputValue('#personalFirstName'), 'Ada');
    check('shows the saved answers', await settingsPage.locator('#answersList .answer-question').count(), 2);
    check('lists the résumé as default', await settingsPage.locator('.settings__resume-badge').count(), 1);

    // ─── Workday: sign-in step ───
    const page = await context.newPage();
    watch(page, 'workday');
    await page.goto(`${base}?step=signin`);
    await page.waitForSelector('[data-automation-id="signInContent"]');
    await page.waitForTimeout(1500);

    console.log('\nWorkday · Create Account/Sign In');
    check('hides the Autofill button on the sign-in step', await panelVisible(page), false);
    await page.fill('[data-automation-id="formField-email"] input', 'ada@example.com');
    await page.fill('#pw', 'not-a-real-password');
    await page.locator('#pw').blur();
    await page.waitForTimeout(1200);
    const recoveryAfterSignIn = await sw.evaluate(async () => (await chrome.storage.local.get('originfill_session_recovery')).originfill_session_recovery || null);
    check('never stores the password', JSON.stringify(recoveryAfterSignIn || {}).includes('not-a-real-password'), false);
    check('no false "session expired" on the sign-in step', !!(recoveryAfterSignIn && recoveryAfterSignIn.timedOut), false);

    // ─── My Information ───
    await page.click('[data-automation-id="bottom-navigation-next-button"]');
    await page.waitForSelector('[data-automation-id="contactInformationPage"]');

    console.log('\nWorkday · My Information');
    check('shows the step name on the button', await (async () => {
      await page.waitForFunction(() => /My Information/.test(document.querySelector('#originfill-panel-host')?.shadowRoot?.querySelector('#pillText')?.textContent || ''), null, { timeout: 10000 }).catch(() => {});
      return panelText(page, '#pillText');
    })(), 'Autofill My Information');

    const info = await autofill(page, sw);
    const s1 = await state(page);
    check('panel does not cover "Save and Continue"', await page.evaluate(() => {
      const next = document.querySelector('[data-automation-id="bottom-navigation-next-button"]').getBoundingClientRect();
      const pill = document.querySelector('#originfill-panel-host').shadowRoot.querySelector('.wrap').getBoundingClientRect();
      return pill.bottom <= next.top || pill.right <= next.left || pill.left >= next.right;
    }), true);
    check('How did you hear (search prompt)', s1.source, ['LinkedIn']);
    check('Previously worked here (radio)', s1.previousWorker, 'false');
    check('Country (long scrolling dropdown, "USA")', s1.country, 'United States of America');
    check('First name', s1.firstName, 'Ada');
    check('Last name', s1.lastName, 'Lovelace');
    check('Preferred-name checkbox untouched', s1.preferredCheck, false);
    check('Address line 1', s1.address1, '12 Analytical Way');
    check('City', s1.city, 'Austin');
    check('State ("CA" → California)', s1.state, 'California');
    check('Postal code', s1.postalCode, '78701');
    check('Email', s1.email, 'ada@example.com');
    check('Phone device type', s1.phoneType, 'Mobile');
    check('Country phone code', s1.countryPhoneCode, ['United States of America (+1)']);
    check('Phone number without the +1', s1.phone, '(555) 123-4567');
    check('Phone extension untouched', s1.extension, '');
    check('no failed fields', rowsWith(info, 'failed'), []);
    check('fields blurred like a person would', s1.firstName && (await page.evaluate(() => window.__mockEvents)).includes('blur:firstName'), true);

    // Second run changes nothing
    const again = await autofill(page, sw);
    check('second run finds everything already filled', again.failedCount, 0);

    // ─── Session expiry → restore ───
    console.log('\nSession recovery');
    await page.locator('[data-automation-id="formField-city"] input').focus();
    await page.locator('[data-automation-id="formField-city"] input').blur();
    await page.waitForTimeout(1200);
    await page.evaluate(() => window.__mockExpire());
    await page.waitForTimeout(1800);
    const recovery = await sw.evaluate(async () => (await chrome.storage.local.get('originfill_session_recovery')).originfill_session_recovery || null);
    check('detects the "session has expired" dialog', !!(recovery && recovery.timedOut), true);

    await page.goto(`${base}?step=my-information`);
    await page.waitForSelector('[data-automation-id="contactInformationPage"]');
    await page.waitForFunction(() => !!document.querySelector('#originfill-panel-host')?.shadowRoot?.querySelector('#restore'), null, { timeout: 10000 }).catch(() => {});
    check('offers to restore after reload', !!(await panelText(page, '#restore')), true);
    if (await panelText(page, '#restore')) {
      await page.locator('#originfill-panel-host #restore').click();
      await page.waitForFunction(() => {
        const root = document.querySelector('#originfill-panel-host')?.shadowRoot;
        return root && root.querySelector('#pillText').textContent === 'Autofill again';
      }, null, { timeout: 30000 }).catch(() => {});
      const restored = await state(page);
      check('restores typed values by label', [restored.firstName, restored.lastName, restored.city, restored.email], ['Ada', 'Lovelace', 'Austin', 'ada@example.com']);
    }

    // ─── My Experience ───
    await page.click('[data-automation-id="bottom-navigation-next-button"]');
    await page.waitForSelector('[data-automation-id="myExperiencePage"]');

    console.log('\nWorkday · My Experience');
    const exp = await autofill(page, sw);
    const s2 = await state(page);
    check('adds one Work Experience entry per job', s2.workCount, 2);
    check('job 1 title/company/location', [s2['work0.jobTitle'], s2['work0.company'], s2['work0.location']], ['Staff Engineer', 'Analytical Engines', 'Austin, TX']);
    check('job 1 "I currently work here"', s2['work0.current'], true);
    check('job 1 From (month/year boxes)', s2['work0.from'], { month: '03', year: '2021' });
    check('job 1 description from bullets', s2['work0.description'], 'Led the engine team\nShipped v2');
    check('job 2 dates ("Jun 2018" → "15-02-2021")', [s2['work1.from'], s2['work1.to']], [{ month: '06', year: '2018' }, { month: '02', year: '2021' }]);
    check('job 2 not current', s2['work1.current'], false);
    check('adds the Education entry', s2.educationCount, 1);
    check('school (search prompt)', s2['edu0.school'], ['Stanford University']);
    check('degree ("Master\'s" → "Master\'s Degree")', s2['edu0.degree'], "Master's Degree");
    check('field of study', s2['edu0.fieldOfStudy'], ['Computer Science']);
    check('GPA', s2['edu0.gpa'], '3.9');
    check('education years', [s2['edu0.from'], s2['edu0.to']], [{ month: '', year: '2016' }, { month: '', year: '2018' }]);
    check('skills that exist in Workday\'s list', s2.skills, ['Python', 'JavaScript', 'SQL']);
    check('never unticks a skill it picked', (await page.evaluate(() => window.__mockEvents)).filter(e => e.startsWith('pick:') && /Python|JavaScript|SQL/.test(e)).length, 3);
    check('reports the skill it could not find', (exp.results || []).some(r => /Rust/.test(r.note || '')), true);
    check('uploads the résumé', (s2.resumeFiles || []).map(f => f.name), ['Ada_Lovelace_Resume.pdf']);
    check('adds the website entry', [s2.webCount, s2['web0.url']], [1, 'https://ada.dev']);
    check('LinkedIn', s2.linkedIn, 'https://linkedin.com/in/ada');
    check('no failed fields', rowsWith(exp, 'failed'), []);
    check('fills My Experience in under 20 seconds', exp.elapsed < 20000, true);
    check('clears an unmatched skill from the search box', await page.inputValue('[data-automation-id="formField-skills"] input'), '');
    check('does not flag exact alias matches ("Master\'s" → "Master\'s Degree")', rowsWith(exp, 'attention').includes('Degree'), false);

    const repeat = await autofill(page, sw);
    const s2b = await state(page);
    check('running again does not add duplicate entries', [s2b.workCount, s2b.educationCount, s2b.webCount], [2, 1, 1]);
    check('running again does not upload the résumé twice', (s2b.resumeFiles || []).length, 1);
    check('running again reports no failures', repeat.failedCount, 0);

    // ─── Application Questions ───
    await page.click('[data-automation-id="bottom-navigation-next-button"]');
    await page.waitForSelector('[data-automation-id="primaryQuestionnairePage"]');

    console.log('\nWorkday · Application Questions');
    const questions = await autofill(page, sw);
    const s3 = await state(page);
    check('answers "authorized to work" from saved answers (radio)', s3.authorized, 'yes');
    check('answers "require sponsorship" from saved answers (dropdown)', s3.sponsorship, 'No');
    check('leaves the open question for you', s3.interest || '', '');
    check('leaves salary alone', s3.salary || '', '');
    check('lists the open question as "fill yourself"', rowsWith(questions, 'skipped').some(f => /interests you/.test(f)), true);
    check('reads a question written as rich text (Country/Region of Residence)', s3.residence, 'United States of America');
    check('"Do you have a disability…?" from common answers', s3.disabilityQ, 'No');
    check('"major illness/surgery/accident?" from common answers', s3.illness, 'no');
    check('notice period (text) from common answers', s3.notice, '30 days');
    check('years of experience worked out from work history ("6-10 years")', s3.experience, '6-10 years');
    check('leaves an unanswered common question for you', s3.relocate || '', '');
    check('says where to answer it once', (questions.results || []).some(r => /relocate/i.test(r.note || '') && /Common Questions/.test(r.note || '')), true);
    check('your own answers count as filled (not "check")', (questions.results || []).filter(r => /disability|illness|notice/i.test(r.field)).map(r => r.status), ['success', 'success', 'success']);

    // ─── Voluntary Disclosures ───
    await page.click('[data-automation-id="bottom-navigation-next-button"]');
    await page.waitForSelector('[data-automation-id="voluntaryDisclosuresPage"]');

    console.log('\nWorkday · Voluntary Disclosures');
    await autofill(page, sw);
    const s4 = await state(page);
    check('never answers gender / veteran / consent on its own', [s4.gender, s4.veteran, s4.consent], ['', '', false]);
    const today = new Date();
    check('signs the self-identification form with your name', s4.selfName, 'Ada Lovelace');
    check('dates it today', [s4.selfDate.month, s4.selfDate.day, s4.selfDate.year], [
      String(today.getMonth() + 1).padStart(2, '0'),
      String(today.getDate()).padStart(2, '0'),
      String(today.getFullYear())
    ]);
    check('ticks the matching disability box', s4.disabilityBoxes, ['No, I do not have a disability and have not had one in the past']);

    // ─── Review ───
    await page.click('[data-automation-id="bottom-navigation-next-button"]');
    await page.waitForSelector('[data-automation-id="reviewJobApplicationPage"]');
    await page.waitForTimeout(800);
    console.log('\nWorkday · Review');
    check('hides the Autofill button on Review', await panelVisible(page), false);

    // ─── "Autofill with Resume" path: the first step is only the upload ───
    console.log('\nWorkday · Autofill with Resume');
    const resumeStep = await context.newPage();
    watch(resumeStep, 'workday-resume');
    await resumeStep.goto(`${base}?flow=autofill&step=autofill-resume`);
    await resumeStep.waitForSelector('[data-automation-id="applyFlowAutoFillPage"]');
    await resumeStep.waitForFunction(() => document.querySelector('#originfill-panel-host')?.shadowRoot?.querySelector('#pillText')?.textContent === 'Upload my résumé', null, { timeout: 10000 }).catch(() => {});
    check('offers "Upload my résumé" on the upload-only step', await panelText(resumeStep, '#pillText'), 'Upload my résumé');
    await autofill(resumeStep, sw);
    check('uploads the résumé there', ((await state(resumeStep)).resumeFiles || []).map(f => f.name), ['Ada_Lovelace_Resume.pdf']);

    // ─── A Workday site that ignores clicks from scripts; dates written day-first ───
    console.log('\nWorkday · site that ignores script clicks, day-first dates');
    await sw.evaluate(async (profile) => {
      await chrome.storage.local.set({ originfill_profiles: [profile] });
    }, {
      ...PROFILE,
      personal: { ...PROFILE.personal, country: 'India', phoneCountryCode: '+91' },
      workExperience: [
        { company: 'Numpy', jobTitle: 'Software Engineer', location: 'Hyderabad, India', isCurrent: false, startDate: '21-12-2020', endDate: '05-06-2022', bullets: ['Built things'] },
        { company: 'Analytical Engines', jobTitle: 'Intern', location: 'Hyderabad', isCurrent: false, startDate: '01-01-2019', endDate: '30-06-2019', bullets: [] }
      ],
      education: [
        { institution: 'Vasavi College of Engineering', degree: 'B.Tech', fieldOfStudy: 'Electronics and Communication', startYear: '2015', endYear: '2019', gpa: '8.4', location: '' }
      ]
    });
    const strict = await context.newPage();
    watch(strict, 'workday-strict');
    await strict.goto(`${base}?step=my-experience&strictClicks=1`);
    await strict.waitForSelector('[data-automation-id="myExperiencePage"]');
    const strictReport = await autofill(strict, sw);
    const s5 = await state(strict);
    const strictEvents = await strict.evaluate(() => window.__mockEvents);
    check('picks skills with the keyboard when clicks are ignored', s5.skills, ['Python', 'JavaScript', 'SQL']);
    check('used the keyboard', strictEvents.filter(e => e.startsWith('pick:keyboard:')).length >= 3, true);
    check('job 1 from "21-12-2020" / "05-06-2022" (India → day first)', [s5['work0.from'], s5['work0.to']], [{ month: '12', year: '2020' }, { month: '06', year: '2022' }]);
    check('job 1 title/company', [s5['work0.jobTitle'], s5['work0.company']], ['Software Engineer', 'Numpy']);
    check('job 2 from "01-01-2019" / "30-06-2019"', [s5['work1.from'], s5['work1.to']], [{ month: '01', year: '2019' }, { month: '06', year: '2019' }]);
    check('college Workday doesn\'t list → "Other"', s5['edu0.school'], ['Other']);
    check('field of study it doesn\'t list → "Other - Not Listed"', s5['edu0.fieldOfStudy'], ['Other - Not Listed']);
    check('"B.Tech" → "Bachelor\'s Degree"', s5['edu0.degree'], "Bachelor's Degree");
    check('flags the "Other" picks for a look', (strictReport.results || []).filter(r => /isn't in Workday's list/.test(r.note || '')).map(r => r.status), ['attention', 'attention']);
    check('no failed fields (keyboard path)', rowsWith(strictReport, 'failed'), []);
    check('keyboard path stays quick (under 30 seconds)', strictReport.elapsed < 30000, true);
    await sw.evaluate(async (profile) => {
      await chrome.storage.local.set({ originfill_profiles: [profile] });
    }, PROFILE);
    await strict.close();

    // ─── Generic form (non-Workday) ───
    console.log('\nGeneric form (jobs.lever.co)');
    const lever = await context.newPage();
    watch(lever, 'lever');
    await lever.goto(`http://${LEVER_HOST}:${port}/acme/apply`);
    await lever.waitForSelector('form');
    const leverReport = await autofill(lever, sw);
    const leverValues = await lever.evaluate(() => Object.fromEntries(
      Array.from(document.querySelectorAll('input, select, textarea')).map(el => [el.name, el.type === 'file' ? Array.from(el.files).map(f => f.name) : el.value])
    ));
    check('full name', leverValues.name, 'Ada Lovelace');
    check('email', leverValues.email, 'ada@example.com');
    check('phone', leverValues.phone, '+1 (555) 123-4567');
    check('current company', leverValues.org, 'Analytical Engines');
    check('LinkedIn', leverValues['urls[LinkedIn]'], 'https://linkedin.com/in/ada');
    check('current location → city', leverValues.location, 'Austin');
    check('résumé file input', leverValues.resume, ['Ada_Lovelace_Resume.pdf']);
    check('sponsorship select from saved answers', leverValues.sponsorship, 'no');
    check('college not in the list → "Others" + "Enter your college name"', [leverValues.college, leverValues.collegeOther], ['others', 'Stanford University']);
    check('course not in the list → "Other" + "Please specify"', [leverValues.course, leverValues.courseOther], ['Other', "Master's"]);
    check('branch in the list is picked, not "Other"', leverValues.branch, 'Computer Science');
    check('says the college wasn\'t listed', (leverReport.results || []).some(r => /isn't in the list — chose "Others"/.test(r.note || '')), true);
    check('reports the typed college name', (leverReport.results || []).some(r => r.field === 'Enter your college name' && r.status === 'success'), true);
    check('no failed fields', rowsWith(leverReport, 'failed'), []);

    // ─── Yello (labels not linked to inputs, flag phone picker, Select2) ───
    console.log('\nYello form (eyglobal.yello.co)');
    const yello = await context.newPage();
    watch(yello, 'yello');
    await yello.goto(`http://${YELLO_HOST}:${port}/external/requisitions/abc/apply?locale=en`);
    await yello.waitForSelector('#application');
    const yelloReport = await autofill(yello, sw);
    const yelloValues = () => yello.evaluate(() => {
      const value = (name) => document.querySelector(`[name="${name}"]`).value;
      const picked = (name) => document.querySelector(`[name="${name}"]`).selectedOptions[0]?.textContent || '';
      const shown = (name) => document.querySelector(`[name="${name}"]`).nextElementSibling.querySelector('.select2-selection__rendered')?.getAttribute('title') || '';
      return {
        preferred: value('answers[1000]'), first: value('answers[1001]'), last: value('answers[1002]'),
        email: value('candidate[email_address]'), phone: value('answers[1004]'),
        dial: document.querySelector('.iti__selected-dial-code').textContent, country: window.__selectedCountry || '',
        school: value('answers[2001]') ? picked('answers[2001]') : '', schoolShown: shown('answers[2001]'),
        degree: picked('answers[2002]'), major: value('answers[2003]') ? picked('answers[2003]') : '',
        month: value('answers[2005]'), year: value('answers[2006]'),
        office1: value('answers[3001]'), office2: value('answers[3002]'), office1Shown: shown('answers[3001]'),
        residence: value('answers[3003]') ? picked('answers[3003]') : '', city: value('answers[3004]'),
        disability: value('answers[4001]'), shifts: value('answers[4002]')
      };
    });
    const yv = await yelloValues();
    check('reads labels that aren\'t linked to inputs (legal first/last name)', [yv.first, yv.last], ['Ada', 'Lovelace']);
    check('preferred first name = first name', yv.preferred, 'Ada');
    check('leaves the read-only email alone', yv.email, 'ada@example.com');
    check('switches the phone country picker (+44 → +1 United States)', [yv.dial, yv.country], ['+1', 'us']);
    check('types the national number', yv.phone, '(555) 123-4567');
    check('school list that loads as you type (Select2 + server)', [yv.school, yv.schoolShown], ['Stanford University', 'Stanford University']);
    check('major list that loads as you type', yv.major, 'Computer Science');
    check('country list that loads as you type ("USA" → "United States of America")', yv.residence, 'United States of America');
    check('degree ("Master\'s" → "Masters")', yv.degree, 'Masters');
    check('Month of Graduation from "05/2018"', yv.month, 'May');
    check('Year of Graduation is the most recent degree\'s', yv.year, '2018');
    check('office location preferences in order', [yv.office1, yv.office2, yv.office1Shown], ['Hyderabad', 'Pune', 'Hyderabad']);
    check('common question from your answers', yv.disability, 'no');
    check('only the city the list doesn\'t have failed', rowsWith(yelloReport, 'failed'), ['Current City']);
    check('keeps a value-free sketch of it for "Copy details"', (yelloReport.results || []).some(r => r.field === 'Current City' && /select2/.test(r.debug || '') && !/Austin/.test(r.debug || '')), true);
    check('offers "Copy details"', !!(await panelText(yello, '#copyDetails')), true);

    // Answer an unanswered common question right in the report
    check('asks the shifts question in the report', yv.shifts, '');
    const chip = yello.locator('#originfill-panel-host .answers .chip', { hasText: 'Yes' }).first();
    await chip.click();
    await yello.waitForFunction(() => document.querySelector('[name="answers[4002]"]').value === 'yes', null, { timeout: 15000 }).catch(() => {});
    check('one tap fills it', (await yelloValues()).shifts, 'yes');
    const savedFaq = await sw.evaluate(async () => (await OriginFillStore.getProfiles())[0].faq);
    check('and remembers it for next time', savedFaq.shifts, 'Yes');
    await sw.evaluate(async (profile) => { await chrome.storage.local.set({ originfill_profiles: [profile] }); }, PROFILE);

    // ─── Settings edits (encrypted profile) reach the page ───
    console.log('\nSettings → page');
    await settingsPage.goto(`chrome-extension://${extensionId}/settings/settings.html#personal`);
    await settingsPage.waitForFunction(() => document.getElementById('personalFirstName').value !== '');
    await settingsPage.fill('#personalCity', 'Seattle');
    await settingsPage.click('#savePersonalBtn');
    await settingsPage.waitForTimeout(500);
    const stored = await sw.evaluate(async () => (await chrome.storage.local.get('originfill_profiles')).originfill_profiles);
    check('saves the profile encrypted', typeof stored === 'string', true);

    const fresh = await context.newPage();
    watch(fresh, 'workday-2');
    await fresh.goto(`${base}?step=my-information`);
    await fresh.waitForSelector('[data-automation-id="contactInformationPage"]');
    await autofill(fresh, sw);
    check('fills the value edited in Settings', (await state(fresh)).city, 'Seattle');

    // ─── Popup drives a fill ───
    console.log('\nPopup');
    const target = await context.newPage();
    watch(target, 'workday-3');
    await target.goto(`${base}?step=my-information`);
    await target.waitForSelector('[data-automation-id="contactInformationPage"]');
    await target.waitForTimeout(1000);
    const targetTab = await sw.evaluate(async () => (await chrome.tabs.query({}))
      .filter(t => (t.url || '').includes('step=my-information')).pop());

    const popup = await context.newPage();
    watch(popup, 'popup');
    // A real popup belongs to the tab it was opened on; point this one at the Workday tab
    await popup.addInitScript((tab) => {
      const query = chrome.tabs.query.bind(chrome.tabs);
      chrome.tabs.query = (info) => (info && info.active ? Promise.resolve([tab]) : query(info));
    }, targetTab);
    await popup.goto(`chrome-extension://${extensionId}/popup/popup.html`);
    await popup.waitForSelector('#stateDetected:not([hidden])', { timeout: 10000 }).catch(() => {});
    check('detects Workday and the step', [await popup.textContent('#badgeText'), await popup.textContent('#pageText')], ['Workday detected', 'Step 2 of 6 · My Information']);
    await popup.click('#fillAllBtn');
    await popup.waitForSelector('#stateComplete:not([hidden])', { timeout: 120000 }).catch(() => {});
    check('shows the result in the popup', /^Filled \d+ fields$/.test(await popup.textContent('#completeTitle')), true);
    check('filled the page', (await state(target)).lastName, 'Lovelace');
    await target.locator('[data-automation-id="formField-city"] input').focus();
    await target.locator('[data-automation-id="formField-city"] input').blur();
    await target.waitForTimeout(1200);
    await popup.reload();
    await popup.waitForSelector('#stateDetected:not([hidden])', { timeout: 10000 }).catch(() => {});
    check('no restore offer when the page already has the saved values', await popup.isVisible('#recoveryBanner'), false);

    const blank = await context.newPage();
    watch(blank, 'popup-2');
    // Opened on a browser page (chrome://newtab), where extensions can't run
    await blank.addInitScript(() => {
      chrome.tabs.query = () => Promise.resolve([{ id: 987654, url: 'chrome://newtab/' }]);
    });
    await blank.goto(`chrome-extension://${extensionId}/popup/popup.html`);
    await blank.waitForTimeout(1200);
    check('explains when it can\'t run on a page', await blank.textContent('#noFormText'), 'OriginFill can\'t run on this page.');
    check('hides "Fill anyway" where it can\'t run', await blank.isVisible('#detectDemandBtn'), false);

    console.log('\nScript errors');
    check('no extension errors on any page', pageErrors, []);

  } finally {
    await context.close();
    server.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }

  console.log(`\n${passes} passed, ${failures.length} failed`);
  if (failures.length) process.exit(1);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
