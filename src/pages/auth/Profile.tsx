import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useSchool } from '../../contexts/SchoolContext';
import { database } from '../../lib/supabase';
import { ErrorMessage } from '../../components/ui/Feedback';
export default function Profile() {
  const { access, refresh } = useSchool();
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [success, setSuccess] = useState('');
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const name = String(new FormData(e.currentTarget).get('name')).trim();
      if (!name) throw new Error('Enter your name.');
      const { error } = await database()
        .from('profiles')
        .update({ display_name: name })
        .eq('id', access.profile.id)
        .select('id')
        .single();
      if (error) throw new Error('Profile could not be saved.');
      await refresh();
      setSuccess('Profile saved.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Please try again.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <header className="page-heading">
        <span className="eyebrow">YOUR ACCOUNT</span>
        <h1>Profile & security</h1>
      </header>
      <form className="panel stack" onSubmit={submit}>
        <label>
          Display name
          <input name="name" required maxLength={120} defaultValue={access.profile.display_name} />
        </label>
        <ErrorMessage message={error} />
        {success && (
          <p role="status" className="alert success">
            {success}
          </p>
        )}
        <div>
          <button disabled={busy}>{busy ? 'Saving…' : 'Save profile'}</button>
        </div>
        <Link className="text-link" to="/auth/reset">
          Change password
        </Link>
      </form>
    </>
  );
}
