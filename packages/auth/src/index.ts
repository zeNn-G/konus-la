import {
  createDb,
  countUsers,
  isUsernameTaken,
  isUsernameAllowed,
  findUsableCode,
  consumeCode,
} from "@konus-la/db";
import * as schema from "@konus-la/db/schema/auth";
import { env } from "@konus-la/env/server";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { admin } from "better-auth/plugins";

const SIGN_UP_PATH = "/sign-up/email";

/** Signup code travels as a header, not a body field: it isn't a `user` column. */
const SIGNUP_CODE_HEADER = "x-signup-code";

type SignupBody = { username?: string };

export function createAuth() {
  const db = createDb();

  return betterAuth({
    database: drizzleAdapter(db, {
      provider: "sqlite",
      schema: schema,
    }),
    trustedOrigins: [env.CORS_ORIGIN],
    emailAndPassword: {
      enabled: true,
    },
    user: {
      additionalFields: {
        // Immutable `@mention` handle. Validated + normalised in the before-hook below.
        username: { type: "string", required: true, input: true },
      },
    },
    databaseHooks: {
      user: {
        create: {
          // First account on a fresh instance becomes the Instance Owner (ADR 0001).
          before: async (userData) => {
            const isFirstUser = (await countUsers()) === 0;
            return { data: { ...userData, role: isFirstUser ? "admin" : "user" } };
          },
        },
        update: {
          // Username is immutable post-signup. Better Auth merges a hook's returned `data`
          // onto the update (it can't remove a field), so we mutate the payload in place to
          // drop `username` before it reaches the adapter — no endpoint can change it.
          before: async (userData) => {
            if (userData && typeof userData === "object" && "username" in userData) {
              delete (userData as Record<string, unknown>).username;
            }
          },
        },
      },
    },
    hooks: {
      // Validate username + signup code BEFORE the account is created.
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== SIGN_UP_PATH) return;
        const body = (ctx.body ?? {}) as SignupBody;

        const username = (body.username ?? "").trim().toLowerCase();
        if (!isUsernameAllowed(username)) {
          throw new APIError("BAD_REQUEST", {
            message: "Username must be 3–20 chars (a–z, 0–9, _) and not reserved.",
          });
        }
        if (await isUsernameTaken(username)) {
          throw new APIError("BAD_REQUEST", { message: "That username is already taken." });
        }
        // Persist the normalised (lowercased) username.
        (ctx.body as SignupBody).username = username;

        // Bootstrap: the very first user needs no code.
        if ((await countUsers()) > 0) {
          const code = ctx.headers?.get(SIGNUP_CODE_HEADER)?.trim();
          if (!code) {
            throw new APIError("BAD_REQUEST", { message: "A signup code is required." });
          }
          if (!(await findUsableCode(code))) {
            throw new APIError("BAD_REQUEST", { message: "Invalid or expired signup code." });
          }
        }
      }),
      // Claim the code AFTER the account exists, so we can record usedByUserId.
      after: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== SIGN_UP_PATH) return;
        const newUserId = ctx.context.newSession?.user?.id;
        const code = ctx.headers?.get(SIGNUP_CODE_HEADER)?.trim();
        if (newUserId && code) {
          await consumeCode(code, newUserId);
        }
      }),
    },
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    advanced: {
      defaultCookieAttributes: {
        // Same-origin deploy (and same-site dev) — Lax keeps CSRF protection and
        // still rides the WS upgrade request. See ROADMAP "Auth + user profile".
        sameSite: "lax",
        // Secure follows the deployment protocol: always on for https (prod), off for
        // plain-http dev — a Secure cookie from http://<LAN IP> is silently dropped by
        // browsers (localhost is exempt), which broke second-device LAN testing (#13).
        secure: env.BETTER_AUTH_URL.startsWith("https"),
        httpOnly: true,
      },
    },
    plugins: [admin()],
  });
}

export const auth = createAuth();
