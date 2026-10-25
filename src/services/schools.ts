import { database } from '../lib/supabase';
import type { Access, Membership, Profile, School } from '../types';
import { schoolSchema } from '../schemas/foundation';
export async function loadAccess(userId: string, schoolId?: string): Promise<Access> {
  const db = database();
  const [profile, memberships, platform] = await Promise.all([
    db.from('profiles').select('id,display_name,active').eq('id', userId).single(),
    db
      .from('user_roles')
      .select('school_id,role_id,schools(*)')
      .eq('user_id', userId)
      .eq('active', true),
    db.rpc('platform_read', { request: { op: 'access' } }),
  ]);
  if (profile.error || memberships.error)
    throw new Error('Could not load your school access. Please try again.');
  const rows = memberships.data as unknown as Membership[];
  if (
    platform.data?.allowed === true &&
    schoolId &&
    /^[0-9a-f-]{36}$/i.test(schoolId) &&
    !rows.some((m) => m.school_id === schoolId)
  ) {
    const target = await db.from('schools').select('*').eq('id', schoolId).single();
    if (!target.error && target.data)
      rows.push({ school_id: schoolId, role_id: 'SUPER_ADMIN', schools: target.data as School });
  }
  const selected = rows.find((m) => m.school_id === schoolId)?.school_id ?? rows[0]?.school_id;
  const result = selected
    ? await db.rpc('my_permissions', { target_school: selected })
    : { data: [], error: null };
  if (result.error) throw new Error('Could not verify your permissions. Please try again.');
  return {
    profile: profile.data as Profile,
    memberships: rows,
    permissions: result.data ?? [],
    platformAdmin: platform.data?.allowed === true,
  };
}
export async function createSchool(input: unknown) {
  const parsed = schoolSchema.parse(input);
  const { data, error } = await database().rpc('create_school', {
    school_name: parsed.name,
    school_slug: parsed.slug,
    school_timezone: parsed.timezone,
    school_currency: parsed.currency,
  });
  if (error)
    throw new Error(
      'School could not be created. Check that the school address is unique and try again.',
    );
  return data as string;
}
export async function updateSchool(school: School, input: unknown) {
  const parsed = schoolSchema.parse(input);
  const { data, error } = await database()
    .from('schools')
    .update({ ...parsed, contact_email: parsed.contact_email || null, version: school.version + 1 })
    .eq('id', school.id)
    .eq('version', school.version)
    .select()
    .single();
  if (error || !data)
    throw new Error(
      'Changes were not saved. Your access may have changed or another user edited this school. Reload before trying again.',
    );
  return data as School;
}
