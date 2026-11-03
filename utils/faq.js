/**
 * OriginFill — Frequently Asked Application Questions
 * Screening questions most applications ask in nearly the same words ("Do you have a
 * disability?", "Notice period", "Will you require sponsorship?"). Users answer each once in
 * Settings → Common Questions; the filler recognises the question on any form and picks the
 * option that says the same thing ("No" → "No, I do not have a disability and have not had one
 * in the past").
 *
 * Loaded in content scripts and on the settings page.
 *
 * @license AGPL-3.0
 * @author CharyWorld
 */

var OriginFillFAQ = (() => {
  'use strict';

  // ─── Common answer wordings ────────────────────────────────────

  const YES = ['Yes', 'Y', 'True'];
  const NO = ['No', 'N', 'False'];
  const PREFER_NOT = [
    'Prefer not to say', 'I do not want to answer', "I don't want to answer", 'I do not wish to answer',
    "I don't wish to answer", 'Decline to answer', 'Decline to self-identify', 'I do not wish to self-identify',
    "I don't wish to self-identify", 'I choose not to disclose', 'Prefer not to disclose', 'Not disclosed',
    'I prefer not to answer', 'Choose not to disclose'
  ];

  const yesNo = () => ({ Yes: YES, No: NO });

  // ─── Groups (settings page sections) ───────────────────────────

  const GROUPS = Object.freeze([
    { id: 'eligibility', title: 'Work eligibility' },
    { id: 'preferences', title: 'Work preferences' },
    { id: 'experience', title: 'Experience & pay' },
    { id: 'background', title: 'Background' },
    { id: 'health', title: 'Health & self-identification' },
    { id: 'consent', title: 'Agreements' }
  ]);

  // ─── Catalog ───────────────────────────────────────────────────

  /**
   * Each entry:
   *   patterns  any of these must match the question (lower-cased)
   *   all       every one of these must match (optional)
   *   exclude   none of these may match (optional)
   *   choices   { answer: [ways forms word it] } for pick-one questions
   *   type      'text' for free-text answers (typed, or matched against dropdown options)
   *   derive    computes an answer from the profile when the user left it blank
   * Order matters: the first matching entry wins, so specific questions come first.
   */
  const CATALOG = Object.freeze([
    // ─── Work eligibility ─────────────
    {
      id: 'authorizedWithoutSponsorship',
      group: 'eligibility',
      hidden: true, // Answered from the two questions below
      question: 'Authorized to work without sponsorship?',
      all: [/\bwithout\b.*\bsponsor/, /\b(authori[sz]ed|eligible|legally|permitted|right|able)\b/],
      choices: yesNo(),
      derive: (profile, answers) => {
        if (answers.authorizedToWork === 'No' || answers.requireSponsorship === 'Yes') return 'No';
        if (answers.authorizedToWork === 'Yes' && answers.requireSponsorship === 'No') return 'Yes';
        return '';
      }
    },
    {
      id: 'requireSponsorship',
      group: 'eligibility',
      question: 'Will you now or in the future require visa sponsorship?',
      patterns: [/\bsponsor(ship|ed)?\b/, /\b(require|need)\b.*\bvisa\b/, /\bvisa\b.*\b(require|need|sponsor)/, /\bh-?1-?b\b/],
      exclude: [/\bwithout\b.*\bsponsor/],
      choices: yesNo()
    },
    {
      id: 'authorizedToWork',
      group: 'eligibility',
      question: 'Are you legally authorized to work in the job\'s country?',
      patterns: [
        /\b(legally\s+)?(authori[sz]ed|eligible|entitled|permitted)\b.*\bwork\b/,
        /\bwork\s+(authori[sz]ation|permit|eligibility)\b/,
        /\bright\s+to\s+work\b/,
        /\blegally\s+(able|allowed)\s+to\s+work\b/
      ],
      choices: yesNo()
    },
    {
      id: 'over18',
      group: 'eligibility',
      question: 'Are you at least 18 years old?',
      patterns: [
        /\b(at\s+least|over|above|older\s+than)\s+(18|eighteen)\b/,
        /\b(18|eighteen)\s+years?\s+(of\s+age|old|or\s+older|and\s+(above|older))\b/,
        /\bage\s+of\s+(18|majority)\b/,
        /\blegal\s+(working\s+)?age\b/,
        /\bminimum\s+age\b/
      ],
      choices: yesNo()
    },
    {
      id: 'citizenship',
      group: 'eligibility',
      question: 'Citizenship / nationality',
      type: 'text',
      placeholder: 'Indian',
      patterns: [/\bcitizenship\b/, /\bnationality\b/, /\bcitizen\s+of\b/],
      exclude: [/^(are|is|do|does|have|will|were)\b/, /\bdual\b/]
    },
    {
      id: 'passport',
      group: 'eligibility',
      question: 'Do you have a valid passport?',
      patterns: [/\bpassport\b/],
      exclude: [/\bpassport\s+(number|no|id)\b/, /\bexpir/],
      choices: yesNo()
    },

    // ─── Work preferences ─────────────
    {
      id: 'willingToRelocate',
      group: 'preferences',
      question: 'Are you willing to relocate?',
      patterns: [/\brelocat(e|ion|ing)\b/],
      exclude: [/\b(assistance|support|package|expenses?|reimburse\w*|allowance)\b/],
      choices: yesNo()
    },
    {
      id: 'willingToTravel',
      group: 'preferences',
      question: 'Are you willing to travel for work?',
      patterns: [/\b(willing|able|open|comfortable|available)\b.*\btravel\b/, /\btravel\s+(required|requirement|up\s+to)\b/, /\btravel\b.*\b\d+\s*%/],
      choices: yesNo()
    },
    {
      id: 'shifts',
      group: 'preferences',
      question: 'Are you open to shifts (night / rotational)?',
      patterns: [/\b(night|rotational|rotating|evening|weekend|us|uk)\s+shifts?\b/, /\bshifts?\b.*\b(work|comfortable|willing|open|ok)\b/, /\b(work|comfortable|willing|open)\b.*\bshifts?\b/],
      choices: yesNo()
    },
    {
      id: 'onsite',
      group: 'preferences',
      question: 'Are you comfortable working from the office / hybrid?',
      all: [/\b(work\s+from\s+(the\s+)?office|on-?\s?site|in-?\s?office|hybrid|in\s+person)\b/, /\b(willing|comfortable|able|open|available|ok|okay|agree)\b/],
      choices: yesNo()
    },
    {
      id: 'preferredLocation',
      group: 'preferences',
      question: 'Preferred work locations, in order',
      type: 'text',
      // "Office Location First Preference" gets the first, "Second Preference" the second,
      // "Additional Preferences" the rest
      list: true,
      placeholder: 'Hyderabad, Bengaluru, Pune',
      patterns: [
        /\bpreferred\s+(work\s+|job\s+|office\s+)?(locations?|city|cities)\b/,
        /\blocation\s+preferences?\b/,
        /\b(location|city|cities|office|posting)\b.*\b(prefer(red|ences?)?|choice)\b/,
        /\b(prefer(red|ences?)?|choice)\b.*\b(location|city|cities|office|posting)\b/
      ],
      // Unanswered: your own city is the likeliest first choice
      derive: (profile) => (profile && profile.personal && profile.personal.city) || ''
    },
    {
      id: 'noticePeriod',
      group: 'preferences',
      question: 'Notice period / earliest joining',
      type: 'text',
      placeholder: '30 days',
      patterns: [
        /\bnotice\s+period\b/,
        /\bhow\s+soon\b.*\b(join|start)\b/,
        /\b(earliest|available)\s+(joining|start(ing)?)\s+date\b/,
        /\bwhen\s+(can|could|would)\s+you\s+(start|join)\b/,
        /\bavailability\s+to\s+(start|join)\b/,
        /\bdate\s+available\b/
      ]
    },

    // ─── Experience & pay ─────────────
    {
      id: 'totalExperience',
      group: 'experience',
      question: 'Total years of experience',
      type: 'text',
      placeholder: 'Calculated from your work history',
      patterns: [
        /\b(years?|yrs)\s+of\s+(total\s+|overall\s+|professional\s+|relevant\s+|work\s+|industry\s+|it\s+)?experience\b/,
        /\bhow\s+many\s+years\b.*\bexperience\b/,
        /\b(total|overall)\s+(work\s+|professional\s+)?experience\b/
      ],
      // "Years of experience with Java" asks about a skill, not the total
      exclude: [/\bexperience\s+(with|in|using|on|of)\s+(?!the\s+industry)/, /\b(with|in|using)\s+\w+.*\bexperience\b/],
      derive: (profile) => {
        const years = OriginFillFieldMapper.totalExperienceYears(profile);
        return years > 0 ? String(years) : '';
      }
    },
    {
      id: 'currentSalary',
      group: 'experience',
      question: 'Current salary / CTC',
      type: 'text',
      placeholder: '12 LPA',
      patterns: [/\b(current|present|last|existing)\s+(ctc|salary|compensation|annual\s+(salary|pay|compensation)|package|pay|drawn)\b/]
    },
    {
      id: 'expectedSalary',
      group: 'experience',
      question: 'Expected salary / CTC',
      type: 'text',
      placeholder: '18 LPA',
      patterns: [
        /\b(expected|desired|expectation|target)\s+(ctc|salary|compensation|pay|package)\b/,
        /\bsalary\s+(expectations?|requirements?|range)\b/,
        /\bcompensation\s+(expectations?|requirements?)\b/
      ]
    },
    {
      id: 'currentlyEmployed',
      group: 'experience',
      question: 'Are you currently employed?',
      patterns: [/\bare\s+you\s+currently\s+(employed|working)\b/, /\bcurrently\s+employed\b/, /\bemployment\s+status\b/],
      choices: yesNo(),
      derive: (profile) => {
        const jobs = OriginFillFieldMapper.getWorkEntries(profile);
        if (jobs.length === 0) return '';
        return jobs.some(j => j.isCurrent) ? 'Yes' : 'No';
      }
    },

    // ─── Background ─────────────
    {
      id: 'relativesAtCompany',
      group: 'background',
      question: 'Do you have relatives or friends working at the company?',
      patterns: [
        /\b(relatives?|family\s+members?|related\s+to|friends?|spouse)\b.*\b(work|employ|employee|staff)/,
        /\bknow\s+(anyone|someone|any\s+employees?)\b.*\b(work|employ)/
      ],
      choices: yesNo()
    },
    {
      id: 'criminalRecord',
      group: 'background',
      question: 'Have you ever been convicted of a crime / any pending cases?',
      patterns: [/\b(criminal|convicted|conviction|felony|misdemeanou?r|arrested|court\s+cases?)\b/, /\bpending\s+(criminal\s+)?(cases?|charges?|proceedings?)\b/],
      choices: yesNo()
    },
    {
      id: 'nonCompete',
      group: 'background',
      question: 'Are you bound by a non-compete or similar agreement?',
      patterns: [/\bnon-?\s?compete\b/, /\bnon-?\s?solicitation\b/, /\brestrictive\s+covenants?\b/, /\b(agreement|contract)\b.*\b(prevent|restrict|prohibit)\w*\b/],
      choices: yesNo()
    },
    {
      id: 'appliedBefore',
      group: 'background',
      question: 'Have you applied or interviewed here in the last 12 months?',
      patterns: [/\b(previously|already|recently|ever)\s+(applied|interviewed)\b/, /\b(applied|interviewed)\b.*\b(before|previously|past|last\s+\d+\s+months)\b/],
      choices: yesNo()
    },
    {
      id: 'backgroundCheck',
      group: 'background',
      question: 'Do you consent to a background check / verification?',
      patterns: [/\bbackground\s+(check|verification|screening|investigation)s?\b/, /\b(bgv|bgc)\b/],
      choices: yesNo()
    },
    {
      id: 'serviceAgreement',
      group: 'background',
      question: 'Are you willing to sign a service agreement / bond?',
      patterns: [/\bservice\s+(agreement|bond)\b/, /\b(sign|signing)\s+an?\s+bond\b/, /\b(employment|service)\s+bond\b/],
      choices: yesNo()
    },

    // ─── Health & self-identification ─────────────
    {
      id: 'accommodation',
      group: 'health',
      question: 'Do you need any accommodation during the hiring process?',
      patterns: [/\baccommodations?\b/, /\breasonable\s+adjustments?\b/],
      choices: yesNo()
    },
    {
      id: 'disability',
      group: 'health',
      question: 'Do you have a disability (visible or invisible)?',
      patterns: [/\bdisabilit(y|ies)\b/, /\bdisabled\b/, /\b(physically|differently)\s+(challenged|abled)\b/, /\bhandicap/, /\bpwd\b/],
      choices: {
        No: ['No', 'No, I do not have a disability', "No, I don't have a disability",
          'No, I do not have a disability and have not had one in the past', 'I do not have a disability', 'Not disabled', 'None'],
        Yes: ['Yes', 'Yes, I have a disability', 'Yes, I have a disability (or previously had a disability)', 'I have a disability'],
        'Prefer not to say': PREFER_NOT
      }
    },
    {
      id: 'majorIllness',
      group: 'health',
      question: 'Have you had any major illness, surgery or accident?',
      patterns: [
        /\b(illness|illnesses|disease|surgery|surgeries|accident|hospitali[sz](ed|ation))\b/,
        /\bmedical\s+(conditions?|history|issues?|problems?)\b/,
        /\bhealth\s+(conditions?|issues?|problems?)\b/
      ],
      choices: yesNo()
    },
    {
      id: 'veteran',
      group: 'health',
      question: 'Veteran status',
      patterns: [/\bveterans?\b/, /\barmed\s+forces\b/, /\bmilitary\s+(service|status)\b/],
      choices: {
        'I am not a veteran': ['I am not a protected veteran', 'I am not a veteran', 'Not a veteran', 'Not a protected veteran', 'No'],
        'I am a protected veteran': ['I identify as one or more of the classifications of protected veteran', 'I am a protected veteran', 'Protected veteran', 'Yes'],
        'Prefer not to say': PREFER_NOT
      }
    },
    {
      id: 'gender',
      group: 'health',
      question: 'Gender',
      patterns: [/\bgender\b/, /^sex$/, /^sex\b\s*[(/]/],
      exclude: [/\btransgender\b/, /\bidentity\b.*\bsame\b/],
      choices: {
        Male: ['Male', 'Man', 'M'],
        Female: ['Female', 'Woman', 'F'],
        'Non-binary': ['Non-binary', 'Nonbinary', 'Non binary', 'Genderqueer'],
        'Prefer not to say': PREFER_NOT
      }
    },
    {
      id: 'hispanic',
      group: 'health',
      question: 'Are you Hispanic or Latino?',
      patterns: [/\bhispanic\b/, /\blatin[oax]\b/],
      choices: { No: NO, Yes: YES, 'Prefer not to say': PREFER_NOT }
    },
    {
      id: 'ethnicity',
      group: 'health',
      question: 'Race / ethnicity',
      type: 'text',
      placeholder: 'Asian',
      patterns: [/\brace\b/, /\bracial\b/, /\bethnicity\b/, /\bethnic\s+(group|background|origin)\b/]
    },

    // ─── Agreements ─────────────
    {
      id: 'consent',
      group: 'consent',
      question: 'Tick privacy-notice and terms checkboxes',
      patterns: [
        /\bi\s+(agree|accept|consent|acknowledge|certify|confirm|understand)\b/,
        /\bterms\s+(and|&)\s+conditions\b/,
        /\bprivacy\s+(policy|notice|statement)\b/,
        /\bdata\s+(privacy|protection|processing)\b/,
        /\bconsent\b/
      ],
      choices: { Yes: ['Yes', 'I agree', 'I accept', 'I consent', 'Agree', 'Accept', 'I acknowledge', 'Acknowledge', 'I understand'] }
    }
  ]);

  // ─── Matching ──────────────────────────────────────────────────

  const ORDINALS = [/\b(first|1st|primary|top)\b/, /\b(second|2nd)\b/, /\b(third|3rd)\b/, /\b(fourth|4th)\b/, /\b(fifth|5th)\b/];

  /**
   * Which item of a list answer a question wants: 0 for "First Preference", 1 for "Second",
   * 'rest' for "Additional Preferences", null for the whole list.
   */
  function ordinalOf(text) {
    const index = ORDINALS.findIndex(p => p.test(text));
    if (index >= 0) return index;
    return /\b(additional|other|more|further)\b/.test(text) ? 'rest' : null;
  }

  /**
   * The part of a list answer ("Hyderabad, Bengaluru, Pune") a question asks for.
   * @returns {string} '' when the list is too short
   */
  function pickFromList(answer, question) {
    const items = answer.split(/\s*[,;\n]\s*|\s+\/\s+|\s+and\s+/i).map(s => s.trim()).filter(Boolean);
    const ordinal = ordinalOf(question);
    if (ordinal === null) return items.join(', ');
    if (ordinal === 'rest') return items.slice(2).join(', ');
    return items[ordinal] || '';
  }

  function normalize(text) {
    return String(text || '').replace(/\*/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
  }

  function matches(entry, text) {
    if (entry.patterns && !entry.patterns.some(p => p.test(text))) return false;
    if (entry.all && !entry.all.every(p => p.test(text))) return false;
    if (entry.exclude && entry.exclude.some(p => p.test(text))) return false;
    return !!(entry.patterns || entry.all);
  }

  /**
   * The catalog entry for a question, if it's one of the common ones.
   * @param {string} questionText - The field's question/label
   * @param {string} [contextText] - Question plus option labels (for checkbox/radio groups whose
   *   question is generic, e.g. "Please check one of the boxes below")
   * @returns {Object|null}
   */
  function match(questionText, contextText) {
    const question = normalize(questionText);
    if (question) {
      const entry = CATALOG.find(e => matches(e, question));
      if (entry) return entry;
    }
    const context = normalize(contextText);
    if (context && context !== question) {
      return CATALOG.find(e => e.choices && matches(e, context)) || null;
    }
    return null;
  }

  /**
   * Ways a form might word the user's answer, best first.
   * @param {Object} entry
   * @param {string} answer
   * @returns {string[]}
   */
  function candidatesFor(entry, answer) {
    const wordings = entry.choices && entry.choices[answer];
    return [...new Set([answer, ...(wordings || [])])];
  }

  /**
   * Find the user's answer for a question.
   *
   * @param {Object} profile
   * @param {string} questionText
   * @param {string} [contextText]
   * @returns {{ entry: Object, answer: string, candidates: string[], derived: boolean }|null}
   *   null when the question isn't a common one; answer '' when the user hasn't answered it yet
   */
  function find(profile, questionText, contextText) {
    const entry = match(questionText, contextText);
    if (!entry) return null;

    const answers = (profile && profile.faq) || {};
    let answer = String(answers[entry.id] ?? '').trim();
    let derived = false;
    let short = false;

    if (!answer && typeof entry.derive === 'function') {
      answer = String(entry.derive(profile, answers) || '').trim();
      derived = !!answer;
    }

    if (answer && entry.list) {
      const part = pickFromList(answer, normalize(questionText));
      // A worked-out first choice says nothing about the second: ask instead
      short = !part && !derived;
      answer = part;
      if (!part) derived = false;
    }

    return { entry, answer, candidates: answer ? candidatesFor(entry, answer) : [], derived, short };
  }

  /**
   * Entries shown in Settings, grouped.
   * @returns {Array<{ group: Object, entries: Object[] }>}
   */
  function groupedForSettings() {
    return GROUPS.map(group => ({
      group,
      entries: CATALOG.filter(e => e.group === group.id && !e.hidden)
    })).filter(g => g.entries.length > 0);
  }

  // ─── Public API ─────────────────────────────────────────────────
  return Object.freeze({
    CATALOG,
    GROUPS,
    match,
    find,
    candidatesFor,
    pickFromList,
    groupedForSettings
  });
})();
