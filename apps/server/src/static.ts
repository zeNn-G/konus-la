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

const IMMUTABLE = "public, max-age=31536000, immutable";

/**
 * Same-origin SPA serving (phase-8 spec §SPA same-origin serving): static files from the
 * baked-in `apps/web/dist`, `index.html` fallback for any other GET so TanStack Router
 * deep links survive refresh. When `dist/` is absent every request falls through (null) —
 * dev keeps Vite on :3001, nothing changes locally.
 *
 * Cache headers follow the Vite contract: files under `dist/assets/` are content-hashed,
 * so immutable; `index.html` and non-hashed root files must revalidate every load.
 */
export function createStaticHandler(
  distDir: string,
): (req: Request, url: URL) => Promise<Response | null> {
  const distRoot = path.resolve(distDir);
  const indexPath = path.join(distRoot, "index.html");
  const assetsRoot = path.join(distRoot, "assets");
  const hasDist = existsSync(indexPath);

  const serveFile = async (filePath: string) =>
    new Response(await readFile(filePath), {
      headers: {
        "Content-Type": MIME_TYPES[path.extname(filePath)] ?? "application/octet-stream",
        "Cache-Control": filePath.startsWith(assetsRoot + path.sep) ? IMMUTABLE : "no-cache",
      },
    });

  return async (req, url) => {
    if (!hasDist) return null;
    if (req.method !== "GET") return null;

    let pathname: string;
    try {
      pathname = decodeURIComponent(url.pathname);
    } catch {
      // Malformed percent-encoding can't name a dist file — treat as a router path.
      return serveFile(indexPath);
    }

    const filePath = path.resolve(distRoot, `.${pathname}`);
    if (filePath !== distRoot && !filePath.startsWith(distRoot + path.sep)) {
      return serveFile(indexPath);
    }

    const stat = statSync(filePath, { throwIfNoEntry: false });
    if (!stat?.isFile()) return serveFile(indexPath);

    return serveFile(filePath);
  };
}
