import { z } from 'zod';
import type { Band, MarkEntry, ReportDocument } from '../types/academics';
export const gradingSchema = z
  .object({
    bands: z
      .array(
        z.object({
          min: z.number().finite().min(0).max(100),
          label: z.string().trim().min(1).max(80),
        }),
      )
      .min(1)
      .max(30),
    pass_percent: z.number().finite().min(0).max(100),
    assessment_types: z.array(z.string().trim().min(1).max(80)).min(1).max(30),
    term_weights: z.record(z.uuid(), z.number().finite().positive().max(1000)),
  })
  .superRefine((r, c) => {
    if (r.bands.at(-1)?.min !== 0 || r.bands.some((b, i) => i > 0 && b.min >= r.bands[i - 1].min))
      c.addIssue({
        code: 'custom',
        message: 'Order band minimums from highest to lowest, ending at zero.',
        path: ['bands'],
      });
    if (new Set(r.assessment_types).size !== r.assessment_types.length)
      c.addIssue({
        code: 'custom',
        message: 'Assessment types must be unique.',
        path: ['assessment_types'],
      });
  });
export const assessmentSchema = z.object({
  class_subject_id: z.uuid(),
  term_id: z.uuid(),
  name: z.string().trim().min(1).max(120),
  assessment_type: z.string().trim().min(1).max(80),
  assessed_on: z.iso.date(),
  max_mark: z.number().finite().positive().max(100000),
  weight: z.number().finite().positive().max(1000),
});
export function validateMarks(entries: MarkEntry[], max: number) {
  for (const e of entries) {
    if (
      !e.status ||
      !['MARKED', 'ABSENT', 'EXEMPT', 'INCOMPLETE'].includes(e.status) ||
      (e.status !== 'MARKED' && e.mark !== null) ||
      (e.status === 'MARKED' &&
        (e.mark === null || !Number.isFinite(e.mark) || e.mark < 0 || e.mark > max))
    )
      throw new Error(
        `Enter a mark between 0 and ${max}, or select Incomplete, Absent or Exempt for ${e.name}.`,
      );
    if (e.comment.length > 1000) throw new Error('Comments must be 1,000 characters or fewer.');
  }
}
export function percentage(mark: number, max: number) {
  return Math.round((mark / max) * 10000) / 100;
}
export function gradeFor(percent: number, bands: Band[]) {
  return bands.find((b) => percent >= b.min)?.label ?? '';
}
export function academicSummary(reports: ReportDocument[]) {
  const subjects = new Map<
    string,
    { name: string; total: number; count: number; passed: number }
  >();
  for (const report of reports)
    for (const s of report.subjects) {
      if (s.percent === null) continue;
      const item = subjects.get(s.id) ?? { name: s.name, total: 0, count: 0, passed: 0 };
      item.total += s.percent;
      item.count++;
      if (s.passed) item.passed++;
      subjects.set(s.id, item);
    }
  return [...subjects.values()].map((s) => ({
    ...s,
    average: Math.round((s.total / s.count) * 100) / 100,
    passRate: Math.round((s.passed / s.count) * 10000) / 100,
  }));
}
