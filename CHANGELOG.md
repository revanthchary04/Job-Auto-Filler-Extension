# Changelog

## 1.4.0

### Fixed (EY / Yello and other Select2 forms)
- **Lists that load their options as you type** (Select2 and Chosen, used by Yello, EY and many campus forms) now work. OriginFill opens the list, types into its search box and picks the result. Before, it only looked at the empty list underneath, so even "India" failed with "No option matches". Affected University/School, Country/Region of Residence, majors and similar lists.
  - Country lists are searched by full name ("USA" → "United States of America").
  - A college is also searched by its distinctive word ("Vaageshwari"), in case the list spells the rest differently.
  - Results still loading ("Searching…") or left over from the previous search aren't mistaken for the answer.
- **Month of Graduation** gets the month (write the end as `05/2026` in Settings → Education). **Year of Graduation** now uses your most recent degree; it used to take the year of your second degree. "Year of passing" and "Passed out year" are recognised too.
- **Office Location (City) First / Second Preference** is no longer filled with your home city twice. It now uses Common Questions → *Preferred work locations, in order* (e.g. `Hyderabad, Bengaluru, Pune`): first preference = first city, second = second, "additional" = the rest. Until you answer it, your own city is suggested as the first choice, marked Review.
- Degrees: B.Tech, B.E., M.Tech, MCA, BCA, B.Com, BBA, Diploma, Intermediate/12th and SSC/10th are recognised, as are the words lists use for them ("Post Graduation", "UG", "B.Tech/B.E."). "Master's" also matches "Post Graduation"/"PG". B.Ed is no longer mistaken for B.E.
- "How did you hear about this opportunity?" with nothing in your profile now says where to set it once.

### New
- **Answer common questions right in the report.** Questions you haven't answered yet ("Do you have a disability?", "Willing to work in shifts?", notice period…) now show one-tap answers in the report, or a box for a typed answer. Your answer fills the question at once and is saved for every later application. You can still change it in Settings → Common Questions.
- A guessed answer the form doesn't offer (your home city as "First Preference" when it isn't one of the offices) is asked about instead of being reported as failed.
- **Copy details** button in the report when a field fails. It copies how those fields are built: tag names and structure only, never your answers or other values. Paste it into a bug report so the site can be supported.
- Settings: Indian degrees in the degree suggestions, and End Year accepts a month (`05/2026`) with a "Read as: May 2026" hint.

## 1.3.0

### New
- **College or course not in the list → "Other".** When a form's list doesn't have your college, degree/course, branch or referral source, OriginFill picks its **Other** / **Others** / **Not listed** / **Not found** choice instead of failing. The same goes for Workday search lists: if your college finds nothing, it searches "Other", then "Not Listed".
- **…then types the real name.** Many forms show a box after "Other" ("Enter your college name", "Please specify"). OriginFill types your college or course there and lists it in the report.
- These "Other" picks are marked **Review**. Questions such as gender, country or skills never fall back to "Other".
- Boxes such as "Other college name" or "College name (if not listed)" are left empty unless "Other" was picked.
- Labels used by campus forms are recognised: **Course** (degree), **Branch** and **Stream** (field of study), **College Name**.
- Settings → Education now says **College / University**, **Degree / Course** and **Field of Study / Branch**.

### Design
- New app icon: a glass robot chat bubble. Sharpened at toolbar sizes so it reads on light and dark toolbars.

## 1.2.1

### Fixed
- Work dates written day-first (`21-12-2020`, `21/12/2020`) were not read, so Workday's From/To stayed empty. Day-first dates are now read. A date that could be either way round (`05-06-2022`) follows your country: day-first everywhere except the US and a few others.
- Workday skills that still weren't picked:
  - Some Workday sites ignore clicks made by scripts. When a click doesn't take, the result is now picked with the keyboard (↓ to the result, then Enter or Space). Later skills go straight to whichever method worked.
  - Workday shows the previous search's results while a new search runs, so the old list could be read as the answer. Only a fresh list counts now.
  - An open list is closed before the next search. Pressing Enter on an open list ticks its highlighted row instead of searching.
  - An already-ticked result is never clicked again (that would untick it).
- Workday dates are checked against Workday's own state (`aria-valuenow`), not just the text in the box, so "The field From is required" can't follow a fill that only looked right.

### New
- **Reload OriginFill** banner in the popup and Settings. It appears when the files in the folder are newer than what Chrome is running, which happens after updating an unpacked install without clicking ↻.
- Settings → Work Experience shows how each date will be read ("Read as: 21 December 2020"), or flags a date it can't read.

## 1.2.0

