import { useState, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSchool } from '../../contexts/SchoolContext';
import { schoolToday, attendanceLabels } from '../../lib/operations';
import {
  attendanceSessions,
  createRegister,
  loadRegister,
  saveAttendance,
  setRegisterState,
} from '../../services/operations';
import { can } from '../../lib/permissions';
import RecordLookup from '../../components/forms/RecordLookup';
import { ErrorMessage, Loading } from '../../components/ui/Feedback';
import type { AttendanceRegister, AttendanceRow } from '../../types/operations';
function RegisterEditor({
  book,
  onSaved,
  onDirty,
}: {
  book: AttendanceRegister;
  onSaved: () => void;
  onDirty: (v: boolean) => void;
}) {
  const { school, permissions } = useSchool();
  const admin = can(permissions, 'attendance.manage');
  const initial = book.learners.map((r) => ({ ...r, status: r.status ?? ('UNMARKED' as const) }));
  const [rows, setRows] = useState<AttendanceRow[]>(initial),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const changed = rows.filter((r, i) => JSON.stringify(r) !== JSON.stringify(initial[i]));
  const editable = book.session.status === 'OPEN';
  useEffect(() => {
    onDirty(changed.length > 0);
  }, [changed.length, onDirty]);
  function update(id: string, values: Partial<AttendanceRow>) {
    setRows((v) => v.map((r) => (r.id === id ? { ...r, ...values } : r)));
  }
  async function state(next: 'OPEN' | 'FINAL' | 'VOID') {
    if (changed.length) {
      setError('Save or reload unsaved attendance first.');
      return;
    }
    if (
      !window.confirm(
        next === 'FINAL'
          ? 'Finalize this register and release attendance to authorized families?'
          : `${next === 'VOID' ? 'Void' : 'Reopen'} this register? It will be hidden from family attendance reports until finalized again.`,
      )
    )
      return;
    setBusy(true);
    setError('');
    try {
      await setRegisterState(school.id, book.session, next);
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <p>
        <strong>{book.session.name}</strong> · {book.session.attended_on} ·{' '}
        <span className="badge">{book.session.status}</span>
      </p>
      <p className="muted">
        Roster uses enrollment on this date. Present and late count as attended; attendance
        percentages include all finalized records.
      </p>
      <ErrorMessage message={error} />
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError('');
          try {
            await saveAttendance(school.id, book.session, changed);
            onDirty(false);
            onSaved();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="form-actions">
          <button
            type="button"
            className="secondary"
            disabled={!editable || busy}
            onClick={() =>
              setRows(rows.map((r) => (r.status === 'UNMARKED' ? { ...r, status: 'PRESENT' } : r)))
            }
          >
            Mark unmarked present
          </button>
          <span role="status">{changed.length} unsaved attendance changes</span>
        </div>
        <div className="table-wrap">
          <table className="attendance-grid">
            <thead>
              <tr>
                <th>Learner</th>
                <th>Attendance</th>
                <th>Reason / note</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <th scope="row">
                    {r.name}
                    <small>{r.admission_number}</small>
                  </th>
                  <td>
                    <select
                      aria-label={`Attendance for ${r.name}`}
                      disabled={!editable || busy}
                      value={r.status ?? 'UNMARKED'}
                      onChange={(e) =>
                        update(r.id, { status: e.target.value as AttendanceRow['status'] })
                      }
                    >
                      {Object.entries(attendanceLabels).map(([code, label]) => (
                        <option key={code} value={code}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <input
                      aria-label={`Reason for ${r.name}`}
                      disabled={!editable || busy}
                      maxLength={1000}
                      value={r.reason}
                      onChange={(e) => update(r.id, { reason: e.target.value })}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!rows.length && <p>No learners were enrolled on this date.</p>}
        <div className="form-actions">
          <button disabled={!editable || busy || !changed.length}>
            {busy ? 'Saving…' : 'Save attendance'}
          </button>
          {editable && (
            <button
              type="button"
              className="secondary"
              disabled={busy || !!changed.length || !rows.length}
              onClick={() => void state('FINAL')}
            >
              Finalize register
            </button>
          )}
          {admin && book.session.status !== 'OPEN' && (
            <button
              type="button"
              className="secondary"
              disabled={busy}
              onClick={() => void state('OPEN')}
            >
              Reopen register
            </button>
          )}
          {admin && book.session.status !== 'VOID' && (
            <button
              type="button"
              className="secondary"
              disabled={busy || !!changed.length}
              onClick={() => void state('VOID')}
            >
              Void register
            </button>
          )}
        </div>
      </form>
    </>
  );
}
export default function AttendanceWorkspace({ onUnsaved }: { onUnsaved: (v: boolean) => void }) {
  const { school } = useSchool();
  const client = useQueryClient();
  const today = schoolToday(school.timezone);
  const [classId, setClassId] = useState(''),
    [date, setDate] = useState(today),
    [name, setName] = useState('Daily'),
    [page, setPage] = useState(0),
    [selected, setSelected] = useState(''),
    [dirty, setDirty] = useState(false),
    [epoch, setEpoch] = useState(0),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const list = useQuery({
    queryKey: ['attendance-sessions', school.id, classId, date, page],
    queryFn: () => attendanceSessions(school.id, classId, date, date, page),
    enabled: !!classId,
  });
  const register = useQuery({
    queryKey: ['attendance-register', school.id, selected],
    queryFn: () => loadRegister(school.id, selected),
    enabled: !!selected,
    refetchOnWindowFocus: false,
    staleTime: 0,
  });
  useEffect(() => onUnsaved(dirty), [dirty, onUnsaved]);
  function discard() {
    return !dirty || window.confirm('Discard unsaved attendance?');
  }
  async function refresh() {
    await client.invalidateQueries({ queryKey: ['attendance-register', school.id] });
    await client.invalidateQueries({ queryKey: ['attendance-sessions', school.id] });
    await client.invalidateQueries({ queryKey: ['attendance-report', school.id] });
    await client.invalidateQueries({ queryKey: ['attendance-history', school.id] });
  }
  return (
    <>
      <section className="panel">
        <h2>Daily attendance</h2>
        <p className="muted">
          Create or reopen a class register. Families see finalized attendance only. Dates use{' '}
          {school.timezone}.
        </p>
        <div className="form-grid">
          <RecordLookup
            entity="classes"
            label="Attendance class"
            value={classId}
            onChange={(v) => {
              if (discard()) {
                setClassId(v);
                setSelected('');
                setDirty(false);
                setPage(0);
              }
            }}
          />
          <label>
            Attendance date
            <input
              type="date"
              max={today}
              value={date}
              onChange={(e) => {
                if (discard()) {
                  setDate(e.target.value);
                  setSelected('');
                  setDirty(false);
                  setPage(0);
                }
              }}
            />
          </label>
        </div>
        <form
          className="operations-inline"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!discard()) return;
            setError('');
            setBusy(true);
            try {
              const id = await createRegister(school.id, classId, date, name);
              setDirty(false);
              setSelected(id);
              await refresh();
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            Session name
            <input required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <button disabled={!classId || !date || busy}>
            {busy ? 'Opening…' : 'Open new register'}
          </button>
        </form>
        <ErrorMessage message={error || (list.isError ? list.error.message : '')} />
        {classId && list.isPending && <Loading />}
        {list.data && (
          <>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Session</th>
                    <th>Date</th>
                    <th>State</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {list.data.rows.map((s) => (
                    <tr key={s.id}>
                      <th>{s.name}</th>
                      <td>{s.attended_on}</td>
                      <td>{s.status}</td>
                      <td>
                        <button
                          className="secondary compact"
                          onClick={() => {
                            if (discard()) {
                              setSelected(s.id);
                              setDirty(false);
                              setEpoch((e) => e + 1);
                            }
                          }}
                        >
                          View register
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!list.data.count && <p>No registers for this class and date.</p>}
            <div className="form-actions">
              <button className="secondary" disabled={!page} onClick={() => setPage(page - 1)}>
                Previous registers
              </button>
              <span>{list.data.count} registers</span>
              <button
                className="secondary"
                disabled={(page + 1) * 20 >= list.data.count}
                onClick={() => setPage(page + 1)}
              >
                Next registers
              </button>
            </div>
          </>
        )}
      </section>
      {selected && (
        <section className="panel">
          <div className="section-heading">
            <h2>Class register</h2>
            <button
              className="secondary"
              onClick={() => {
                if (discard()) {
                  setDirty(false);
                  void register.refetch().then(() => setEpoch((e) => e + 1));
                }
              }}
            >
              Reload attendance
            </button>
          </div>
          {register.isPending ? (
            <Loading />
          ) : register.isError ? (
            <ErrorMessage message={register.error.message} />
          ) : (
            <RegisterEditor
              key={`${epoch}:${register.data.session.version}`}
              book={register.data}
              onDirty={setDirty}
              onSaved={() => void refresh()}
            />
          )}
        </section>
      )}
    </>
  );
}
