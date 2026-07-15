import {
  actorOutranksMember,
  getEffectivePermissions,
  getHighestRolePosition,
} from "@konus-la/db";
import {
  seedTestDmChannel,
  seedTestMembership,
  seedTestMemberRole,
  seedTestRole,
  seedTestUser,
  seedTestVoiceChannel,
  setTestEveryonePermissions,
  setTestServerMuted,
} from "@konus-la/db/testing";
import { call } from "@orpc/server";
import { beforeAll, describe, expect, test } from "vitest";
import { z } from "zod";

import { protectedProcedure, requireChannelPermission, requireGuildPermission } from "./index";
import { ALL_PERMISSIONS, PERMISSIONS } from "./permissions";
import { appRouter } from "./routers/index";
import { asUser, expectCode } from "./testing";

const OWNER = "u-owner";
const MEMBER = "u-member"; // membership only — rides @everyone (position 0)
const MODERATOR = "u-moderator"; // holds mods (pos 2) + helpers (pos 1)
const PEER = "u-peer"; // holds mods (pos 2) — MODERATOR's equal in rank
const ADMIN_MEMBER = "u-admin-member"; // holds a role carrying only ADMINISTRATOR
const DRIFTER = "u-drifter"; // never a member

let guildId: string;
let guildChannelId: string;
let dmChannelId: string;
let modRoleId: string;
let helperRoleId: string;

// Minimal gated procedures — the middleware factory is the seam under test; ticket 6.1
// ships no gated procedure of its own (regating is a later slice).
const kickGated = protectedProcedure
  .input(z.object({ guildId: z.string() }))
  .use(requireGuildPermission(PERMISSIONS.KICK_MEMBERS))
  .handler(() => "acted");
const inviteGated = protectedProcedure
  .input(z.object({ guildId: z.string() }))
  .use(requireGuildPermission(PERMISSIONS.MANAGE_INVITES))
  .handler(() => "acted");
const moveGated = protectedProcedure
  .input(z.object({ guildId: z.string() }))
  .use(requireGuildPermission(PERMISSIONS.MOVE_MEMBERS))
  .handler(() => "acted");
// Echoes the injected channel so the context contract is observable from outside.
const messageGated = protectedProcedure
  .input(z.object({ channelId: z.string() }))
  .use(requireChannelPermission(PERMISSIONS.MANAGE_MESSAGES))
  .handler(({ context }) => ({ seenChannelId: context.channel.id }));

beforeAll(async () => {
  await seedTestUser({ id: OWNER, username: "alice" });
  await seedTestUser({ id: MEMBER, username: "bob" });
  await seedTestUser({ id: MODERATOR, username: "carol" });
  await seedTestUser({ id: PEER, username: "dave" });
  await seedTestUser({ id: ADMIN_MEMBER, username: "erin" });
  await seedTestUser({ id: DRIFTER, username: "mallory" });

  const created = await call(appRouter.guild.create, { name: "Permission Lab" }, asUser(OWNER));
  guildId = created.id;
  await seedTestMembership(guildId, MEMBER);
  await seedTestMembership(guildId, MODERATOR);
  await seedTestMembership(guildId, PEER);
  await seedTestMembership(guildId, ADMIN_MEMBER);

  const modRole = await seedTestRole({
    guildId,
    name: "mods",
    position: 2,
    permissions: PERMISSIONS.KICK_MEMBERS | PERMISSIONS.MANAGE_MESSAGES,
    color: "#ff5555",
  });
  const helperRole = await seedTestRole({
    guildId,
    name: "helpers",
    position: 1,
    permissions: PERMISSIONS.MANAGE_CHANNELS,
  });
  modRoleId = modRole;
  helperRoleId = helperRole;
  // A juicy role nobody holds must never leak into anyone's mask.
  await seedTestRole({
    guildId,
    name: "unassigned",
    position: 3,
    permissions: PERMISSIONS.ADMINISTRATOR,
  });
  const adminRole = await seedTestRole({
    guildId,
    name: "admins",
    position: 4,
    permissions: PERMISSIONS.ADMINISTRATOR,
  });
  await seedTestMemberRole(guildId, MODERATOR, modRole);
  await seedTestMemberRole(guildId, MODERATOR, helperRole);
  await seedTestMemberRole(guildId, PEER, modRole);
  await seedTestMemberRole(guildId, ADMIN_MEMBER, adminRole);

  guildChannelId = await seedTestVoiceChannel(guildId, "lab-voice");
  dmChannelId = await seedTestDmChannel({ isGroup: false, participantIds: [MODERATOR, MEMBER] });
});

