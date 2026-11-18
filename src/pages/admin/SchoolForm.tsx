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
  const [logo, setLogo] = useState(school?.logo_data ?? '');
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
      logo_data: logo,
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
              School website
              <input
                name="website"
                type="url"
                maxLength={254}
                placeholder="https://school.example"
                defaultValue={school.website ?? ''}
              />
            </label>
            <label>
              School logo (PNG or JPEG, up to 200 KB)
              <input
                type="file"
                accept="image/png,image/jpeg"
                disabled={busy}
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  if (!['image/png', 'image/jpeg'].includes(f.type) || f.size > 200000) {
                    setError('Choose a PNG or JPEG logo up to 200 KB.');
                    return;
                  }
                  try {
                    const data = await new Promise<string>((resolve, reject) => {
                      const reader = new FileReader();
                      reader.onload = () => resolve(String(reader.result));
                      reader.onerror = () => reject(Error('Logo could not be read.'));
                      reader.readAsDataURL(f);
                    });
                    await new Promise<void>((resolve, reject) => {
                      const img = new Image();
                      img.onload = () => resolve();
                      img.onerror = () => reject(Error('This logo is not a readable image.'));
                      img.src = data;
                    });
                    setLogo(data);
                    setError('');
                  } catch (e) {
                    setError(e instanceof Error ? e.message : 'Logo could not be loaded.');
                  }
                }}
              />
            </label>
            {logo && (
              <div>
                <img src={logo} alt="School logo preview" width={150} />
                <button type="button" className="secondary" onClick={() => setLogo('')}>
                  Remove school logo
                </button>
              </div>
            )}
            <label>
              Report title
              <input
                name="report_title"
                required
                maxLength={100}
                defaultValue={school.report_title ?? 'Academic report card'}
              />
            </label>
            <label>
              Report footer
              <textarea
                name="report_footer"
                maxLength={500}
                defaultValue={school.report_footer ?? 'Empowering Schools. Inspiring Futures.'}
              />
            </label>
            <label>
              Report format
              <select name="report_layout" defaultValue={school.report_layout ?? 'STANDARD'}>
                <option value="STANDARD">Standard, with assessment details</option>
                <option value="COMPACT">Compact subject summary</option>
              </select>
            </label>
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
