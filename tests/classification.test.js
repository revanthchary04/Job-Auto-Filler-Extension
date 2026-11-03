loadContentScripts();

const classify = (label, options = {}) => OriginFillFieldMapper.classifyText({ label, ...options }).fieldType;

describe('OriginFillFieldMapper.classifyText', () => {
  it.each([
    ['First Name', 'firstName'],
    ['Given name', 'firstName'],
    ['Last Name*', 'lastName'],
    ['Surname', 'lastName'],
    ['Email Address', 'email'],
    ['Confirm Email', 'email'],
    ['Phone Number', 'phone'],
    ['Mobile', 'phone'],
    ['Phone Device Type', 'phoneType'],
    ['Country Phone Code', 'phoneCountryCode'],
    ['Phone Extension', 'phoneExtension'],
    ['Address Line 1', 'address'],
    ['Address Line 2', 'address2'],
    ['City', 'city'],
    ['State', 'state'],
    ['Postal Code', 'zipCode'],
    ['Country', 'country'],
    ['LinkedIn Profile URL', 'linkedIn'],
    ['GitHub', 'github'],
    ['Portfolio', 'website'],
    ['How Did You Hear About Us?', 'referralSource'],
    ['Have you previously worked for NVIDIA?', 'previouslyEmployed'],
    ['School or University', 'institution'],
    ['Degree', 'degree'],
    ['Field of Study', 'fieldOfStudy'],
    ['Overall Result (GPA)', 'gpa'],
    ['Job Title', 'jobTitle'],
    ['Company', 'company'],
    ['Preferred First Name', 'preferredName'],
    ['Legal First Name', 'firstName'],
    ['College Name', 'institution'],
    ['Name of the Institute', 'institution'],
    ['Course', 'degree'],
    ['Course Name', 'degree'],
    ['Branch', 'fieldOfStudy'],
    ['Stream', 'fieldOfStudy'],
    ['Course of Study', 'fieldOfStudy'],
    ['Primary Degree (current/most recent)', 'degree'],
    ['Secondary Degree', 'degree'],
    ['Degree Subject/Major (current/most recent)', 'fieldOfStudy'],
    ['University/School (current/most recent)', 'institution']
  ])('"%s" → %s', (label, expected) => {
    expect(classify(label)).toBe(expected);
  });

  it.each([
    'Tell us about yourself',         // used to match "tel" → phone
    'Ethnicity',                       // used to match "city"
    'Personal statement',              // used to match "state"
    'Emergency contact first name',
    'Reference phone number',
    'Desired start date',              // a date outside work/education
    'Location',                        // ambiguous without a section
    'Bank branch',
    // The box that goes with a list's "Other" is only filled when "Other" was picked
    'Other college name',
    'If others, please specify',
    'College name (if not listed)',
    'Other degree'
  ])('does not misread "%s"', (label) => {
    expect(classify(label)).toBeNull();
  });

  it('uses the section for ambiguous labels', () => {
    expect(classify('From', { section: 'work' })).toBe('workStartDate');
    expect(classify('To', { section: 'work' })).toBe('workEndDate');
    expect(classify('From', { section: 'education' })).toBe('eduStartYear');
    expect(classify('Location', { section: 'work' })).toBe('workLocation');
    expect(classify('Title', { section: 'work' })).toBe('jobTitle');
    expect(classify('Role Description', { section: 'work' })).toBe('workBullets');
  });

  it('only treats "currently work here" as a checkbox', () => {
    expect(classify('I currently work here', { section: 'work', control: 'checkbox' })).toBe('isCurrent');
    expect(classify('I currently work here', { section: 'work', control: 'text' })).toBeNull();
  });

  it('falls back to attribute hints with medium confidence', () => {
    const result = OriginFillFieldMapper.classifyText({ label: '', hints: ['legalNameSection_lastName'] });
    expect(result).toEqual({ fieldType: 'lastName', confidence: 'medium' });
  });

  it('ignores long question labels for data fields', () => {
    expect(classify('If you have worked in a city other than your current city in the past five years, please list it here')).toBeNull();
  });
});

describe('OriginFillFieldMapper.isSensitiveText', () => {
  it.each([
    'Are you legally authorized to work in the United States?',
    'Will you now or in the future require sponsorship for employment visa status?',
    'Gender',
    'Are you a protected veteran?',
    'What are your salary expectations?',
    'I agree to the terms and conditions'
  ])('flags "%s"', (text) => {
    expect(OriginFillFieldMapper.isSensitiveText(text).isSensitive).toBe(true);
  });

  it.each(['Language', 'First Name', 'Role Description', 'Average'])('does not flag "%s"', (text) => {
    expect(OriginFillFieldMapper.isSensitiveText(text, { isTextarea: true }).isSensitive).toBe(false);
  });
});

