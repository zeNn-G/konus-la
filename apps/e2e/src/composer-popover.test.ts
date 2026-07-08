import { type Browser, type BrowserContext, type Page, chromium } from "playwright";
import { afterAll, beforeAll, expect, inject, test } from "vitest";

import { ALICE, SERVER_URL, WEB_URL } from "./fixtures";

/**
 * The composer's caret-anchored suggestion popovers: `@`-mention and `:`-emoji
 * autocompletes open at the token's trigger char, never steal focus from the
 * textarea, and insert on Enter. Single user, no realtime assertions.
 */

const { guildId, generalId } = inject("e2e");

let browser: Browser;
let ctx: BrowserContext;
let page: Page;

const composer = (page: Page) => page.getByPlaceholder(/^Message #/);
const popover = (page: Page) => page.locator('[data-slot="popover-content"]');

beforeAll(async () => {
  browser = await chromium.launch();
  ctx = await browser.newContext({ baseURL: WEB_URL });
  const response = await ctx.request.post(`${SERVER_URL}/api/auth/sign-in/email`, {
    data: { email: ALICE.email, password: ALICE.password },
  });
  if (!response.ok()) {
    throw new Error(`sign-in failed (${response.status()}): ${await response.text()}`);
  }
  ctx.setDefaultTimeout(10_000);
  page = await ctx.newPage();
  await page.goto(`${WEB_URL}/guilds/${guildId}/channels/${generalId}`);
  await composer(page).waitFor({ state: "visible", timeout: 30_000 });
});

afterAll(async () => {
  await browser?.close();
});

test("the mention popover opens at the @ and follows the token's position", async () => {
  const box = composer(page);
  // Alice mentions Bob — the member list excludes the signed-in user.
  await box.fill("@b");
  await popover(page).getByText("@bob").waitFor({ state: "visible" });

  // Focus stays in the textarea — the popup must never trap the keyboard.
  expect(await box.evaluate((el) => el.ownerDocument.activeElement === el)).toBe(true);

  const near = await popover(page).boundingBox();
  const textareaBox = await box.boundingBox();
  if (!near || !textareaBox) throw new Error("missing bounding boxes");
  // Anchored above the token's line, not spanning the composer.
  expect(near.y + near.height).toBeLessThanOrEqual(textareaBox.y + 24);
  expect(near.width).toBeLessThan(textareaBox.width);

  // A longer prefix moves the @ right — the popover moves with it (caret anchoring).
  await box.fill("hey hey hey hey @b");
  await popover(page).getByText("@bob").waitFor({ state: "visible" });
  const far = await popover(page).boundingBox();
  if (!far) throw new Error("missing bounding box");
  expect(far.x).toBeGreaterThan(near.x + 20);
});

test("Enter inserts the highlighted mention and closes the popover", async () => {
  const box = composer(page);
  await box.press("Enter");
  await expect.poll(() => box.inputValue()).toBe("hey hey hey hey @bob ");
  await popover(page).waitFor({ state: "hidden" });
});

test("Escape dismisses without touching the draft", async () => {
  const box = composer(page);
  await box.fill("@b");
  await popover(page).waitFor({ state: "visible" });
  await box.press("Escape");
  await popover(page).waitFor({ state: "hidden" });
  expect(await box.inputValue()).toBe("@b");
});

test("the emoji shortcode popover inserts unicode on Enter", async () => {
  const box = composer(page);
  // The shortcode dataset loads at browser idle; the popover appears once it lands.
  await box.fill(":joy");
  await popover(page).waitFor({ state: "visible", timeout: 15_000 });
  await box.press("Enter");
  await popover(page).waitFor({ state: "hidden" });
  expect(await box.inputValue()).toMatch(/\p{Extended_Pictographic}/u);
});

test("closing-colon conversion still replaces the shortcode inline", async () => {
  const box = composer(page);
  await box.fill(":skull:");
  await expect.poll(() => box.inputValue()).toContain("💀");
});
