import type { CalendarTerm, ImportRow } from '../types/advanced';
export const importColumns = [
  'admission_number',
  'first_name',
  'surname',
  'date_of_birth',
  'admission_date',
] as const;
/** Bounded RFC 4180 parser: quoted newlines, escaped quotes and CRLF are supported. */
export function parseLearnersCsv(source: string): ImportRow[] {
  if (new TextEncoder().encode(source).length > 300000)
    throw new Error('Use a CSV file smaller than 300 KB.');
  const text = source.replace(/^\uFEFF/, '');
  const rows: string[][] = [];
  let row: string[] = [],
    field = '',
    quoted = false,
    closed = false;
  const endField = () => {
    row.push(field);
    field = '';
    closed = false;
  };
  const endRow = () => {
    endField();
    if (row.some((v) => v !== '')) rows.push(row);
    row = [];
    if (rows.length > 501) throw new Error('Use at most 500 learners per file.');
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
          closed = true;
        }
      } else field += c;
      continue;
    }
    if (c === ',') endField();
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      endRow();
    } else if (c === '"') {
      if (field || closed) throw new Error('A quote must start a CSV field.');
      quoted = true;
    } else {
      if (closed) throw new Error('Unexpected text after a quoted CSV field.');
      field += c;
    }
  }
  if (quoted) throw new Error('Close the quoted field in your CSV file.');
  if (field || row.length || closed) endRow();
  const header = rows.shift()?.map((v) => v.trim());
  if (
    !header ||
    header.length !== 5 ||
    new Set(header).size !== 5 ||
    importColumns.some((c) => !header.includes(c))
  )
    throw new Error('Use exactly the five template column names.');
  if (!rows.length) throw new Error('Add at least one learner.');
  return rows.map((values, i) => {
    if (values.length !== 5) throw new Error(`Row ${i + 2} must have five columns.`);
    return Object.fromEntries(header.map((h, n) => [h, values[n].trim()])) as unknown as ImportRow;
  });
}
export function safeCsv(rows: Record<string, unknown>[], columns: readonly string[]) {
  const cell = (value: unknown) => {
    let s = String(value ?? '');
    if (/^[\s\u0000-\u001f]*[=+\-@]/.test(s) || /^[\t\r\n]/.test(s)) s = "'" + s;
    return '"' + s.replace(/"/g, '""') + '"';
  };
  return (
    '\uFEFF' +
    [
      columns.map(cell).join(','),
      ...rows.map((r) => columns.map((c) => cell(r[c])).join(',')),
    ].join('\r\n') +
    '\r\n'
  );
}
export function calendarIcs(terms: CalendarTerm[], now = new Date()) {
  const esc = (s: string) =>
    s
      .replace(/\\/g, '\\\\')
      .replace(/\r\n|\r|\n/g, '\\n')
      .replace(/,/g, '\\,')
      .replace(/;/g, '\\;');
  const day = (s: string) => s.replace(/-/g, '');
  const stamp = now
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
  const next = (s: string) =>
    new Date(Date.parse(s + 'T00:00:00Z') + 86400000).toISOString().slice(0, 10);
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//MfaroEdu//School terms//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
  ];
  for (const t of terms)
    lines.push(
      'BEGIN:VEVENT',
      `UID:${t.id}@mfaroedu`,
      `DTSTAMP:${stamp}`,
      `SEQUENCE:${t.version}`,
      `DTSTART;VALUE=DATE:${day(t.starts_on)}`,
      `DTEND;VALUE=DATE:${day(next(t.ends_on))}`,
      `SUMMARY:${esc(t.name)}`,
      'END:VEVENT',
    );
  lines.push('END:VCALENDAR');
  // RFC 5545 folds on octet boundaries, never splitting a Unicode code point.
  return (
    lines
      .map((line) => {
        let out = '',
          count = 0;
        for (const c of line) {
          const bytes = new TextEncoder().encode(c).length;
          if (count + bytes > 75) {
            out += '\r\n ';
            count = 1;
          }
          out += c;
          count += bytes;
        }
        return out;
      })
      .join('\r\n') + '\r\n'
  );
}
export function downloadFile(name: string, content: string, type = 'text/plain;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
