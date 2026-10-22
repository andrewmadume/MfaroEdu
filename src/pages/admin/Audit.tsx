import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { database } from '../../lib/supabase';
import { useSchool } from '../../contexts/SchoolContext';
import { Loading, ErrorMessage } from '../../components/ui/Feedback';
export default function Audit() {
  const { school } = useSchool();
  const [page, setPage] = useState(0);
  const query = useQuery({
    queryKey: ['audit', school.id, page],
    queryFn: async () => {
      const { data, error, count } = await database()
        .from('audit_logs')
        .select('id,action,entity,actor_id,created_at', { count: 'exact' })
        .eq('school_id', school.id)
        .order('created_at', { ascending: false })
        .order('id')
        .range(page * 20, page * 20 + 19);
      if (error) throw new Error('Could not load the audit trail.');
      return { rows: data, count: count ?? 0 };
    },
  });
  return (
    <>
      <header className="page-heading">
        <span className="eyebrow">ACCOUNTABILITY</span>
        <h1>Audit trail</h1>
        <p>A protected record of school and membership changes.</p>
      </header>
      <section className="panel">
        {query.isPending ? (
          <Loading />
        ) : query.isError ? (
          <ErrorMessage message={query.error.message} />
        ) : (
          <>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Action</th>
                    <th>Record</th>
                    <th>Account</th>
                  </tr>
                </thead>
                <tbody>
                  {query.data.rows.map((row) => (
                    <tr key={row.id}>
                      <td>
                        {new Intl.DateTimeFormat(undefined, {
                          dateStyle: 'medium',
                          timeStyle: 'short',
                          timeZone: school.timezone,
                        }).format(new Date(row.created_at))}
                      </td>
                      <td>{row.action}</td>
                      <td>{row.entity}</td>
                      <td className="mono">{row.actor_id ?? 'System'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!query.data.rows.length && <p>No recorded changes yet.</p>}
            <div className="pagination">
              <button className="secondary" disabled={!page} onClick={() => setPage((p) => p - 1)}>
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
          </>
        )}
      </section>
    </>
  );
}
