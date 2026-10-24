import { describe, it, expect } from 'vitest';
import { addCalendarDays, validateAttachment, validText } from './community';
describe('community validation', () => {
  it('accepts supported private attachments', () => {
    for (const type of ['application/pdf', 'text/plain', 'image/jpeg', 'image/png'])
      expect(() =>
        validateAttachment({ name: 'school-file.pdf', size: 5242880, type }),
      ).not.toThrow();
  });
  it('rejects empty, oversized and unsupported uploads', () => {
    for (const f of [
      { name: 'empty.txt', size: 0, type: 'text/plain' },
      { name: 'big.pdf', size: 5242881, type: 'application/pdf' },
      { name: 'page.html', size: 10, type: 'text/html' },
      { name: 'bad.exe', size: 10, type: 'application/x-msdownload' },
    ])
      expect(() => validateAttachment(f)).toThrow();
  });
  it('rejects path separators and control characters in names', () => {
    for (const name of ['../private.txt', 'folder\\file.txt', 'bad\nname.txt', 'x'.repeat(121)])
      expect(() => validateAttachment({ name, size: 1, type: 'text/plain' })).toThrow();
  });
  it('adds calendar days across month/year and leap boundaries', () => {
    expect(addCalendarDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addCalendarDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addCalendarDays('2026-03-01', -1)).toBe('2026-02-28');
  });
  it('trims messages and rejects empty/overlong content', () => {
    expect(validText(' Hello ', 5000)).toBe('Hello');
    expect(() => validText(' ', 5000)).toThrow();
    expect(() => validText('x'.repeat(5001), 5000)).toThrow();
  });
});
