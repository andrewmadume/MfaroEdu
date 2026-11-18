import { useEffect, useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { database } from '../../lib/supabase';
import { passwordSchema } from '../../schemas/foundation';
import { schoolCall } from '../../services/schoolTools';
import { ErrorMessage, Loading } from '../../components/ui/Feedback';
import { roleLabels } from '../../lib/permissions';
export const invitationStorage = 'mfaroedu-pending-invitation';
export default function JoinSchool() {
  const { session, loading, signOut } = useAuth();
  const navigate = useNavigate();
  const [token] = useState(() => {
    const value = new URLSearchParams(window.location.hash.slice(1)).get('token');
    if (value !== null) return /^[a-f0-9]{64}$/.test(value) ? value : '';
    return sessionStorage.getItem(invitationStorage) ?? '';
  });
  useEffect(() => {
    if (token) sessionStorage.setItem(invitationStorage, token);
    else sessionStorage.removeItem(invitationStorage);
    if (window.location.hash) history.replaceState(history.state, '', '/join');
  }, [token]);
  const invitation = useQuery({
    queryKey: ['invitation-preview'],
    enabled: !!session && !!token && !loading,
    retry: false,
    queryFn: () =>
      schoolCall<{ school_name: string; role_id: string; expires_at: string }>(null, {
        op: 'invitation_preview',
        token,
      }),
  });
  const [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false);
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Request failed.');
    } finally {
      setBusy(false);
    }
  }
  async function register(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    void run(async () => {
      const password = passwordSchema.parse(String(f.get('password')));
      const { error } = await database().auth.signUp({
        email: String(f.get('email')).trim(),
        password,
        options: { emailRedirectTo: `${location.origin}/auth/reset` },
      });
      if (error)
        throw Error(
          'Account could not be created. If you already have an account, sign in or reset your password.',
        );
      setNotice(
        'Check your email to verify your account. After verification, return to this invitation link and accept it.',
      );
    });
  }
  if (loading) return <Loading />;
  return (
    <main className="onboarding">
      <section className="panel stack">
        <Link to="/">MfaroEdu</Link>
        <h1>Join your school</h1>
        <p>
          Invitations expire after seven days. Only the verified invited email address can accept a
          link.
        </p>
        <ErrorMessage message={error || (invitation.isError ? invitation.error.message : '')} />
        {notice && <p role="status">{notice}</p>}
        {!token ? (
          <p>Open the complete invitation link provided by your school administrator.</p>
        ) : session ? (
          <>
            <p>Signed in as {session.user.email}. Accept only an invitation you expected.</p>
            {invitation.data && (
              <p>
                Join <strong>{invitation.data.school_name}</strong> as{' '}
                {roleLabels[invitation.data.role_id]}. Expires{' '}
                {new Date(invitation.data.expires_at).toLocaleString()}.
              </p>
            )}
            <button
              disabled={busy || !invitation.data}
              onClick={() =>
                void run(async () => {
                  const result = await schoolCall<{ school_id: string }>(null, {
                    op: 'accept_invitation',
                    token,
                  });
                  sessionStorage.removeItem(invitationStorage);
                  navigate(`/?school=${result.school_id}`, { replace: true });
                })
              }
            >
              Accept invitation
            </button>
            <button className="secondary" disabled={busy} onClick={() => void run(signOut)}>
              Use a different account
            </button>
          </>
        ) : (
          <>
            <Link className="button" to="/auth/login">
              Sign in to accept
            </Link>
            <form className="stack" onSubmit={register}>
              <h2>Create your account</h2>
              <label>
                Invited email
                <input name="email" type="email" required autoComplete="username" />
              </label>
              <label>
                Choose a password
                <input
                  name="password"
                  type="password"
                  required
                  minLength={12}
                  maxLength={128}
                  autoComplete="new-password"
                />
              </label>
              <button disabled={busy}>Create account and verify email</button>
            </form>
          </>
        )}
        <button
          className="secondary"
          onClick={() => {
            sessionStorage.removeItem(invitationStorage);
            navigate('/', { replace: true });
          }}
        >
          Leave invitation
        </button>
      </section>
    </main>
  );
}
