import { describe, expect, it } from 'vitest';
import { can } from './permissions';
import { schoolSchema, passwordSchema, loginSchema } from '../schemas/foundation';
const school = {
  name: 'Test School',
  slug: 'test-school',
  timezone: 'Africa/Johannesburg',
  currency: 'ZAR',
  contact_email: '',
  phone: '',
  address: '',
  brand_color: '#173f35',
};
describe('permissions', () => {
  it('denies unknown or absent permissions', () => {
    expect(can([], 'school.update')).toBe(false);
    expect(can(['school.view'], 'school.update')).toBe(false);
    expect(can(['school.update'], 'school.update')).toBe(true);
  });
});
describe('school validation', () => {
  it('accepts configurable school details', () => {
    expect(schoolSchema.safeParse(school).success).toBe(true);
  });
  it.each([
    { slug: 'Bad Slug' },
    { currency: 'usd' },
    { timezone: 'Invalid/Zone' },
    { brand_color: 'red' },
    { contact_email: 'invalid' },
    { name: 'A' },
    { slug: 'a--b' },
  ])('rejects invalid values %j', (value) => {
    expect(schoolSchema.safeParse({ ...school, ...value }).success).toBe(false);
  });
});
describe('authentication validation', () => {
  it('requires a valid email and password', () => {
    expect(loginSchema.safeParse({ email: 'bad', password: '' }).success).toBe(false);
  });
  it('requires long replacement passwords', () => {
    expect(passwordSchema.safeParse('short').success).toBe(false);
    expect(passwordSchema.safeParse('long-random-passphrase').success).toBe(true);
  });
});
