import { recordAuditEntry } from "@konus-la/db";
import {
  seedTestMembership,
  seedTestMemberRole,
  seedTestRole,
  seedTestUser,
} from "@konus-la/db/testing";
import { call } from "@orpc/server";
import { beforeAll, describe, expect, test } from "vitest";

import { PERMISSIONS } from "../permissions";
import { asNobody, asUser, expectCode } from "../testing";
import { appRouter } from "./index";

const GATE_OWNER = "u-al-gate-owner";
const VIEWER = "u-al-viewer"; // holds a VIEW_AUDIT_LOG role
const MEMBER = "u-al-member"; // membership only
const DRIFTER = "u-al-drifter"; // never a member
const CHAN_OWNER = "u-al-chan-owner";
const ROLE_OWNER = "u-al-role-owner";
const MEM_OWNER = "u-al-mem-owner";
const TARGET = "u-al-target"; // the moderated member
const EXCL_OWNER = "u-al-excl-owner";
const JOINER = "u-al-joiner"; // joins and leaves — never audited
const PAGE_OWNER = "u-al-page-owner";

function listLog(
  guildId: string,
  as: string,
  extra?: { before?: string | null; limit?: number },
) {
  return call(appRouter.auditLog.list, { guildId, ...extra }, asUser(as));
}

beforeAll(async () => {
  await seedTestUser({ id: GATE_OWNER, username: "gate-owner" });
  await seedTestUser({ id: VIEWER, username: "viewer", name: "Vera Viewer" });
  await seedTestUser({ id: MEMBER, username: "member" });
  await seedTestUser({ id: DRIFTER, username: "drifter" });
  await seedTestUser({ id: CHAN_OWNER, username: "chan-owner", name: "Charlie Chan-Owner" });
  await seedTestUser({ id: ROLE_OWNER, username: "role-owner" });
  await seedTestUser({ id: MEM_OWNER, username: "mem-owner" });
  await seedTestUser({ id: TARGET, username: "target", name: "Tara Target" });
  await seedTestUser({ id: EXCL_OWNER, username: "excl-owner" });
  await seedTestUser({ id: JOINER, username: "joiner" });
  await seedTestUser({ id: PAGE_OWNER, username: "page-owner" });
});

describe("auditLog.list access", () => {
  let guildId: string;

  beforeAll(async () => {
    const created = await call(appRouter.guild.create, { name: "Gate Lab" }, asUser(GATE_OWNER));
    guildId = created.id;
    await seedTestMembership(guildId, VIEWER);
    await seedTestMembership(guildId, MEMBER);
    const auditorId = await seedTestRole({
      guildId,
      name: "auditors",
      position: 1,
      permissions: PERMISSIONS.VIEW_AUDIT_LOG,
    });
    await seedTestMemberRole(guildId, VIEWER, auditorId);
  });

  test("no session → UNAUTHORIZED; member without VIEW_AUDIT_LOG and non-member → FORBIDDEN", async () => {
    await expectCode(call(appRouter.auditLog.list, { guildId }, asNobody()), "UNAUTHORIZED");
    await expectCode(listLog(guildId, MEMBER), "FORBIDDEN");
    await expectCode(listLog(guildId, DRIFTER), "FORBIDDEN");
  });

  test("owner and a VIEW_AUDIT_LOG holder may read; entries carry actor display info", async () => {
    const empty = await listLog(guildId, GATE_OWNER);
    expect(empty).toEqual({ entries: [], nextCursor: null });

    await call(appRouter.guild.update, { guildId, name: "Gate Lab 2" }, asUser(GATE_OWNER));

    const page = await listLog(guildId, VIEWER);
    expect(page.entries).toHaveLength(1);
    expect(page.entries[0]).toMatchObject({
      action: "guild.update",
      metadata: { name: ["Gate Lab", "Gate Lab 2"] },
      actor: { id: GATE_OWNER, username: "gate-owner" },
      targetUser: null,
    });
    expect(page.entries[0]?.createdAt).toBeInstanceOf(Date);
  });

  test("limit above 100 → BAD_REQUEST", async () => {
    await expectCode(listLog(guildId, GATE_OWNER, { limit: 101 }), "BAD_REQUEST");
  });
});