describe('OriginFillFieldMapper.parseDate', () => {
  it.each([
    ['2022-01', { year: 2022, month: 1 }],
    ['01/2022', { year: 2022, month: 1 }],
    ['Jan 2022', { year: 2022, month: 1 }],
    ['September 2019', { year: 2019, month: 9 }],
    ['2020', { year: 2020 }],
    ['2021-03-15', { year: 2021, month: 3, day: 15 }],
    ['3/15/2021', { year: 2021, month: 3, day: 15 }],
    ['Present', { current: true }]
  ])('%s', (input, expected) => {
    expect(OriginFillFieldMapper.parseDate(input)).toEqual(expected);
  });

  it('rejects nonsense', () => {
    expect(OriginFillFieldMapper.parseDate('13/2020')).toBeNull();
    expect(OriginFillFieldMapper.parseDate('soon')).toBeNull();
    expect(OriginFillFieldMapper.parseDate('31-31-2020')).toBeNull();
  });

  it('reads day-first dates that can only be day-first', () => {
    expect(OriginFillFieldMapper.parseDate('21-12-2020')).toEqual({ year: 2020, month: 12, day: 21 });
    expect(OriginFillFieldMapper.parseDate('21/12/2020')).toEqual({ year: 2020, month: 12, day: 21 });
    expect(OriginFillFieldMapper.parseDate('21.12.2020')).toEqual({ year: 2020, month: 12, day: 21 });
  });

  it('reads ambiguous dates the way the person writes them', () => {
    expect(OriginFillFieldMapper.parseDate('05-06-2020', 'dmy')).toEqual({ year: 2020, month: 6, day: 5 });
    expect(OriginFillFieldMapper.parseDate('05-06-2020', 'mdy')).toEqual({ year: 2020, month: 5, day: 6 });
    expect(OriginFillFieldMapper.parseDate('12/21/2020', 'dmy')).toEqual({ year: 2020, month: 12, day: 21 });
  });
});

describe('OriginFillFieldMapper date order', () => {
  const profile = (personal) => ({ personal });

  it('follows the country, then the phone code', () => {
    expect(OriginFillFieldMapper.dateOrderFor(profile({ country: 'India' }))).toBe('dmy');
    expect(OriginFillFieldMapper.dateOrderFor(profile({ country: 'United States of America' }))).toBe('mdy');
    expect(OriginFillFieldMapper.dateOrderFor(profile({ country: 'USA' }))).toBe('mdy');
    expect(OriginFillFieldMapper.dateOrderFor(profile({ phoneCountryCode: '+91' }))).toBe('dmy');
    expect(OriginFillFieldMapper.dateOrderFor(profile({ phone: '+1 555 123 4567' }))).toBe('mdy');
    expect(OriginFillFieldMapper.dateOrderFor(profile({}))).toBe('mdy');
  });

  it('gives forms an unambiguous date', () => {
    const india = profile({ country: 'India' });
    expect(OriginFillFieldMapper.isoDate('21-12-2020', india)).toBe('2020-12-21');
    expect(OriginFillFieldMapper.isoDate('05-06-2022', india)).toBe('2022-06-05');
    expect(OriginFillFieldMapper.isoDate('Dec 2020', india)).toBe('2020-12');
    expect(OriginFillFieldMapper.isoDate('2019', india)).toBe('2019');
    expect(OriginFillFieldMapper.isoDate('Present', india)).toBe('Present');
    expect(OriginFillFieldMapper.isoDate('', india)).toBe('');
  });

  it('resolves work dates the way the person wrote them', () => {
    const india = {
      personal: { country: 'India' },
      workExperience: [{ company: 'Numpy', jobTitle: 'Engineer', startDate: '21-12-2020', endDate: '05-06-2022' }]
    };
    expect(OriginFillFieldMapper.resolveFieldValue(india, 'workStartDate', 0)).toBe('2020-12-21');
    expect(OriginFillFieldMapper.resolveFieldValue(india, 'workEndDate', 0)).toBe('2022-06-05');
    expect(OriginFillFieldMapper.totalExperienceYears(india)).toBe(1);
  });
});

