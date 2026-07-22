# Env

Zod-validated environment variables via `@t3-oss/env-core`. Two entrypoints: `@konus-la/env/server` and `@konus-la/env/web`. Never read `process.env` or `import.meta.env` directly outside this package. One exception: the server's boot path (`apps/server/src/boot.ts` + `src/logger.ts`) reads and derives `process.env` **before** this package validates it — that ordering is the point of the phase-8 boot sequence.
