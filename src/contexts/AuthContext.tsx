import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase, authReady } from '../lib/supabase';
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
    const auth = supabase.auth;
    let mounted = true;
    let ready = false;
    const { data } = auth.onAuthStateChange((_event, value) => {
      if (_event === 'SIGNED_OUT') void clearDrafts().catch(() => {});
      if (mounted) {
        setSession(value);
        if (_event === 'SIGNED_IN') setError('');
        if (ready) setLoading(false);
      }
    });
    authReady
      .then(() => auth.getSession())
      .then(({ data, error }) => {
        if (mounted) {
          ready = true;
          setSession(data.session);
          setError(error ? 'Unable to restore your session. Please sign in again.' : '');
          setLoading(false);
        }
      })
      .catch(() => {
        if (mounted) {
          ready = true;
          setSession(null);
          setError(
            'This session could not be restored. Request a fresh password link or sign in again.',
          );
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
