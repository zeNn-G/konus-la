import { getChannel } from "@konus-la/db";
import { seedTestDmChannel, seedTestUser } from "@konus-la/db/testing";
import { call } from "@orpc/server";
import { beforeAll, describe, expect, test } from "vitest";

import { asNobody, asUser, expectCode } from "../testing";
import { appRouter } from "./index";

const ALICE = "u-alice";
const BOB = "u-bob";
const CAROL = "u-carol";
const DAVE = "u-dave";
const MALLORY = "u-mallory"; // never a participant anywhere

beforeAll(async () => {
  await seedTestUser({ id: ALICE, username: "alice" });
  await seedTestUser({ id: BOB, username: "bob" });
  await seedTestUser({ id: CAROL, username: "carol" });
  await seedTestUser({ id: DAVE, username: "dave" });
  await seedTestUser({ id: MALLORY, username: "mallory" });
});

async function viewerDm(channelId: string, userId: string) {
  const rows = await call(appRouter.dm.list, undefined, asUser(userId));
  const row = rows.find((r) => r.id === channelId);
  if (!row) throw new Error(`dm ${channelId} missing from list`);
  return row;
}

describe("dm.openWithUser", () => {
  test("creates once, then is idempotent from either direction", async () => {
    const first = await call(appRouter.dm.openWithUser, { userId: BOB }, asUser(ALICE));
    expect(first.created).toBe(true);

    const again = await call(appRouter.dm.openWithUser, { userId: BOB }, asUser(ALICE));
    expect(again).toEqual({ channelId: first.channelId, created: false });

    const reversed = await call(appRouter.dm.openWithUser, { userId: ALICE }, asUser(BOB));
    expect(reversed).toEqual({ channelId: first.channelId, created: false });
  });

  test("concurrent opens from both sides land on one channel", async () => {
    const [a, b] = await Promise.all([
      call(appRouter.dm.openWithUser, { userId: DAVE }, asUser(CAROL)),
      call(appRouter.dm.openWithUser, { userId: CAROL }, asUser(DAVE)),
    ]);
    expect(a.channelId).toBe(b.channelId);
  });

  test("self → BAD_REQUEST; unknown user → NOT_FOUND; unauthenticated → UNAUTHORIZED", async () => {
    await expectCode(
      call(appRouter.dm.openWithUser, { userId: ALICE }, asUser(ALICE)),
      "BAD_REQUEST",
    );
    await expectCode(
      call(appRouter.dm.openWithUser, { userId: "u-ghost" }, asUser(ALICE)),
      "NOT_FOUND",
    );
    await expectCode(call(appRouter.dm.openWithUser, { userId: BOB }, asNobody()), "UNAUTHORIZED");
  });
});

describe("dm.createGroup", () => {
  test("creator + 2 others works; creator becomes owner", async () => {
    const { channelId } = await call(
      appRouter.dm.createGroup,
      { participantIds: [BOB, CAROL], name: "the gang" },
      asUser(ALICE),
    );
    const group = await call(appRouter.dm.get, { channelId }, asUser(BOB));
    expect(group).toMatchObject({ isGroup: true, name: "the gang", ownerId: ALICE });
    expect(group.participants.map((p) => p.userId).sort()).toEqual([ALICE, BOB, CAROL]);
  });

  test("self and duplicate ids are dropped before the ≥3-total check", async () => {
    // [self, bob, bob] collapses to one other participant → below minimum.
    await expectCode(
      call(appRouter.dm.createGroup, { participantIds: [ALICE, BOB, BOB] }, asUser(ALICE)),
      "BAD_REQUEST",
    );
    // [bob, bob, carol] collapses to two others → fine.
    const { channelId } = await call(
      appRouter.dm.createGroup,
      { participantIds: [BOB, BOB, CAROL] },
      asUser(ALICE),
    );
    const group = await call(appRouter.dm.get, { channelId }, asUser(ALICE));
    expect(group.participants).toHaveLength(3);
  });

  test("unknown participant → NOT_FOUND; name is optional", async () => {
    await expectCode(
      call(appRouter.dm.createGroup, { participantIds: [BOB, "u-ghost"] }, asUser(ALICE)),
      "NOT_FOUND",
    );
    const { channelId } = await call(
      appRouter.dm.createGroup,
      { participantIds: [BOB, CAROL] },
      asUser(ALICE),
    );
    const group = await call(appRouter.dm.get, { channelId }, asUser(ALICE));
    expect(group.name).toBeNull();
  });

  test("size cap: 10 total is allowed, an 11th is FORBIDDEN", async () => {
    const extras: string[] = [];
    for (let i = 0; i < 10; i++) {
      const id = `u-cap-${i}`;
      await seedTestUser({ id, username: `capuser${i}` });
      extras.push(id);
    }
    // creator + 9 others = 10 = MAX_DM_GROUP_SIZE default → ok
    const { channelId } = await call(
      appRouter.dm.createGroup,
      { participantIds: extras.slice(0, 9) },
      asUser(ALICE),
    );
    // creator + 10 others = 11 → over cap
    await expectCode(
      call(appRouter.dm.createGroup, { participantIds: extras }, asUser(ALICE)),
      "FORBIDDEN",
    );
    // adding an 11th to the full group → over cap
    await expectCode(
      call(appRouter.dm.addParticipant, { channelId, userId: extras[9] as string }, asUser(ALICE)),
      "FORBIDDEN",
    );
  });
});

