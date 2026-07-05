import { createChannel, createGuildWithOwner, insertMessage } from "@konus-la/db";
import { seedTestMembership, seedTestUser } from "@konus-la/db/testing";
import { call } from "@orpc/server";
import { beforeAll, describe, expect, test } from "vitest";

import { asNobody, asUser, expectCode } from "../testing";
import { appRouter } from "./index";

const OWNER = "u-owner";
const MEMBER = "u-member";
const OUTSIDER = "u-outsider";

let guildId: string;
let chatId: string; // send/reply/edit/delete playground
let mentionsId: string; // isolated so badge counts aren't disturbed by other tests
let historyId: string; // isolated so pagination sees exactly the seeded rows

beforeAll(async () => {
  await seedTestUser({ id: OWNER, username: "alice" });
  await seedTestUser({ id: MEMBER, username: "bob" });
  await seedTestUser({ id: OUTSIDER, username: "mallory" });
  const created = await createGuildWithOwner({ name: "Chatters", ownerUserId: OWNER });
  guildId = created.id;
  await seedTestMembership(guildId, MEMBER);

  chatId = (await createChannel({ guildId, name: "chat" })).id;
  mentionsId = (await createChannel({ guildId, name: "mentions" })).id;
  historyId = (await createChannel({ guildId, name: "history" })).id;
});

async function viewerChannel(channelId: string, userId: string) {
  const channels = await call(appRouter.channel.list, { guildId }, asUser(userId));
  const row = channels.find((c) => c.id === channelId);
  if (!row) throw new Error(`channel ${channelId} missing from list`);
  return row;
}

describe("chat.sendMessage", () => {
  test("member posts; guild members are mentionable, @everyone is inert", async () => {
    const message = await call(
      appRouter.chat.sendMessage,
      { channelId: mentionsId, content: "hey @alice @everyone" },
      asUser(MEMBER),
    );
    expect(message).toMatchObject({
      channelId: mentionsId,
      content: "hey @alice @everyone",
      editedAt: null,
      replyTo: null,
      author: { id: MEMBER, username: "bob" },
    });

    // Exactly one badge for the owner — @everyone resolved to nobody.
    const asOwnerSees = await viewerChannel(mentionsId, OWNER);
    expect(asOwnerSees).toMatchObject({ unread: true, mentionsCount: 1 });
  });

  test("self-mentions never badge the author", async () => {
    await call(
      appRouter.chat.sendMessage,
      { channelId: mentionsId, content: "note to self: @bob" },
      asUser(MEMBER),
    );
    const asMemberSees = await viewerChannel(mentionsId, MEMBER);
    expect(asMemberSees.mentionsCount).toBe(0);
  });

  test("non-member → FORBIDDEN; unauthenticated → UNAUTHORIZED", async () => {
    await expectCode(
      call(appRouter.chat.sendMessage, { channelId: chatId, content: "hi" }, asUser(OUTSIDER)),
      "FORBIDDEN",
    );
    await expectCode(
      call(appRouter.chat.sendMessage, { channelId: chatId, content: "hi" }, asNobody()),
      "UNAUTHORIZED",
    );
  });

  test("whitespace-only content → BAD_REQUEST", async () => {
    await expectCode(
      call(appRouter.chat.sendMessage, { channelId: chatId, content: "   " }, asUser(MEMBER)),
      "BAD_REQUEST",
    );
  });

  test("replies carry the parent preview; dead reply targets → BAD_REQUEST", async () => {
    const parent = await call(
      appRouter.chat.sendMessage,
      { channelId: chatId, content: "parent" },
      asUser(OWNER),
    );
    const reply = await call(
      appRouter.chat.sendMessage,
      { channelId: chatId, content: "child", replyToMessageId: parent.id },
      asUser(MEMBER),
    );
    expect(reply.replyTo).toMatchObject({
      id: parent.id,
      content: "parent",
      authorUsername: "alice",
    });

    await expectCode(
      call(
        appRouter.chat.sendMessage,
        { channelId: chatId, content: "orphan", replyToMessageId: "01_DOES_NOT_EXIST" },
        asUser(MEMBER),
      ),
      "BAD_REQUEST",
    );
  });
});

describe("chat.editMessage", () => {
  test("author edits own message; editedAt becomes visible in history", async () => {
    const message = await call(
      appRouter.chat.sendMessage,
      { channelId: chatId, content: "tpyo" },
      asUser(MEMBER),
    );
    await expect(
      call(appRouter.chat.editMessage, { messageId: message.id, content: "typo" }, asUser(MEMBER)),
    ).resolves.toEqual({ ok: true });

    const page = await call(appRouter.chat.history, { channelId: chatId }, asUser(MEMBER));
    const edited = page.messages.find((m) => m.id === message.id);
    expect(edited).toMatchObject({ content: "typo" });
    expect(edited?.editedAt).not.toBeNull();
  });

  test("only the author may edit — even the guild owner is FORBIDDEN", async () => {
    const message = await call(
      appRouter.chat.sendMessage,
      { channelId: chatId, content: "mine" },
      asUser(MEMBER),
    );
    await expectCode(
      call(appRouter.chat.editMessage, { messageId: message.id, content: "hax" }, asUser(OWNER)),
      "FORBIDDEN",
    );
  });

  test("unknown message → NOT_FOUND", async () => {
    await expectCode(
      call(appRouter.chat.editMessage, { messageId: "missing", content: "x" }, asUser(MEMBER)),
      "NOT_FOUND",
    );
  });
});

