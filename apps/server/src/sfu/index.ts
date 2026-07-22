import { setVoiceDown } from "@konus-la/api/voice/availability";
import { voiceWorkerDied, voiceWorkerRespawned } from "@konus-la/api/voice/rooms";
import { setSfuWorker, setWebRtcServer } from "@konus-la/api/voice/sfu";
import { env } from "@konus-la/env/server";
import type { types } from "mediasoup";

import { logger } from "../logger";
import { createWorkerPatched } from "./create-worker";
import { createWorkerManager, type WorkerManager } from "./worker-manager";

/**
 * `bun --hot` re-evaluates modules without killing the process: module state resets but
 * globalThis survives. Without this guard every hot reload would boot another worker.
 */
const GLOBAL_KEY = Symbol.for("konus-la.sfu.worker-manager");

type SfuGlobal = typeof globalThis & {
  [GLOBAL_KEY]?: WorkerManager<types.Worker>;
};

/**
 * The WebRtcServer rides on its worker's appData: it dies with the worker, and appData
 * (unlike module state) survives a `bun --hot` re-evaluation together with the worker,
 * so both seams re-wire from the same surviving object.
 */
function webRtcServerOf(worker: types.Worker | null): types.WebRtcServer | null {
  return (worker?.appData.webRtcServer as types.WebRtcServer | undefined) ?? null;
}

/**
 * Every transport of the worker multiplexes over this one UDP+TCP port pair (ADR 0009):
 * the deployment publishes exactly `MEDIA_PORT`, and announced candidates carry it.
 */
async function spawnWorkerWithWebRtcServer(): Promise<types.Worker> {
  const worker = await createWorkerPatched({ logLevel: "warn" });
  try {
    worker.appData.webRtcServer = await worker.createWebRtcServer({
      listenInfos: [
        { protocol: "udp", ip: "0.0.0.0", port: env.MEDIA_PORT, announcedAddress: env.PUBLIC_IP },
        { protocol: "tcp", ip: "0.0.0.0", port: env.MEDIA_PORT, announcedAddress: env.PUBLIC_IP },
      ],
    });
  } catch (error) {
    // A bind failure (EADDRINUSE) is a failed boot: close the half-booted worker so it
    // can't leak outside the manager's invariant, and let the crash-loop breaker judge.
    worker.close();
    throw error;
  }
  return worker;
}

/**
 * Boot the process-lifetime SFU worker (idempotent under hot reload). The manager owns
 * respawn + the crash-loop breaker and mirrors the down state into @konus-la/api, where
 * the `voiceProcedure` gate turns it into VOICE_UNAVAILABLE errors.
 */
export function startSfu(): WorkerManager<types.Worker> {
  const sfuGlobal = globalThis as SfuGlobal;

  const existing = sfuGlobal[GLOBAL_KEY];
  if (existing) {
    // A hot reload re-evaluated this module (and the api package's availability flag)
    // while the manager survived on globalThis — re-sync the flag with reality. The
    // reload also kills the worker (its IPC sockets close with the old evaluation), so
    // forgive recorded deaths: rapid dev saves must not open the crash-loop breaker.
    existing.resetDeathWindow();
    setVoiceDown(existing.isDown());
    setSfuWorker(() => existing.getWorker());
    setWebRtcServer(() => webRtcServerOf(existing.getWorker()));
    return existing;
  }

  const manager = createWorkerManager({
    spawn: spawnWorkerWithWebRtcServer,
    onAvailabilityChange: setVoiceDown,
    // Death → every seat's media half enters grace, guild-wide silence; the respawn that
    // follows publishes self-only `voice.mediaReset` so seated clients rejoin (spec #15).
    onWorkerLost: () => voiceWorkerDied(),
    onWorkerBooted: () => {
      void voiceWorkerRespawned().catch((error) => {
        logger.error({ err: error }, "voice mediaReset publish failed");
      });
    },
    logger,
  });
  sfuGlobal[GLOBAL_KEY] = manager;
  // Rooms build their routers off whatever worker is current — respawns swap it in place.
  setSfuWorker(() => manager.getWorker());
  setWebRtcServer(() => webRtcServerOf(manager.getWorker()));
  void manager.start();
  return manager;
}
