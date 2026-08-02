/**
 * Builds the committed DTLN worklet artifact from the pinned dtln-rs commit.
 *
 * Usage: bun tools/dtln/build.ts
 *
 * Steps: docker-build the pinned engine image (clone + checkout + emscripten
 * compile happen inside the image), copy out the SINGLE_FILE glue (wasm
 * inlined), prepend a provenance banner, append the DtlnProcessor postscript,
 * write the artifact to apps/web/src/assets/dtln/dtln-processor.js, then run
 * the smoke gate (tools/dtln/smoke.ts) against it. Rebuilds are deliberate —
 * this never runs in CI.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const PINNED_COMMIT = "5bd53c00d3334615f9b03fa7775402ae2a39b616";
const TOOL_DIR = import.meta.dir;
const REPO_ROOT = join(TOOL_DIR, "..", "..");
const IMAGE = `konus-dtln:${PINNED_COMMIT.slice(0, 12)}`;
const BUILD_DIR = join(TOOL_DIR, ".build");
const ARTIFACT_DIR = join(REPO_ROOT, "apps", "web", "src", "assets", "dtln");
const ARTIFACT = join(ARTIFACT_DIR, "dtln-processor.js");

function run(cmd: string[]): void {
  console.log(`$ ${cmd.join(" ")}`);
  const proc = Bun.spawnSync(cmd, { stdout: "inherit", stderr: "inherit" });
  if (proc.exitCode !== 0) {
    throw new Error(`command failed (exit ${proc.exitCode}): ${cmd.join(" ")}`);
  }
}

function capture(cmd: string[]): string {
  const proc = Bun.spawnSync(cmd, { stderr: "inherit" });
  if (proc.exitCode !== 0) {
    throw new Error(`command failed (exit ${proc.exitCode}): ${cmd.join(" ")}`);
  }
  return proc.stdout.toString().trim();
}

run(["docker", "build", "--build-arg", `DTLN_RS_COMMIT=${PINNED_COMMIT}`, "-t", IMAGE, TOOL_DIR]);

mkdirSync(BUILD_DIR, { recursive: true });
const gluePath = join(BUILD_DIR, "dtln.js");
const containerId = capture(["docker", "create", IMAGE]);
try {
  run(["docker", "cp", `${containerId}:/src/dtln-rs/dtln.js`, gluePath]);
} finally {
  run(["docker", "rm", containerId]);
}

const glue = readFileSync(gluePath, "utf8");
// SINGLE_FILE=1 inlines the wasm as a base64 data URI; a glue without it would
// try to fetch a .wasm file, which an AudioWorkletGlobalScope cannot do.
if (!glue.includes("data:application/octet-stream;base64,")) {
  throw new Error("glue is missing the inlined wasm — expected a SINGLE_FILE=1 build");
}
if (glue.length < 2_000_000) {
  throw new Error(`glue is suspiciously small (${glue.length} bytes) — wasm probably not inlined`);
}
if (!glue.includes("DtlnPlugin")) {
  throw new Error("glue is missing the DtlnPlugin wrapper from upstream dtln_post.js");
}

const postscript = readFileSync(join(TOOL_DIR, "postscript.js"), "utf8");
const banner = `/*!
 * dtln-processor.js — GENERATED FILE, do not edit.
 *
 * DTLN noise-suppression AudioWorklet module: the dtln-rs Emscripten glue
 * (wasm inlined via SINGLE_FILE=1) with the DtlnProcessor postscript appended.
 * Rebuild with \`bun tools/dtln/build.ts\` — see tools/dtln/README.md.
 *
 * Engine: https://github.com/DataDog/dtln-rs @ ${PINNED_COMMIT} (MIT)
 * Model: breizhn/DTLN (MIT). Processor adapted from Sharkord (MIT).
 */
`;

mkdirSync(ARTIFACT_DIR, { recursive: true });
writeFileSync(ARTIFACT, `${banner}${glue}\n${postscript}`);
console.log(`wrote ${ARTIFACT} (${readFileSync(ARTIFACT).length} bytes)`);

// Smoke gate: simulated-worklet load (unguarded window/document/fetch/… would
// throw) plus a white-noise attenuation proof. Failure here fails the build.
run(["bun", join(TOOL_DIR, "smoke.ts"), ARTIFACT]);
console.log("build + smoke OK");
