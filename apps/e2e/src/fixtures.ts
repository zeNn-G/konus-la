/** Shared constants + the ids global-setup provides to the suite. */

export const SERVER_URL = "http://localhost:3100";
export const WEB_URL = "http://localhost:3101";

export const ALICE = {
  email: "alice@e2e.local",
  password: "alice-e2e-password-1",
  name: "Alice",
  username: "alice",
};

export const BOB = {
  email: "bob@e2e.local",
  password: "bob-e2e-password-1",
  name: "Bob",
  username: "bob",
};

export type E2EIds = {
  guildId: string;
  generalId: string;
  alertsId: string;
};

declare module "vitest" {
  interface ProvidedContext {
    e2e: E2EIds;
  }
}
