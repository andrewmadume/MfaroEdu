import { useRef, useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSchool } from '../../contexts/SchoolContext';
import { can, roleLabels } from '../../lib/permissions';
import { validateAttachment } from '../../lib/community';
import { downloadFile, calendarIcs } from '../../lib/advanced';
import {
  schoolCall,
  schoolList,
  uploadDocument,
  downloadDocument,
  archiveDocument,
  type SchoolEvent,
  type SchoolDocument,
} from '../../services/schoolTools';
import { ErrorMessage, Loading } from '../../components/ui/Feedback';
import RecordLookup from '../../components/forms/RecordLookup';
import Modal from '../../components/ui/Modal';
import { eventSchema, eventTimes } from '../../schemas/schoolTools';
const audienceLabels: Record<string, string> = {
  SCHOOL: 'School community',
  STAFF: 'School staff',
  LEARNER: 'Learner and linked guardians',
  STAFF_MEMBER: 'Selected staff member',
  ADMIN: 'Document managers',
};
const eventLabels: Record<string, string> = {
  EVENT: 'School event',
  EXAM: 'Exam',
  MEETING: 'Meeting',
  PARENT_MEETING: 'Parent meeting',
  HOLIDAY: 'Holiday',
  SPORT: 'Sport',
  ACADEMIC: 'Academic event',
};

