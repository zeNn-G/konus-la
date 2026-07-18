import {
  seedTestMembership,
  seedTestMemberRole,
  seedTestRole,
  seedTestUser,
} from "@konus-la/db/testing";
import { call } from "@orpc/server";
import { afterEach, beforeAll, describe, expect, test } from "vitest";

import { PERMISSIONS } from "../permissions";
import { asUser, collect, expectCode, ofType, settle, stopCollectors } from "../testing";
import { appRouter } from "./index";

const OWNER = "u-owner";
const OWNER2 = "u-owner2"; // owns the assign/unassign fixtures — OWNER is at the guild cap
const PEER = "u-peer"; // holds captains like MANAGER — the equal-rank target
const MANAGER = "u-manager"; // holds captains (pos 3, MANAGE_ROLES)
const MEMBER = "u-member"; // membership only — no MANAGE_ROLES
const ADMIN = "u-admin"; // holds eminence (pos 5, ADMINISTRATOR only)
const DRIFTER = "u-drifter"; // never a member

/**
 * A guild with a three-role custom stack under the owner:
 *   captains (3, MANAGE_ROLES — held by MANAGER) > knights (2) > pages (1) > @everyone (0)
 */
async function makeGuildFixture(ownerId: string) {
  const created = await call(appRouter.guild.create, { name: "Role Lab" }, asUser(ownerId));
  const guildId = created.id;
  await seedTestMembership(guildId, MANAGER);
  await seedTestMembership(guildId, MEMBER);
  const captainsId = await seedTestRole({
    guildId,
    name: "captains",
    position: 3,
    permissions: PERMISSIONS.MANAGE_ROLES,
  });
  const knightsId = await seedTestRole({
    guildId,
    name: "knights",
    position: 2,
    permissions: PERMISSIONS.KICK_MEMBERS,
  });
  const pagesId = await seedTestRole({ guildId, name: "pages", position: 1 });
  await seedTestMemberRole(guildId, MANAGER, captainsId);
  return { guildId, captainsId, knightsId, pagesId };
}

/** Extend a fixture guild with an ADMINISTRATOR-only role at position 5, held by ADMIN. */
async function seedAdmin(guildId: string): Promise<string> {
  await seedTestMembership(guildId, ADMIN);
  const eminenceId = await seedTestRole({
    guildId,
    name: "eminence",
    position: 5,
    permissions: PERMISSIONS.ADMINISTRATOR,
  });
  await seedTestMemberRole(guildId, ADMIN, eminenceId);
  return eminenceId;
}

async function rolesOf(guildId: string, as = OWNER) {
  const view = await call(appRouter.guild.get, { guildId }, asUser(as));
  return view.roles;
}

async function memberRoleIds(guildId: string, userId: string, as = OWNER2) {
  const view = await call(appRouter.guild.get, { guildId }, asUser(as));
  return view.members.find((m) => m.userId === userId)?.roleIds ?? [];
}

beforeAll(async () => {
  await seedTestUser({ id: OWNER, username: "alice" });
  await seedTestUser({ id: OWNER2, username: "alice2" });
  await seedTestUser({ id: PEER, username: "peggy" });
  await seedTestUser({ id: MANAGER, username: "bob" });
  await seedTestUser({ id: MEMBER, username: "carol" });
  await seedTestUser({ id: ADMIN, username: "erin" });
  await seedTestUser({ id: DRIFTER, username: "mallory" });
});

afterEach(() => stopCollectors());

