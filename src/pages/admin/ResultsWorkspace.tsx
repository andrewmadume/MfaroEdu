import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSchool } from '../../contexts/SchoolContext';
import { can } from '../../lib/permissions';
import { academicSummary } from '../../lib/academics';
import { getRecord } from '../../services/directory';
import {
  publishedReports,
  batchReports,
  previewResults,
  publishResults,
  withdrawResults,
  reportNotes,
  saveNote,
  annualResults,
} from '../../services/academics';
import RecordLookup from '../../components/forms/RecordLookup';
import ReportCard from '../../components/common/ReportCard';
import Modal from '../../components/ui/Modal';
import { ErrorMessage, Loading } from '../../components/ui/Feedback';
import type { ReportDocument, PublishedReport } from '../../types/academics';
function NoteForm({
  d,
  classId,
  term,
  onSaved,
}: {
  d: ReportDocument;
  classId: string;
  term: string;
  onSaved: () => void;
}) {
  const { school } = useSchool();
  const [note, setNote] = useState(d.principal_comment),
    [promotion, setPromotion] = useState(d.promotion_status),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const q = useQuery({
    queryKey: ['report-notes', school.id, classId, term],
    queryFn: () => reportNotes(school.id, classId, term),
  });
  return (
    <form
      className="academic-form"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError('');
        try {
          await saveNote(
            school.id,
            classId,
            term,
            d.student_id,
            q.data?.find((n) => n.student_id === d.student_id)?.version ?? 0,
            note,
            promotion,
          );
          onSaved();
        } catch (e) {
          setError((e as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <h3>{d.student_name}</h3>
      <ErrorMessage message={error || (q.isError ? q.error.message : '')} />
      <label>
        Principal comment
        <textarea
          maxLength={2000}
          rows={4}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </label>
      <label>
        Promotion status
        <input
          maxLength={120}
          value={promotion}
          onChange={(e) => setPromotion(e.target.value)}
          placeholder="Enter the school’s decision"
        />
      </label>
      <button disabled={busy || q.isPending || q.isError}>
        {busy ? 'Saving…' : 'Save report notes'}
      </button>
    </form>
  );
}
export default function ResultsWorkspace() {
  const { school, permissions } = useSchool();
  const client = useQueryClient();
  const publish = can(permissions, 'results.publish');
  const [classId, setClassId] = useState(''),
    [term, setTerm] = useState(''),
    [page, setPage] = useState(0),
    [history, setHistory] = useState(false),
    [preview, setPreview] = useState<ReportDocument[] | null>(null),
    [selected, setSelected] = useState<ReportDocument | null>(null),
    [report, setReport] = useState<PublishedReport | null>(null),
    [printing, setPrinting] = useState<ReportDocument[]>([]),
    [analytics, setAnalytics] = useState<ReportDocument[] | null>(null),
    [note, setNote] = useState<ReportDocument | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const chosenClass = useQuery({
    queryKey: ['record', school.id, 'classes', classId],
    queryFn: () => getRecord(school.id, 'classes', classId),
    enabled: !!classId,
  });
  const academicYear = chosenClass.data?.academic_year_id as string | undefined;
  const q = useQuery({
    queryKey: ['published-reports', school.id, page, classId, term, history],
    queryFn: () => publishedReports(school.id, page, classId, term, history),
  });
  async function action(fn: () => Promise<void>) {
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function changeScope() {
    setPage(0);
    setPreview(null);
    setSelected(null);
    setReport(null);
    setAnalytics(null);
    setPrinting([]);
  }
  async function print(documents: ReportDocument[]) {
    setPrinting(documents);
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
    await Promise.all(
      [...document.querySelectorAll<HTMLImageElement>('#print-reports img')].map((img) =>
        img.decode().catch(() => undefined),
      ),
    );
    window.print();
  }
  return (
    <>
      <section className="panel">
        <h2>Results & report cards</h2>
        <p className="muted">
          Published term reports preserve the marks and grading rules used at release. Parents and
          learners see only their authorized reports.
        </p>
        <div className="form-grid">
          <RecordLookup
            entity="classes"
            label="Report class"
            value={classId}
            onChange={(v) => {
              setClassId(v);
              setTerm('');
              changeScope();
            }}
          />
          <RecordLookup
            entity="terms"
            label="Report term"
            disabled={!!classId && !academicYear}
            filters={academicYear ? { academic_year_id: academicYear } : {}}
            value={term}
            onChange={(v) => {
              setTerm(v);
              changeScope();
            }}
          />
        </div>
        <ErrorMessage message={error} />
        <div className="form-actions">
          {publish && (
            <>
              <button
                disabled={!classId || !term || busy}
                onClick={() =>
                  void action(async () => {
                    const docs = await previewResults(school.id, classId, term);
                    setPreview(docs);
                    setSelected(docs[0]);
                    setReport(null);
                  })
                }
              >
                Preview term results
              </button>
              <label>
                <input
                  type="checkbox"
                  checked={history}
                  onChange={(e) => {
                    setHistory(e.target.checked);
                    setPage(0);
                  }}
                />{' '}
                Include withdrawn reports
              </label>
            </>
          )}
          <button
            className="secondary"
            disabled={!classId || !term || busy}
            onClick={() =>
              void action(async () => {
                const docs = (await batchReports(school.id, classId, term)).map((r) => r.document);
                if (!docs.length)
                  throw new Error('There are no published reports in this selection.');
                await print(docs);
              })
            }
          >
            Print class / save PDF
          </button>
          {publish && (
            <button
              className="secondary"
              disabled={!classId || !term || busy}
              onClick={() =>
                void action(async () => {
                  setAnalytics(
                    (await batchReports(school.id, classId, term)).map((r) => r.document),
                  );
                })
              }
            >
              Academic report
            </button>
          )}
        </div>
        {preview && (
          <div className="publication-review">
            <h3>Review {preview.length} learner reports</h3>
            <p>
              Check each report before release. Publishing replaces the current release for this
              class and term; earlier snapshots remain in the audit history.
            </p>
            <label>
              Preview learner
              <select
                value={selected?.student_id ?? ''}
                onChange={(e) => {
                  setSelected(preview.find((d) => d.student_id === e.target.value)!);
                  setReport(null);
                }}
              >
                {preview.map((d) => (
                  <option key={d.student_id} value={d.student_id}>
                    {d.student_name}
                  </option>
                ))}
              </select>
            </label>
            <div className="form-actions">
              <button
                disabled={busy}
                onClick={() =>
                  void action(async () => {
                    if (
                      !window.confirm(`Publish ${preview.length} reports to authorized families?`)
                    )
                      return;
                    await publishResults(school.id, classId, term, preview);
                    setPreview(null);
                    setSelected(null);
                    await client.invalidateQueries({ queryKey: ['published-reports', school.id] });
                  })
                }
              >
                Publish reviewed results
              </button>
              <button
                className="secondary"
                disabled={busy}
                onClick={() => {
                  setPreview(null);
                  setSelected(null);
                }}
              >
                Cancel preview
              </button>
              {selected && (
                <button className="secondary" onClick={() => setNote(selected)}>
                  Principal notes & promotion
                </button>
              )}
            </div>
          </div>
        )}
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
                    <th>Class / term</th>
                    <th>Average</th>
                    <th>Published</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {q.data.rows.map((r) => (
                    <tr key={r.id}>
                      <th>
                        {r.document.student_name}
                        <small>{r.document.admission_number}</small>
                      </th>
                      <td>
                        {r.document.class_name} · {r.document.term_name}
                      </td>
                      <td>{r.document.average}%</td>
                      <td>
                        {new Date(r.created_at).toLocaleDateString()}{' '}
                        {!r.publication.active && <span className="badge">Withdrawn</span>}
                      </td>
                      <td className="row-actions">
                        <button
                          className="secondary compact"
                          onClick={() => {
                            setReport(r);
                            setSelected(r.document);
                            setPreview(null);
                          }}
                        >
                          View report
                        </button>
                        {r.publication.active && (
                          <button
                            className="secondary compact"
                            disabled={busy}
                            onClick={() =>
                              void action(async () => {
                                setSelected(
                                  await annualResults(school.id, r.document.year_id, r.student_id),
                                );
                                setReport(null);
                                setPreview(null);
                              })
                            }
                          >
                            Annual summary
                          </button>
                        )}
                        {publish && r.publication.active && (
                          <button
                            className="secondary compact"
                            disabled={busy}
                            onClick={() =>
                              void action(async () => {
                                if (
                                  !window.confirm(
                                    'Withdraw every learner report in this class and term publication? Families will lose access to this release.',
                                  )
                                )
                                  return;
                                await withdrawResults(
                                  school.id,
                                  r.publication.id,
                                  r.publication.version,
                                );
                                setSelected(null);
                                setReport(null);
                                await client.invalidateQueries({
                                  queryKey: ['published-reports', school.id],
                                });
                              })
                            }
                          >
                            Withdraw release
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!q.data.count && <p>No published reports available.</p>}
            <div className="form-actions">
              <button className="secondary" disabled={page === 0} onClick={() => setPage(page - 1)}>
                Previous reports
              </button>
              <span>{q.data.count} reports</span>
              <button
                className="secondary"
                disabled={(page + 1) * 20 >= q.data.count}
                onClick={() => setPage(page + 1)}
              >
                Next reports
              </button>
            </div>
          </>
        )}
      </section>
      {analytics && (
        <section className="panel">
          <h2>Academic report</h2>
          <p>
            {analytics.length} published learner reports ·{' '}
            {classId && term ? 'Selected class and term' : ''}
          </p>
          <p className="muted">
            Pass rates use the thresholds captured when reports were published. Exempt subjects are
            excluded.
          </p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Subject</th>
                  <th>Graded learners</th>
                  <th>Mean %</th>
                  <th>Pass rate</th>
                </tr>
              </thead>
              <tbody>
                {academicSummary(analytics).map((s) => (
                  <tr key={s.name}>
                    <th>{s.name}</th>
                    <td>{s.count}</td>
                    <td>{s.average}%</td>
                    <td>{s.passRate}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      {selected && (
        <section className="panel report-view">
          <div className="form-actions">
            <h2>
              {preview
                ? 'Draft preview'
                : report?.publication.active === false
                  ? 'Withdrawn report'
                  : 'Report'}
            </h2>
            <button
              className="secondary"
              disabled={!!preview || busy}
              onClick={() => void action(() => print([selected]))}
            >
              Print / save PDF
            </button>
          </div>
          <ReportCard document={selected} draft={!!preview} />
        </section>
      )}
      {note && (
        <Modal title="Report notes" onClose={() => setNote(null)}>
          <NoteForm
            d={note}
            classId={classId}
            term={term}
            onSaved={() => {
              setNote(null);
              void client.invalidateQueries({ queryKey: ['report-notes', school.id] });
              setPreview(null);
              setSelected(null);
            }}
          />
        </Modal>
      )}
      <div id="print-reports" aria-hidden="true">
        {printing.map((d, i) => (
          <ReportCard key={`${d.student_id}:${i}`} document={d} />
        ))}
      </div>
    </>
  );
}
