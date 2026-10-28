// Bars are spaced on a log scale: each covers the same pitch ratio, the way we hear.
// (On a linear scale, 20–250Hz would be only ~10 of the 1024 FFT bins.)
export const BAR_COUNT = 64;
export const MIN_HZ = 20;
export const MAX_HZ = 16000;

// Band boundaries; must match docs/DESIGN.md.
export const BASS_MAX_HZ = 250;
export const MID_MAX_HZ = 4000;

// Music gets quieter toward high frequencies; tilting by +3dB/octave above
// 1kHz (and -3dB/octave below) flattens that so every bar uses the full height.
const TILT_DB_PER_OCTAVE = 3;
const TILT_PIVOT_HZ = 1000;

// Bars show the top RANGE_DB below an auto-gain "ceiling" that follows the
// loudest bar: up instantly, down slowly, never below MIN_CEILING_DB (so
// silence isn't amplified into noise).
const RANGE_DB = 40;
const MIN_CEILING_DB = -60;
const CEILING_RELEASE_DB_PER_SEC = 4;

// Bars jump up instantly on a hit, then fall at this speed (full height per second).
const FALL_PER_SEC = 1.5;

/** Bar index (0..BAR_COUNT) → frequency in Hz. */
export function barToHz(bar: number): number {
  return MIN_HZ * (MAX_HZ / MIN_HZ) ** (bar / BAR_COUNT);
}

/** Frequency in Hz → position 0..1 along the bar axis (inverse of barToHz). */
export function hzToPosition(hz: number): number {
  return Math.log(hz / MIN_HZ) / Math.log(MAX_HZ / MIN_HZ);
}

/** Turns raw FFT decibels into BAR_COUNT levels from 0 to 1, shaped for display. */
export class Spectrum {
  /** Output: one level per bar, 0..1. */
  readonly levels = new Float32Array(BAR_COUNT);

  private readonly startBin: number[] = [];
  private readonly endBin: number[] = [];
  private readonly tiltDb: number[] = [];
  private readonly barDb = new Float32Array(BAR_COUNT);
  private ceilingDb = MIN_CEILING_DB;

  constructor(sampleRate: number, fftSize: number) {
    const hzPerBin = sampleRate / fftSize;

    for (let i = 0; i < BAR_COUNT; i++) {
      const lowHz = barToHz(i);
      const highHz = barToHz(i + 1);
      const start = Math.floor(lowHz / hzPerBin);
      this.startBin.push(start);
      // At low frequencies a bar is narrower than one bin; always read at least one.
      this.endBin.push(Math.max(start + 1, Math.floor(highHz / hzPerBin)));

      const centerHz = Math.sqrt(lowHz * highHz);
      this.tiltDb.push(TILT_DB_PER_OCTAVE * Math.log2(centerHz / TILT_PIVOT_HZ));
    }
  }

  /** frequencyDb: from AnalyserNode.getFloatFrequencyData. dt: seconds since last frame. */
  update(frequencyDb: Float32Array, dt: number): void {
    // 1. Loudest bin in each bar, plus tilt.
    let loudest = -Infinity;
    for (let i = 0; i < BAR_COUNT; i++) {
      let peak = -Infinity;
      for (let bin = this.startBin[i]; bin < this.endBin[i]; bin++) {
        peak = Math.max(peak, frequencyDb[bin]);
      }
      this.barDb[i] = peak + this.tiltDb[i];
      loudest = Math.max(loudest, this.barDb[i]);
    }

    // 2. Auto-gain ceiling.
    this.ceilingDb = Math.max(loudest, this.ceilingDb - CEILING_RELEASE_DB_PER_SEC * dt, MIN_CEILING_DB);
    const floorDb = this.ceilingDb - RANGE_DB;

    // 3. Map into 0..1; rise instantly, fall at a fixed speed.
    for (let i = 0; i < BAR_COUNT; i++) {
      const target = Math.min(1, Math.max(0, (this.barDb[i] - floorDb) / RANGE_DB));
      this.levels[i] = target >= this.levels[i] ? target : Math.max(target, this.levels[i] - FALL_PER_SEC * dt);
    }
  }
}
