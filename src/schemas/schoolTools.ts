import { z } from 'zod';
export const schoolRoles = [
  'SCHOOL_ADMIN',
  'PRINCIPAL',
  'TEACHER',
  'PARENT',
  'STUDENT',
  'ACCOUNTANT',
  'LIBRARIAN',
] as const;
export const eventSchema = z
  .object({
    title: z.string().trim().min(1).max(160),
    description: z.string().max(3000),
    category: z.enum([
      'EVENT',
      'EXAM',
      'MEETING',
      'PARENT_MEETING',
      'HOLIDAY',
      'SPORT',
      'ACADEMIC',
    ]),
    starts_at: z.iso.datetime(),
    ends_at: z.iso.datetime(),
    all_day: z.boolean(),
    class_id: z.uuid().nullable(),
    roles: z.array(z.enum(schoolRoles)).min(1).max(7),
    archived: z.boolean(),
  })
  .refine(
    (v) =>
      Date.parse(v.ends_at) > Date.parse(v.starts_at) &&
      Date.parse(v.ends_at) - Date.parse(v.starts_at) <= 366 * 86400000,
    'Choose an end after the start, within 366 days.',
  );
export function eventTimes(start: string, end: string, allDay: boolean) {
  if (allDay) {
    const first = new Date(start.slice(0, 10) + 'T00:00:00Z'),
      last = new Date(end.slice(0, 10) + 'T00:00:00Z');
    last.setUTCDate(last.getUTCDate() + 1);
    return { starts_at: first.toISOString(), ends_at: last.toISOString() };
  }
  return { starts_at: new Date(start).toISOString(), ends_at: new Date(end).toISOString() };
}
