/**
 * Bun/Windows mediasoup IPC workaround — vendored port of Sharkord's
 * `bun-mediasoup-workaround.ts` (Sharkord/sharkord PR #288), logging swapped for ours.
 * Validated on mediasoup 3.21.0 / Bun 1.3.14 by spike #8; remove once
 * https://github.com/oven-sh/bun/issues/11044 is fixed (pin Bun upgrades behind a spike
 * re-run until then).
 *
 * On Windows, Bun's `child_process.spawn()` creates broken stdio pipe handles for fd
 * indices >= 3 (oven-sh/bun#11044). mediasoup relies on fd 3 (producer channel, write TO
 * worker) and fd 4 (consumer channel, read FROM worker) for its FlatBuffers IPC — so
 * worker creation hangs forever.
 *
 * Fix: monkey-patch `child_process.spawn` just for the mediasoup-worker spawn. Replace it
 * with `Bun.spawn()` (returns raw fd numbers for extra stdio) and wrap the subprocess in
 * a ChildProcess-compatible EventEmitter whose stdio[3] and stdio[4] are socket-like
 * objects backed by `Bun.connect({fd})`.
 */

import { EventEmitter } from "node:events";
import { Readable } from "node:stream";

import { logger } from "../logger";

const isBun = typeof globalThis.Bun !== "undefined";
const isWindows = process.platform === "win32";

let originalSpawn: Function | null = null;
let patched = false;

/**
 * Creates a socket-like EventEmitter backed by `Bun.connect({fd})`. Read side emits
 * 'data' Buffers; write side provides .write(). Both emit 'end'/'error' and support
 * .destroy() — the surface mediasoup's Channel needs.
 */
function createBunPipeSocket(
  fd: number,
  mode: "read" | "write",
): EventEmitter & {
  write: (chunk: Buffer | Uint8Array, encoding?: string) => boolean;
  destroy: () => void;
  readable: boolean;
  writable: boolean;
  readableFlowing: boolean | null;
} {
  const emitter = new EventEmitter() as EventEmitter & {
    write: (chunk: Buffer | Uint8Array, encoding?: string) => boolean;
    destroy: () => void;
    readable: boolean;
    writable: boolean;
    readableFlowing: boolean | null;
  };

  let bunSocket: any = null;
  let destroyed = false;

  emitter.readable = mode === "read";
  emitter.writable = mode === "write";
  emitter.readableFlowing = null;

  emitter.write = (
    chunk: Buffer | Uint8Array,
    _encoding?: string,
    callback?: (error?: Error | null) => void,
  ): boolean => {
    if (destroyed) {
      callback?.(new Error("Socket is destroyed"));
      return false;
    }
    if (!bunSocket) {
      // In practice never hit — Bun.connect resolves before the first IPC write (which
      // waits for the async WORKER_RUNNING event).
      logger.warn({ fd, mode }, "bun-mediasoup-workaround: write() before Bun socket ready");
      callback?.(new Error("Socket not ready"));
      return false;
    }
    try {
      const n = bunSocket.write(chunk);
      bunSocket.flush();
      callback?.(null);
      return n > 0;
    } catch (err: unknown) {
      callback?.(err as Error);
      return false;
    }
  };

  emitter.destroy = () => {
    if (destroyed) return;
    destroyed = true;
    if (bunSocket) {
      try {
        bunSocket.end();
      } catch {
        /* ignore */
      }
    }
  };

  // NOTE: `fd` is an undocumented Bun.connect option suggested by Bun's creator as the
  // oven-sh/bun#11044 workaround.
  (Bun.connect as any)({
    fd,
    socket: {
      open(socket: any) {
        bunSocket = socket;
      },
      data(_socket: any, data: Uint8Array) {
        if (mode === "read" && !destroyed) {
          emitter.emit("data", Buffer.from(data));
        }
      },
      close() {
        if (!destroyed) {
          emitter.emit("end");
        }
      },
      error(_socket: any, err: Error) {
        if (!destroyed) {
          emitter.emit("error", err);
        }
      },
      drain() {},
    },
  }).catch((err: Error) => {
    if (!destroyed) {
      emitter.emit("error", err);
    }
  });

  return emitter;
}