describe("role.create", () => {
  let guildId: string;

  beforeAll(async () => {
    ({ guildId } = await makeGuildFixture(OWNER));
  });

  test("a member without MANAGE_ROLES → FORBIDDEN; a non-member too", async () => {
    await expectCode(
      call(appRouter.role.create, { guildId, name: "sneaky" }, asUser(MEMBER)),
      "FORBIDDEN",
    );
    await expectCode(
      call(appRouter.role.create, { guildId, name: "sneaky" }, asUser(DRIFTER)),
      "FORBIDDEN",
    );
  });

  test("inserts at the bottom of the custom stack; existing custom roles shift up", async () => {
    const created = await call(
      appRouter.role.create,
      { guildId, name: "recruits" },
      asUser(MANAGER),
    );
    expect(created).toMatchObject({
      name: "recruits",
      position: 1,
      permissions: 0,
      color: null,
    });

    const roles = await rolesOf(guildId);
    expect(roles.map((role) => [role.name, role.position])).toEqual([
      ["captains", 4],
      ["knights", 3],
      ["pages", 2],
      ["recruits", 1],
      ["everyone", 0],
    ]);
  });

  test("publishes role.changed to every guild member — and nobody else", async () => {
    const memberFeed = collect(MEMBER);
    const drifterFeed = collect(DRIFTER);
    await call(appRouter.role.create, { guildId, name: "squires" }, asUser(OWNER));
    await settle();
    expect(ofType(memberFeed, "role.changed")).toEqual([{ type: "role.changed", guildId }]);
    expect(ofType(drifterFeed, "role.changed")).toEqual([]);
  });
});

describe("role.update", () => {
  let guildId: string;
  let captainsId: string;
  let knightsId: string;
  let pagesId: string;
  let eminenceId: string;

  beforeAll(async () => {
    ({ guildId, captainsId, knightsId, pagesId } = await makeGuildFixture(OWNER));
    eminenceId = await seedAdmin(guildId);
  });

  test("a member without MANAGE_ROLES → FORBIDDEN", async () => {
    await expectCode(
      call(appRouter.role.update, { guildId, roleId: pagesId, name: "renamed" }, asUser(MEMBER)),
      "FORBIDDEN",
    );
  });

  test("rename + recolor a strictly-below role, and role.changed fans out", async () => {
    const memberFeed = collect(MEMBER);
    await call(
      appRouter.role.update,
      { guildId, roleId: knightsId, name: "cavaliers", color: "#ff5555" },
      asUser(MANAGER),
    );
    await settle();
    const roles = await rolesOf(guildId);
    expect(roles.find((role) => role.id === knightsId)).toMatchObject({
      name: "cavaliers",
      color: "#ff5555",
      permissions: PERMISSIONS.KICK_MEMBERS,
    });
    expect(ofType(memberFeed, "role.changed")).toEqual([{ type: "role.changed", guildId }]);
  });

  test("color: null clears the tint", async () => {
    await call(
      appRouter.role.update,
      { guildId, roleId: knightsId, color: null },
      asUser(MANAGER),
    );
    const roles = await rolesOf(guildId);
    expect(roles.find((role) => role.id === knightsId)?.color).toBeNull();
  });

  test("a role at or above the actor's highest → FORBIDDEN", async () => {
    await expectCode(
      call(appRouter.role.update, { guildId, roleId: captainsId, name: "mine" }, asUser(MANAGER)),
      "FORBIDDEN",
    );
    await expectCode(
      call(appRouter.role.update, { guildId, roleId: eminenceId, name: "mine" }, asUser(MANAGER)),
      "FORBIDDEN",
    );
  });

  test("escalation guard: toggling a bit outside the actor's own mask → FORBIDDEN", async () => {
    // MANAGER's mask is MANAGE_ROLES only — granting KICK_MEMBERS would be an escalation…
    await expectCode(
      call(
        appRouter.role.update,
        { guildId, roleId: pagesId, permissions: PERMISSIONS.KICK_MEMBERS },
        asUser(MANAGER),
      ),
      "FORBIDDEN",
    );
    // …and so would REMOVING it from a role that has it (toggling counts both ways).
    await expectCode(
      call(appRouter.role.update, { guildId, roleId: knightsId, permissions: 0 }, asUser(MANAGER)),
      "FORBIDDEN",
    );
  });

  test("escalation guard: bits merely present but untoggled are fine", async () => {
    // knights keeps KICK_MEMBERS (which MANAGER lacks); only MANAGE_ROLES (held) toggles.
    await call(
      appRouter.role.update,
      {
        guildId,
        roleId: knightsId,
        permissions: PERMISSIONS.KICK_MEMBERS | PERMISSIONS.MANAGE_ROLES,
      },
      asUser(MANAGER),
    );
    const roles = await rolesOf(guildId);
    expect(roles.find((role) => role.id === knightsId)?.permissions).toBe(
      PERMISSIONS.KICK_MEMBERS | PERMISSIONS.MANAGE_ROLES,
    );
  });

  test("the owner and ADMINISTRATOR holders skip the escalation guard", async () => {
    await call(
      appRouter.role.update,
      { guildId, roleId: pagesId, permissions: PERMISSIONS.BAN_MEMBERS },
      asUser(OWNER),
    );
    await call(
      appRouter.role.update,
      { guildId, roleId: pagesId, permissions: PERMISSIONS.MUTE_MEMBERS },
      asUser(ADMIN),
    );
    const roles = await rolesOf(guildId);
    expect(roles.find((role) => role.id === pagesId)?.permissions).toBe(
      PERMISSIONS.MUTE_MEMBERS,
    );
  });

  test("ADMINISTRATOR bypasses permission checks but NOT hierarchy", async () => {
    await expectCode(
      call(appRouter.role.update, { guildId, roleId: eminenceId, name: "self" }, asUser(ADMIN)),
      "FORBIDDEN",
    );
  });

  test("@everyone: bits are editable, rename/recolor are BAD_REQUEST", async () => {
    const roles = await rolesOf(guildId);
    const everyone = roles.find((role) => role.isDefault);
    if (!everyone) throw new Error("fixture lost @everyone");

    await call(
      appRouter.role.update,
      { guildId, roleId: everyone.id, permissions: PERMISSIONS.MANAGE_ROLES },
      asUser(MANAGER),
    );
    expect((await rolesOf(guildId)).find((role) => role.isDefault)?.permissions).toBe(
      PERMISSIONS.MANAGE_ROLES,
    );

    await expectCode(
      call(appRouter.role.update, { guildId, roleId: everyone.id, name: "all" }, asUser(OWNER)),
      "BAD_REQUEST",
    );
    await expectCode(
      call(
        appRouter.role.update,
        { guildId, roleId: everyone.id, color: "#ff5555" },
        asUser(OWNER),
      ),
      "BAD_REQUEST",
    );
  });

  test("unknown role, or a role from another guild → NOT_FOUND", async () => {
    await expectCode(
      call(appRouter.role.update, { guildId, roleId: "no-such", name: "x" }, asUser(OWNER)),
      "NOT_FOUND",
    );
    const other = await call(appRouter.guild.create, { name: "Elsewhere" }, asUser(OWNER));
    const foreignRoleId = await seedTestRole({ guildId: other.id, name: "foreign", position: 1 });
    await expectCode(
      call(appRouter.role.update, { guildId, roleId: foreignRoleId, name: "x" }, asUser(OWNER)),
      "NOT_FOUND",
    );
  });

  test("malformed colors are rejected at the input edge", async () => {
    await expectCode(
      call(
        appRouter.role.update,
        { guildId, roleId: pagesId, color: "red" },
        asUser(OWNER),
      ),
      "BAD_REQUEST",
    );
  });
});