describe('OriginFillFieldMapper.getValueAliases', () => {
  it('expands countries, states, degrees and phone types', () => {
    expect(OriginFillFieldMapper.getValueAliases('country', 'USA')).toContain('United States of America');
    expect(OriginFillFieldMapper.getValueAliases('state', 'CA')).toContain('California');
    expect(OriginFillFieldMapper.getValueAliases('state', 'California')).toContain('CA');
    expect(OriginFillFieldMapper.getValueAliases('degree', "Bachelor's")).toContain("Bachelor's Degree");
    expect(OriginFillFieldMapper.getValueAliases('degree', 'B.Tech')).toContain('Bachelor of Technology');
    expect(OriginFillFieldMapper.getValueAliases('phoneType', 'Mobile')).toContain('Cell');
    expect(OriginFillFieldMapper.getValueAliases('previouslyEmployed', false)).toEqual(['No', 'False']);
  });
});

describe('OriginFillFieldMapper.findSavedAnswer', () => {
  const profile = {
    answers: [
      { question: 'authorized to work', answer: 'Yes' },
      { question: 'require sponsorship', answer: 'No' },
      { question: 'sponsorship', answer: 'Maybe' },
      { question: 'veteran', answer: '' }
    ]
  };

  it('matches when every word of the saved question appears', () => {
    expect(OriginFillFieldMapper.findSavedAnswer(profile, 'Are you legally authorized to work in the US?').answer).toBe('Yes');
  });

  it('prefers the most specific saved question', () => {
    expect(OriginFillFieldMapper.findSavedAnswer(profile, 'Will you require sponsorship now or in the future?').answer).toBe('No');
  });

  it('ignores empty answers and unrelated questions', () => {
    expect(OriginFillFieldMapper.findSavedAnswer(profile, 'Are you a protected veteran?')).toBeNull();
    expect(OriginFillFieldMapper.findSavedAnswer(profile, 'First Name')).toBeNull();
  });
});

describe('OriginFillFieldMapper.resolveFieldValue', () => {
  const profile = {
    personal: { firstName: 'Ada', lastName: 'Lovelace', websites: ['https://ada.dev'], portfolio: 'https://ada.dev' },
    application: { previouslyEmployed: 'No' },
    workExperience: [
      { company: '', jobTitle: '' },
      { company: 'Analytical Engines', jobTitle: 'Engineer', isCurrent: true, endDate: '2020-01', bullets: ['Built things', 'Shipped them'] }
    ],
    education: [{ institution: 'University of London', degree: "Master's", endYear: '2015' }],
    skills: ['Math', 'Programming']
  };

  it('derives the full name', () => {
    expect(OriginFillFieldMapper.resolveFieldValue(profile, 'fullName')).toBe('Ada Lovelace');
  });

  it('skips empty entries so indexes line up with the form', () => {
    expect(OriginFillFieldMapper.resolveFieldValue(profile, 'company', 0)).toBe('Analytical Engines');
    expect(OriginFillFieldMapper.resolveFieldValue(profile, 'company', 1)).toBeUndefined();
  });

  it('has no end date for a current job and joins bullets', () => {
    expect(OriginFillFieldMapper.resolveFieldValue(profile, 'workEndDate', 0)).toBeUndefined();
    expect(OriginFillFieldMapper.resolveFieldValue(profile, 'isCurrent', 0)).toBe(true);
    expect(OriginFillFieldMapper.resolveFieldValue(profile, 'workBullets', 0)).toBe('Built things\nShipped them');
  });

  it('de-duplicates websites and reads application answers', () => {
    expect(OriginFillFieldMapper.getWebsites(profile)).toEqual(['https://ada.dev']);
    expect(OriginFillFieldMapper.resolveFieldValue(profile, 'previouslyEmployed')).toBe('No');
    expect(OriginFillFieldMapper.resolveFieldValue(profile, 'skills')).toEqual(['Math', 'Programming']);
  });
});

describe('OriginFillFuzzyMatch.pickOption', () => {
  const options = (texts) => texts.map(text => ({ el: text, text }));

  it('prefers the closest country over longer names', () => {
    const match = OriginFillFuzzyMatch.pickOption(
      options(['United States Minor Outlying Islands', 'United States of America', 'United Kingdom']),
      ['United States']
    );
    expect(match.text).toBe('United States of America');
  });

  it('lets an exact alias win over a fuzzy match on the original value', () => {
    const match = OriginFillFuzzyMatch.pickOption(
      options(["Associate's Degree", "Bachelor's Degree", "Master's Degree"]),
      OriginFillFieldMapper.getValueAliases('degree', "Bachelor's")
    );
    expect(match.text).toBe("Bachelor's Degree");
  });

  it('never falls back to "Other"', () => {
    expect(OriginFillFuzzyMatch.pickOption(options(['Engineer', 'Other']), ['Astronaut'])).toBeNull();
  });

  it('matches Yes/No answers inside longer options', () => {
    const match = OriginFillFuzzyMatch.pickOption(options(['Yes, I am authorized', 'No, I am not authorized']), ['No']);
    expect(match.text).toBe('No, I am not authorized');
  });
});