export default function SchoolResources({ module }: { module: 'events' | 'documents' }) {
  const { school } = useSchool();
  return <Resources key={`${school.id}-${module}`} module={module} />;
}
function Resources({ module }: { module: 'events' | 'documents' }) {
  const { school, permissions } = useSchool();
  const manage = can(permissions, `${module}.manage`),
    view = can(permissions, `${module}.view`);
  const [page, setPage] = useState(0),
    [search, setSearch] = useState(''),
    [archived, setArchived] = useState(false),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(''),
    [editing, setEditing] = useState<SchoolEvent | null | undefined>(undefined);
  const q = useQuery({
    queryKey: ['school-resources', school.id, module, page, archived, search],
    queryFn: () =>
      schoolList<SchoolEvent | SchoolDocument>(
        module === 'events' ? 'school_events' : 'school_documents',
        school.id,
        page,
        archived,
        search,
      ),
    enabled: view,
  });
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Request failed.');
    } finally {
      await q.refetch();
      setBusy(false);
    }
  }
  if (!view)
    return (
      <div className="panel">
        <h1>Access unavailable</h1>
      </div>
    );
  return (
    <>
      <header className="page-heading">
        <span className="eyebrow">YOUR SCHOOL</span>
        <h1>{module === 'events' ? 'School calendar' : 'Private documents'}</h1>
        <p>
          {module === 'events'
            ? `Events, exams, meetings and holidays · ${school.timezone}.`
            : 'School policies, learner records and staff documents. Access is checked on every download.'}
        </p>
      </header>
      <ErrorMessage message={error} />
      {notice && (
        <p className="alert success" role="status">
          {notice}
        </p>
      )}
      <section className="panel stack">
        <div className="form-grid">
          <label>
            Search title
            <input
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(0);
              }}
            />
          </label>
          {manage && (
            <label>
              Status
              <select
                value={String(archived)}
                onChange={(e) => {
                  setArchived(e.target.value === 'true');
                  setPage(0);
                }}
              >
                <option value="false">Active</option>
                <option value="true">Archived</option>
              </select>
            </label>
          )}
        </div>
        {module === 'events' && (
          <div>
            {manage && <button onClick={() => setEditing(null)}>New event</button>}{' '}
            <button
              className="secondary"
              onClick={() => {
                const rows = (q.data?.rows ?? []) as SchoolEvent[];
                downloadFile(
                  'school-events.ics',
                  calendarIcs(
                    rows.map((e) => ({
                      id: e.id,
                      name: e.title,
                      starts_on: e.starts_at.slice(0, 10),
                      ends_on: e.ends_at.slice(0, 10),
                      version: e.version,
                      starts_at: e.starts_at,
                      ends_at: e.ends_at,
                      all_day: e.all_day,
                      description: e.description,
                    })),
                  ),
                  'text/calendar;charset=utf-8',
                );
              }}
            >
              Export visible events
            </button>
          </div>
        )}
        {q.isPending ? (
          <Loading />
        ) : q.isError ? (
          <ErrorMessage message={q.error.message} />
        ) : (
          <>
            {!q.data.rows.length && <p>No matching {module}.</p>}
            {q.data.rows.map((row) =>
              module === 'events' ? (
                <article className="panel" key={row.id}>
                  <h2>{row.title}</h2>
                  <p>
                    {eventLabels[(row as SchoolEvent).category]} ·{' '}
                    {(row as SchoolEvent).all_day
                      ? (row as SchoolEvent).starts_at.slice(0, 10)
                      : new Date((row as SchoolEvent).starts_at).toLocaleString(undefined, {
                          timeZone: school.timezone,
                        })}{' '}
                    –{' '}
                    {(row as SchoolEvent).all_day
                      ? new Date(Date.parse((row as SchoolEvent).ends_at) - 86400000)
                          .toISOString()
                          .slice(0, 10)
                      : new Date((row as SchoolEvent).ends_at).toLocaleString(undefined, {
                          timeZone: school.timezone,
                        })}
                  </p>
                  <p className="preserve-lines">{(row as SchoolEvent).description}</p>
                  {manage && (
                    <button
                      disabled={busy}
                      className="secondary"
                      onClick={() => setEditing(row as SchoolEvent)}
                    >
                      Edit event
                    </button>
                  )}
                </article>
              ) : (
                <article className="panel" key={row.id}>
                  <h2>{row.title}</h2>
                  <p>
                    {(row as SchoolDocument).filename} ·{' '}
                    {Math.ceil((row as SchoolDocument).byte_size / 1024)} KB ·{' '}
                    {audienceLabels[(row as SchoolDocument).audience]} ·{' '}
                    {(row as SchoolDocument).ready ? 'Ready' : 'Upload pending'}
                  </p>
                  {!row.archived && (row as SchoolDocument).ready && (
                    <button
                      disabled={busy}
                      onClick={() =>
                        void run(() => downloadDocument(school.id, row as SchoolDocument))
                      }
                    >
                      Download document
                    </button>
                  )}
                  {manage && !row.archived && !(row as SchoolDocument).ready && (
                    <>
                      <label>
                        Retry original file
                        <input
                          type="file"
                          accept="application/pdf,image/png,image/jpeg,text/plain"
                          disabled={busy}
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (f)
                              void run(async () => {
                                await uploadDocument(school.id, row as SchoolDocument, f);
                                setNotice('Document ready.');
                              });
                          }}
                        />
                      </label>
                      <button
                        disabled={busy}
                        onClick={() =>
                          void run(async () => {
                            await schoolCall(school.id, {
                              op: 'finish_document',
                              id: row.id,
                              version: row.version,
                            });
                            setNotice('Document ready.');
                          })
                        }
                      >
                        Finish uploaded file
                      </button>
                    </>
                  )}
                  {manage && (
                    <button
                      disabled={busy}
                      className="secondary"
                      onClick={() => {
                        if (
                          window.confirm(
                            row.archived
                              ? 'Retry deletion of the archived file bytes?'
                              : 'Archive this document and revoke downloads?',
                          )
                        )
                          void run(async () => {
                            await archiveDocument(school.id, row as SchoolDocument);
                            setNotice('Document archived and stored bytes removed.');
                          });
                      }}
                    >
                      {row.archived ? 'Retry file cleanup' : 'Archive document'}
                    </button>
                  )}
                </article>
              ),
            )}
            <div className="pagination">
              <button
                disabled={page === 0}
                className="secondary"
                onClick={() => setPage((p) => p - 1)}
              >
                Previous
              </button>
              <span>Page {page + 1}</span>
              <button
                className="secondary"
                disabled={(page + 1) * 20 >= q.data.count}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </button>
            </div>
          </>
        )}
      </section>
      {module === 'documents' && manage && (
        <DocumentUpload
          tenant={school.id}
          onSaved={async () => {
            await q.refetch();
          }}
        />
      )}
      {editing !== undefined && (
        <Modal title={editing ? 'Edit event' : 'New event'} onClose={() => setEditing(undefined)}>
          <EventForm
            event={editing}
            tenant={school.id}
            onSaved={async () => {
              setEditing(undefined);
              await q.refetch();
            }}
          />
        </Modal>
      )}
    </>
  );
}
const localDate = (value?: string) => {
  const d = value ? new Date(value) : new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};
