/**
 * `bun run dev:lan` — the normal dev stack, reachable from other devices on the LAN
 * (spec §Dev verification, #13). Injects the LAN origin into the env (process env wins
 * over .env in both Bun and Vite), so the .env files stay at their localhost defaults
 * and plain `bun run dev` is unaffected.
 *
 * Usage: bun run dev:lan [ip]   — ip defaults to the first non-internal IPv4.
 */
import { networkInterfaces } from "node:os";

function detectLanIp(): string {
  const candidates: string[] = [];
  for (const infos of Object.values(networkInterfaces())) {
    for (const info of infos ?? []) {
      if (info.family !== "IPv4" || info.internal) continue;
      // Link-local (no DHCP) and virtual-adapter subnets make useless announce targets.
      if (info.address.startsWith("169.254.")) continue;
      candidates.push(info.address);
    }
  }
  const preferred = candidates.find((a) => a.startsWith("192.168.") || a.startsWith("10."));
  const ip = preferred ?? candidates[0];
  if (!ip) throw new Error("No LAN IPv4 address found — pass one explicitly: bun run dev:lan <ip>");
  return ip;
}

const ip = process.argv[2] ?? detectLanIp();
const webUrl = `http://${ip}:3001`;
const serverUrl = `http://${ip}:3000`;

console.log(`
  LAN dev mode — everything announced on ${ip}

    app:    ${webUrl}   (use this on EVERY device, including this machine —
                                        CORS is single-origin, localhost:3001 won't work)
    api:    ${serverUrl}

  Phone notes:
    - Sign in with a different account than your desktop (one voice seat per user).
    - Mic/cam publish needs a secure context: on Android Chrome add ${webUrl}
      to chrome://flags/#unsafely-treat-insecure-origin-as-secure. iOS Safari has no
      flag — joins there are listen-only until we ship HTTPS dev certs.
    - If LAN devices can't connect at all, allow bun.exe + mediasoup-worker through
      Windows Defender Firewall on the ACTIVE network profile (silent failure otherwise).
`);

const child = Bun.spawn(["bun", "run", "dev"], {
  env: {
    ...process.env,
    VITE_SERVER_URL: serverUrl,
    BETTER_AUTH_URL: serverUrl,
    CORS_ORIGIN: webUrl,
    PUBLIC_IP: ip,
    // vite.config.ts binds 0.0.0.0 when this is set.
    DEV_LAN: "1",
  },
  stdout: "inherit",
  stderr: "inherit",
  stdin: "inherit",
});

process.exit(await child.exited);
