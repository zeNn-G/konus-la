import { ORPCError } from "@orpc/server";
import { expect } from "vitest";

import type { Context } from "./context";

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
