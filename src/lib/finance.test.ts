import { describe, it, expect } from 'vitest';
import { parseMoney, formatMoney, inputMoney } from './finance';
describe('exact monetary values', () => {
  it('parses amounts without floating point rounding', () => {
    expect(parseMoney('0.10', 2)).toBe('10');
    expect(parseMoney('100.01', 2)).toBe('10001');
    expect(parseMoney('12', 0)).toBe('12');
    expect(parseMoney('1.001', 3)).toBe('1001');
  });
  it('rejects fractional overflow and unsupported notation', () => {
    for (const v of [
      '1.001',
      '1e3',
      '-1',
      '0',
      'NaN',
      '1,200',
      'Infinity',
      '.25',
      '90000000000.01',
    ])
      expect(() => parseMoney(v, 2)).toThrow();
    expect(() => parseMoney('1.0', 0)).toThrow();
  });
  it('formats exact signed ledger amounts and supports 3 decimals', () => {
    expect(formatMoney('-1001', 'ZAR', 2)).toContain('−10.01');
    expect(formatMoney('1001', 'KWD', 3)).toBe('KWD 1.001');
    expect(inputMoney('10', 2)).toBe('0.10');
    expect(inputMoney('15', 0)).toBe('15');
  });
  it('accepts the bounded maximum amount exactly', () =>
    expect(parseMoney('90000000000.00', 2)).toBe('9000000000000'));
});
