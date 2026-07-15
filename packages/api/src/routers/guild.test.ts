import { createInvite } from "@konus-la/db";
import {
  seedTestMembership,
  seedTestMemberRole,
  seedTestRole,
  seedTestUser,
} from "@konus-la/db/testing";
import { call } from "@orpc/server";
import { afterEach, beforeAll, describe, expect, test } from "vitest";

import { PERMISSIONS } from "../permissions";
import { asNobody, asUser, collect, expectCode, ofType, stopCollectors, waitFor } from "../testing";
import { appRouter } from "./index";

const OWNER = "u-owner";
const MEMBER = "u-member";
const DRIFTER = "u-drifter"; // joins, gets kicked, banned, rejoins — the moderation target

let guildId: string;
let inviteCode: string;

beforeAll(async () => {
  await seedTestUser({ id: OWNER, username: "alice" });
  await seedTestUser({ id: MEMBER, username: "bob" });
  await seedTestUser({ id: DRIFTER, username: "mallory" });

  const created = await call(appRouter.guild.create, { name: "Guild Testers" }, asUser(OWNER));
  guildId = created.id;
  // Bob joins the canonical way — through an invite (also seeds `inviteCode` for later tests).
  const invite = await call(
    appRouter.guild.invite.create,
    { guildId, expiresInSeconds: null },
    asUser(OWNER),
  );
  inviteCode = invite.code;
  await call(appRouter.guild.invite.consume, { code: inviteCode }, asUser(MEMBER));
});

describe("guild.create / list / get", () => {
  test("creator becomes owner and the guild shows up in their rail", async () => {
    const rail = await call(appRouter.guild.list, undefined, asUser(OWNER));
    expect(rail.map((g) => g.id)).toContain(guildId);

    const view = await call(appRouter.guild.get, { guildId }, asUser(OWNER));
    expect(view.viewer.isOwner).toBe(true);
    expect(view.guild.ownerId).toBe(OWNER);
    expect(view.members.map((m) => m.userId).sort()).toEqual([MEMBER, OWNER]);
  });

  test("members see the roster without the owner flag", async () => {
    const view = await call(appRouter.guild.get, { guildId }, asUser(MEMBER));
    expect(view.viewer.isOwner).toBe(false);
  });

  test("non-members and unknown guilds are indistinguishable → FORBIDDEN", async () => {
    await expectCode(call(appRouter.guild.get, { guildId }, asUser(DRIFTER)), "FORBIDDEN");
    await expectCode(call(appRouter.guild.get, { guildId: "no-such" }, asUser(OWNER)), "FORBIDDEN");
  });

  test("unauthenticated → UNAUTHORIZED", async () => {
    await expectCode(call(appRouter.guild.list, undefined, asNobody()), "UNAUTHORIZED");
  });

  test("the owned-guild cap rejects guild N+1", async () => {
    await seedTestUser({ id: "u-hoarder", username: "hoarder" });
    // Default MAX_GUILDS_PER_USER is 5 (the test env doesn't override it).
    for (let i = 0; i < 5; i++) {
      await call(appRouter.guild.create, { name: `hoard ${i}` }, asUser("u-hoarder"));
    }
    await expectCode(
      call(appRouter.guild.create, { name: "one too many" }, asUser("u-hoarder")),
      "FORBIDDEN",
    );
  });
});

describe("guild.invite", () => {
  test("members without MANAGE_INVITES can't mint or list invites", async () => {
    await expectCode(call(appRouter.guild.invite.create, { guildId }, asUser(MEMBER)), "FORBIDDEN");
    await expectCode(call(appRouter.guild.invite.list, { guildId }, asUser(MEMBER)), "FORBIDDEN");
  });

  test("consume joins once, then becomes an idempotent no-op with a ticking usedCount", async () => {
    const first = await call(appRouter.guild.invite.consume, { code: inviteCode }, asUser(DRIFTER));
    expect(first).toEqual({ guildId, joined: true });

    const again = await call(appRouter.guild.invite.consume, { code: inviteCode }, asUser(DRIFTER));
    expect(again).toEqual({ guildId, joined: false });

    const invites = await call(appRouter.guild.invite.list, { guildId }, asUser(OWNER));
    const minted = invites.find((invite) => invite.code === inviteCode);
    // Bob (beforeAll) + Mallory — the idempotent retry doesn't count.
    expect(minted?.usedCount).toBe(2);
  });

  test("bogus and expired codes → NOT_FOUND", async () => {
    await expectCode(
      call(appRouter.guild.invite.consume, { code: "NOPE" }, asUser(DRIFTER)),
      "NOT_FOUND",
    );

    // The router only accepts future expiries, so mint the already-expired one at the db layer.
    const expired = await createInvite({
      guildId,
      createdByUserId: OWNER,
      expiresAt: new Date(Date.now() - 1_000),
    });
    await expectCode(
      call(appRouter.guild.invite.consume, { code: expired.code }, asUser(DRIFTER)),
      "NOT_FOUND",
    );
  });

  test("revoked invites stop working", async () => {
    const doomed = await call(appRouter.guild.invite.create, { guildId }, asUser(OWNER));
    await expect(
      call(appRouter.guild.invite.revoke, { guildId, inviteId: doomed.id }, asUser(OWNER)),
    ).resolves.toEqual({ ok: true });
    await expectCode(
      call(appRouter.guild.invite.revoke, { guildId, inviteId: doomed.id }, asUser(OWNER)),
      "NOT_FOUND",
    );
    await expectCode(
      call(appRouter.guild.invite.consume, { code: doomed.code }, asUser(DRIFTER)),
      "NOT_FOUND",
    );
  });
});

