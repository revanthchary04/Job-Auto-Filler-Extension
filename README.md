# OriginFill

> *"Never lose a job application form again."*

**OriginFill** is a free Chrome extension that fills **Workday** job applications for you: name, contact details, address, work history, education, skills, links and your résumé, one click per application step. It also works on Yello (EY and other campus recruiting), Greenhouse, Lever, iCIMS, Taleo and most other application forms.

Typing the same details into every Workday application takes 20–30 minutes. With OriginFill each step takes a few seconds, and you only answer the questions that are actually different.

- ⚡ **One-click autofill.** A floating **⚡ Autofill** button appears on each application step.
- 🧩 **Understands Workday.** It handles Workday's dropdowns, search-as-you-type lists, month/year date boxes, and the "Add" buttons for each job, school and website.
- 📄 **Uploads your résumé** automatically.
- 💬 **Common questions, answered once.** Disability, major illness, sponsorship, notice period, CTC, relocation and about 25 more: set each answer once and it's filled on every application, in whatever wording the form uses.
- 🛡️ **Session-timeout recovery.** If Workday logs you out, OriginFill offers to restore what you typed.
- 🔒 **Private.** Your data never leaves your browser; profiles are stored encrypted. No accounts, no servers, no tracking.
- ✋ **You stay in control.** OriginFill never clicks *Submit* or *Save and Continue*. You review every page.

---

## 🛠️ Install

OriginFill works in Chrome, Edge, Brave and other Chromium browsers (version 111 or newer).

1. Download this repository: **Code → Download ZIP** on GitHub (then unzip it), or
   ```bash
   git clone https://github.com/revanthchary04/Job-Auto-Filler-Extension.git
   ```
2. Open `chrome://extensions` (Edge: `edge://extensions`).
3. Turn on **Developer mode** (top-right).
4. Click **Load unpacked** and choose the folder that contains `manifest.json`.
5. Pin OriginFill: click the puzzle-piece icon in the toolbar → 📌 next to OriginFill.

The Settings page opens automatically after installing.

> If the Autofill button doesn't appear in a tab that was already open, reload that tab.

**Updating:** after you replace the folder's files (download or `git pull`), Chrome keeps running the old version until you click ↻ on OriginFill in `chrome://extensions`. Then reload your job application tab. The popup and Settings show a **Reload OriginFill** banner while an update is waiting.

## ✍️ Set up your profile (about 5 minutes, once)

In **Settings** (click the OriginFill icon → ⚙️):

| Section | What to add |
|---|---|
| **Personal Info** | Name, email, phone, phone type, phone country code (e.g. `+1`), address, country, LinkedIn, websites |
| **Work Experience** | Each job, most recent first: company, title, location, start/end date (`12/2020`, `Dec 2020` or `21-12-2020`), "currently working here", and bullet points (become the role description) |
| **Education** | College / university (full name), degree / course (`B.Tech`, `Master's`), field of study / branch, start/end year, GPA |
| **Resume** | Upload up to 3 PDFs or Word files; the one marked **Default** is uploaded |
| **Skills & Extras** | Skills, comma separated |
| **Application Answers** | "How did you hear about us?", "Previously worked here?", the **Common questions** (one tap each: disability, major illness, sponsorship, notice period, CTC, relocation…), and your own **Saved answers** |

Click **Save** in each section. Use **Profiles** to keep separate versions (e.g. "Software Engineer" and "Data Analyst") and switch between them from the popup.

Write names as they appear on your documents: Workday matches dropdown options by text. OriginFill already understands common short forms, such as `USA` → *United States of America*, `CA` → *California* and `Master's` → *Master's Degree*.

**College or course not in a form's list?** OriginFill picks the list's **Other** / **Others** / **Not listed** choice, and if the form then shows a box such as "Enter your college name" or "Please specify", types the full name there. The same goes for "How did you hear about us?". These picks are marked **Review** so you can check them. Other questions, such as gender or country, never fall back to "Other".

## 🚀 Use it on Workday

