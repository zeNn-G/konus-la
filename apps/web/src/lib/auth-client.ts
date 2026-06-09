import type { auth } from "@konus-la/auth";
import { env } from "@konus-la/env/web";
import { adminClient, inferAdditionalFields } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient({
  baseURL: env.VITE_SERVER_URL,
  plugins: [adminClient(), inferAdditionalFields<typeof auth>()],
});
