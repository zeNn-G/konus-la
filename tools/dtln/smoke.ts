/**
 * Smoke gate for the committed DTLN worklet artifact — the go/no-go check
 * before (or after) any app wiring.
 *
 * Usage: bun tools/dtln/smoke.ts [path-to-artifact]
 *
 * Loads the artifact in a simulated AudioWorkletGlobalScope: the globals a
 * real worklet provides (AudioWorkletProcessor, registerProcessor,
 * sampleRate) exist, and the ones it lacks (window, document, fetch,
 * XMLHttpRequest, importScripts, self, setTimeout, …) are shadowed to
 * undefined so any unguarded reference throws. Then constructs the processor,
 * waits for the wasm ready signal, and pushes 3 s of white noise through it:
 * output RMS must land well below input RMS, with no NaNs and no digital
 * silence.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SIM_SAMPLE_RATE = 16000;
const FRAME = 128;
const READY_TIMEOUT_MS = 30_000;
const NOISE_SECONDS = 3;
const WARMUP_SECONDS = 1;
const MAX_RMS_RATIO = 0.35; // ≈ −9 dB — DTLN kills stationary white noise far harder

const artifactPath =
  process.argv[2] ??
  join(import.meta.dir, "..", "..", "apps", "web", "src", "assets", "dtln", "dtln-processor.js");
const source = readFileSync(artifactPath, "utf8");

interface ProcessorLike {
  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean;
}

const registered = new Map<string, new () => ProcessorLike>();
const portMessages: unknown[] = [];

class FakeAudioWorkletProcessor {
  port = {
    onmessage: null as unknown,
    postMessage: (data: unknown) => {
      portMessages.push(data);
    },
  };
}

const workletProvided = {
  AudioWorkletProcessor: FakeAudioWorkletProcessor,
  registerProcessor: (name: string, ctor: new () => ProcessorLike) => {
    registered.set(name, ctor);
  },
  sampleRate: SIM_SAMPLE_RATE,
  AudioWorkletGlobalScope: class {},
  console,
};
const workletHostile = [
  "window",
  "document",
  "fetch",
  "XMLHttpRequest",
  "importScripts",
  "self",
  "location",
  "navigator",
  "setTimeout",
  "clearTimeout",
  "setInterval",
  "clearInterval",
];

const load = new Function(...Object.keys(workletProvided), "globalThis", ...workletHostile, source);
load(...Object.values(workletProvided), { sampleRate: SIM_SAMPLE_RATE });

const Processor = registered.get("dtln-processor");
if (!Processor) {
  throw new Error(
    `artifact registered [${[...registered.keys()].join(", ")}] — expected "dtln-processor"`,
  );
}

const processor = new Processor();

const readyDeadline = Date.now() + READY_TIMEOUT_MS;
while (!portMessages.some((m) => typeof m === "string" && m.startsWith("ready:"))) {
  if (Date.now() > readyDeadline) {
    throw new Error(
      `no ready signal within ${READY_TIMEOUT_MS} ms (messages: ${JSON.stringify(portMessages)})`,
    );
  }
  await new Promise((resolve) => globalThis.setTimeout(resolve, 50));
}
const ready = portMessages.find((m) => typeof m === "string" && m.startsWith("ready:"));
console.log(`ready signal: ${ready}`);

// deterministic white noise (mulberry32) so the gate can't flake
let seed = 0x5eed5eed;
function random(): number {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

const totalFrames = Math.ceil((SIM_SAMPLE_RATE * NOISE_SECONDS) / FRAME);
const warmupFrames = Math.ceil((SIM_SAMPLE_RATE * WARMUP_SECONDS) / FRAME);
let inputSquares = 0;
let outputSquares = 0;
let measured = 0;
let nanCount = 0;
let sawNonZero = false;

for (let frame = 0; frame < totalFrames; frame++) {
  const input = new Float32Array(FRAME);
  for (let i = 0; i < FRAME; i++) input[i] = (random() * 2 - 1) * 0.5;
  const output = new Float32Array(FRAME);
  processor.process([[input]], [[output]]);
  for (let i = 0; i < FRAME; i++) {
    const inSample = input[i] ?? 0;
    const outSample = output[i] ?? 0;
    if (Number.isNaN(outSample)) nanCount++;
    if (frame >= warmupFrames) {
      inputSquares += inSample * inSample;
      outputSquares += outSample * outSample;
      measured++;
      if (outSample !== 0) sawNonZero = true;
    }
  }
}

const inputRms = Math.sqrt(inputSquares / measured);
const outputRms = Math.sqrt(outputSquares / measured);
const ratio = outputRms / inputRms;
console.log(
  `white noise: input RMS ${inputRms.toFixed(4)}, output RMS ${outputRms.toFixed(4)}, ` +
    `ratio ${ratio.toFixed(4)} (${(20 * Math.log10(ratio)).toFixed(1)} dB), NaNs ${nanCount}`,
);

if (nanCount > 0) throw new Error(`denoiser produced ${nanCount} NaN samples`);
if (!sawNonZero) throw new Error("denoiser produced pure digital silence — pipeline is dead");
if (ratio >= MAX_RMS_RATIO) {
  throw new Error(
    `insufficient attenuation: RMS ratio ${ratio.toFixed(4)} (need < ${MAX_RMS_RATIO})`,
  );
}
console.log("smoke OK");
