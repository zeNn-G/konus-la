import { type Browser, type BrowserContext, type Page, chromium } from "playwright";
import { afterAll, beforeAll, expect, inject, test } from "vitest";

import { ALICE, BOB, SERVER_URL, WEB_URL } from "./fixtures";

/**
 * The ROADMAP Phase 3 acceptance flow: two browser contexts as two users watch each
 * other's messages, typing, presence, unread/mention badges, edits and deletes arrive
 * live over the realtime socket. Tests run in order and share the seeded stack.
 */

const { guildId, generalId, alertsId } = inject("e2e");

let browser: Browser;
let ctxA: BrowserContext; // Alice — guild owner
let ctxB: BrowserContext; // Bob — member
let pageA: Page;
let pageB: Page;

const composer = (page: Page) => page.getByPlaceholder(/^Message #/);

async function signedInContext(user: { email: string; password: string }) {
  // API sign-in straight into the context's cookie jar — the login form isn't under test.
  const context = await browser.newContext({ baseURL: WEB_URL });
  const response = await context.request.post(`${SERVER_URL}/api/auth/sign-in/email`, {
    data: { email: user.email, password: user.password },
  });
  if (!response.ok()) {
    throw new Error(`sign-in failed for ${user.email} (${response.status()}): ${await response.text()}`);
  }
  return context;
}

async function openChannel(page: Page, channelId: string) {
  await page.goto(`${WEB_URL}/guilds/${guildId}/channels/${channelId}`);
  await composer(page).waitFor({ state: "visible", timeout: 30_000 });
}

async function send(page: Page, content: string) {
  const box = composer(page);
  await box.fill(content);
  await box.press("Enter");
}

beforeAll(async () => {
  browser = await chromium.launch();
  [ctxA, ctxB] = await Promise.all([signedInContext(ALICE), signedInContext(BOB)]);
  // Keep locator-action timeouts below the per-test budget so a stuck step names itself
  // instead of drowning in a whole-test timeout.
  ctxA.setDefaultTimeout(10_000);
  ctxB.setDefaultTimeout(10_000);
  [pageA, pageB] = await Promise.all([ctxA.newPage(), ctxB.newPage()]);
  await Promise.all([openChannel(pageA, generalId), openChannel(pageB, generalId)]);
});

afterAll(async () => {
  await browser?.close();
});

test("a message Bob sends appears live for Alice", async () => {
  await send(pageB, "hello from bob");
  await pageA.getByText("hello from bob").waitFor({ state: "visible", timeout: 10_000 });
});

test("Alice sees Bob typing; the indicator expires after he stops", async () => {
  const box = composer(pageB);
  // The composer throttles typing pings to one per 4s (and the previous test's send just
  // consumed one) — type for longer than the throttle window so a ping definitely fires.
  await box.pressSequentially("thinking out loud, still thinking", { delay: 200 });
  await pageA.getByText("Bob is typing…").waitFor({ state: "visible", timeout: 15_000 });

  await box.fill(""); // stop typing without sending — expiry is the only "stop" signal
  await pageA.getByText("Bob is typing…").waitFor({ state: "hidden", timeout: 15_000 });
});

test("a mention in another channel bolds + badges Alice's sidebar until she opens it", async () => {
  await openChannel(pageA, generalId);
  await openChannel(pageB, alertsId);
  // Trailing text keeps the caret off the @token so Enter sends instead of feeding the
  // mention-autocomplete menu.
  await send(pageB, "ping @alice ok");
  // Send confirmed on Bob's side before asserting anything about Alice's.
  await pageB.getByText("ping @alice ok").waitFor({ state: "visible", timeout: 10_000 });

  const alertsLink = pageA.getByRole("link", { name: /alerts/ });
  await expect
    .poll(async () => (await alertsLink.textContent()) ?? "", { timeout: 10_000 })
    .toContain("1");

  await alertsLink.click();
  await pageA.getByText("ping @alice ok").waitFor({ state: "visible", timeout: 10_000 });
  await expect
    .poll(async () => (await alertsLink.textContent()) ?? "", { timeout: 10_000 })
    .not.toContain("1");
});

test("Bob's edit arrives live with the (edited) marker", async () => {
  await openChannel(pageA, generalId);
  await openChannel(pageB, generalId);
  const row = pageB.locator("div.group", { hasText: "hello from bob" }).last();
  await row.hover();
  await row.getByRole("button", { name: "Edit" }).click();

  // Text-independent locator: the row's hasText filter dies as soon as fill() changes the
  // draft (React mirrors a textarea's value into its text content). Only an in-progress
  // edit puts a textarea inside a message row (the composer lives outside `div.group`).
  const editBox = pageB.locator("div.group textarea");
  await editBox.fill("hello again from bob");
  await editBox.press("Enter");

  await pageA.getByText("hello again from bob").waitFor({ state: "visible", timeout: 10_000 });
  await pageA.getByText("(edited)").waitFor({ state: "visible", timeout: 10_000 });
});

test("Bob's delete removes the message live for Alice", async () => {
  await openChannel(pageA, generalId);
  await openChannel(pageB, generalId);
  const row = pageB.locator("div.group", { hasText: "hello again from bob" }).last();
  await row.hover();
  await row.getByRole("button", { name: "Delete" }).click();

  await pageA.getByText("hello again from bob").waitFor({ state: "hidden", timeout: 10_000 });
});

test("spamming past the send rate limit surfaces an error toast", { timeout: 60_000 }, async () => {
  await openChannel(pageB, generalId);
  const box = composer(pageB);
  const toast = pageB.locator("[data-sonner-toast]");

  let limited = false;
  for (let i = 0; i < 40 && !limited; i++) {
    await box.fill(`spam ${i}`);
    await box.press("Enter");
    // Sent → composer clears; rate-limited → content stays and a toast pops.
    await expect
      .poll(async () => (await toast.count()) > 0 || (await box.inputValue()) === "", {
        timeout: 10_000,
      })
      .toBe(true);
    limited = (await toast.count()) > 0;
  }
  expect(limited).toBe(true);
});

test("Bob's presence dot flips green → grey when he disconnects", { timeout: 40_000 }, async () => {
  await pageA.goto(`${WEB_URL}/guilds/${guildId}`);
  const bobRow = pageA.locator("li", { hasText: "Bob" });
  await bobRow.locator('[aria-label="Online"]').waitFor({ state: "visible", timeout: 15_000 });

  await ctxB.close(); // Bob's socket drops; offline broadcast is debounced ~5s
  await bobRow.locator('[aria-label="Offline"]').waitFor({ state: "visible", timeout: 25_000 });
});
