const path = require('path');

// Mock indexedDB for the store (migration tests don't touch it)
global.indexedDB = {
  open: jest.fn()
};

loadExtensionScript(path.join(__dirname, '../utils/constants.js'));
loadExtensionScript(path.join(__dirname, '../utils/logger.js'));
loadExtensionScript(path.join(__dirname, '../storage/store.js'));

const { migrateProfileSchema } = OriginFillStore;

describe('Profile Storage Schema Migration', () => {
  it('should upgrade a v1 profile by adding missing fields', () => {
    const v1Profile = {
      id: 'test-123',
      personal: {
        firstName: 'John',
        lastName: 'Doe'
      }
      // Missing other personal fields, arrays, etc.
    };

    const migrated = migrateProfileSchema(v1Profile);

    expect(migrated.schemaVersion).toBe(4);
    expect(migrated.personal.firstName).toBe('John');
    expect(migrated.personal.middleName).toBe('');
    expect(migrated.personal.linkedIn).toBe('');
    expect(Array.isArray(migrated.education)).toBe(true);
    expect(Array.isArray(migrated.workExperience)).toBe(true);
    expect(migrated.resume).toBeDefined();
    expect(migrated.resume.fileName).toBe('');
  });

  it('should add the v3 Workday fields to v2 profiles without touching data', () => {
    const v2Profile = {
      id: 'test-v2',
      schemaVersion: 2,
      personal: { firstName: 'Jane', middleName: 'M' },
      websites: ['https://jane.dev'],
      education: [],
      workExperience: [],
      resume: { fileName: '' }
    };

    const migrated = migrateProfileSchema(v2Profile);

    expect(migrated.schemaVersion).toBe(4);
    expect(migrated.personal.middleName).toBe('M');
    expect(migrated.personal.phoneType).toBe('Mobile');
    expect(migrated.personal.websites).toEqual(['https://jane.dev']);
    expect(migrated.application).toEqual({ referralSource: '', previouslyEmployed: '' });
    expect(migrated.answers).toEqual([]);
    expect(migrated.resume.defaultId).toBe('');
    expect(migrated.faq).toEqual({});
  });

  it('should add common-question answers to v3 profiles', () => {
    const v3Profile = { id: 'test-v3', schemaVersion: 3, personal: { firstName: 'Ada' }, resume: {} };
    expect(migrateProfileSchema(v3Profile).faq).toEqual({});
  });

  it('should not alter v4 profiles', () => {
    const v4Profile = { id: 'test-v4', schemaVersion: 4, personal: { firstName: 'Ada' }, faq: { disability: 'No' } };
    expect(migrateProfileSchema(v4Profile)).toBe(v4Profile);
  });
});
