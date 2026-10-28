import { BAR_COUNT, BASS_MAX_HZ, MID_MAX_HZ, barToHz } from "./spectrum";

/** What visualizers read every frame. Band values are smoothed, 0..1. */
export interface AudioFeatures {
  bass: number;
  mid: number;
  treble: number;
  energy: number; // average of all bars
  beat: boolean; // true only on the frame a beat is detected
  spectrum: Float32Array; // Spectrum.levels: BAR_COUNT bars, 0..1
}

/** Features for when nothing is playing. */
export const SILENT_FEATURES: AudioFeatures = {
  bass: 0,
  mid: 0,
  treble: 0,
  energy: 0,
  beat: false,
  spectrum: new Float32Array(BAR_COUNT),
};

// How quickly the smoothed values follow the raw ones (higher = snappier).
const SMOOTHING_SPEED = 12;

// Beat = raw bass is rising (an onset, not a steady level), is BEAT_THRESHOLD
// above its ~1s running average, is above BEAT_MIN_BASS (so near-silence never
// triggers) and at least BEAT_COOLDOWN_SEC has passed (so one kick isn't
// counted several times). 0.10 of Spectrum's 40dB window ≈ a 4dB jump.
// Tuned on Seven Nation Army (~2.07 beats/s): 0.12 missed ~25% of chorus kicks,
// 0.08 over-triggered everywhere.
const BEAT_THRESHOLD = 0.1;
const BEAT_MIN_BASS = 0.25;
const BEAT_COOLDOWN_SEC = 0.25;
const BASS_AVERAGE_SEC = 1;

/** First bar index at or above a frequency. */
function firstBarAbove(hz: number): number {
  let bar = 0;
  while (bar < BAR_COUNT && barToHz(bar) < hz) bar++;
  return bar;
}

export const BASS_BARS: [number, number] = [0, firstBarAbove(BASS_MAX_HZ)];
export const MID_BARS: [number, number] = [BASS_BARS[1], firstBarAbove(MID_MAX_HZ)];
export const TREBLE_BARS: [number, number] = [MID_BARS[1], BAR_COUNT];

/** Average of levels[start..end). */
export function bandAverage(levels: Float32Array, [start, end]: [number, number]): number {
  let sum = 0;
  for (let i = start; i < end; i++) sum += levels[i];
  return end > start ? sum / (end - start) : 0;
}

/**
 * Moves current toward target. Frame-rate independent: one step of dt=1/30
 * lands in the same place as two steps of dt=1/60.
 */
export function smoothTowards(current: number, target: number, speed: number, dt: number): number {
  return current + (target - current) * (1 - Math.exp(-speed * dt));
}

/** Turns Spectrum levels into AudioFeatures. Keeps state between frames. */
export class FeatureExtractor {
  // One object, updated in place every frame (no new allocation 60+ times a second).
  private readonly features: AudioFeatures = { ...SILENT_FEATURES };
  private bassAverage = 0;
  private previousBass = 0;
  private sinceLastBeat = Infinity;

  /** levels: Spectrum.levels. dt: seconds since last frame. */
  update(levels: Float32Array, dt: number): AudioFeatures {
    const bass = bandAverage(levels, BASS_BARS);
    const f = this.features;

    f.bass = smoothTowards(f.bass, bass, SMOOTHING_SPEED, dt);
    f.mid = smoothTowards(f.mid, bandAverage(levels, MID_BARS), SMOOTHING_SPEED, dt);
    f.treble = smoothTowards(f.treble, bandAverage(levels, TREBLE_BARS), SMOOTHING_SPEED, dt);
    f.energy = smoothTowards(f.energy, bandAverage(levels, [0, BAR_COUNT]), SMOOTHING_SPEED, dt);
    f.spectrum = levels;

    // Beat detection uses the raw bass: smoothing would blunt the jump we're looking for.
    // Without the "rising" check, a steady level fires repeatedly while the average
    // is still catching up (e.g. for the first second after a song starts).
    this.sinceLastBeat += dt;
    const rising = bass > this.previousBass;
    f.beat =
      rising &&
      bass - this.bassAverage > BEAT_THRESHOLD &&
      bass > BEAT_MIN_BASS &&
      this.sinceLastBeat >= BEAT_COOLDOWN_SEC;
    if (f.beat) this.sinceLastBeat = 0;
    this.previousBass = bass;
    this.bassAverage = smoothTowards(this.bassAverage, bass, 1 / BASS_AVERAGE_SEC, dt);

    return f;
  }
}