1. Open a job on any `*.myworkdayjobs.com` / `*.myworkday.com` / `*.myworkdaysite.com` site and click **Apply → Apply Manually**.
2. Sign in or create your Workday account as usual. OriginFill doesn't touch passwords.
3. On each step (**My Information**, **My Experience**, **Application Questions**, …) click the **⚡ Autofill** button at the bottom-right of the page.
4. A summary appears:
   - **Filled**: done.
   - **Review**: filled with a close match (for example a dropdown option worded differently). Give it a quick look.
   - **Failed / Fill these yourself**: click an item to jump to the field.
5. Check the page, then click **Save and Continue** yourself.

On **My Experience**, OriginFill clicks **Add** once for each job, school and website in your profile, fills them in, and uploads your résumé. Running Autofill again is safe: it fills only what's missing and never adds duplicate entries.

You can also click the OriginFill toolbar icon and use **Auto-Fill This Page** or fill one section (Personal / Education / Work). On other job sites, open the popup and choose **Fill this page anyway**.

### Common questions

**Settings → Application Answers → Common questions** lists about 30 questions most applications ask in nearly the same words. Answer each once, or leave it on **Not set**. For example:

| Question | You pick | What gets filled |
|---|---|---|
| Do you have a disability, either visible or invisible? | No | "No", or "No, I do not have a disability and have not had one in the past" |
| Have you suffered from any major illness/surgery/accident? | No | "No" |
| Will you require visa sponsorship? | No | "No" |
| Notice period | `30 days` | typed, or the "30 days" option |
| Total years of experience | (blank) | worked out from your work history, e.g. "3-5 years" |

Country of residence, current location and similar questions come from your profile. Questions you haven't answered yet appear in the report after each fill with **one-tap answers**: tap *No* under "Do you have a disability?" and it's filled right away and remembered for every later application. Typed answers (notice period, preferred locations) get a small box.

**Office location preferences:** answer *Preferred work locations, in order* once (e.g. `Hyderabad, Bengaluru, Pune`). "First Preference" gets the first city, "Second Preference" the second, "Additional Preferences" the rest.

### What OriginFill leaves for you

Questions where a wrong answer could hurt you are **never answered unless you've set an answer** in Common questions or Saved answers:

- work authorization and visa sponsorship
- gender, race, veteran and disability status
- salary
- background checks
- open-ended essay questions ("What interests you about this role?")
- terms-and-conditions checkboxes

They're listed under **Fill these yourself** after each fill.

For a question that isn't in the common list, add it under **Saved answers**: a few words from the question plus your answer (e.g. `reason for leaving` → `Career growth`). It's used when all of its words appear in the question.

### Session timeouts

Workday logs you out after a period of inactivity. OriginFill keeps a copy of what you've typed on the current page in your browser. It never keeps passwords, files or payment details, and discards the copy after 24 hours. After signing back in, the Autofill panel (or the popup) offers **Restore your answers?**.

## 🔒 Privacy & permissions

- Everything is stored locally in your browser (`chrome.storage` and IndexedDB). Profiles are encrypted with AES-256-GCM. OriginFill makes **no network requests** and has no servers.
- **Settings → Privacy & Data** lets you export, import or delete everything.
- Permissions:
  - **Read and change data on Workday, Yello, Greenhouse, Lever, iCIMS and Taleo sites**: to find and fill application forms there.
  - **activeTab + scripting**: to fill a form on another site, only when you click *Fill this page anyway*.
  - **storage**: your profile and settings.
  - **notifications**: "Session expired" alerts (can be turned off in Settings).

## 🧯 Troubleshooting

