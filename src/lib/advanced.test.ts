import { describe, it, expect } from 'vitest';
import { parseLearnersCsv, safeCsv, calendarIcs, importColumns } from './advanced';
import { draftSchema } from './offlineDrafts';
const header = importColumns.join(',');
describe('bounded learner CSV', () => {
  it('reads BOM, CRLF, quoted commas, escaped quotes and reordered columns', () => {
    const rows = parseLearnersCsv(
      '\uFEFFsurname,first_name,admission_number,admission_date,date_of_birth\r\n"Moyo, Jr","An""na",A1,2026-01-01,2014-02-03\r\n',
    );
    expect(rows[0]).toEqual({
      surname: 'Moyo, Jr',
      first_name: 'An"na',
      admission_number: 'A1',
      admission_date: '2026-01-01',
      date_of_birth: '2014-02-03',
    });
  });
  it('keeps quoted newlines within a cell', () =>
    expect(
      parseLearnersCsv(header + '\nA1,"Jo\nAnn",Moyo,2014-01-01,2026-01-01')[0].first_name,
    ).toBe('Jo\nAnn'));
  it('rejects ambiguous and unterminated quotes', () => {
    for (const row of [
      'A1,"Jo,Moyo,2014-01-01,2026-01-01',
      'A1,"Jo"x,Moyo,2014-01-01,2026-01-01',
      'A1,Jo"a,Moyo,2014-01-01,2026-01-01',
    ])
      expect(() => parseLearnersCsv(header + '\n' + row)).toThrow();
  });
  it('rejects extra/duplicate columns and empty data', () => {
    for (const text of [
      header,
      header + '\nA,B,C',
      header + ',email\nA,B,C,D,E,F',
      'admission_number,first_name,surname,date_of_birth,surname\nA,B,C,D,E',
    ])
      expect(() => parseLearnersCsv(text)).toThrow();
  });
  it('limits encoded bytes and rows before submitting', () => {
    expect(() => parseLearnersCsv('é'.repeat(150001))).toThrow('300 KB');
    expect(() =>
      parseLearnersCsv(header + '\n' + Array(501).fill('A,B,C,2014-01-01,2026-01-01').join('\n')),
    ).toThrow('500');
  });
  it('neutralizes spreadsheet formula prefixes and escapes CSV quotes', () => {
    const text = safeCsv(
      [{ name: ' \t=HYPERLINK("url")' }, { name: '-1+2' }, { name: '@cmd' }, { name: 'a,b' }],
      ['name'],
    );
    expect(text).toContain('"\' \t=HYPERLINK(""url"")"');
    expect(text).toContain('"\'-1+2"');
    expect(text).toContain('"\'@cmd"');
    expect(text).toContain('"a,b"');
  });
});
describe('portable calendar', () => {
  it('escapes injection and uses an exclusive all-day end date', () => {
    const text = calendarIcs(
      [
        {
          id: 'term-1',
          name: 'Term, One;\nBEGIN:VEVENT',
          starts_on: '2026-01-01',
          ends_on: '2026-01-31',
          version: 2,
        },
      ],
      new Date('2026-01-01T00:00:00Z'),
    );
    expect(text).toContain('DTEND;VALUE=DATE:20260201');
    expect(text).toContain('SUMMARY:Term\\, One\\;\\nBEGIN:VEVENT');
    expect(text.match(/\r\nBEGIN:VEVENT/g)).toHaveLength(1);
    expect(text).toContain('SEQUENCE:2');
  });
  it('folds Unicode without splitting code points or exceeding 75 octets', () => {
    const text = calendarIcs([
      {
        id: 'term',
        name: '学校'.repeat(100),
        starts_on: '2026-01-01',
        ends_on: '2026-01-02',
        version: 1,
      },
    ]);
    expect(text.split('\r\n').every((line) => new TextEncoder().encode(line).length <= 75)).toBe(
      true,
    );
    expect(text.replace(/\r\n /g, '')).toContain('学校'.repeat(100));
  });
});
describe('offline draft boundary', () => {
  const uuid = '10000000-0000-4000-8000-000000000001';
  const draft = {
    schema: 1,
    id: uuid,
    user: uuid,
    tenant: uuid,
    school_name: 'Example school',
    request_key: uuid,
    attempted: false,
    saved_at: new Date().toISOString(),
    book: {
      version: 0,
      title: 'Reading',
      author: 'Author',
      isbn: '',
      category: '',
      publisher: '',
      archived: false,
    },
  };
  it('accepts only versioned catalogue metadata', () => {
    expect(draftSchema.safeParse(draft).success).toBe(true);
    expect(draftSchema.safeParse({ ...draft, schema: 2 }).success).toBe(false);
    expect(
      draftSchema.safeParse({ ...draft, book: { ...draft.book, student_name: 'private' } }).success,
    ).toBe(false);
  });
  it('rejects oversized fields and unscoped drafts', () => {
    expect(draftSchema.safeParse({ ...draft, user: '' }).success).toBe(false);
    expect(
      draftSchema.safeParse({ ...draft, book: { ...draft.book, title: 'x'.repeat(201) } }).success,
    ).toBe(false);
  });
});
