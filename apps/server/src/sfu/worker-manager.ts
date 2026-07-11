/**
 * SFU worker lifecycle (phase-5 spec §Worker lifecycle, #15): one mediasoup worker for
 * the process lifetime. Standing invariant: from `start()` onward there is always a live
 * worker, a (re)spawn in flight, or voice declared down with a slow retry scheduled.
 *
 * Crash-loop breaker: 3 deaths (or failed boots) within 60 s stop the eager-respawn loop
 * and declare voice down; while down, a retry runs every 30 s until a worker boots and
 * sticks. Deaths only expire by time, so a recovery that crashes right back re-opens the
 * breaker — that's what "sticks" means.
 */

const MAX_DEATHS_IN_WINDOW = 3;
const DEATH_WINDOW_MS = 60_000;
const DOWN_RETRY_DELAY_MS = 30_000;

/** The slice of a mediasoup Worker the manager needs (kept minimal for tests). */
export interface WorkerLike {
  pid: number;
  on(event: "died", listener: (error: Error) => void): unknown;
}

export interface WorkerManagerOptions<W extends WorkerLike> {
  /** Boots one worker. Must re-apply the Bun spawn patch per call (see createWorkerPatched). */
  spawn: () => Promise<W>;
  /** Transition hook: `true` when voice is declared down, `false` when a boot recovers it. */
  onAvailabilityChange: (down: boolean) => void;
  logger: {
    info: (obj: object, msg: string) => void;
    warn: (obj: object, msg: string) => void;
    error: (obj: object, msg: string) => void;
  };
}

export interface WorkerManager<W extends WorkerLike> {
  start: () => Promise<void>;
  getWorker: () => W | null;
  isDown: () => boolean;
  /**
   * Forgive the deaths recorded so far. For the `bun --hot` reload path only: a reload
   * closes the old evaluation's IPC sockets, so the worker self-exits and respawns —
   * an expected death that must not walk the breaker toward "voice down" in dev.
   */
  resetDeathWindow: () => void;
}

export function createWorkerManager<W extends WorkerLike>(
  options: WorkerManagerOptions<W>,
): WorkerManager<W> {
  const { spawn, onAvailabilityChange, logger } = options;

  let worker: W | null = null;
  let down = false;
  let spawnInFlight = false;
  const deathTimes: number[] = [];

  function recordLoss(reason: "died" | "boot failed", error: unknown): void {
    const now = Date.now();
    deathTimes.push(now);
    while (deathTimes.length > 0 && now - deathTimes[0]! > DEATH_WINDOW_MS) {
      deathTimes.shift();
    }
    // `err` (not `error`) so pino's standard serializer renders the stack.
    logger.warn({ err: error, reason }, "mediasoup worker lost");

    // While down, stay on the slow cadence even if old deaths have aged out of the
    // window — only a boot that sticks (attemptBoot's success path) closes the breaker.
    if (down || deathTimes.length >= MAX_DEATHS_IN_WINDOW) {
      declareDown();
    } else {
      void attemptBoot();
    }
  }

  function declareDown(): void {
    if (!down) {
      down = true;
      logger.error(
        { deathsInWindow: deathTimes.length },
        "voice declared down: mediasoup worker crash loop",
      );
      onAvailabilityChange(true);
    }
    setTimeout(() => {
      void attemptBoot();
    }, DOWN_RETRY_DELAY_MS);
  }

  async function attemptBoot(): Promise<void> {
    if (spawnInFlight || worker !== null) return;
    spawnInFlight = true;

    let spawned: W;
    try {
      spawned = await spawn();
    } catch (error) {
      spawnInFlight = false;
      recordLoss("boot failed", error);
      return;
    }
    spawnInFlight = false;

    worker = spawned;
    spawned.on("died", (error) => {
      if (worker !== spawned) return; // stale handle after a newer boot
      worker = null;
      recordLoss("died", error);
    });

    logger.info({ pid: spawned.pid }, "mediasoup worker running");
    if (down) {
      down = false;
      onAvailabilityChange(false);
    }
  }

  return {
    start: () => attemptBoot(),
    getWorker: () => worker,
    isDown: () => down,
    resetDeathWindow: () => {
      deathTimes.length = 0;
    },
  };
}
