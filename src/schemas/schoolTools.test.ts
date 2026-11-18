import { describe, it, expect } from 'vitest';
import { eventSchema, eventTimes } from './schoolTools';
import { schoolSchema } from './foundation';
import { parseLearnersCsv, calendarIcs } from '../lib/advanced';
describe('school completion validation', () => {
  const event = {
    title: 'Meeting',
    description: '',
    category: 'MEETING',
    starts_at: '2026-11-20T08:00:00.000Z',
    ends_at: '2026-11-20T09:00:00.000Z',
    all_day: false,
    class_id: null,
    roles: ['PARENT'],
    archived: false,
  };
  it('accepts school-specific event audiences and rejects empty or platform audiences', () => {
    expect(eventSchema.safeParse(event).success).toBe(true);
    expect(eventSchema.safeParse({ ...event, roles: [] }).success).toBe(false);
    expect(eventSchema.safeParse({ ...event, roles: ['SUPER_ADMIN'] }).success).toBe(false);
  });
  it('rejects inverted and unbounded calendar ranges', () => {
    expect(eventSchema.safeParse({ ...event, ends_at: event.starts_at }).success).toBe(false);
    expect(eventSchema.safeParse({ ...event, ends_at: '2030-01-01T00:00:00.000Z' }).success).toBe(
      false,
    );
  });
  it('exports all-day intervals with exclusive end dates and timed events in UTC', () => {
    const t = eventTimes('2026-11-20T08:00', '2026-11-20T09:00', true);
    expect(t).toEqual({
      starts_at: '2026-11-20T00:00:00.000Z',
      ends_at: '2026-11-21T00:00:00.000Z',
    });
    const ics = calendarIcs([
      {
        id: 'event',
        version: 1,
        name: 'Meeting',
        starts_on: '2026-11-20',
        ends_on: '2026-11-21',
        ...t,
        all_day: true,
      },
    ]);
    expect(ics).toContain('DTEND;VALUE=DATE:20261121');
  });
  it('parses subject and teacher templates with exact headers', () => {
    expect(
      parseLearnersCsv('code,name,description\nSCI,Science,Lab\n', ['code', 'name', 'description']),
    ).toHaveLength(1);
    expect(() =>
      parseLearnersCsv('code,name,other\nA,B,C\n', ['code', 'name', 'description']),
    ).toThrow('selected template');
  });
  it('rejects script URLs, SVG logos and invalid report formats', () => {
    const s = {
      name: 'School',
      slug: 'school',
      timezone: 'Africa/Johannesburg',
      currency: 'ZAR',
      contact_email: '',
      phone: '',
      address: '',
      brand_color: '#6495ED',
    };
    expect(schoolSchema.safeParse({ ...s, website: 'javascript:alert(1)' }).success).toBe(false);
    expect(
      schoolSchema.safeParse({ ...s, logo_data: 'data:image/svg+xml;base64,abc' }).success,
    ).toBe(false);
    expect(schoolSchema.safeParse({ ...s, report_layout: 'SCRIPT' }).success).toBe(false);
  });
});
