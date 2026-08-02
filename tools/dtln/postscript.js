/*!
 * DtlnProcessor — AudioWorkletProcessor appended to the dtln-rs Emscripten
 * glue by tools/dtln/build.ts. Runs the DTLN denoiser natively when the
 * context is 16 kHz and through an internal fractional-phase resampler
 * otherwise, so the worklet works at any context rate.
 *
 * Adapted from Sharkord's resampling-postscript.js (MIT):
 *   https://github.com/sharkord/sharkord
 * Engine: DataDog/dtln-rs (MIT). DTLN model: breizhn/DTLN (MIT).
 */

const DTLN_SAMPLE_RATE = 16000;
const DTLN_BLOCK_SIZE = 512;
const RING_SIZE = DTLN_BLOCK_SIZE * 8;

class DtlnProcessor extends AudioWorkletProcessor {
  constructor() {
    super();

    this.isModuleReady = false;

    const signalReady = () => {
      this.isModuleReady = true;
      const path = sampleRate === DTLN_SAMPLE_RATE ? "native" : "resampling";
      this.port.postMessage("ready:" + sampleRate + ":" + path);
    };

    // The Emscripten glue above shares this module scope: Module is its
    // runtime object, DtlnPlugin the wrapper from upstream's dtln_post.js.
    if (Module["calledRun"]) {
      signalReady();
    } else {
      DtlnPlugin.postRun = DtlnPlugin.postRun || [];
      DtlnPlugin.postRun.push(signalReady);
    }
    this.dtln_handle = null;

    // native mode state (16 kHz context)
    this.inputBuf = new Float32Array(DTLN_BLOCK_SIZE);
    this.outputBuf = new Float32Array(DTLN_BLOCK_SIZE);
    this.inputBufIdx = 0;
    this.outputBufIdx = 0;
    this.outputAvailable = 0;

    // resampling mode state (non-16 kHz context)
    this.downPhase = 0;
    this.downSum = 0;
    this.downWeight = 0;
    this.upBuf = new Float32Array(RING_SIZE);
    this.upWrite = 0;
    this.upRead = 0;
    this.upPrev = 0;
    this.upNext = 0;
    this.upPhase = 1.0;
  }

  upAvailable() {
    return (this.upWrite - this.upRead + RING_SIZE) % RING_SIZE;
  }

  process(inputs, outputs) {
    if (!inputs[0]?.[0] || !outputs[0]?.[0]) return true;

    const input = inputs[0][0];
    const output = outputs[0][0];

    if (!this.isModuleReady) {
      output.fill(0);
      return true;
    }

    // === null, not truthiness — the first engine handle dtln_create hands out is 0.
    if (this.dtln_handle === null) {
      this.dtln_handle = DtlnPlugin.dtln_create();
    }

    if (sampleRate === DTLN_SAMPLE_RATE) {
      return this.processNative(input, output);
    }

    return this.processResampling(input, output);
  }

  processNative(input, output) {
    // accumulate input into 512-sample blocks and run DTLN
    this.inputBuf.set(input, this.inputBufIdx);
    this.inputBufIdx += input.length;

    if (this.inputBufIdx >= DTLN_BLOCK_SIZE) {
      DtlnPlugin.dtln_denoise(this.dtln_handle, this.inputBuf, this.outputBuf);
      this.inputBufIdx = 0;
      this.outputAvailable = DTLN_BLOCK_SIZE;
      this.outputBufIdx = 0;
    }

    if (this.outputAvailable > 0) {
      output.set(this.outputBuf.subarray(this.outputBufIdx, this.outputBufIdx + input.length));
      this.outputBufIdx += input.length;
      this.outputAvailable -= input.length;
      this.outputAvailable = Math.max(0, this.outputAvailable);
    } else {
      output.fill(0);
    }

    return true;
  }

  processResampling(input, output) {
    const ratio = sampleRate / DTLN_SAMPLE_RATE;
    const step = DTLN_SAMPLE_RATE / sampleRate;

    // downsample input → 16 kHz with a fractional phase accumulator
    for (let i = 0; i < input.length; i++) {
      const remaining = ratio - this.downPhase;

      if (remaining <= 1.0) {
        this.downSum += input[i] * remaining;
        this.downWeight += remaining;

        this.inputBuf[this.inputBufIdx++] =
          this.downWeight > 0 ? this.downSum / this.downWeight : 0;

        if (this.inputBufIdx >= DTLN_BLOCK_SIZE) {
          DtlnPlugin.dtln_denoise(this.dtln_handle, this.inputBuf, this.outputBuf);
          this.inputBufIdx = 0;

          for (let s = 0; s < DTLN_BLOCK_SIZE; s++) {
            this.upBuf[this.upWrite] = this.outputBuf[s];
            this.upWrite = (this.upWrite + 1) % RING_SIZE;
          }
        }

        const leftover = 1.0 - remaining;
        this.downSum = input[i] * leftover;
        this.downWeight = leftover;
        this.downPhase = leftover;
      } else {
        this.downSum += input[i];
        this.downWeight += 1.0;
        this.downPhase += 1.0;
      }
    }

    // upsample denoised 16 kHz output → context rate
    for (let i = 0; i < output.length; i++) {
      while (this.upPhase >= 1.0) {
        this.upPrev = this.upNext;
        if (this.upAvailable() > 0) {
          this.upNext = this.upBuf[this.upRead];
          this.upRead = (this.upRead + 1) % RING_SIZE;
        }
        this.upPhase -= 1.0;
      }

      output[i] = this.upPrev * (1 - this.upPhase) + this.upNext * this.upPhase;
      this.upPhase += step;
    }

    return true;
  }
}

registerProcessor("dtln-processor", DtlnProcessor);
