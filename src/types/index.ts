export type Role =
  | 'SUPER_ADMIN'
  | 'SCHOOL_ADMIN'
  | 'PRINCIPAL'
  | 'TEACHER'
  | 'STUDENT'
  | 'PARENT'
  | 'ACCOUNTANT'
  | 'LIBRARIAN';
export interface School {
  id: string;
  name: string;
  slug: string;
  contact_email: string | null;
  phone: string | null;
  address: string | null;
  timezone: string;
  currency: string;
  brand_color: string;
  version: number;
}
export interface Membership {
  school_id: string;
  role_id: Role;
  schools: School;
}
export interface Profile {
  id: string;
  display_name: string;
  active: boolean;
}
export interface Access {
  memberships: Membership[];
  permissions: string[];
  profile: Profile;
}