describe("DM channel gating (requireChannelMember participant branch)", () => {
  test("participants chat; non-participants are FORBIDDEN everywhere", async () => {
    const channelId = await seedTestDmChannel({ isGroup: false, participantIds: [ALICE, CAROL] });

    const message = await call(
      appRouter.chat.sendMessage,
      { channelId, content: "psst" },
      asUser(ALICE),
    );
    expect(message.channelId).toBe(channelId);

    const page = await call(appRouter.chat.history, { channelId }, asUser(CAROL));
    expect(page.messages.map((m) => m.id)).toEqual([message.id]);

    await expect(
      call(appRouter.channel.markRead, { channelId, messageId: message.id }, asUser(CAROL)),
    ).resolves.toEqual({ ok: true });
    expect(await viewerDm(channelId, CAROL)).toMatchObject({ unread: false });

    for (const promise of [
      call(appRouter.chat.sendMessage, { channelId, content: "intrude" }, asUser(MALLORY)),
      call(appRouter.chat.history, { channelId }, asUser(MALLORY)),
      call(appRouter.channel.markRead, { channelId, messageId: message.id }, asUser(MALLORY)),
      call(appRouter.dm.get, { channelId }, asUser(MALLORY)),
    ]) {
      await expectCode(promise, "FORBIDDEN");
    }
  });

  test("mentions resolve against participants; outsiders are inert", async () => {
    const channelId = await seedTestDmChannel({
      isGroup: true,
      participantIds: [ALICE, BOB, CAROL],
    });
    await call(
      appRouter.chat.sendMessage,
      { channelId, content: "hey @bob and @mallory" },
      asUser(ALICE),
    );

    expect(await viewerDm(channelId, BOB)).toMatchObject({ unread: true, mentionsCount: 1 });
    expect(await viewerDm(channelId, CAROL)).toMatchObject({ unread: true, mentionsCount: 0 });
    // Mallory is not a participant: no read-state row was created for her.
    const mallorysDms = await call(appRouter.dm.list, undefined, asUser(MALLORY));
    expect(mallorysDms.find((r) => r.id === channelId)).toBeUndefined();
  });

  test("edit and delete are author-only in DMs — even the group owner may not delete", async () => {
    const channelId = await seedTestDmChannel({
      isGroup: true,
      participantIds: [ALICE, BOB, CAROL],
      ownerId: ALICE,
    });
    const message = await call(
      appRouter.chat.sendMessage,
      { channelId, content: "bob's words" },
      asUser(BOB),
    );

    await expectCode(
      call(appRouter.chat.editMessage, { messageId: message.id, content: "hax" }, asUser(ALICE)),
      "FORBIDDEN",
    );
    await expectCode(
      call(appRouter.chat.deleteMessage, { messageId: message.id }, asUser(ALICE)),
      "FORBIDDEN",
    );

    await expect(
      call(appRouter.chat.editMessage, { messageId: message.id, content: "fixed" }, asUser(BOB)),
    ).resolves.toEqual({ ok: true });
    await expect(
      call(appRouter.chat.deleteMessage, { messageId: message.id }, asUser(BOB)),
    ).resolves.toEqual({ ok: true });
  });
});

