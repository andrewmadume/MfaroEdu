import { z } from 'zod';
export const loginSchema = z.object({
  email: z.email('Enter a valid email address.'),
  password: z.string().min(1, 'Enter your password.'),
});
export const passwordSchema = z.string().min(12, 'Use at least 12 characters.').max(128);
export const schoolSchema = z.object({
  name: z.string().trim().min(2).max(120),
  slug: z
    .string()
    .min(3)
    .max(63)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use lowercase letters, numbers and single hyphens.'),
  contact_email: z.union([z.email(), z.literal('')]),
  phone: z.string().max(30),
  address: z.string().max(500),
  timezone: z.string().refine((v) => {
    try {
      Intl.DateTimeFormat('en', { timeZone: v });
      return true;
    } catch {
      return false;
    }
  }, 'Enter a valid time zone.'),
  currency: z.string().regex(/^[A-Z]{3}$/, 'Use a three-letter currency code.'),
  brand_color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
});
