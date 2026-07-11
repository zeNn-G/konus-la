import { ORPCError } from "@orpc/server";
import { expect } from "vitest";

import type { Context } from "./context";
import type { RealtimeEvent } from "./realtime/events";
import { publisher } from "./realtime/publisher";

/**
 * Test-only: call-options for oRPC's `call()` that authenticate as a seeded user via the
 * `x-test-user` header the vitest setup's Better Auth fake understands.
 *
 *   await call(channelRouter.create, input, asUser(owner.id))
 */
export function asUser(userId: string): { context: Context } {
  return { context: { headers: new Headers({ "x-test-user": userId }) } };
}

/** An unauthenticated caller — resolves to no session, i.e. UNAUTHORIZED. */
export function asNobody(): { context: Context } {
  return { context: { headers: new Headers() } };
}

/**
 * Like `asUser`, but with the connection-scoped context the `/ws` message handler injects —
 * what `voice.*` procedures require. Distinct `connectionId`s simulate distinct tabs.
 */
export function asWsUser(userId: string, connectionId: string): { context: Context } {
  return {
    context: { headers: new Headers({ "x-test-user": userId }), connectionId },
  };
}

/** Assert a procedure call rejects with the given ORPC error code. */
export async function expectCode(promise: Promise<unknown>, code: string): Promise<void> {
  const error = await promise.then(
    () => null,
    (thrown: unknown) => thrown,
  );
  expect(error).toBeInstanceOf(ORPCError);
  expect((error as ORPCError<string, unknown>).code).toBe(code);
}

// --- realtime event observation ------------------------------------------------------------

export type EventCollector = { events: RealtimeEvent[]; stop: () => void };

const activeCollectors: EventCollector[] = [];

/**
 * Subscribe to a user's realtime topic and accumulate everything it receives. Pair with
 * `stopCollectors()` in the test file's `afterEach`.
 */
export function collect(userId: string): EventCollector {
  const events: RealtimeEvent[] = [];
  const controller = new AbortController();
  const iterator = publisher.subscribe(`user:${userId}`, { signal: controller.signal });
  void (async () => {
    try {
      for await (const event of iterator) events.push(event);
    } catch {
      // subscription aborted by stop()
    }
  })();
  const collector = { events, stop: () => controller.abort() };
  activeCollectors.push(collector);
  return collector;
}

export function ofType<T extends RealtimeEvent["type"]>(
  collector: EventCollector,
  type: T,
): Extract<RealtimeEvent, { type: T }>[] {
  return collector.events.filter((event) => event.type === type) as Extract<
    RealtimeEvent,
    { type: T }
  >[];
}

/** Let queued publisher deliveries drain — for asserting an event did NOT arrive. */
export const settle = (): Promise<unknown> => new Promise((resolve) => setTimeout(resolve, 25));

export async function waitFor(
  predicate: () => boolean,
  what: string,
  timeoutMs = 2_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

/** Stop every collector started via `collect()` since the last call. */
export function stopCollectors(): void {
  for (const collector of activeCollectors) collector.stop();
  activeCollectors.length = 0;
}