describe("getEffectivePermissions", () => {
  test("@everyone seeds at 0, so a role-less member gets nothing", async () => {
    expect(await getEffectivePermissions(guildId, MEMBER)).toBe(0);
  });

  test("membership alone inherits the @everyone bits", async () => {
    await setTestEveryonePermissions(guildId, PERMISSIONS.MANAGE_INVITES);
    expect(await getEffectivePermissions(guildId, MEMBER)).toBe(PERMISSIONS.MANAGE_INVITES);
  });

  test("assigned roles OR onto @everyone; unassigned roles contribute nothing", async () => {
    expect(await getEffectivePermissions(guildId, MODERATOR)).toBe(
      PERMISSIONS.MANAGE_INVITES |
        PERMISSIONS.KICK_MEMBERS |
        PERMISSIONS.MANAGE_MESSAGES |
        PERMISSIONS.MANAGE_CHANNELS,
    );
  });
});

describe("getHighestRolePosition", () => {
  test("no custom roles → 0 (@everyone's pinned position)", async () => {
    expect(await getHighestRolePosition(guildId, MEMBER)).toBe(0);
  });

  test("max over the member's assigned roles", async () => {
    expect(await getHighestRolePosition(guildId, MODERATOR)).toBe(2);
  });
});

describe("actorOutranksMember", () => {
  test("the owner can never be targeted — even by themselves", async () => {
    expect(await actorOutranksMember(guildId, MODERATOR, OWNER)).toBe(false);
    expect(await actorOutranksMember(guildId, OWNER, OWNER)).toBe(false);
  });

  test("the owner outranks every member", async () => {
    expect(await actorOutranksMember(guildId, OWNER, MODERATOR)).toBe(true);
    expect(await actorOutranksMember(guildId, OWNER, MEMBER)).toBe(true);
  });

  test("strictly higher position acts downward, never upward", async () => {
    expect(await actorOutranksMember(guildId, MODERATOR, MEMBER)).toBe(true);
    expect(await actorOutranksMember(guildId, MEMBER, MODERATOR)).toBe(false);
  });

  test("equal rank can't act — in either direction", async () => {
    expect(await actorOutranksMember(guildId, MODERATOR, PEER)).toBe(false);
    expect(await actorOutranksMember(guildId, PEER, MODERATOR)).toBe(false);
  });

  test("self-target always fails", async () => {
    expect(await actorOutranksMember(guildId, MODERATOR, MODERATOR)).toBe(false);
    expect(await actorOutranksMember(guildId, MEMBER, MEMBER)).toBe(false);
  });
});

describe("requireGuildPermission", () => {
  test("a member holding the required bit passes", async () => {
    await expect(call(kickGated, { guildId }, asUser(MODERATOR))).resolves.toBe("acted");
  });

  test("a member without the bit → FORBIDDEN", async () => {
    await expectCode(call(kickGated, { guildId }, asUser(MEMBER)), "FORBIDDEN");
  });

  test("non-members never inherit @everyone bits → FORBIDDEN before any bit check", async () => {
    // @everyone carries MANAGE_INVITES by this point; a member passes on it…
    await expect(call(inviteGated, { guildId }, asUser(MEMBER))).resolves.toBe("acted");
    // …but a non-member is FORBIDDEN on the very same gate.
    await expectCode(call(inviteGated, { guildId }, asUser(DRIFTER)), "FORBIDDEN");
  });

  test("unknown guilds are indistinguishable from forbidden ones (no-peek)", async () => {
    await expectCode(call(kickGated, { guildId: "no-such" }, asUser(OWNER)), "FORBIDDEN");
  });

  test("the owner short-circuits any gate — even a bit nobody holds", async () => {
    await expect(call(moveGated, { guildId }, asUser(OWNER))).resolves.toBe("acted");
  });

  test("ADMINISTRATOR passes any bit", async () => {
    await expect(call(moveGated, { guildId }, asUser(ADMIN_MEMBER))).resolves.toBe("acted");
  });
});

