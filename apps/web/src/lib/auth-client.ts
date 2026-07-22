import type { auth } from "@konus-la/auth";
import { adminClient, inferAdditionalFields } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

import { serverOrigin } from "@/lib/server-url";

export const authClient = createAuthClient({
  baseURL: serverOrigin,
  plugins: [adminClient(), inferAdditionalFields<typeof auth>()],
});
