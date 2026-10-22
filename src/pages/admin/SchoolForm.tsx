import { useState, type FormEvent } from 'react';
import type { School } from '../../types';
import { schoolSchema } from '../../schemas/foundation';
import { createSchool, updateSchool } from '../../services/schools';
import { ErrorMessage } from '../../components/ui/Feedback';
export default function SchoolForm({
  school,
  onSaved,
}: {
  school?: School;
  onSaved: () => Promise<unknown>;
}) {
  // Keep the version the form was opened against, even if background queries refresh.
  // Otherwise stale input could overwrite a concurrent edit using its newer version.
  const [baseline, setBaseline] = useState(school);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [success, setSuccess] = useState('');
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError('');
    setSuccess('');
    const values = Object.fromEntries(new FormData(e.currentTarget));
    const parsed = schoolSchema.safeParse({
      contact_email: '',
      phone: '',
      address: '',
      brand_color: '#0047d6',
      ...values,
    });
    if (!parsed.success) {
      setError(parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(' '));
      return;
    }
    setBusy(true);
    try {
      if (baseline) setBaseline(await updateSchool(baseline, parsed.data));
      else await createSchool(parsed.data);
      await onSaved();
      setSuccess('School details saved.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save your school.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="panel stack">
      <div className="section-heading">
        <h2>{school ? 'School details' : 'Set up your school'}</h2>
        <span className="badge">{school ? 'Administration' : 'First steps'}</span>
      </div>
      <p className="muted">
        {school
          ? 'Keep the information your community relies on up to date.'
          : 'Create a separate workspace for your school. A verified account is required.'}
      </p>
      <div className="form-grid">
        <label>
          School name
          <input name="name" required minLength={2} maxLength={120} defaultValue={school?.name} />
        </label>
        <label>
          School address name
          <input
            name="slug"
            required
            pattern="[a-z0-9]+(-[a-z0-9]+)*"
            minLength={3}
            maxLength={63}
            placeholder="your-school"
            defaultValue={school?.slug}
          />
          <small>Unique identifier, for example: mountain-view-school</small>
        </label>
        <label>
          Time zone
          <input
            name="timezone"
            required
            defaultValue={school?.timezone ?? 'Africa/Johannesburg'}
          />
        </label>
        <label>
          Currency code
          <input
            name="currency"
            required
            pattern="[A-Z]{3}"
            defaultValue={school?.currency ?? 'ZAR'}
          />
        </label>
        {school && (
          <>
            <label>
              Contact email
              <input name="contact_email" type="email" defaultValue={school.contact_email ?? ''} />
            </label>
            <label>
              Phone
              <input name="phone" maxLength={30} defaultValue={school.phone ?? ''} />
            </label>
            <label>
              Address
              <textarea name="address" maxLength={500} defaultValue={school.address ?? ''} />
            </label>
            <label>
              School colour
              <input name="brand_color" type="color" defaultValue={school.brand_color} />
            </label>
          </>
        )}
      </div>
      <ErrorMessage message={error} />
      {success && (
        <div role="status" className="alert success">
          {success}
        </div>
      )}
      <div>
        <button disabled={busy}>
          {busy ? 'Saving…' : school ? 'Save changes' : 'Create school'}
        </button>
      </div>
    </form>
  );
}
