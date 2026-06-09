/** Renders TanStack Form field validation errors (standard-schema issues or strings). */
export function FieldError({ errors }: { errors: unknown[] }) {
  if (errors.length === 0) return null;
  const message = errors
    .map((error) => (typeof error === "string" ? error : (error as { message?: string })?.message))
    .filter(Boolean)
    .join(", ");
  if (!message) return null;
  return <p className="text-xs text-destructive">{message}</p>;
}