describe("requireChannelPermission", () => {
  test("a member holding the bit passes and the handler receives the channel", async () => {
    await expect(
      call(messageGated, { channelId: guildChannelId }, asUser(MODERATOR)),
    ).resolves.toEqual({ seenChannelId: guildChannelId });
  });

  test("a member without the bit → FORBIDDEN", async () => {
    await expectCode(call(messageGated, { channelId: guildChannelId }, asUser(MEMBER)), "FORBIDDEN");
  });

  test("a non-member of the channel's guild → FORBIDDEN", async () => {
    await expectCode(
      call(messageGated, { channelId: guildChannelId }, asUser(DRIFTER)),
      "FORBIDDEN",
    );
  });

  test("the owner short-circuits", async () => {
    await expect(
      call(messageGated, { channelId: guildChannelId }, asUser(OWNER)),
    ).resolves.toEqual({ seenChannelId: guildChannelId });
  });

  test("missing channels → FORBIDDEN (no-peek)", async () => {
    await expectCode(call(messageGated, { channelId: "no-such" }, asUser(OWNER)), "FORBIDDEN");
  });

  test("DM channels → FORBIDDEN even for a participant holding guild bits elsewhere", async () => {
    await expectCode(call(messageGated, { channelId: dmChannelId }, asUser(MODERATOR)), "FORBIDDEN");
  });
});

describe("guild.get viewer mask, roles, and member role data", () => {
  test("the owner's resolved mask is all 12 bits", async () => {
    const view = await call(appRouter.guild.get, { guildId }, asUser(OWNER));
    expect(view.viewer.isOwner).toBe(true);
    expect(view.viewer.permissions).toBe(ALL_PERMISSIONS);
  });

  test("an ADMINISTRATOR holder's resolved mask is all 12 bits — bypass stays server-side", async () => {
    const view = await call(appRouter.guild.get, { guildId }, asUser(ADMIN_MEMBER));
    expect(view.viewer.isOwner).toBe(false);
    expect(view.viewer.permissions).toBe(ALL_PERMISSIONS);
  });

  test("an ordinary member's mask is their effective bits", async () => {
    const view = await call(appRouter.guild.get, { guildId }, asUser(MODERATOR));
    expect(view.viewer.permissions).toBe(
      PERMISSIONS.MANAGE_INVITES |
        PERMISSIONS.KICK_MEMBERS |
        PERMISSIONS.MANAGE_MESSAGES |
        PERMISSIONS.MANAGE_CHANNELS,
    );
  });

  test("roles carry id/name/color/position/permissions/isDefault, highest position first", async () => {
    const view = await call(appRouter.guild.get, { guildId }, asUser(MEMBER));
    expect(view.roles.map((role) => role.name)).toEqual([
      "admins",
      "unassigned",
      "mods",
      "helpers",
      "everyone",
    ]);
    const mods = view.roles.find((role) => role.name === "mods");
    expect(mods).toEqual({
      id: modRoleId,
      name: "mods",
      color: "#ff5555",
      position: 2,
      permissions: PERMISSIONS.KICK_MEMBERS | PERMISSIONS.MANAGE_MESSAGES,
      isDefault: false,
    });
    const everyone = view.roles.find((role) => role.isDefault);
    expect(everyone).toMatchObject({ position: 0, permissions: PERMISSIONS.MANAGE_INVITES });
  });

  test("member rows carry roleIds and serverMuted", async () => {
    await setTestServerMuted(guildId, PEER, true);
    const view = await call(appRouter.guild.get, { guildId }, asUser(OWNER));

    const moderator = view.members.find((member) => member.userId === MODERATOR);
    expect(moderator?.roleIds?.slice().sort()).toEqual([helperRoleId, modRoleId].sort());
    expect(moderator?.serverMuted).toBe(false);

    const peer = view.members.find((member) => member.userId === PEER);
    expect(peer?.serverMuted).toBe(true);

    const roleless = view.members.find((member) => member.userId === MEMBER);
    expect(roleless?.roleIds).toEqual([]);
    expect(roleless?.serverMuted).toBe(false);
  });
});