describe("role.delete", () => {
  let guildId: string;
  let captainsId: string;
  let pagesId: string;

  beforeAll(async () => {
    ({ guildId, captainsId, pagesId } = await makeGuildFixture(OWNER));
  });

  test("a member without MANAGE_ROLES → FORBIDDEN", async () => {
    await expectCode(
      call(appRouter.role.delete, { guildId, roleId: pagesId }, asUser(MEMBER)),
      "FORBIDDEN",
    );
  });

  test("a role at or above the actor's highest → FORBIDDEN", async () => {
    await expectCode(
      call(appRouter.role.delete, { guildId, roleId: captainsId }, asUser(MANAGER)),
      "FORBIDDEN",
    );
  });

  test("@everyone can't be deleted", async () => {
    const everyone = (await rolesOf(guildId)).find((role) => role.isDefault);
    if (!everyone) throw new Error("fixture lost @everyone");
    await expectCode(
      call(appRouter.role.delete, { guildId, roleId: everyone.id }, asUser(OWNER)),
      "BAD_REQUEST",
    );
  });

  test("deletes a strictly-below role, cascades memberRole rows, fans out role.changed", async () => {
    // MEMBER holds pages — the assignment must die with the role.
    await seedTestMemberRole(guildId, MEMBER, pagesId);
    const memberFeed = collect(MEMBER);

    await call(appRouter.role.delete, { guildId, roleId: pagesId }, asUser(MANAGER));
    await settle();

    const view = await call(appRouter.guild.get, { guildId }, asUser(OWNER));
    expect(view.roles.some((role) => role.id === pagesId)).toBe(false);
    expect(view.members.find((m) => m.userId === MEMBER)?.roleIds).toEqual([]);
    expect(ofType(memberFeed, "role.changed")).toEqual([{ type: "role.changed", guildId }]);
  });

  test("unknown role → NOT_FOUND", async () => {
    await expectCode(
      call(appRouter.role.delete, { guildId, roleId: "no-such" }, asUser(OWNER)),
      "NOT_FOUND",
    );
  });
});