describe("chat.deleteMessage", () => {
  test("author and guild owner may delete; other members may not", async () => {
    const ownMessage = await call(
      appRouter.chat.sendMessage,
      { channelId: chatId, content: "delete me" },
      asUser(MEMBER),
    );
    await expect(
      call(appRouter.chat.deleteMessage, { messageId: ownMessage.id }, asUser(MEMBER)),
    ).resolves.toEqual({ ok: true });

    const ownersMessage = await call(
      appRouter.chat.sendMessage,
      { channelId: chatId, content: "owner's" },
      asUser(OWNER),
    );
    await expectCode(
      call(appRouter.chat.deleteMessage, { messageId: ownersMessage.id }, asUser(MEMBER)),
      "FORBIDDEN",
    );

    const membersMessage = await call(
      appRouter.chat.sendMessage,
      { channelId: chatId, content: "moderate me" },
      asUser(MEMBER),
    );
    await expect(
      call(appRouter.chat.deleteMessage, { messageId: membersMessage.id }, asUser(OWNER)),
    ).resolves.toEqual({ ok: true });

    await expectCode(
      call(appRouter.chat.deleteMessage, { messageId: membersMessage.id }, asUser(OWNER)),
      "NOT_FOUND",
    );
  });

  test("deleting a reply's parent nulls the preview instead of dropping the reply", async () => {
    const parent = await call(
      appRouter.chat.sendMessage,
      { channelId: chatId, content: "doomed parent" },
      asUser(OWNER),
    );
    const reply = await call(
      appRouter.chat.sendMessage,
      { channelId: chatId, content: "surviving child", replyToMessageId: parent.id },
      asUser(MEMBER),
    );
    await call(appRouter.chat.deleteMessage, { messageId: parent.id }, asUser(OWNER));

    const page = await call(appRouter.chat.history, { channelId: chatId }, asUser(MEMBER));
    const survivor = page.messages.find((m) => m.id === reply.id);
    expect(survivor).toBeDefined();
    expect(survivor?.replyToMessageId).toBeNull();
    expect(survivor?.replyTo).toBeNull();
  });
});

describe("chat.history", () => {
  test("newest-first pages with a limit+1-derived cursor, exhausting to null", async () => {
    const seeded: string[] = [];
    for (let i = 0; i < 7; i++) {
      const result = await insertMessage({
        channelId: historyId,
        guildId,
        authorId: OWNER,
        content: `message ${i}`,
      });
      if (result.status !== "ok") throw new Error("seed failed");
      seeded.push(result.message.id);
    }
    const newestFirst = [...seeded].reverse();

    const page1 = await call(
      appRouter.chat.history,
      { channelId: historyId, limit: 3 },
      asUser(MEMBER),
    );
    expect(page1.messages.map((m) => m.id)).toEqual(newestFirst.slice(0, 3));
    expect(page1.nextCursor).toBe(newestFirst[2]);

    const page2 = await call(
      appRouter.chat.history,
      { channelId: historyId, limit: 3, before: page1.nextCursor },
      asUser(MEMBER),
    );
    expect(page2.messages.map((m) => m.id)).toEqual(newestFirst.slice(3, 6));

    const page3 = await call(
      appRouter.chat.history,
      { channelId: historyId, limit: 3, before: page2.nextCursor },
      asUser(MEMBER),
    );
    expect(page3.messages.map((m) => m.id)).toEqual(newestFirst.slice(6));
    expect(page3.nextCursor).toBeNull();
  });

  test("an exact-fit page reports no cursor", async () => {
    const page = await call(
      appRouter.chat.history,
      { channelId: historyId, limit: 7 },
      asUser(MEMBER),
    );
    expect(page.messages).toHaveLength(7);
    expect(page.nextCursor).toBeNull();
  });

  test("limit above 100 → BAD_REQUEST; non-member → FORBIDDEN", async () => {
    await expectCode(
      call(appRouter.chat.history, { channelId: historyId, limit: 101 }, asUser(MEMBER)),
      "BAD_REQUEST",
    );
    await expectCode(
      call(appRouter.chat.history, { channelId: historyId }, asUser(OUTSIDER)),
      "FORBIDDEN",
    );
  });
});
