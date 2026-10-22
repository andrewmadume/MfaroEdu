import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSchool } from '../../contexts/SchoolContext';
import { can } from '../../lib/permissions';
import { financeToday, formatMoney, inputMoney, parseMoney } from '../../lib/finance';
import { readFinance, writeFinance } from '../../services/finance';
import { useDebounced } from '../../hooks/useDebounced';
import type {
  FinanceAccount,
  FinanceDocument,
  FinanceEntry,
  FinanceInvoice,
  FinanceLearner,
  FinanceReport,
  FinanceSettings,
  FinanceSetup,
  FinanceStatement,
  FeeCategory,
  FeeStructure,
} from '../../types/finance';
import '../../app/finance.css';

type Request = Record<string, unknown>;
function useRead<T>(request: Request, enabled = true) {
  const { school } = useSchool();
  return useQuery({
    queryKey: ['finance', school.id, request],
    queryFn: () => readFinance<T>(school.id, request),
    enabled,
  });
}
function useSave() {
  const { school } = useSchool(),
    client = useQueryClient();
  const retry = useRef<{ signature: string; key: string } | null>(null);
  return useMutation({
    mutationFn: async (request: Request) => {
      const signature = JSON.stringify(request);
      if (!retry.current || retry.current.signature !== signature)
        retry.current = { signature, key: crypto.randomUUID() };
      return writeFinance(school.id, { ...request, request_key: retry.current.key });
    },
    onSuccess: async () => {
      retry.current = null;
      await client.invalidateQueries({ queryKey: ['finance', school.id] });
    },
  });
}
function Notice({ error }: { error: Error | null }) {
  return error ? (
    <p className="error" role="alert">
      {error.message}
    </p>
  ) : null;
}
function Pager({
  page,
  count,
  setPage,
}: {
  page: number;
  count: number;
  setPage: (page: number) => void;
}) {
  return (
    <div className="finance-pager">
      <button className="secondary" disabled={!page} onClick={() => setPage(page - 1)}>
        Previous
      </button>
      <span>
        Page {page + 1} of {Math.max(1, Math.ceil(count / 20))} · {count} records
      </span>
      <button
        className="secondary"
        disabled={(page + 1) * 20 >= count}
        onClick={() => setPage(page + 1)}
      >
        Next
      </button>
    </div>
  );
}
function money(
  settings: Pick<FinanceSettings, 'currency' | 'decimal_places'> | null | undefined,
  value: string,
) {
  return settings
    ? formatMoney(value, settings.currency, settings.decimal_places)
    : 'Currency not configured';
}
function dataOf(e: FormEvent<HTMLFormElement>) {
  e.preventDefault();
  return Object.fromEntries(new FormData(e.currentTarget));
}
function Boundary({
  pending,
  error,
  children,
}: {
  pending: boolean;
  error: Error | null;
  children: ReactNode;
}) {
  return pending ? (
    <p role="status">Loading finance records…</p>
  ) : error ? (
    <Notice error={error} />
  ) : (
    <>{children}</>
  );
}
export default function FinancePage() {
  const { school, permissions } = useSchool();
  if (!can(permissions, 'finance.view'))
    return (
      <div className="panel">
        <h1>Access unavailable</h1>
        <p>Your school has not assigned finance access.</p>
      </div>
    );
  return <FinanceWorkspace key={school.id} />;
}
function FinanceWorkspace() {
  const { permissions } = useSchool(),
    [tab, setTab] = useState('accounts');
  const tabs = [
    ['accounts', 'Learner accounts'],
    ...(can(permissions, 'finance.view_all') ? [['setup', 'Fees & currency']] : []),
    ...(can(permissions, 'finance.reports') ? [['reports', 'Financial reports']] : []),
  ];
  return (
    <>
      <div className="finance-workspace">
        <header className="page-heading">
          <span className="eyebrow">FINANCE</span>
          <h1>School fees, clearly accounted for.</h1>
          <p>Track invoices, payments received, concessions and the balance still due.</p>
        </header>
        <nav className="finance-tabs" aria-label="Finance sections">
          {tabs.map(([id, label]) => (
            <button
              key={id}
              className={tab === id ? '' : 'secondary'}
              aria-pressed={tab === id}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </nav>
        {tab === 'accounts' ? <Accounts /> : tab === 'setup' ? <Setup /> : <Reports />}
      </div>
      <PrintDocument />
    </>
  );
}

function Setup() {
  const { school, permissions } = useSchool(),
    query = useRead<FinanceSetup>({ op: 'setup' }),
    save = useSave();
  const [category, setCategory] = useState<FeeCategory | null>(null),
    [fee, setFee] = useState<FeeStructure | null>(null),
    [error, setError] = useState<Error | null>(null);
  const manage = can(permissions, 'finance.manage');
  async function submit(request: Request, done: () => void) {
    setError(null);
    try {
      await save.mutateAsync(request);
      done();
    } catch (e) {
      setError(e as Error);
    }
  }
  return (
    <Boundary pending={query.isPending} error={query.error}>
      {query.data && (
        <div className="finance-stack">
          <section className="panel">
            <h2>Account currency</h2>
            <p className="muted">
              Amounts use the school currency. Currency and decimal places lock after the first
              invoice.
            </p>
            <form
              className="finance-form"
              key={query.data.settings?.version ?? 0}
              onSubmit={(e) => {
                const v = dataOf(e);
                void submit(
                  {
                    op: 'settings',
                    currency: school.currency,
                    decimal_places: Number(v.decimal_places),
                    version: query.data!.settings?.version ?? 0,
                  },
                  () => {},
                );
              }}
            >
              <label>
                Currency
                <input value={school.currency} readOnly />
              </label>
              <label>
                Decimal places
                <select
                  name="decimal_places"
                  defaultValue={
                    query.data.settings?.decimal_places ??
                    new Intl.NumberFormat('en', {
                      style: 'currency',
                      currency: school.currency,
                    }).resolvedOptions().maximumFractionDigits
                  }
                  disabled={!manage || query.data.locked}
                >
                  <option value="0">0</option>
                  <option value="1">1</option>
                  <option value="2">2</option>
                  <option value="3">3</option>
                </select>
              </label>
              {manage && !query.data.locked && (
                <button disabled={save.isPending}>Save currency</button>
              )}
              {query.data.locked && <span className="badge green">Locked by issued invoices</span>}
            </form>
          </section>
          <Notice error={error} />
          <section className="panel">
            <h2>Fee categories</h2>
            <p className="muted">Use categories that match your school’s fee policy.</p>
            {manage && (
              <form
                className="finance-form"
                key={category?.id ?? 'new-category'}
                onSubmit={(e) => {
                  const form = e.currentTarget,
                    v = dataOf(e);
                  void submit(
                    {
                      op: 'category',
                      id: category?.id ?? null,
                      version: category?.version ?? 0,
                      name: v.name,
                      archived: category?.archived ?? false,
                    },
                    () => {
                      setCategory(null);
                      form.reset();
                    },
                  );
                }}
              >
                <label>
                  Category name
                  <input name="name" required maxLength={100} defaultValue={category?.name} />
                </label>
                <button disabled={save.isPending}>
                  {category ? 'Save category' : 'Add category'}
                </button>
                {category && (
                  <button type="button" className="secondary" onClick={() => setCategory(null)}>
                    Cancel edit
                  </button>
                )}
              </form>
            )}
            <div className="finance-chips">
              {query.data.categories.map((c) => (
                <div className="finance-chip" key={c.id}>
                  <span>
                    {c.name}
                    {c.archived ? ' · Archived' : ''}
                  </span>
                  {manage && (
                    <>
                      <button
                        className="secondary"
                        disabled={save.isPending}
                        onClick={() => setCategory(c)}
                      >
                        Edit
                      </button>
                      <button
                        className="secondary"
                        disabled={save.isPending}
                        onClick={() =>
                          void submit(
                            {
                              op: 'category',
                              id: c.id,
                              version: c.version,
                              name: c.name,
                              archived: !c.archived,
                            },
                            () => {},
                          )
                        }
                      >
                        {c.archived ? 'Restore' : 'Archive'}
                      </button>
                    </>
                  )}
                </div>
              ))}
            </div>
          </section>
          <section className="panel">
            <h2>Fee structures</h2>
            <p className="muted">
              Templates apply to an academic year and optionally a grade. Changes apply to future
              invoices.
            </p>
            {manage && query.data.settings && (
              <form
                key={fee ? `${fee.id}-${fee.version}` : 'new-fee'}
                className="finance-form"
                onSubmit={(e) => {
                  const form = e.currentTarget,
                    v = dataOf(e);
                  try {
                    const amount_minor = parseMoney(
                      String(v.amount),
                      query.data!.settings!.decimal_places,
                    );
                    void submit(
                      {
                        op: 'fee',
                        id: fee?.id ?? null,
                        version: fee?.version ?? 0,
                        name: v.name,
                        academic_year_id: v.academic_year_id,
                        category_id: v.category_id,
                        grade_id: v.grade_id || null,
                        amount_minor,
                        archived: fee?.archived ?? false,
                      },
                      () => {
                        setFee(null);
                        form.reset();
                      },
                    );
                  } catch (err) {
                    setError(err as Error);
                  }
                }}
              >
                <label>
                  Fee name
                  <input name="name" required maxLength={120} defaultValue={fee?.name} />
                </label>
                <label>
                  Category
                  <select name="category_id" required defaultValue={fee?.category_id ?? ''}>
                    <option value="">Select category</option>
                    {query.data.categories
                      .filter((c) => !c.archived)
                      .map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                  </select>
                </label>
                <label>
                  Academic year
                  <select
                    name="academic_year_id"
                    required
                    defaultValue={fee?.academic_year_id ?? ''}
                  >
                    <option value="">Select year</option>
                    {query.data.years
                      .filter((y) => !y.archived)
                      .map((y) => (
                        <option key={y.id} value={y.id}>
                          {y.name}
                        </option>
                      ))}
                  </select>
                </label>
                <label>
                  Grade
                  <select name="grade_id" defaultValue={fee?.grade_id ?? ''}>
                    <option value="">All grades</option>
                    {query.data.grades.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Amount ({query.data.settings.currency})
                  <input
                    name="amount"
                    inputMode="decimal"
                    required
                    defaultValue={
                      fee ? inputMoney(fee.amount_minor, query.data.settings.decimal_places) : ''
                    }
                  />
                </label>
                <button disabled={save.isPending}>
                  {fee ? 'Save fee structure' : 'Add fee structure'}
                </button>
                {fee && (
                  <button type="button" className="secondary" onClick={() => setFee(null)}>
                    Cancel edit
                  </button>
                )}
              </form>
            )}
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Fee</th>
                    <th>Year / grade</th>
                    <th>Amount</th>
                    <th>Status</th>
                    {manage && <th>Actions</th>}
                  </tr>
                </thead>
                <tbody>
                  {query.data.fees.map((f) => (
                    <tr key={f.id}>
                      <td>
                        {f.name}
                        <small>
                          {query.data!.categories.find((c) => c.id === f.category_id)?.name}
                        </small>
                      </td>
                      <td>
                        {query.data!.years.find((y) => y.id === f.academic_year_id)?.name} /{' '}
                        {query.data!.grades.find((g) => g.id === f.grade_id)?.name ?? 'All grades'}
                      </td>
                      <td>{money(query.data!.settings, f.amount_minor)}</td>
                      <td>{f.archived ? 'Archived' : 'Active'}</td>
                      {manage && (
                        <td>
                          <div className="actions">
                            <button className="secondary" onClick={() => setFee(f)}>
                              Edit
                            </button>
                            <button
                              className="secondary"
                              disabled={save.isPending}
                              onClick={() =>
                                void submit({ ...f, op: 'fee', archived: !f.archived }, () => {})
                              }
                            >
                              {f.archived ? 'Restore' : 'Archive'}
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!query.data.fees.length && (
              <p>No fee structures yet. Configure currency and a category to begin.</p>
            )}
          </section>
        </div>
      )}
    </Boundary>
  );
}

function Accounts() {
  const [search, setSearch] = useState(''),
    term = useDebounced(search),
    [page, setPage] = useState(0),
    [chosen, setChosen] = useState<FinanceLearner | null>(null);
  const query = useRead<{ rows: FinanceLearner[]; count: number }>({
    op: 'learners',
    search: term,
    page,
  });
  return (
    <div className="finance-stack">
      <section className="panel">
        <h2>Select a learner account</h2>
        <label>
          Search by name or admission number
          <input
            value={search}
            maxLength={100}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(0);
            }}
          />
        </label>
        <Boundary pending={query.isPending} error={query.error}>
          {query.data && (
            <>
              <div className="finance-learners">
                {query.data.rows.map((l) => (
                  <button
                    className={chosen?.id === l.id ? '' : 'secondary'}
                    aria-pressed={chosen?.id === l.id}
                    key={l.id}
                    onClick={() => setChosen(l)}
                  >
                    {l.name}
                    <small>
                      {l.admission_number}
                      {l.archived ? ' · Archived learner' : ''}
                    </small>
                  </button>
                ))}
              </div>
              {!query.data.rows.length && <p>No accessible learner accounts match this search.</p>}
              <Pager page={page} count={query.data.count} setPage={setPage} />
            </>
          )}
        </Boundary>
      </section>
      {chosen && <LearnerAccount key={chosen.id} learner={chosen} />}
    </div>
  );
}
function LearnerAccount({ learner }: { learner: FinanceLearner }) {
  const { permissions } = useSchool(),
    [page, setPage] = useState(0),
    [invoice, setInvoice] = useState('');
  const query = useRead<FinanceAccount>({ op: 'account', student_id: learner.id, page });
  const manage = can(permissions, 'finance.manage');
  return (
    <>
      <section className="panel">
        <div className="section-heading">
          <div>
            <span className="eyebrow">LEARNER ACCOUNT</span>
            <h2>{learner.name}</h2>
            <p>{learner.admission_number}</p>
          </div>
          {query.data && !query.isError && (
            <div className="finance-balance">
              <small>Current balance due</small>
              <strong>{money(query.data.settings, query.data.balance_minor)}</strong>
            </div>
          )}
        </div>
        <Boundary pending={query.isPending} error={query.error}>
          {query.data && (
            <>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Invoice</th>
                      <th>Issued / due</th>
                      <th>Charged</th>
                      <th>Balance</th>
                      <th>Status</th>
                      <th>Details</th>
                    </tr>
                  </thead>
                  <tbody>
                    {query.data.rows.map((i) => (
                      <tr key={i.id}>
                        <td>{i.number}</td>
                        <td>
                          {i.issued_on}
                          <small>Due {i.due_on}</small>
                        </td>
                        <td>{money(i.document, i.gross_minor)}</td>
                        <td>{money(i.document, i.balance_minor)}</td>
                        <td>
                          {i.status === 'VOID'
                            ? 'Void'
                            : BigInt(i.balance_minor) === 0n
                              ? 'Settled'
                              : 'Outstanding'}
                        </td>
                        <td>
                          <button className="secondary" onClick={() => setInvoice(i.id)}>
                            Open {i.number}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!query.data.rows.length && <p>No invoices issued for this learner.</p>}
              <Pager page={page} count={query.data.count} setPage={setPage} />
            </>
          )}
        </Boundary>
      </section>
      {manage && !learner.archived && (
        <IssueInvoice
          learner={learner}
          onIssued={(id) => {
            setInvoice(id);
            setPage(0);
          }}
        />
      )}
      {invoice && <InvoiceDetails key={invoice} id={invoice} />}
      <Statement learner={learner} />
    </>
  );
}
function IssueInvoice({
  learner,
  onIssued,
}: {
  learner: FinanceLearner;
  onIssued: (id: string) => void;
}) {
  const { school } = useSchool(),
    setup = useRead<FinanceSetup>({ op: 'setup' }),
    save = useSave(),
    [year, setYear] = useState(''),
    [error, setError] = useState<Error | null>(null),
    [expanded, setExpanded] = useState(false);
  return (
    <section className="panel">
      <button className="secondary" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
        Issue an invoice
      </button>
      {expanded && (
        <Boundary pending={setup.isPending} error={setup.error}>
          {setup.data?.settings ? (
            <form
              className="finance-stack"
              onSubmit={(e) => {
                const v = dataOf(e),
                  form = e.currentTarget;
                setError(null);
                const items = setup
                  .data!.fees.filter((f) => v[`include-${f.id}`])
                  .map((f) => ({
                    fee_id: f.id,
                    version: f.version,
                    quantity: Number(v[`qty-${f.id}`]),
                  }));
                void save
                  .mutateAsync({
                    op: 'invoice',
                    student_id: learner.id,
                    academic_year_id: year,
                    issued_on: v.issued_on,
                    due_on: v.due_on,
                    items,
                  })
                  .then((result) => {
                    form.reset();
                    setYear('');
                    setExpanded(false);
                    onIssued(result.id);
                  })
                  .catch((err) => setError(err));
              }}
            >
              <h3>Invoice {learner.name}</h3>
              <p className="muted">
                Choose fees for the learner’s enrolled year and grade. Issued invoices keep these
                descriptions and prices.
              </p>
              <div className="finance-form">
                <label>
                  Academic year
                  <select required value={year} onChange={(e) => setYear(e.target.value)}>
                    <option value="">Select year</option>
                    {setup.data.years
                      .filter((y) => !y.archived)
                      .map((y) => (
                        <option key={y.id} value={y.id}>
                          {y.name}
                        </option>
                      ))}
                  </select>
                </label>
                <label>
                  Invoice date
                  <input
                    name="issued_on"
                    type="date"
                    required
                    max={financeToday(school.timezone)}
                    defaultValue={financeToday(school.timezone)}
                  />
                </label>
                <label>
                  Due date
                  <input
                    name="due_on"
                    type="date"
                    required
                    defaultValue={financeToday(school.timezone)}
                  />
                </label>
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Include fee</th>
                      <th>Grade</th>
                      <th>Unit amount</th>
                      <th>Quantity</th>
                    </tr>
                  </thead>
                  <tbody>
                    {setup.data.fees
                      .filter(
                        (f) =>
                          !f.archived &&
                          f.academic_year_id === year &&
                          !setup.data!.categories.find((c) => c.id === f.category_id)?.archived,
                      )
                      .map((f) => (
                        <tr key={f.id}>
                          <td>
                            <label className="finance-check">
                              <input type="checkbox" name={`include-${f.id}`} />
                              {f.name}
                            </label>
                          </td>
                          <td>
                            {setup.data!.grades.find((g) => g.id === f.grade_id)?.name ??
                              'All grades'}
                          </td>
                          <td>{money(setup.data!.settings, f.amount_minor)}</td>
                          <td>
                            <input
                              aria-label={`Quantity for ${f.name}`}
                              name={`qty-${f.id}`}
                              type="number"
                              min="1"
                              max="1000"
                              step="1"
                              defaultValue="1"
                            />
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
              <Notice error={error} />
              <button disabled={save.isPending}>
                {save.isPending ? 'Issuing…' : 'Create invoice'}
              </button>
            </form>
          ) : (
            <p>Configure fees and currency before issuing an invoice.</p>
          )}
        </Boundary>
      )}
    </section>
  );
}
function InvoiceDetails({ id }: { id: string }) {
  const { permissions, school } = useSchool(),
    query = useRead<FinanceInvoice>({ op: 'invoice', id }),
    save = useSave();
  const [action, setAction] = useState('PAYMENT'),
    [error, setError] = useState<Error | null>(null),
    [success, setSuccess] = useState('');
  const manage = can(permissions, 'finance.manage');
  return (
    <section className="panel">
      <Boundary pending={query.isPending} error={query.error}>
        {query.data && (
          <>
            <div className="section-heading">
              <div>
                <span className="eyebrow">INVOICE DETAIL</span>
                <h2>{query.data.number}</h2>
                <p>
                  {query.data.document.learner} · {query.data.document.year}
                </p>
              </div>
              <button
                className="secondary"
                onClick={() => void print({ title: 'Invoice', invoice: query.data! })}
              >
                Print invoice / Save PDF
              </button>
            </div>
            <p>
              Issued {query.data.issued_on} · Due {query.data.due_on} · {query.data.status}
            </p>
            <InvoiceLines invoice={query.data} />
            <div className="finance-balance">
              <small>Balance due</small>
              <strong>{money(query.data.document, query.data.balance_minor)}</strong>
            </div>
            <h3>Payment and adjustment history</h3>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Date / number</th>
                    <th>Entry</th>
                    <th>Amount</th>
                    <th>Details</th>
                    <th>Receipt</th>
                  </tr>
                </thead>
                <tbody>
                  {query.data.entries.map((e) => (
                    <tr key={e.id}>
                      <td>
                        {e.posted_on}
                        <small>{e.number}</small>
                      </td>
                      <td>
                        {e.kind}
                        {e.reversed ? ' · Reversed' : ''}
                      </td>
                      <td>{money(query.data!.document, e.amount_minor)}</td>
                      <td>
                        {e.method?.replaceAll('_', ' ')}
                        {e.reference && <small>{e.reference}</small>}
                        {e.reason && <small>{e.reason}</small>}
                      </td>
                      <td>
                        {e.kind === 'PAYMENT' && (
                          <button
                            className="secondary"
                            onClick={() =>
                              void print({
                                title: 'Payment receipt',
                                invoice: query.data!,
                                entry: e,
                              })
                            }
                          >
                            Print {e.number}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {manage && query.data.status === 'ISSUED' && (
              <form
                className="finance-stack"
                onSubmit={(e) => {
                  const v = dataOf(e),
                    form = e.currentTarget;
                  setError(null);
                  setSuccess('');
                  try {
                    const amount_minor = ['PAYMENT', 'DISCOUNT', 'BURSARY'].includes(action)
                      ? parseMoney(String(v.amount), query.data!.document.decimal_places)
                      : null;
                    void save
                      .mutateAsync({
                        op: action,
                        id,
                        version: query.data!.version,
                        amount_minor,
                        posted_on: v.posted_on,
                        method: v.method ?? null,
                        reference: v.reference ?? null,
                        reason: v.reason ?? null,
                        original_entry_id: v.original_entry_id ?? null,
                      })
                      .then(() => {
                        form.reset();
                        setSuccess(
                          'Transaction recorded. Balances and history have been refreshed.',
                        );
                      })
                      .catch((err) => setError(err));
                  } catch (err) {
                    setError(err as Error);
                  }
                }}
              >
                <h3>Record a transaction</h3>
                <p className="muted">
                  Record money already received. Reversals correct the school’s records; arrange any
                  refund separately. Reasons and references are visible on the learner account.
                </p>
                <div className="finance-form">
                  <label>
                    Transaction
                    <select
                      value={action}
                      onChange={(e) => {
                        setAction(e.target.value);
                        setError(null);
                        setSuccess('');
                      }}
                    >
                      <option value="PAYMENT">Payment received</option>
                      <option value="DISCOUNT">Discount</option>
                      <option value="BURSARY">Bursary</option>
                      <option value="REVERSAL">Reverse a payment or concession</option>
                      <option value="VOID">Void invoice</option>
                    </select>
                  </label>
                  <label>
                    Posting date
                    <input
                      type="date"
                      name="posted_on"
                      min={query.data.issued_on}
                      max={financeToday(school.timezone)}
                      required
                      defaultValue={financeToday(school.timezone)}
                    />
                  </label>
                  {['PAYMENT', 'DISCOUNT', 'BURSARY'].includes(action) && (
                    <label>
                      Amount ({query.data.document.currency})
                      <input name="amount" required inputMode="decimal" />
                    </label>
                  )}
                  {action === 'PAYMENT' && (
                    <>
                      <label>
                        Payment method
                        <select name="method">
                          <option value="CASH">Cash</option>
                          <option value="BANK_TRANSFER">Bank transfer</option>
                          <option value="CARD">Card</option>
                          <option value="OTHER">Other</option>
                        </select>
                      </label>
                      <label>
                        Reference
                        <input name="reference" maxLength={200} />
                      </label>
                    </>
                  )}
                  {action === 'REVERSAL' && (
                    <label>
                      Original transaction
                      <select name="original_entry_id" required>
                        <option value="">Choose transaction</option>
                        {query.data.entries
                          .filter(
                            (e) =>
                              ['PAYMENT', 'DISCOUNT', 'BURSARY'].includes(e.kind) && !e.reversed,
                          )
                          .map((e) => (
                            <option key={e.id} value={e.id}>
                              {e.number} · {e.kind} ·{' '}
                              {money(query.data!.document, String(-BigInt(e.amount_minor)))}
                            </option>
                          ))}
                      </select>
                    </label>
                  )}
                  {action !== 'PAYMENT' && (
                    <label>
                      Reason
                      <input name="reason" required maxLength={1000} />
                    </label>
                  )}
                </div>
                {action === 'VOID' && (
                  <p>
                    Reverse any payments and concessions first. Voiding retains the invoice and its
                    history.
                  </p>
                )}
                <Notice error={error} />
                {success && <p role="status">{success}</p>}
                <button disabled={save.isPending}>
                  {save.isPending
                    ? 'Recording…'
                    : action === 'PAYMENT'
                      ? 'Record payment received'
                      : action === 'VOID'
                        ? 'Void this invoice'
                        : action === 'REVERSAL'
                          ? 'Record reversal'
                          : 'Record concession'}
                </button>
              </form>
            )}
          </>
        )}
      </Boundary>
    </section>
  );
}
function InvoiceLines({ invoice }: { invoice: FinanceInvoice }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Description</th>
            <th>Quantity</th>
            <th>Unit amount</th>
            <th>Total</th>
          </tr>
        </thead>
        <tbody>
          {invoice.document.items.map((l, index) => (
            <tr key={index}>
              <td>
                {l.description}
                <small>{l.category}</small>
              </td>
              <td>{l.quantity}</td>
              <td>{money(invoice.document, l.unit_minor)}</td>
              <td>{money(invoice.document, l.total_minor)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <th colSpan={3}>Invoice total</th>
            <td>{money(invoice.document, invoice.gross_minor)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
function useDates() {
  const { school } = useSchool();
  const today = financeToday(school.timezone);
  return useState({ from: today.slice(0, 4) + '-01-01', to: today });
}
function Dates({
  value,
  onChange,
}: {
  value: { from: string; to: string };
  onChange: (v: { from: string; to: string }) => void;
}) {
  return (
    <div className="finance-form">
      <label>
        From
        <input
          type="date"
          required
          value={value.from}
          onChange={(e) => onChange({ ...value, from: e.target.value })}
        />
      </label>
      <label>
        To
        <input
          type="date"
          required
          value={value.to}
          onChange={(e) => onChange({ ...value, to: e.target.value })}
        />
      </label>
    </div>
  );
}
function Statement({ learner }: { learner: FinanceLearner }) {
  const { school } = useSchool(),
    [dates, setDates] = useDates(),
    [page, setPage] = useState(0),
    [printing, setPrinting] = useState(false),
    [error, setError] = useState<Error | null>(null);
  const query = useRead<FinanceStatement>(
    { op: 'statement', student_id: learner.id, ...dates, page },
    !!dates.from && !!dates.to,
  );
  async function printAll() {
    setPrinting(true);
    setError(null);
    try {
      const first = await readFinance<FinanceStatement>(school.id, {
        op: 'statement',
        student_id: learner.id,
        ...dates,
        page: 0,
      });
      const rows = [...first.rows];
      for (let p = 1; p * 20 < first.count; p++) {
        const next = await readFinance<FinanceStatement>(school.id, {
          op: 'statement',
          student_id: learner.id,
          ...dates,
          page: p,
          as_at: first.as_at,
        });
        rows.push(...next.rows);
      }
      await print({
        title: 'Account statement',
        learner,
        statement: { ...first, rows },
        dates,
        school: school.name,
      });
    } catch (e) {
      setError(e as Error);
    } finally {
      setPrinting(false);
    }
  }
  return (
    <section className="panel">
      <div className="section-heading">
        <h2>Account statement</h2>
        <button
          className="secondary"
          disabled={printing || !query.data || query.isError || !dates.from || !dates.to}
          onClick={() => void printAll()}
        >
          {printing ? 'Preparing all entries…' : 'Print full statement / Save PDF'}
        </button>
      </div>
      <Dates
        value={dates}
        onChange={(v) => {
          setDates(v);
          setPage(0);
        }}
      />
      <Notice error={error} />
      <Boundary pending={query.isPending} error={query.error}>
        {query.data && (
          <>
            <StatementBody statement={query.data} />
            <Pager page={page} count={query.data.count} setPage={setPage} />
          </>
        )}
      </Boundary>
    </section>
  );
}
function StatementBody({ statement: s }: { statement: FinanceStatement }) {
  return (
    <>
      <p>
        Opening balance: <strong>{money(s.settings, s.opening_minor)}</strong>
      </p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Entry / invoice</th>
              <th>Transaction</th>
              <th>Amount</th>
              <th>Running balance</th>
            </tr>
          </thead>
          <tbody>
            {s.rows.map((e) => (
              <tr key={e.id}>
                <td>{e.posted_on}</td>
                <td>
                  {e.number}
                  <small>{e.invoice_number}</small>
                </td>
                <td>{e.kind}</td>
                <td>{money(s.settings, e.amount_minor)}</td>
                <td>{money(s.settings, e.running_minor)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p>
        Closing balance: <strong>{money(s.settings, s.closing_minor)}</strong>
      </p>
    </>
  );
}
function Reports() {
  const { school } = useSchool(),
    [dates, setDates] = useDates(),
    query = useRead<FinanceReport>({ op: 'report', ...dates }, !!dates.from && !!dates.to);
  return (
    <section className="panel">
      <div className="section-heading">
        <h2>Financial reports</h2>
        <button
          className="secondary"
          disabled={!query.data || query.isError || !dates.from || !dates.to}
          onClick={() =>
            void print({
              title: 'Financial report',
              report: query.data!,
              dates,
              school: school.name,
            })
          }
        >
          Print report / Save PDF
        </button>
      </div>
      <Dates value={dates} onChange={setDates} />
      <p className="muted">
        Period totals include reversals and voids posted in the selected dates. Outstanding is the
        cumulative balance as at the end date. These are fee ledger reports.
      </p>
      <Boundary pending={query.isPending} error={query.error}>
        {query.data && <ReportBody report={query.data} />}
      </Boundary>
    </section>
  );
}
function ReportBody({ report: r }: { report: FinanceReport }) {
  return (
    <div className="finance-metrics">
      {[
        ['Net invoiced', r.billed_minor],
        ['Net payments received', r.collected_minor],
        ['Net discounts & bursaries', r.concessions_minor],
        ['Outstanding at end date', r.outstanding_minor],
      ].map(([label, value]) => (
        <article key={label}>
          <small>{label}</small>
          <strong>{money(r.settings, value)}</strong>
        </article>
      ))}
    </div>
  );
}

type PrintModel = {
  title: string;
  invoice?: FinanceInvoice;
  entry?: FinanceEntry;
  learner?: FinanceLearner;
  statement?: FinanceStatement;
  report?: FinanceReport;
  dates?: { from: string; to: string };
  school?: string;
};
// The print host is a direct child of .content, matching the existing report print rules.
let showPrint: ((value: PrintModel) => void) | null = null;
async function print(value: PrintModel) {
  showPrint?.(value);
  await new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  );
  await Promise.all(
    Array.from(document.querySelectorAll<HTMLImageElement>('#print-reports img')).map((i) =>
      i.decode().catch(() => {}),
    ),
  );
  window.print();
}
function PrintDocument() {
  const [model, setModel] = useState<PrintModel | null>(null);
  useEffect(() => {
    showPrint = setModel;
    return () => {
      showPrint = null;
    };
  }, []);
  if (!model) return <div id="print-reports" />;
  const d: FinanceDocument | undefined = model.entry?.document ?? model.invoice?.document;
  return (
    <div id="print-reports">
      <article className="report-card finance-print">
        <header className="report-header">
          <img src="/mfaroedu-logo.png" alt="MfaroEdu" />
          <div>
            <h2>{d?.school ?? model.school}</h2>
            {d?.address && <p>{d.address}</p>}
            <h3>{model.title}</h3>
          </div>
        </header>
        {d && (
          <p>
            {d.learner} · {d.admission} · {d.year}
          </p>
        )}
        {model.entry ? (
          <>
            <h2>{model.entry.number}</h2>
            <p>
              {model.entry.reversed
                ? 'REVERSED — original receipt retained for audit'
                : 'Payment recorded'}
            </p>
            <p>
              Invoice {d!.invoice_number} · {model.entry.posted_on}
            </p>
            <p>
              Amount received:{' '}
              <strong>{money(d, String(-BigInt(model.entry.amount_minor)))}</strong>
            </p>
            <p>
              Method: {model.entry.method?.replaceAll('_', ' ')} · Reference:{' '}
              {model.entry.reference || '—'}
            </p>
            <p>This receipt records a payment received by the school.</p>
          </>
        ) : model.invoice ? (
          <>
            <h2>
              {model.invoice.number} · {model.invoice.status}
            </h2>
            <p>
              Issued {model.invoice.issued_on} · Due {model.invoice.due_on}
            </p>
            <InvoiceLines invoice={model.invoice} />
            <p>Current balance: {money(model.invoice.document, model.invoice.balance_minor)}</p>
          </>
        ) : null}
        {model.learner && (
          <p>
            {model.learner.name} · {model.learner.admission_number}
          </p>
        )}
        {model.dates && (
          <p>
            {model.dates.from} to {model.dates.to}
          </p>
        )}
        {model.statement && <StatementBody statement={model.statement} />}
        {model.report && <ReportBody report={model.report} />}
        <footer className="report-footer">
          MfaroEdu · Generated {new Date().toLocaleString()} · All amounts in{' '}
          {d?.currency ?? model.statement?.settings?.currency ?? model.report?.settings?.currency}
        </footer>
      </article>
    </div>
  );
}
