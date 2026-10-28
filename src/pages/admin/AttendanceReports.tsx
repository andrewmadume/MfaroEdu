import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSchool } from '../../contexts/SchoolContext';
import { attendanceSummary, attendanceHistory } from '../../services/operations';
import { getRecord } from '../../services/directory';
import { schoolToday, monthBounds, attendanceLabels } from '../../lib/operations';
import RecordLookup from '../../components/forms/RecordLookup';
import { ErrorMessage, Loading } from '../../components/ui/Feedback';
export default function AttendanceReports() {
  const { school } = useSchool();
  const today = schoolToday(school.timezone),
    month = monthBounds(today);
  const [from, setFrom] = useState(month.from),
    [to, setTo] = useState(today),
    [classId, setClassId] = useState(''),
    [learner, setLearner] = useState(''),
    [term, setTerm] = useState(''),
    [page, setPage] = useState(0),
    [historyPage, setHistoryPage] = useState(0),
    [termError, setTermError] = useState('');
  const q = useQuery({
    queryKey: ['attendance-report', school.id, from, to, classId, learner, page],
    queryFn: () => attendanceSummary(school.id, from, to, classId || null, learner || null, page),
    enabled: !!from && !!to,
  });
  const h = useQuery({
    queryKey: ['attendance-history', school.id, from, to, learner, historyPage],
    queryFn: () => attendanceHistory(school.id, from, to, learner, historyPage),
    enabled: !!learner && !!from && !!to,
  });
  async function chooseTerm(id: string) {
    setTerm(id);
    setPage(0);
    setHistoryPage(0);
    setTermError('');
    if (id) {
      try {
        const r = await getRecord(school.id, 'terms', id);
        setFrom(String(r.starts_on));
        setTo(String(r.ends_on));
      } catch (e) {
        setTermError((e as Error).message);
      }
    }
  }
  function range(a: string, b: string) {
    setFrom(a);
    setTo(b);
    setPage(0);
    setHistoryPage(0);
    setTerm('');
  }
  return (
    <>
      <section className="panel">
        <h2>Attendance reports</h2>
        <p className="muted">
          Finalized records only. Attendance % = present or late ÷ all recorded sessions. Excused
          records remain in the denominator; missing records and draft/void registers are excluded.
        </p>
        <div className="form-actions">
          <button className="secondary" onClick={() => range(today, today)}>
            Today
          </button>
          <button className="secondary" onClick={() => range(month.from, month.to)}>
            This month
          </button>
        </div>
        <div className="form-grid">
          <label>
            From date
            <input type="date" value={from} onChange={(e) => range(e.target.value, to)} />
          </label>
          <label>
            To date
            <input type="date" value={to} onChange={(e) => range(from, e.target.value)} />
          </label>
          <RecordLookup
            entity="classes"
            label="Filter attendance class"
            value={classId}
            onChange={(v) => {
              setClassId(v);
              setPage(0);
            }}
          />
          <RecordLookup
            entity="students"
            label="Attendance learner"
            value={learner}
            onChange={(v) => {
              setLearner(v);
              setPage(0);
              setHistoryPage(0);
            }}
          />
          <RecordLookup
            entity="terms"
            label="Attendance term"
            value={term}
            onChange={(v) => void chooseTerm(v)}
          />
        </div>
        <ErrorMessage message={termError} />
        {q.isPending ? (
          <Loading />
        ) : q.isError ? (
          <ErrorMessage message={q.error.message} />
        ) : (
          <>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Learner</th>
                    <th>Present</th>
                    <th>Absent</th>
                    <th>Late</th>
                    <th>Excused</th>
                    <th>Recorded</th>
                    <th>Attendance %</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {q.data.rows.map((r) => (
                    <tr key={r.student_id}>
                      <th>
                        {r.name}
                        <small>{r.admission_number}</small>
                      </th>
                      <td>{r.present}</td>
                      <td>{r.absent}</td>
                      <td>{r.late}</td>
                      <td>{r.excused}</td>
                      <td>{r.total}</td>
                      <td>{r.percentage === null ? '—' : `${r.percentage}%`}</td>
                      <td>
                        <button
                          className="secondary compact"
                          onClick={() => {
                            setLearner(r.student_id);
                            setHistoryPage(0);
                          }}
                        >
                          View history
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!q.data.count && <p>No finalized attendance in this range.</p>}
            <div className="form-actions">
              <button className="secondary" disabled={!page} onClick={() => setPage(page - 1)}>
                Previous learners
              </button>
              <span>{q.data.count} learners</span>
              <button
                className="secondary"
                disabled={(page + 1) * 20 >= q.data.count}
                onClick={() => setPage(page + 1)}
              >
                Next learners
              </button>
            </div>
          </>
        )}
      </section>
      {learner && (
        <section className="panel">
          <h2>Learner attendance history</h2>
          {h.isPending ? (
            <Loading />
          ) : h.isError ? (
            <ErrorMessage message={h.error.message} />
          ) : (
            <>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Class</th>
                      <th>Session</th>
                      <th>Attendance</th>
                      <th>Reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {h.data.rows.map((r, i) => (
                      <tr key={`${r.attended_on}:${r.class_name}:${r.session_name}:${i}`}>
                        <td>{r.attended_on}</td>
                        <td>{r.class_name}</td>
                        <td>{r.session_name}</td>
                        <td>
                          {attendanceLabels[r.status as keyof typeof attendanceLabels] ?? r.status}
                        </td>
                        <td>{r.reason || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!h.data.count && <p>No finalized records for this learner in this range.</p>}
              <div className="form-actions">
                <button
                  className="secondary"
                  disabled={!historyPage}
                  onClick={() => setHistoryPage(historyPage - 1)}
                >
                  Previous attendance
                </button>
                <span>{h.data.count} records</span>
                <button
                  className="secondary"
                  disabled={(historyPage + 1) * 20 >= h.data.count}
                  onClick={() => setHistoryPage(historyPage + 1)}
                >
                  Next attendance
                </button>
              </div>
            </>
          )}
        </section>
      )}
    </>
  );
}
