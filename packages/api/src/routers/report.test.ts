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
import { asUser, collect, expectCode, ofType, settle, stopCollectors, waitFor } from "../testing";
import { appRouter } from "./index";

const OWNER = "u-report-owner";
const MOD = "u-report-mod"; // holds a MANAGE_REPORTS role
const MEMBER = "u-report-member"; // membership only — the reporter
const AUTHOR = "u-report-author"; // membership only — writes the reported messages

let guildId: string;
let channelId: string;

afterEach(() => stopCollectors());

beforeAll(async () => {
  await seedTestUser({ id: OWNER, username: "report-owner" });
  await seedTestUser({ id: MOD, username: "report-mod" });
  await seedTestUser({ id: MEMBER, username: "report-member" });
  await seedTestUser({ id: AUTHOR, username: "report-author" });

  const created = await createGuildWithOwner({ name: "Report Lab", ownerUserId: OWNER });
  guildId = created.id;
  await seedTestMembership(guildId, MOD);
  await seedTestMembership(guildId, MEMBER);
  await seedTestMembership(guildId, AUTHOR);
  const modRoleId = await seedTestRole({
    guildId,
    name: "report-mods",
    position: 1,
    permissions: PERMISSIONS.MANAGE_REPORTS,
  });
  await seedTestMemberRole(guildId, MOD, modRoleId);

  channelId = (await createChannel({ guildId, name: "reported", kind: "text" })).id;
});

/** Post as `authorId` and hand back the created message. */
async function post(content: string, authorId = AUTHOR) {
  return call(appRouter.chat.sendMessage, { channelId, content }, asUser(authorId));
}

describe("report.create + report.list", () => {
  test("a member reports a message; a MANAGE_REPORTS holder lists it with the snapshot, reporter, and no resolution", async () => {
    const message = await post("please look at this");

    await expect(
      call(
        appRouter.report.create,
        { messageId: message.id, reason: "harassment" },
        asUser(MEMBER),
      ),
    ).resolves.toEqual({ ok: true });

    const reports = await call(appRouter.report.list, { guildId }, asUser(MOD));
    const row = reports.find((r) => r.messageId === message.id);
    expect(row).toMatchObject({
      channelId,
      messageId: message.id,
      messageContent: "please look at this",
      reason: "harassment",
      messageAuthor: { id: AUTHOR, username: "report-author" },
      reporter: { id: MEMBER, username: "report-member" },
      resolvedAt: null,
      resolvedBy: null,
    });
  });

  test("list is newest-first; the owner may list without a MANAGE_REPORTS role", async () => {
    const first = await post("older offence");
    const second = await post("newer offence");
    await call(appRouter.report.create, { messageId: first.id, reason: "spam" }, asUser(MEMBER));
    await call(appRouter.report.create, { messageId: second.id, reason: "spam" }, asUser(MEMBER));

    const reports = await call(appRouter.report.list, { guildId }, asUser(OWNER));
    const firstIndex = reports.findIndex((r) => r.messageId === first.id);
    const secondIndex = reports.findIndex((r) => r.messageId === second.id);
    expect(secondIndex).toBeGreaterThanOrEqual(0);
    expect(secondIndex).toBeLessThan(firstIndex);
  });

  test("a plain member may not list reports → FORBIDDEN", async () => {
    await expectCode(call(appRouter.report.list, { guildId }, asUser(MEMBER)), "FORBIDDEN");
  });
});

describe("report.create denials", () => {
  test("a DM message is not reportable → FORBIDDEN, even by a participant", async () => {
    const dmChannelId = await seedTestDmChannel({
      isGroup: false,
      participantIds: [MEMBER, AUTHOR],
    });
    const message = await call(
      appRouter.chat.sendMessage,
      { channelId: dmChannelId, content: "dm content" },
      asUser(AUTHOR),
    );
    await expectCode(
      call(appRouter.report.create, { messageId: message.id, reason: "rude" }, asUser(MEMBER)),
      "FORBIDDEN",
    );
  });

  test("a non-member of the guild → FORBIDDEN; unknown message → the same FORBIDDEN", async () => {
    await seedTestUser({ id: "u-report-outsider", username: "report-outsider" });
    const message = await post("visible only inside");
    await expectCode(
      call(
        appRouter.report.create,
        { messageId: message.id, reason: "peeking" },
        asUser("u-report-outsider"),
      ),
      "FORBIDDEN",
    );
    await expectCode(
      call(appRouter.report.create, { messageId: "missing", reason: "ghost" }, asUser(MEMBER)),
      "FORBIDDEN",
    );
  });

  test("reason is required, 1–500 chars after trimming → BAD_REQUEST outside that", async () => {
    const message = await post("validation target");
    await expectCode(
      call(appRouter.report.create, { messageId: message.id, reason: "   " }, asUser(MEMBER)),
      "BAD_REQUEST",
    );
    await expectCode(
      call(
        appRouter.report.create,
        { messageId: message.id, reason: "r".repeat(501) },
        asUser(MEMBER),
      ),
      "BAD_REQUEST",
    );
  });
});

