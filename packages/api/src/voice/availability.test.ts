import { seedTestUser } from "@konus-la/db/testing";
import { call, ORPCError } from "@orpc/server";
import { afterEach, beforeAll, describe, expect, test } from "vitest";

import { asNobody, asWsUser, expectCode } from "../testing";
import { setVoiceDown, voiceProcedure } from "./availability";

// A voice procedure the way later slices will build them: chained off `voiceProcedure`
// so the availability gate runs before the handler.
const probe = voiceProcedure.handler(() => "ok");

const USER = "u-voice";

beforeAll(async () => {
  await seedTestUser({ id: USER, username: "voicer" });
});

afterEach(() => {
  setVoiceDown(false);
});

describe("voice availability gate", () => {
  test("passes through while voice is up", async () => {
    expect(await call(probe, undefined, asWsUser(USER, "conn-avail"))).toBe("ok");
  });

  test("throws defined VOICE_UNAVAILABLE while voice is declared down", async () => {
    setVoiceDown(true);
    const error = await call(probe, undefined, asWsUser(USER, "conn-avail")).then(
      () => null,
      (thrown: unknown) => thrown,
    );
    expect(error).toBeInstanceOf(ORPCError);
    const orpcError = error as ORPCError<string, unknown>;
    expect(orpcError.code).toBe("VOICE_UNAVAILABLE");
    // `defined: true` is what lets clients discriminate this error — it only survives
    // with a single @orpc/server copy (see the oRPC-version caveat in the phase-5 spec).
    expect(orpcError.defined).toBe(true);
    expect(orpcError.status).toBe(503);
  });

  test("recovers: gate reopens once voice comes back up", async () => {
    setVoiceDown(true);
    setVoiceDown(false);
    expect(await call(probe, undefined, asWsUser(USER, "conn-avail"))).toBe("ok");
  });

  test("auth still gates first — unauthenticated callers get UNAUTHORIZED, not voice state", async () => {
    setVoiceDown(true);
    await expectCode(call(probe, undefined, asNobody()), "UNAUTHORIZED");
  });
});