describe("dm.addParticipant / removeParticipant", () => {
  test("any participant adds; newcomer sees full pre-join history", async () => {
    const channelId = await seedTestDmChannel({
      isGroup: true,
      participantIds: [ALICE, BOB, CAROL],
      ownerId: ALICE,
    });
    const old = await call(
      appRouter.chat.sendMessage,
      { channelId, content: "before dave" },
      asUser(ALICE),
    );

    // Bob is not the owner — adding still works.
    await expect(
      call(appRouter.dm.addParticipant, { channelId, userId: DAVE }, asUser(BOB)),
    ).resolves.toEqual({ ok: true });

    const page = await call(appRouter.chat.history, { channelId }, asUser(DAVE));
    expect(page.messages.map((m) => m.id)).toContain(old.id);
  });

  test("re-add → CONFLICT; unknown user → NOT_FOUND; non-participant → FORBIDDEN; 1:1 → BAD_REQUEST", async () => {
    const groupId = await seedTestDmChannel({
      isGroup: true,
      participantIds: [ALICE, BOB, CAROL],
    });
    await expectCode(
      call(appRouter.dm.addParticipant, { channelId: groupId, userId: BOB }, asUser(ALICE)),
      "CONFLICT",
    );
    await expectCode(
      call(appRouter.dm.addParticipant, { channelId: groupId, userId: "u-ghost" }, asUser(ALICE)),
      "NOT_FOUND",
    );
    await expectCode(
      call(appRouter.dm.addParticipant, { channelId: groupId, userId: DAVE }, asUser(MALLORY)),
      "FORBIDDEN",
    );

    const pairId = await seedTestDmChannel({ isGroup: false, participantIds: [ALICE, DAVE] });
    await expectCode(
      call(appRouter.dm.addParticipant, { channelId: pairId, userId: CAROL }, asUser(ALICE)),
      "BAD_REQUEST",
    );
  });

  test("only the owner removes; removal cuts off history access", async () => {
    const channelId = await seedTestDmChannel({
      isGroup: true,
      participantIds: [ALICE, BOB, CAROL],
      ownerId: ALICE,
    });

    await expectCode(
      call(appRouter.dm.removeParticipant, { channelId, userId: CAROL }, asUser(BOB)),
      "FORBIDDEN",
    );
    await expectCode(
      call(appRouter.dm.removeParticipant, { channelId, userId: ALICE }, asUser(ALICE)),
      "BAD_REQUEST", // removing yourself is `leave`
    );

    await expect(
      call(appRouter.dm.removeParticipant, { channelId, userId: CAROL }, asUser(ALICE)),
    ).resolves.toEqual({ ok: true });
    await expectCode(call(appRouter.chat.history, { channelId }, asUser(CAROL)), "FORBIDDEN");
    await expectCode(
      call(appRouter.dm.removeParticipant, { channelId, userId: CAROL }, asUser(ALICE)),
      "NOT_FOUND",
    );
  });

  test("a re-added member's read state was cleared on removal", async () => {
    const channelId = await seedTestDmChannel({
      isGroup: true,
      participantIds: [ALICE, BOB, CAROL],
      ownerId: ALICE,
    });
    const message = await call(
      appRouter.chat.sendMessage,
      { channelId, content: "read me @bob" },
      asUser(ALICE),
    );
    await call(appRouter.channel.markRead, { channelId, messageId: message.id }, asUser(BOB));
    expect(await viewerDm(channelId, BOB)).toMatchObject({ unread: false, mentionsCount: 0 });

    await call(appRouter.dm.removeParticipant, { channelId, userId: BOB }, asUser(ALICE));
    await call(appRouter.dm.addParticipant, { channelId, userId: BOB }, asUser(ALICE));

    // Watermark and mention counter are gone — the whole channel reads as unread again.
    expect(await viewerDm(channelId, BOB)).toMatchObject({ unread: true, mentionsCount: 0 });
  });
});

describe("dm.leave", () => {
  test("owner leaving transfers to the longest-standing participant", async () => {
    const channelId = await seedTestDmChannel({
      isGroup: true,
      participantIds: [ALICE, BOB, CAROL],
      ownerId: ALICE,
      joinedAtOffsetsMs: [0, 2000, 1000], // carol joined before bob
    });
    await expect(call(appRouter.dm.leave, { channelId }, asUser(ALICE))).resolves.toEqual({
      ok: true,
    });
    const group = await call(appRouter.dm.get, { channelId }, asUser(BOB));
    expect(group.ownerId).toBe(CAROL);
    expect(group.participants).toHaveLength(2);
  });

  test("equal joinedAt falls back to the lower userId", async () => {
    const channelId = await seedTestDmChannel({
      isGroup: true,
      participantIds: [ALICE, CAROL, BOB],
      ownerId: ALICE,
      joinedAtOffsetsMs: [0, 5000, 5000],
    });
    await call(appRouter.dm.leave, { channelId }, asUser(ALICE));
    const group = await call(appRouter.dm.get, { channelId }, asUser(BOB));
    expect(group.ownerId).toBe(BOB); // "u-bob" < "u-carol"
  });

  test("groups may shrink below three; the last leaver deletes the channel", async () => {
    const channelId = await seedTestDmChannel({
      isGroup: true,
      participantIds: [ALICE, BOB, CAROL],
      ownerId: ALICE,
    });
    await call(appRouter.chat.sendMessage, { channelId, content: "doomed" }, asUser(ALICE));

    await call(appRouter.dm.leave, { channelId }, asUser(CAROL));
    await call(appRouter.dm.leave, { channelId }, asUser(BOB));
    const soloGroup = await call(appRouter.dm.get, { channelId }, asUser(ALICE));
    expect(soloGroup.participants).toHaveLength(1);

    await call(appRouter.dm.leave, { channelId }, asUser(ALICE));
    expect(await getChannel(channelId)).toBeUndefined();
  });

  test("leaving a 1:1 → BAD_REQUEST; leaving a group you're not in → FORBIDDEN", async () => {
    const pairId = await seedTestDmChannel({ isGroup: false, participantIds: [BOB, DAVE] });
    await expectCode(call(appRouter.dm.leave, { channelId: pairId }, asUser(BOB)), "BAD_REQUEST");

    const groupId = await seedTestDmChannel({
      isGroup: true,
      participantIds: [ALICE, BOB, CAROL],
    });
    await expectCode(call(appRouter.dm.leave, { channelId: groupId }, asUser(MALLORY)), "FORBIDDEN");
  });
});

