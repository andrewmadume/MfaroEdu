import { useState, type ChangeEvent } from 'react';
import { useSchool } from '../../contexts/SchoolContext';
import { schoolCall } from '../../services/schoolTools';
import { parseLearnersCsv, safeCsv, downloadFile } from '../../lib/advanced';
import type { DataJob } from '../../types/advanced';
import { ErrorMessage } from '../../components/ui/Feedback';
const templates: Record<string, string[]> = {
  staff: ['employee_number', 'first_name', 'surname', 'position', 'department', 'email'],
  subjects: ['code', 'name', 'description'],
};
const labels: Record<string, string> = {
  staff: 'Teachers',
  subjects: 'Subjects',
  attendance: 'Attendance',
  results: 'Published results',
  fees: 'Fee ledger',
  library: 'Library transactions',
};
export default function DirectoryTransfers({ mode }: { mode: 'import' | 'export' }) {
  const { school, permissions } = useSchool();
  const modules = Object.keys(mode === 'import' ? templates : labels).filter((m) =>
    permissions.includes(
      m === 'staff'
        ? mode === 'import'
          ? 'staff.manage'
          : 'staff.view'
        : m === 'subjects'
          ? mode === 'import'
            ? 'academics.manage'
            : 'academics.view'
          : m === 'fees'
            ? 'finance.reports'
            : m === 'results'
              ? 'results.publish'
              : m === 'library'
                ? 'library.reports'
                : 'attendance.view',
    ),
  );
  const [module, setModule] = useState(modules[0] ?? 'staff'),
    [rows, setRows] = useState<Record<string, unknown>[]>([]),
    [job, setJob] = useState<DataJob | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  if (!modules.length) return null;
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Transfer failed.');
    } finally {
      setBusy(false);
    }
  }
  async function discard() {
    if (job?.id) await schoolCall(school.id, { op: 'discard', id: job.id }, true);
    setJob(null);
  }
  async function chooseFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    void run(async () => {
      await discard();
      setRows([]);
      if (file.size > 300000) throw Error('Use a CSV smaller than 300 KB.');
      setRows(
        parseLearnersCsv(await file.text(), templates[module]) as unknown as Record<
          string,
          unknown
        >[],
      );
    });
  }
  async function exportData() {
    const started = await schoolCall<DataJob>(school.id, { op: 'start_export', module }, true);
    if (!started.id) throw Error('Export did not start.');
    try {
      const records: Record<string, unknown>[] = [];
      for (let page = 0; page < Math.max(1, Math.ceil(started.count / 250)); page++) {
        const result = await schoolCall<{ rows: Record<string, unknown>[] }>(
          school.id,
          { op: 'export_page', id: started.id, page },
          true,
        );
        records.push(...result.rows);
      }
      if (records.length !== started.count) throw Error('Export interrupted; start again.');
      const flat = records.map((r) =>
        Object.fromEntries(
          Object.entries(r).map(([k, v]) => [
            k,
            typeof v === 'object' && v !== null ? JSON.stringify(v) : v,
          ]),
        ),
      );
      downloadFile(
        `mfaroedu-${module}.csv`,
        safeCsv(flat, flat.length ? Object.keys(flat[0]) : (templates[module] ?? ['id'])),
        'text/csv;charset=utf-8',
      );
      setNotice(`${started.count} ${labels[module].toLowerCase()} exported.`);
    } finally {
      await schoolCall(school.id, { op: 'discard', id: started.id }, true).catch(() => {});
    }
  }
  return (
    <section className="panel stack">
      <h2>{mode === 'import' ? 'Import teachers or subjects' : 'Export school records'}</h2>
      <p>
        {mode === 'import'
          ? 'Validate up to 500 records before confirming an atomic import. Teachers are registered as staff profiles; this does not create accounts or teaching assignments.'
          : 'Download an authorized, audited snapshot of up to 10,000 records. Files contain private information. Use approved storage and retention. Spreadsheet formulas are escaped.'}
      </p>
      <label>
        {mode === 'import' ? 'Import type' : 'Export type'}
        <select
          disabled={busy}
          value={module}
          onChange={(e) => {
            const value = e.target.value;
            void run(async () => {
              await discard();
              setModule(value);
              setRows([]);
            });
          }}
        >
          {modules.map((m) => (
            <option key={m} value={m}>
              {labels[m]}
            </option>
          ))}
        </select>
      </label>
      <ErrorMessage message={error} />
      {notice && <p role="status">{notice}</p>}
      {mode === 'export' ? (
        <button disabled={busy} onClick={() => void run(exportData)}>
          Download selected CSV
        </button>
      ) : (
        <>
          <button
            className="secondary"
            onClick={() =>
              downloadFile(
                `${module}-import-template.csv`,
                safeCsv([], templates[module]),
                'text/csv;charset=utf-8',
              )
            }
          >
            Download additional CSV template
          </button>
          <label>
            Choose additional CSV
            <input
              key={module}
              disabled={busy}
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => void chooseFile(e)}
            />
          </label>
          {!!rows.length && (
            <>
              <p>{rows.length} records · first ten shown</p>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      {templates[module].map((c) => (
                        <th key={c}>{c}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.slice(0, 10).map((r, i) => (
                      <tr key={i}>
                        {templates[module].map((c) => (
                          <td key={c}>{String(r[c] ?? '')}</td>
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
                      await schoolCall<DataJob>(school.id, { op: 'preview', module, rows }, true),
                    );
                  })
                }
              >
                Validate additional import
              </button>
            </>
          )}
          {job && (
            <>
              <p>
                {job.id
                  ? 'Validation passed. Nothing has been inserted yet.'
                  : `Correct ${job.errors.length} issue(s), then upload again.`}
              </p>
              <ul>
                {job.errors.map((v, i) => (
                  <li key={i}>
                    Row {v.row}: {v.message}
                  </li>
                ))}
              </ul>
              {job.id && (
                <>
                  <button
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        const r = await schoolCall<{ count: number }>(
                          school.id,
                          { op: 'commit', id: job.id },
                          true,
                        );
                        setNotice(`${r.count} records imported.`);
                        setJob(null);
                        setRows([]);
                      })
                    }
                  >
                    Confirm additional import
                  </button>
                  <button className="secondary" disabled={busy} onClick={() => void run(discard)}>
                    Discard additional preview
                  </button>
                </>
              )}
            </>
          )}
        </>
      )}
    </section>
  );
}
