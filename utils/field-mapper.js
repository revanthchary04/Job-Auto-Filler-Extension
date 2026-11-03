/**
 * OriginFill — Intelligent Field Type Detection
 * Decides what profile data a form field expects (from its label, name, id, placeholder and
 * surrounding section) and resolves the matching value from the active profile.
 *
 * All keyword rules use whole-word regular expressions: substring matching made "Ethnicity"
 * look like a city and "Tell us…" look like a phone ("tel") field.
 *
 * @license AGPL-3.0
 * @author CharyWorld
 */

var OriginFillFieldMapper = (() => {
  'use strict';

  // ─── Field Type → Profile Path Mapping ─────────────────────────

  /**
   * Maps field types to profile data paths. `[0]` is replaced with the entry index for
   * repeating sections (education, work experience, websites).
   */
  const FIELD_TO_PROFILE = Object.freeze({
    // Personal
    'firstName':        'personal.firstName',
    'middleName':       'personal.middleName',
    'lastName':         'personal.lastName',
    'fullName':         'personal.fullName',
    'preferredName':    'personal.preferredName',
    'prefix':           'personal.prefix',
    'email':            'personal.email',
    'phone':            'personal.phone',
    'phoneType':        'personal.phoneType',
    'phoneCountryCode': 'personal.phoneCountryCode',
    'address':          'personal.address',
    'address2':         'personal.address2',
    'city':             'personal.city',
    'state':            'personal.state',
    'country':          'personal.country',
    'zipCode':          'personal.zipCode',
    'linkedIn':         'personal.linkedIn',
    'github':           'personal.github',
    'portfolio':        'personal.portfolio',
    'website':          'personal.websites[0]',

    // Application questions answered once in settings
    'referralSource':     'application.referralSource',
    'previouslyEmployed': 'application.previouslyEmployed',

    // Education
    'institution':   'education[0].institution',
    'degree':        'education[0].degree',
    'fieldOfStudy':  'education[0].fieldOfStudy',
    'gpa':           'education[0].gpa',
    'eduStartYear':  'education[0].startYear',
    'eduEndYear':    'education[0].endYear',
    'eduLocation':   'education[0].location',

    // Work Experience
    'company':       'workExperience[0].company',
    'jobTitle':      'workExperience[0].jobTitle',
    'workStartDate': 'workExperience[0].startDate',
    'workEndDate':   'workExperience[0].endDate',
    'workLocation':  'workExperience[0].location',
    'workBullets':   'workExperience[0].bullets',
    'isCurrent':     'workExperience[0].isCurrent',

    // Other
    'skills':        'skills',
    'resume':        'resume'
  });

  /** Field types that belong to a repeating section. */
  const SECTION_OF_FIELD = Object.freeze({
    institution: 'education', degree: 'education', fieldOfStudy: 'education', gpa: 'education',
    eduStartYear: 'education', eduEndYear: 'education', eduEndMonth: 'education', eduLocation: 'education',
    company: 'work', jobTitle: 'work', workStartDate: 'work', workEndDate: 'work',
    workLocation: 'work', workBullets: 'work', isCurrent: 'work',
    website: 'website'
  });

  // ─── Keyword → Field Type Detection Rules ─────────────────────

  // The free-text box that goes with a list's "Other" choice
  const OTHER_BOX = /\b(other|others|specify|unlisted|not\s+(listed|found|in\s+(the\s+)?list))\b/;

  /** Lists where "Other" / "Not listed" is a fair answer when the real one is missing. */
  const OTHER_FALLBACK_FIELDS = new Set(['institution', 'fieldOfStudy', 'degree', 'referralSource']);

  function allowsOtherOption(fieldType) {
    return OTHER_FALLBACK_FIELDS.has(fieldType);
  }

  const NAME_EXCLUDES = [
    /\bpreferred\b/, /\bnick\s*name\b/, /\bphonetic\b/,
    /\b(emergency|reference|referee|manager|supervisor|parent|guardian|spouse|recruiter|referr\w*)\b/
  ];

  /**
   * Ordered rules — first match wins. Patterns run against lower-cased label text (and, with
   * lower confidence, against attribute hints such as name/id split into words).
   * `context` limits a rule to fields inside a given section; `controls` limits it to control kinds.
   */
  const DETECTION_RULES = [
    // ─── Contact ─────────────
    { fieldType: 'email', patterns: [/\be-?mail\b/],
      exclude: [/\b(alternate|alternative|secondary|other|manager|supervisor|reference|referee|recruiter|referr\w*|emergency)\b/] },
    { fieldType: 'phoneCountryCode', patterns: [/\bcountry\s*(phone|calling|dial(l?ing)?)?\s*code\b/, /\b(phone|dial(l?ing)?|calling)\s*code\b/],
      exclude: [/\b(zip|postal)\b/] },
    { fieldType: 'phoneType', patterns: [/\bphone\s*(device\s*)?type\b/, /\bdevice\s*type\b/, /\btype\s+of\s+phone\b/] },
    { fieldType: 'phoneExtension', patterns: [/\bextension\b/, /\bext\b/] },
    { fieldType: 'phone', patterns: [/\b(phone|telephone|mobile|cell\s*phone|cellular)\b/, /\btel\b/, /\bcontact\s*(number|no)\b/],
      exclude: [/\b(type|extension|ext|manager|supervisor|reference|emergency|fax)\b/] },

    // ─── Name ─────────────
    { fieldType: 'preferredName', controls: ['text'], patterns: [/\bpreferred\s+(first\s+)?name\b/, /\bnick\s*name\b/, /\b(known|goes)\s+(as|by)\b/] },
    { fieldType: 'firstName', patterns: [/\bfirst\s*name\b/, /\bgiven\s*name\b/, /\bfore\s*name\b/, /\bfname\b/], exclude: NAME_EXCLUDES },
    { fieldType: 'middleName', patterns: [/\bmiddle\s*(name|initial)\b/], exclude: NAME_EXCLUDES },
    { fieldType: 'lastName', patterns: [/\blast\s*name\b/, /\bfamily\s*name\b/, /\bsur\s*name\b/, /\blname\b/], exclude: NAME_EXCLUDES },
    { fieldType: 'fullName', patterns: [/\bfull\s*(legal\s*)?name\b/, /\byour\s+name\b/, /\blegal\s+name\b/, /^name$/],
      exclude: [...NAME_EXCLUDES, /\b(company|employer|school|university|institution|user|file|business|organi[sz]ation|account|display|screen|project|product|job|position|degree|program|course|first|last|middle)\b/] },

    // ─── Address ─────────────
    { fieldType: 'address2', patterns: [/\baddress\s*(line)?\s*2\b/, /\b(apt|apartment|suite|unit)\b/] },
    { fieldType: 'address', patterns: [/\baddress\s*(line)?\s*1\b/, /\bstreet(\s*address)?\b/, /\b(mailing|home|current|residential|permanent|postal)\s+address\b/, /^address$/],
      exclude: [/\b(e-?mail|web|url|ip|wallet|employer|company|school)\b/] },
    { fieldType: 'city', patterns: [/\bcity\b/, /\btown\b/, /\bmunicipality\b/, /\bsuburb\b/, /^(current|present)\s+location$/],
      exclude: [/\b(prefer(red|ences?)?|choice|wish|willing)\b/] },
    { fieldType: 'zipCode', patterns: [/\bzip\b/, /\bpostal\b/, /\bpost\s*code\b/, /\bpin\s*code\b/, /\bpincode\b/] },
    { fieldType: 'state', patterns: [/\bstate\b/, /\bprovince\b/, /\bprefecture\b/, /^region$/],
      exclude: [/\bunited\s+states\b/, /\bstate\s+of\s+(health|mind)\b/] },
    { fieldType: 'country', patterns: [/\bcountry\b/],
      exclude: [/\b(code|calling|dial|phone|citizenship|nationality|birth|issu\w*|passport|countries)\b/] },

    // ─── Links ─────────────
    { fieldType: 'linkedIn', patterns: [/\blinked\s*in\b/] },
    { fieldType: 'github', patterns: [/\bgit\s*hub\b/] },
    { fieldType: 'website', patterns: [/\bportfolio\b/, /\bpersonal\s+(web\s*)?site\b/, /\bweb\s*site\b/, /\bblog\b/, /\bhomepage\b/, /^url$/],
      exclude: [/\b(company|employer)\b/] },

    // ─── Common application questions ─────────────
    { fieldType: 'referralSource', patterns: [/\bhow\s+did\s+you\s+(hear|learn|find\s+out)\b/, /\bwhere\s+did\s+you\s+(hear|find|see|learn)\b/, /\b(referral|recruitment|candidate|application)\s+source\b/, /^source$/] },
    { fieldType: 'previouslyEmployed', patterns: [
      /\b(previously|formerly|ever)\s+(been\s+)?(worked|employed|work)\s+(for|at|with|by)\b/,
      /\bprevious(ly)?\s+(worked|employed|employee|worker)\b/,
      /\b(current\s+or\s+)?former\s+(employee|worker)\b/
    ] },

    // ─── Education ─────────────
    // "Other college name" / "If others, please specify" boxes belong to the list before them:
    // they're only typed in when that list had no match and "Other" was picked
    { fieldType: 'institution', patterns: [/\b(school|university|college|institution|institute)\b/],
      exclude: [/\bhigh\s+school\s+(diploma|graduate)\b/, /\bschool\s+district\b/, /\bdegree\b/, /\bmajor\b/], excludeLabel: [OTHER_BOX] },
    { fieldType: 'degree', patterns: [/\bdegree\b/, /\blevel\s+of\s+education\b/, /\beducation(al)?\s+level\b/, /\bhighest\s+(level\s+of\s+)?education\b/, /\bqualification\b/, /^(course|program(me)?)(\s+(name|type|pursued|completed))?$/],
      // "Degree Subject/Major" asks for the subject, not the degree
      exclude: [/\bdegree\s+of\s+(certainty|confidence)\b/, /\b(subject|major|field|speciali[sz]ation|branch|stream|discipline)\b/], excludeLabel: [OTHER_BOX] },
    { fieldType: 'fieldOfStudy', patterns: [/\bmajor\b/, /\bfield\s+of\s+study\b/, /\barea\s+of\s+(study|concentration)\b/, /\bconcentration\b/, /\bdiscipline\b/, /\bspeciali[sz]ation\b/, /\b(course|program(me)?)\s+of\s+study\b/, /\bbranch\b/, /\bstream\b/, /\b(degree|main)\s+subject\b/, /\bsubject\s+of\s+study\b/],
      exclude: [/\b(bank|ifsc|office|micr)\b/], excludeLabel: [OTHER_BOX] },
    { fieldType: 'gpa', patterns: [/\bgpa\b/, /\bcgpa\b/, /\bgrade\s+point\b/, /\bgrade\s+average\b/, /\boverall\s+result\b/] },
    { fieldType: 'eduEndMonth', patterns: [/\bmonth\s+of\s+(graduation|passing|completion)\b/, /\b(graduation|passing|completion)\s+month\b/] },
    { fieldType: 'eduEndYear', patterns: [/\bgraduation\s*(date|year)?\b/, /\bexpected\s+graduation\b/, /\byear\s+of\s+(passing|completion)\b/, /\b(passing|passed\s+out|completion)\s+year\b/] },

    // ─── Dates (meaning depends on the section) ─────────────
    { fieldType: 'startDate', context: ['work', 'education'],
      patterns: [/^(from|start)$/, /\b(start|from|begin(ning)?)\s*(date|year|month)\b/, /\bfirst\s+year\s+attended\b/, /\bdate\s+(started|from)\b/, /\benrol+(ment|ed)\s+(date|year)\b/] },
    { fieldType: 'endDate', context: ['work', 'education'],
      patterns: [/^(to|end)$/, /\b(end|to|until|finish|completion|leaving)\s*(date|year|month)\b/, /\blast\s+year\s+attended\b/, /\bdate\s+(ended|to|left)\b/] },

    // ─── Work Experience ─────────────
    { fieldType: 'jobTitle', patterns: [/\bjob\s+title\b/, /\bposition\s+title\b/, /\bcurrent\s+(job\s+)?title\b/, /\bdesignation\b/],
      exclude: [/\b(applied|applying|desired|interested)\b/] },
    { fieldType: 'jobTitle', context: ['work'], patterns: [/^(title|position|role)$/] },
    { fieldType: 'company', patterns: [/\b(company|employer|organi[sz]ation)(\s+name)?\b/],
      exclude: [/\b(size|type|industry|website|url|phone|address|e-?mail|location|city|description)\b/] },
    { fieldType: 'workLocation', context: ['work'], patterns: [/^location$/, /\b(job|work|office|company)\s+location\b/] },
    { fieldType: 'eduLocation', context: ['education'], patterns: [/^location$/] },
    { fieldType: 'isCurrent', context: ['work'], controls: ['checkbox'],
      patterns: [/\bcurrent(ly)?\s+(work|working|employed)\b/, /\bi\s+(currently|still)\s+work\b/, /\bcurrent\s+(job|position|employer|role)\b/, /\bpresent\b/, /\bstill\s+(work|employed)\b/] },
    { fieldType: 'workBullets', context: ['work'],
      patterns: [/\bdescription\b/, /\bresponsibilit(y|ies)\b/, /\bduties\b/, /\baccomplishments?\b/, /\bachievements?\b/, /\bsummary\b/] },

    // ─── Skills ─────────────
    { fieldType: 'skills', patterns: [/\bskills?\b/], exclude: [/\byears?\b/, /\blevel\b/, /\brate\b/, /\bdescribe\b/] }
  ];

  /** Field types that only make sense for short labels; long labels are usually questions. */
  const QUESTION_FIELD_TYPES = new Set(['referralSource', 'previouslyEmployed']);
  const MAX_DATA_LABEL_LENGTH = 70;

  // ─── Sensitive Question Detection Rules ───────────────────────

  /**
   * Questions OriginFill never answers on its own: legal status, self-identification, pay,
   * free-text essays and agreements. Users can still answer them via Saved Answers.
   */
  const SENSITIVE_RULES = [
    { reason: 'Work authorization / visa', patterns: [/\bauthori[sz](ed|ation)\b.*\bwork\b/, /\bwork\s+(authori[sz]ation|permit|visa)\b/, /\blegally\s+(authori[sz]ed|eligible|able|entitled)\b/, /\beligib(le|ility)\s+to\s+work\b/, /\bsponsor(ship)?\b/, /\bvisa\b/, /\bimmigration\b/, /\bcitizen(ship)?\b/, /\bright\s+to\s+work\b/] },
    { reason: 'Background check', patterns: [/\bcriminal\b/, /\bconvict(ed|ion)\b/, /\bfelony\b/, /\bmisdemeanou?r\b/, /\bbackground\s+check\b/] },
    { reason: 'Voluntary self-identification', patterns: [/\bdisabilit(y|ies)\b/, /\bdisabled\b/, /\baccommodations?\b/, /\bveteran\b/, /\bmilitary\b/, /\barmed\s+forces\b/, /\bgender\b/, /\bsex\b/, /\bsexual\s+orientation\b/, /\bpronouns?\b/, /\btransgender\b/, /\brace\b/, /\bracial\b/, /\bethnic(ity)?\b/, /\bhispanic\b/, /\blatin[oax]\b/, /\bmarital\b/, /\breligio(n|us)\b/] },
    { reason: 'Personal identifiers', patterns: [/\bdate\s+of\s+birth\b/, /\bbirth\s*date\b/, /\bage\b/, /\bsocial\s+security\b/, /\bssn\b/, /\bnational\s+(id|insurance)\b/, /\bpassport\b/, /\btax\s+id\b/, /\bdriver'?s?\s+licen[cs]e\b/] },
    { reason: 'Health', patterns: [/\b(illness|illnesses|surgery|surgeries|accident|hospitali[sz](ed|ation))\b/, /\bmedical\s+(conditions?|history|issues?|problems?)\b/, /\bhealth\s+(conditions?|issues?|problems?)\b/, /\bpregnan/] },
    { reason: 'Compensation', patterns: [/\bsalary\b/, /\bcompensation\b/, /\bpay\s+(expectation|rate|range)\b/, /\bexpected\s+(pay|ctc)\b/, /\bctc\b/, /\bwages?\b/] },
    { reason: 'Availability & relocation', patterns: [/\brelocat(e|ion)\b/, /\bnotice\s+period\b/, /\bwhen\s+can\s+you\s+start\b/, /\bavailab(le|ility)\s+to\s+start\b/, /\bwilling\s+to\s+(travel|work)\b/] },
    { reason: 'Agreement / consent', patterns: [/\bi\s+(agree|certify|acknowledge|consent|understand|attest|accept)\b/, /\bterms\s+(and|&)\s+conditions\b/, /\bprivacy\s+(policy|notice|statement)\b/, /\bagreement\b/, /\bconsent\b/] },
    { reason: 'Open-ended question', patterns: [/\bwhy\s+(do|are|would|should|did)\b/, /\btell\s+us\b/, /\bcover\s+letter\b/, /\badditional\s+information\b/] },
    { reason: 'Experience question', patterns: [/\byears\s+of\s+(professional\s+|relevant\s+|work\s+)?experience\b/, /\bhow\s+many\s+years\b/] },
    { reason: 'Relationships', patterns: [/\brelatives?\b/, /\bfamily\s+members?\b/, /\bnon-?compete\b/, /\bconflicts?\s+of\s+interest\b/] }
  ];

  const OPEN_ENDED_PATTERN = /\b(why|describe|explain|tell\s+us|what\s+makes|how\s+would|share)\b/;

  // ─── Value Aliases (for dropdown matching) ─────────────────────

  const COUNTRY_ALIASES = Object.freeze({
    'united states of america': ['United States of America', 'United States', 'USA', 'US'],
    'united kingdom': ['United Kingdom', 'UK', 'Great Britain', 'United Kingdom of Great Britain and Northern Ireland'],
    'united arab emirates': ['United Arab Emirates', 'UAE'],
    'south korea': ['Korea, Republic of', 'Republic of Korea', 'South Korea', 'Korea'],
    'russia': ['Russian Federation', 'Russia'],
    'vietnam': ['Viet Nam', 'Vietnam'],
    'czech republic': ['Czechia', 'Czech Republic'],
    'netherlands': ['Netherlands', 'The Netherlands', 'Holland'],
    'turkey': ['Türkiye', 'Turkey'],
    'iran': ['Iran, Islamic Republic of', 'Iran'],
    'taiwan': ['Taiwan', 'Taiwan, Province of China']
  });

  const COUNTRY_SHORTHANDS = Object.freeze({
    'us': 'united states of america', 'usa': 'united states of america', 'u.s.': 'united states of america',
    'u.s.a.': 'united states of america', 'united states': 'united states of america', 'america': 'united states of america',
    'uk': 'united kingdom', 'u.k.': 'united kingdom', 'great britain': 'united kingdom', 'britain': 'united kingdom', 'england': 'united kingdom',
    'uae': 'united arab emirates', 'korea': 'south korea', 'republic of korea': 'south korea',
    'russian federation': 'russia', 'viet nam': 'vietnam', 'czechia': 'czech republic', 'holland': 'netherlands',
    'the netherlands': 'netherlands', 'türkiye': 'turkey', 'turkiye': 'turkey'
  });

  /** Calling codes for the countries applicants most often live in (phone pickers without a code). */
  const DIAL_CODES = Object.freeze({
    'india': '91', 'united states of america': '1', 'canada': '1', 'united kingdom': '44', 'australia': '61',
    'germany': '49', 'france': '33', 'netherlands': '31', 'ireland': '353', 'singapore': '65',
    'united arab emirates': '971', 'saudi arabia': '966', 'qatar': '974', 'new zealand': '64', 'japan': '81',
    'china': '86', 'south korea': '82', 'spain': '34', 'italy': '39', 'switzerland': '41', 'sweden': '46',
    'poland': '48', 'brazil': '55', 'mexico': '52', 'south africa': '27', 'nigeria': '234', 'kenya': '254',
    'pakistan': '92', 'bangladesh': '880', 'sri lanka': '94', 'nepal': '977', 'philippines': '63',
    'malaysia': '60', 'indonesia': '62', 'vietnam': '84', 'israel': '972'
  });

  /**
   * The calling code for a country name ("India" → "91", "USA" → "1"), or ''.
   * @param {string} country
   * @returns {string}
   */
  function dialCodeForCountry(country) {
    const lower = String(country || '').trim().toLowerCase();
    return DIAL_CODES[COUNTRY_SHORTHANDS[lower] || lower] || '';
  }

  const REGION_NAMES = Object.freeze({
    // United States
    AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado',
    CT: 'Connecticut', DE: 'Delaware', DC: 'District of Columbia', FL: 'Florida', GA: 'Georgia',
    HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky',
    LA: 'Louisiana', ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota',
    MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire',
    NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota',
    OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', PR: 'Puerto Rico', RI: 'Rhode Island',
    SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont',
    VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
    // Canada
    AB: 'Alberta', BC: 'British Columbia', MB: 'Manitoba', NB: 'New Brunswick', NL: 'Newfoundland and Labrador',
    NS: 'Nova Scotia', NT: 'Northwest Territories', NU: 'Nunavut', ON: 'Ontario', PE: 'Prince Edward Island',
    QC: 'Quebec', SK: 'Saskatchewan', YT: 'Yukon'
  });

  const DEGREE_ALIASES = Object.freeze([
    // Specific Indian degrees first: their own name, then the level lists use
    { test: /\b(b\.?\s?tech|b\.?\s?e\.?|bachelor\s+of\s+(technology|engineering))(?![a-z])/i, aliases: ['B.Tech', 'B.Tech.', 'BTech', 'B.E.', 'BE', 'B.Tech/B.E.', 'B.E./B.Tech', 'B.Tech / B.E', 'Bachelor of Technology', 'Bachelor of Engineering', "Bachelor's Degree", 'Bachelors', 'Bachelor', 'Graduation', 'Undergraduate', 'UG'] },
    { test: /\b(m\.?\s?tech|m\.?\s?e\.?|master\s+of\s+(technology|engineering))(?![a-z])/i, aliases: ['M.Tech', 'M.Tech.', 'MTech', 'M.E.', 'ME', 'M.Tech/M.E.', 'M.E./M.Tech', 'Master of Technology', 'Master of Engineering', "Master's Degree", 'Masters', 'Post Graduation', 'Post Graduate', 'Postgraduate', 'PG'] },
    { test: /\b(mca|master\s+of\s+computer\s+applications?)\b/i, aliases: ['MCA', 'Master of Computer Applications', "Master's Degree", 'Masters', 'Post Graduation', 'PG'] },
    { test: /\b(bca|bachelor\s+of\s+computer\s+applications?)\b/i, aliases: ['BCA', 'Bachelor of Computer Applications', "Bachelor's Degree", 'Bachelors', 'Graduation', 'UG'] },
    { test: /\b(b\.?\s?com|bachelor\s+of\s+commerce)\b/i, aliases: ['B.Com', 'BCom', 'Bachelor of Commerce', "Bachelor's Degree", 'Bachelors', 'Graduation', 'UG'] },
    { test: /\b(m\.?\s?com|master\s+of\s+commerce)\b/i, aliases: ['M.Com', 'MCom', 'Master of Commerce', "Master's Degree", 'Masters', 'Post Graduation', 'PG'] },
    { test: /\b(bba|bachelor\s+of\s+business\s+administration)\b/i, aliases: ['BBA', 'Bachelor of Business Administration', "Bachelor's Degree", 'Bachelors', 'Graduation', 'UG'] },
    { test: /\b(diploma|polytechnic)\b/i, aliases: ['Diploma', 'Polytechnic Diploma', 'Diploma in Engineering', "Associate's Degree", 'Associate Degree'] },
    { test: /\b(intermediate|hsc|12th|class\s+xii|higher\s+secondary)\b/i, aliases: ['12th', 'Class XII', 'Intermediate', 'HSC', 'Higher Secondary', 'High School Diploma', 'High School'] },
    { test: /\b(ssc|10th|class\s+x|matriculation)\b/i, aliases: ['10th', 'Class X', 'SSC', 'Matriculation', 'Secondary School'] },
    { test: /\b(high\s+school|secondary|ged|12th)\b/i, aliases: ['High School Diploma', 'High School', 'High School or equivalent', 'GED', 'Secondary School'] },
    { test: /\bassociate/i, aliases: ["Associate's Degree", 'Associate Degree', "Associate's", 'Associates', 'Associate of Science', 'Associate of Arts'] },
    { test: /\b(bachelor|b\.?\s?s\.?c?|b\.?\s?a\.?(?![a-z])|b\.?\s?tech|b\.?\s?e\.?(?![a-z])|undergrad)/i, aliases: ["Bachelor's Degree", 'Bachelor Degree', "Bachelor's", 'Bachelors', 'Bachelor of Science', 'Bachelor of Arts', 'Bachelor of Technology', 'Bachelor of Engineering', 'BS', 'BA', 'Undergraduate', 'Graduation', 'UG'] },
    { test: /\b(mba|business\s+administration)\b/i, aliases: ['MBA', 'Master of Business Administration', "Master's Degree", 'Masters'] },
    { test: /\b(master|m\.?\s?s\.?c?|m\.?\s?a\.?|m\.?\s?tech|m\.?\s?eng|graduate\s+degree)/i, aliases: ["Master's Degree", 'Master Degree', "Master's", 'Masters', 'Master of Science', 'Master of Arts', 'Master of Engineering', 'MS', 'MA', 'Graduate Degree', 'Post Graduation', 'Post Graduate', 'Postgraduate', 'PG'] },
    { test: /\b(ph\.?\s?d|doctor|doctorate)/i, aliases: ['Doctorate', 'PhD', 'Ph.D.', 'Doctoral Degree', 'Doctor of Philosophy', 'Doctorate Degree'] }
  ]);

  const PHONE_TYPE_ALIASES = Object.freeze([
    { test: /\b(mobile|cell|cellular)\b/i, aliases: ['Mobile', 'Cell', 'Mobile Phone', 'Cell Phone', 'Personal Mobile', 'Cellular'] },
    { test: /\bhome\b/i, aliases: ['Home', 'Home Phone', 'Landline', 'Personal'] },
    { test: /\b(work|business|office)\b/i, aliases: ['Work', 'Business', 'Office', 'Work Phone'] }
  ]);

  const SOURCE_ALIASES = Object.freeze([
    { test: /\blinked\s*in\b/i, aliases: ['LinkedIn', 'LinkedIn Jobs', 'Social Media'] },
    { test: /\bindeed\b/i, aliases: ['Indeed', 'Job Board', 'Online Job Board'] },
    { test: /\bglassdoor\b/i, aliases: ['Glassdoor', 'Job Board'] },
    { test: /\b(company|career|careers|corporate)\s*(web\s*)?(site|page)?\b/i, aliases: ['Company Website', 'Careers Website', 'Career Site', 'Corporate Website', 'Website'] },
    { test: /\breferr?al\b/i, aliases: ['Employee Referral', 'Referral', 'Referred by Employee'] },
    { test: /\b(job\s*board|job\s*site)\b/i, aliases: ['Job Board', 'Online Job Board', 'Job Posting'] },
    { test: /\b(career\s+fair|job\s+fair|university|campus)\b/i, aliases: ['Career Fair', 'University Recruiting', 'Campus Recruiting'] },
    { test: /\brecruiter\b/i, aliases: ['Recruiter', 'Agency', 'Recruiter Contact'] }
  ]);

  // ─── Text Utilities ────────────────────────────────────────────

  /**
   * Turn attribute values into words: "legalNameSection_firstName" → "legal name section first name".
   * @param {string} str
   * @returns {string}
   */
  function hintToWords(str) {
    return String(str || '')
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/([A-Za-z])(\d)/g, '$1 $2')
      .replace(/[_\-.:[\]]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  function normalizeText(str) {
    return String(str || '').replace(/\*/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
  }

  function stripSectionPrefix(text) {
    // "Work Experience 1 Job Title" style labels are rare, but strip trailing colons etc.
    return text.replace(/[:?]+$/, '').trim();
  }

  /**
   * The part of a question before any explanation: "1. Country/Region of Residence - Select the
   * country you live in" → "country/region of residence".
   * @param {string} text - Normalized (lower-case) label
   * @returns {string}
   */
  function firstClause(text) {
    return text
      .replace(/^(q(uestion)?\s*)?\d+\s*[.):-]\s*/, '')
      .split(/[?:(]|\.\s|\s[-–—]\s|\n/)[0]
      .trim();
  }

  // ─── Classification ────────────────────────────────────────────

  /**
   * Classify a field from its label and attribute hints.
   *
   * @param {{ label?: string, hints?: string[], control?: string, section?: string|null }} info
   * @returns {{ fieldType: string|null, confidence: string }}
   */
  function classifyText({ label = '', hints = [], control = 'text', section = null }) {
    const labelText = stripSectionPrefix(normalizeText(label));
    const hintText = hints.map(hintToWords).filter(Boolean);

    const candidates = [];
    const clause = firstClause(labelText);
    if (clause && clause !== labelText) candidates.push({ text: clause, confidence: 'high' });
    if (labelText) candidates.push({ text: labelText, confidence: 'high' });
    hintText.forEach(text => candidates.push({ text, confidence: 'medium' }));

    for (const { text, confidence } of candidates) {
      const isLong = text.length > MAX_DATA_LABEL_LENGTH;
      for (const rule of DETECTION_RULES) {
        if (isLong && !QUESTION_FIELD_TYPES.has(rule.fieldType)) continue;
        if (rule.controls && !rule.controls.includes(control)) continue;
        if (rule.context && !rule.context.includes(section)) continue;
        if (!rule.patterns.some(p => p.test(text))) continue;
        if (rule.exclude && rule.exclude.some(p => p.test(text))) continue;
        // Checked on the whole label: "College name (if not listed)" is classified on "College name"
        if (rule.excludeLabel && rule.excludeLabel.some(p => p.test(labelText))) continue;
        return { fieldType: resolveSectionType(rule.fieldType, section, text), confidence };
      }
    }

    return { fieldType: null, confidence: 'none' };
  }

  /**
   * Map generic "startDate"/"endDate" (and section-dependent fields) to the concrete type.
   */
  function resolveSectionType(fieldType, section, text) {
    if (fieldType === 'startDate') return section === 'education' ? 'eduStartYear' : 'workStartDate';
    if (fieldType === 'endDate') return section === 'education' ? 'eduEndYear' : 'workEndDate';
    if (fieldType === 'eduEndYear' && section === 'work' && !/graduat/.test(text)) return 'workEndDate';
    return fieldType;
  }

  /**
   * Detect the field type of an input element (generic portals).
   *
   * @param {HTMLElement} element - Input, select, or textarea element
   * @returns {{ fieldType: string|null, profilePath: string|null, confidence: string, inputType: string }}
   */
  function detectFieldType(element) {
    if (!element) {
      return { fieldType: null, profilePath: null, confidence: 'none', inputType: 'unknown' };
    }

    const inputType = getInputType(element);
    const label = OriginFillDetector.getInputLabel(element);
    const hints = [
      element.getAttribute('name'),
      element.id,
      element.getAttribute('aria-label'),
      element.getAttribute('data-automation-id'),
      element.getAttribute('autocomplete'),
      element.placeholder
    ].filter(Boolean);
    const { section } = detectSectionContext(element);

    // Explicit input types are reliable signals
    if (element.type === 'email') return createResult('email', 'high', inputType);
    if (element.type === 'tel') return createResult('phone', 'high', inputType);

    // File inputs: only résumé / CV uploads
    if (element.type === 'file') {
      const text = normalizeText(`${label} ${hints.join(' ')}`);
      const isResume = /\b(resume|résumé|cv|curriculum)\b/.test(text) ||
        (!/\b(cover|letter|transcript|portfolio|photo|picture|image)\b/.test(text) && /pdf|doc/i.test(element.accept || ''));
      return isResume
        ? { fieldType: 'resume', profilePath: 'resume', confidence: 'high', inputType: OriginFillFieldTypes.FILE }
        : { fieldType: null, profilePath: null, confidence: 'none', inputType: OriginFillFieldTypes.FILE };
    }

    const control = inputType === OriginFillFieldTypes.CHECKBOX ? 'checkbox' : 'text';
    const { fieldType, confidence } = classifyText({ label, hints, control, section });

    if (!fieldType && element.type === 'url') {
      return createResult('website', 'medium', inputType);
    }

    return fieldType
      ? createResult(fieldType, confidence, inputType)
      : { fieldType: null, profilePath: null, confidence: 'none', inputType };
  }

  /**
   * Create a detection result object.
   */
  function createResult(fieldType, confidence, inputType) {
    return {
      fieldType,
      profilePath: FIELD_TO_PROFILE[fieldType] || null,
      confidence,
      inputType
    };
  }

  /**
   * Determine the input type (text, select, checkbox, radio, etc.)
   * @param {HTMLElement} element
   * @returns {string}
   */
  function getInputType(element) {
    const tag = element.tagName.toLowerCase();

    if (tag === 'select') return OriginFillFieldTypes.SELECT;
    if (tag === 'textarea') return OriginFillFieldTypes.TEXTAREA;

    if (tag === 'input') {
      const type = (element.type || 'text').toLowerCase();
      switch (type) {
        case 'checkbox': return OriginFillFieldTypes.CHECKBOX;
        case 'radio':    return OriginFillFieldTypes.RADIO;
        case 'file':     return OriginFillFieldTypes.FILE;
        case 'date':     return OriginFillFieldTypes.DATE;
        case 'number':   return OriginFillFieldTypes.NUMBER;
        case 'email':    return OriginFillFieldTypes.EMAIL;
        case 'tel':      return OriginFillFieldTypes.PHONE;
        case 'url':      return OriginFillFieldTypes.URL;
        default:         return OriginFillFieldTypes.TEXT;
      }
    }

    // contenteditable div
    if (element.getAttribute('contenteditable') === 'true') {
      return OriginFillFieldTypes.RICHTEXT;
    }

    // ARIA widgets
    const role = element.getAttribute('role');
    if (role === 'checkbox') return OriginFillFieldTypes.CHECKBOX;
    if (role === 'radio') return OriginFillFieldTypes.RADIO;
    if (role === 'combobox' || role === 'listbox') return OriginFillFieldTypes.COMBOBOX;

    return OriginFillFieldTypes.TEXT;
  }

  // ─── Section Context ───────────────────────────────────────────

  /**
   * Identify a repeating section from a heading or attribute text.
   * "Work Experience 2" → { section: 'work', index: 1 }
   *
   * @param {string} text
   * @returns {{ section: string, index: number|null }|null}
   */
  function sectionFromText(text) {
    const t = normalizeText(text);
    if (!t || t.length > 60) return null;

    const patterns = [
      { section: 'work', re: /^(work\s*experience|employment(\s+history)?|work\s+history|professional\s+experience|experience)\b/ },
      { section: 'education', re: /^(education|academic\s+(history|background)|schools?)\b/ },
      { section: 'website', re: /^(websites?|web\s*address(es)?|web\s*sites?|links)\b/ },
      { section: 'language', re: /^languages?\b/ },
      { section: 'certification', re: /^(certifications?|licen[cs]es?)\b/ },
      { section: 'skills', re: /^skills?\b/ }
    ];

    for (const { section, re } of patterns) {
      if (re.test(t)) {
        const num = t.match(/(\d+)\s*$/);
        return { section, index: num ? parseInt(num[1], 10) - 1 : null };
      }
    }
    return null;
  }

  /** Attribute prefixes Workday uses for repeating entries: "workExperience-2", "education-1--degree". */
  const ENTRY_ID_PATTERN = /^(workExperience|education|webAddress|websitePanelSet|website|language|certification)-(\d+)/i;
  const ENTRY_SECTIONS = Object.freeze({
    workexperience: 'work', education: 'education', webaddress: 'website', websitepanelset: 'website',
    website: 'website', language: 'language', certification: 'certification'
  });

  /**
   * Determine whether an element belongs to a repeating section (work, education, websites…)
   * and, when the page says so, which entry it is in.
   *
   * @param {HTMLElement} element
   * @returns {{ section: string|null, index: number|null }}
   */
  function detectSectionContext(element) {
    const result = { section: null, index: null, entry: null };
    if (!element) return result;

    // The number in "workExperience-26--jobTitle" is Workday's internal counter, not the entry's
    // position on the page — it only tells entries apart. Positions come from the visible
    // heading ("Work Experience 1") or from page order (see assignEntryIndexes).
    const remember = (match) => {
      result.section = ENTRY_SECTIONS[match[1].toLowerCase()];
      result.entry = `${match[1]}-${match[2]}`.toLowerCase();
    };

    // 1. Entry ids on the element itself
    for (const attr of [element.id, element.getAttribute && element.getAttribute('name')]) {
      const m = (attr || '').match(ENTRY_ID_PATTERN);
      if (m) {
        remember(m);
        break;
      }
    }

    // 2. Walk up the ancestors
    let current = element.parentElement;
    for (let depth = 0; current && current !== document.body && depth < 15; depth++) {
      const automationId = current.getAttribute('data-automation-id') || '';
      const entry = automationId.match(ENTRY_ID_PATTERN) || (current.id || '').match(ENTRY_ID_PATTERN);
      if (entry && !result.entry) remember(entry);

      if (!result.section) {
        const legacy = automationId.match(/^(workExperience|education|website)Section$/i);
        if (legacy) result.section = ENTRY_SECTIONS[legacy[1].toLowerCase()];
      }

      // Labelled groups: <div role="group" aria-labelledby="…">Work Experience 1</div>
      const labelledBy = current.getAttribute('aria-labelledby');
      const groupLabel = current.getAttribute('aria-label') ||
        (labelledBy ? labelledBy.split(/\s+/).map(id => document.getElementById(id)?.textContent || '').join(' ') : '');
      const heading = groupLabel || headingOf(current, element);
      const fromHeading = heading ? sectionFromText(heading) : null;
      if (fromHeading) {
        if (fromHeading.index !== null) {
          return {
            section: fromHeading.section,
            index: fromHeading.index,
            entry: result.entry || `${fromHeading.section}-heading-${fromHeading.index}`
          };
        }
        if (!result.section) result.section = fromHeading.section;
      }

      current = current.parentElement;
    }

    return result;
  }

  /**
   * Give every repeating-section field its entry position (0 = first job/school/website):
   * the visible heading's number when there is one, else the entry's order on the page, else
   * the field's order among fields of its kind ("the 2nd Job Title belongs to job 2").
   * Also sets profilePath to match.
   *
   * @param {Array<Object>} fields - Descriptors with fieldType, section, index, entry
   */
  function assignEntryIndexes(fields) {
    const REPEATING = ['work', 'education', 'website'];
    const hasIndex = (f) => f.index !== null && f.index !== undefined;

    const entryOrder = {};
    fields.forEach(f => {
      if (!REPEATING.includes(f.section) || !f.entry || hasIndex(f)) return;
      const list = entryOrder[f.section] || (entryOrder[f.section] = []);
      if (!list.includes(f.entry)) list.push(f.entry);
    });

    const counters = {};
    fields.forEach(field => {
      if (field.fieldType && REPEATING.includes(field.section) && !hasIndex(field)) {
        if (field.entry && entryOrder[field.section]) {
          field.index = entryOrder[field.section].indexOf(field.entry);
        } else {
          const key = `${field.section}:${field.fieldType}`;
          field.index = counters[key] || 0;
          counters[key] = field.index + 1;
        }
      }
      const path = FIELD_TO_PROFILE[field.fieldType];
      field.profilePath = path ? path.replace(/\[0\]/g, `[${field.index || 0}]`) : (field.profilePath || null);
    });
  }

  /**
   * The first heading/legend inside a container that comes before the element.
   */
  function headingOf(container, element) {
    const heading = container.querySelector(':scope > h2, :scope > h3, :scope > h4, :scope > legend, :scope > div > h2, :scope > div > h3, :scope > div > h4');
    if (!heading || heading.contains(element)) return '';
    // eslint-disable-next-line no-bitwise
    const before = heading.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING;
    return before ? heading.textContent : '';
  }

  // ─── Profile Value Resolution ──────────────────────────────────

  /**
   * Resolve a profile data path to an actual value.
   * Supports dot notation and array indices: "education[0].institution"
   *
   * @param {Object} profile - Full profile object
   * @param {string} path - Data path (e.g., "personal.email", "education[0].degree")
   * @returns {any} The resolved value, or undefined if not found
   */
  function resolveProfilePath(profile, path) {
    if (!profile || !path) return undefined;

    const parts = path.replace(/\[(\d+)\]/g, '.$1').split('.');
    let current = profile;

    for (const part of parts) {
      if (current === null || current === undefined) return undefined;

      // Numeric index for arrays
      if (/^\d+$/.test(part)) {
        current = current[parseInt(part, 10)];
      } else {
        current = current[part];
      }
    }

    return current;
  }

  /**
   * Get the profile value for a detected field (raw path lookup).
   * @param {Object} profile - Full profile object
   * @param {string} fieldType - Detected field type
   * @param {number} [arrayIndex=0] - Index for array fields (education, work experience)
   * @returns {any}
   */
  function getFieldValue(profile, fieldType, arrayIndex = 0) {
    let path = FIELD_TO_PROFILE[fieldType];
    if (!path) return undefined;

    // Replace [0] with actual array index
    path = path.replace(/\[0\]/g, `[${arrayIndex}]`);

    return resolveProfilePath(profile, path);
  }

  /** Entries with at least one filled field, in profile order. */
  function filledEntries(list, keys) {
    if (!Array.isArray(list)) return [];
    return list.filter(entry => entry && keys.some(k => {
      const v = entry[k];
      return Array.isArray(v) ? v.some(Boolean) : (v !== undefined && v !== null && String(v).trim() !== '');
    }));
  }

  function getWorkEntries(profile) {
    return filledEntries(profile && profile.workExperience, ['company', 'jobTitle']);
  }

  function getEducationEntries(profile) {
    return filledEntries(profile && profile.education, ['institution', 'degree', 'fieldOfStudy']);
  }

  /**
   * Total years of work experience, from the work history (overlapping jobs counted once).
   * @param {Object} profile
   * @returns {number} Whole years, rounded down; 0 when unknown
   */
  function totalExperienceYears(profile) {
    const now = new Date();
    const toMonths = (date) => date.year * 12 + ((date.month || 1) - 1);
    const order = dateOrderFor(profile);
    const ranges = getWorkEntries(profile).map(job => {
      const start = parseDate(job.startDate, order);
      if (!start || start.current || !start.year) return null;
      const end = job.isCurrent ? null : parseDate(job.endDate, order);
      const endMonths = end && end.year && !end.current ? toMonths(end) : now.getFullYear() * 12 + now.getMonth();
      return [toMonths(start), endMonths];
    }).filter(r => r && r[1] > r[0]).sort((a, b) => a[0] - b[0]);

    let months = 0;
    let cursor = -Infinity;
    for (const [start, end] of ranges) {
      const from = Math.max(start, cursor);
      if (end > from) months += end - from;
      cursor = Math.max(cursor, end);
    }
    return Math.floor(months / 12);
  }

  /**
   * All website URLs in the profile (portfolio + websites list), de-duplicated.
   */
  function getWebsites(profile) {
    if (!profile) return [];
    const p = profile.personal || {};
    const all = [
      ...(Array.isArray(p.websites) ? p.websites : []),
      ...(Array.isArray(profile.websites) ? profile.websites : []),
      p.portfolio
    ].map(u => (typeof u === 'object' && u ? u.url : u))
      .filter(u => typeof u === 'string' && u.trim())
      .map(u => u.trim());
    return [...new Set(all)];
  }

  /**
   * Resolve the value to fill for a field type, including derived values
   * (full name, current-job end date, description bullets, …).
   *
   * @param {Object} profile
   * @param {string} fieldType
   * @param {number} [index=0] - Entry index for repeating sections
   * @returns {any} undefined when the profile has nothing for this field
   */
  function resolveFieldValue(profile, fieldType, index = 0) {
    if (!profile) return undefined;
    const p = profile.personal || {};
    const app = profile.application || {};
    const i = index || 0;

    switch (fieldType) {
      case 'todayDate': {
        const today = new Date();
        return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
      }
      case 'fullName':
        return p.fullName || [p.firstName, p.middleName, p.lastName].filter(Boolean).join(' ') || undefined;
      case 'preferredName':
        return p.preferredName || p.firstName;
      case 'website':
        return getWebsites(profile)[i];
      case 'portfolio':
        return getWebsites(profile)[0];
      case 'referralSource':
        return app.referralSource;
      case 'previouslyEmployed':
        return app.previouslyEmployed;
      case 'skills':
        return Array.isArray(profile.skills) && profile.skills.length ? profile.skills : undefined;
    }

    if (SECTION_OF_FIELD[fieldType] === 'work') {
      const work = getWorkEntries(profile)[i];
      if (!work) return undefined;
      switch (fieldType) {
        case 'company': return work.company;
        case 'jobTitle': return work.jobTitle;
        case 'workLocation': return work.location;
        case 'isCurrent': return !!work.isCurrent;
        case 'workStartDate': return isoDate(work.startDate, profile);
        case 'workEndDate': return work.isCurrent ? undefined : isoDate(work.endDate, profile);
        case 'workBullets': {
          const bullets = (Array.isArray(work.bullets) ? work.bullets : [work.bullets]).filter(Boolean);
          return bullets.length ? bullets.join('\n') : work.description;
        }
      }
    }

    if (SECTION_OF_FIELD[fieldType] === 'education') {
      const edu = getEducationEntries(profile)[i];
      if (!edu) return undefined;
      switch (fieldType) {
        case 'institution': return edu.institution;
        case 'degree': return edu.degree;
        case 'fieldOfStudy': return edu.fieldOfStudy;
        case 'gpa': return edu.gpa;
        case 'eduStartYear': return isoDate(edu.startYear, profile);
        case 'eduEndYear': return isoDate(edu.endYear, profile);
        case 'eduEndMonth': {
          // Only known when the end is written with its month ("05/2026", "May 2026")
          const date = parseDate(edu.endYear, dateOrderFor(profile));
          return date && date.month ? MONTH_NAMES[date.month - 1] : undefined;
        }
        case 'eduLocation': return edu.location;
      }
    }

    const path = FIELD_TO_PROFILE[fieldType];
    return path ? resolveProfilePath(profile, path) : undefined;
  }

  // ─── Aliases ───────────────────────────────────────────────────

  /**
   * Candidate option texts for a profile value, best first. Used when matching dropdown options.
   * @param {string} fieldType
   * @param {any} value
   * @returns {string[]}
   */
  function getValueAliases(fieldType, value) {
    if (value === undefined || value === null) return [];
    if (typeof value === 'boolean') return value ? ['Yes', 'True'] : ['No', 'False'];

    const str = String(value).trim();
    const lower = str.toLowerCase();
    const out = [str];
    const addFrom = (table) => table.forEach(({ test, aliases }) => { if (test.test(str)) out.push(...aliases); });

    switch (fieldType) {
      case 'country': {
        const key = COUNTRY_SHORTHANDS[lower] || lower;
        if (COUNTRY_ALIASES[key]) out.push(...COUNTRY_ALIASES[key]);
        break;
      }
      case 'state': {
        const upper = str.toUpperCase();
        if (REGION_NAMES[upper]) out.push(REGION_NAMES[upper]);
        const abbr = Object.keys(REGION_NAMES).find(k => REGION_NAMES[k].toLowerCase() === lower);
        if (abbr) out.push(abbr);
        break;
      }
      case 'degree':
        addFrom(DEGREE_ALIASES);
        break;
      case 'phoneType':
        addFrom(PHONE_TYPE_ALIASES);
        break;
      case 'referralSource':
        addFrom(SOURCE_ALIASES);
        break;
      case 'previouslyEmployed':
      case 'isCurrent':
        if (/^(y|yes|true)$/i.test(str)) out.push('Yes', 'True');
        if (/^(n|no|false)$/i.test(str)) out.push('No', 'False');
        break;
      case 'eduStartYear':
      case 'eduEndYear': {
        // A year list only has the year ("2026"), even when the profile has "05/2026"
        const date = parseDate(str);
        if (date && date.year) out.unshift(String(date.year));
        break;
      }
      case 'eduEndMonth': {
        const month = monthFromName(str) || (/^\d{1,2}$/.test(str) ? parseInt(str, 10) : null);
        if (month >= 1 && month <= 12) {
          out.push(MONTH_NAMES[month - 1], MONTH_NAMES[month - 1].slice(0, 3), String(month).padStart(2, '0'), String(month));
        }
        break;
      }
    }

    return [...new Set(out)];
  }

  // ─── Dates ─────────────────────────────────────────────────────

  const MONTH_NAMES = Object.freeze(['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']);

  const MONTHS = Object.freeze({
    jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12
  });

  function monthFromName(name) {
    return MONTHS[String(name).toLowerCase().slice(0, 4)] || MONTHS[String(name).toLowerCase().slice(0, 3)] || null;
  }

  /**
   * Parse the date formats people type into profiles.
   * "2022-01", "01/2022", "Jan 2022", "January 2022", "2022", "2022-01-15", "Present".
   *
   * @param {any} value
   * @returns {{ year?: number, month?: number, day?: number, current?: boolean }|null}
   */
  function parseDate(value, order = 'mdy') {
    if (value === undefined || value === null) return null;
    const str = String(value).trim();
    if (!str) return null;
    if (/^(present|current|now|ongoing|till\s+date|to\s+date)$/i.test(str)) return { current: true };

    let m;
    const build = (year, month, day) => {
      const out = { year: parseInt(year, 10) };
      if (month !== undefined && month !== null) out.month = parseInt(month, 10);
      if (day !== undefined && day !== null) out.day = parseInt(day, 10);
      if (out.year < 1900 || out.year > 2100) return null;
      if (out.month !== undefined && (out.month < 1 || out.month > 12)) return null;
      if (out.day !== undefined && (out.day < 1 || out.day > 31)) return null;
      return out;
    };

    if ((m = str.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/))) return build(m[1], m[2], m[3]);
    if ((m = str.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/))) {
      // 21-12-2020 can only be day-first and 12/21/2020 only month-first; 05-06-2020 follows the profile's country
      const first = parseInt(m[1], 10);
      const second = parseInt(m[2], 10);
      const dayFirst = first > 12 || (second <= 12 && order === 'dmy');
      return dayFirst ? build(m[3], m[2], m[1]) : build(m[3], m[1], m[2]);
    }
    if ((m = str.match(/^(\d{4})[-/.](\d{1,2})$/))) return build(m[1], m[2]);
    if ((m = str.match(/^(\d{1,2})[-/.](\d{4})$/))) return build(m[2], m[1]);
    if ((m = str.match(/^([a-z]{3,})\.?,?\s+(\d{4})$/i)) && monthFromName(m[1])) return build(m[2], monthFromName(m[1]));
    if ((m = str.match(/^(\d{1,2})\s+([a-z]{3,})\.?,?\s+(\d{4})$/i)) && monthFromName(m[2])) return build(m[3], monthFromName(m[2]), m[1]);
    if ((m = str.match(/^([a-z]{3,})\.?\s+(\d{1,2}),?\s+(\d{4})$/i)) && monthFromName(m[1])) return build(m[3], monthFromName(m[1]), m[2]);
    if ((m = str.match(/^(\d{4})$/))) return build(m[1]);

    return null;
  }

  // Countries that write the month first (05/06/2020 = May 6)
  const MONTH_FIRST_COUNTRIES = /^(us|usa|u\.s\.a?\.?|united states( of america)?|america|philippines|belize|palau|micronesia|marshall islands)$/i;

  /**
   * Which way round to read an ambiguous numeric date like 05/06/2020 for this person.
   * @param {Object} profile
   * @returns {'mdy'|'dmy'}
   */
  function dateOrderFor(profile) {
    const p = (profile && profile.personal) || {};
    const country = String(p.country || '').trim();
    if (country) return MONTH_FIRST_COUNTRIES.test(country) ? 'mdy' : 'dmy';
    const code = String(p.phoneCountryCode || p.phone || '').match(/^\s*\+\s*(\d{1,3})/);
    if (code) return code[1] === '1' || code[1] === '63' ? 'mdy' : 'dmy';
    return 'mdy';
  }

  /**
   * A profile date in an unambiguous form (2020-12-21, 2020-12 or 2020), read the way this
   * person writes dates. Anything unreadable ("Present", typos) comes back unchanged.
   * @param {string} value
   * @param {Object} profile
   * @returns {string}
   */
  function isoDate(value, profile) {
    const date = parseDate(value, dateOrderFor(profile));
    if (!date || date.current) return value;
    const pad = (n) => String(n).padStart(2, '0');
    if (date.month && date.day) return `${date.year}-${pad(date.month)}-${pad(date.day)}`;
    if (date.month) return `${date.year}-${pad(date.month)}`;
    return String(date.year);
  }

  // ─── Saved Answers ─────────────────────────────────────────────

  const ANSWER_STOP_WORDS = new Set([
    'the', 'a', 'an', 'are', 'you', 'do', 'does', 'is', 'of', 'to', 'in', 'for', 'your', 'have', 'has',
    'will', 'be', 'this', 'that', 'with', 'any', 'or', 'and', 'at', 'on', 'can', 'please', 'if', 'i', 'my'
  ]);

  function stem(word) {
    const stemmed = word.replace(/(ships?|izations?|isations?|ations?|ized|ised|izes|ises|ize|ise|ing|ed|es|s|e)$/, '');
    return stemmed.length >= 4 ? stemmed : word;
  }

  /**
   * Find the user's saved answer for a question label. Every significant word of the saved
   * question must appear in the label; the most specific saved question wins.
   *
   * @param {Object} profile
   * @param {string} labelText
   * @returns {{ question: string, answer: string }|null}
   */
  function findSavedAnswer(profile, labelText) {
    const answers = profile && Array.isArray(profile.answers) ? profile.answers : [];
    const label = normalizeText(labelText);
    if (!label || answers.length === 0) return null;

    let best = null;
    for (const entry of answers) {
      if (!entry || !entry.question || entry.answer === undefined || String(entry.answer).trim() === '') continue;
      const words = normalizeText(entry.question)
        .split(/[^a-z0-9']+/)
        .filter(w => w.length > 1 && !ANSWER_STOP_WORDS.has(w));
      if (words.length === 0) continue;

      const allPresent = words.every(w => new RegExp(`\\b${stem(w).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(label));
      if (allPresent && (!best || words.length > best.weight)) {
        best = { question: entry.question, answer: String(entry.answer).trim(), weight: words.length };
      }
    }

    return best ? { question: best.question, answer: best.answer } : null;
  }

  // ─── Page Scan (generic) ───────────────────────────────────────

  /**
   * Get all fillable fields on the current page.
   * @returns {Array<{ element: HTMLElement, fieldType: string, profilePath: string, inputType: string, confidence: string }>}
   */
  function scanPageFields() {
    const allInputs = document.querySelectorAll(
      'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"]):not([type="image"]):not([type="password"]), ' +
      'select, ' +
      'textarea, ' +
      '[contenteditable="true"], ' +
      '[role="combobox"], ' +
      '[role="listbox"]'
    );

    const results = [];

    allInputs.forEach(element => {
      // Skip hidden or disabled elements
      if (element.disabled || element.readOnly) return;
      if (!OriginFillDetector.isVisible(element)) return;

      const detection = detectFieldType(element);

      if (detection.fieldType) {
        results.push({
          element,
          fieldType: detection.fieldType,
          profilePath: detection.profilePath,
          inputType: detection.inputType,
          confidence: detection.confidence
        });
      }
    });

    OriginFillLogger.info(`Page scan: ${results.length} fillable fields detected`);
    return results;
  }

  // ─── Sensitive Question Detection ────────────────────────────

  /**
   * Check label/attribute text for sensitive application questions.
   * @param {string} text
   * @param {{ isTextarea?: boolean }} [options]
   * @returns {{ isSensitive: boolean, reason: string }}
   */
  function isSensitiveText(text, { isTextarea = false } = {}) {
    const combined = normalizeText(text);
    if (!combined) return { isSensitive: false, reason: '' };

    for (const rule of SENSITIVE_RULES) {
      if (rule.patterns.some(p => p.test(combined))) {
        return { isSensitive: true, reason: `${rule.reason} — requires your review` };
      }
    }

    if (isTextarea && OPEN_ENDED_PATTERN.test(combined)) {
      return { isSensitive: true, reason: 'Open-ended question — requires your review' };
    }

    return { isSensitive: false, reason: '' };
  }

  /**
   * Check if a field is a sensitive application question that should NOT be auto-filled.
   * Examples: work authorization, disability, veteran status, salary, criminal history.
   *
   * @param {HTMLElement} element
   * @param {string} [labelOverride] - Label already computed by the caller
   * @returns {{ isSensitive: boolean, reason: string }}
   */
  function isSensitiveField(element, labelOverride) {
    if (!element) return { isSensitive: false, reason: '' };

    const automationId = element.getAttribute('data-automation-id') || '';
    const parts = [
      labelOverride !== undefined ? labelOverride : OriginFillDetector.getInputLabel(element),
      element.placeholder,
      hintToWords(element.getAttribute('name')),
      hintToWords(element.id),
      element.getAttribute('aria-label'),
      hintToWords(automationId)
    ];

    // Check Workday explicitly-skipped sensitive fields
    const sensitiveAutomationIds = [
      'veteranstatus', 'disabilitystatus', 'ethnicitydropdown',
      'genderdropdown', 'racedropdown', 'hispanicorlatino'
    ];
    if (sensitiveAutomationIds.some(sid => automationId.toLowerCase().includes(sid))) {
      return { isSensitive: true, reason: 'Voluntary self-identification — requires your review' };
    }

    return isSensitiveText(parts.filter(Boolean).join(' | '), { isTextarea: element.tagName === 'TEXTAREA' });
  }

  // ─── Confidence Score Utilities ───────────────────────────────

  /**
   * Convert a string confidence level to a numeric score.
   * @param {string} confidenceString - 'exact', 'high', 'medium', 'low', 'none'
   * @returns {number} Score between 0.0 and 1.0
   */
  function getConfidenceScore(confidenceString) {
    return OriginFillConfidenceScores[confidenceString] || 0.0;
  }

  // ─── Public API ─────────────────────────────────────────────────
  return Object.freeze({
    detectFieldType,
    classifyText,
    getInputType,
    detectSectionContext,
    assignEntryIndexes,
    sectionFromText,
    resolveProfilePath,
    getFieldValue,
    resolveFieldValue,
    getWorkEntries,
    getEducationEntries,
    getWebsites,
    totalExperienceYears,
    firstClause,
    getValueAliases,
    dialCodeForCountry,
    parseDate,
    allowsOtherOption,
    dateOrderFor,
    isoDate,
    findSavedAnswer,
    scanPageFields,
    isSensitiveField,
    isSensitiveText,
    getConfidenceScore,
    hintToWords,
    FIELD_TO_PROFILE,
    SECTION_OF_FIELD,
    DETECTION_RULES
  });
})();