describe("channel + invite instrumentation", () => {
  let guildId: string;

  beforeAll(async () => {
    const created = await call(appRouter.guild.create, { name: "Chan Lab" }, asUser(CHAN_OWNER));
    guildId = created.id;
  });

  test("channel create / rename / delete are logged; entries outlive the channel", async () => {
    const channel = await call(
      appRouter.channel.create,
      { guildId, name: "ops", kind: "voice" },
      asUser(CHAN_OWNER),
    );
    await call(
      appRouter.channel.update,
      { guildId, channelId: channel.id, name: "ops-2" },
      asUser(CHAN_OWNER),
    );
    await call(
      appRouter.channel.delete,
      { guildId, channelId: channel.id },
      asUser(CHAN_OWNER),
    );

    const { entries } = await listLog(guildId, CHAN_OWNER);
    // Newest first: delete, update, create.
    expect(
      entries.map((entry) => [entry.action, entry.targetChannelId, entry.metadata]),
    ).toEqual([
      ["channel.delete", channel.id, { name: "ops-2" }],
      ["channel.update", channel.id, { name: ["ops", "ops-2"] }],
      ["channel.create", channel.id, { name: "ops", kind: "voice" }],
    ]);
    expect(entries[0]?.actor).toMatchObject({
      id: CHAN_OWNER,
      username: "chan-owner",
      displayName: "Charlie Chan-Owner",
    });
  });

  test("invite create / revoke are logged with code; expiry is an ISO string or null", async () => {
    const eternal = await call(appRouter.guild.invite.create, { guildId }, asUser(CHAN_OWNER));
    const expiring = await call(
      appRouter.guild.invite.create,
      { guildId, expiresInSeconds: 3600 },
      asUser(CHAN_OWNER),
    );
    await call(
      appRouter.guild.invite.revoke,
      { guildId, inviteId: eternal.id },
      asUser(CHAN_OWNER),
    );

    const { entries } = await listLog(guildId, CHAN_OWNER);
    const [revoke, create2, create1] = entries;
    expect(create1?.action).toBe("invite.create");
    expect(create1?.metadata).toEqual({ inviteId: eternal.id, code: eternal.code, expiresAt: null });
    expect(create2?.metadata).toMatchObject({ inviteId: expiring.id, code: expiring.code });
    expect(typeof create2?.metadata.expiresAt).toBe("string");
    expect(revoke?.action).toBe("invite.revoke");
    expect(revoke?.metadata).toEqual({ inviteId: eternal.id, code: eternal.code });
  });
});

describe("role instrumentation", () => {
  let guildId: string;

  beforeAll(async () => {
    const created = await call(appRouter.guild.create, { name: "Role Lab" }, asUser(ROLE_OWNER));
    guildId = created.id;
    await seedTestMembership(guildId, TARGET);
  });

  test("the full role lifecycle is logged with the spec's metadata shapes", async () => {
    const created = await call(appRouter.role.create, { guildId, name: "scribes" }, asUser(ROLE_OWNER));
    const upper = await call(appRouter.role.create, { guildId, name: "heralds" }, asUser(ROLE_OWNER));

    // Only provided-and-different fields land in `changed` (color untouched here).
    await call(
      appRouter.role.update,
      { guildId, roleId: created.id, name: "scholars", permissions: PERMISSIONS.KICK_MEMBERS },
      asUser(ROLE_OWNER),
    );
    // Creating heralds shifted scribes/scholars up to 2, heralds sits at 1 — swap them.
    await call(
      appRouter.role.reorder,
      { guildId, roleId: upper.id, direction: "up" },
      asUser(ROLE_OWNER),
    );
    await call(
      appRouter.role.assign,
      { guildId, userId: TARGET, roleId: created.id },
      asUser(ROLE_OWNER),
    );
    // Idempotent re-grant: no state change, no audit entry.
    await call(
      appRouter.role.assign,
      { guildId, userId: TARGET, roleId: created.id },
      asUser(ROLE_OWNER),
    );
    await call(
      appRouter.role.unassign,
      { guildId, userId: TARGET, roleId: created.id },
      asUser(ROLE_OWNER),
    );
    await call(appRouter.role.delete, { guildId, roleId: created.id }, asUser(ROLE_OWNER));

    const { entries } = await listLog(guildId, ROLE_OWNER);
    expect(entries.map((entry) => [entry.action, entry.targetUserId, entry.metadata])).toEqual([
      ["role.delete", null, { roleId: created.id, name: "scholars" }],
      ["role.unassign", TARGET, { roleId: created.id, name: "scholars" }],
      ["role.assign", TARGET, { roleId: created.id, name: "scholars" }],
      [
        "role.reorder",
        null,
        { roleId: upper.id, name: "heralds", from: 1, to: 2 },
      ],
      [
        "role.update",
        null,
        {
          roleId: created.id,
          name: "scholars",
          changed: {
            name: ["scribes", "scholars"],
            permissions: [0, PERMISSIONS.KICK_MEMBERS],
          },
        },
      ],
      ["role.create", null, { roleId: upper.id, name: "heralds" }],
      ["role.create", null, { roleId: created.id, name: "scribes" }],
    ]);
    // Assignment entries join the target's display info.
    const assign = entries.find((entry) => entry.action === "role.assign");
    expect(assign?.targetUser).toMatchObject({ id: TARGET, username: "target" });
  });
});