describe("role.reorder", () => {
  let guildId: string;
  let captainsId: string;
  let knightsId: string;
  let pagesId: string;

  beforeAll(async () => {
    ({ guildId, captainsId, knightsId, pagesId } = await makeGuildFixture(OWNER));
  });

  test("a member without MANAGE_ROLES → FORBIDDEN", async () => {
    await expectCode(
      call(
        appRouter.role.reorder,
        { guildId, roleId: pagesId, direction: "up" },
        asUser(MEMBER),
      ),
      "FORBIDDEN",
    );
  });

  test("swaps adjacent positions and fans out role.changed", async () => {
    const memberFeed = collect(MEMBER);
    await call(appRouter.role.reorder, { guildId, roleId: pagesId, direction: "up" }, asUser(MANAGER));
    await settle();
    const roles = await rolesOf(guildId);
    expect(roles.map((role) => [role.name, role.position])).toEqual([
      ["captains", 3],
      ["pages", 2],
      ["knights", 1],
      ["everyone", 0],
    ]);
    expect(ofType(memberFeed, "role.changed")).toEqual([{ type: "role.changed", guildId }]);
  });

  test("the bottom custom role can't move down — @everyone never swaps", async () => {
    await expectCode(
      call(
        appRouter.role.reorder,
        { guildId, roleId: knightsId, direction: "down" },
        asUser(MANAGER),
      ),
      "BAD_REQUEST",
    );
  });

  test("BOTH swapped roles must sit strictly below the actor", async () => {
    // pages (2) is below MANAGER's captains (3) — but moving it up swaps with captains itself.
    await expectCode(
      call(appRouter.role.reorder, { guildId, roleId: pagesId, direction: "up" }, asUser(MANAGER)),
      "FORBIDDEN",
    );
    // And the target role itself must be strictly below too.
    await expectCode(
      call(
        appRouter.role.reorder,
        { guildId, roleId: captainsId, direction: "down" },
        asUser(MANAGER),
      ),
      "FORBIDDEN",
    );
  });

  test("the top custom role can't move up", async () => {
    await expectCode(
      call(
        appRouter.role.reorder,
        { guildId, roleId: captainsId, direction: "up" },
        asUser(OWNER),
      ),
      "BAD_REQUEST",
    );
  });

  test("the owner reorders anything — hierarchy never binds them", async () => {
    await call(
      appRouter.role.reorder,
      { guildId, roleId: captainsId, direction: "down" },
      asUser(OWNER),
    );
    const roles = await rolesOf(guildId);
    expect(roles.map((role) => role.name)).toEqual(["pages", "captains", "knights", "everyone"]);
  });

  test("@everyone is immovable", async () => {
    const everyone = (await rolesOf(guildId)).find((role) => role.isDefault);
    if (!everyone) throw new Error("fixture lost @everyone");
    await expectCode(
      call(appRouter.role.reorder, { guildId, roleId: everyone.id, direction: "up" }, asUser(OWNER)),
      "BAD_REQUEST",
    );
  });

  test("unknown role → NOT_FOUND", async () => {
    await expectCode(
      call(appRouter.role.reorder, { guildId, roleId: "no-such", direction: "up" }, asUser(OWNER)),
      "NOT_FOUND",
    );
  });
});