/** Pumps a Bun ReadableStream into a Node.js Readable. */
function pumpBunStreamToReadable(
  bunStream: ReadableStream<Uint8Array> | null,
  readable: Readable,
) {
  if (!bunStream) return;
  const reader = bunStream.getReader();
  (async () => {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          readable.push(null);
          break;
        }
        readable.push(Buffer.from(value));
      }
    } catch {
      readable.push(null);
    }
  })();
}

/**
 * Wraps a Bun Subprocess into a ChildProcess-compatible EventEmitter that mediasoup's
 * WorkerImpl can use transparently.
 */
function wrapBunSubprocess(bunChild: any): EventEmitter {
  const wrapper = new EventEmitter() as EventEmitter & {
    pid: number;
    stdout: Readable;
    stderr: Readable;
    stdio: any[];
    kill: (signal?: string) => void;
  };

  wrapper.pid = bunChild.pid;

  const stdoutReadable = new Readable({ read() {} });
  const stderrReadable = new Readable({ read() {} });
  pumpBunStreamToReadable(bunChild.stdout, stdoutReadable);
  pumpBunStreamToReadable(bunChild.stderr, stderrReadable);
  wrapper.stdout = stdoutReadable;
  wrapper.stderr = stderrReadable;

  // Extra stdio pipes — Bun gives us raw fd numbers
  const producerFd = bunChild.stdio[3];
  const consumerFd = bunChild.stdio[4];

  if (typeof producerFd !== "number" || typeof consumerFd !== "number") {
    throw new Error(
      `bun-mediasoup-workaround: expected fd numbers for stdio[3] and stdio[4], ` +
        `got: ${typeof producerFd}, ${typeof consumerFd}`,
    );
  }

  const producerSocket = createBunPipeSocket(producerFd, "write");
  const consumerSocket = createBunPipeSocket(consumerFd, "read");

  wrapper.stdio = [
    null, // stdin (ignored)
    stdoutReadable,
    stderrReadable,
    producerSocket, // fd 3 — write TO worker
    consumerSocket, // fd 4 — read FROM worker
  ];

  wrapper.kill = (signal?: string) => {
    try {
      bunChild.kill(signal);
    } catch {
      try {
        bunChild.kill();
      } catch {
        /* ignore */
      }
    }
  };

  bunChild.exited
    .then((exitCode: number) => {
      wrapper.emit("exit", exitCode, null);
      setTimeout(() => wrapper.emit("close", exitCode, null), 0);
    })
    .catch((err: Error) => {
      wrapper.emit("error", err);
    });

  return wrapper;
}

/**
 * Monkey-patches `child_process.spawn` so that when mediasoup spawns its worker binary,
 * we use `Bun.spawn()` instead. Call BEFORE `mediasoup.createWorker()`. No-op off
 * Bun/Windows.
 */
export function patchSpawnForMediasoup(): void {
  if (!isBun || !isWindows || patched) return;

  const cp = require("node:child_process");
  originalSpawn = cp.spawn;

  cp.spawn = function patchedSpawn(
    command: string,
    args?: string[],
    options?: any,
  ) {
    // Only intercept mediasoup-worker spawns (5-element stdio array)
    const isMediasoupWorker =
      typeof command === "string" &&
      command.includes("mediasoup-worker") &&
      Array.isArray(options?.stdio) &&
      options.stdio.length >= 5;

    if (!isMediasoupWorker) {
      return originalSpawn!.call(cp, command, args, options);
    }

    logger.debug({ command }, "bun-mediasoup-workaround: spawning worker via Bun.spawn()");

    const bunSpawnOptions: any = {
      stdio: ["ignore", "pipe", "pipe", "pipe", "pipe"],
      env: options?.env || process.env,
    };
    if (options?.cwd) {
      bunSpawnOptions.cwd = options.cwd;
    }
    if (typeof options?.detached === "boolean") {
      bunSpawnOptions.detached = options.detached;
    }
    const bunChild = Bun.spawn([command, ...(args || [])], bunSpawnOptions);

    return wrapBunSubprocess(bunChild);
  };

  patched = true;
}

/** Restores the original `child_process.spawn`. Call AFTER createWorker resolves. */
export function restoreSpawn(): void {
  if (!patched || !originalSpawn) return;

  const cp = require("node:child_process");
  cp.spawn = originalSpawn;
  originalSpawn = null;
  patched = false;
}
