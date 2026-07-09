import { seedTestUser } from "@konus-la/db/testing";
import { call } from "@orpc/server";
import { beforeAll, describe, expect, test } from "vitest";

import { asNobody, asUser, expectCode } from "../testing";
import { appRouter } from "./index";

const SELF = "u-self";

beforeAll(async () => {
  await seedTestUser({ id: SELF, username: "selfish", name: "Selfish Person" });
  await seedTestUser({ id: "u-anna", username: "anna", name: "Anna Banana" });
  await seedTestUser({ id: "u-annabel", username: "annabel", name: "Bella" });
  await seedTestUser({ id: "u-underscore", username: "an_na", name: "Underscore" });
  await seedTestUser({ id: "u-banana", username: "banana", name: "Ann-adjacent" });
});

describe("user.search", () => {
  test("prefix-matches username and displayName, excluding the caller", async () => {
    const byUsername = await call(appRouter.user.search, { query: "anna" }, asUser(SELF));
    expect(byUsername.map((u) => u.username).sort()).toEqual(["anna", "annabel"]);

    const byDisplayName = await call(appRouter.user.search, { query: "Ann" }, asUser(SELF));
    expect(byDisplayName.map((u) => u.username).sort()).toEqual(["anna", "annabel", "banana"]);

    const self = await call(appRouter.user.search, { query: "self" }, asUser(SELF));
    expect(self).toEqual([]);
  });

  test("LIKE wildcards in the query are literal, not wildcards", async () => {
    // `_` must match only the literal underscore username, not "anna".
    const underscore = await call(appRouter.user.search, { query: "an_" }, asUser(SELF));
    expect(underscore.map((u) => u.username)).toEqual(["an_na"]);

    const percent = await call(appRouter.user.search, { query: "%" }, asUser(SELF));
    expect(percent).toEqual([]);
  });

  test("respects the limit and rejects blank queries", async () => {
    const limited = await call(appRouter.user.search, { query: "a", limit: 2 }, asUser(SELF));
    expect(limited).toHaveLength(2);

    await expectCode(call(appRouter.user.search, { query: "   " }, asUser(SELF)), "BAD_REQUEST");
    await expectCode(call(appRouter.user.search, { query: "anna" }, asNobody()), "UNAUTHORIZED");
  });
});

describe("user.get", () => {
  test("returns the public profile shape; unknown → NOT_FOUND", async () => {
    const anna = await call(appRouter.user.get, { userId: "u-anna" }, asUser(SELF));
    expect(anna).toEqual({
      id: "u-anna",
      username: "anna",
      displayName: "Anna Banana",
      image: null,
    });

    await expectCode(call(appRouter.user.get, { userId: "u-ghost" }, asUser(SELF)), "NOT_FOUND");
  });
});
