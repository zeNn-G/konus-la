import { describe, expect, test } from "vitest";

import { detectPublicIp } from "./public-ip";

function fetchStub(responses: Record<string, string | Error>): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = String(input);
    const host = new URL(url).hostname;
    const outcome = responses[host];
    if (outcome === undefined || outcome instanceof Error) {
      throw outcome ?? new Error(`unexpected fetch: ${url}`);
    }
    return new Response(outcome);
  }) as typeof fetch;
}

describe("detectPublicIp", () => {
  test("an env-provided IP wins without any network call", async () => {
    const fetchFn = fetchStub({});

    await expect(
      detectPublicIp({ publicIpEnv: "203.0.113.7", isProduction: true, fetchFn }),
    ).resolves.toEqual({ address: "203.0.113.7", source: "env" });
  });

  test("falls through failing providers to the first well-formed IPv4", async () => {
    const fetchFn = fetchStub({
      "api4.ipify.org": new Error("timeout"),
      "checkip.amazonaws.com": "203.0.113.9\n",
    });

    await expect(detectPublicIp({ isProduction: true, fetchFn })).resolves.toEqual({
      address: "203.0.113.9",
      source: "checkip.amazonaws.com",
    });
  });

  test("rejects a malformed echo body and keeps going", async () => {
    const fetchFn = fetchStub({
      "api4.ipify.org": "<html>blocked</html>",
      "checkip.amazonaws.com": "999.1.2.3",
      "ipv4.icanhazip.com": "203.0.113.10",
    });

    await expect(detectPublicIp({ isProduction: true, fetchFn })).resolves.toEqual({
      address: "203.0.113.10",
      source: "ipv4.icanhazip.com",
    });
  });

  test("every provider failing fails a production boot", async () => {
    const fetchFn = fetchStub({});

    await expect(detectPublicIp({ isProduction: true, fetchFn })).rejects.toThrow(/public ip/i);
  });

  test("every provider failing falls back to loopback in dev", async () => {
    const fetchFn = fetchStub({});

    await expect(detectPublicIp({ isProduction: false, fetchFn })).resolves.toEqual({
      address: "127.0.0.1",
      source: "dev-fallback",
    });
  });
});
