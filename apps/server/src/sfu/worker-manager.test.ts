import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { createWorkerManager } from "./worker-manager";

class FakeWorker {
  private diedListeners: Array<(error: Error) => void> = [];

  constructor(readonly pid: number) {}

  on(_event: "died", listener: (error: Error) => void): void {
    this.diedListeners.push(listener);
  }

  die(error = new Error("worker crashed")): void {
    for (const listener of this.diedListeners) listener(error);
  }
}

function makeHarness() {
  const workers: FakeWorker[] = [];
  let pendingFailures = 0;

  const spawn = vi.fn(async (): Promise<FakeWorker> => {
    if (pendingFailures > 0) {
      pendingFailures--;
      throw new Error("spawn failed");
    }
    const worker = new FakeWorker(workers.length + 1);
    workers.push(worker);
    return worker;
  });

  const onAvailabilityChange = vi.fn();
  const onWorkerLost = vi.fn();
  const onWorkerBooted = vi.fn();
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

  const manager = createWorkerManager({
    spawn,
    onAvailabilityChange,
    onWorkerLost,
    onWorkerBooted,
    logger,
  });

  return {
    manager,
    spawn,
    workers,
    onAvailabilityChange,
    onWorkerLost,
    onWorkerBooted,
    logger,
    failNextSpawns(count: number) {
      pendingFailures = count;
    },
  };
}

/** Flush the microtask queue so died → respawn promise chains settle. */
async function flush() {
  await vi.advanceTimersByTimeAsync(0);
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("boot and eager respawn", () => {
  test("start() boots a worker", async () => {
    const h = makeHarness();
    await h.manager.start();

    expect(h.spawn).toHaveBeenCalledTimes(1);
    expect(h.manager.getWorker()).toBe(h.workers[0]);
    expect(h.manager.isDown()).toBe(false);
    expect(h.onAvailabilityChange).not.toHaveBeenCalled();
  });

  test("a died worker is respawned eagerly", async () => {
    const h = makeHarness();
    await h.manager.start();

    h.workers[0]!.die();
    await flush();

    expect(h.spawn).toHaveBeenCalledTimes(2);
    expect(h.manager.getWorker()).toBe(h.workers[1]);
    expect(h.manager.isDown()).toBe(false);
    expect(h.onAvailabilityChange).not.toHaveBeenCalled();
  });

  test("deaths spread wider than the window never open the breaker", async () => {
    const h = makeHarness();
    await h.manager.start();

    for (let i = 0; i < 4; i++) {
      h.manager.getWorker()!.die();
      await flush();
      await vi.advanceTimersByTimeAsync(35_000);
    }

    expect(h.spawn).toHaveBeenCalledTimes(5);
    expect(h.manager.isDown()).toBe(false);
    expect(h.onAvailabilityChange).not.toHaveBeenCalled();
  });
});

describe("crash-loop breaker", () => {
  async function openBreaker(h: ReturnType<typeof makeHarness>) {
    await h.manager.start();
    for (let i = 0; i < 3; i++) {
      h.manager.getWorker()!.die();
      await flush();
      await vi.advanceTimersByTimeAsync(1_000);
    }
  }

  test("3 deaths within 60 s declare voice down instead of a 4th tight respawn", async () => {
    const h = makeHarness();
    await openBreaker(h);

    // initial boot + 2 eager respawns; the 3rd death opens the breaker
    expect(h.spawn).toHaveBeenCalledTimes(3);
    expect(h.manager.getWorker()).toBeNull();
    expect(h.manager.isDown()).toBe(true);
    expect(h.onAvailabilityChange).toHaveBeenCalledTimes(1);
    expect(h.onAvailabilityChange).toHaveBeenLastCalledWith(true);
    expect(h.logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ deathsInWindow: 3 }),
      expect.stringContaining("voice declared down"),
    );
  });

  test("while down it retries slowly every 30 s, staying down across failed retries", async () => {
    const h = makeHarness();
    await openBreaker(h);
    h.failNextSpawns(2);

    // The 30 s retry counts from the 3rd death, which openBreaker leaves 1 s in the past.
    await vi.advanceTimersByTimeAsync(28_000);
    expect(h.spawn).toHaveBeenCalledTimes(3); // not yet

    await vi.advanceTimersByTimeAsync(1_000);
    expect(h.spawn).toHaveBeenCalledTimes(4); // failed retry
    expect(h.manager.isDown()).toBe(true);

    await vi.advanceTimersByTimeAsync(30_000);
    expect(h.spawn).toHaveBeenCalledTimes(5); // still failing
    expect(h.manager.isDown()).toBe(true);
    expect(h.onAvailabilityChange).not.toHaveBeenCalledWith(false);
  });

  test("a retry that boots brings voice back up", async () => {
    const h = makeHarness();
    await openBreaker(h);

    await vi.advanceTimersByTimeAsync(30_000);

    expect(h.manager.isDown()).toBe(false);
    expect(h.manager.getWorker()).toBe(h.workers[3]);
    expect(h.onAvailabilityChange).toHaveBeenLastCalledWith(false);
  });

  test("a recovered worker that dies again with recent deaths still in the window re-opens the breaker", async () => {
    const h = makeHarness();
    await openBreaker(h); // deaths at ~1s, ~2s, ~3s
    await vi.advanceTimersByTimeAsync(30_000); // recovery at ~33s

    h.manager.getWorker()!.die(); // still 4 deaths inside the 60 s window
    await flush();

    expect(h.manager.isDown()).toBe(true);
    expect(h.manager.getWorker()).toBeNull();
    expect(h.spawn).toHaveBeenCalledTimes(4); // no eager respawn this time
    expect(h.onAvailabilityChange).toHaveBeenLastCalledWith(true);
  });

  test("while down, a failed retry stays on the slow cadence even when the death window has drained", async () => {
    const h = makeHarness();
    await openBreaker(h);
    h.failNextSpawns(99);

    // Death history can drain while down (retry timers firing late in real time, or a
    // hot reload calling resetDeathWindow). A failed retry must not fall back into the
    // eager tight loop just because the strike count restarted.
    h.manager.resetDeathWindow();

    await vi.advanceTimersByTimeAsync(30_000);
    expect(h.spawn).toHaveBeenCalledTimes(4); // exactly one slow retry, no burst
    expect(h.manager.isDown()).toBe(true);
  });

  test("resetDeathWindow forgives prior deaths (hot-reload path) — the next death respawns eagerly", async () => {
    const h = makeHarness();
    await h.manager.start();

    for (let i = 0; i < 2; i++) {
      h.manager.getWorker()!.die();
      await flush();
      await vi.advanceTimersByTimeAsync(1_000);
    }
    h.manager.resetDeathWindow();

    h.manager.getWorker()!.die(); // would have been the 3rd death in the window
    await flush();

    expect(h.manager.isDown()).toBe(false);
    expect(h.spawn).toHaveBeenCalledTimes(4); // eager respawn, breaker never opened
    expect(h.onAvailabilityChange).not.toHaveBeenCalled();
  });

  test("boot failures count toward the breaker like deaths", async () => {
    const h = makeHarness();
    h.failNextSpawns(3);
    await h.manager.start();
    await flush();

    expect(h.spawn).toHaveBeenCalledTimes(3); // boot + 2 immediate retries
    expect(h.manager.isDown()).toBe(true);

    await vi.advanceTimersByTimeAsync(30_000);
    expect(h.spawn).toHaveBeenCalledTimes(4);
    expect(h.manager.isDown()).toBe(false);
    expect(h.manager.getWorker()).toBe(h.workers[0]);
  });
});

