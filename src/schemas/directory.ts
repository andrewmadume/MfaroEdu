import { z } from 'zod';
import { entities } from '../lib/directory';
import type { EntityKey } from '../types/directory';
const date = z.iso.date('Enter a valid date.');
export function validateRecord(
  entity: EntityKey,
  input: Record<string, unknown>,
): Record<string, unknown> {
  const shape: Record<string, z.ZodType> = {};
  for (const field of entities[entity].fields) {
    let schema: z.ZodType;
    if (field.kind === 'checkbox') {
      schema = z.boolean();
    } else if (field.kind === 'number') {
      schema = z
        .number()
        .min(field.min ?? 0)
        .max(field.max ?? 1000);
      if (!['weight'].includes(field.key)) schema = (schema as z.ZodNumber).int();
    } else if (field.kind === 'reference' || field.key === 'user_id')
      schema = z.uuid('Select a valid record or account ID.');
    else if (field.kind === 'date') schema = date;
    else if (field.kind === 'time') schema=z.string().regex(/^([01]\d|2[0-3]):[0-5]\d(?::00)?$/,'Use a time in hours and minutes.');
    else if (field.kind === 'select') schema = z.enum(field.options as [string, ...string[]]);
    else if (field.kind === 'email') schema = z.email('Enter a valid email address.').max(254);
    else
      schema = z
        .string()
        .trim()
        .min(field.required ? 1 : 0)
        .max(field.max ?? 120);
    shape[field.key] = field.required || field.kind === 'checkbox' ? schema : schema.nullable();
  }
  const result = z.object(shape).parse(input) as Record<string, unknown>;
  if (result.starts_on && result.ends_on && String(result.ends_on) < String(result.starts_on))
    throw new Error('End date must be on or after the start date.');
  if (entity === 'students') {
    if (String(result.date_of_birth) >= new Date().toISOString().slice(0, 10))
      throw new Error('Date of birth must be in the past.');
    if (String(result.date_of_birth) >= String(result.admission_date))
      throw new Error('Admission must be after the date of birth.');
  }
  if(entity==='time_slots' && String(result.ends_at)<=String(result.starts_at))throw new Error('End time must be after the start time.');
  return result;
}
