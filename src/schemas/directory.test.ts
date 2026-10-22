import { describe, it, expect } from 'vitest';
import { validateRecord } from './directory';
import { displayValue, isEntityKey, recordLabel } from '../lib/directory';
describe('phase 2 record validation', () => {
  it('rejects impossible and reversed academic dates', () => {
    expect(() =>
      validateRecord('academic_years', {
        name: '2026',
        starts_on: '2026-02-30',
        ends_on: '2026-12-31',
      }),
    ).toThrow();
    expect(() =>
      validateRecord('academic_years', {
        name: '2026',
        starts_on: '2026-12-31',
        ends_on: '2026-01-01',
      }),
    ).toThrow();
  });
  it('supports configurable grade names with bounded sort order', () => {
    expect(validateRecord('grades', { name: 'Reception', sort_order: 0 })).toEqual({
      name: 'Reception',
      sort_order: 0,
    });
    expect(() => validateRecord('grades', { name: 'Grade 1', sort_order: 1.5 })).toThrow();
  });
  it('rejects non-positive subject weights', () => {
    expect(() =>
      validateRecord('class_subjects', {
        class_id: crypto.randomUUID(),
        subject_id: crypto.randomUUID(),
        compulsory: true,
        weight: 0,
      }),
    ).toThrow();
  });
  it('accepts nullable account links but validates provided UUIDs', () => {
    const parent = {
      first_name: 'Pat',
      surname: 'Example',
      email: null,
      phone: null,
      address: null,
      user_id: null,
    };
    expect(validateRecord('parents', parent).user_id).toBeNull();
    expect(() => validateRecord('parents', { ...parent, user_id: 'not-a-uuid' })).toThrow();
  });
  it('rejects malformed contact email', () => {
    expect(() =>
      validateRecord('parents', {
        first_name: 'Pat',
        surname: 'Example',
        email: 'invalid',
        phone: null,
        address: null,
        user_id: null,
      }),
    ).toThrow();
  });
  it('only permits registered directory entities', () => {
    expect(isEntityKey('students')).toBe(true);
    expect(isEntityKey('audit_logs')).toBe(false);
    expect(isEntityKey('__proto__')).toBe(false);
  });
  it('labels class subject allocations clearly', () => {
    expect(
      displayValue({
        class: { name: '7A', year: { name: '2026' } },
        subject: { name: 'Maths', code: 'MATH' },
      }),
    ).toBe('7A · 2026 · MATH · Maths');
  });
  it('uses admission numbers to distinguish matching names', () => {
    expect(
      recordLabel({
        id: 'x',
        school_id: 's',
        archived: false,
        version: 1,
        created_at: '',
        first_name: 'Alex',
        surname: 'Smith',
        admission_number: 'A001',
      }),
    ).toBe('A001 · Alex Smith');
  });
});
