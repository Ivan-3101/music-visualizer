import { describe, expect, it } from "vitest";
import {
  BASS_BARS,
  FeatureExtractor,
  MID_BARS,
  TREBLE_BARS,
  bandAverage,
  smoothTowards,
} from "./features";
import { BAR_COUNT, BASS_MAX_HZ, MID_MAX_HZ, barToHz } from "./spectrum";

const DT = 1 / 60;

/** Spectrum levels with every bass bar at `bass` and every other bar at `rest`. */
function levels(bass: number, rest = 0): Float32Array {
  const out = new Float32Array(BAR_COUNT).fill(rest);
  out.fill(bass, BASS_BARS[0], BASS_BARS[1]);
  return out;
}

/** Feeds the same levels for `seconds` at 60fps; returns how many beats fired. */
function run(extractor: FeatureExtractor, input: Float32Array, seconds: number): number {
  let beats = 0;
  for (let t = 0; t < seconds; t += DT) {
    if (extractor.update(input, DT).beat) beats++;
  }
  return beats;
}

describe("band ranges", () => {
  it("cover every bar exactly once, in order", () => {
    expect(BASS_BARS[0]).toBe(0);
    expect(MID_BARS[0]).toBe(BASS_BARS[1]);
    expect(TREBLE_BARS[0]).toBe(MID_BARS[1]);
    expect(TREBLE_BARS[1]).toBe(BAR_COUNT);
  });

  it("split at 250 Hz and 4 kHz", () => {
    expect(barToHz(MID_BARS[0] - 1)).toBeLessThan(BASS_MAX_HZ);
    expect(barToHz(MID_BARS[0])).toBeGreaterThanOrEqual(BASS_MAX_HZ);
    expect(barToHz(TREBLE_BARS[0] - 1)).toBeLessThan(MID_MAX_HZ);
    expect(barToHz(TREBLE_BARS[0])).toBeGreaterThanOrEqual(MID_MAX_HZ);
  });
});

describe("bandAverage", () => {
  it("averages only the given range", () => {
    const input = new Float32Array([0, 1, 0.5, 0.25, 9]);
    expect(bandAverage(input, [1, 4])).toBeCloseTo((1 + 0.5 + 0.25) / 3);
  });

  it("returns 0 for an empty range", () => {
    expect(bandAverage(new Float32Array(4), [2, 2])).toBe(0);
  });
});

describe("smoothTowards", () => {
  it("moves toward the target without overshooting", () => {
    const next = smoothTowards(0, 1, 12, DT);
    expect(next).toBeGreaterThan(0);
    expect(next).toBeLessThan(1);
  });

  it("is frame-rate independent: one 1/30s step equals two 1/60s steps", () => {
    const oneStep = smoothTowards(0, 1, 12, 1 / 30);
    const twoSteps = smoothTowards(smoothTowards(0, 1, 12, 1 / 60), 1, 12, 1 / 60);
    expect(oneStep).toBeCloseTo(twoSteps, 10);
  });

  it("doesn't move when no time has passed", () => {
    expect(smoothTowards(0.3, 1, 12, 0)).toBe(0.3);
  });
});

describe("FeatureExtractor", () => {
  it("reports silence as all zeros with no beats", () => {
    const extractor = new FeatureExtractor();
    expect(run(extractor, levels(0), 2)).toBe(0);
    const f = extractor.update(levels(0), DT);
    expect([f.bass, f.mid, f.treble, f.energy]).toEqual([0, 0, 0, 0]);
  });

  it("smoothed bands settle on their input levels", () => {
    const extractor = new FeatureExtractor();
    run(extractor, levels(0.8, 0.5), 1);
    const f = extractor.update(levels(0.8, 0.5), DT);
    expect(f.bass).toBeCloseTo(0.8, 3);
    expect(f.mid).toBeCloseTo(0.5, 3);
    expect(f.treble).toBeCloseTo(0.5, 3);
  });

  it("detects a sudden bass jump as a beat", () => {
    const extractor = new FeatureExtractor();
    run(extractor, levels(0.3), 2);
    expect(extractor.update(levels(0.8), DT).beat).toBe(true);
  });

  it("doesn't keep firing on steady loud bass", () => {
    const extractor = new FeatureExtractor();
    run(extractor, levels(0.8), 3); // the onset may fire; let the average catch up
    expect(run(extractor, levels(0.8), 2)).toBe(0);
  });

  it("fires once, not repeatedly, when a steady level starts after silence", () => {
    // Regression: the 1s average starts at 0, so a steady level sat "above
    // average" for the first second and fired every 250ms.
    const extractor = new FeatureExtractor();
    run(extractor, levels(0), 1);
    expect(run(extractor, levels(0.5), 1.5)).toBe(1);
  });

  it("ignores a second jump inside the 250ms cooldown", () => {
    const extractor = new FeatureExtractor();
    run(extractor, levels(0.3), 2);
    expect(extractor.update(levels(0.8), DT).beat).toBe(true);
    run(extractor, levels(0.3), 0.1);
    expect(extractor.update(levels(0.8), DT).beat).toBe(false);
  });

  it("accepts a second jump after the cooldown", () => {
    const extractor = new FeatureExtractor();
    run(extractor, levels(0.3), 2);
    expect(extractor.update(levels(0.8), DT).beat).toBe(true);
    run(extractor, levels(0.3), 0.3);
    expect(extractor.update(levels(0.8), DT).beat).toBe(true);
  });

  it("ignores jumps that stay quiet (below the minimum bass)", () => {
    const extractor = new FeatureExtractor();
    run(extractor, levels(0), 2);
    expect(extractor.update(levels(0.2), DT).beat).toBe(false);
  });

  it("counts a 120 BPM kick drum as ~2 beats per second", () => {
    const extractor = new FeatureExtractor();
    let beats = 0;
    for (let t = 0; t < 10; t += DT) {
      const kick = t % 0.5 < 0.1; // 100ms kick every 500ms
      if (extractor.update(levels(kick ? 0.8 : 0.3), DT).beat) beats++;
    }
    expect(beats).toBeGreaterThanOrEqual(19);
    expect(beats).toBeLessThanOrEqual(20);
  });
});
