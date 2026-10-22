export function can(permissions: readonly string[], permission: string) {
  return permissions.includes(permission);
}
export const roleLabels: Record<string, string> = {
  SUPER_ADMIN: 'Platform administrator',
  SCHOOL_ADMIN: 'School administrator',
  PRINCIPAL: 'Principal',
  TEACHER: 'Teacher',
  STUDENT: 'Learner',
  PARENT: 'Parent / guardian',
  ACCOUNTANT: 'Accountant',
  LIBRARIAN: 'Librarian',
};
