import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useSchool } from '../../contexts/SchoolContext';
import { can } from '../../lib/permissions';
import { useCommunityRead, useCommunityWrite } from '../../hooks/useCommunity';
import { useDebounced } from '../../hooks/useDebounced';
import {
  ModuleError,
  ModulePager,
  QueryState,
  formValues,
} from '../../components/common/CommunityUI';
import Modal from '../../components/ui/Modal';
import {
  downloadAttachment,
  finishAttachment,
  removeAttachment,
  uploadAttachment,
} from '../../services/community';
import type {
  Announcement,
  AnnouncementFile,
  CommSetup,
  Conversation,
  NoticePage,
  PageResult,
  Recipient,
  Thread,
} from '../../types/community';
import '../../app/community.css';

export default function CommunicationPage() {
  const { school, permissions } = useSchool();
  return can(permissions, 'communication.view') ? (
    <CommunicationWorkspace key={school.id} />
  ) : (
    <section className="panel">
      <h1>Access unavailable</h1>
      <p>Your school has not assigned communication access.</p>
    </section>
  );
}
function CommunicationWorkspace() {
  const { school, permissions } = useSchool(),
    client = useQueryClient(),
    [tab, setTab] = useState('announcements'),
    [announcement, setAnnouncement] = useState(''),
    [thread, setThread] = useState('');
  const notices = useCommunityRead<NoticePage>('communication', {
    op: 'notifications',
    page: 0,
    unread_only: true,
  });
  const tabs = [
    ['announcements', 'Announcements'],
    ['messages', 'Messages'],
    ['notifications', `Notifications${notices.data ? ' · ' + notices.data.unread : ''}`],
    ...(can(permissions, 'communication.manage') ? [['settings', 'Settings']] : []),
  ];
  return (
    <div className="community-workspace">
      <header className="page-heading">
        <span className="eyebrow">COMMUNICATION HUB</span>
        <h1>Keep your school connected.</h1>
        <p>Announcements, private conversations and notifications in one place.</p>
      </header>
      <div className="module-tabs">
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
        <button
          className="secondary"
          onClick={() =>
            void client.invalidateQueries({ queryKey: ['community', 'communication', school.id] })
          }
        >
          Refresh inbox
        </button>
      </div>
      <p className="muted module-caption">
        In-app delivery · Updates refresh every 30 seconds. Email, SMS and WhatsApp delivery are not
        configured.
      </p>
      {tab === 'announcements' ? (
        <Announcements selected={announcement} onSelect={setAnnouncement} />
      ) : tab === 'messages' ? (
        <Messages selected={thread} onSelect={setThread} />
      ) : tab === 'notifications' ? (
        <Notifications
          onOpen={(kind, id) => {
            if (kind === 'ANNOUNCEMENT') {
              setAnnouncement(id);
              setTab('announcements');
            } else {
              setThread(id);
              setTab('messages');
            }
          }}
        />
      ) : (
        <CommunicationSettings />
      )}
    </div>
  );
}
function CommunicationSettings() {
  const query = useCommunityRead<CommSetup>('communication', { op: 'settings' }),
    save = useCommunityWrite('communication'),
    [success, setSuccess] = useState(false);
  return (
    <section className="panel">
      <h2>Family messaging</h2>
      <p>
        Allow parents and learners to message their assigned teachers and school administrators.
        Staff can message other staff. Existing participants retain conversation history when this
        setting is disabled.
      </p>
      <QueryState pending={query.isPending} error={query.error}>
        {query.data && (
          <form
            key={query.data.settings?.version ?? 0}
            className="module-form"
            onSubmit={(event) => {
              const values = formValues(event);
              setSuccess(false);
              void save
                .mutateAsync({
                  op: 'settings',
                  version: query.data!.settings?.version ?? 0,
                  family_messages_enabled: values.enabled === 'on',
                })
                .then(() => setSuccess(true))
                .catch(() => {});
            }}
          >
            <label className="module-check">
              <input
                type="checkbox"
                name="enabled"
                defaultChecked={query.data.settings?.family_messages_enabled ?? false}
              />
              Enable family messaging
            </label>
            <ModuleError error={save.error} />
            <button disabled={save.isPending}>Save messaging settings</button>
            {success && <p role="status">Messaging settings saved.</p>}
          </form>
        )}
      </QueryState>
    </section>
  );
}
function Announcements({
  selected,
  onSelect,
}: {
  selected: string;
  onSelect: (id: string) => void;
}) {
  const { permissions } = useSchool(),
    [folder, setFolder] = useState('feed'),
    [search, setSearch] = useState(''),
    term = useDebounced(search),
    [page, setPage] = useState(0),
    [editor, setEditor] = useState<Announcement | null | undefined>(undefined);
  const query = useCommunityRead<PageResult<Announcement>>('communication', {
    op: 'announcements',
    folder,
    search: term,
    page,
  });
  return (
    <div className="module-stack">
      <section className="panel">
        <div className="section-heading">
          <h2>Announcements</h2>
          {can(permissions, 'communication.post') && (
            <button onClick={() => setEditor(null)}>New announcement</button>
          )}
        </div>
        <div className="module-form horizontal">
          <label>
            Search announcements
            <input
              value={search}
              maxLength={100}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(0);
              }}
            />
          </label>
          {can(permissions, 'communication.post') && (
            <label>
              View
              <select
                value={folder}
                onChange={(e) => {
                  setFolder(e.target.value);
                  setPage(0);
                }}
              >
                <option value="feed">Published feed</option>
                <option value="manage">Manage drafts & history</option>
              </select>
            </label>
          )}
        </div>
        <QueryState pending={query.isPending} error={query.error}>
          {query.data && (
            <>
              <div className="announcement-list">
                {query.data.rows.map((a) => (
                  <article className="announcement-preview" key={a.id}>
                    <div>
                      <span className="badge">
                        {a.status} · {a.scope}
                        {a.class_name ? ' · ' + a.class_name : ''}
                      </span>
                      <h3>{a.title}</h3>
                      <p>
                        {a.body.slice(0, 180)}
                        {a.body.length > 180 ? '…' : ''}
                      </p>
                      <small>
                        {a.author_name} ·{' '}
                        {new Date(a.published_at ?? a.created_at).toLocaleDateString()}
                      </small>
                    </div>
                    <button className="secondary" onClick={() => onSelect(a.id)}>
                      Open announcement
                    </button>
                  </article>
                ))}
              </div>
              {!query.data.rows.length && <p>No announcements in this view.</p>}
              <ModulePager page={page} count={query.data.count} onChange={setPage} />
            </>
          )}
        </QueryState>
      </section>
      {selected && <AnnouncementDetail key={selected} id={selected} onEdit={setEditor} />}{' '}
      {editor !== undefined && (
        <AnnouncementEditor
          existing={editor}
          onClose={() => setEditor(undefined)}
          onSaved={(id) => {
            setEditor(undefined);
            onSelect(id);
            setFolder('manage');
            setPage(0);
          }}
        />
      )}
    </div>
  );
}
function AnnouncementEditor({
  existing,
  onSaved,
  onClose,
}: {
  existing: Announcement | null;
  onSaved: (id: string) => void;
  onClose: () => void;
}) {
  const { permissions } = useSchool(),
    setup = useCommunityRead<CommSetup>('communication', { op: 'settings' }),
    save = useCommunityWrite('communication'),
    [scope, setScope] = useState(
      existing?.scope ?? (can(permissions, 'communication.manage') ? 'SCHOOL' : 'CLASS'),
    );
  return (
    <Modal
      title={existing ? 'Edit announcement draft' : 'New announcement draft'}
      onClose={() => {
        if (!save.isPending) onClose();
      }}
    >
      <p>Save a draft, add any attachments, then publish it to the chosen audience.</p>
      <QueryState pending={setup.isPending} error={setup.error}>
        {setup.data && (
          <form
            className="module-form"
            onSubmit={(e) => {
              const v = formValues(e);
              void save
                .mutateAsync({
                  op: 'draft',
                  id: existing?.id ?? null,
                  version: existing?.version ?? 0,
                  title: v.title,
                  body: v.body,
                  scope,
                  class_id: scope === 'CLASS' ? v.class_id : null,
                })
                .then((r) => onSaved(r.id))
                .catch(() => {});
            }}
          >
            <label>
              Title
              <input name="title" required maxLength={160} defaultValue={existing?.title} />
            </label>
            <label>
              Announcement text
              <textarea
                name="body"
                required
                rows={7}
                maxLength={10000}
                defaultValue={existing?.body}
              />
            </label>
            <label>
              Audience
              <select value={scope} onChange={(e) => setScope(e.target.value)}>
                {can(permissions, 'communication.manage') && (
                  <>
                    <option value="SCHOOL">Whole school</option>
                    <option value="TEACHERS">Teachers</option>
                    <option value="PARENTS">Parents</option>
                    <option value="STUDENTS">Learners</option>
                  </>
                )}
                <option value="CLASS">Class</option>
              </select>
            </label>
            {scope === 'CLASS' && (
              <label>
                Class
                <select name="class_id" required defaultValue={existing?.class_id ?? ''}>
                  <option value="">Select class</option>
                  {setup.data.classes.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <ModuleError error={save.error} />
            <button disabled={save.isPending}>Save draft</button>
          </form>
        )}
      </QueryState>
    </Modal>
  );
}
function AnnouncementDetail({ id, onEdit }: { id: string; onEdit: (a: Announcement) => void }) {
  const { school } = useSchool(),
    client = useQueryClient(),
    query = useCommunityRead<Announcement>('communication', { op: 'announcement', id }),
    save = useCommunityWrite('communication'),
    [fileBusy, setFileBusy] = useState(false),
    [fileError, setFileError] = useState<Error | null>(null);
  async function fileAction(action: () => Promise<unknown>) {
    setFileBusy(true);
    setFileError(null);
    try {
      await action();
    } catch (e) {
      setFileError(e as Error);
    } finally {
      await client.invalidateQueries({ queryKey: ['community', 'communication', school.id] });
      setFileBusy(false);
    }
  }
  return (
    <section className="panel">
      <QueryState pending={query.isPending} error={query.error}>
        {query.data && (
          <>
            <div className="section-heading">
              <div>
                <span className="badge">
                  {query.data.status} · {query.data.scope}
                </span>
                <h2>{query.data.title}</h2>
              </div>
              {query.data.can_edit && (
                <div className="actions">
                  {query.data.status === 'DRAFT' && (
                    <>
                      <button
                        className="secondary"
                        disabled={fileBusy || save.isPending}
                        onClick={() => onEdit(query.data!)}
                      >
                        Edit draft
                      </button>
                      <button
                        disabled={fileBusy || save.isPending}
                        onClick={() =>
                          void save
                            .mutateAsync({ op: 'publish', id, version: query.data!.version })
                            .catch(() => {})
                        }
                      >
                        Publish announcement
                      </button>
                    </>
                  )}
                  {query.data.status !== 'WITHDRAWN' && (
                    <button
                      className="secondary"
                      disabled={fileBusy || save.isPending}
                      onClick={() =>
                        void save
                          .mutateAsync({ op: 'withdraw', id, version: query.data!.version })
                          .catch(() => {})
                      }
                    >
                      Withdraw announcement
                    </button>
                  )}
                </div>
              )}
            </div>
            <p className="muted">By {query.data.author_name}</p>
            <div className="module-prose">{query.data.body}</div>
            <ModuleError error={save.error} />
            <h3>Attachments</h3>
            {query.data.files?.length ? (
              <ul className="attachment-list">
                {query.data.files.map((f) => (
                  <li key={f.id}>
                    <span>
                      {f.filename}
                      <small>
                        {Math.ceil(f.byte_size / 1024)} KB · {f.ready ? 'Ready' : 'Pending upload'}
                      </small>
                    </span>
                    {f.ready && (
                      <button
                        className="secondary"
                        disabled={fileBusy}
                        onClick={() => void fileAction(() => downloadAttachment(school.id, f))}
                      >
                        Download {f.filename}
                      </button>
                    )}
                    {query.data!.can_edit && query.data!.status === 'DRAFT' && (
                      <>
                        <button
                          className="secondary"
                          disabled={fileBusy}
                          onClick={() => void fileAction(() => removeAttachment(school.id, id, f))}
                        >
                          Remove {f.filename}
                        </button>
                        {!f.ready && (
                          <PendingFile
                            file={f}
                            disabled={fileBusy}
                            onRetry={(file) =>
                              void fileAction(() =>
                                uploadAttachment(school.id, query.data!, file, f),
                              )
                            }
                            onFinish={() =>
                              void fileAction(() => finishAttachment(school.id, id, f.id))
                            }
                          />
                        )}
                      </>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">No attachments.</p>
            )}
            {query.data.can_edit && query.data.status === 'DRAFT' && (
              <label className="module-file">
                Add an attachment (PDF, PNG, JPEG or text; 5 MB maximum)
                <input
                  type="file"
                  accept="application/pdf,image/png,image/jpeg,text/plain"
                  disabled={fileBusy || save.isPending || (query.data.files?.length ?? 0) >= 5}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = '';
                    if (file) void fileAction(() => uploadAttachment(school.id, query.data!, file));
                  }}
                />
              </label>
            )}
            <ModuleError error={fileError} />
            {fileBusy && <p role="status">Working with attachment…</p>}
          </>
        )}
      </QueryState>
    </section>
  );
}
function PendingFile({
  file,
  disabled,
  onRetry,
  onFinish,
}: {
  file: AnnouncementFile;
  disabled: boolean;
  onRetry: (f: File) => void;
  onFinish: () => void;
}) {
  return (
    <>
      <label>
        Retry {file.filename}
        <input
          type="file"
          disabled={disabled}
          accept={file.mime_type}
          onChange={(e) => {
            const chosen = e.target.files?.[0];
            e.target.value = '';
            if (chosen) onRetry(chosen);
          }}
        />
      </label>
      <button className="secondary" disabled={disabled} onClick={onFinish}>
        Finish uploaded file
      </button>
    </>
  );
}

function Messages({ selected, onSelect }: { selected: string; onSelect: (id: string) => void }) {
  const [page, setPage] = useState(0),
    [compose, setCompose] = useState(false),
    query = useCommunityRead<PageResult<Thread>>('communication', { op: 'threads', page });
  return (
    <div className="module-stack">
      <section className="panel">
        <div className="section-heading">
          <h2>Private messages</h2>
          <button onClick={() => setCompose(true)}>New message</button>
        </div>
        <p className="muted">
          Conversations are visible only to their participants. The recipient list follows current
          school relationships and messaging settings.
        </p>
        <QueryState pending={query.isPending} error={query.error}>
          {query.data && (
            <>
              <div className="thread-list">
                {query.data.rows.map((t) => (
                  <button
                    className="secondary thread-preview"
                    key={t.id}
                    onClick={() => onSelect(t.id)}
                  >
                    <strong>{t.recipient_name}</strong>
                    <span>{t.preview.slice(0, 120)}</span>
                    <small>{new Date(t.last_message_at).toLocaleString()}</small>
                  </button>
                ))}
              </div>
              {!query.data.rows.length && <p>No conversations yet.</p>}
              <ModulePager page={page} count={query.data.count} onChange={setPage} />
            </>
          )}
        </QueryState>
      </section>
      {selected && <ConversationPanel key={selected} id={selected} />}{' '}
      {compose && (
        <MessageComposer
          onClose={() => setCompose(false)}
          onSent={(id) => {
            setCompose(false);
            onSelect(id);
            setPage(0);
          }}
        />
      )}
    </div>
  );
}
function MessageComposer({
  onClose,
  onSent,
}: {
  onClose: () => void;
  onSent: (id: string) => void;
}) {
  const [search, setSearch] = useState(''),
    term = useDebounced(search),
    [page, setPage] = useState(0),
    [recipient, setRecipient] = useState<Recipient | null>(null),
    query = useCommunityRead<PageResult<Recipient>>('communication', {
      op: 'recipients',
      search: term,
      page,
    }),
    save = useCommunityWrite('communication');
  return (
    <Modal
      title="New private message"
      onClose={() => {
        if (!save.isPending) onClose();
      }}
    >
      <label>
        Search recipients
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
              {query.data.rows.map((r) => (
                <button
                  className={recipient?.id === r.id ? '' : 'secondary'}
                  aria-pressed={recipient?.id === r.id}
                  key={r.id}
                  onClick={() => setRecipient(r)}
                >
                  {r.name}
                  <small>{r.roles.replaceAll('_', ' ')}</small>
                </button>
              ))}
            </div>
            {!query.data.rows.length && (
              <p>
                No eligible recipients. Family messaging may be disabled, or a class relationship
                may not be assigned.
              </p>
            )}
            <ModulePager page={page} count={query.data.count} onChange={setPage} />
          </>
        )}
      </QueryState>
      <form
        className="module-form"
        onSubmit={(e) => {
          const v = formValues(e);
          if (recipient)
            void save
              .mutateAsync({ op: 'message', recipient_id: recipient.id, body: v.body })
              .then((r) => onSent(r.id))
              .catch(() => {});
        }}
      >
        <p>
          To: <strong>{recipient?.name ?? 'Choose a recipient'}</strong>
        </p>
        <label>
          Message
          <textarea name="body" required rows={5} maxLength={5000} />
        </label>
        <ModuleError error={save.error} />
        <button disabled={!recipient || save.isPending}>Send in-app message</button>
      </form>
    </Modal>
  );
}
function ConversationPanel({ id }: { id: string }) {
  const [page, setPage] = useState(0),
    query = useCommunityRead<Conversation>('communication', { op: 'thread', id, page }),
    save = useCommunityWrite('communication');
  return (
    <section className="panel">
      <QueryState pending={query.isPending} error={query.error}>
        {query.data && (
          <>
            <h2>Conversation with {query.data.recipient_name}</h2>
            <p className="muted">
              Page 1 contains the latest messages, shown from oldest to newest within that page.
            </p>
            <div className="message-list">
              {query.data.rows.map((m) => (
                <article className="message-bubble" key={m.id}>
                  <strong>{m.sender_name}</strong>
                  <div className="module-prose">{m.body}</div>
                  <small>{new Date(m.created_at).toLocaleString()}</small>
                </article>
              ))}
            </div>
            <ModulePager page={page} count={query.data.count} onChange={setPage} />
            {query.data.can_reply ? (
              <form
                className="module-form"
                onSubmit={(e) => {
                  const form = e.currentTarget,
                    v = formValues(e);
                  void save
                    .mutateAsync({
                      op: 'message',
                      recipient_id: query.data!.recipient_id,
                      body: v.body,
                    })
                    .then(() => {
                      form.reset();
                      setPage(0);
                    })
                    .catch(() => {});
                }}
              >
                <label>
                  Reply
                  <textarea name="body" required maxLength={5000} rows={4} />
                </label>
                <ModuleError error={save.error} />
                <button disabled={save.isPending}>Send reply</button>
              </form>
            ) : (
              <p>
                Replying is unavailable under the current school settings or recipient relationship.
              </p>
            )}
          </>
        )}
      </QueryState>
    </section>
  );
}
function Notifications({ onOpen }: { onOpen: (kind: string, id: string) => void }) {
  const [page, setPage] = useState(0),
    [unreadOnly, setUnreadOnly] = useState(false),
    query = useCommunityRead<NoticePage>('communication', {
      op: 'notifications',
      page,
      unread_only: unreadOnly,
    }),
    save = useCommunityWrite('communication');
  return (
    <section className="panel">
      <h2>Notification center</h2>
      <label className="module-check">
        <input
          type="checkbox"
          checked={unreadOnly}
          onChange={(e) => {
            setUnreadOnly(e.target.checked);
            setPage(0);
          }}
        />
        Unread only
      </label>
      <QueryState pending={query.isPending} error={query.error}>
        {query.data && (
          <>
            <p>{query.data.unread} unread notifications</p>
            <div className="notice-list">
              {query.data.rows.map((n) => (
                <article key={n.id} className="notice-row">
                  <div>
                    <span className={`badge ${n.read_at ? '' : 'green'}`}>
                      {n.read_at ? 'Read' : 'Unread'}
                    </span>
                    <h3>{n.title}</h3>
                    <small>{new Date(n.created_at).toLocaleString()}</small>
                  </div>
                  <div className="actions">
                    <button className="secondary" onClick={() => onOpen(n.kind, n.target_id)}>
                      Open notification
                    </button>
                    {!n.read_at && (
                      <button
                        className="secondary"
                        disabled={save.isPending}
                        onClick={() =>
                          void save
                            .mutateAsync({ op: 'read_notification', id: n.id })
                            .catch(() => {})
                        }
                      >
                        Mark as read
                      </button>
                    )}
                  </div>
                </article>
              ))}
            </div>
            {!query.data.rows.length && <p>No notifications in this view.</p>}
            <ModulePager page={page} count={query.data.count} onChange={setPage} />
          </>
        )}
      </QueryState>
      <ModuleError error={save.error} />
    </section>
  );
}
