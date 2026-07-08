import { createInvite } from "@konus-la/db";
import { seedTestUser } from "@konus-la/db/testing";
import { call } from "@orpc/server";
import { beforeAll, describe, expect, test } from "vitest";

import { asNobody, asUser, expectCode } from "../testing";
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
  test("only the owner mints and lists invites", async () => {
    await expectCode(
      call(appRouter.guild.invite.create, { guildId }, asUser(MEMBER)),
      "FORBIDDEN",
    );
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
    await expectCode(
      call(appRouter.guild.member.kick, { guildId, userId: OWNER }, asUser(OWNER)),
      "BAD_REQUEST",
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
      "BAD_REQUEST",
    );
  });

  test("members may leave; the owner may not", async () => {
    await expect(
      call(appRouter.guild.member.leave, { guildId }, asUser(DRIFTER)),
    ).resolves.toEqual({ ok: true });
    await expectCode(call(appRouter.guild.get, { guildId }, asUser(DRIFTER)), "FORBIDDEN");

    await expectCode(call(appRouter.guild.member.leave, { guildId }, asUser(OWNER)), "FORBIDDEN");
  });
});

// Last on purpose: these tests change and then destroy the shared guild.
describe("guild.transferOwnership / delete", () => {
  test("transfer requires an existing member (and not yourself)", async () => {
    await expectCode(
      call(
        appRouter.guild.transferOwnership,
        { guildId, newOwnerUserId: OWNER },
        asUser(OWNER),
      ),
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
