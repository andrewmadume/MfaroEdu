import { useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../contexts/AuthContext';
import { platformCall } from '../../services/advanced';
import type { PlatformSchool } from '../../types/advanced';
import { ErrorMessage, Loading } from '../../components/ui/Feedback';
import '../../app/advanced.css';
export default function PlatformPage() {
  const { session, loading } = useAuth();
  const [page, setPage] = useState(0);
  const report = useQuery({
    queryKey: ['platform-schools', session?.user.id, page],
    queryFn: () => platformCall<{ rows: PlatformSchool[]; count: number }>({ op: 'schools', page }),
    enabled: !!session,
    retry: false,
  });
  if (loading) return <Loading />;
  if (!session) return <Navigate to="/auth/login" replace />;
  return (
    <main className="platform-shell">
      <Link to="/">Back to school workspace</Link>
      <h1>Platform administration</h1>
      <p>
        Cross-school operational oversight for explicitly provisioned platform operators. School
        administrator roles do not grant platform access. Subscription metadata is informational; no
        payment collection or automatic suspension is performed.
      </p>
      {report.isPending ? (
        <Loading />
      ) : report.isError ? (
        <ErrorMessage message={report.error.message} />
      ) : (
        <section className="panel">
          <h2>{report.data.count} schools</h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>School</th>
                  <th>Workspace</th>
                  <th>Learners</th>
                  <th>Administrators</th>
                  <th>Plan / status</th>
                </tr>
              </thead>
              <tbody>
                {report.data.rows.map((s) => (
                  <tr key={s.id}>
                    <td>
                      <Link to={`/?school=${s.id}`}>{s.name}</Link>
                    </td>
                    <td>{s.slug}</td>
                    <td>{s.learners}</td>
                    <td>{s.administrators}</td>
                    <td>
                      {s.plan_code} / {s.status}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="draft-actions">
            <button disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
              Previous
            </button>
            <span>Page {page + 1}</span>
            <button
              disabled={(page + 1) * 20 >= report.data.count}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </button>
          </div>
        </section>
      )}
    </main>
  );
}
