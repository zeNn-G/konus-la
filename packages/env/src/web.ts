import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const env = createEnv({
  clientPrefix: "VITE_",
  client: {
    // Optional: unset (the production image build) means same-origin — the SPA is served
    // by the server itself. Dev sets it as the cross-origin override (web :3001 → :3000).
    VITE_SERVER_URL: z.url().optional(),
  },
  runtimeEnv: (import.meta as any).env,
  emptyStringAsUndefined: true,
});