describe("guild.member moderation", () => {
  test("kick removes the member but lets them rejoin", async () => {
    await expectCode(
      call(appRouter.guild.member.kick, { guildId, userId: DRIFTER }, asUser(MEMBER)),
      "FORBIDDEN",
    );
    // Self-target = owner-target here, and both fail `actorOutranksMember` → plain FORBIDDEN.
    await expectCode(
      call(appRouter.guild.member.kick, { guildId, userId: OWNER }, asUser(OWNER)),
      "FORBIDDEN",
    );

    await expect(
      call(appRouter.guild.member.kick, { guildId, userId: DRIFTER }, asUser(OWNER)),
    ).resolves.toEqual({ ok: true });
    await expectCode(call(appRouter.guild.get, { guildId }, asUser(DRIFTER)), "FORBIDDEN");
    await expectCode(
      call(appRouter.guild.member.kick, { guildId, userId: DRIFTER }, asUser(OWNER)),
      "NOT_FOUND",
    );

    const rejoin = await call(
      appRouter.guild.invite.consume,
      { code: inviteCode },
      asUser(DRIFTER),
    );
    expect(rejoin.joined).toBe(true);
  });

  test("ban drops membership, beats invites, and unban restores access", async () => {
    await expect(
      call(
        appRouter.guild.member.ban,
        { guildId, userId: DRIFTER, reason: "testing bans" },
        asUser(OWNER),
      ),
    ).resolves.toEqual({ ok: true });

    await expectCode(call(appRouter.guild.get, { guildId }, asUser(DRIFTER)), "FORBIDDEN");
    await expectCode(
      call(appRouter.guild.invite.consume, { code: inviteCode }, asUser(DRIFTER)),
      "FORBIDDEN",
    );

    const bans = await call(appRouter.guild.member.banList, { guildId }, asUser(OWNER));
    expect(bans).toMatchObject([{ userId: DRIFTER, username: "mallory", reason: "testing bans" }]);

    await expect(
      call(appRouter.guild.member.unban, { guildId, userId: DRIFTER }, asUser(OWNER)),
    ).resolves.toEqual({ ok: true });
    await expectCode(
      call(appRouter.guild.member.unban, { guildId, userId: DRIFTER }, asUser(OWNER)),
      "NOT_FOUND",
    );

    const rejoin = await call(
      appRouter.guild.invite.consume,
      { code: inviteCode },
      asUser(DRIFTER),
    );
    expect(rejoin.joined).toBe(true);
  });

  test("banning the owner is rejected", async () => {
    await expectCode(
      call(appRouter.guild.member.ban, { guildId, userId: OWNER }, asUser(OWNER)),
      "FORBIDDEN",
    );
  });

  test("members may leave; the owner may not", async () => {
    await expect(call(appRouter.guild.member.leave, { guildId }, asUser(DRIFTER))).resolves.toEqual(
      { ok: true },
    );
    await expectCode(call(appRouter.guild.get, { guildId }, asUser(DRIFTER)), "FORBIDDEN");

    await expectCode(call(appRouter.guild.member.leave, { guildId }, asUser(OWNER)), "FORBIDDEN");
  });
});

/**
 * Delegation (spec #47, ticket #57): every regated gate accepts the matching permission
 * bit, and member-targeted acts additionally require `actorOutranksMember`. Own guild —
 * the shared one above asserts roster contents and is order-coupled.
 */
