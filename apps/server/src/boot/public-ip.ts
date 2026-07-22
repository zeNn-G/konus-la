export class PublicIpDetectionError extends Error {}

/** IPv4-forced echo services, tried in order; the response body is the address. */
const PROVIDERS = [
  "https://api4.ipify.org",
  "https://checkip.amazonaws.com",
  "https://ipv4.icanhazip.com",
];

const IPV4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;

const PROVIDER_TIMEOUT_MS = 3000;

export type PublicIp = {
  address: string;
  /** `env`, the echo provider's hostname, or `dev-fallback`. */
  source: string;
};

/**
 * Resolve the address ICE candidates announce (ADR 0009): env override → HTTPS echo
 * chain → hard failure in production (a wrong announce address is up-but-broken voice,
 * worse than down) / loopback in dev.
 */
export async function detectPublicIp(opts: {
  publicIpEnv?: string;
  isProduction: boolean;
  fetchFn?: typeof fetch;
}): Promise<PublicIp> {
  if (opts.publicIpEnv) return { address: opts.publicIpEnv, source: "env" };

  const fetchFn = opts.fetchFn ?? fetch;
  for (const provider of PROVIDERS) {
    try {
      const response = await fetchFn(provider, {
        signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
      });
      if (!response.ok) continue;
      const address = (await response.text()).trim();
      if (IPV4.test(address)) {
        return { address, source: new URL(provider).hostname };
      }
    } catch {
      // dead provider — fall through to the next one
    }
  }

  if (opts.isProduction) {
    throw new PublicIpDetectionError(
      "public IP detection failed: set PUBLIC_IP explicitly (every echo provider was unreachable or malformed)",
    );
  }
  return { address: "127.0.0.1", source: "dev-fallback" };
}
