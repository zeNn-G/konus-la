import * as mediasoup from "mediasoup";
import type { types } from "mediasoup";

import { patchSpawnForMediasoup, restoreSpawn } from "./bun-mediasoup-workaround";

/**
 * Without the Bun/Windows patch a broken spawn makes `createWorker` hang forever rather
 * than reject — cap it so the worker manager sees a failed boot instead of a stall.
 */
const CREATE_WORKER_TIMEOUT_MS = 10_000;

/**
 * The ONLY way this codebase may create a mediasoup worker. `restoreSpawn()` unpatches
 * `child_process.spawn`, so every spawn — first boot and every crash respawn — must
 * re-apply the patch (no-op on Linux/Docker prod).
 */
export function createWorkerPatched(settings: types.WorkerSettings): Promise<types.Worker> {
  patchSpawnForMediasoup();
  return withBootTimeout(mediasoup.createWorker(settings)).finally(() => restoreSpawn());
}

function withBootTimeout(creating: Promise<types.Worker>): Promise<types.Worker> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`mediasoup createWorker timed out after ${CREATE_WORKER_TIMEOUT_MS}ms`));
      // A late-arriving worker would leak outside the manager's invariant — close it.
      creating.then(
        (worker) => worker.close(),
        () => {},
      );
    }, CREATE_WORKER_TIMEOUT_MS);

    creating.then(
      (worker) => {
        clearTimeout(timer);
        resolve(worker);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}
