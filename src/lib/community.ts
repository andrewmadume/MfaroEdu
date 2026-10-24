export const attachmentTypes = ['application/pdf', 'image/png', 'image/jpeg', 'text/plain'];
export function validateAttachment(file: Pick<File, 'name' | 'size' | 'type'>) {
  if (!file.name.trim() || file.name.length > 120 || /[/\\\u0000-\u001f]/.test(file.name))
    throw new Error('Use a filename of 1–120 characters without path separators.');
  if (file.size < 1 || file.size > 5242880)
    throw new Error('Choose a file between 1 byte and 5 MB.');
  if (!attachmentTypes.includes(file.type))
    throw new Error('Choose a PDF, PNG, JPEG or plain text file.');
}
export function schoolDate(timezone: string) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}
export function addCalendarDays(day: string, count: number) {
  const date = new Date(day + 'T12:00:00Z');
  date.setUTCDate(date.getUTCDate() + count);
  return date.toISOString().slice(0, 10);
}
export function validText(value: string, max: number) {
  const text = value.trim();
  if (!text || text.length > max) throw new Error(`Enter between 1 and ${max} characters.`);
  return text;
}
