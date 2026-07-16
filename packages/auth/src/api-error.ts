// Re-exported so consumers can narrow Better Auth failures (`error instanceof APIError`)
// without a direct better-auth dependency — this package owns the Better Auth surface.
// Its own subpath (not index) keeps it importable where the configured `auth` instance
// is mocked or its env isn't available (packages/api's vitest setup).
export { APIError } from "better-auth/api";
