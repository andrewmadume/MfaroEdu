import { useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { database } from '../../lib/supabase';
import { useSchool } from '../../contexts/SchoolContext';
import { roleLabels, can } from '../../lib/permissions';
import { ErrorMessage, Loading } from '../../components/ui/Feedback';
export default function Members() {
  const { school, permissions } = useSchool();
  const [page, setPage] = useState(0),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [success, setSuccess] = useState('');
  const query = useQuery({
    queryKey: ['members', school.id, page],
    queryFn: async () => {
      const { data, error, count } = await database()
        .from('user_roles')
        .select('user_id,role_id,active', { count: 'exact' })
        .eq('school_id', school.id)
        .order('user_id')
        .order('role_id')
        .range(page * 20, page * 20 + 19);
      if (error) throw new Error('Could not load memberships.');
      return { rows: data, count: count ?? 0 };
    },
  });
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      const { error } = await database().rpc('set_membership', {
        target_school: school.id,
        target_user: String(form.get('user')),
        target_role: String(form.get('role')),
        enabled: form.get('active') === 'true',
      });
      if (error)
        throw new Error(
          'Membership was not saved. Verify the account ID and your permissions. You cannot change your own membership or remove the last administrator.',
        );
      await query.refetch();
      setSuccess('Membership saved.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save membership.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <header className="page-heading">
        <span className="eyebrow">ADMINISTRATION</span>
        <h1>People & access</h1>
        <p>Manage who can work in {school.name}.</p>
      </header>
      {query.isPending ? (
        <Loading />
      ) : query.isError ? (
        <ErrorMessage message={query.error.message} />
      ) : (
        <section className="panel">
          <h2>School memberships</h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Account ID</th>
                  <th>Role</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {query.data.rows.map((row) => (
                  <tr key={`${row.user_id}-${row.role_id}`}>
                    <td className="mono">{row.user_id}</td>
                    <td>{roleLabels[row.role_id]}</td>
                    <td>
                      <span className="badge">{row.active ? 'Active' : 'Inactive'}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="pagination">
            <button
              className="secondary"
              disabled={page === 0}
              onClick={() => setPage((p) => p - 1)}
            >
              Previous
            </button>
            <span>Page {page + 1}</span>
            <button
              className="secondary"
              disabled={(page + 1) * 20 >= query.data.count}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </button>
          </div>
        </section>
      )}
      {can(permissions, 'members.manage') && (
        <form className="panel stack" onSubmit={submit}>
          <h2>Assign or update a role</h2>
          <p className="muted">
            Use an existing account ID from your identity administrator. Creating and inviting
            accounts through this screen is planned for the next phase.
          </p>
          <div className="form-grid">
            <label>
              Account ID
              <input name="user" required pattern="[0-9a-fA-F-]{36}" placeholder="Account UUID" />
            </label>
            <label>
              Role
              <select name="role">
                {Object.entries(roleLabels)
                  .filter(([key]) => key !== 'SUPER_ADMIN')
                  .map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              Access
              <select name="active">
                <option value="true">Active</option>
                <option value="false">Inactive</option>
              </select>
            </label>
          </div>
          <ErrorMessage message={error} />
          {success && (
            <p role="status" className="alert success">
              {success}
            </p>
          )}
          <div>
            <button disabled={busy}>{busy ? 'Saving…' : 'Save membership'}</button>
          </div>
        </form>
      )}
    </>
  );
}
