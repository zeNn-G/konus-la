import { consumeCode } from "@konus-la/db";
import { seedTestUser } from "@konus-la/db/testing";
import { call } from "@orpc/server";
import { beforeAll, describe, expect, test } from "vitest";

import { asNobody, asUser, expectCode } from "../testing";
import { appRouter } from "./index";

const ROOT = "u-root"; // Instance Owner (global `admin` role)
const PLEB = "u-pleb";

beforeAll(async () => {
  await seedTestUser({ id: ROOT, username: "root_user", role: "admin" });
  await seedTestUser({ id: PLEB, username: "pleb" });
});

describe("signupCode admin gate", () => {
  test("non-admins → FORBIDDEN, unauthenticated → UNAUTHORIZED", async () => {
    await expectCode(call(appRouter.signupCode.create, {}, asUser(PLEB)), "FORBIDDEN");
    await expectCode(call(appRouter.signupCode.list, undefined, asUser(PLEB)), "FORBIDDEN");
    await expectCode(call(appRouter.signupCode.revoke, { id: "x" }, asUser(PLEB)), "FORBIDDEN");
    await expectCode(call(appRouter.signupCode.create, {}, asNobody()), "UNAUTHORIZED");
  });
});

describe("signupCode.create / list / revoke", () => {
  test("mints codes (with optional expiry) that list newest-first as unused", async () => {
    const open = await call(appRouter.signupCode.create, {}, asUser(ROOT));
    expect(open.code).toMatch(/^[A-Z2-9]+$/);
    expect(open.expiresAt).toBeNull();

    const expiry = new Date(Date.now() + 60_000);
    const dated = await call(appRouter.signupCode.create, { expiresAt: expiry }, asUser(ROOT));
    expect(dated.expiresAt?.getTime()).toBe(expiry.getTime());

    const codes = await call(appRouter.signupCode.list, undefined, asUser(ROOT));
    const minted = codes.filter((row) => [open.id, dated.id].includes(row.id));
    expect(minted).toHaveLength(2);
    for (const row of minted) {
      expect(row.usedAt).toBeNull();
      expect(row.usedByUsername).toBeNull();
    }
  });

  test("a claimed code lists its claimer and can no longer be revoked", async () => {
    const claimed = await call(appRouter.signupCode.create, {}, asUser(ROOT));
    // Claim it the way the signup hook does.
    expect(await consumeCode(claimed.code, PLEB)).toBe(true);
    // Second claim loses the race guard.
    expect(await consumeCode(claimed.code, ROOT)).toBe(false);

    const codes = await call(appRouter.signupCode.list, undefined, asUser(ROOT));
    const row = codes.find((code) => code.id === claimed.id);
    expect(row?.usedAt).not.toBeNull();
    expect(row?.usedByUsername).toBe("pleb");

    // Used codes are a claim record — revoke refuses.
    await expectCode(
      call(appRouter.signupCode.revoke, { id: claimed.id }, asUser(ROOT)),
      "NOT_FOUND",
    );
  });

  test("revoking an unused code deletes it; unknown ids → NOT_FOUND", async () => {
    const doomed = await call(appRouter.signupCode.create, {}, asUser(ROOT));
    await expect(
      call(appRouter.signupCode.revoke, { id: doomed.id }, asUser(ROOT)),
    ).resolves.toEqual({ ok: true });

    const codes = await call(appRouter.signupCode.list, undefined, asUser(ROOT));
    expect(codes.map((code) => code.id)).not.toContain(doomed.id);

    await expectCode(
      call(appRouter.signupCode.revoke, { id: "never-existed" }, asUser(ROOT)),
      "NOT_FOUND",
    );
  });
});
