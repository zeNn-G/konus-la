import { env } from "@konus-la/env/web";

/**
 * Where the API lives. `VITE_SERVER_URL` unset (the production image build) means the
 * page was served same-origin by the server itself; dev keeps it as the cross-origin
 * override (web on :3001 against server on :3000).
 */
export const serverOrigin = env.VITE_SERVER_URL ?? window.location.origin;

/** The /ws signaling endpoint — `wss:` whenever the origin is `https:`. */
export const wsUrl = `${serverOrigin.replace(/^http/, "ws")}/ws`;
