import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useSchool } from '../../contexts/SchoolContext';
import { advancedCall, exportLearners } from '../../services/advanced';
import {
  calendarIcs,
  downloadFile,
  importColumns,
  parseLearnersCsv,
  safeCsv,
} from '../../lib/advanced';
import type { Analytics, CalendarTerm, DataJob, ImportRow } from '../../types/advanced';
import { ErrorMessage, Loading } from '../../components/ui/Feedback';
import '../../app/advanced.css';
export default function AdvancedPage() {
  const { school, permissions } = useSchool();
  return (
    <AdvancedWorkspace
      key={school.id}
      tenant={school.id}
      name={school.name}
      permissions={permissions}
    />
  );
}
function AdvancedWorkspace({
  tenant,
  name,
  permissions,
}: {
  tenant: string;
  name: string;
  permissions: string[];
}) {
  const can = (p: string) => permissions.includes(p);
  const [tab, setTab] = useState('Reports'),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false);
  const today = new Date().toISOString().slice(0, 10);
  const [from, setFrom] = useState(today.slice(0, 4) + '-01-01'),
    [to, setTo] = useState(today),
    [range, setRange] = useState({ from, to });
  const [rows, setRows] = useState<ImportRow[]>([]),
    [job, setJob] = useState<DataJob | null>(null),
    [fileName, setFileName] = useState('');
  const report = useQuery({
    queryKey: ['advanced', tenant, range],
    queryFn: () => advancedCall<Analytics>('read', tenant, { op: 'analytics', ...range }),
    enabled: can('analytics.view'),
    retry: false,
  });
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The request could not be completed.');
    } finally {
      setBusy(false);
    }
  }
  async function discard() {
    if (job?.id) {
      try {
        await advancedCall('write', tenant, { op: 'discard_job', id: job.id });
      } catch (e) {
        if (!(e instanceof Error) || e.message !== 'Data job expired or unavailable') throw e;
      }
    }
    setJob(null);
  }
  const tabs = [
    ...(can('analytics.view') ? ['Reports', 'Integrations'] : []),
    ...(can('data.import') ? ['Import'] : []),
    ...(can('data.export') ? ['Export'] : []),
  ];
  if (!tabs.length)
    return (
      <section className="panel">
        <h1>Advanced workspace unavailable</h1>
        <p>Your school has not assigned reporting or data-transfer access.</p>
      </section>
    );
  const current = tabs.includes(tab) ? tab : tabs[0];
  return (
    <div className="advanced-workspace">
      <header className="page-heading">
        <span className="eyebrow">INFORMATION WITH PURPOSE</span>
        <h1>Reports & data</h1>
        <p>{name} · Current permissions are checked on every request.</p>
      </header>
      <div className="advanced-tabs" role="group" aria-label="Advanced modules">
        {tabs.map((t) => (
          <button
            className={current === t ? '' : 'secondary'}
            onClick={() => {
              setTab(t);
              setError('');
              setNotice('');
            }}
            key={t}
          >
            {t}
          </button>
        ))}
        {can('library.manage') && (
          <Link
            className="text-link"
            to={`/offline?school=${tenant}&name=${encodeURIComponent(name)}`}
          >
            Offline catalogue drafts
          </Link>
        )}
      </div>
      {error && <ErrorMessage message={error} />}{' '}
      {notice && (
        <p role="status" className="panel">
          {notice}
        </p>
      )}
      {(current === 'Reports' || current === 'Integrations') && (
        <form
          className="panel advanced-toolbar"
          onSubmit={(e) => {
            e.preventDefault();
            setRange({ from, to });
          }}
        >
          <label>
            From
            <input type="date" required value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label>
            To
            <input
              type="date"
              required
              min={from}
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </label>
          <button>Apply dates</button>
        </form>
      )}
      {current === 'Reports' &&
        (report.isPending ? (
          <Loading />
        ) : report.isError ? (
          <ErrorMessage message={report.error.message} />
        ) : (
          report.data && (
            <section className="advanced-report">
              <div className="section-heading">
                <h2>School operations</h2>
                <button className="secondary" onClick={() => window.print()}>
                  Print report
                </button>
                <button
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      downloadFile(
                        'mfaroedu-operations.json',
                        JSON.stringify(report.data, null, 2),
                        'application/json',
                      );
                    })
                  }
                >
                  Download report JSON
                </button>
              </div>
              <p className="muted">
                {range.from} to {range.to} · Generated{' '}
                {new Date(report.data.generated_at).toLocaleString()}
              </p>
              <div className="advanced-metrics">
                {[
                  ['Active learners', report.data.learners],
                  ['Active teachers', report.data.teachers],
                  ['Active classes', report.data.classes],
                ].map(([label, value]) => (
                  <article className="panel" key={label}>
                    <h3>{label}</h3>
                    <strong>{value}</strong>
                    <p>Current directory</p>
                  </article>
                ))}
              </div>
              {report.data.attendance && (
                <article className="panel">
                  <h2>Attendance in this period</h2>
                  <p>
                    {report.data.attendance.present} present / {report.data.attendance.late} late /{' '}
                    {report.data.attendance.absent} absent / {report.data.attendance.excused}{' '}
                    excused
                  </p>
                  <strong>
                    {report.data.attendance.percentage === null
                      ? 'No finalized attendance'
                      : `${report.data.attendance.percentage}% attended`}
                  </strong>
                  <p>{report.data.attendance.total} finalized learner sessions</p>
                </article>
              )}
              <article className="panel">
                <h2>Published academic results</h2>
                {report.data.academics.length === 0 ? (
                  <p>No active publications in this date range.</p>
                ) : (
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Year / grade</th>
                          <th>Term</th>
                          <th>Class</th>
                          <th>Reports</th>
                          <th>Average %</th>
                          <th>Pass count</th>
                        </tr>
                      </thead>
                      <tbody>
                        {report.data.academics.map((a, i) => (
                          <tr key={i}>
                            <td>
                              {a.year_name} · {a.grade_name}
                            </td>
                            <td>{a.term_name}</td>
                            <td>{a.class_name}</td>
                            <td>{a.reports}</td>
                            <td>
                              <div className="advanced-bar" aria-label={`Average ${a.average}%`}>
                                <span
                                  style={{ width: `${Math.max(0, Math.min(100, a.average))}%` }}
                                />
                              </div>
                              {a.average}
                            </td>
                            <td>{a.passed}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </article>
              {report.data.finance && (
                <article className="panel">
                  <h2>Finance movements</h2>
                  <p>
                    Ledger balance through {range.to}:{' '}
                    <strong>
                      {report.data.finance.balance_minor} minor units ({report.data.currency})
                    </strong>
                  </p>
                  <p className="muted">
                    Signed net movements include invoices, receipts, concessions, voids and
                    reversals. Negative balances represent credit; amounts remain exact integer
                    minor units.
                  </p>
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Month</th>
                          <th>Net minor units</th>
                        </tr>
                      </thead>
                      <tbody>
                        {report.data.finance.monthly.map((m) => (
                          <tr key={m.month}>
                            <td>{m.month}</td>
                            <td>{m.net_minor}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </article>
              )}
              {report.data.library && (
                <article className="panel">
                  <h2>Library circulation</h2>
                  <p>
                    {report.data.library.open_loans} currently open ·{' '}
                    {report.data.library.overdue_now} currently overdue ·{' '}
                    {report.data.library.issued_in_range} issued in the selected range
                  </p>
                </article>
              )}
              <article className="panel">
                <h2>Report scope</h2>
                <ul>
                  {report.data.limitations.map((v) => (
                    <li key={v}>{v}</li>
                  ))}
                </ul>
              </article>
            </section>
          )
        ))}
      {current === 'Import' && (
        <section className="panel">
          <h2>Import learners</h2>
          <p>
            Insert new learner profiles in one transaction. Up to 500 rows / 300 KB. Existing
            records, class placement, guardian links and accounts are never overwritten or created
            by this import. Files stay in memory and previews expire after 15 minutes.
          </p>
          <button
            className="secondary"
            onClick={() =>
              downloadFile(
                'learner-import-template.csv',
                safeCsv([], importColumns),
                'text/csv;charset=utf-8',
              )
            }
          >
            Download CSV template
          </button>
          <label>
            Choose learner CSV
            <input
              type="file"
              accept=".csv,text/csv"
              disabled={busy}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                void run(async () => {
                  await discard();
                  setRows([]);
                  setFileName('');
                  if (file.size > 300000) throw new Error('Use a CSV file smaller than 300 KB.');
                  const parsed = parseLearnersCsv(await file.text());
                  setRows(parsed);
                  setFileName(file.name);
                });
              }}
            />
          </label>
          {rows.length > 0 && (
            <>
              <p>
                {fileName} · {rows.length} learners · First {Math.min(10, rows.length)} shown
              </p>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      {importColumns.map((c) => (
                        <th key={c}>{c}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.slice(0, 10).map((r, i) => (
                      <tr key={i}>
                        {importColumns.map((c) => (
                          <td key={c}>{r[c]}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <button
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await discard();
                    setJob(
                      await advancedCall<DataJob>('write', tenant, { op: 'preview_import', rows }),
                    );
                  })
                }
              >
                Validate import
              </button>
            </>
          )}
          {job && (
            <>
              <p>
                {job.id
                  ? 'Validation passed. Review the rows above before committing. No learner has been saved yet.'
                  : `Correct ${job.errors.length} validation issue(s) and upload the corrected file.`}
              </p>
              <ul>
                {job.errors.map((e, i) => (
                  <li key={i}>
                    Row {e.row}: {e.message}
                  </li>
                ))}
              </ul>
              {job.id && (
                <>
                  <button
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        const result = await advancedCall<{ count: number }>('write', tenant, {
                          op: 'commit_import',
                          id: job.id,
                        });
                        setNotice(
                          `${result.count} learners imported. Class and guardian assignments can now be added in Learners.`,
                        );
                        setJob(null);
                        setRows([]);
                        void report.refetch();
                      })
                    }
                  >
                    Confirm import of {job.count} learners
                  </button>
                  <button className="secondary" disabled={busy} onClick={() => void run(discard)}>
                    Discard preview
                  </button>
                </>
              )}
            </>
          )}
        </section>
      )}
      {current === 'Export' && (
        <section className="panel">
          <h2>Export learners</h2>
          <p>
            Download a consistent snapshot of up to 10,000 current and archived learners. Exports
            contain personal information: use an approved destination and remove downloaded copies
            when no longer needed. Spreadsheet formula prefixes are escaped. Export creation is
            audited.
          </p>
          <button
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const exported = await exportLearners(tenant);
                downloadFile(
                  'mfaroedu-learners.csv',
                  safeCsv(exported, [
                    'admission_number',
                    'first_name',
                    'surname',
                    'date_of_birth',
                    'admission_date',
                    'status',
                    'archived',
                  ]),
                  'text/csv;charset=utf-8',
                );
                setNotice(`${exported.length} learners exported.`);
              })
            }
          >
            {busy ? 'Preparing export…' : 'Download learner CSV'}
          </button>
        </section>
      )}
      {current === 'Integrations' && (
        <section className="panel">
          <h2>Portable integrations</h2>
          <p>
            These downloads are initiated by you. No school data is automatically sent to a
            third-party service.
          </p>
          <h3>School calendar</h3>
          <p>
            Download the academic terms overlapping the selected dates as an iCalendar file. Import
            it into Outlook, Microsoft 365, Google Calendar or another calendar app. This is a file
            import, not a live subscription; repeating an import may create duplicates in some
            calendar apps.
          </p>
          <button
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const terms = await advancedCall<CalendarTerm[]>('read', tenant, {
                  op: 'calendar',
                  ...range,
                });
                downloadFile(
                  'mfaroedu-terms.ics',
                  calendarIcs(terms),
                  'text/calendar;charset=utf-8',
                );
                setNotice(`${terms.length} terms downloaded.`);
              })
            }
          >
            Download calendar
          </button>
          <h3>AI-ready context</h3>
          <p>
            Download versioned whole-school counts for a future analysis service. Counts below ten
            are suppressed. No names, identifiers, marks, messages or financial records are
            included. Review before sharing; combining datasets can still identify people. This does
            not perform AI analysis or automated learner decisions.
          </p>
          <button
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const data = await advancedCall('read', tenant, { op: 'ai_context', ...range });
                downloadFile(
                  'mfaroedu-analysis-context.json',
                  JSON.stringify(data, null, 2),
                  'application/json',
                );
              })
            }
          >
            Download analysis context
          </button>
        </section>
      )}
    </div>
  );
}