describe("role.assign", () => {
  let guildId: string;
  let captainsId: string;
  let knightsId: string;
  let pagesId: string;
  let eminenceId: string;

  beforeAll(async () => {
    ({ guildId, captainsId, knightsId, pagesId } = await makeGuildFixture(OWNER2));
    eminenceId = await seedAdmin(guildId);
    await seedTestMembership(guildId, PEER);
    await seedTestMemberRole(guildId, PEER, captainsId);
  });

  test("grants a strictly-below role to a lower-ranked member, fans out member.rolesChanged", async () => {
    const memberFeed = collect(MEMBER);
    const drifterFeed = collect(DRIFTER);
    await call(
      appRouter.role.assign,
      { guildId, userId: MEMBER, roleId: pagesId },
      asUser(MANAGER),
    );
    await settle();

    const view = await call(appRouter.guild.get, { guildId }, asUser(OWNER2));
    expect(view.members.find((m) => m.userId === MEMBER)?.roleIds).toEqual([pagesId]);
    expect(ofType(memberFeed, "member.rolesChanged")).toEqual([
      { type: "member.rolesChanged", guildId, userId: MEMBER },
    ]);
    expect(ofType(drifterFeed, "member.rolesChanged")).toEqual([]);
  });

  test("a member without MANAGE_ROLES → FORBIDDEN; a non-member too", async () => {
    await expectCode(
      call(appRouter.role.assign, { guildId, userId: MEMBER, roleId: knightsId }, asUser(MEMBER)),
      "FORBIDDEN",
    );
    await expectCode(
      call(appRouter.role.assign, { guildId, userId: MEMBER, roleId: knightsId }, asUser(DRIFTER)),
      "FORBIDDEN",
    );
  });

  test("a role at or above the actor's highest → FORBIDDEN", async () => {
    await expectCode(
      call(appRouter.role.assign, { guildId, userId: MEMBER, roleId: captainsId }, asUser(MANAGER)),
      "FORBIDDEN",
    );
    await expectCode(
      call(appRouter.role.assign, { guildId, userId: MEMBER, roleId: eminenceId }, asUser(MANAGER)),
      "FORBIDDEN",
    );
  });

  test("an equal-rank target succeeds — hierarchy binds the role, not the target", async () => {
    await call(appRouter.role.assign, { guildId, userId: PEER, roleId: pagesId }, asUser(MANAGER));
    expect(await memberRoleIds(guildId, PEER)).toContain(pagesId);
  });

  test("self-target succeeds for a strictly-below role", async () => {
    await call(
      appRouter.role.assign,
      { guildId, userId: MANAGER, roleId: pagesId },
      asUser(MANAGER),
    );
    expect(await memberRoleIds(guildId, MANAGER)).toContain(pagesId);
  });

  test("the owner as target succeeds", async () => {
    await call(appRouter.role.assign, { guildId, userId: OWNER2, roleId: pagesId }, asUser(MANAGER));
    expect(await memberRoleIds(guildId, OWNER2)).toContain(pagesId);
  });

  test("the owner assigns a role to themselves", async () => {
    await call(
      appRouter.role.assign,
      { guildId, userId: OWNER2, roleId: knightsId },
      asUser(OWNER2),
    );
    expect(await memberRoleIds(guildId, OWNER2)).toContain(knightsId);
  });

  test("a target who isn't a member → NOT_FOUND", async () => {
    await expectCode(
      call(appRouter.role.assign, { guildId, userId: DRIFTER, roleId: pagesId }, asUser(MANAGER)),
      "NOT_FOUND",
    );
  });

  test("@everyone isn't assignable", async () => {
    const everyone = (await rolesOf(guildId, OWNER2)).find((role) => role.isDefault);
    if (!everyone) throw new Error("fixture lost @everyone");
    await expectCode(
      call(appRouter.role.assign, { guildId, userId: MEMBER, roleId: everyone.id }, asUser(OWNER2)),
      "BAD_REQUEST",
    );
  });

  test("unknown role → NOT_FOUND", async () => {
    await expectCode(
      call(appRouter.role.assign, { guildId, userId: MEMBER, roleId: "no-such" }, asUser(OWNER2)),
      "NOT_FOUND",
    );
  });

  test("ADMINISTRATOR bypasses the permission gate but NOT hierarchy", async () => {
    // ADMIN holds no MANAGE_ROLES bit, yet assigns fine below eminence…
    await call(appRouter.role.assign, { guildId, userId: MEMBER, roleId: knightsId }, asUser(ADMIN));
    const view = await call(appRouter.guild.get, { guildId }, asUser(OWNER2));
    expect(view.members.find((m) => m.userId === MEMBER)?.roleIds).toContain(knightsId);
    // …but can't hand out eminence itself (not strictly below their highest).
    await expectCode(
      call(appRouter.role.assign, { guildId, userId: MEMBER, roleId: eminenceId }, asUser(ADMIN)),
      "FORBIDDEN",
    );
  });

  test("the owner assigns any role to anyone — hierarchy never binds them", async () => {
    await call(appRouter.role.assign, { guildId, userId: PEER, roleId: eminenceId }, asUser(OWNER2));
    const view = await call(appRouter.guild.get, { guildId }, asUser(OWNER2));
    expect(view.members.find((m) => m.userId === PEER)?.roleIds).toContain(eminenceId);
  });

  test("re-granting a held role succeeds without a second fan-out", async () => {
    const memberFeed = collect(MEMBER);
    const result = await call(
      appRouter.role.assign,
      { guildId, userId: MEMBER, roleId: pagesId },
      asUser(MANAGER),
    );
    await settle();
    expect(result).toEqual({ ok: true });
    expect(ofType(memberFeed, "member.rolesChanged")).toEqual([]);
  });
});

