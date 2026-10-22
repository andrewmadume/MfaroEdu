import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Search } from 'lucide-react';
import { useSchool } from '../../contexts/SchoolContext';
import { can } from '../../lib/permissions';
import { entities, displayValue } from '../../lib/directory';
import { listRecords, archiveRecord } from '../../services/directory';
import { useDebounced } from '../../hooks/useDebounced';
import type { EntityKey, SchoolRecord } from '../../types/directory';
import RecordForm from '../forms/RecordForm';
import RecordLookup from '../forms/RecordLookup';
import Modal from '../ui/Modal';
import { ErrorMessage, Loading } from '../ui/Feedback';
export default function RecordList({
  entity,
  pinned = {},
  onView,
  compact = false,
}: {
  entity: EntityKey;
  pinned?: Record<string, string>;
  onView?: (row: SchoolRecord) => void;
  compact?: boolean;
}) {
  const { school, permissions } = useSchool();
  const client = useQueryClient();
  const def = entities[entity];
  const manage = can(permissions, def.manage);
  const [search, setSearch] = useState(''),
    [page, setPage] = useState(0),
    [archived, setArchived] = useState(false),
    [sort, setSort] = useState(''),
    [classId, setClassId] = useState('');
  const term = useDebounced(search);
  const [editing, setEditing] = useState<SchoolRecord | 'new' | null>(null),
    [confirm, setConfirm] = useState<SchoolRecord | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [success, setSuccess] = useState('');
  const query = useQuery({
    queryKey: ['directory', school.id, entity, term, page, archived, sort, pinned, classId],
    queryFn: () =>
      listRecords(school.id, entity, {
        search: term,
        page,
        archived,
        sort,
        filters: pinned,
        classId,
      }),
  });
  async function refresh() {
    await client.invalidateQueries({
      predicate: (q) =>
        ['directory', 'record', 'lookup', 'school-counts', 'enrollments'].includes(
          String(q.queryKey[0]),
        ),
    });
  }
  async function archive() {
    if (!confirm) return;
    setBusy(true);
    setError('');
    try {
      await archiveRecord(school.id, entity, confirm);
      setSuccess(
        confirm.archived ? 'Record restored.' : 'Record archived. History has been retained.',
      );
      setConfirm(null);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update this record.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel directory-panel">
      <div className="section-heading">
        <div>
          <h2>{def.title}</h2>
          {compact && <p className="muted">{def.description}</p>}
        </div>
        {manage && (
          <button
            onClick={() => {
              setEditing('new');
              setSuccess('');
            }}
          >
            <Plus size={17} />
            Add {def.singular}
          </button>
        )}
      </div>
      <div className="directory-toolbar">
        {!compact && (
          <label className="search-field">
            <Search size={17} />
            <input
              aria-label={`Search ${def.title.toLowerCase()}`}
              type="search"
              maxLength={80}
              placeholder="Search name or identifier"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(0);
              }}
            />
          </label>
        )}
        <label>
          Records
          <select
            value={archived ? 'archived' : 'active'}
            onChange={(e) => {
              setArchived(e.target.value === 'archived');
              setPage(0);
            }}
          >
            <option value="active">Active records</option>
            <option value="archived">Archived records</option>
          </select>
        </label>
        {!compact && (
          <label>
            Sort by
            <select
              value={sort}
              onChange={(e) => {
                setSort(e.target.value);
                setPage(0);
              }}
            >
              <option value="">Default order</option>
              {def.fields
                .filter((f) => !['reference', 'textarea', 'checkbox'].includes(f.kind ?? ''))
                .map((f) => (
                  <option key={f.key} value={f.key}>
                    {f.label}
                  </option>
                ))}
            </select>
          </label>
        )}
      </div>
      {entity === 'students' && (
        <details className="filter-details">
          <summary>Filter by current class</summary>
          <RecordLookup
            entity="classes"
            label="Current class"
            value={classId}
            onChange={(id) => {
              setClassId(id);
              setPage(0);
            }}
          />
        </details>
      )}
      <ErrorMessage message={error} />
      {success && (
        <p className="alert success" role="status">
          {success}
        </p>
      )}
      {query.isPending ? (
        <Loading />
      ) : query.isError ? (
        <div>
          <ErrorMessage message={query.error.message} />
          <button className="secondary" onClick={() => void query.refetch()}>
            Try again
          </button>
        </div>
      ) : (
        <>
          {!query.data.rows.length ? (
            <div className="empty-state">
              <h3>
                {search
                  ? 'No matching records'
                  : archived
                    ? 'No archived records'
                    : `No ${def.title.toLowerCase()} yet`}
              </h3>
              <p>
                {search
                  ? 'Try another name or identifier.'
                  : manage
                    ? `Use “Add ${def.singular}” to create the first record.`
                    : 'Records available to your account will appear here.'}
              </p>
            </div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    {def.columns.map((col) => (
                      <th key={col}>
                        {def.fields.find((f) => f.key === col)?.label ?? col.replaceAll('_', ' ')}
                      </th>
                    ))}
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {query.data.rows.map((row) => (
                    <tr key={row.id}>
                      {def.columns.map((col) => (
                        <td key={col}>{displayValue(row[col])}</td>
                      ))}
                      <td>
                        <div className="row-actions">
                          {onView && (
                            <button className="secondary compact" onClick={() => onView(row)}>
                              View
                            </button>
                          )}
                          {manage && (
                            <>
                              <button
                                className="secondary compact"
                                onClick={() => {
                                  setEditing(row);
                                  setSuccess('');
                                }}
                              >
                                Edit
                              </button>
                              <button
                                className="text-button"
                                onClick={() => {
                                  setConfirm(row);
                                  setError('');
                                }}
                              >
                                {row.archived ? 'Restore' : 'Archive'}
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="pagination">
            <span>
              {query.data.count} records · Page {page + 1}
            </span>
            <button
              className="secondary"
              disabled={page === 0}
              onClick={() => setPage((p) => p - 1)}
            >
              Previous
            </button>
            <button
              className="secondary"
              disabled={(page + 1) * 20 >= query.data.count}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </button>
          </div>
        </>
      )}
      {editing && (
        <Modal
          title={`${editing === 'new' ? 'Add' : 'Edit'} ${def.singular}`}
          onClose={() => setEditing(null)}
        >
          <RecordForm
            entity={entity}
            record={editing === 'new' ? undefined : editing}
            pinned={pinned}
            onCancel={() => setEditing(null)}
            onSaved={() => {
              setEditing(null);
              setSuccess('Record saved.');
              void refresh();
            }}
          />
        </Modal>
      )}
      {confirm && (
        <Modal
          title={`${confirm.archived ? 'Restore' : 'Archive'} ${def.singular}?`}
          onClose={() => {
            if (!busy) setConfirm(null);
          }}
        >
          <p>
            {confirm.archived
              ? 'This record will become available again.'
              : 'This hides the record from active lists. Historical records will be retained.'}
          </p>
          <ErrorMessage message={error} />
          <div className="form-actions">
            <button disabled={busy} onClick={() => void archive()}>
              {busy ? 'Saving…' : confirm.archived ? 'Restore record' : 'Archive record'}
            </button>
            <button className="secondary" disabled={busy} onClick={() => setConfirm(null)}>
              Cancel
            </button>
          </div>
        </Modal>
      )}
    </section>
  );
}
