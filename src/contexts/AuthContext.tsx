import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { clearDrafts } from '../lib/offlineDrafts';
const Context = createContext<{
  session: Session | null;
  loading: boolean;
  error: string;
  signOut: () => Promise<void>;
}>({ session: null, loading: true, error: '', signOut: async () => {} });
export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(Boolean(supabase));
  const [error, setError] = useState('');
  useEffect(() => {
    if (!supabase) return;
    let mounted = true;
    const { data } = supabase.auth.onAuthStateChange((_event, value) => {
      if (_event === 'SIGNED_OUT') void clearDrafts().catch(() => {});
      if (mounted) {
        setSession(value);
        setLoading(false);
      }
    });
    supabase.auth
      .getSession()
      .then(({ data, error }) => {
        if (mounted) {
          setSession(data.session);
          setError(error ? 'Unable to restore your session. Please sign in again.' : '');
          setLoading(false);
        }
      })
      .catch(() => {
        if (mounted) {
          setError('Unable to connect. Please reload.');
          setLoading(false);
        }
      });
    return () => {
      mounted = false;
      data.subscription.unsubscribe();
    };
  }, []);
  async function signOut() {
    const result = await supabase?.auth.signOut();
    if (result?.error) throw new Error('Sign out failed. Please try again.');
    setSession(null);
  }
  return (
    <Context.Provider value={{ session, loading, error, signOut }}>{children}</Context.Provider>
  );
}
export const useAuth = () => useContext(Context);