describe("role.unassign", () => {
  let guildId: string;
  let captainsId: string;
  let knightsId: string;
  let pagesId: string;

  beforeAll(async () => {
    ({ guildId, captainsId, knightsId, pagesId } = await makeGuildFixture(OWNER2));
    await seedTestMembership(guildId, PEER);
    await seedTestMemberRole(guildId, PEER, captainsId);
    await seedTestMemberRole(guildId, MEMBER, pagesId);
    await seedTestMemberRole(guildId, MEMBER, knightsId);
  });

  test("a member without MANAGE_ROLES → FORBIDDEN", async () => {
    await expectCode(
      call(
        appRouter.role.unassign,
        { guildId, userId: MEMBER, roleId: pagesId },
        asUser(MEMBER),
      ),
      "FORBIDDEN",
    );
  });

  test("revokes a strictly-below role from a lower-ranked member, fans out member.rolesChanged", async () => {
    const memberFeed = collect(MEMBER);
    const drifterFeed = collect(DRIFTER);
    await call(
      appRouter.role.unassign,
      { guildId, userId: MEMBER, roleId: pagesId },
      asUser(MANAGER),
    );
    await settle();

    const view = await call(appRouter.guild.get, { guildId }, asUser(OWNER2));
    expect(view.members.find((m) => m.userId === MEMBER)?.roleIds).toEqual([knightsId]);
    expect(ofType(memberFeed, "member.rolesChanged")).toEqual([
      { type: "member.rolesChanged", guildId, userId: MEMBER },
    ]);
    expect(ofType(drifterFeed, "member.rolesChanged")).toEqual([]);
  });

  test("a role at or above the actor's highest → FORBIDDEN", async () => {
    await expectCode(
      call(
        appRouter.role.unassign,
        { guildId, userId: PEER, roleId: captainsId },
        asUser(MANAGER),
      ),
      "FORBIDDEN",
    );
  });

  test("an equal-rank target succeeds — hierarchy binds the role, not the target", async () => {
    await seedTestMemberRole(guildId, PEER, pagesId);
    await call(appRouter.role.unassign, { guildId, userId: PEER, roleId: pagesId }, asUser(MANAGER));
    expect(await memberRoleIds(guildId, PEER)).not.toContain(pagesId);
  });

  test("self-target succeeds for a strictly-below role", async () => {
    await seedTestMemberRole(guildId, MANAGER, pagesId);
    await call(
      appRouter.role.unassign,
      { guildId, userId: MANAGER, roleId: pagesId },
      asUser(MANAGER),
    );
    expect(await memberRoleIds(guildId, MANAGER)).not.toContain(pagesId);
  });

  test("a member can't shed their own highest role — the role rule still binds", async () => {
    await expectCode(
      call(
        appRouter.role.unassign,
        { guildId, userId: MANAGER, roleId: captainsId },
        asUser(MANAGER),
      ),
      "FORBIDDEN",
    );
  });

  test("the owner unassigns a role from themselves", async () => {
    await seedTestMemberRole(guildId, OWNER2, pagesId);
    await call(
      appRouter.role.unassign,
      { guildId, userId: OWNER2, roleId: pagesId },
      asUser(OWNER2),
    );
    expect(await memberRoleIds(guildId, OWNER2)).not.toContain(pagesId);
  });

  test("a target who isn't a member → NOT_FOUND", async () => {
    await expectCode(
      call(
        appRouter.role.unassign,
        { guildId, userId: DRIFTER, roleId: pagesId },
        asUser(MANAGER),
      ),
      "NOT_FOUND",
    );
  });

  test("@everyone isn't unassignable either", async () => {
    const everyone = (await rolesOf(guildId, OWNER2)).find((role) => role.isDefault);
    if (!everyone) throw new Error("fixture lost @everyone");
    await expectCode(
      call(
        appRouter.role.unassign,
        { guildId, userId: MEMBER, roleId: everyone.id },
        asUser(OWNER2),
      ),
      "BAD_REQUEST",
    );
  });

  test("revoking a role the target doesn't hold succeeds without a fan-out", async () => {
    const memberFeed = collect(MEMBER);
    const result = await call(
      appRouter.role.unassign,
      { guildId, userId: MEMBER, roleId: pagesId },
      asUser(MANAGER),
    );
    await settle();
    expect(result).toEqual({ ok: true });
    expect(ofType(memberFeed, "member.rolesChanged")).toEqual([]);
  });

  test("the owner revokes any role from anyone — hierarchy never binds them", async () => {
    await call(
      appRouter.role.unassign,
      { guildId, userId: PEER, roleId: captainsId },
      asUser(OWNER2),
    );
    const view = await call(appRouter.guild.get, { guildId }, asUser(OWNER2));
    expect(view.members.find((m) => m.userId === PEER)?.roleIds).not.toContain(captainsId);
  });
});

