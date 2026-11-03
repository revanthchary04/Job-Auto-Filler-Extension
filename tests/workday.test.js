loadContentScripts();

const MY_INFORMATION = `
  <div data-automation-id="applyFlowPage">
    <ol data-automation-id="progressBar">
      <li data-automation-id="progressBarCompletedStep">step 1 of 6 Create Account/Sign In</li>
      <li data-automation-id="progressBarActiveStep">current step 2 of 6 My Information</li>
      <li data-automation-id="progressBarInactiveStep">step 3 of 6 My Experience</li>
    </ol>
    <div data-automation-id="formField-sourcePrompt">
      <label for="source--source">How Did You Hear About Us?<abbr>*</abbr></label>
      <div data-automation-id="multiSelectContainer" id="msc-source"><input data-uxi-widget-type="selectinput" id="source--source" placeholder="Search"></div>
    </div>
    <div data-automation-id="formField-candidateIsPreviousWorker">
      <fieldset>
        <legend>Have you previously worked for Acme?<abbr>*</abbr></legend>
        <input type="radio" id="pw-yes" name="candidateIsPreviousWorker" value="true"><label for="pw-yes">Yes</label>
        <input type="radio" id="pw-no" name="candidateIsPreviousWorker" value="false"><label for="pw-no">No</label>
      </fieldset>
    </div>
    <div data-automation-id="formField-country">
      <label for="country--country">Country<abbr>*</abbr></label>
      <button id="country--country" aria-haspopup="listbox">United States of America</button>
    </div>
    <div data-automation-id="formField-legalName--firstName">
      <label for="name--legalName--firstName">First Name<abbr>*</abbr></label>
      <input type="text" id="name--legalName--firstName" aria-required="true">
    </div>
    <div data-automation-id="formField-legalName--lastName">
      <label for="name--legalName--lastName">Last Name</label>
      <input type="text" id="name--legalName--lastName">
    </div>
    <div data-automation-id="formField-preferredCheck">
      <input type="checkbox" id="preferred"><label for="preferred">I have a preferred name</label>
    </div>
    <div data-automation-id="formField-addressLine1">
      <label for="address--addressLine1">Address Line 1</label><input type="text" id="address--addressLine1">
    </div>
    <div data-automation-id="formField-city">
      <label for="address--city">City</label><input type="text" id="address--city">
    </div>
    <div data-automation-id="formField-countryRegion">
      <label for="address--countryRegion">State</label>
      <button id="address--countryRegion" aria-haspopup="listbox">Select One</button>
    </div>
    <div data-automation-id="formField-postalCode">
      <label for="address--postalCode">Postal Code</label><input type="text" id="address--postalCode">
    </div>
    <div data-automation-id="formField-phoneType">
      <label for="phoneNumber--phoneType">Phone Device Type</label>
      <button id="phoneNumber--phoneType" aria-haspopup="listbox">Select One</button>
    </div>
    <div data-automation-id="formField-countryPhoneCode">
      <label for="phoneNumber--countryPhoneCode">Country Phone Code</label>
      <div data-automation-id="multiSelectContainer"><input id="phoneNumber--countryPhoneCode"></div>
    </div>
    <div data-automation-id="formField-phoneNumber">
      <label for="phoneNumber--phoneNumber">Phone Number</label><input type="text" id="phoneNumber--phoneNumber">
    </div>
    <div data-automation-id="formField-extension">
      <label for="phoneNumber--extension">Phone Extension</label><input type="text" id="phoneNumber--extension">
    </div>
  </div>
`;

