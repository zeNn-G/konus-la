import { createGuildWithOwner, insertMessage } from "@konus-la/db";
import { seedTestMembership, seedTestUser } from "@konus-la/db/testing";
import { call } from "@orpc/server";
import { beforeAll, describe, expect, test } from "vitest";

import { asNobody, asUser, expectCode } from "../testing";
import { appRouter } from "./index";

const OWNER = "u-owner";
const MEMBER = "u-member";
const OUTSIDER = "u-outsider";

let guildId: string;
let generalId: string;

beforeAll(async () => {
  await seedTestUser({ id: OWNER, username: "alice" });
  await seedTestUser({ id: MEMBER, username: "bob" });
  await seedTestUser({ id: OUTSIDER, username: "mallory" });
  const created = await createGuildWithOwner({ name: "Testers", ownerUserId: OWNER });
  guildId = created.id;
  await seedTestMembership(guildId, MEMBER);

  const channels = await call(appRouter.channel.list, { guildId }, asUser(OWNER));
  const general = channels.find((c) => c.name === "general");
  if (!general) throw new Error("guild.create did not seed #general");
  generalId = general.id;
});

describe("channel.create", () => {
  test("owner creates a text channel", async () => {
    const created = await call(appRouter.channel.create, { guildId, name: "bugs" }, asUser(OWNER));
    expect(created).toMatchObject({ name: "bugs", kind: "text" });

    const channels = await call(appRouter.channel.list, { guildId }, asUser(MEMBER));
    expect(channels.map((c) => c.name)).toEqual(["general", "bugs"]);
  });

  test("duplicate name in the same guild → CONFLICT", async () => {
    await expectCode(
      call(appRouter.channel.create, { guildId, name: "bugs" }, asUser(OWNER)),
      "CONFLICT",
    );
  });

  test("non-owner member → FORBIDDEN", async () => {
    await expectCode(
      call(appRouter.channel.create, { guildId, name: "member-made" }, asUser(MEMBER)),
      "FORBIDDEN",
    );
  });

  test("invalid slug → BAD_REQUEST", async () => {
    await expectCode(
      call(appRouter.channel.create, { guildId, name: "Not A Slug!" }, asUser(OWNER)),
      "BAD_REQUEST",
    );
  });

  test("unauthenticated → UNAUTHORIZED", async () => {
    await expectCode(
      call(appRouter.channel.create, { guildId, name: "anon" }, asNobody()),
      "UNAUTHORIZED",
    );
  });
});

/**
 * Own guild, because the suite above asserts whole-list contents and is order-coupled —
 * a voice channel appearing in `guildId` would break it.
 */
describe("channel.create kinds", () => {
  let kindsGuildId: string;

  beforeAll(async () => {
    const created = await createGuildWithOwner({ name: "Kinds", ownerUserId: OWNER });
    kindsGuildId = created.id;
    await seedTestMembership(kindsGuildId, MEMBER);
  });

  test("owner creates a voice channel", async () => {
    const created = await call(
      appRouter.channel.create,
      { guildId: kindsGuildId, name: "lounge", kind: "voice" },
      asUser(OWNER),
    );
    expect(created).toMatchObject({ name: "lounge", kind: "voice" });
  });

  test("kind defaults to text when omitted", async () => {
    const created = await call(
      appRouter.channel.create,
      { guildId: kindsGuildId, name: "no-kind" },
      asUser(OWNER),
    );
    expect(created).toMatchObject({ name: "no-kind", kind: "text" });
  });

  test("a voice channel may reuse a text channel's name", async () => {
    // The guild was seeded with a text #general; a voice `general` is a different channel.
    const created = await call(
      appRouter.channel.create,
      { guildId: kindsGuildId, name: "general", kind: "voice" },
      asUser(OWNER),
    );
    expect(created).toMatchObject({ name: "general", kind: "voice" });

    const channels = await call(appRouter.channel.list, { guildId: kindsGuildId }, asUser(MEMBER));
    expect(
      channels
        .filter((c) => c.name === "general")
        .map((c) => c.kind)
        .sort(),
    ).toEqual(["text", "voice"]);
  });

  test("duplicate name within the same kind → CONFLICT", async () => {
    await expectCode(
      call(
        appRouter.channel.create,
        { guildId: kindsGuildId, name: "lounge", kind: "voice" },
        asUser(OWNER),
      ),
      "CONFLICT",
    );
  });

  test("dm is not a creatable kind → BAD_REQUEST", async () => {
    await expectCode(
      call(
        appRouter.channel.create,
        // @ts-expect-error — `dm` is deliberately outside the input's kind union.
        { guildId: kindsGuildId, name: "sneaky", kind: "dm" },
        asUser(OWNER),
      ),
      "BAD_REQUEST",
    );
  });

  test("non-owner member creating voice → FORBIDDEN", async () => {
    await expectCode(
      call(
        appRouter.channel.create,
        { guildId: kindsGuildId, name: "member-voice", kind: "voice" },
        asUser(MEMBER),
      ),
      "FORBIDDEN",
    );
  });
});