describe("member moderation instrumentation", () => {
  let guildId: string;

  beforeAll(async () => {
    const created = await call(appRouter.guild.create, { name: "Mem Lab" }, asUser(MEM_OWNER));
    guildId = created.id;
    await seedTestMembership(guildId, TARGET);
  });

  test("kick / ban / unban / transferOwnership are logged; entries outlive the membership", async () => {
    await call(appRouter.guild.member.kick, { guildId, userId: TARGET }, asUser(MEM_OWNER));
    await seedTestMembership(guildId, TARGET);
    await call(
      appRouter.guild.member.ban,
      { guildId, userId: TARGET, reason: "spamming" },
      asUser(MEM_OWNER),
    );
    await call(appRouter.guild.member.unban, { guildId, userId: TARGET }, asUser(MEM_OWNER));
    await seedTestMembership(guildId, TARGET);
    await call(
      appRouter.guild.transferOwnership,
      { guildId, newOwnerUserId: TARGET },
      asUser(MEM_OWNER),
    );

    // The kicked-then-banned target's entries survive; the NEW owner reads the log.
    const { entries } = await listLog(guildId, TARGET);
    expect(entries.map((entry) => [entry.action, entry.targetUserId, entry.metadata])).toEqual([
      ["guild.transferOwnership", TARGET, {}],
      ["member.unban", TARGET, {}],
      ["member.ban", TARGET, { reason: "spamming" }],
      ["member.kick", TARGET, {}],
    ]);
    expect(entries[3]?.targetUser).toMatchObject({ id: TARGET, username: "target" });
  });
});

describe("excluded actions", () => {
  test("joins, leaves, and invite consumption never produce entries", async () => {
    const created = await call(appRouter.guild.create, { name: "Excl Lab" }, asUser(EXCL_OWNER));
    const guildId = created.id;

    const invite = await call(appRouter.guild.invite.create, { guildId }, asUser(EXCL_OWNER));
    await call(appRouter.guild.invite.consume, { code: invite.code }, asUser(JOINER));
    await call(appRouter.guild.member.leave, { guildId }, asUser(JOINER));

    const { entries } = await listLog(guildId, EXCL_OWNER);
    // Guild creation, the join, and the leave are all silent — only the mint is logged.
    expect(entries.map((entry) => entry.action)).toEqual(["invite.create"]);
  });
});

describe("pagination", () => {
  let guildId: string;

  beforeAll(async () => {
    const created = await call(appRouter.guild.create, { name: "Page Lab" }, asUser(PAGE_OWNER));
    guildId = created.id;
    for (let i = 0; i < 120; i++) {
      await recordAuditEntry({
        guildId,
        // An actor id with no user row — the forensic record outlives the account.
        actorId: "u-al-ghost",
        action: "member.kick",
        targetUserId: TARGET,
      });
    }
  });

  test("defaults to 50, newest first; a vanished actor still lists with null display info", async () => {
    const page = await listLog(guildId, PAGE_OWNER);
    expect(page.entries).toHaveLength(50);
    expect(page.nextCursor).toBe(page.entries[49]?.id);
    const ids = page.entries.map((entry) => entry.id);
    expect([...ids].sort().reverse()).toEqual(ids);
    expect(page.entries[0]?.actor).toEqual({
      id: "u-al-ghost",
      username: null,
      displayName: null,
      image: null,
    });
  });

  test("cursor pages walk the full log without overlap; max limit is 100", async () => {
    const first = await listLog(guildId, PAGE_OWNER, { limit: 100 });
    expect(first.entries).toHaveLength(100);
    const second = await listLog(guildId, PAGE_OWNER, { before: first.nextCursor, limit: 100 });
    expect(second.entries).toHaveLength(20);
    expect(second.nextCursor).toBeNull();

    const seen = new Set([...first.entries, ...second.entries].map((entry) => entry.id));
    expect(seen.size).toBe(120);
  });
});
