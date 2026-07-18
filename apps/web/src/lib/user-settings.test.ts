import { beforeEach, describe, expect, test } from "vitest";

import { useUserSettings } from "./user-settings";

/**
 * The dialog-trigger seam (#84): open state + active section live in a module store so
 * non-React call sites (the deck gear, the device-fallback toast action) can open the
 * dialog at a section without prop-drilling. All access below goes through the store's
 * public API — the same calls those sites make.
 */

describe("user-settings store", () => {
  beforeEach(() => {
    useUserSettings.getState().close();
  });

  test("starts closed at Profile", () => {
    expect(useUserSettings.getState().open).toBe(false);
    expect(useUserSettings.getState().section).toBe("profile");
  });

  test("openAt opens the dialog at the named section from a non-React call site", () => {
    useUserSettings.getState().openAt("bans");
    expect(useUserSettings.getState().open).toBe(true);
    expect(useUserSettings.getState().section).toBe("bans");
  });

  test("openAt('voice') is the deck-gear / fallback-toast target (#85)", () => {
    useUserSettings.getState().openAt("voice");
    expect(useUserSettings.getState().open).toBe(true);
    expect(useUserSettings.getState().section).toBe("voice");
  });

  test("close dismisses; reopening lands on the section the trigger names", () => {
    useUserSettings.getState().openAt("codes");
    useUserSettings.getState().close();
    expect(useUserSettings.getState().open).toBe(false);

    useUserSettings.getState().openAt("profile");
    expect(useUserSettings.getState().section).toBe("profile");
  });
});
