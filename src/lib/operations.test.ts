import { describe, it, expect } from 'vitest';
import {
  mondayOf,
  addDays,
  monthBounds,
  schoolToday,
  validateAttendance,
  attendanceTotals,
  scheduleSchema,
} from './operations';
describe('school-day calculations and validation', () => {
  it('uses school timezone at day boundaries', () => {
    expect(schoolToday('Africa/Johannesburg')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
  it('crosses month, year and leap boundaries without local DST changes', () => {
    expect(mondayOf('2026-01-01')).toBe('2025-12-29');
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29');
    expect(monthBounds('2024-02-15')).toEqual({ from: '2024-02-01', to: '2024-02-29' });
  });
  it('counts late as attendance, includes excused in denominator and handles empty registers', () => {
    expect(attendanceTotals([]).percentage).toBeNull();
    expect(
      attendanceTotals([
        {
          student_id: 'x',
          name: 'X',
          admission_number: '1',
          present: 1,
          late: 1,
          absent: 1,
          excused: 1,
          total: 4,
          percentage: 50,
        },
      ]).percentage,
    ).toBe(50);
  });
  it('rejects missing statuses and oversized notes while allowing explicit unmarked drafts', () => {
    const row = {
      id: 'x',
      name: 'X',
      admission_number: '1',
      version: 0,
      reason: '',
      status: 'UNMARKED' as const,
    };
    expect(() => validateAttendance([row])).not.toThrow();
    expect(() => validateAttendance([{ ...row, status: null }])).toThrow();
    expect(() => validateAttendance([{ ...row, reason: 'x'.repeat(1001) }])).toThrow();
  });
  it('rejects out of range weekdays and invalid relationship ids', () => {
    expect(scheduleSchema.safeParse({ weekday: 8 }).success).toBe(false);
  });
});
