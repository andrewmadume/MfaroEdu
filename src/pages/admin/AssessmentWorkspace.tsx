import { useState, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSchool } from '../../contexts/SchoolContext';
import {
  assessments,
  saveAssessment,
  archiveAssessment,
  gradingRules,
  gradebook,
  saveMarks,
  subjectGradebook,
} from '../../services/academics';
import { percentage } from '../../lib/academics';
import { getRecord } from '../../services/directory';
import RecordLookup from '../../components/forms/RecordLookup';
import Modal from '../../components/ui/Modal';
import { ErrorMessage, Loading } from '../../components/ui/Feedback';
import type { Assessment, Gradebook as Book, MarkEntry, SubjectGrade } from '../../types/academics';
function AssessmentForm({
  allocation,
  term,
  existing,
  types,
  onSaved,
}: {
  allocation: string;
  term: string;
  existing?: Assessment;
  types: string[];
  onSaved: () => void;
}) {
  const { school } = useSchool();
  const [values, setValues] = useState({
      name: existing?.name ?? '',
      assessment_type: existing?.assessment_type ?? '',
      assessed_on: existing?.assessed_on ?? '',
      max_mark: String(existing?.max_mark ?? ''),
      weight: String(existing?.weight ?? ''),
    }),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  return (
    <form
      className="academic-form"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError('');
        try {
          await saveAssessment(
            school.id,
            {
              ...values,
              max_mark: Number(values.max_mark),
              weight: Number(values.weight),
              class_subject_id: allocation,
              term_id: term,
            },
            existing,
          );
          onSaved();
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Assessment could not be saved.');
        } finally {
          setBusy(false);
        }
      }}
    >
      <ErrorMessage message={error} />
      <label>
        Assessment name
        <input
          required
          maxLength={120}
          value={values.name}
          onChange={(e) => setValues({ ...values, name: e.target.value })}
        />
      </label>
      <label>
        Assessment type
        <select
          required
          value={values.assessment_type}
          onChange={(e) => setValues({ ...values, assessment_type: e.target.value })}
        >
          <option value="">Select type</option>
          {[...new Set([...types, ...(existing ? [existing.assessment_type] : [])])].map((t) => (
            <option key={t}>{t}</option>
          ))}
        </select>
      </label>
      <label>
        Assessment date
        <input
          required
          type="date"
          value={values.assessed_on}
          onChange={(e) => setValues({ ...values, assessed_on: e.target.value })}
        />
      </label>
      <div className="form-grid">
        <label>
          Maximum mark
          <input
            required
            type="number"
            min="0.01"
            max="100000"
            step="0.01"
            value={values.max_mark}
            onChange={(e) => setValues({ ...values, max_mark: e.target.value })}
          />
        </label>
        <label>
          Weight within subject
          <input
            required
            type="number"
            min="0.01"
            max="1000"
            step="0.01"
            value={values.weight}
            onChange={(e) => setValues({ ...values, weight: e.target.value })}
          />
        </label>
      </div>
      <p className="muted">
        Weights are normalized across applicable assessments. Absent counts as zero; exempt is
        excluded. Blank marks remain incomplete.
      </p>
      <button disabled={busy}>{busy ? 'Saving…' : 'Save assessment'}</button>
    </form>
  );
}
function MarkEditor({
  book,
  onSaved,
  onDirty,
  summary,
}: {
  book: Book;
  onSaved: () => void;
  onDirty: (dirty: boolean) => void;
  summary: SubjectGrade[];
}) {
  const { school } = useSchool();
  const [rows, setRows] = useState<MarkEntry[]>(
      book.learners.map((r) => ({ ...r, status: r.status ?? ('INCOMPLETE' as const) })),
    ),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [dirty, setDirty] = useState(false);
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  function change(id: string, values: Partial<MarkEntry>) {
    setRows(rows.map((r) => (r.id === id ? { ...r, ...values } : r)));
    setDirty(true);
    onDirty(true);
  }
  const changes = rows.filter(
    (r, i) =>
      JSON.stringify(r) !==
      JSON.stringify({ ...book.learners[i], status: book.learners[i].status ?? 'INCOMPLETE' }),
  );
  function contribution(r: MarkEntry) {
    const total = summary.find((s) => s.id === r.id);
    if (dirty) return 'Unsaved';
    if (!total || total.incomplete) return 'Incomplete';
    if (!total.denominator || r.status === 'EXEMPT') return '—';
    return `${(((r.status === 'ABSENT' ? 0 : ((r.mark ?? 0) / book.assessment.max_mark) * 100) * book.assessment.weight) / total.denominator).toFixed(2)}%`;
  }
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setError('');
        setBusy(true);
        try {
          await saveMarks(school.id, book.assessment, changes);
          setDirty(false);
          onDirty(false);
          onSaved();
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Marks could not be saved.');
        } finally {
          setBusy(false);
        }
      }}
    >
      <p>
        Maximum: <strong>{book.assessment.max_mark}</strong> · Weight:{' '}
        <strong>{book.assessment.weight}</strong>. Tab through cells to capture marks. Changes save
        together. Select Incomplete to clear a draft score while keeping its audit history.
        Incomplete marks prevent publication.
      </p>
      <ErrorMessage message={error} />
      <div className="table-wrap">
        <table className="gradebook">
          <thead>
            <tr>
              <th>Learner</th>
              <th>Status</th>
              <th>Raw mark</th>
              <th>Percentage</th>
              <th>Weighted contribution</th>
              <th>Teacher comment</th>
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
                    aria-label={`Status for ${r.name}`}
                    disabled={book.assessment.archived}
                    value={r.status ?? 'INCOMPLETE'}
                    onChange={(e) =>
                      change(r.id, {
                        status: e.target.value as MarkEntry['status'],
                        mark: e.target.value === 'MARKED' ? r.mark : null,
                      })
                    }
                  >
                    <option value="INCOMPLETE">Incomplete · pending</option>
                    <option value="MARKED">Marked</option>
                    <option value="ABSENT">Absent · zero</option>
                    <option value="EXEMPT">Exempt · excluded</option>
                  </select>
                </td>
                <td>
                  <input
                    aria-label={`Mark for ${r.name}`}
                    type="number"
                    min="0"
                    max={book.assessment.max_mark}
                    step="0.01"
                    disabled={
                      book.assessment.archived ||
                      (r.status !== null && r.status !== 'INCOMPLETE' && r.status !== 'MARKED')
                    }
                    value={r.mark ?? ''}
                    onChange={(e) =>
                      change(r.id, {
                        mark: e.target.value === '' ? null : Number(e.target.value),
                        status: 'MARKED',
                      })
                    }
                  />
                </td>
                <td>
                  {r.status === 'EXEMPT'
                    ? '—'
                    : r.status === 'ABSENT'
                      ? '0%'
                      : r.mark === null
                        ? '—'
                        : `${percentage(r.mark, book.assessment.max_mark)}%`}
                </td>
                <td>{contribution(r)}</td>
                <td>
                  <textarea
                    aria-label={`Comment for ${r.name}`}
                    disabled={book.assessment.archived}
                    maxLength={1000}
                    rows={2}
                    value={r.comment}
                    onChange={(e) => change(r.id, { comment: e.target.value })}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!rows.length && <p>No learners were enrolled in this class on the assessment date.</p>}
      <p className="muted">
        Weighted contributions use the saved assessment weights included in this learner’s subject
        total.
      </p>
      <div className="form-actions">
        <span role="status">{changes.length} unsaved learner changes</span>
        <button disabled={busy || !changes.length || book.assessment.archived}>
          {busy ? 'Saving…' : 'Save marks'}
        </button>
      </div>
    </form>
  );
}
export default function AssessmentWorkspace({
  onUnsaved,
}: {
  onUnsaved: (dirty: boolean) => void;
}) {
  const { school } = useSchool();
  const client = useQueryClient();
  const [reloadEpoch, setReloadEpoch] = useState(0);
  const [allocation, setAllocation] = useState(''),
    [term, setTerm] = useState(''),
    [page, setPage] = useState(0),
    [archived, setArchived] = useState(false),
    [editing, setEditing] = useState<Assessment | 'new' | null>(null),
    [selected, setSelected] = useState<Assessment | null>(null),
    [dirty, setDirty] = useState(false),
    [error, setError] = useState(''),
    [saving, setSaving] = useState(false);
  const rules = useQuery({
    queryKey: ['grading', school.id],
    queryFn: () => gradingRules(school.id),
  });
  const chosenAllocation = useQuery({
    queryKey: ['record', school.id, 'class_subjects', allocation],
    queryFn: () => getRecord(school.id, 'class_subjects', allocation),
    enabled: !!allocation,
  });
  const academicYear = (chosenAllocation.data?.class as { academic_year_id?: string } | undefined)
    ?.academic_year_id;
  const list = useQuery({
    queryKey: ['assessments', school.id, allocation, term, page, archived],
    queryFn: () => assessments(school.id, allocation, term, page, archived),
    enabled: !!allocation && !!term,
  });
  const book = useQuery({
    queryKey: ['gradebook', school.id, selected?.id],
    queryFn: () => gradebook(school.id, selected!.id),
    enabled: !!selected,
    refetchOnWindowFocus: false,
    staleTime: 0,
  });
  const summary = useQuery({
    queryKey: ['subject-gradebook', school.id, allocation, term],
    queryFn: () => subjectGradebook(school.id, allocation, term),
    enabled: !!allocation && !!term,
    refetchOnWindowFocus: false,
  });
  async function refresh() {
    await client.invalidateQueries({ queryKey: ['assessments', school.id] });
    await client.invalidateQueries({ queryKey: ['gradebook', school.id] });
    await client.invalidateQueries({ queryKey: ['subject-gradebook', school.id] });
  }
  function discard() {
    return !dirty || window.confirm('Discard unsaved marks?');
  }
  useEffect(() => onUnsaved(dirty), [dirty, onUnsaved]);
  return (
    <>
      <section className="panel">
        <h2>Assessments & gradebook</h2>
        <p className="muted">
          Select a class subject and term. Teacher access is limited to assigned subjects.
        </p>
        <div className="form-grid">
          <RecordLookup
            entity="class_subjects"
            filters={{ markable: true }}
            label="Class subject"
            value={allocation}
            onChange={(v) => {
              if (discard()) {
                setAllocation(v);
                setTerm('');
                setSelected(null);
                setDirty(false);
                setPage(0);
              }
            }}
          />
          <RecordLookup
            entity="terms"
            label="Term"
            disabled={!academicYear}
            filters={academicYear ? { academic_year_id: academicYear } : {}}
            value={term}
            onChange={(v) => {
              if (discard()) {
                setTerm(v);
                setSelected(null);
                setDirty(false);
                setPage(0);
              }
            }}
          />
        </div>
        <ErrorMessage message={error} />
        {rules.isError && <ErrorMessage message={rules.error.message} />}
        {!rules.isPending && !rules.isError && !rules.data && (
          <p className="alert">
            A school administrator must configure grading rules and assessment types first.
          </p>
        )}
        <div className="form-actions">
          <label>
            <input
              type="checkbox"
              checked={archived}
              onChange={(e) => {
                if (discard()) {
                  setArchived(e.target.checked);
                  setSelected(null);
                  setDirty(false);
                  setPage(0);
                }
              }}
            />{' '}
            Show archived assessments
          </label>
          <button
            disabled={!allocation || !term || !rules.data}
            onClick={() => {
              if (discard()) {
                setDirty(false);
                setSelected(null);
                setEditing('new');
              }
            }}
          >
            New assessment
          </button>
        </div>
        {list.isError && <ErrorMessage message={list.error.message} />}
        {allocation && term && list.isPending && <Loading />}
        {list.data && (
          <>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Assessment</th>
                    <th>Date</th>
                    <th>Type</th>
                    <th>Maximum</th>
                    <th>Weight</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {list.data.rows.map((a) => (
                    <tr key={a.id}>
                      <th>{a.name}</th>
                      <td>{a.assessed_on}</td>
                      <td>{a.assessment_type}</td>
                      <td>{a.max_mark}</td>
                      <td>{a.weight}</td>
                      <td className="row-actions">
                        <button
                          className="secondary compact"
                          onClick={() => {
                            if (discard()) {
                              setSelected(a);
                              setDirty(false);
                              setReloadEpoch((v) => v + 1);
                            }
                          }}
                        >
                          Gradebook
                        </button>
                        <button
                          className="secondary compact"
                          onClick={() => {
                            if (discard()) {
                              setDirty(false);
                              setSelected(null);
                              setEditing(a);
                            }
                          }}
                        >
                          Edit
                        </button>
                        <button
                          className="secondary compact"
                          disabled={saving}
                          onClick={async () => {
                            if (
                              !discard() ||
                              !window.confirm(
                                `${a.archived ? 'Restore' : 'Archive'} ${a.name}? Published reports retain their original marks.`,
                              )
                            )
                              return;
                            setSaving(true);
                            setError('');
                            try {
                              await archiveAssessment(school.id, a);
                              setSelected(null);
                              setDirty(false);
                              await refresh();
                            } catch (e) {
                              setError((e as Error).message);
                            } finally {
                              setSaving(false);
                            }
                          }}
                        >
                          {a.archived ? 'Restore' : 'Archive'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!list.data.count && <p>No assessments in this selection.</p>}
            <div className="form-actions">
              <button className="secondary" disabled={page === 0} onClick={() => setPage(page - 1)}>
                Previous assessments
              </button>
              <span>{list.data.count} assessments</span>
              <button
                className="secondary"
                disabled={(page + 1) * 20 >= list.data.count}
                onClick={() => setPage(page + 1)}
              >
                Next assessments
              </button>
            </div>
          </>
        )}
      </section>
      {selected && (
        <section className="panel">
          <h2>{selected.name} · gradebook</h2>
          <button
            className="secondary"
            onClick={() => {
              if (discard()) {
                setDirty(false);
                void book.refetch().then(() => setReloadEpoch((v) => v + 1));
              }
            }}
          >
            Reload marks
          </button>
          {book.isPending ? (
            <Loading />
          ) : book.isError ? (
            <>
              <ErrorMessage message={book.error.message} />
              <button onClick={() => void book.refetch()}>Reload gradebook</button>
            </>
          ) : (
            <MarkEditor
              key={`${reloadEpoch}:${book.data.assessment.version}:${book.data.learners.map((r) => r.version).join(',')}`}
              book={book.data}
              summary={summary.data ?? []}
              onDirty={setDirty}
              onSaved={() => void refresh()}
            />
          )}
        </section>
      )}
      {summary.isError && <ErrorMessage message={summary.error.message} />}
      {summary.data && (
        <section className="panel">
          <h2>Subject totals · draft</h2>
          <p className="muted">
            Assessment weights are normalized. Missing marks keep a total incomplete; absent is zero
            and exemptions are excluded. Save captured marks to update totals.
          </p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Learner</th>
                  <th>Subject %</th>
                  <th>Grade</th>
                  <th>Included weight</th>
                </tr>
              </thead>
              <tbody>
                {summary.data.map((s) => (
                  <tr key={s.id}>
                    <th>
                      {s.name}
                      <small>{s.admission_number}</small>
                    </th>
                    <td>{s.percent === null ? '—' : `${s.percent}%`}</td>
                    <td>{s.grade}</td>
                    <td>{s.denominator}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      {editing && (
        <Modal
          title={editing === 'new' ? 'New assessment' : 'Edit assessment'}
          onClose={() => setEditing(null)}
        >
          <AssessmentForm
            allocation={allocation}
            term={term}
            existing={editing === 'new' ? undefined : editing}
            types={rules.data?.assessment_types ?? []}
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