### Common questions — answer once
- New **Settings → Application Answers → Common questions**: about 30 screening questions with one-tap answers (or a text box), grouped by topic. Topics: work eligibility, preferences, experience and pay, background, health and self-identification, and agreements.
  - Examples: disability, major illness/surgery/accident, sponsorship, notice period, current and expected CTC, relocation.
- Answers fill dropdowns, radio buttons, text boxes and tick-one checkbox groups, in whatever wording the form uses ("No" → "No, I do not have a disability and have not had one in the past").
- Years of experience is worked out from your work history and picks range options ("4" → "3-5 years").
- Questions you haven't answered yet are listed after each fill with the exact setting to answer once.
- Workday's disability self-identification form gets your name and today's date.

### Fixed
- Workday Work Experience / Education entries stayed empty ("No value in your profile"). Workday numbers entries with an internal counter (`workExperience-26`), which was read as the job's position. Positions now come from the visible heading ("Work Experience 1") or page order.
- Skills and other search lists failed with "Could not select …". The click went to the result's row, but Workday's handler is on the option itself. Now the option is clicked first, then its checkbox, then the row.
- Skills Workday doesn't list no longer wait 5 seconds each: "No Items" is detected at once, and after two refused selections the rest are skipped. A slow fill went from about 60 seconds to a few seconds.
- The report says why a work or education field is empty: no work experience in your profile, fewer jobs than entries, or a value missing for that job.
- Questions written as plain text instead of a `<label>` (common on Workday's Application Questions page) were not read. For example, "Country/Region of Residence" was never filled. Question text is now read from rich text, `aria-labelledby` and the text just before a field.
- Long questions are matched on their first clause ("Country/Region of Residence – please select…").
- Résumé:
  - The Autofill button now also appears on Workday's "Autofill with Resume" upload step, as **Upload my résumé**.
  - Uploads are confirmed by what Workday shows in the upload area, using the markup of Workday's live upload widget.
- Your own answers are no longer flagged "Check".
- No "Restore your answers?" offer when the page already holds the saved values.

### Yello and other sites
- Fields whose label isn't linked to the input (Yello, Rails/Bootstrap and table layouts) are recognised. Before, these forms got "Nothing filled".
- Phone fields with a country-flag picker (intl-tel-input): the right country is chosen (from your phone country code, the number or your country) and the national number typed.
- Select2 / Chosen dropdowns (a styled box over a hidden list) are filled.
- "Preferred First Name" is filled with your first name.
- The ⚡ button now appears automatically on `*.yello.co`.
- When nothing on a page is recognised, the report says so and how to report the site.

### Design
- New Liquid Glass look for the in-page panel, popup and Settings, in light and dark mode:
  - translucent blurred glass over a soft colour mesh, with light edge highlights
  - capsule buttons, iOS-style switches and segmented controls
- Respects reduced motion and reduced transparency.
- Now needs Chrome 111 or newer.

## 1.1.0

### Workday autofill
- Rewrote the Workday adapter for the current Workday markup (`formField-*` wrappers) while still supporting older tenants.
- Fills Workday's widgets the way a person would:
  - button dropdowns: Country, State, Phone Device Type, Degree…
  - searchable prompts: How did you hear about us, School, Field of Study, Skills, Country Phone Code
  - month/year date boxes
  - checkboxes and radio buttons
- Clicks **Add** for each job, school and website in your profile, then fills each entry.
- Fills the address fields again when picking a Country rebuilds them.
- Résumé upload works: résumés are read from the extension's storage. Before, the content script looked in the job site's storage and never found them.
- Running Autofill again only fills what's missing. It no longer adds duplicate entries or uploads the résumé twice.

### New
- Floating **⚡ Autofill** button on application steps with progress and a clickable report. It moves out of the way of "Save and Continue".
- **Application Answers**: "How did you hear about us?", "Previously worked here?" and saved answers for screening questions.
- Phone device type, phone country code and address line 2 in the profile.
- Default résumé selection.
- Debug-logging switch for bug reports.
- `npm run test:e2e`: real-browser test against a mock Workday app.
- `npm run package`: builds a store-ready zip.

### Fixed
- Field detection used substring matching: "Tell us…" was read as a phone field, "Ethnicity" as a city and "Role Description" as a job title. All rules now match whole words, and use the section (work vs. education) where it matters.
- "Session Expired" no longer appears on Workday's normal sign-in step.
- Session snapshots no longer capture passwords, files or payment fields.
- The popup no longer replaces the fill buttons with a "Session Recovered" screen on almost every open. Restoring is offered only when the page is empty and the saved data matches it.
- Restoring now finds fields by label, because Workday ids change on every load.
- Textareas no longer throw when filled.
- Values containing quotes no longer break settings forms.
- Adding a job or school no longer discards unsaved edits.
- Profiles are decrypted in the background worker; job sites never receive the encryption key.
- Removed the `tabs` and `alarms` permissions.