const MY_EXPERIENCE = `
  <div data-automation-id="applyFlowPage">
    <div role="group" aria-labelledby="work-heading">
      <h3 id="work-heading">Work Experience</h3>
      <div data-automation-id="workExperience-1" role="group" aria-labelledby="work-1">
        <h4 id="work-1">Work Experience 1</h4>
        <div data-automation-id="formField-jobTitle"><label for="input-1">Job Title<abbr>*</abbr></label><input type="text" id="input-1"></div>
        <div data-automation-id="formField-companyName"><label for="input-2">Company</label><input type="text" id="input-2"></div>
        <div data-automation-id="formField-location"><label for="input-3">Location</label><input type="text" id="input-3"></div>
        <div data-automation-id="formField-currentlyWorkHere"><input type="checkbox" id="input-4"><label for="input-4">I currently work here</label></div>
        <div data-automation-id="formField-startDate">
          <label>From</label>
          <div data-automation-id="dateInputWrapper">
            <input aria-label="Month" data-automation-id="dateSectionMonth-input" role="spinbutton">
            <input aria-label="Year" data-automation-id="dateSectionYear-input" role="spinbutton">
          </div>
        </div>
        <div data-automation-id="formField-roleDescription"><label for="input-5">Role Description</label><textarea id="input-5"></textarea></div>
      </div>
      <div data-automation-id="workExperience-2" role="group" aria-labelledby="work-2">
        <h4 id="work-2">Work Experience 2</h4>
        <div data-automation-id="formField-jobTitle"><label for="input-6">Job Title</label><input type="text" id="input-6"></div>
        <div data-automation-id="formField-companyName"><label for="input-7">Company</label><input type="text" id="input-7"></div>
      </div>
      <button data-automation-id="add-button">Add Another</button>
    </div>

    <div role="group" aria-labelledby="edu-heading">
      <h3 id="edu-heading">Education</h3>
      <div role="group" aria-labelledby="edu-1">
        <h4 id="edu-1">Education 1</h4>
        <div data-automation-id="formField-schoolItem"><label for="input-8">School or University</label>
          <div data-automation-id="multiSelectContainer"><input id="input-8" data-uxi-widget-type="selectinput"></div></div>
        <div data-automation-id="formField-degree"><label for="input-9">Degree</label><button id="input-9" aria-haspopup="listbox">Select One</button></div>
        <div data-automation-id="formField-gradeAverage"><label for="input-10">Overall Result (GPA)</label><input type="text" id="input-10"></div>
        <div data-automation-id="formField-firstYearAttended"><label>From</label>
          <div data-automation-id="dateInputWrapper"><input aria-label="Year" data-automation-id="dateSectionYear-input"></div></div>
      </div>
      <button data-automation-id="add-button">Add</button>
    </div>

    <div role="group" aria-labelledby="web-heading">
      <h3 id="web-heading">Websites</h3>
      <button data-automation-id="add-button">Add</button>
    </div>

    <div data-automation-id="formField-skills"><label for="skills--skills">Type to Add Skills</label>
      <div data-automation-id="multiSelectContainer"><input id="skills--skills"></div></div>
    <div data-automation-id="formField-linkedInAccount"><label for="input-11">LinkedIn</label><input type="text" id="input-11"></div>
    <div data-automation-id="resumeSection">
      <h3>Resume/CV</h3>
      <div data-automation-id="file-upload-drop-zone"><input type="file" data-automation-id="file-upload-input-ref"></div>
    </div>
  </div>
`;

const byType = (fields, type) => fields.filter(f => f.fieldType === type);

