import type { ReactNode, FormEvent } from 'react';
export function ModuleError({ error }: { error: Error | null }) {
  return error ? (
    <p className="alert error" role="alert">
      {error.message}
    </p>
  ) : null;
}
export function QueryState({
  pending,
  error,
  children,
}: {
  pending: boolean;
  error: Error | null;
  children: ReactNode;
}) {
  return pending ? (
    <p role="status">Loading records…</p>
  ) : error ? (
    <ModuleError error={error} />
  ) : (
    <>{children}</>
  );
}
export function ModulePager({
  page,
  count,
  onChange,
}: {
  page: number;
  count: number;
  onChange: (n: number) => void;
}) {
  return (
    <div className="module-pager">
      <button className="secondary" disabled={page === 0} onClick={() => onChange(page - 1)}>
        Previous
      </button>
      <span>
        Page {page + 1} of {Math.max(1, Math.ceil(count / 20))} · {count} records
      </span>
      <button
        className="secondary"
        disabled={(page + 1) * 20 >= count}
        onClick={() => onChange(page + 1)}
      >
        Next
      </button>
    </div>
  );
}
export function formValues(event: FormEvent<HTMLFormElement>) {
  event.preventDefault();
  return Object.fromEntries(new FormData(event.currentTarget));
}
