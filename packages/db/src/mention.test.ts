import { describe, expect, test } from "vitest";

import { extractMentionCandidates } from "./mention";

describe("extractMentionCandidates", () => {
  test("finds plain mentions", () => {
    expect(extractMentionCandidates("hey @alice look at this")).toEqual(["alice"]);
  });

  test("dedupes repeats", () => {
    expect(extractMentionCandidates("@bob @bob @bob")).toEqual(["bob"]);
  });

  test("drops reserved words", () => {
    expect(extractMentionCandidates("@everyone @here @admin @alice")).toEqual(["alice"]);
  });

  test("ignores too-short and malformed handles", () => {
    // `@ab` is below the 3-char minimum; `@AL` is uppercase (usernames are lowercase-only).
    expect(extractMentionCandidates("@ab @AL hi")).toEqual([]);
  });

  test("matches mentions embedded in punctuation and markdown", () => {
    expect(extractMentionCandidates("thanks (@carol_1)! **@dave**")).toEqual([
      "carol_1",
      "dave",
    ]);
  });

  test("caps handle length at 20 chars", () => {
    const long = "a".repeat(25);
    // The regex captures at most 20 chars — the candidate simply won't resolve to a member.
    expect(extractMentionCandidates(`@${long}`)).toEqual(["a".repeat(20)]);
  });

  test("empty content yields no candidates", () => {
    expect(extractMentionCandidates("")).toEqual([]);
  });
});
