import { describe, expect, test } from "vitest";

import { ALL_PERMISSIONS, hasPermission, PERMISSIONS } from "./permissions";

describe("PERMISSIONS catalog", () => {
  test("bit order matches the frozen spec table (bits 0–11)", () => {
    // Literal masks from the Phase 6 spec's catalog table — NOT recomputed via 1 << n,
    // so a reordering of the source is caught rather than mirrored.
    expect(PERMISSIONS).toEqual({
      ADMINISTRATOR: 1,
      MANAGE_GUILD: 2,
      MANAGE_ROLES: 4,
      MANAGE_CHANNELS: 8,
      MANAGE_INVITES: 16,
      KICK_MEMBERS: 32,
      BAN_MEMBERS: 64,
      MANAGE_MESSAGES: 128,
      MUTE_MEMBERS: 256,
      MOVE_MEMBERS: 512,
      VIEW_AUDIT_LOG: 1024,
      MANAGE_REPORTS: 2048,
    });
  });

  test("ALL_PERMISSIONS is exactly the 12 catalog bits", () => {
    expect(ALL_PERMISSIONS).toBe(4095);
  });
});

describe("hasPermission", () => {
  test("true only when the queried bit is in the mask", () => {
    const bits = PERMISSIONS.MANAGE_GUILD | PERMISSIONS.KICK_MEMBERS;
    expect(hasPermission(bits, PERMISSIONS.MANAGE_GUILD)).toBe(true);
    expect(hasPermission(bits, PERMISSIONS.KICK_MEMBERS)).toBe(true);
    expect(hasPermission(bits, PERMISSIONS.BAN_MEMBERS)).toBe(false);
  });

  test("an empty mask grants nothing; a full mask grants everything", () => {
    for (const bit of Object.values(PERMISSIONS)) {
      expect(hasPermission(0, bit)).toBe(false);
      expect(hasPermission(ALL_PERMISSIONS, bit)).toBe(true);
    }
  });

  test("is a plain bit test — ADMINISTRATOR in the mask does not imply other bits", () => {
    // The ADMINISTRATOR bypass lives server-side (middleware + resolved viewer mask),
    // never in this shared helper.
    expect(hasPermission(PERMISSIONS.ADMINISTRATOR, PERMISSIONS.MANAGE_GUILD)).toBe(false);
  });
});
