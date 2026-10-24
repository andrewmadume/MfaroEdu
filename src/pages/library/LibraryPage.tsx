import { useState } from 'react';
import { useSchool } from '../../contexts/SchoolContext';
import { can } from '../../lib/permissions';
import { useCommunityRead, useCommunityWrite } from '../../hooks/useCommunity';
import { useDebounced } from '../../hooks/useDebounced';
import { schoolDate, addCalendarDays } from '../../lib/community';
import {
  ModuleError,
  ModulePager,
  QueryState,
  formValues,
} from '../../components/common/CommunityUI';
import Modal from '../../components/ui/Modal';
import type {
  Book,
  BookCopy,
  LibraryLearner,
  LibraryReport,
  LibrarySettings,
  Loan,
  PageResult,
} from '../../types/community';
import '../../app/community.css';
export default function LibraryPage() {
  const { school, permissions } = useSchool();
  return can(permissions, 'library.view') ? (
    <LibraryWorkspace key={school.id} />
  ) : (
    <section className="panel">
      <h1>Access unavailable</h1>
      <p>Your school has not assigned library access.</p>
    </section>
  );
}
function LibraryWorkspace() {
  const { permissions } = useSchool(),
    [tab, setTab] = useState('catalogue'),
    [filter, setFilter] = useState('ALL');
  const tabs = [
    ['catalogue', 'Book catalogue'],
    ['loans', 'Borrowing history'],
    ...(can(permissions, 'library.reports') ? [['reports', 'Library reports']] : []),
    ...(can(permissions, 'library.manage') ? [['settings', 'Borrowing rules']] : []),
  ];
  return (
    <div className="community-workspace">
      <header className="page-heading">
        <span className="eyebrow">SCHOOL LIBRARY</span>
        <h1>Every book. Every borrower.</h1>
        <p>Find a title, track each physical copy and keep borrowing records clear.</p>
      </header>
      <nav className="module-tabs" aria-label="Library sections">
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
      {tab === 'catalogue' ? (
        <Catalogue
          onLoan={() => {
            setFilter('OPEN');
            setTab('loans');
          }}
        />
      ) : tab === 'loans' ? (
        <Loans key={filter} initialFilter={filter} />
      ) : tab === 'reports' ? (
        <Reports
          onOverdue={() => {
            setFilter('OVERDUE');
            setTab('loans');
          }}
        />
      ) : (
        <BorrowingRules />
      )}
    </div>
  );
}
function Catalogue({ onLoan }: { onLoan: () => void }) {
  const { permissions } = useSchool(),
    manage = can(permissions, 'library.manage'),
    [search, setSearch] = useState(''),
    term = useDebounced(search),
    [page, setPage] = useState(0),
    [archived, setArchived] = useState(false),
    [selected, setSelected] = useState<Book | null>(null),
    [editor, setEditor] = useState<Book | null | undefined>(undefined),
    query = useCommunityRead<PageResult<Book>>('library', {
      op: 'books',
      search: term,
      page,
      include_archived: archived,
    });
  return (
    <div className="module-stack">
      <section className="panel">
        <div className="section-heading">
          <h2>Book catalogue</h2>
          {manage && <button onClick={() => setEditor(null)}>Add book</button>}
        </div>
        <div className="module-form horizontal">
          <label>
            Search titles, authors, ISBN or category
            <input
              value={search}
              maxLength={100}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(0);
              }}
            />
          </label>
          {can(permissions, 'library.view_all') && (
            <label className="module-check">
              <input
                type="checkbox"
                checked={archived}
                onChange={(e) => {
                  setArchived(e.target.checked);
                  setPage(0);
                }}
              />
              Include archived titles
            </label>
          )}
        </div>
        <QueryState pending={query.isPending} error={query.error}>
          {query.data && (
            <>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Title / author</th>
                      <th>Category / ISBN</th>
                      <th>Copies</th>
                      <th>Available</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {query.data.rows.map((b) => (
                      <tr key={b.id}>
                        <td>
                          <strong>{b.title}</strong>
                          <small>
                            {b.author}
                            {b.archived ? ' · Archived' : ''}
                          </small>
                        </td>
                        <td>
                          {b.category ?? '—'}
                          <small>{b.isbn ?? 'No ISBN'}</small>
                        </td>
                        <td>{b.copies}</td>
                        <td>{b.available}</td>
                        <td>
                          <div className="actions">
                            <button className="secondary" onClick={() => setSelected(b)}>
                              View copies
                            </button>
                            {manage && (
                              <button className="secondary" onClick={() => setEditor(b)}>
                                Edit book
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!query.data.rows.length && <p>No books match this search.</p>}
              <ModulePager page={page} count={query.data.count} onChange={setPage} />
            </>
          )}
        </QueryState>
      </section>
      {selected && <Copies key={selected.id} book={selected} onLoan={onLoan} />}{' '}
      {editor !== undefined && (
        <BookEditor
          existing={editor}
          onClose={() => setEditor(undefined)}
          onSaved={() => {
            setEditor(undefined);
            setSelected(null);
          }}
        />
      )}
    </div>
  );
}
function BookEditor({
  existing,
  onSaved,
  onClose,
}: {
  existing: Book | null;
  onSaved: () => void;
  onClose: () => void;
}) {
  const save = useCommunityWrite('library');
  return (
    <Modal
      title={existing ? 'Edit library book' : 'Add library book'}
      onClose={() => {
        if (!save.isPending) onClose();
      }}
    >
      <form
        className="module-form"
        onSubmit={(e) => {
          const v = formValues(e);
          void save
            .mutateAsync({
              op: 'book',
              id: existing?.id ?? null,
              version: existing?.version ?? 0,
              title: v.title,
              author: v.author,
              isbn: v.isbn,
              category: v.category,
              publisher: v.publisher,
              archived: v.archived === 'on',
            })
            .then(onSaved)
            .catch(() => {});
        }}
      >
        <label>
          Book title
          <input name="title" required maxLength={200} defaultValue={existing?.title} />
        </label>
        <label>
          Author
          <input name="author" required maxLength={160} defaultValue={existing?.author} />
        </label>
        <label>
          ISBN
          <input name="isbn" maxLength={32} defaultValue={existing?.isbn ?? ''} />
        </label>
        <label>
          Category
          <input name="category" maxLength={100} defaultValue={existing?.category ?? ''} />
        </label>
        <label>
          Publisher
          <input name="publisher" maxLength={160} defaultValue={existing?.publisher ?? ''} />
        </label>
        {existing && (
          <label className="module-check">
            <input type="checkbox" name="archived" defaultChecked={existing.archived} />
            Archive this title
          </label>
        )}
        <ModuleError error={save.error} />
        <button disabled={save.isPending}>Save book</button>
      </form>
    </Modal>
  );
}
function Copies({ book, onLoan }: { book: Book; onLoan: () => void }) {
  const { permissions } = useSchool(),
    manage = can(permissions, 'library.manage'),
    [page, setPage] = useState(0),
    [editor, setEditor] = useState<BookCopy | null | undefined>(undefined),
    [issue, setIssue] = useState<BookCopy | null>(null),
    query = useCommunityRead<PageResult<BookCopy>>('library', { op: 'copies', id: book.id, page });
  return (
    <section className="panel">
      <div className="section-heading">
        <div>
          <span className="eyebrow">PHYSICAL COPIES</span>
          <h2>{book.title}</h2>
          <p>
            {book.author}
            {book.publisher ? ' · ' + book.publisher : ''}
          </p>
        </div>
        {manage && !book.archived && <button onClick={() => setEditor(null)}>Add copy</button>}
      </div>
      <QueryState pending={query.isPending} error={query.error}>
        {query.data && (
          <>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Accession</th>
                    <th>Location</th>
                    <th>Condition</th>
                    <th>Status</th>
                    {manage && <th>Actions</th>}
                  </tr>
                </thead>
                <tbody>
                  {query.data.rows.map((c) => (
                    <tr key={c.id}>
                      <td>{c.accession_number}</td>
                      <td>{c.location ?? '—'}</td>
                      <td>{c.condition}</td>
                      <td>
                        {c.on_loan
                          ? 'On loan'
                          : c.status === 'READY'
                            ? book.archived
                              ? 'Title archived'
                              : 'Available'
                            : c.status}
                      </td>
                      {manage && (
                        <td>
                          <div className="actions">
                            <button
                              className="secondary"
                              disabled={c.on_loan || book.archived}
                              onClick={() => setEditor(c)}
                            >
                              Edit copy
                            </button>
                            <button
                              disabled={c.on_loan || c.status !== 'READY' || book.archived}
                              onClick={() => setIssue(c)}
                            >
                              Issue copy
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!query.data.rows.length && <p>No physical copies registered.</p>}
            <ModulePager page={page} count={query.data.count} onChange={setPage} />
          </>
        )}
      </QueryState>
      {editor !== undefined && (
        <CopyEditor
          book={book}
          existing={editor}
          onClose={() => setEditor(undefined)}
          onSaved={() => setEditor(undefined)}
        />
      )}{' '}
      {issue && (
        <IssueCopy
          book={book}
          copy={issue}
          onClose={() => setIssue(null)}
          onSaved={() => {
            setIssue(null);
            onLoan();
          }}
        />
      )}
    </section>
  );
}
function CopyEditor({
  book,
  existing,
  onClose,
  onSaved,
}: {
  book: Book;
  existing: BookCopy | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const save = useCommunityWrite('library');
  return (
    <Modal
      title={existing ? 'Edit physical copy' : 'Add physical copy'}
      onClose={() => {
        if (!save.isPending) onClose();
      }}
    >
      <form
        className="module-form"
        onSubmit={(e) => {
          const v = formValues(e);
          void save
            .mutateAsync({
              op: 'copy',
              id: existing?.id ?? null,
              version: existing?.version ?? 0,
              book_id: book.id,
              accession_number: v.accession_number,
              location: v.location,
              condition: v.condition,
              status: v.status,
            })
            .then(onSaved)
            .catch(() => {});
        }}
      >
        <p>{book.title}</p>
        <label>
          Accession number
          <input
            name="accession_number"
            required
            maxLength={40}
            defaultValue={existing?.accession_number}
          />
        </label>
        <label>
          Shelf / location
          <input name="location" maxLength={120} defaultValue={existing?.location ?? ''} />
        </label>
        <label>
          Condition
          <select name="condition" defaultValue={existing?.condition ?? 'GOOD'}>
            <option value="GOOD">Good</option>
            <option value="FAIR">Fair</option>
            <option value="DAMAGED">Damaged</option>
          </select>
        </label>
        <label>
          Copy status
          <select name="status" defaultValue={existing?.status ?? 'READY'}>
            <option value="READY">Ready to lend</option>
            <option value="DAMAGED">Damaged — unavailable</option>
            <option value="LOST">Lost — unavailable</option>
            <option value="RETIRED">Retired</option>
          </select>
        </label>
        <p className="muted">
          Repair or recover a damaged/lost copy before marking it ready. Previous borrowing history
          remains unchanged.
        </p>
        <ModuleError error={save.error} />
        <button disabled={save.isPending}>Save copy</button>
      </form>
    </Modal>
  );
}
function IssueCopy({
  book,
  copy,
  onClose,
  onSaved,
}: {
  book: Book;
  copy: BookCopy;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { school } = useSchool(),
    today = schoolDate(school.timezone),
    settings = useCommunityRead<LibrarySettings>('library', { op: 'settings' }),
    [search, setSearch] = useState(''),
    term = useDebounced(search),
    [page, setPage] = useState(0),
    [learner, setLearner] = useState<LibraryLearner | null>(null),
    query = useCommunityRead<PageResult<LibraryLearner>>('library', {
      op: 'learners',
      search: term,
      page,
    }),
    save = useCommunityWrite('library');
  return (
    <Modal
      title="Issue library copy"
      onClose={() => {
        if (!save.isPending) onClose();
      }}
    >
      <p>
        <strong>{book.title}</strong> · {copy.accession_number}
      </p>
      <label>
        Search learner name or admission number
        <input
          value={search}
          maxLength={100}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(0);
          }}
        />
      </label>
      <QueryState pending={query.isPending} error={query.error}>
        {query.data && (
          <>
            <div className="module-choices">
              {query.data.rows.map((s) => (
                <button
                  className={learner?.id === s.id ? '' : 'secondary'}
                  aria-pressed={learner?.id === s.id}
                  key={s.id}
                  onClick={() => setLearner(s)}
                >
                  {s.name}
                  <small>{s.admission_number}</small>
                </button>
              ))}
            </div>
            <ModulePager page={page} count={query.data.count} onChange={setPage} />
          </>
        )}
      </QueryState>
      <QueryState pending={settings.isPending} error={settings.error}>
        {settings.data && (
          <form
            className="module-form"
            onSubmit={(e) => {
              const v = formValues(e);
              if (learner)
                void save
                  .mutateAsync({
                    op: 'issue',
                    copy_id: copy.id,
                    version: copy.version,
                    student_id: learner.id,
                    issued_on: v.issued_on,
                    due_on: v.due_on,
                  })
                  .then(onSaved)
                  .catch(() => {});
            }}
          >
            <p>
              Borrower: <strong>{learner?.name ?? 'Select a learner'}</strong>
            </p>
            <label>
              Issue date
              <input name="issued_on" type="date" required max={today} defaultValue={today} />
            </label>
            <label>
              Due date
              <input
                name="due_on"
                type="date"
                required
                defaultValue={addCalendarDays(today, settings.data.loan_days)}
              />
            </label>
            <ModuleError error={save.error} />
            <button disabled={!learner || save.isPending}>Confirm issue</button>
          </form>
        )}
      </QueryState>
    </Modal>
  );
}
function Loans({ initialFilter }: { initialFilter: string }) {
  const { permissions } = useSchool(),
    [filter, setFilter] = useState(initialFilter),
    [search, setSearch] = useState(''),
    term = useDebounced(search),
    [page, setPage] = useState(0),
    [selected, setSelected] = useState(''),
    query = useCommunityRead<PageResult<Loan>>('library', {
      op: 'loans',
      search: term,
      filter,
      page,
    });
  return (
    <div className="module-stack">
      <section className="panel">
        <h2>
          {can(permissions, 'library.view_all')
            ? 'School borrowing history'
            : 'Your family borrowing history'}
        </h2>
        <div className="module-form horizontal">
          <label>
            Search book, learner or accession
            <input
              value={search}
              maxLength={100}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(0);
              }}
            />
          </label>
          <label>
            Loan status
            <select
              value={filter}
              onChange={(e) => {
                setFilter(e.target.value);
                setPage(0);
              }}
            >
              <option value="ALL">All history</option>
              <option value="OPEN">On loan</option>
              <option value="OVERDUE">Overdue</option>
              <option value="CLOSED">Returned / lost</option>
            </select>
          </label>
        </div>
        <QueryState pending={query.isPending} error={query.error}>
          {query.data && (
            <>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Book / copy</th>
                      <th>Borrower</th>
                      <th>Issued / due</th>
                      <th>Status</th>
                      <th>Details</th>
                    </tr>
                  </thead>
                  <tbody>
                    {query.data.rows.map((l) => (
                      <tr key={l.id}>
                        <td>
                          {l.document.title}
                          <small>{l.document.accession_number}</small>
                        </td>
                        <td>
                          {l.document.learner}
                          <small>{l.document.admission_number}</small>
                        </td>
                        <td>
                          {l.issued_on}
                          <small>Due {l.due_on}</small>
                        </td>
                        <td>
                          {l.close_kind ?? (l.overdue ? 'Overdue' : 'On loan')}
                          {l.closed_on && <small>{l.closed_on}</small>}
                        </td>
                        <td>
                          <button className="secondary" onClick={() => setSelected(l.id)}>
                            Open loan
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!query.data.rows.length && <p>No borrowing records in this view.</p>}
              <ModulePager page={page} count={query.data.count} onChange={setPage} />
            </>
          )}
        </QueryState>
      </section>
      {selected && <LoanDetail key={selected} id={selected} />}
    </div>
  );
}
function LoanDetail({ id }: { id: string }) {
  const { permissions, school } = useSchool(),
    [action, setAction] = useState('return'),
    query = useCommunityRead<Loan>('library', { op: 'loan', id }),
    settings = useCommunityRead<LibrarySettings>('library', { op: 'settings' }),
    save = useCommunityWrite('library'),
    today = schoolDate(school.timezone);
  return (
    <section className="panel">
      <QueryState pending={query.isPending} error={query.error}>
        {query.data && (
          <>
            <span className="eyebrow">BORROWING RECORD</span>
            <h2>{query.data.document.title}</h2>
            <button className="secondary" onClick={() => void query.refetch()}>
              Reload borrowing record
            </button>
            <p>
              {query.data.document.accession_number} · {query.data.document.learner} ·{' '}
              {query.data.document.admission_number}
            </p>
            <p>
              Issued {query.data.issued_on} · Due {query.data.due_on} · Renewed{' '}
              {query.data.renewals} time(s)
            </p>
            <p>
              <strong>
                {query.data.close_kind ?? (query.data.overdue ? 'Overdue' : 'On loan')}
              </strong>
              {query.data.closed_on ? ' · ' + query.data.closed_on : ''}
            </p>
            <h3>Activity history</h3>
            <ol className="loan-events">
              {query.data.events?.map((e) => (
                <li key={e.id}>
                  <strong>{e.kind}</strong> · {e.happened_on}
                  {e.details.due_on && <span> · Due {e.details.due_on}</span>}
                  {e.details.condition && <span> · {e.details.condition}</span>}
                  {e.details.note && <p>{e.details.note}</p>}
                </li>
              ))}
            </ol>
            {can(permissions, 'library.manage') && !query.data.closed_on && (
              <form
                className="module-form"
                key={query.data.version}
                onSubmit={(e) => {
                  const v = formValues(e);
                  void save
                    .mutateAsync({
                      op: action,
                      id,
                      version: query.data!.version,
                      due_on: v.due_on ?? null,
                      closed_on: v.closed_on ?? null,
                      condition: v.condition ?? null,
                      note: v.note ?? null,
                    })
                    .catch(() => {});
                }}
              >
                <h3>Manage this loan</h3>
                <label>
                  Action
                  <select value={action} onChange={(e) => setAction(e.target.value)}>
                    <option value="return">Return book</option>
                    <option value="renew">Renew loan</option>
                    <option value="lost">Report lost book</option>
                  </select>
                </label>
                {action === 'renew' ? (
                  <label>
                    New due date
                    <input
                      name="due_on"
                      type="date"
                      required
                      min={addCalendarDays(query.data.due_on, 1)}
                      defaultValue={addCalendarDays(
                        query.data.due_on > today ? query.data.due_on : today,
                        settings.data?.loan_days ?? 14,
                      )}
                    />
                  </label>
                ) : (
                  <>
                    <label>
                      Closing date
                      <input
                        name="closed_on"
                        type="date"
                        required
                        min={query.data.issued_on}
                        max={today}
                        defaultValue={today}
                      />
                    </label>
                    {action === 'return' && (
                      <label>
                        Returned condition
                        <select name="condition">
                          <option value="GOOD">Good</option>
                          <option value="FAIR">Fair</option>
                          <option value="DAMAGED">Damaged</option>
                        </select>
                      </label>
                    )}
                    <label>
                      Activity note
                      <input name="note" required maxLength={500} />
                      <small>Visible to the borrower and linked parents.</small>
                    </label>
                  </>
                )}
                <ModuleError error={save.error} />
                <button disabled={save.isPending}>
                  {action === 'return'
                    ? 'Confirm return'
                    : action === 'renew'
                      ? 'Confirm renewal'
                      : 'Confirm lost book'}
                </button>
              </form>
            )}
          </>
        )}
      </QueryState>
    </section>
  );
}
function BorrowingRules() {
  const query = useCommunityRead<LibrarySettings>('library', { op: 'settings' }),
    save = useCommunityWrite('library'),
    [success, setSuccess] = useState(false);
  return (
    <section className="panel">
      <h2>Borrowing rules</h2>
      <p className="muted">
        New loans use these defaults. Existing due dates remain unchanged. Limits are checked on
        each new issue or renewal.
      </p>
      <QueryState pending={query.isPending} error={query.error}>
        {query.data && (
          <form
            className="module-form"
            key={query.data.version}
            onSubmit={(e) => {
              const v = formValues(e);
              setSuccess(false);
              void save
                .mutateAsync({
                  op: 'settings',
                  version: query.data!.version,
                  loan_days: Number(v.loan_days),
                  max_books: Number(v.max_books),
                  max_renewals: Number(v.max_renewals),
                })
                .then(() => setSuccess(true))
                .catch(() => {});
            }}
          >
            <label>
              Default loan days
              <input
                name="loan_days"
                type="number"
                required
                min={1}
                max={365}
                step={1}
                defaultValue={query.data.loan_days}
              />
            </label>
            <label>
              Maximum open books per learner
              <input
                name="max_books"
                type="number"
                required
                min={1}
                max={50}
                step={1}
                defaultValue={query.data.max_books}
              />
            </label>
            <label>
              Maximum renewals per loan
              <input
                name="max_renewals"
                type="number"
                required
                min={0}
                max={20}
                step={1}
                defaultValue={query.data.max_renewals}
              />
            </label>
            <ModuleError error={save.error} />
            <button disabled={save.isPending}>Save borrowing rules</button>
            {success && <p role="status">Borrowing rules saved.</p>}
          </form>
        )}
      </QueryState>
    </section>
  );
}
function Reports({ onOverdue }: { onOverdue: () => void }) {
  const query = useCommunityRead<LibraryReport>('library', { op: 'report' });
  return (
    <section className="panel">
      <h2>Library reports</h2>
      <QueryState pending={query.isPending} error={query.error}>
        {query.data && (
          <>
            <p>
              Current inventory and circulation as at {query.data.as_at} in the school time zone.
            </p>
            <div className="module-metrics">
              {[
                ['Active titles', query.data.titles],
                ['Registered copies', query.data.copies],
                ['Available copies', query.data.available],
                ['On loan', query.data.on_loan],
                ['Overdue loans', query.data.overdue],
                ['Lost copies', query.data.lost],
                ['Damaged copies', query.data.damaged],
              ].map(([label, value]) => (
                <article key={label}>
                  <small>{label}</small>
                  <strong>{value}</strong>
                </article>
              ))}
            </div>
            <button className="secondary" onClick={onOverdue}>
              View overdue books
            </button>
            <p className="muted">
              Counts exclude retired copies. Available copies belong to active titles and have no
              open loan. No fines are calculated.
            </p>
          </>
        )}
      </QueryState>
    </section>
  );
}
