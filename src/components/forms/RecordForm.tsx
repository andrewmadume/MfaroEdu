import { useState, type FormEvent } from 'react';
import { ZodError } from 'zod';
import { entities } from '../../lib/directory';
import { saveRecord } from '../../services/directory';
import { useSchool } from '../../contexts/SchoolContext';
import type { EntityKey, SchoolRecord } from '../../types/directory';
import RecordLookup from './RecordLookup';
import { ErrorMessage } from '../ui/Feedback';
export default function RecordForm({
  entity,
  record,
  pinned = {},
  onSaved,
  onCancel,
}: {
  entity: EntityKey;
  record?: SchoolRecord;
  pinned?: Record<string, string>;
  onSaved: (record: SchoolRecord) => void;
  onCancel: () => void;
}) {
  const { school } = useSchool();
  const def = entities[entity];
  const [values, setValues] = useState<Record<string, unknown>>(() =>
    Object.fromEntries(
      def.fields.map((f) => [
        f.key,
        pinned[f.key] ??
          record?.[f.key] ??
          (f.kind === 'checkbox'
            ? f.key === 'compulsory'
            : f.kind === 'select'
              ? f.options![0]
              : f.key === 'weight'
                ? 1
                : f.key === 'sort_order'
                  ? 0
                  : ''),
      ]),
    ),
  );
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  function change(key: string, value: unknown) {
    setValues((v) => ({ ...v, [key]: value }));
  }
  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const parsed = Object.fromEntries(
        def.fields.map((f) => [
          f.key,
          values[f.key] === '' ? null : f.kind === 'number' ? Number(values[f.key]) : values[f.key],
        ]),
      );
      const saved = await saveRecord(school.id, entity, parsed, record);
      onSaved(saved);
    } catch (e) {
      setError(
        e instanceof ZodError
          ? e.issues
              .map(
                (i) =>
                  `${def.fields.find((f) => f.key === i.path[0])?.label ?? String(i.path[0])}: ${i.message}`,
              )
              .join(' ')
          : e instanceof Error
            ? e.message
            : 'Could not save this record.',
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="stack" onSubmit={submit}>
      <div className="form-grid">
        {def.fields
          .filter((f) => !pinned[f.key])
          .map((field) => {
            const disabled = !!record && !!field.immutable;
            if (field.kind === 'reference')
              return (
                <div key={field.key}>
                  <RecordLookup
                    entity={field.reference!}
                    label={field.label}
                    value={String(values[field.key] ?? '')}
                    onChange={(v) => change(field.key, v)}
                    disabled={disabled || busy}
                    filters={field.filter}
                  />
                  {disabled && <small>Kept fixed to preserve history.</small>}
                </div>
              );
            return (
              <label
                key={field.key}
                className={field.kind === 'checkbox' ? 'checkbox-field' : undefined}
              >
                {field.label}
                {field.kind === 'checkbox' ? (
                  <input
                    type="checkbox"
                    checked={Boolean(values[field.key])}
                    onChange={(e) => change(field.key, e.target.checked)}
                    disabled={busy}
                  />
                ) : field.kind === 'select' ? (
                  <select
                    value={String(values[field.key] ?? '')}
                    onChange={(e) => change(field.key, e.target.value)}
                    disabled={busy}
                  >
                    {field.options?.map((option) => (
                      <option key={option} value={option}>
                        {option.replaceAll('_', ' ')}
                      </option>
                    ))}
                  </select>
                ) : field.kind === 'textarea' ? (
                  <textarea
                    value={String(values[field.key] ?? '')}
                    onChange={(e) => change(field.key, e.target.value)}
                    maxLength={field.max}
                    disabled={busy}
                  />
                ) : (
                  <input
                    type={field.kind ?? 'text'}
                    required={field.required}
                    value={String(values[field.key] ?? '')}
                    onChange={(e) => change(field.key, e.target.value)}
                    maxLength={field.kind === 'number' ? undefined : field.max}
                    min={field.kind === 'number' ? field.min : undefined}
                    max={field.kind === 'number' ? field.max : undefined}
                    step={field.key === 'weight' ? '0.01' : undefined}
                    disabled={busy}
                  />
                )}{' '}
                {field.hint && <small>{field.hint}</small>}
              </label>
            );
          })}
      </div>
      <ErrorMessage message={error} />
      <div className="form-actions">
        <button disabled={busy}>
          {busy ? 'Saving…' : record ? 'Save changes' : `Create ${def.singular}`}
        </button>
        <button type="button" className="secondary" disabled={busy} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