describe("dm.rename", () => {
  test("any participant renames; empty/whitespace clears back to null", async () => {
    const channelId = await seedTestDmChannel({
      isGroup: true,
      participantIds: [ALICE, BOB, CAROL],
      ownerId: ALICE,
    });
    await expect(
      call(appRouter.dm.rename, { channelId, name: "  night crew  " }, asUser(BOB)),
    ).resolves.toEqual({ ok: true });
    expect((await call(appRouter.dm.get, { channelId }, asUser(ALICE))).name).toBe("night crew");

    await call(appRouter.dm.rename, { channelId, name: null }, asUser(CAROL));
    expect((await call(appRouter.dm.get, { channelId }, asUser(ALICE))).name).toBeNull();
  });

  test("1:1 → BAD_REQUEST; over 100 chars → BAD_REQUEST; non-participant → FORBIDDEN", async () => {
    const pairId = await seedTestDmChannel({ isGroup: false, participantIds: [BOB, MALLORY] });
    await expectCode(
      call(appRouter.dm.rename, { channelId: pairId, name: "us" }, asUser(BOB)),
      "BAD_REQUEST",
    );

    const groupId = await seedTestDmChannel({
      isGroup: true,
      participantIds: [ALICE, BOB, CAROL],
    });
    await expectCode(
      call(appRouter.dm.rename, { channelId: groupId, name: "x".repeat(101) }, asUser(ALICE)),
      "BAD_REQUEST",
    );
    await expectCode(
      call(appRouter.dm.rename, { channelId: groupId, name: "sneaky" }, asUser(MALLORY)),
      "FORBIDDEN",
    );
  });
});

describe("dm.list", () => {
  test("an empty 1:1 is hidden until its first message; groups list immediately", async () => {
    const { channelId: pairId } = await call(
      appRouter.dm.openWithUser,
      { userId: MALLORY },
      asUser(DAVE),
    );
    let daves = await call(appRouter.dm.list, undefined, asUser(DAVE));
    expect(daves.find((r) => r.id === pairId)).toBeUndefined();

    const groupId = await seedTestDmChannel({
      isGroup: true,
      participantIds: [DAVE, ALICE, BOB],
    });
    daves = await call(appRouter.dm.list, undefined, asUser(DAVE));
    expect(daves.find((r) => r.id === groupId)).toMatchObject({ isGroup: true, unread: false });

    await call(appRouter.chat.sendMessage, { channelId: pairId, content: "hi" }, asUser(DAVE));
    const mallorys = await call(appRouter.dm.list, undefined, asUser(MALLORY));
    expect(mallorys.find((r) => r.id === pairId)).toMatchObject({
      isGroup: false,
      unread: true,
    });
  });

  test("rows carry participants and sort by last activity, newest first", async () => {
    const first = await seedTestDmChannel({ isGroup: true, participantIds: [CAROL, ALICE, BOB] });
    const second = await seedTestDmChannel({ isGroup: true, participantIds: [CAROL, DAVE, BOB] });

    await call(appRouter.chat.sendMessage, { channelId: second, content: "1" }, asUser(DAVE));
    await call(appRouter.chat.sendMessage, { channelId: first, content: "2" }, asUser(ALICE));

    const rows = await call(appRouter.dm.list, undefined, asUser(CAROL));
    const ids = rows.map((r) => r.id);
    expect(ids.indexOf(first)).toBeLessThan(ids.indexOf(second));

    const row = rows.find((r) => r.id === first);
    expect(row?.participants.map((p) => p.username).sort()).toEqual(["alice", "bob", "carol"]);
  });
});