describe("voice seat hooks", () => {
  test("onWorkerLost fires on a death (seats → grace), not on a failed boot", async () => {
    const h = makeHarness();
    h.failNextSpawns(1);
    await h.manager.start(); // boot fails — no worker existed, no seats to grace
    await flush();
    expect(h.onWorkerLost).not.toHaveBeenCalled();

    h.manager.getWorker()!.die();
    await flush();
    expect(h.onWorkerLost).toHaveBeenCalledTimes(1);
  });

  test("onWorkerBooted fires after every successful boot, including breaker recovery", async () => {
    const h = makeHarness();
    await h.manager.start();
    expect(h.onWorkerBooted).toHaveBeenCalledTimes(1);

    h.manager.getWorker()!.die();
    await flush();
    expect(h.onWorkerBooted).toHaveBeenCalledTimes(2); // eager respawn completed

    // Open the breaker: two more quick deaths.
    for (let i = 0; i < 2; i++) {
      h.manager.getWorker()!.die();
      await flush();
      await vi.advanceTimersByTimeAsync(1_000);
    }
    expect(h.manager.isDown()).toBe(true);
    expect(h.onWorkerBooted).toHaveBeenCalledTimes(3); // failed period adds nothing yet

    await vi.advanceTimersByTimeAsync(30_000); // slow retry succeeds
    expect(h.manager.isDown()).toBe(false);
    expect(h.onWorkerBooted).toHaveBeenCalledTimes(4);
  });
});
