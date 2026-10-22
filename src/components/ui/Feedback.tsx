export function Loading() {
  return (
    <div className="state" role="status">
      <div className="spinner" />
      Loading your school…
    </div>
  );
}
export function ErrorMessage({ message }: { message: string }) {
  return message ? (
    <div className="alert error" role="alert">
      {message}
    </div>
  ) : null;
}
