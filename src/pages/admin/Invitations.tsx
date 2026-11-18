import { useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSchool } from '../../contexts/SchoolContext';
import { schoolCall } from '../../services/schoolTools';
import { roleLabels, can } from '../../lib/permissions';
import { ErrorMessage } from '../../components/ui/Feedback';
interface Invitation {
  id: string;
  email: string;
  role_id: string;
  expires_at: string;
  revoked: boolean;
  accepted: boolean;
  accepted_by?: string | null;
}
export default function Invitations() {
  const { school, permissions } = useSchool();
  const allowed = can(permissions, 'members.manage');
  const [link, setLink] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const q = useQuery({
    queryKey: ['invitations', school.id],
    queryFn: () => schoolCall<Invitation[]>(school.id, { op: 'invitations' }),
    enabled: allowed,
    retry: false,
  });
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError('');
    setLink('');
    try {
      const r = await schoolCall<{ token: string }>(school.id, {
        op: 'create_invitation',
        email: f.get('email'),
        role_id: f.get('role'),
      });
      setLink(`${location.origin}/join#token=${r.token}`);
      await q.refetch();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Invitation failed.');
    } finally {
      setBusy(false);
    }
  }
  if (!allowed) return null;
  return (
    <section className="panel stack">
      <h2>Invite a school account</h2>
      <p>
        Create a single-use link and share it privately with the intended recipient. This screen
        does not send email. The recipient can create an account, verify their email, then accept.
        Creating another link for the same email and role revokes the previous pending link.
      </p>
      <form className="stack" onSubmit={submit}>
        <label>
          Invitation email
          <input name="email" type="email" required maxLength={254} />
        </label>
        <label>
          Invitation role
          <select name="role" defaultValue="TEACHER">
            {Object.entries(roleLabels)
              .filter(([k]) => k !== 'SUPER_ADMIN')
              .map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
          </select>
        </label>
        <button disabled={busy}>Create invitation link</button>
      </form>
      <ErrorMessage message={error || (q.isError ? q.error.message : '')} />
      {link && (
        <label>
          Private invitation link
          <textarea readOnly value={link} rows={3} onFocus={(e) => e.currentTarget.select()} />
          <small>
            Copy this link now. It is not stored in a retrievable form. Valid for seven days.
          </small>
        </label>
      )}
      {q.data && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Email</th>
                <th>Role</th>
                <th>Expires</th>
                <th>Status</th>
                <th>Accepted account ID</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {q.data.map((i) => (
                <tr key={i.id}>
                  <td>{i.email}</td>
                  <td>{roleLabels[i.role_id]}</td>
                  <td>{new Date(i.expires_at).toLocaleDateString()}</td>
                  <td>
                    {i.accepted
                      ? 'Accepted'
                      : i.revoked
                        ? 'Revoked'
                        : Date.parse(i.expires_at) <= Date.now()
                          ? 'Expired'
                          : 'Pending'}
                  </td>
                  <td className="mono">{i.accepted_by || '—'}</td>
                  <td>
                    {!i.accepted && !i.revoked && (
                      <button
                        className="secondary"
                        disabled={busy}
                        onClick={async () => {
                          setBusy(true);
                          setError('');
                          try {
                            await schoolCall(school.id, { op: 'revoke_invitation', id: i.id });
                            setLink('');
                            await q.refetch();
                          } catch (e) {
                            setError(e instanceof Error ? e.message : 'Revocation failed.');
                          } finally {
                            setBusy(false);
                          }
                        }}
                      >
                        Revoke invitation
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p>Latest 50 invitations.</p>
        </div>
      )}
    </section>
  );
}
