import {
  assignMemberRole,
  createGuildRole,
  deleteGuildRole,
  getAdjacentGuildRole,
  getEffectivePermissions,
  getGuildRole,
  getHighestRolePosition,
  isGuildMember,
  isGuildOwner,
  listGuildMemberUserIds,
  recordAuditEntry,
  swapGuildRolePositions,
  unassignMemberRole,
  updateGuildRole,
} from "@konus-la/db";
import { ORPCError } from "@orpc/server";
import { z } from "zod";

import { assertActorOutranks, protectedProcedure, requireGuildPermission } from "../index";
import { ALL_PERMISSIONS, hasPermission, PERMISSIONS } from "../permissions";
import { modActionLimiter, perUserRatelimit } from "../ratelimit";
import { publishTo } from "../realtime/publishers";

/** `#rrggbb` only — the wire format `guildRole.color` stores; null clears the tint. */
const roleColor = z
  .string()
  .regex(/^#[0-9a-f]{6}$/i)
  .nullable();

/** A permission bitfield that stays inside the frozen 12-bit catalog. */
const permissionMask = z
  .number()
  .int()
  .nonnegative()
  .refine((bits) => (bits & ~ALL_PERMISSIONS) === 0, "Unknown permission bits.");

/** Invalidate-only fan-out: every member re-reads `guild.get` after any role mutation. */
async function publishRoleChanged(guildId: string): Promise<void> {
  await publishTo(await listGuildMemberUserIds(guildId), { type: "role.changed", guildId });
}

/** The assignment counterpart: same fan-out, but names WHOSE role set changed. */
async function publishMemberRolesChanged(guildId: string, userId: string): Promise<void> {
  await publishTo(await listGuildMemberUserIds(guildId), {
    type: "member.rolesChanged",
    guildId,
    userId,
  });
}

/**
 * Charter hierarchy for role management: non-owners may only touch roles STRICTLY below
 * their own highest (`ADMINISTRATOR` bypasses permission checks, never hierarchy; the
 * owner bypasses everything). Plain FORBIDDEN on a miss, indistinguishable from the gate's.
 */
async function assertRoleStrictlyBelow(
  guildId: string,
  userId: string,
  rolePosition: number,
): Promise<void> {
  if (await isGuildOwner(guildId, userId)) return;
  if (rolePosition >= (await getHighestRolePosition(guildId, userId))) {
    throw new ORPCError("FORBIDDEN");
  }
}

/**
 * The shared mutation preamble: load the role (NOT_FOUND when absent), reject `@everyone`
 * when the verb doesn't apply to it (`rejectDefault` carries the verb-specific message;
 * null = allowed, i.e. a permissions-only update), then enforce strict-below hierarchy.
 */
async function loadRoleForMutation(
  guildId: string,
  roleId: string,
  userId: string,
  rejectDefault: string | null,
) {
  const role = await getGuildRole(guildId, roleId);
  if (!role) throw new ORPCError("NOT_FOUND", { message: "Role not found." });
  if (rejectDefault !== null && role.isDefault) {
    throw new ORPCError("BAD_REQUEST", { message: rejectDefault });
  }
  await assertRoleStrictlyBelow(guildId, userId, role.position);
  return role;
}

/**
 * The shared assign/unassign preamble: the role checks of `loadRoleForMutation` (exists,
 * not `@everyone`, strictly below the actor), then the target checks — must be a member
 * (NOT_FOUND, the kick precedent), must be outranked by the actor (plain FORBIDDEN, which
 * makes equal rank, self-target, and the owner-as-target all fail identically).
 * Returns the loaded role (the audit entry names it).
 */
async function assertCanManageAssignment(
  input: { guildId: string; userId: string; roleId: string },
  actorId: string,
  rejectDefault: string,
) {
  const role = await loadRoleForMutation(input.guildId, input.roleId, actorId, rejectDefault);
  if (!(await isGuildMember(input.guildId, input.userId))) {
    throw new ORPCError("NOT_FOUND", { message: "That user isn't a member." });
  }
  await assertActorOutranks(input.guildId, actorId, input.userId);
  return role;
}

/**
 * Custom-role CRUD (ADR 0008). Every mutation is gated `MANAGE_ROLES` and shares the
 * `modAction` budget with the moderation procedures.
 */
export const roleRouter = {
  /**
   * Create a role at the bottom of the custom stack (position 1, existing custom roles
   * shift up) — always strictly below the creator, so no hierarchy check is needed.
   */
  create: protectedProcedure
    .input(z.object({ guildId: z.string(), name: z.string().trim().min(1).max(100) }))
    .use(requireGuildPermission(PERMISSIONS.MANAGE_ROLES))
    .use(perUserRatelimit("modAction", modActionLimiter))
    .handler(async ({ input, context }) => {
      const created = await createGuildRole(input.guildId, input.name);
      await recordAuditEntry({
        guildId: input.guildId,
        actorId: context.user.id,
        action: "role.create",
        metadata: { roleId: created.id, name: created.name },
      });
      await publishRoleChanged(input.guildId);
      return {
        id: created.id,
        name: created.name,
        color: created.color,
        position: created.position,
        permissions: created.permissions,
      };
    }),

  /**
   * Rename / recolor / re-bit a role strictly below the actor. `@everyone` accepts only
   * `permissions`. Escalation guard: a non-owner, non-`ADMINISTRATOR` actor may only
   * TOGGLE bits their own effective mask contains — bits merely present on the role and
   * left alone are fine (otherwise a `MANAGE_ROLES` holder grants a below-role
   * `ADMINISTRATOR`, assigns it to themselves, and escalates).
   */
  update: protectedProcedure
    .input(
      z
        .object({
          guildId: z.string(),
          roleId: z.string(),
          name: z.string().trim().min(1).max(100).optional(),
          color: roleColor.optional(),
          permissions: permissionMask.optional(),
        })
        .refine(
          (input) =>
            input.name !== undefined ||
            input.color !== undefined ||
            input.permissions !== undefined,
          "Nothing to update.",
        ),
    )
    .use(requireGuildPermission(PERMISSIONS.MANAGE_ROLES))
    .use(perUserRatelimit("modAction", modActionLimiter))
    .handler(async ({ input, context }) => {
      const role = await loadRoleForMutation(
        input.guildId,
        input.roleId,
        context.user.id,
        input.name !== undefined || input.color !== undefined
          ? "@everyone can only have its permissions edited."
          : null,
      );

      if (input.permissions !== undefined) {
        const owner = await isGuildOwner(input.guildId, context.user.id);
        if (!owner) {
          const actorBits = await getEffectivePermissions(input.guildId, context.user.id);
          const toggled = role.permissions ^ input.permissions;
          if (!hasPermission(actorBits, PERMISSIONS.ADMINISTRATOR) && (toggled & ~actorBits) !== 0) {
            throw new ORPCError("FORBIDDEN");
          }
        }
      }

      await updateGuildRole(input.guildId, input.roleId, {
        ...(input.name !== undefined && { name: input.name }),
        ...(input.color !== undefined && { color: input.color }),
        ...(input.permissions !== undefined && { permissions: input.permissions }),
      });
      // Only fields that actually changed land in the diff, as `[old, new]` pairs — and a
      // no-op update (every field re-submitted unchanged) leaves no entry at all, matching
      // the idempotent assign/unassign treatment.
      const changed: Record<string, [unknown, unknown]> = {};
      if (input.name !== undefined && input.name !== role.name) {
        changed.name = [role.name, input.name];
      }
      if (input.color !== undefined && input.color !== role.color) {
        changed.color = [role.color, input.color];
      }
      if (input.permissions !== undefined && input.permissions !== role.permissions) {
        changed.permissions = [role.permissions, input.permissions];
      }
      if (Object.keys(changed).length > 0) {
        await recordAuditEntry({
          guildId: input.guildId,
          actorId: context.user.id,
          action: "role.update",
          metadata: { roleId: role.id, name: input.name ?? role.name, changed },
        });
      }
      await publishRoleChanged(input.guildId);
      return { ok: true } as const;
    }),

  /** Delete a role strictly below the actor; `memberRole` rows cascade. Never `@everyone`. */
  delete: protectedProcedure
    .input(z.object({ guildId: z.string(), roleId: z.string() }))
    .use(requireGuildPermission(PERMISSIONS.MANAGE_ROLES))
    .use(perUserRatelimit("modAction", modActionLimiter))
    .handler(async ({ input, context }) => {
      const role = await loadRoleForMutation(
        input.guildId,
        input.roleId,
        context.user.id,
        "@everyone can't be deleted.",
      );

      await deleteGuildRole(input.guildId, input.roleId);
      await recordAuditEntry({
        guildId: input.guildId,
        actorId: context.user.id,
        action: "role.delete",
        metadata: { roleId: role.id, name: role.name },
      });
      await publishRoleChanged(input.guildId);
      return { ok: true } as const;
    }),

  /**
   * Swap a role with its rank neighbor (▲▼ UX). BOTH swapped roles must sit strictly
   * below the actor — moving your own highest role, or hoisting a below-role past it,
   * is the same hierarchy violation. `@everyone` is pinned and never a swap partner.
   */
  reorder: protectedProcedure
    .input(
      z.object({
        guildId: z.string(),
        roleId: z.string(),
        direction: z.enum(["up", "down"]),
      }),
    )
    .use(requireGuildPermission(PERMISSIONS.MANAGE_ROLES))
    .use(perUserRatelimit("modAction", modActionLimiter))
    .handler(async ({ input, context }) => {
      const role = await loadRoleForMutation(
        input.guildId,
        input.roleId,
        context.user.id,
        "@everyone can't be moved.",
      );

      const neighbor = await getAdjacentGuildRole(input.guildId, role.position, input.direction);
      if (!neighbor) {
        throw new ORPCError("BAD_REQUEST", {
          message: `That role is already at the ${input.direction === "up" ? "top" : "bottom"}.`,
        });
      }
      await assertRoleStrictlyBelow(input.guildId, context.user.id, neighbor.position);

      await swapGuildRolePositions(input.guildId, role, neighbor);
      await recordAuditEntry({
        guildId: input.guildId,
        actorId: context.user.id,
        action: "role.reorder",
        metadata: { roleId: role.id, name: role.name, from: role.position, to: neighbor.position },
      });
      await publishRoleChanged(input.guildId);
      return { ok: true } as const;
    }),

  /**
   * Grant a role to a member. Both charter hierarchy rules apply: the role must sit
   * strictly below the actor's highest AND the actor must outrank the target (equal rank,
   * self-target, and the owner-as-target all fail it). Idempotent — re-granting a held
   * role succeeds without a second fan-out.
   */
  assign: protectedProcedure
    .input(z.object({ guildId: z.string(), userId: z.string(), roleId: z.string() }))
    .use(requireGuildPermission(PERMISSIONS.MANAGE_ROLES))
    .use(perUserRatelimit("modAction", modActionLimiter))
    .handler(async ({ input, context }) => {
      const role = await assertCanManageAssignment(
        input,
        context.user.id,
        "@everyone can't be assigned.",
      );
      const changed = await assignMemberRole(input.guildId, input.userId, input.roleId);
      // An idempotent re-grant changed nothing — no fan-out, and no audit entry either.
      if (changed) {
        await recordAuditEntry({
          guildId: input.guildId,
          actorId: context.user.id,
          action: "role.assign",
          targetUserId: input.userId,
          metadata: { roleId: role.id, name: role.name },
        });
        await publishMemberRolesChanged(input.guildId, input.userId);
      }
      return { ok: true } as const;
    }),

  /** Revoke a role from a member — the exact hierarchy rules of `role.assign`. */
  unassign: protectedProcedure
    .input(z.object({ guildId: z.string(), userId: z.string(), roleId: z.string() }))
    .use(requireGuildPermission(PERMISSIONS.MANAGE_ROLES))
    .use(perUserRatelimit("modAction", modActionLimiter))
    .handler(async ({ input, context }) => {
      const role = await assertCanManageAssignment(
        input,
        context.user.id,
        "@everyone can't be unassigned.",
      );
      const changed = await unassignMemberRole(input.guildId, input.userId, input.roleId);
      if (changed) {
        await recordAuditEntry({
          guildId: input.guildId,
          actorId: context.user.id,
          action: "role.unassign",
          targetUserId: input.userId,
          metadata: { roleId: role.id, name: role.name },
        });
        await publishMemberRolesChanged(input.guildId, input.userId);
      }
      return { ok: true } as const;
    }),
};
