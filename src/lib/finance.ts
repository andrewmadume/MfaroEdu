export const MAX_MINOR = 9000000000000n;
export function parseMoney(value: string, places: number): string {
  if (!Number.isInteger(places) || places < 0 || places > 3)
    throw new Error('Invalid currency precision.');
  const pattern = places ? new RegExp(`^\\d+(?:\\.\\d{1,${places}})?$`) : /^\d+$/;
  if (!pattern.test(value.trim()) || value.length > 20)
    throw new Error(`Enter a positive amount with at most ${places} decimal places.`);
  const [whole, fraction = ''] = value.trim().split('.');
  const minor = BigInt(whole) * 10n ** BigInt(places) + BigInt(fraction.padEnd(places, '0') || '0');
  if (minor <= 0n || minor > MAX_MINOR) throw new Error('Amount is outside the supported range.');
  return String(minor);
}
export function formatMoney(value: string, currency: string, places: number): string {
  const amount = BigInt(value),
    absolute = amount < 0n ? -amount : amount,
    base = 10n ** BigInt(places);
  return `${currency} ${amount < 0n ? '−' : ''}${new Intl.NumberFormat('en-ZA').format(absolute / base)}${places ? '.' + String(absolute % base).padStart(places, '0') : ''}`;
}
export function inputMoney(value: string, places: number): string {
  const amount = BigInt(value),
    base = 10n ** BigInt(places);
  return `${amount / base}${places ? '.' + String(amount % base).padStart(places, '0') : ''}`;
}
export function financeToday(timezone: string) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}