describe("delegated moderation, invites, and rename", () => {
  const D_OWNER = "u-del-owner";
  const MOD = "u-del-mod"; // kick+ban role, position 2
  const PEER_MOD = "u-del-peer"; // same role — MOD's equal in rank
  const KICKER = "u-del-kicker"; // kick-only role, position 1
  const HOST = "u-del-host"; // invite + guild management role, position 1
  const TARGET = "u-del-target"; // roleless — outranked by everyone with a role

  let delGuildId: string;

  afterEach(() => stopCollectors());

  beforeAll(async () => {
    await seedTestUser({ id: D_OWNER, username: "diana" });
    await seedTestUser({ id: MOD, username: "mora" });
    await seedTestUser({ id: PEER_MOD, username: "pat" });
    await seedTestUser({ id: KICKER, username: "kim" });
    await seedTestUser({ id: HOST, username: "hank" });
    await seedTestUser({ id: TARGET, username: "tess" });

    const created = await call(appRouter.guild.create, { name: "Delegation" }, asUser(D_OWNER));
    delGuildId = created.id;
    for (const id of [MOD, PEER_MOD, KICKER, HOST, TARGET]) {
      await seedTestMembership(delGuildId, id);
    }

    const modRole = await seedTestRole({
      guildId: delGuildId,
      name: "mods",
      position: 2,
      permissions: PERMISSIONS.KICK_MEMBERS | PERMISSIONS.BAN_MEMBERS,
    });
    const kickerRole = await seedTestRole({
      guildId: delGuildId,
      name: "kickers",
      position: 1,
      permissions: PERMISSIONS.KICK_MEMBERS,
    });
    const hostRole = await seedTestRole({
      guildId: delGuildId,
      name: "hosts",
      position: 1,
      permissions: PERMISSIONS.MANAGE_INVITES | PERMISSIONS.MANAGE_GUILD,
    });
    await seedTestMemberRole(delGuildId, MOD, modRole);
    await seedTestMemberRole(delGuildId, PEER_MOD, modRole);
    await seedTestMemberRole(delGuildId, KICKER, kickerRole);
    await seedTestMemberRole(delGuildId, HOST, hostRole);
  });

  test("a MANAGE_INVITES holder mints, lists, and revokes invites", async () => {
    const minted = await call(appRouter.guild.invite.create, { guildId: delGuildId }, asUser(HOST));
    const invites = await call(appRouter.guild.invite.list, { guildId: delGuildId }, asUser(HOST));
    expect(invites.map((invite) => invite.id)).toContain(minted.id);
    await expect(
      call(
        appRouter.guild.invite.revoke,
        { guildId: delGuildId, inviteId: minted.id },
        asUser(HOST),
      ),
    ).resolves.toEqual({ ok: true });
  });

  test("invite bits don't grant moderation: HOST can't kick or ban", async () => {
    await expectCode(
      call(appRouter.guild.member.kick, { guildId: delGuildId, userId: TARGET }, asUser(HOST)),
      "FORBIDDEN",
    );
    await expectCode(
      call(appRouter.guild.member.ban, { guildId: delGuildId, userId: TARGET }, asUser(HOST)),
      "FORBIDDEN",
    );
  });

  test("hierarchy on kick: equal rank, self, and the owner are all FORBIDDEN", async () => {
    await expectCode(
      call(appRouter.guild.member.kick, { guildId: delGuildId, userId: PEER_MOD }, asUser(MOD)),
      "FORBIDDEN",
    );
    await expectCode(
      call(appRouter.guild.member.kick, { guildId: delGuildId, userId: MOD }, asUser(MOD)),
      "FORBIDDEN",
    );
    await expectCode(
      call(appRouter.guild.member.kick, { guildId: delGuildId, userId: D_OWNER }, asUser(MOD)),
      "FORBIDDEN",
    );
  });

  test("KICK_MEMBERS without BAN_MEMBERS can kick downward but never ban", async () => {
    await expectCode(
      call(appRouter.guild.member.ban, { guildId: delGuildId, userId: TARGET }, asUser(KICKER)),
      "FORBIDDEN",
    );
    await expect(
      call(appRouter.guild.member.kick, { guildId: delGuildId, userId: TARGET }, asUser(KICKER)),
    ).resolves.toEqual({ ok: true });
    // Re-seed the target for the ban tests below.
    await seedTestMembership(delGuildId, TARGET);
  });

  test("a BAN_MEMBERS holder bans downward; unban and banList need no hierarchy", async () => {
    await expect(
      call(appRouter.guild.member.ban, { guildId: delGuildId, userId: TARGET }, asUser(MOD)),
    ).resolves.toEqual({ ok: true });

    // KICKER holds no BAN_MEMBERS → the ban list stays owner/mod-only.
    await expectCode(
      call(appRouter.guild.member.banList, { guildId: delGuildId }, asUser(KICKER)),
      "FORBIDDEN",
    );
    const bans = await call(appRouter.guild.member.banList, { guildId: delGuildId }, asUser(MOD));
    expect(bans.map((ban) => ban.userId)).toContain(TARGET);

    await expectCode(
      call(appRouter.guild.member.unban, { guildId: delGuildId, userId: TARGET }, asUser(KICKER)),
      "FORBIDDEN",
    );
    // PEER_MOD unbans a user banned by MOD — no member left to outrank.
    await expect(
      call(appRouter.guild.member.unban, { guildId: delGuildId, userId: TARGET }, asUser(PEER_MOD)),
    ).resolves.toEqual({ ok: true });
    await seedTestMembership(delGuildId, TARGET);
  });

  test("equal-rank ban → FORBIDDEN", async () => {
    await expectCode(
      call(appRouter.guild.member.ban, { guildId: delGuildId, userId: PEER_MOD }, asUser(MOD)),
      "FORBIDDEN",
    );
  });

  test("guild.update renames for MANAGE_GUILD holders and publishes guild.updated", async () => {
    const observer = collect(TARGET);
    await expect(
      call(appRouter.guild.update, { guildId: delGuildId, name: "Delegation HQ" }, asUser(HOST)),
    ).resolves.toEqual({ ok: true });

    const view = await call(appRouter.guild.get, { guildId: delGuildId }, asUser(HOST));
    expect(view.guild.name).toBe("Delegation HQ");

    await waitFor(
      () => ofType(observer, "guild.updated").some((event) => event.guildId === delGuildId),
      "guild.updated fan-out",
    );
  });

  test("guild.update without MANAGE_GUILD → FORBIDDEN; non-members no-peek", async () => {
    await expectCode(
      call(appRouter.guild.update, { guildId: delGuildId, name: "hax" }, asUser(MOD)),
      "FORBIDDEN",
    );
    await expectCode(
      call(appRouter.guild.update, { guildId: delGuildId, name: "hax" }, asUser("u-drifter")),
      "FORBIDDEN",
    );
  });

  test("guild.update rejects blank names", async () => {
    await expectCode(
      call(appRouter.guild.update, { guildId: delGuildId, name: "   " }, asUser(D_OWNER)),
      "BAD_REQUEST",
    );
  });
});

