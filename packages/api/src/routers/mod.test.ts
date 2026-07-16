import { createChannel, createGuildWithOwner } from "@konus-la/db";
import {
  seedTestDmChannel,
  seedTestMembership,
  seedTestMemberRole,
  seedTestRole,
  seedTestUser,
} from "@konus-la/db/testing";
import { call } from "@orpc/server";
import { afterEach, beforeAll, describe, expect, test } from "vitest";

import { PERMISSIONS } from "../permissions";
import { asUser, collect, expectCode, ofType, stopCollectors, waitFor } from "../testing";
import { appRouter } from "./index";

const OWNER = "u-mod-owner";
const MODERATOR = "u-mod-moderator"; // holds a MANAGE_MESSAGES role
const MEMBER = "u-mod-member"; // membership only — the moderated author
const OUTSIDER = "u-mod-outsider";

let guildId: string;
let channelId: string;

afterEach(() => stopCollectors());

beforeAll(async () => {
  await seedTestUser({ id: OWNER, username: "mod-owner" });
  await seedTestUser({ id: MODERATOR, username: "mod-moderator" });
  await seedTestUser({ id: MEMBER, username: "mod-member" });
  await seedTestUser({ id: OUTSIDER, username: "mod-outsider" });

  const created = await createGuildWithOwner({ name: "Moderation Lab", ownerUserId: OWNER });
  guildId = created.id;
  await seedTestMembership(guildId, MODERATOR);
  await seedTestMembership(guildId, MEMBER);
  const modRoleId = await seedTestRole({
    guildId,
    name: "mods",
    position: 1,
    permissions: PERMISSIONS.MANAGE_MESSAGES,
  });
  await seedTestMemberRole(guildId, MODERATOR, modRoleId);

  channelId = (await createChannel({ guildId, name: "moderated", kind: "text" })).id;
});

/** Post as `authorId` and hand back the created message. */
async function post(authorId: string, content: string) {
  return call(appRouter.chat.sendMessage, { channelId, content }, asUser(authorId));
}

describe("mod.deleteMessage", () => {
  test("a MANAGE_MESSAGES holder deletes another member's message; it vanishes for all viewers via message.deleted", async () => {
    const message = await post(MEMBER, "rule-breaking message");
    const authorTab = collect(MEMBER);

    await expect(
      call(
        appRouter.mod.deleteMessage,
        { channelId, messageId: message.id, reason: "spam" },
        asUser(MODERATOR),
      ),
    ).resolves.toEqual({ ok: true });

    const page = await call(appRouter.chat.history, { channelId }, asUser(MEMBER));
    expect(page.messages.find((m) => m.id === message.id)).toBeUndefined();

    await waitFor(
      () => ofType(authorTab, "message.deleted").some((event) => event.messageId === message.id),
      "message.deleted fan-out",
    );
  });

  test("records a message.modDelete audit entry: author as target, reason, first-200-chars snippet", async () => {
    const longContent = "x".repeat(300);
    const message = await post(MEMBER, longContent);
    await call(
      appRouter.mod.deleteMessage,
      { channelId, messageId: message.id, reason: "wall of spam" },
      asUser(MODERATOR),
    );

    const page = await call(appRouter.auditLog.list, { guildId }, asUser(OWNER));
    const entry = page.entries.find((e) => e.targetMessageId === message.id);
    expect(entry).toMatchObject({
      action: "message.modDelete",
      targetChannelId: channelId,
      targetMessageId: message.id,
      actor: { id: MODERATOR, username: "mod-moderator" },
      targetUser: { id: MEMBER, username: "mod-member" },
      metadata: { reason: "wall of spam", contentSnippet: "x".repeat(200) },
    });
  });

  test("an omitted reason is recorded as null", async () => {
    const message = await post(MEMBER, "no reason given");
    await call(appRouter.mod.deleteMessage, { channelId, messageId: message.id }, asUser(MODERATOR));

    const page = await call(appRouter.auditLog.list, { guildId }, asUser(OWNER));
    const entry = page.entries.find((e) => e.targetMessageId === message.id);
    expect(entry?.metadata).toEqual({ reason: null, contentSnippet: "no reason given" });
  });

  test("a member without MANAGE_MESSAGES → FORBIDDEN, message survives", async () => {
    const message = await post(MODERATOR, "untouchable");
    await expectCode(
      call(appRouter.mod.deleteMessage, { channelId, messageId: message.id }, asUser(MEMBER)),
      "FORBIDDEN",
    );
    const page = await call(appRouter.chat.history, { channelId }, asUser(MEMBER));
    expect(page.messages.find((m) => m.id === message.id)).toBeDefined();
  });

  test("DM channels → FORBIDDEN even for a MANAGE_MESSAGES holder", async () => {
    const dmChannelId = await seedTestDmChannel({
      isGroup: false,
      participantIds: [MODERATOR, MEMBER],
    });
    const message = await call(
      appRouter.chat.sendMessage,
      { channelId: dmChannelId, content: "dm message" },
      asUser(MEMBER),
    );
    await expectCode(
      call(
        appRouter.mod.deleteMessage,
        { channelId: dmChannelId, messageId: message.id },
        asUser(MODERATOR),
      ),
      "FORBIDDEN",
    );
  });

  test("a message living in a different channel than the gated one → NOT_FOUND, message survives", async () => {
    const otherChannelId = (await createChannel({ guildId, name: "elsewhere", kind: "text" })).id;
    const message = await call(
      appRouter.chat.sendMessage,
      { channelId: otherChannelId, content: "wrong door" },
      asUser(MEMBER),
    );
    await expectCode(
      call(appRouter.mod.deleteMessage, { channelId, messageId: message.id }, asUser(MODERATOR)),
      "NOT_FOUND",
    );
    const page = await call(appRouter.chat.history, { channelId: otherChannelId }, asUser(MEMBER));
    expect(page.messages.find((m) => m.id === message.id)).toBeDefined();
  });

  test("unknown message → NOT_FOUND; reason above 500 chars → BAD_REQUEST", async () => {
    await expectCode(
      call(appRouter.mod.deleteMessage, { channelId, messageId: "missing" }, asUser(MODERATOR)),
      "NOT_FOUND",
    );
    const message = await post(MEMBER, "long-reason target");
    await expectCode(
      call(
        appRouter.mod.deleteMessage,
        { channelId, messageId: message.id, reason: "r".repeat(501) },
        asUser(MODERATOR),
      ),
      "BAD_REQUEST",
    );
  });
});
