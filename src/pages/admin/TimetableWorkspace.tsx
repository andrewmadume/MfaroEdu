import { useState, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSchool } from '../../contexts/SchoolContext';
import { getRecord } from '../../services/directory';
import { scheduleWeek, schedules, saveSchedule } from '../../services/operations';
import { weekdayNames, schoolToday, mondayOf, addDays } from '../../lib/operations';
import { can } from '../../lib/permissions';
import RecordLookup from '../../components/forms/RecordLookup';
import Modal from '../../components/ui/Modal';
import { ErrorMessage } from '../../components/ui/Feedback';
import type { Schedule, ScheduleInput } from '../../types/operations';
function ScheduleForm({
  term,
  existing,
  onSaved,
}: {
  term: string;
  existing?: Schedule;
  onSaved: () => void;
}) {
  const { school } = useSchool();
  const [values, setValues] = useState<ScheduleInput>({
      term_id: term,
      class_subject_id: existing?.class_subject_id ?? '',
      staff_id: existing?.staff_id ?? '',
      room_id: existing?.room_id ?? null,
      time_slot_id: existing?.time_slot_id ?? '',
      weekday: existing?.weekday ?? 1,
      active: existing?.active ?? true,
    }),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  return (
    <form
      className="academic-form"
      onSubmit={async (e) => {
        e.preventDefault();
        setError('');
        setBusy(true);
        try {
          await saveSchedule(school.id, values, existing);
          onSaved();
        } catch (e) {
          setError((e as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <ErrorMessage message={error} />
      <RecordLookup
        entity="class_subjects"
        label="Scheduled class subject"
        value={values.class_subject_id}
        onChange={(v) => setValues({ ...values, class_subject_id: v })}
      />
      <RecordLookup
        entity="staff"
        label="Scheduled teacher"
        filters={{ is_teacher: true, employment_status: 'ACTIVE' }}
        value={values.staff_id}
        onChange={(v) => setValues({ ...values, staff_id: v })}
      />
      <RecordLookup
        entity="time_slots"
        label="Scheduled time slot"
        value={values.time_slot_id}
        onChange={(v) => setValues({ ...values, time_slot_id: v })}
      />
      <RecordLookup
        entity="rooms"
        label="Scheduled room (optional)"
        value={values.room_id ?? ''}
        onChange={(v) => setValues({ ...values, room_id: v || null })}
      />
      <label>
        Weekday
        <select
          value={values.weekday}
          onChange={(e) => setValues({ ...values, weekday: Number(e.target.value) })}
        >
          {weekdayNames.map((d, i) => (
            <option key={d} value={i + 1}>
              {d}
            </option>
          ))}
        </select>
      </label>
      <p className="muted">
        Repeats on this weekday during the selected term, in the school’s local time. The teacher
        must be assigned to this subject. Conflicts are checked for every lesson date.
      </p>
      <button disabled={busy}>{busy ? 'Saving…' : 'Save scheduled lesson'}</button>
    </form>
  );
}
export default function TimetableWorkspace() {
  const { school, permissions } = useSchool();
  const manage = can(permissions, 'timetable.manage');
  const client = useQueryClient();
  const [term, setTerm] = useState(''),
    [kind, setKind] = useState<'CLASS' | 'TEACHER' | 'ROOM'>('CLASS'),
    [resource, setResource] = useState(''),
    [week, setWeek] = useState(schoolToday(school.timezone)),
    [page, setPage] = useState(0),
    [archived, setArchived] = useState(false),
    [editing, setEditing] = useState<Schedule | 'new' | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const selectedTerm = useQuery({
    queryKey: ['record', school.id, 'terms', term],
    queryFn: () => getRecord(school.id, 'terms', term),
    enabled: !!term,
  });
  useEffect(() => {
    if (selectedTerm.data) {
      const today = schoolToday(school.timezone);
      setWeek(
        today >= String(selectedTerm.data.starts_on) && today <= String(selectedTerm.data.ends_on)
          ? today
          : String(selectedTerm.data.starts_on),
      );
    }
  }, [selectedTerm.data?.id, school.timezone]);
  const weekly = useQuery({
    queryKey: ['timetable-week', school.id, term, week, kind, resource],
    queryFn: () => scheduleWeek(school.id, term, week, kind, resource),
    enabled: !!term && !!week && !!resource,
  });
  const list = useQuery({
    queryKey: ['schedules', school.id, term, page, archived],
    queryFn: () => schedules(school.id, term, null, page, !archived),
    enabled: manage && !!term,
  });
  async function refresh() {
    await client.invalidateQueries({ queryKey: ['schedules', school.id] });
    await client.invalidateQueries({ queryKey: ['timetable-week', school.id] });
  }
  return (
    <>
      <section className="panel">
        <h2>Weekly timetable</h2>
        <p className="muted">
          Class, teacher and room schedules use {school.timezone}. Lesson dates follow the term
          calendar; holiday exceptions are not configured in this release.
        </p>
        <div className="form-grid">
          <RecordLookup
            entity="terms"
            label="Timetable term"
            value={term}
            onChange={(v) => {
              setTerm(v);
              setPage(0);
            }}
          />
          <label>
            Timetable view
            <select
              value={kind}
              onChange={(e) => {
                setKind(e.target.value as typeof kind);
                setResource('');
              }}
            >
              <option value="CLASS">Class timetable</option>
              <option value="TEACHER">Teacher timetable</option>
              {manage && <option value="ROOM">Room timetable</option>}
            </select>
          </label>
          <RecordLookup
            key={kind}
            entity={kind === 'CLASS' ? 'classes' : kind === 'TEACHER' ? 'staff' : 'rooms'}
            label={
              kind === 'CLASS'
                ? 'Timetable class'
                : kind === 'TEACHER'
                  ? 'Timetable teacher'
                  : 'Timetable room'
            }
            value={resource}
            onChange={setResource}
            filters={kind === 'TEACHER' ? { timetable: true } : {}}
          />
          <label>
            Week containing
            <input type="date" value={week} onChange={(e) => setWeek(e.target.value)} />
          </label>
        </div>
        <div className="form-actions">
          <button
            className="secondary"
            disabled={!week}
            onClick={() => setWeek(addDays(mondayOf(week), -7))}
          >
            Previous week
          </button>
          <span>
            {week ? mondayOf(week) : 'Select a date'} – {week ? addDays(mondayOf(week), 6) : ''}
          </span>
          <button
            className="secondary"
            disabled={!week}
            onClick={() => setWeek(addDays(mondayOf(week), 7))}
          >
            Next week
          </button>
        </div>
        {selectedTerm.isError && <ErrorMessage message={selectedTerm.error.message} />}
        {weekly.isFetching && <p role="status">Loading timetable…</p>}
        {weekly.isError && <ErrorMessage message={weekly.error.message} />}
        {weekly.data && (
          <>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Day / date</th>
                    <th>Time</th>
                    <th>Class</th>
                    <th>Subject</th>
                    <th>Teacher</th>
                    <th>Room</th>
                  </tr>
                </thead>
                <tbody>
                  {weekly.data.map((l) => (
                    <tr key={`${l.id}:${l.lesson_on}`}>
                      <th>
                        {weekdayNames[l.weekday - 1]}
                        <small>{l.lesson_on}</small>
                      </th>
                      <td>
                        {l.starts_at}–{l.ends_at}
                      </td>
                      <td>{l.class_name}</td>
                      <td>{l.subject_name}</td>
                      <td>{l.teacher_name}</td>
                      <td>{l.room_name ?? 'Not assigned'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!weekly.data.length && <p>No scheduled lessons for this week and selection.</p>}
          </>
        )}
      </section>
      {manage && (
        <section className="panel">
          <div className="section-heading">
            <h2>Manage scheduled lessons</h2>
            <button disabled={!term} onClick={() => setEditing('new')}>
              New scheduled lesson
            </button>
          </div>
          <p className="muted">
            Select a term above. Archive a lesson to release its future and past planning slots
            while retaining the schedule record and audit history.
          </p>
          <label className="checkbox-field">
            <input
              type="checkbox"
              checked={archived}
              onChange={(e) => {
                setArchived(e.target.checked);
                setPage(0);
              }}
            />{' '}
            Show archived schedules
          </label>
          <ErrorMessage message={error || (list.isError ? list.error.message : '')} />
          {list.isFetching && <p role="status">Loading scheduled lessons…</p>}
          {list.data && (
            <>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Class / subject</th>
                      <th>Teacher</th>
                      <th>Day / time</th>
                      <th>Room</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.data.rows.map((s) => (
                      <tr key={s.id}>
                        <th>
                          {s.class_name} · {s.subject_name}
                        </th>
                        <td>{s.teacher_name}</td>
                        <td>
                          {weekdayNames[s.weekday - 1]} · {s.starts_at}–{s.ends_at}
                        </td>
                        <td>{s.room_name ?? 'Not assigned'}</td>
                        <td className="row-actions">
                          <button className="secondary compact" onClick={() => setEditing(s)}>
                            Edit schedule
                          </button>
                          <button
                            className="secondary compact"
                            disabled={busy}
                            onClick={async () => {
                              if (
                                !window.confirm(
                                  `${s.active ? 'Archive' : 'Restore'} this scheduled lesson?`,
                                )
                              )
                                return;
                              setBusy(true);
                              setError('');
                              try {
                                await saveSchedule(school.id, { ...s, active: !s.active }, s);
                                await refresh();
                              } catch (e) {
                                setError((e as Error).message);
                              } finally {
                                setBusy(false);
                              }
                            }}
                          >
                            {s.active ? 'Archive schedule' : 'Restore schedule'}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!list.data.count && <p>No schedules in this selection.</p>}
              <div className="form-actions">
                <button className="secondary" disabled={!page} onClick={() => setPage(page - 1)}>
                  Previous schedules
                </button>
                <span>{list.data.count} schedules</span>
                <button
                  className="secondary"
                  disabled={(page + 1) * 20 >= list.data.count}
                  onClick={() => setPage(page + 1)}
                >
                  Next schedules
                </button>
              </div>
            </>
          )}
        </section>
      )}
      {editing && (
        <Modal
          title={editing === 'new' ? 'New scheduled lesson' : 'Edit scheduled lesson'}
          onClose={() => setEditing(null)}
        >
          <ScheduleForm
            term={term}
            existing={editing === 'new' ? undefined : editing}
            onSaved={() => {
              setEditing(null);
              void refresh();
            }}
          />
        </Modal>
      )}
    </>
  );
}
