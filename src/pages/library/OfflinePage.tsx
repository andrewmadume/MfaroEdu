import { useEffect, useState } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { advancedCall } from '../../services/advanced';
import { moduleCall } from '../../services/community';
import { validateDraft, listDrafts, saveDraft, removeDraft } from '../../lib/offlineDrafts';
import type { BookDraft } from '../../types/advanced';
import { ErrorMessage, Loading } from '../../components/ui/Feedback';
import '../../app/advanced.css';
const emptyBook = () => ({
  version: 0,
  title: '',
  author: '',
  isbn: '',
  category: '',
  publisher: '',
  archived: false,
});
type ServerBook = BookDraft['book'];
function fromServer(b: ServerBook): ServerBook {
  return {
    id: b.id,
    version: b.version,
    title: b.title,
    author: b.author,
    isbn: b.isbn ?? '',
    category: b.category ?? '',
    publisher: b.publisher ?? '',
    archived: b.archived,
  };
}
export default function OfflinePage() {
  const { session, loading } = useAuth();
  const [params] = useSearchParams();
  const tenant = params.get('school') ?? '';
  const schoolName = (params.get('name') || 'School workspace').slice(0, 120);
  const user = session?.user.id ?? '';
  const [drafts, setDrafts] = useState<BookDraft[]>([]),
    [draft, setDraft] = useState<BookDraft | null>(null),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false),
    [consent, setConsent] = useState(false),
    [online, setOnline] = useState(navigator.onLine),
    [conflict, setConflict] = useState<ServerBook | null>(null),
    [missing, setMissing] = useState(false);
  const [search, setSearch] = useState(''),
    [books, setBooks] = useState<ServerBook[]>([]),
    [page, setPage] = useState(0),
    [count, setCount] = useState(0);
  const refresh = async () => setDrafts(await listDrafts(user));
  useEffect(() => {
    setDraft(null);
    setDrafts([]);
    setConflict(null);
    if (user) void refresh().catch((e) => setError(e.message));
  }, [user]);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Request not completed.');
    } finally {
      setBusy(false);
    }
  }
  function start(book = emptyBook(), school = tenant) {
    setDraft({
      schema: 1,
      attempted: false,
      id: crypto.randomUUID(),
      user,
      tenant: school,
      school_name: schoolName,
      saved_at: new Date().toISOString(),
      request_key: crypto.randomUUID(),
      book,
    });
    setConflict(null);
    setMissing(false);
    setNotice('');
    setError('');
  }
  async function persist() {
    if (!draft || !consent) throw new Error('Confirm that this device may store catalogue drafts.');
    const saved = validateDraft({ ...draft, saved_at: new Date().toISOString() });
    await saveDraft(saved);
    setDraft(saved);
    await refresh();
    setNotice('Draft saved on this device. It has not been sent to your school.');
  }
  async function sync() {
    if (!draft) return;
    const parsed = validateDraft({ ...draft, attempted: true });
    if (parsed.user !== user) throw new Error('Reopen the draft using its owner account.');
    setDraft(parsed);
    // Persist the exact request key before transmission. A lost response can safely be retried.
    if (!consent) throw new Error('Confirm that this device may store catalogue drafts.');
    await saveDraft(parsed);
    await refresh();
    try {
      await advancedCall('write', parsed.tenant, {
        op: 'sync_book',
        request_key: parsed.request_key,
        ...parsed.book,
      });
      await removeDraft(parsed.id);
      await refresh();
      setDraft(null);
      setConflict(null);
      setNotice('Catalogue synchronized. The server checked your current permission.');
    } catch (e) {
      if (e instanceof Error && e.message === 'Record changed; reload before saving') {
        const current = await advancedCall<ServerBook | null>('read', parsed.tenant, {
          op: 'book',
          id: parsed.book.id,
        });
        if (current) setConflict(fromServer(current));
        else setMissing(true);
        return;
      }
      throw e;
    }
  }
  if (loading) return <Loading />;
  if (!session) return <Navigate to="/auth/login" replace />;
  return (
    <main className="offline-shell">
      <Link to={tenant ? `/library?school=${tenant}` : '/library'} className="text-link">
        Back to school library
      </Link>
      <header>
        <span className="eyebrow">SAVE LOCALLY. REVIEW BEFORE SENDING.</span>
        <h1>Offline catalogue drafts</h1>
        <p>
          {online
            ? 'Online — synchronization is available.'
            : 'Offline — local drafts remain available.'}
        </p>
        <p>
          Only book catalogue details are stored here. Do not enter learner names or other personal
          information. Drafts are scoped to this account and school, removed on sign-out and never
          sent automatically. Reopening this page offline requires a previously loaded app and a
          retained, unexpired session. Device storage can be cleared by your browser.
        </p>
      </header>
      {error && <ErrorMessage message={error} />}{' '}
      {notice && (
        <p role="status" className="panel">
          {notice}
        </p>
      )}
      <label>
        <span>
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />{' '}
          This trusted device may store non-personal catalogue drafts.
        </span>
      </label>
      <div className="offline-grid">
        <section className="panel">
          <h2>Saved drafts</h2>
          {drafts.length === 0 && <p>No drafts on this device.</p>}
          {drafts.map((d) => (
            <p key={d.id}>
              <button
                className="secondary"
                onClick={() => {
                  setDraft(d);
                  setConflict(null);
                  setMissing(false);
                  setError('');
                  setNotice('');
                }}
              >
                {d.book.title}
              </button>
              <small>
                {' '}
                {d.school_name} · {new Date(d.saved_at).toLocaleString()}
              </small>
            </p>
          ))}
          {tenant && (
            <button disabled={busy} onClick={() => start()}>
              New book draft
            </button>
          )}
          {!tenant && !draft && (
            <p>
              Open Reports & data from your school to start a draft. Existing drafts can be reopened
              here.
            </p>
          )}
          {tenant && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void run(async () => {
                  const result = await moduleCall<{ rows: ServerBook[]; count: number }>(
                    'library',
                    'read',
                    tenant,
                    { op: 'books', page, search },
                  );
                  setBooks(result.rows);
                  setCount(result.count);
                });
              }}
            >
              <h3>Edit an existing book</h3>
              <label>
                Find catalogue book
                <input
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    setPage(0);
                  }}
                />
              </label>
              <button disabled={!online || busy}>Search catalogue</button>
              {books.map((b) => (
                <p key={b.id}>
                  <button type="button" className="secondary" onClick={() => start(fromServer(b))}>
                    {b.title} — {b.author}
                  </button>
                </p>
              ))}
              <div className="draft-actions">
                <button type="button" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
                  Previous
                </button>
                <span>Page {page + 1}</span>
                <button
                  type="button"
                  disabled={(page + 1) * 20 >= count}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Next
                </button>
              </div>
              <small>Search again after changing page.</small>
            </form>
          )}
        </section>
        <section className="panel">
          <h2>{draft?.book.id ? 'Edit catalogue draft' : 'New catalogue draft'}</h2>
          {!draft ? (
            <p>Choose a saved draft or start from your school workspace.</p>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void run(persist);
              }}
            >
              <p className="muted">
                {draft.book.id
                  ? `Based on catalogue version ${draft.book.version}`
                  : 'Creates one new catalogue title. No physical copies are created.'}
              </p>
              {(['title', 'author', 'isbn', 'category', 'publisher'] as const).map((k) => (
                <label key={k}>
                  {
                    {
                      title: 'Book title',
                      author: 'Author',
                      isbn: 'ISBN',
                      category: 'Category',
                      publisher: 'Publisher',
                    }[k]
                  }
                  <input
                    disabled={draft.attempted || busy}
                    required={k === 'title' || k === 'author'}
                    maxLength={
                      { title: 200, author: 160, isbn: 32, category: 100, publisher: 160 }[k]
                    }
                    value={draft.book[k]}
                    onChange={(e) => {
                      setDraft({
                        ...draft,
                        request_key: crypto.randomUUID(),
                        book: { ...draft.book, [k]: e.target.value },
                      });
                      setConflict(null);
                    }}
                  />
                </label>
              ))}
              <p>
                {draft.attempted
                  ? 'This request has been sent. Retry synchronization before editing; a lost response may mean it was already saved.'
                  : ''}
              </p>
              <div className="draft-actions">
                <button disabled={busy || !consent}>Save on device</button>
                <button
                  type="button"
                  disabled={busy || !online || !consent || !!conflict || missing}
                  onClick={() => void run(sync)}
                >
                  Reviewed — synchronize
                </button>
                <button
                  className="secondary"
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await removeDraft(draft.id);
                      setDraft(null);
                      setConflict(null);
                      await refresh();
                      setNotice('Local draft discarded.');
                    })
                  }
                >
                  Discard local draft
                </button>
              </div>
              {missing && (
                <p role="alert">
                  This catalogue title is unavailable. Discard this draft or ask your librarian to
                  check the record.
                </p>
              )}
              {conflict && (
                <aside className="conflict-panel">
                  <h3>Another user changed this book</h3>
                  <p>
                    Your draft remains on this device. Review the current server record before
                    choosing what to keep. Nothing was overwritten.
                  </p>
                  <dl>
                    <dt>Server title</dt>
                    <dd>{conflict.title}</dd>
                    <dt>Server author</dt>
                    <dd>{conflict.author}</dd>
                    <dt>Server ISBN / category / publisher</dt>
                    <dd>
                      {conflict.isbn} / {conflict.category} / {conflict.publisher}
                    </dd>
                    <dt>Server status</dt>
                    <dd>
                      {conflict.archived ? 'Archived' : 'Active'} · version {conflict.version}
                    </dd>
                  </dl>
                  <button
                    type="button"
                    className="secondary"
                    onClick={() =>
                      void run(async () => {
                        await removeDraft(draft.id);
                        setDraft(null);
                        setConflict(null);
                        await refresh();
                        setNotice('Kept the server record and discarded the local draft.');
                      })
                    }
                  >
                    Keep server record
                  </button>
                  <button
                    type="button"
                    disabled={conflict.archived}
                    onClick={() =>
                      void run(async () => {
                        const resolved = {
                          ...draft,
                          attempted: false,
                          request_key: crypto.randomUUID(),
                          saved_at: new Date().toISOString(),
                          book: {
                            ...draft.book,
                            version: conflict.version,
                            archived: conflict.archived,
                          },
                        };
                        await saveDraft(resolved);
                        setDraft(resolved);
                        setConflict(null);
                        await refresh();
                        setNotice(
                          'Your draft now uses the reviewed server version. Synchronize when ready.',
                        );
                      })
                    }
                  >
                    Keep my changes for review
                  </button>
                </aside>
              )}
            </form>
          )}
        </section>
      </div>
    </main>
  );
}
