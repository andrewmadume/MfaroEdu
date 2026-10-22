import { useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSchool } from '../../contexts/SchoolContext';
import { can } from '../../lib/permissions';
import { displayValue } from '../../lib/directory';
import {
  loadEnrollments,
  enroll,
  closeEnrollment,
  type Enrollment,
} from '../../services/enrollments';
import RecordLookup from '../../components/forms/RecordLookup';
import Modal from '../../components/ui/Modal';
import { Loading, ErrorMessage } from '../../components/ui/Feedback';
export default function EnrollmentPanel({
  student,
  archived,
}: {
  student: string;
  archived: boolean;
}) {
  const { school, permissions } = useSchool();
  const client = useQueryClient();
  const [page, setPage] = useState(0);
  const [dialog, setDialog] = useState<{
    mode: 'new' | 'move' | 'close';
    record?: Enrollment;
  } | null>(null);
  const [classId, setClassId] = useState(''),
    [yearId, setYearId] = useState(''),
    [error, setError] = useState(''),
    [success, setSuccess] = useState(''),
    [busy, setBusy] = useState(false);
  const query = useQuery({
    queryKey: ['enrollments', school.id, student, page],
    queryFn: () => loadEnrollments(school.id, student, page),
  });
  const manage = can(permissions, 'enrollments.manage');
  function open(mode: 'new' | 'move' | 'close', record?: Enrollment) {
    setDialog({ mode, record });
    setClassId('');
    setYearId('');
    setError('');
    setSuccess('');
  }
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!dialog) return;
    const data = new FormData(e.currentTarget);
    setBusy(true);
    setError('');
    try {
      if (dialog.mode === 'close')
        await closeEnrollment(
          school.id,
          dialog.record!,
          String(data.get('end')),
          String(data.get('status')),
        );
      else {
        if (!classId) throw new Error('Select a class.');
        await enroll(
          school.id,
          student,
          classId,
          String(data.get('start')),
          dialog.record,
          String(data.get('end') ?? ''),
          String(data.get('status') ?? 'TRANSFERRED'),
        );
      }
      setDialog(null);
      setSuccess('Enrollment saved. Earlier records have been retained.');
      await client.invalidateQueries({
        predicate: (q) =>
          ['enrollments', 'directory', 'school-counts', 'lookup'].includes(String(q.queryKey[0])),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save enrollment.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel">
      <div className="section-heading">
        <div>
          <h2>Enrollment history</h2>
          <p className="muted">Each class placement is retained in its academic year.</p>
        </div>
        {manage && !archived && <button onClick={() => open('new')}>Enroll learner</button>}
      </div>
      {success && (
        <p className="alert success" role="status">
          {success}
        </p>
      )}
      {query.isPending ? (
        <Loading />
      ) : query.isError ? (
        <ErrorMessage message={query.error.message} />
      ) : (
        <>
          {!query.data.count ? (
            <div className="empty-state">
              <p>No enrollments recorded.</p>
            </div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Academic year</th>
                    <th>Class</th>
                    <th>From</th>
                    <th>Until</th>
                    <th>Status</th>
                    {manage && <th>Actions</th>}
                  </tr>
                </thead>
                <tbody>
                  {query.data.rows.map((row) => (
                    <tr key={row.id}>
                      <td>{displayValue(row.year)}</td>
                      <td>{displayValue(row.class)}</td>
                      <td>{row.starts_on}</td>
                      <td>{row.ends_on ?? 'Open'}</td>
                      <td>{row.status}</td>
                      {manage && (
                        <td>
                          {row.status === 'ACTIVE' && (
                            <div className="row-actions">
                              <button
                                className="secondary compact"
                                onClick={() => open('move', row)}
                              >
                                Move / promote
                              </button>
                              <button
                                className="secondary compact"
                                onClick={() => open('close', row)}
                              >
                                Close enrollment
                              </button>
                            </div>
                          )}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="pagination">
            <span>{query.data.count} enrollments</span>
            <button className="secondary" disabled={!page} onClick={() => setPage((p) => p - 1)}>
              Previous
            </button>
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
      {dialog && (
        <Modal
          title={
            dialog.mode === 'new'
              ? 'Enroll learner'
              : dialog.mode === 'move'
                ? 'Move or promote learner'
                : 'Close enrollment'
          }
          onClose={() => {
            if (!busy) setDialog(null);
          }}
        >
          <form onSubmit={submit} className="stack">
            {dialog.mode !== 'close' && (
              <>
                <RecordLookup
                  entity="academic_years"
                  label="Academic year"
                  value={yearId}
                  onChange={(id) => {
                    setYearId(id);
                    setClassId('');
                  }}
                  disabled={busy}
                />
                {yearId && (
                  <RecordLookup
                    key={yearId}
                    entity="classes"
                    label="Destination class"
                    value={classId}
                    onChange={setClassId}
                    filters={{ academic_year_id: yearId }}
                    disabled={busy}
                  />
                )}
                <label>
                  New enrollment starts
                  <input name="start" type="date" required disabled={busy} />
                </label>
              </>
            )}
            {dialog.mode !== 'new' && (
              <>
                <p className="muted">
                  The current record will be closed, not replaced. When moving, the end date must be
                  before the new enrollment starts.
                </p>
                <label>
                  Current enrollment ends
                  <input
                    name="end"
                    type="date"
                    required
                    min={dialog.record?.starts_on}
                    disabled={busy}
                  />
                </label>
                <label>
                  Reason
                  <select name="status" disabled={busy}>
                    <option value="TRANSFERRED">Transferred to another class or school</option>
                    <option value="COMPLETED">Completed / promoted</option>
                    {dialog.mode === 'close' && <option value="WITHDRAWN">Withdrawn</option>}
                  </select>
                </label>
              </>
            )}
            <ErrorMessage message={error} />
            <div className="form-actions">
              <button disabled={busy}>{busy ? 'Saving…' : 'Save enrollment'}</button>
              <button
                type="button"
                className="secondary"
                disabled={busy}
                onClick={() => setDialog(null)}
              >
                Cancel
              </button>
            </div>
          </form>
        </Modal>
      )}
    </section>
  );
}