// Last on purpose: these tests change and then destroy the shared guild.
describe("guild.transferOwnership / delete", () => {
  test("transfer requires an existing member (and not yourself)", async () => {
    await expectCode(
      call(appRouter.guild.transferOwnership, { guildId, newOwnerUserId: OWNER }, asUser(OWNER)),
      "BAD_REQUEST",
    );
    await expectCode(
      call(
        appRouter.guild.transferOwnership,
        { guildId, newOwnerUserId: DRIFTER }, // left the guild above
        asUser(OWNER),
      ),
      "BAD_REQUEST",
    );
    await expectCode(
      call(appRouter.guild.transferOwnership, { guildId, newOwnerUserId: MEMBER }, asUser(MEMBER)),
      "FORBIDDEN",
    );
  });

  test("transfer flips the owner flag; the old owner stays a member", async () => {
    await expect(
      call(appRouter.guild.transferOwnership, { guildId, newOwnerUserId: MEMBER }, asUser(OWNER)),
    ).resolves.toEqual({ ok: true });

    const asBob = await call(appRouter.guild.get, { guildId }, asUser(MEMBER));
    expect(asBob.viewer.isOwner).toBe(true);
    const asAlice = await call(appRouter.guild.get, { guildId }, asUser(OWNER));
    expect(asAlice.viewer.isOwner).toBe(false);
  });

  test("only the (new) owner can delete; the guild then vanishes for everyone", async () => {
    await expectCode(call(appRouter.guild.delete, { guildId }, asUser(OWNER)), "FORBIDDEN");

    await expect(call(appRouter.guild.delete, { guildId }, asUser(MEMBER))).resolves.toEqual({
      ok: true,
    });

    const rail = await call(appRouter.guild.list, undefined, asUser(MEMBER));
    expect(rail.map((g) => g.id)).not.toContain(guildId);
    await expectCode(call(appRouter.guild.get, { guildId }, asUser(MEMBER)), "FORBIDDEN");
  });
});
