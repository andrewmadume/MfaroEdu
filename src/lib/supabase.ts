import { createClient } from '@supabase/supabase-js';
import { emailCallbackTokens } from './authCallback';
const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const callback = emailCallbackTokens(window.location);
if (callback)
  window.history.replaceState(
    window.history.state,
    '',
    window.location.pathname + window.location.search,
  );
export const configured = Boolean(
  url && key && !url.includes('your-project') && key !== 'your-publishable-key',
);
export const supabase = configured
  ? createClient(url, key, {
      auth: {
        flowType: 'pkce',
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: !callback,
      },
    })
  : null;
export const authReady =
  callback && supabase
    ? supabase.auth.setSession(callback).then(({ error }) => {
        if (error)
          throw new Error(
            'This email link could not start a session. Request a fresh password link.',
          );
      })
    : Promise.resolve();
// AuthProvider handles the failure and renders recovery guidance; prevent an early unhandled rejection.
void authReady.catch(() => {});
export function database() {
  if (!supabase) throw new Error('School connection has not been configured.');
  return supabase;
}