describe("modAction rate limit", () => {
  // A dedicated user: the limiter is keyed per user across guilds, so anyone who mutated
  // roles above has already spent budget.
  const LIMITED = "u-limited";

  test("all six mutations share one 30/60s budget", async () => {
    await seedTestUser({ id: LIMITED, username: "frank" });
    const created = await call(appRouter.guild.create, { name: "Limit Lab" }, asUser(LIMITED));
    const guildId = created.id;
    const role = await call(appRouter.role.create, { guildId, name: "r" }, asUser(LIMITED));

    for (let i = 0; i < 29; i++) {
      await call(
        appRouter.role.update,
        { guildId, roleId: role.id, name: `r${i}` },
        asUser(LIMITED),
      );
    }

    // Budget spent by create + 29 updates — the OTHER four verbs are refused off it.
    await expectCode(
      call(appRouter.role.reorder, { guildId, roleId: role.id, direction: "up" }, asUser(LIMITED)),
      "TOO_MANY_REQUESTS",
    );
    await expectCode(
      call(appRouter.role.delete, { guildId, roleId: role.id }, asUser(LIMITED)),
      "TOO_MANY_REQUESTS",
    );
    await expectCode(
      call(
        appRouter.role.assign,
        { guildId, userId: LIMITED, roleId: role.id },
        asUser(LIMITED),
      ),
      "TOO_MANY_REQUESTS",
    );
    await expectCode(
      call(
        appRouter.role.unassign,
        { guildId, userId: LIMITED, roleId: role.id },
        asUser(LIMITED),
      ),
      "TOO_MANY_REQUESTS",
    );
  });
});