describe("channel.update", () => {
  test("owner renames; rename onto an existing name → CONFLICT", async () => {
    const bugs = await call(appRouter.channel.list, { guildId }, asUser(OWNER)).then((channels) =>
      channels.find((c) => c.name === "bugs"),
    );
    if (!bugs) throw new Error("missing #bugs from previous test");

    await expect(
      call(
        appRouter.channel.update,
        { guildId, channelId: bugs.id, name: "issues" },
        asUser(OWNER),
      ),
    ).resolves.toEqual({ ok: true });

    await expectCode(
      call(
        appRouter.channel.update,
        { guildId, channelId: bugs.id, name: "general" },
        asUser(OWNER),
      ),
      "CONFLICT",
    );
  });

  test("unknown channel → NOT_FOUND; non-owner → FORBIDDEN", async () => {
    await expectCode(
      call(appRouter.channel.update, { guildId, channelId: "nope", name: "x" }, asUser(OWNER)),
      "NOT_FOUND",
    );
    await expectCode(
      call(
        appRouter.channel.update,
        { guildId, channelId: generalId, name: "hax" },
        asUser(MEMBER),
      ),
      "FORBIDDEN",
    );
  });
});

describe("channel.delete", () => {
  test("owner deletes; repeat delete → NOT_FOUND; non-owner → FORBIDDEN", async () => {
    const issues = await call(appRouter.channel.list, { guildId }, asUser(OWNER)).then((channels) =>
      channels.find((c) => c.name === "issues"),
    );
    if (!issues) throw new Error("missing #issues from previous test");

    await expectCode(
      call(appRouter.channel.delete, { guildId, channelId: issues.id }, asUser(MEMBER)),
      "FORBIDDEN",
    );

    await expect(
      call(appRouter.channel.delete, { guildId, channelId: issues.id }, asUser(OWNER)),
    ).resolves.toEqual({ ok: true });

    const channels = await call(appRouter.channel.list, { guildId }, asUser(OWNER));
    expect(channels.map((c) => c.name)).toEqual(["general"]);

    await expectCode(
      call(appRouter.channel.delete, { guildId, channelId: issues.id }, asUser(OWNER)),
      "NOT_FOUND",
    );
  });
});

describe("channel.list", () => {
  test("non-member → FORBIDDEN (no-peek)", async () => {
    await expectCode(call(appRouter.channel.list, { guildId }, asUser(OUTSIDER)), "FORBIDDEN");
  });
});

describe("channel.markRead", () => {
  test("watermark advances, zeroes mentions, and never rewinds", async () => {
    // Two messages from the owner; the first pings the member.
    const first = await insertMessage({
      channelId: generalId,
      guildId,
      authorId: OWNER,
      content: "ping @bob",
    });
    const second = await insertMessage({
      channelId: generalId,
      guildId,
      authorId: OWNER,
      content: "and a follow-up",
    });
    if (first.status !== "ok" || second.status !== "ok") throw new Error("seed failed");

    const before = await call(appRouter.channel.list, { guildId }, asUser(MEMBER));
    expect(before[0]).toMatchObject({ unread: true, mentionsCount: 1 });

    await call(
      appRouter.channel.markRead,
      { channelId: generalId, messageId: second.message.id },
      asUser(MEMBER),
    );
    const afterRead = await call(appRouter.channel.list, { guildId }, asUser(MEMBER));
    expect(afterRead[0]).toMatchObject({ unread: false, mentionsCount: 0 });

    // A stale tab reporting the OLDER message must not rewind the watermark.
    await call(
      appRouter.channel.markRead,
      { channelId: generalId, messageId: first.message.id },
      asUser(MEMBER),
    );
    const afterStale = await call(appRouter.channel.list, { guildId }, asUser(MEMBER));
    expect(afterStale[0]).toMatchObject({ unread: false, mentionsCount: 0 });

    // A genuinely new message flips it back to unread.
    const third = await insertMessage({
      channelId: generalId,
      guildId,
      authorId: OWNER,
      content: "newer again",
    });
    if (third.status !== "ok") throw new Error("seed failed");
    const afterNew = await call(appRouter.channel.list, { guildId }, asUser(MEMBER));
    expect(afterNew[0]).toMatchObject({ unread: true, mentionsCount: 0 });
  });

  test("non-member → FORBIDDEN", async () => {
    await expectCode(
      call(
        appRouter.channel.markRead,
        { channelId: generalId, messageId: "anything" },
        asUser(OUTSIDER),
      ),
      "FORBIDDEN",
    );
  });
});