| Problem | Fix |
|---|---|
| Fixes don't seem to apply | Chrome is still running the old version. Open the popup or Settings and click **Reload OriginFill** (or ↻ in `chrome://extensions`), then reload the job page. The version under the OriginFill name in Settings should match the folder's `manifest.json`. |
| No Autofill button | Reload the page (tabs opened before installing don't have OriginFill yet). The button only shows on application steps, not job listings, sign-in or Review. Check **Settings → Extension Settings → Show the Autofill button**. |
| A dropdown wasn't filled | The report says which option it looked for. Change the value in your profile to match Workday's wording, then click Autofill again. |
| A work date wasn't filled | In **Settings → Work Experience**, the line under each date says how it will be read ("Read as: December 2020"). Use a form like `12/2020`, `Dec 2020` or `21-12-2020`. |
| Résumé not uploaded | Check **Settings → Resume** lists a résumé for the profile you're using (the report says "No résumé saved" otherwise). On Workday's "Autofill with Resume" step, click **⚡ Upload my résumé**. |
| A question wasn't answered | If the report says "Answer … once in Settings → Common Questions", set it there. Otherwise add it under Saved answers. |
| "Nothing filled" on another site | OriginFill didn't recognise that site's fields. Turn on **Debug logging**, try again, and open an issue with the `[OriginFill]` console lines and the site's address. |
| A field was filled wrongly | Fix it by hand, and please [open an issue](https://github.com/revanthchary04/Job-Auto-Filler-Extension/issues) with the field label and the company's Workday URL. |
| Need details for a bug report | Click **Copy details** in the report (it appears when a field fails; it copies how the fields are built, never your values). For more, turn on **Settings → Extension Settings → Debug logging**, retry, and copy the `[OriginFill]` lines from the page's DevTools console (F12). |
| "Month of Graduation" left empty | Write your End Year with its month in **Settings → Education**, e.g. `05/2026`. |

---

## 👩‍💻 Development

```
├── manifest.json              # Manifest V3 configuration
├── background/
│   └── service-worker.js      # Injection, profile decryption, résumés, badge, notifications
├── content/                   # Runs on job sites (isolated world)
│   ├── init.js                # Entry point: wiring, messages, in-page panel
│   ├── detector.js            # Which portal / which Workday step
│   ├── filler.js              # Fill engine: passes, retries, saved answers, report, snapshots
│   ├── observer.js            # Follows SPA step changes
│   ├── session-guard.js       # Timeout detection & recovery snapshots
│   ├── panel.js               # Floating ⚡ Autofill button (shadow DOM)
│   └── portals/
│       ├── workday.js         # Workday fields & widgets (dropdowns, prompts, dates, Add buttons, upload)
│       └── generic.js         # Native inputs, selects, radios, comboboxes on other sites
├── utils/
│   ├── dom-actions.js         # Event simulation & native control fillers
│   ├── field-mapper.js        # Label → field type rules, profile values, aliases, dates, saved answers
│   ├── faq.js                 # Common questions: patterns, answer wordings, derived answers
│   ├── fuzzy-match.js         # Option matching
│   ├── constants.js · logger.js
├── storage/                   # Encrypted profiles, settings, résumés (extension pages + worker only)
├── popup/ · settings/         # UI
├── tests/                     # Jest unit tests + tests/e2e (real browser)
└── scripts/package.js         # Builds dist/originfill-<version>.zip
```

```bash
npm install
npm test               # unit tests (Jest + jsdom)
npx playwright install chromium
npm run test:e2e       # loads the extension in Chromium and fills a mock Workday application
npm run package        # dist/originfill-<version>.zip for the Chrome Web Store
```

The end-to-end test (`tests/e2e`) serves a React mock of Workday's apply flow on an `acme.wd5.myworkdayjobs.com` hostname. The mock copies Workday's markup and widget behaviour: `formField-*` wrappers, popup listboxes, prompts that search on Enter, keyboard-only date boxes and "Add" sections. The test drives the real extension through all six steps. Branded Google Chrome ignores `--load-extension`, so use Playwright's Chromium (or set `CHROME_PATH`). Add `HEADED=1` to watch and `DEBUG=1` for logs.

---

## 📜 License

Licensed under the [GNU Affero General Public License v3.0 (AGPL-3.0)](LICENSE).  
Authored by **RevanthChary04** and **SaikrishnaMangalaprthi**.