function EventForm({
  event,
  tenant,
  onSaved,
}: {
  event: SchoolEvent | null;
  tenant: string;
  onSaved: () => Promise<void>;
}) {
  const [classId, setClassId] = useState(event?.class_id ?? ''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const requestKey = useRef(crypto.randomUUID());
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError('');
    try {
      const allDay = f.get('all_day') === 'on';
      const parsed = eventSchema.safeParse({
        title: f.get('title'),
        description: f.get('description'),
        category: f.get('category'),
        ...eventTimes(String(f.get('starts')), String(f.get('ends')), allDay),
        all_day: allDay,
        class_id: classId || null,
        roles: f.getAll('roles'),
        archived: f.get('archived') === 'on',
      });
      if (!parsed.success) throw Error(parsed.error.issues[0].message);
      await schoolCall(tenant, {
        op: 'save_event',
        request_key: requestKey.current,
        id: event?.id,
        version: event?.version,
        ...parsed.data,
      });
      await onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Event not saved.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="stack" onSubmit={submit}>
      <label>
        Event title
        <input name="title" required maxLength={160} defaultValue={event?.title} />
      </label>
      <label>
        Description
        <textarea name="description" maxLength={3000} defaultValue={event?.description} />
      </label>
      <label>
        Category
        <select name="category" defaultValue={event?.category ?? 'EVENT'}>
          {['EVENT', 'EXAM', 'MEETING', 'PARENT_MEETING', 'HOLIDAY', 'SPORT', 'ACADEMIC'].map(
            (v) => (
              <option key={v} value={v}>
                {eventLabels[v]}
              </option>
            ),
          )}
        </select>
      </label>
      <p>
        Enter times in this device’s timezone: {Intl.DateTimeFormat().resolvedOptions().timeZone}.
        Calendar viewers see school-local times. For all-day events, the start and end dates are
        inclusive and time fields are ignored.
      </p>
      <label>
        Starts
        <input
          name="starts"
          type="datetime-local"
          required
          defaultValue={event?.all_day ? event.starts_at.slice(0, 16) : localDate(event?.starts_at)}
        />
      </label>
      <label>
        Ends
        <input
          name="ends"
          type="datetime-local"
          required
          defaultValue={
            event?.all_day
              ? new Date(Date.parse(event.ends_at) - 86400000).toISOString().slice(0, 16)
              : localDate(event?.ends_at)
          }
        />
      </label>
      <label className="checkbox-field">
        <input type="checkbox" name="all_day" defaultChecked={event?.all_day} />
        All-day event
      </label>
      <RecordLookup entity="classes" label="Optional class" value={classId} onChange={setClassId} />
      <fieldset>
        <legend>Audience roles</legend>
        {Object.entries(roleLabels)
          .filter(([k]) => k !== 'SUPER_ADMIN')
          .map(([k, v]) => (
            <label key={k} className="checkbox-field">
              <input
                type="checkbox"
                name="roles"
                value={k}
                defaultChecked={event ? event.roles.includes(k) : true}
              />
              {v}
            </label>
          ))}
      </fieldset>
      {event && (
        <label className="checkbox-field">
          <input type="checkbox" name="archived" defaultChecked={event.archived} />
          Archived
        </label>
      )}
      <ErrorMessage message={error} />
      <button disabled={busy}>{busy ? 'Saving…' : 'Save event'}</button>
    </form>
  );
}
function DocumentUpload({ tenant, onSaved }: { tenant: string; onSaved: () => Promise<void> }) {
  const [audience, setAudience] = useState('SCHOOL'),
    [person, setPerson] = useState(''),
    [file, setFile] = useState<File | null>(null),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false);
  const attempt = useRef<{ signature: string; id: string } | null>(null);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const title = String(new FormData(e.currentTarget).get('title'));
    setError('');
    setNotice('');
    setBusy(true);
    try {
      if (!file) throw Error('Choose a document.');
      if ((audience === 'LEARNER' || audience === 'STAFF_MEMBER') && !person)
        throw Error('Choose the learner or staff member for this document.');
      validateAttachment(file);
      const values = {
        title,
        filename: file.name,
        mime_type: file.type,
        byte_size: file.size,
        audience,
        student_id: audience === 'LEARNER' ? person || null : null,
        staff_id: audience === 'STAFF_MEMBER' ? person || null : null,
      };
      const signature = JSON.stringify(values);
      if (!attempt.current || attempt.current.signature !== signature)
        attempt.current = { signature, id: crypto.randomUUID() };
      const d = await schoolCall<SchoolDocument>(tenant, {
        op: 'reserve_document',
        id: attempt.current.id,
        ...values,
      });
      await uploadDocument(tenant, d, file);
      attempt.current = null;
      setNotice('Document uploaded and ready.');
      setFile(null);
      await onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed.');
      await onSaved();
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="panel stack" onSubmit={submit}>
      <h2>Upload private document</h2>
      <p>
        PDF, PNG, JPEG or text · up to 5 MB. Upload approved files only; automated virus scanning is
        not available.
      </p>
      <label>
        Document title
        <input name="title" required maxLength={160} />
      </label>
      <label>
        Document audience
        <select
          value={audience}
          onChange={(e) => {
            setAudience(e.target.value);
            setPerson('');
          }}
        >
          {['SCHOOL', 'STAFF', 'LEARNER', 'STAFF_MEMBER', 'ADMIN'].map((a) => (
            <option key={a} value={a}>
              {audienceLabels[a]}
            </option>
          ))}
        </select>
      </label>
      {(audience === 'LEARNER' || audience === 'STAFF_MEMBER') && (
        <RecordLookup
          entity={audience === 'LEARNER' ? 'students' : 'staff'}
          label={audience === 'LEARNER' ? 'Learner' : 'Staff member'}
          value={person}
          onChange={setPerson}
        />
      )}
      <label>
        Document file
        <input
          type="file"
          required
          accept="application/pdf,image/png,image/jpeg,text/plain"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
      </label>
      <ErrorMessage message={error} />
      {notice && <p role="status">{notice}</p>}
      <button disabled={busy}>{busy ? 'Uploading…' : 'Upload document'}</button>
    </form>
  );
}
