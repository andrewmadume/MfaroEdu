import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSchool } from '../../contexts/SchoolContext';
import { lookupRecords, getRecord, getTimetableTeacher } from '../../services/directory';
import { recordLabel } from '../../lib/directory';
import { useDebounced } from '../../hooks/useDebounced';
import type { EntityKey } from '../../types/directory';
export default function RecordLookup({
  entity,
  label,
  value,
  onChange,
  disabled = false,
  filters = {},
}: {
  entity: EntityKey;
  label: string;
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
  filters?: Record<string, string | boolean>;
}) {
  const { school } = useSchool();
  const [search, setSearch] = useState(''),
    [page, setPage] = useState(0);
  const term = useDebounced(search);
  const query = useQuery({
    queryKey: ['lookup', school.id, entity, term, page, filters],
    queryFn: () => lookupRecords(school.id, entity, { search: term, page, filters }),
    enabled: !disabled,
  });
  const chosen = useQuery({
    queryKey: ['record', school.id, entity, value, filters],
    queryFn: () =>
      filters.timetable
        ? getTimetableTeacher(school.id, value)
        : getRecord(school.id, entity, value),
    enabled: !!value,
  });
  return (
    <div className="record-lookup">
      <span className="field-label">{label}</span>
      {value && (
        <div className="lookup-chosen">
          {chosen.isError
            ? 'Selected record unavailable'
            : chosen.data
              ? recordLabel(chosen.data)
              : 'Loading selection…'}
          {!disabled && (
            <button type="button" className="secondary compact" onClick={() => onChange('')}>
              Clear
            </button>
          )}
        </div>
      )}
      {!disabled && (
        <>
          <input
            type="search"
            aria-label={`Search ${label.toLowerCase()}`}
            placeholder={`Search ${label.toLowerCase()}`}
            maxLength={80}
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(0);
            }}
          />
          <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}>
            <option value="">Select {label.toLowerCase()}</option>
            {value && !query.data?.rows.some((r) => r.id === value) && (
              <option value={value}>
                {chosen.data ? recordLabel(chosen.data) : 'Current selection'}
              </option>
            )}
            {query.data?.rows.map((row) => (
              <option key={row.id} value={row.id}>
                {recordLabel(row)}
              </option>
            ))}
          </select>
          {query.isPending && <small role="status">Loading options…</small>}
          {query.isError && (
            <small role="alert">
              Could not load options.{' '}
              <button type="button" className="text-button" onClick={() => void query.refetch()}>
                Retry
              </button>
            </small>
          )}
          {query.data && !query.data.count && <small>No matching active records.</small>}
          {(page > 0 || (query.data?.count ?? 0) > 20) && (
            <div className="lookup-paging">
              <button
                type="button"
                className="secondary compact"
                disabled={page === 0}
                onClick={() => setPage((p) => p - 1)}
              >
                Previous options
              </button>
              <button
                type="button"
                className="secondary compact"
                disabled={(page + 1) * 20 >= (query.data?.count ?? 0)}
                onClick={() => setPage((p) => p + 1)}
              >
                More options
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
