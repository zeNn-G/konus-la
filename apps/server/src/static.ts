import { existsSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".png": "image/png",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".txt": "text/plain; charset=utf-8",
  ".map": "application/json",
  ".webmanifest": "application/manifest+json",
};

/**
 * Same-origin SPA serving (phase-8 spec §SPA same-origin serving): static files from the
 * baked-in `apps/web/dist`, `index.html` fallback for any other GET so TanStack Router
 * deep links survive refresh. When `dist/` is absent every request falls through (null) —
 * dev keeps Vite on :3001, nothing changes locally.
 *
 * Cache headers follow the Vite contract: `/assets/*` is content-hashed, so immutable;
 * `index.html` and non-hashed root files must revalidate every load.
 */
export function createStaticHandler(
  distDir: string,
): (req: Request, url: URL) => Promise<Response | null> {
  const distRoot = path.resolve(distDir);
  const indexPath = path.join(distRoot, "index.html");
  const hasDist = existsSync(indexPath);

  const serveIndex = async () =>
    new Response(await readFile(indexPath), {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-cache",
      },
    });

  return async (req, url) => {
    if (!hasDist) return null;
    if (req.method !== "GET") return null;

    const filePath = path.resolve(distRoot, `.${decodeURIComponent(url.pathname)}`);
    if (filePath !== distRoot && !filePath.startsWith(distRoot + path.sep)) {
      return serveIndex();
    }

    const stat = statSync(filePath, { throwIfNoEntry: false });
    if (!stat?.isFile()) return serveIndex();

    const immutable = url.pathname.startsWith("/assets/");
    return new Response(await readFile(filePath), {
      headers: {
        "Content-Type": MIME_TYPES[path.extname(filePath)] ?? "application/octet-stream",
        "Cache-Control": immutable ? "public, max-age=31536000, immutable" : "no-cache",
      },
    });
  };
}