describe("report survives message deletion", () => {
  test("hard-deleting the reported message keeps the snapshot row, messageId gone null", async () => {
    const message = await post("soon to vanish");
    await call(
      appRouter.report.create,
      { messageId: message.id, reason: "delete-proof" },
      asUser(MEMBER),
    );
    await call(appRouter.chat.deleteMessage, { messageId: message.id }, asUser(AUTHOR));

    const reports = await call(appRouter.report.list, { guildId }, asUser(MOD));
    const row = reports.find((r) => r.reason === "delete-proof");
    expect(row).toMatchObject({
      messageId: null,
      messageContent: "soon to vanish",
      messageAuthor: { id: AUTHOR, username: "report-author" },
    });
  });
});

describe("report.unresolvedCount + report.resolve", () => {
  test("resolve marks the report (resolvedAt/resolvedBy), decrements the count, and audits report.resolve", async () => {
    const message = await post("countable offence");
    await call(
      appRouter.report.create,
      { messageId: message.id, reason: "count-me" },
      asUser(MEMBER),
    );
    const before = await call(appRouter.report.unresolvedCount, { guildId }, asUser(MOD));

    const reports = await call(appRouter.report.list, { guildId }, asUser(MOD));
    const row = reports.find((r) => r.reason === "count-me");
    if (!row) throw new Error("report row missing");
    await expect(
      call(appRouter.report.resolve, { guildId, reportId: row.id }, asUser(MOD)),
    ).resolves.toEqual({ ok: true });

    const after = await call(appRouter.report.unresolvedCount, { guildId }, asUser(MOD));
    expect(after.count).toBe(before.count - 1);

    const resolved = await call(appRouter.report.list, { guildId }, asUser(MOD));
    expect(resolved.find((r) => r.id === row.id)).toMatchObject({
      resolvedBy: { id: MOD, username: "report-mod" },
    });
    expect(resolved.find((r) => r.id === row.id)?.resolvedAt).toBeInstanceOf(Date);

    const page = await call(appRouter.auditLog.list, { guildId }, asUser(OWNER));
    expect(
      page.entries.find(
        (e) => e.action === "report.resolve" && e.metadata.reportId === row.id,
      ),
    ).toMatchObject({ actor: { id: MOD } });
  });

  test("resolve is a mark only — the reported message is untouched", async () => {
    const message = await post("still standing");
    await call(
      appRouter.report.create,
      { messageId: message.id, reason: "mark-only" },
      asUser(MEMBER),
    );
    const reports = await call(appRouter.report.list, { guildId }, asUser(MOD));
    const row = reports.find((r) => r.reason === "mark-only");
    if (!row) throw new Error("report row missing");
    await call(appRouter.report.resolve, { guildId, reportId: row.id }, asUser(MOD));

    const page = await call(appRouter.chat.history, { channelId }, asUser(MEMBER));
    expect(page.messages.find((m) => m.id === message.id)).toBeDefined();
  });

  test("resolving an already-resolved report is an idempotent no-op: mark and audit unchanged", async () => {
    const message = await post("double resolve");
    await call(
      appRouter.report.create,
      { messageId: message.id, reason: "twice" },
      asUser(MEMBER),
    );
    let reports = await call(appRouter.report.list, { guildId }, asUser(MOD));
    const row = reports.find((r) => r.reason === "twice");
    if (!row) throw new Error("report row missing");

    await call(appRouter.report.resolve, { guildId, reportId: row.id }, asUser(MOD));
    await expect(
      call(appRouter.report.resolve, { guildId, reportId: row.id }, asUser(OWNER)),
    ).resolves.toEqual({ ok: true });

    reports = await call(appRouter.report.list, { guildId }, asUser(MOD));
    expect(reports.find((r) => r.id === row.id)?.resolvedBy).toMatchObject({ id: MOD });

    const page = await call(appRouter.auditLog.list, { guildId }, asUser(OWNER));
    const entries = page.entries.filter(
      (e) => e.action === "report.resolve" && e.metadata.reportId === row.id,
    );
    expect(entries).toHaveLength(1);
  });

  test("a reportId from another guild does not ride this guild's gate → NOT_FOUND", async () => {
    const foreign = await createGuildWithOwner({ name: "Foreign", ownerUserId: MEMBER });
    const foreignChannelId = (
      await createChannel({ guildId: foreign.id, name: "foreign-scene", kind: "text" })
    ).id;
    const message = await call(
      appRouter.chat.sendMessage,
      { channelId: foreignChannelId, content: "foreign offence" },
      asUser(MEMBER),
    );
    await call(
      appRouter.report.create,
      { messageId: message.id, reason: "foreign" },
      asUser(MEMBER),
    );
    const foreignReports = await call(
      appRouter.report.list,
      { guildId: foreign.id },
      asUser(MEMBER),
    );
    const row = foreignReports.find((r) => r.reason === "foreign");
    if (!row) throw new Error("report row missing");

    await expectCode(
      call(appRouter.report.resolve, { guildId, reportId: row.id }, asUser(MOD)),
      "NOT_FOUND",
    );
  });

  test("unresolvedCount and resolve are gated MANAGE_REPORTS → plain member FORBIDDEN", async () => {
    await expectCode(
      call(appRouter.report.unresolvedCount, { guildId }, asUser(MEMBER)),
      "FORBIDDEN",
    );
    await expectCode(
      call(appRouter.report.resolve, { guildId, reportId: "whatever" }, asUser(MEMBER)),
      "FORBIDDEN",
    );
  });

  test("report.changed fires on create AND resolve — to the owner, ADMINISTRATOR holders, and MANAGE_REPORTS holders, never to plain members", async () => {
    await seedTestUser({ id: "u-report-admin", username: "report-admin" });
    await seedTestMembership(guildId, "u-report-admin");
    const adminRoleId = await seedTestRole({
      guildId,
      name: "report-admins",
      position: 2,
      permissions: PERMISSIONS.ADMINISTRATOR,
    });
    await seedTestMemberRole(guildId, "u-report-admin", adminRoleId);

    const ownerTab = collect(OWNER);
    const modTab = collect(MOD);
    const adminTab = collect("u-report-admin");
    const memberTab = collect(MEMBER);

    const message = await post("event bait");
    await call(appRouter.report.create, { messageId: message.id, reason: "events" }, asUser(AUTHOR));
    await waitFor(
      () => ofType(ownerTab, "report.changed").some((e) => e.guildId === guildId),
      "report.changed to owner on create",
    );
    await waitFor(
      () => ofType(modTab, "report.changed").length > 0,
      "report.changed to MANAGE_REPORTS holder on create",
    );
    await waitFor(
      () => ofType(adminTab, "report.changed").length > 0,
      "report.changed to ADMINISTRATOR holder on create",
    );

    const reports = await call(appRouter.report.list, { guildId }, asUser(MOD));
    const row = reports.find((r) => r.reason === "events");
    if (!row) throw new Error("report row missing");
    await call(appRouter.report.resolve, { guildId, reportId: row.id }, asUser(MOD));
    await waitFor(
      () => ofType(ownerTab, "report.changed").length >= 2,
      "report.changed to owner on resolve",
    );

    await settle();
    expect(ofType(memberTab, "report.changed")).toHaveLength(0);
  });

  test("list filters by resolution state when asked", async () => {
    const unresolvedOnly = await call(
      appRouter.report.list,
      { guildId, resolved: false },
      asUser(MOD),
    );
    expect(unresolvedOnly.every((r) => r.resolvedAt === null)).toBe(true);
    const resolvedOnly = await call(
      appRouter.report.list,
      { guildId, resolved: true },
      asUser(MOD),
    );
    expect(resolvedOnly.every((r) => r.resolvedAt !== null)).toBe(true);
    expect(resolvedOnly.length).toBeGreaterThan(0);
  });
});

describe("reportCreate rate limit", () => {
  test("the 11th report within an hour → TOO_MANY_REQUESTS", async () => {
    await seedTestUser({ id: "u-report-spammer", username: "report-spammer" });
    await seedTestMembership(guildId, "u-report-spammer");
    const message = await post("spam magnet");

    for (let i = 0; i < 10; i++) {
      await call(
        appRouter.report.create,
        { messageId: message.id, reason: `budget ${i}` },
        asUser("u-report-spammer"),
      );
    }
    await expectCode(
      call(
        appRouter.report.create,
        { messageId: message.id, reason: "over budget" },
        asUser("u-report-spammer"),
      ),
      "TOO_MANY_REQUESTS",
    );
  });
});
