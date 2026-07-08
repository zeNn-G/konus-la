import { seedTestUser } from "@konus-la/db/testing";
import { call } from "@orpc/server";
import { beforeAll, describe, expect, test } from "vitest";

import { asNobody, asUser, expectCode } from "../testing";
import { appRouter } from "./index";

const USER = "u-self";

beforeAll(async () => {
  await seedTestUser({ id: USER, username: "selfish", name: "Old Name" });
});

describe("profile.update", () => {
  test("updates the caller's displayName (trimmed)", async () => {
    const result = await call(appRouter.profile.update, { displayName: "New Name" }, asUser(USER));
    expect(result).toEqual({ displayName: "New Name" });

    const { getTestUser } = await import("@konus-la/db/testing");
    const row = await getTestUser(USER);
    expect(row?.name).toBe("New Name");
    // Username is immutable — untouched by profile edits.
    expect(row?.username).toBe("selfish");
  });

  test("blank names → BAD_REQUEST, unauthenticated → UNAUTHORIZED", async () => {
    await expectCode(
      call(appRouter.profile.update, { displayName: "   " }, asUser(USER)),
      "BAD_REQUEST",
    );
    await expectCode(
      call(appRouter.profile.update, { displayName: "x".repeat(61) }, asUser(USER)),
      "BAD_REQUEST",
    );
    await expectCode(call(appRouter.profile.update, { displayName: "Anon" }, asNobody()), "UNAUTHORIZED");
  });
});
