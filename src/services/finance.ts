import { database } from '../lib/supabase';
// Display only deliberate business errors. Never expose Postgres details or personal data.
const safe =
  /^(Not authorized|Finance record changed; reload before saving|Request key already used for different details|Finance currency is locked after the first invoice|Use the school currency|Configure finance currency first|Select active fee resources|Select a learner enrolled in this academic year|Invalid invoice dates|Select between 1 and 100 invoice lines|Fee structure changed; reload before issuing|Fee does not apply to this learner grade|Invalid invoice quantity|Amount is outside the supported range|This invoice is void|Posting date must be between invoice date and today|Select an unreversed payment or concession|Reversal date cannot precede the original entry|Reverse all payments and concessions before voiding|Amount must be positive and no greater than the outstanding balance|Choose a payment method|A reason is required|Choose a date range of one year or less|Posting would make a historical balance negative; choose a later date)$/;
async function call<T>(name: string, tenant: string, request: Record<string, unknown>): Promise<T> {
  const { data, error } = await database().rpc(name, { tenant, request });
  if (error)
    throw new Error(
      safe.test(error.message)
        ? error.message + '.'
        : error.code === '23505'
          ? 'These details already exist. Reload before trying again.'
          : 'Finance request failed. Check your connection and access, then reload and try again.',
    );
  return data as T;
}
export const readFinance = <T>(tenant: string, request: Record<string, unknown>) =>
  call<T>('finance_read', tenant, request);
export const writeFinance = (tenant: string, request: Record<string, unknown>) =>
  call<{ id: string; entry_id?: string }>('finance_write', tenant, request);