describe('OriginFillWorkday', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  describe('getFields — My Information (current Workday markup)', () => {
    let fields;
    beforeEach(() => {
      document.body.innerHTML = MY_INFORMATION;
      fields = OriginFillWorkday.getFields();
    });

    it('maps each wrapper to the right field type and widget', () => {
      const summary = Object.fromEntries(fields.filter(f => f.fieldType).map(f => [f.fieldType, f.control]));
      expect(summary).toEqual({
        referralSource: 'prompt',
        previouslyEmployed: 'radio',
        country: 'dropdown',
        firstName: 'text',
        lastName: 'text',
        address: 'text',
        city: 'text',
        state: 'dropdown',
        zipCode: 'text',
        phoneType: 'dropdown',
        phoneCountryCode: 'prompt',
        phone: 'text'
      });
    });

    it('reads the question of a radio group from its legend', () => {
      const [radio] = byType(fields, 'previouslyEmployed');
      expect(radio.label).toBe('Have you previously worked for Acme?');
      expect(radio.parts.radios).toHaveLength(2);
      expect(radio.required).toBe(true);
    });

    it('treats "countryRegion" as the state, not the country', () => {
      expect(byType(fields, 'state')[0].element.id).toBe('address--countryRegion');
    });

    it('leaves the phone extension and preferred-name checkbox alone', () => {
      expect(fields.some(f => f.element.id === 'phoneNumber--extension')).toBe(false);
      const preferred = fields.find(f => f.element.id === 'preferred');
      expect(preferred ? preferred.fieldType : null).toBeNull();
    });

    it('marks required fields', () => {
      expect(byType(fields, 'firstName')[0].required).toBe(true);
      expect(byType(fields, 'lastName')[0].required).toBe(false);
    });

    it('reads the current step from the progress bar', () => {
      expect(OriginFillDetector.getWorkdayStep()).toEqual({ pageName: 'My Information', pageNumber: 2, totalPages: 6 });
    });
  });

  describe('getFields — My Experience', () => {
    let fields;
    beforeEach(() => {
      document.body.innerHTML = MY_EXPERIENCE;
      fields = OriginFillWorkday.getFields();
    });

    it('assigns work entries by their panel number', () => {
      expect(byType(fields, 'jobTitle').map(f => f.index)).toEqual([0, 1]);
      expect(byType(fields, 'company').map(f => f.profilePath)).toEqual([
        'workExperience[0].company',
        'workExperience[1].company'
      ]);
    });

    it('uses the section to tell work dates from education years', () => {
      expect(byType(fields, 'workStartDate')).toHaveLength(1);
      expect(byType(fields, 'workStartDate')[0].control).toBe('date');
      expect(byType(fields, 'eduStartYear')).toHaveLength(1);
      expect(byType(fields, 'workLocation')).toHaveLength(1);
    });

    it('finds the education entry from its heading', () => {
      const [school] = byType(fields, 'institution');
      expect(school.control).toBe('prompt');
      expect(school.section).toBe('education');
      expect(byType(fields, 'gpa')[0].index).toBe(0);
      expect(byType(fields, 'degree')[0].control).toBe('dropdown');
    });

    it('recognises description, checkbox, skills, LinkedIn and résumé fields', () => {
      expect(byType(fields, 'workBullets')[0].control).toBe('textarea');
      expect(byType(fields, 'isCurrent')[0].control).toBe('checkbox');
      expect(byType(fields, 'skills')[0].control).toBe('prompt');
      expect(byType(fields, 'linkedIn')).toHaveLength(1);
      expect(byType(fields, 'resume')[0].control).toBe('file');
    });

    it('finds each section\'s Add button and counts its entries', () => {
      const work = OriginFillWorkday.findSectionContainer('work');
      const education = OriginFillWorkday.findSectionContainer('education');
      const websites = OriginFillWorkday.findSectionContainer('website');
      expect(OriginFillWorkday.countEntries(work, 'work')).toBe(2);
      expect(OriginFillWorkday.countEntries(education, 'education')).toBe(1);
      expect(OriginFillWorkday.countEntries(websites, 'website')).toBe(0);
      expect(OriginFillWorkday.findAddButton(work).textContent).toBe('Add Another');
      expect(OriginFillWorkday.findAddButton(education)).not.toBe(OriginFillWorkday.findAddButton(work));
    });
  });

  describe('entry positions', () => {
    it('uses page order, not Workday\'s internal entry counters', () => {
      document.body.innerHTML = `
        <div data-automation-id="workExperienceSection">
          <div data-automation-id="workExperience-26">
            <div data-automation-id="formField-jobTitle"><label for="workExperience-26--jobTitle">Job Title</label><input type="text" id="workExperience-26--jobTitle"></div>
            <div data-automation-id="formField-companyName"><label for="input-3">Company</label><input type="text" id="input-3"></div>
          </div>
          <div data-automation-id="workExperience-31">
            <div data-automation-id="formField-jobTitle"><label for="workExperience-31--jobTitle">Job Title</label><input type="text" id="workExperience-31--jobTitle"></div>
            <div data-automation-id="formField-companyName"><label for="input-9">Company</label><input type="text" id="input-9"></div>
          </div>
        </div>`;
      const fields = OriginFillWorkday.getFields();
      expect(byType(fields, 'jobTitle').map(f => f.index)).toEqual([0, 1]);
      expect(byType(fields, 'company').map(f => f.profilePath)).toEqual(['workExperience[0].company', 'workExperience[1].company']);
    });
  });

  describe('getFields — older tenants (automation ids on inputs)', () => {
    it('maps legacy automation ids without formField wrappers', () => {
      document.body.innerHTML = `
        <div data-automation-id="legalNameSection">
          <label for="a">First Name</label><input type="text" id="a" data-automation-id="legalNameSection_firstName">
          <label for="b">City</label><input type="text" id="b" data-automation-id="addressSection_city">
          <button data-automation-id="addressSection_countryRegion" aria-haspopup="listbox">Select One</button>
          <button data-automation-id="phone-device-type" aria-haspopup="listbox">Select One</button>
        </div>`;
      const fields = OriginFillWorkday.getFields();
      expect(fields.map(f => f.fieldType)).toEqual(['firstName', 'city', 'state', 'phoneType']);
    });
  });

  describe('questions without a <label>', () => {
    beforeEach(() => {
      document.body.innerHTML = `
        <div data-automation-id="primaryQuestionnairePage">
          <div data-automation-id="formField-a1b2">
            <div data-automation-id="richText"><p>Country/Region of Residence<abbr>*</abbr></p></div>
            <button aria-haspopup="listbox" id="q1">Select One</button>
          </div>
          <div data-automation-id="formField-c3d4">
            <div data-automation-id="richText"><p>Do you have a disability, either visible or invisible?</p></div>
            <input type="radio" id="r1" name="dis" value="yes"><label for="r1">Yes</label>
            <input type="radio" id="r2" name="dis" value="no"><label for="r2">No</label>
          </div>
          <p>What is your notice period?</p>
          <div data-automation-id="formField-e5f6"><input type="text" id="q3"></div>
          <div data-automation-id="formField-disabilityStatus">
            <fieldset>
              <legend>Please check one of the boxes below:</legend>
              <input type="checkbox" id="c1"><label for="c1">Yes, I have a disability (or previously had a disability)</label>
              <input type="checkbox" id="c2"><label for="c2">No, I do not have a disability and have not had one in the past</label>
              <input type="checkbox" id="c3"><label for="c3">I do not want to answer</label>
            </fieldset>
          </div>
        </div>`;
    });

    it('reads rich-text questions and classifies them', () => {
      const fields = OriginFillWorkday.getFields();
      const residence = fields.find(f => f.element.id === 'q1');
      expect(residence.label).toBe('Country/Region of Residence');
      expect(residence.fieldType).toBe('country');
      expect(fields.find(f => f.element.id === 'r1').label).toBe('Do you have a disability, either visible or invisible?');
    });

    it('uses the text just before a wrapper', () => {
      const notice = OriginFillWorkday.getFields().find(f => f.element.id === 'q3');
      expect(notice.label).toBe('What is your notice period?');
    });

    it('treats several checkboxes as one question with options', () => {
      const group = OriginFillWorkday.getFields().find(f => f.control === 'checkboxGroup');
      expect(group.parts.checkboxes).toHaveLength(3);
      expect(group.contextText).toMatch(/do not have a disability/);
    });
  });

  describe('labels next to (not linked to) their inputs', () => {
    it('reads the text in the field\'s own block', () => {
      document.body.innerHTML = `
        <form>
          <div class="control-group"><label class="control-label"><abbr>*</abbr> Legal First Name</label>
            <div class="controls"><input type="text" name="answers[1]"></div></div>
          <div class="control-group"><label class="control-label">* Mobile Phone</label>
            <div class="controls"><div class="iti"><div class="iti__flag-container"><div class="iti__selected-dial-code">+1</div></div>
              <input type="tel" name="answers[2]"></div></div></div>
        </form>`;
      const [first, phone] = document.querySelectorAll('input');
      expect(OriginFillDetector.getInputLabel(first)).toBe('Legal First Name');
      expect(OriginFillDetector.getInputLabel(phone)).toBe('Mobile Phone');
    });
  });

  describe('readValue', () => {
    it('treats "Select One" as empty and reads a chosen option', () => {
      document.body.innerHTML = MY_INFORMATION;
      const fields = OriginFillWorkday.getFields();
      expect(OriginFillWorkday.readValue(byType(fields, 'state')[0])).toBeNull();
      expect(OriginFillWorkday.readValue(byType(fields, 'country')[0])).toBe('United States of America');
    });
  });

  describe('skills a page won\'t let a script pick', () => {
    const SKILLS = `
      <div data-automation-id="formField-skills">
        <label for="skills-input">Type to Add Skills</label>
        <div data-automation-id="multiSelectContainer" id="skills-box">
          <ul role="listbox" data-automation-id="selectedItemList" aria-label="items selected"></ul>
          <input id="skills-input" data-automation-id="searchBox" placeholder="Search">
        </div>
      </div>`;
    const RESULTS = `
      <div data-automation-widget="wd-popup" data-associated-widget="skills-box">
        <div data-automation-id="activeListContainer" role="listbox" aria-multiselectable="true">
          <div role="option" id="row-1" aria-selected="false" tabindex="-1">
            <div data-automation-id="promptLeafNode">
              <input type="checkbox" tabindex="-1">
              <div data-automation-id="promptOption" data-automation-label="JavaScript">JavaScript</div>
            </div>
          </div>
        </div>
      </div>`;

    afterEach(() => {
      OriginFillLogger.setEnabled(false);
      jest.restoreAllMocks();
    });

    it('reports it, never ticks the wrong thing, and logs the markup without values', async () => {
      document.body.innerHTML = SKILLS;
      document.getElementById('skills-input').addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !document.querySelector('[data-automation-widget]')) document.body.insertAdjacentHTML('beforeend', RESULTS);
      });
      OriginFillLogger.setEnabled(true);
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});

      const field = byType(OriginFillWorkday.getFields(), 'skills')[0];
      const result = await OriginFillWorkday.fillField(field, ['JavaScript'], { profile: {} });

      expect(result.success).toBe(false);
      expect(result.note).toMatch(/Could not select "JavaScript"/);
      const logged = warn.mock.calls.map(args => args.join(' ')).join('\n');
      expect(logged).toMatch(/row: div\[role=option\].*promptLeafNode.*promptOption/);
      expect(logged).toMatch(/highlight: none/);
    }, 20000);
  });

  describe('nationalPhone', () => {
    it('drops a country code that Workday asks for separately', () => {
      expect(OriginFillWorkday.nationalPhone('+1 (555) 123-4567', { personal: { phoneCountryCode: '+1' } })).toBe('(555) 123-4567');
      expect(OriginFillWorkday.nationalPhone('+91 98765 43210', {})).toBe('98765 43210');
      expect(OriginFillWorkday.nationalPhone('555-123-4567', {})).toBe('555-123-4567');
    });
  });

  describe('normalizeDate', () => {
    it('should format YYYY-MM-DD to MM/DD/YYYY for generic inputs', () => {
      const input = document.createElement('input');
      expect(OriginFillWorkday.normalizeDate('2024-06-15', input)).toBe('06/15/2024');
    });

    it('should format correctly for type="date" inputs', () => {
      const input = document.createElement('input');
      input.type = 'date';
      expect(OriginFillWorkday.normalizeDate('06/15/2024', input)).toBe('2024-06-15');
    });

    it('should handle month-only dates (YYYY-MM)', () => {
      const input = document.createElement('input');
      expect(OriginFillWorkday.normalizeDate('2024-06', input)).toBe('06/2024');
    });

    it('should format correctly for type="month" inputs', () => {
      const input = document.createElement('input');
      input.type = 'month';
      expect(OriginFillWorkday.normalizeDate('06/15/2024', input)).toBe('2024-06');
    });

    it('should handle text-based dates', () => {
      const input = document.createElement('input');
      expect(OriginFillWorkday.normalizeDate('June 2024', input)).toBe('06/2024');
      expect(OriginFillWorkday.normalizeDate('Jun 2024', input)).toBe('06/2024');
    });

    it('should return original if unparseable', () => {
      const input = document.createElement('input');
      expect(OriginFillWorkday.normalizeDate('unknown', input)).toBe('unknown');
    });
  });
});
