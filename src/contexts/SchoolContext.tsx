import { createContext, useContext, type ReactNode } from 'react';
import type { Access, School } from '../types';
export interface SchoolContextValue {
  access: Access;
  school: School;
  permissions: string[];
  refresh: () => Promise<unknown>;
}
const Context = createContext<SchoolContextValue | null>(null);
export const SchoolProvider = ({
  value,
  children,
}: {
  value: SchoolContextValue;
  children: ReactNode;
}) => <Context.Provider value={value}>{children}</Context.Provider>;
export function useSchool() {
  const value = useContext(Context);
  if (!value) throw new Error('School context unavailable');
  return value;
}
