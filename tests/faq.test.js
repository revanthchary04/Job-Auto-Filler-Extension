const path = require('path');

loadContentScripts();
loadExtensionScript(path.join(__dirname, '../utils/faq.js'));

const idFor = (question, context) => (OriginFillFAQ.match(question, context) || {}).id || null;

describe('OriginFillFAQ.match', () => {
  it.each([
    ['Do you have a disability, either visible or invisible?', 'disability'],
    ['Have you suffered from any major illness/surgery/accident?', 'majorIllness'],
    ['Will you now or in the future require sponsorship for employment visa status?', 'requireSponsorship'],
    ['Are you legally authorized to work in the country where this job is located?', 'authorizedToWork'],
    ['Are you legally authorized to work in the United States without sponsorship?', 'authorizedWithoutSponsorship'],
    ['Are you at least 18 years of age?', 'over18'],
    ['What is your notice period?', 'noticePeriod'],
    ['When can you join?', 'noticePeriod'],
    ['Total years of experience', 'totalExperience'],
    ['Current CTC (in LPA)', 'currentSalary'],
    ['Expected CTC', 'expectedSalary'],
    ['Are you willing to relocate?', 'willingToRelocate'],
    ['Do you have any relatives working at the company?', 'relativesAtCompany'],
    ['Have you ever been convicted of a criminal offence?', 'criminalRecord'],
    ['Do you consent to a background verification?', 'backgroundCheck'],
    ['Do you require any accommodation for the interview due to a disability?', 'accommodation'],
    ['Veteran Status', 'veteran'],
    ['Gender', 'gender'],
    ['Nationality', 'citizenship'],
    ['I agree to the privacy notice', 'consent']
  ])('"%s" → %s', (question, expected) => {
    expect(idFor(question)).toBe(expected);
  });

  it.each([
    'First Name',
    'Country/Region of Residence',
    'Years of experience with Java',
    'Do you require relocation assistance?',
    'Passport number'
  ])('does not claim "%s"', (question) => {
    expect(idFor(question)).toBeNull();
  });

  it('uses the options when the question itself is generic', () => {
    const options = 'Please check one of the boxes below: Yes, I have a disability (or previously had a disability) No, I do not have a disability and have not had one in the past';
    expect(idFor('Please check one of the boxes below:', options)).toBe('disability');
  });
});

describe('OriginFillFAQ.find', () => {
  const profile = {
    faq: { disability: 'No', authorizedToWork: 'Yes', requireSponsorship: 'No' },
    workExperience: [
      { company: 'A', jobTitle: 'Engineer', startDate: '2018-01', endDate: '2020-01' },
      { company: 'B', jobTitle: 'Engineer', startDate: '2019-06', endDate: '2022-01' }
    ]
  };

  it('returns the answer with the wordings forms use', () => {
    const found = OriginFillFAQ.find(profile, 'Do you have a disability?');
    expect(found.answer).toBe('No');
    expect(found.candidates).toContain('No, I do not have a disability and have not had one in the past');
  });

  it('reports a common question the user has not answered yet', () => {
    const found = OriginFillFAQ.find(profile, 'Have you suffered from any major illness?');
    expect(found.entry.id).toBe('majorIllness');
    expect(found.answer).toBe('');
  });

  it('derives "authorized without sponsorship" from the two answers', () => {
    expect(OriginFillFAQ.find(profile, 'Are you authorized to work without sponsorship?').answer).toBe('Yes');
    const needsVisa = { faq: { authorizedToWork: 'Yes', requireSponsorship: 'Yes' } };
    expect(OriginFillFAQ.find(needsVisa, 'Are you authorized to work without sponsorship?').answer).toBe('No');
  });

  it('works out total experience from the work history (overlaps counted once)', () => {
    const found = OriginFillFAQ.find(profile, 'Total years of experience');
    expect(found.answer).toBe('4');
    expect(found.derived).toBe(true);
  });
});

describe('Answer wordings in dropdowns', () => {
  const options = (texts) => texts.map(text => ({ el: text, text }));

  it('picks the self-identification wording for "No"', () => {
    const { candidates } = OriginFillFAQ.find({ faq: { disability: 'No' } }, 'Disability');
    const match = OriginFillFuzzyMatch.pickOption(options([
      'Yes, I have a disability (or previously had a disability)',
      'No, I do not have a disability and have not had one in the past',
      'I do not want to answer'
    ]), candidates);
    expect(match.text).toBe('No, I do not have a disability and have not had one in the past');
  });

  it('puts a number of years into the right range', () => {
    const ranges = options(['Less than 1 year', '1-2 years', '3-5 years', '6 to 10 years', 'More than 10 years']);
    expect(OriginFillFuzzyMatch.pickOption(ranges, ['4']).text).toBe('3-5 years');
    expect(OriginFillFuzzyMatch.pickOption(ranges, ['4 years']).text).toBe('3-5 years');
    expect(OriginFillFuzzyMatch.pickOption(ranges, ['12']).text).toBe('More than 10 years');
    expect(OriginFillFuzzyMatch.pickOption(ranges, ['0']).text).toBe('Less than 1 year');
  });
});

describe('Long questions', () => {
  it('classifies on the first clause', () => {
    const classify = (label) => OriginFillFieldMapper.classifyText({ label }).fieldType;
    expect(classify('Country/Region of Residence - Please select the country where you currently live')).toBe('country');
    expect(classify('1. Country/Region of Residence')).toBe('country');
    expect(classify('Current Location')).toBe('city');
  });
});

describe('Preferred locations, in order', () => {
  const ask = (profile, question) => OriginFillFAQ.find(profile, question);
  const listed = { faq: { preferredLocation: 'Hyderabad, Pune; Chennai' }, personal: { city: 'Karimnagar' } };

  it('recognises office location preference questions', () => {
    expect(idFor('Office Location (City) First Preference')).toBe('preferredLocation');
    expect(idFor('Office Location (City) Additional Preferences')).toBe('preferredLocation');
    expect(idFor('Preferred work location')).toBe('preferredLocation');
  });

  it('gives each preference its place in the list', () => {
    expect(ask(listed, 'Office Location (City) First Preference').answer).toBe('Hyderabad');
    expect(ask(listed, 'Office Location (City) Second Preference').answer).toBe('Pune');
    expect(ask(listed, 'Office Location (City) Additional Preferences').answer).toBe('Chennai');
    expect(ask(listed, 'Preferred work locations').answer).toBe('Hyderabad, Pune, Chennai');
  });

  it('says when the list is too short', () => {
    const one = { faq: { preferredLocation: 'Hyderabad' } };
    const found = ask(one, 'Office Location (City) Second Preference');
    expect(found.answer).toBe('');
    expect(found.short).toBe(true);
  });

  it('suggests your own city as the first choice until you answer', () => {
    const unanswered = { faq: {}, personal: { city: 'Hyderabad' } };
    const first = ask(unanswered, 'Office Location (City) First Preference');
    expect([first.answer, first.derived]).toEqual(['Hyderabad', true]);
    const second = ask(unanswered, 'Office Location (City) Second Preference');
    expect([second.answer, second.short]).toEqual(['', false]);
  });

  it('is not mistaken for your home city', () => {
    expect(OriginFillFieldMapper.classifyText({ label: 'Office Location (City) First Preference' }).fieldType).toBeNull();
    expect(OriginFillFieldMapper.classifyText({ label: 'Current City' }).fieldType).toBe('city');
  });
});
