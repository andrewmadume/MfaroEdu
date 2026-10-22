import { describe, it, expect } from 'vitest';
import {
  gradingSchema,
  assessmentSchema,
  validateMarks,
  percentage,
  gradeFor,
  academicSummary,
} from './academics';
import type { MarkEntry, ReportDocument } from '../types/academics';
const rules = {
  bands: [
    { min: 80, label: 'A' },
    { min: 50, label: 'B' },
    { min: 0, label: 'C' },
  ],
  pass_percent: 50,
  assessment_types: ['Test'],
  term_weights: {},
};
describe('school-configured grading', () => {
  it('accepts arbitrary labels and thresholds', () =>
    expect(gradingSchema.parse(rules)).toEqual(rules));
  it('rejects out-of-order and duplicate thresholds', () =>
    expect(() =>
      gradingSchema.parse({
        ...rules,
        bands: [
          { min: 0, label: 'C' },
          { min: 80, label: 'A' },
        ],
      }),
    ).toThrow());
  it('requires a final zero threshold', () =>
    expect(() => gradingSchema.parse({ ...rules, bands: [{ min: 50, label: 'A' }] })).toThrow());
  it('requires unique assessment types', () =>
    expect(() => gradingSchema.parse({ ...rules, assessment_types: ['Test', 'Test'] })).toThrow());
  it('grades exact boundaries', () => {
    expect(gradeFor(80, rules.bands)).toBe('A');
    expect(gradeFor(79.99, rules.bands)).toBe('B');
    expect(gradeFor(0, rules.bands)).toBe('C');
  });
  it('computes raw mark percentages', () => expect(percentage(17, 20)).toBe(85));
  it('rejects missing marks and nonfinite values', () => {
    const e = {
      id: 'x',
      name: 'Learner',
      admission_number: 'A',
      mark: null,
      status: 'MARKED',
      comment: '',
      version: 0,
    } as MarkEntry;
    expect(() => validateMarks([e], 20)).toThrow();
    expect(() => validateMarks([{ ...e, mark: Infinity }], 20)).toThrow();
  });
  it('allows explicit absence and exemption', () =>
    expect(() =>
      validateMarks(
        [
          {
            id: 'x',
            name: 'Learner',
            admission_number: 'A',
            mark: null,
            status: 'EXEMPT',
            comment: '',
            version: 0,
          },
        ],
        20,
      ),
    ).not.toThrow());
  it('rejects zero assessment maximum', () =>
    expect(() =>
      assessmentSchema.parse({
        class_subject_id: crypto.randomUUID(),
        term_id: crypto.randomUUID(),
        name: 'Exam',
        assessment_type: 'Exam',
        assessed_on: '2026-01-01',
        max_mark: 0,
        weight: 1,
      }),
    ).toThrow());
  it('allows an explicit incomplete reset only with an empty score', () => {
    const row: MarkEntry = {
      id: 'x',
      name: 'Learner',
      admission_number: 'A',
      mark: null,
      status: 'INCOMPLETE',
      comment: 'Awaiting correction',
      version: 1,
    };
    expect(() => validateMarks([row], 20)).not.toThrow();
    expect(() => validateMarks([{ ...row, mark: 10 }], 20)).toThrow();
  });
  it('excludes exemptions from analytical averages and pass rates', () => {
    const reports = [
      { subjects: [{ id: 'math', name: 'Math', percent: 80, passed: true }] },
      { subjects: [{ id: 'math', name: 'Math', percent: 0, passed: false }] },
      { subjects: [{ id: 'math', name: 'Math', percent: null, passed: null }] },
    ] as ReportDocument[];
    expect(academicSummary(reports)[0]).toMatchObject({ average: 40, passRate: 50, count: 2 });
  });
});