describe('OriginFillFiller snapshots', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <label for="e">Email</label><input id="e" value="ada@example.com">
      <label for="p">Password</label><input id="p" type="password" value="hunter2">
      <label for="c">City</label><input id="input-77" value="London">
      <input type="file" id="f">`;
    // The detector mock reads labels by id
    document.querySelector('#input-77').id = 'input-77';
  });

  it('never captures passwords or files', () => {
    const snapshot = OriginFillFiller.captureFieldSnapshot();
    const values = Object.values(snapshot).map(e => e.value);
    expect(values).toContain('ada@example.com');
    expect(values).not.toContain('hunter2');
    expect(Object.keys(snapshot).some(k => k.includes('f'))).toBe(false);
  });

  it('ignores generated Workday ids when keying fields', () => {
    const snapshot = OriginFillFiller.captureFieldSnapshot();
    expect(Object.keys(snapshot).some(k => k.includes('input-77'))).toBe(false);
  });
});

describe('OriginFillFiller.valueMatches', () => {
  it('compares dates, phones, aliases and lists', () => {
    expect(OriginFillFiller.valueMatches('1/2022', '2022-01', { control: 'date', fieldType: 'workStartDate' })).toBe(true);
    expect(OriginFillFiller.valueMatches('(555) 123-4567', '+1 555 123 4567', { fieldType: 'phone' })).toBe(true);
    expect(OriginFillFiller.valueMatches('United States of America', 'USA', { fieldType: 'country' })).toBe(true);
    expect(OriginFillFiller.valueMatches(['JavaScript'], ['Java'], { control: 'prompt', fieldType: 'skills' })).toBe(false);
  });
});

describe('OriginFillFieldMapper.dialCodeForCountry', () => {
  it('knows common countries and short names', () => {
    expect(OriginFillFieldMapper.dialCodeForCountry('India')).toBe('91');
    expect(OriginFillFieldMapper.dialCodeForCountry('USA')).toBe('1');
    expect(OriginFillFieldMapper.dialCodeForCountry('UK')).toBe('44');
    expect(OriginFillFieldMapper.dialCodeForCountry('Atlantis')).toBe('');
  });
});

describe('"Other" / "Not listed" for colleges and courses', () => {
  const options = (texts) => texts.map(text => ({ el: text, text }));

  it('finds the list\'s "not listed" choice', () => {
    expect(OriginFillFuzzyMatch.pickOtherOption(options(['IIT Bombay', 'Others', 'BITS Pilani'])).text).toBe('Others');
    expect(OriginFillFuzzyMatch.pickOtherOption(options(['IIT Bombay', 'My college is not listed'])).text).toBe('My college is not listed');
    expect(OriginFillFuzzyMatch.pickOtherOption(options(['Other University', 'Other (please specify)'])).text).toBe('Other (please specify)');
    expect(OriginFillFuzzyMatch.pickOtherOption(options(['Stanford', 'None of the above'])).text).toBe('None of the above');
  });

  it('never treats "None", "N/A" or a real name as "Other"', () => {
    expect(OriginFillFuzzyMatch.pickOtherOption(options(['None', 'N/A', 'Not Applicable', 'Otterbein University']))).toBeNull();
  });

  it('only for colleges, courses and "how did you hear"', () => {
    expect(['institution', 'degree', 'fieldOfStudy', 'referralSource'].every(OriginFillFieldMapper.allowsOtherOption)).toBe(true);
    expect(['gender', 'country', 'state', 'skills', 'city'].some(OriginFillFieldMapper.allowsOtherOption)).toBe(false);
  });

  it('picks "Others" in a <select> only when asked to', async () => {
    document.body.innerHTML = `<select id="c"><option value="">Select</option><option value="iitb">IIT Bombay</option><option value="others">Others</option></select>`;
    const select = document.getElementById('c');
    const plain = await OriginFillDom.selectNativeOption(select, ['Vasavi College of Engineering']);
    expect(plain.success).toBe(false);
    expect(select.value).toBe('');

    const withOther = await OriginFillDom.selectNativeOption(select, ['Vasavi College of Engineering'], { allowOther: true });
    expect(withOther).toEqual({ success: true, usedOther: true, note: '"Vasavi College of Engineering" isn\'t in the list — chose "Others"' });
    expect(select.value).toBe('others');

    const listed = await OriginFillDom.selectNativeOption(select, ['IIT Bombay'], { allowOther: true });
    expect(listed.usedOther).toBeUndefined();
    expect(select.value).toBe('iitb');
  });
});

describe('Graduation month and year', () => {
  const classify = (label) => OriginFillFieldMapper.classifyText({ label }).fieldType;
  const profile = {
    personal: { country: 'India' },
    education: [
      { institution: 'Vaageshwari College of Engineering', degree: 'B.Tech', endYear: '05/2026' },
      { institution: 'Narayana Junior College', degree: 'Intermediate', endYear: '2020' }
    ]
  };

  it('tells the month from the year', () => {
    expect(classify('Month of Graduation')).toBe('eduEndMonth');
    expect(classify('Graduation Month')).toBe('eduEndMonth');
    expect(classify('Year of Graduation')).toBe('eduEndYear');
    expect(classify('Year of Passing')).toBe('eduEndYear');
    expect(classify('Passed out year')).toBe('eduEndYear');
  });

  it('reads the month from "05/2026"', () => {
    expect(OriginFillFieldMapper.resolveFieldValue(profile, 'eduEndMonth', 0)).toBe('May');
    expect(OriginFillFieldMapper.resolveFieldValue(profile, 'eduEndMonth', 1)).toBeUndefined();
    expect(OriginFillFieldMapper.getValueAliases('eduEndMonth', 'May')).toEqual(expect.arrayContaining(['May', '05', '5']));
  });

  it('offers just the year to a year list', () => {
    expect(OriginFillFieldMapper.getValueAliases('eduEndYear', '2026-05')[0]).toBe('2026');
  });

  it('puts the month and year of a flat questionnaire on the same (most recent) degree', () => {
    document.body.innerHTML = `
      <label for="m">Month of Graduation</label><select id="m"><option>May</option></select>
      <label for="y">Year of Graduation</label><select id="y"><option>2026</option></select>`;
    const fields = OriginFillGeneric.getFields({ profile });
    expect(fields.map(f => [f.fieldType, f.index || 0])).toEqual([['eduEndMonth', 0], ['eduEndYear', 0]]);
  });
});

describe('Indian degree names', () => {
  const aliases = (value) => OriginFillFieldMapper.getValueAliases('degree', value);

  it('knows what lists call them', () => {
    expect(aliases('B.Tech')).toEqual(expect.arrayContaining(['Bachelor of Technology', 'B.Tech/B.E.', "Bachelor's Degree", 'Graduation']));
    expect(aliases('M.Tech')).toEqual(expect.arrayContaining(['Master of Technology', 'Post Graduation']));
    expect(aliases("Master's")).toEqual(expect.arrayContaining(['Post Graduation', 'PG', 'Masters']));
    expect(aliases('MCA')).toEqual(expect.arrayContaining(['Master of Computer Applications']));
    expect(aliases('Diploma')).toEqual(expect.arrayContaining(['Polytechnic Diploma']));
  });

  it('does not read B.Ed as B.E.', () => {
    expect(aliases('B.Ed')).not.toContain('Bachelor of Engineering');
  });

  it('picks the specific option first', () => {
    const options = ['B.Sc', 'B.Tech / B.E', 'M.Tech', 'MBA', 'Other'].map(text => ({ el: text, text }));
    expect(OriginFillFuzzyMatch.pickOption(options, aliases('B.Tech')).text).toBe('B.Tech / B.E');
  });
});

describe('OriginFillDom.sketch', () => {
  it('outlines markup without values or text', () => {
    document.body.innerHTML = `<div class="controls"><select name="answers[1]" class="select2-hidden-accessible" aria-hidden="true">
      <option value="7" selected>Vaageshwari College</option></select>
      <span class="select2 select2-container"><span class="select2-selection" role="combobox" title="Vaageshwari College">Vaageshwari College</span></span></div>`;
    const out = OriginFillDom.sketch(document.querySelector('.controls'), 3);
    expect(out).toContain('select.select2-hidden-accessible');
    expect(out).toContain('span.select2-selection[role=combobox]');
    expect(out).not.toMatch(/Vaageshwari|=7/);
  });
});
