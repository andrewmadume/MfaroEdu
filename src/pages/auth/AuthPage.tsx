import { useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { ShieldCheck, ArrowUpRight } from 'lucide-react';
import { database, configured } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { loginSchema, passwordSchema } from '../../schemas/foundation';
import { ErrorMessage } from '../../components/ui/Feedback';

export default function AuthPage() {
  const location = useLocation();
  const { session } = useAuth();
  const reset = location.pathname === '/auth/reset';
  const forgot = location.pathname === '/auth/forgot';
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [success, setSuccess] = useState('');
  if (session && !reset) return <Navigate to="/" replace />;
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setSuccess('');
    const form = new FormData(event.currentTarget);
    const email = String(form.get('email') || '').trim(),
      password = String(form.get('password') || '');
    setBusy(true);
    try {
      const db = database();
      if (forgot) {
        const result = await db.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/auth/reset`,
        });
        if (result.error)
          throw new Error('The reset request could not be sent. Please try again later.');
        setSuccess('If an account exists for this email, you will receive a password reset link.');
      } else if (reset) {
        const parsed = passwordSchema.safeParse(password);
        if (!parsed.success) throw new Error(parsed.error.issues[0].message);
        if (password !== form.get('confirm')) throw new Error('Passwords do not match.');
        const result = await db.auth.updateUser({ password });
        if (result.error)
          throw new Error('Password could not be changed. Request a new reset link and try again.');
        setSuccess('Password updated. You can return to your school.');
      } else {
        const parsed = loginSchema.safeParse({ email, password });
        if (!parsed.success) throw new Error(parsed.error.issues[0].message);
        const result = await db.auth.signInWithPassword(parsed.data);
        if (result.error)
          throw new Error(
            'Sign in failed. Check your email and password, and verify your email if required.',
          );
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Please try again.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="auth-layout">
      <section className="auth-story">
        <Link to="/" className="brand">
          <img
            className="brand-logo"
            src="/mfaroedu-logo.png"
            alt="MfaroEdu"
            width="240"
            height="160"
          />
        </Link>
        <div>
          <span className="eyebrow light">A LITTLE LESS ADMIN. MORE EDUCATION.</span>
          <h1>
            A connected school
            <br />
            starts here.
          </h1>
          <p>
            One home for your school community.
            <br />
            Built around the people who make it work.
          </p>
        </div>
        <div className="security-note">
          <ShieldCheck size={21} />
          Private by design. Connected by purpose.
        </div>
      </section>
      <main className="auth-form">
        <span className="eyebrow">YOUR SCHOOL WORKSPACE</span>
        <h2>{reset ? 'Choose a new password' : forgot ? 'Reset your password' : 'Welcome back'}</h2>
        <p className="muted">
          {reset
            ? 'Use at least 12 characters to protect your account.'
            : forgot
              ? 'We’ll email you a secure link to reset your password.'
              : 'Sign in with the account provided by your school.'}
        </p>
        {!configured ? (
          <div className="setup-card">
            <ShieldCheck />
            <h3>Connect your school workspace</h3>
            <p>
              This installation needs its Supabase connection before sign-in is available. Follow
              the setup guide supplied with this application.
            </p>
            <Link className="button secondary" to="/roadmap">
              View development roadmap <ArrowUpRight size={16} />
            </Link>
          </div>
        ) : (
          <form onSubmit={submit} className="stack">
            {!reset && (
              <label>
                Email address
                <input
                  name="email"
                  type="email"
                  autoComplete="username"
                  required
                  placeholder="you@school.edu"
                />
              </label>
            )}
            {!forgot && (
              <label>
                {reset ? 'New password' : 'Password'}
                <input
                  name="password"
                  type="password"
                  autoComplete={reset ? 'new-password' : 'current-password'}
                  required
                  minLength={reset ? 12 : 1}
                />
              </label>
            )}
            {reset && (
              <label>
                Confirm password
                <input
                  name="confirm"
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={12}
                />
              </label>
            )}
            <ErrorMessage message={error} />
            {success && (
              <p className="alert success" role="status">
                {success}
              </p>
            )}
            <button disabled={busy}>
              {busy
                ? 'Please wait…'
                : reset
                  ? 'Save password'
                  : forgot
                    ? 'Send reset link'
                    : 'Sign in'}
            </button>
            {!forgot && !reset && (
              <Link className="text-link" to="/auth/forgot">
                Forgot your password?
              </Link>
            )}
            {(forgot || reset) && (
              <Link className="text-link" to={session ? '/' : '/auth/login'}>
                {session ? 'Return to school' : 'Back to sign in'}
              </Link>
            )}
          </form>
        )}
        <p className="auth-foot">MfaroEdu · People & academics</p>
      </main>
    </div>
  );
}
