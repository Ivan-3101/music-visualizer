# 3D Music Visualizer: Design

## 1. Goals

**Goals**
- A website that plays music and shows a 3D visual reacting to it in real time
- Audio sources: file upload, microphone, and screen/system audio capture (for Spotify)
- Several visual modes you can switch between
- Hosted free on Vercel, code on GitHub
- Fun and learning first: every part should be understandable

**Non-goals**
- No backend, accounts or database. Everything runs in the browser.
- No Spotify API integration. Spotify audio is DRM-protected, so we capture system audio instead.
- Mobile should work, but desktop Chrome is the main target.

## 2. Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                         main.ts                              │
│          (wires everything together + runs the loop)         │
└──────┬──────────────┬───────────────┬───────────────┬────────┘
       │              │               │               │
┌──────▼──────┐ ┌─────▼──────┐ ┌──────▼──────┐ ┌──────▼──────┐
│ AudioEngine │ │  features  │ │SceneManager │ │  Controls   │
│ file / mic /│ │ raw FFT →  │ │ Three.js    │ │ buttons,    │
│ capture →   │ │ bass, mid, │ │ scene,      │ │ file picker,│
│ AnalyserNode│ │ treble,    │ │ camera,     │ │ playback,   │
│             │ │ beat       │ │ bloom       │ │ mode switch │
└─────────────┘ └────────────┘ └──────┬──────┘ └─────────────┘
                                      │
                    ┌─────────────────┼─────────────────┐
              ┌─────▼─────┐   ┌───────▼──────┐  ┌───────▼───────┐
              │PulseSphere│   │ SpectrumRing │  │ ParticleField │
              └───────────┘   └──────────────┘  └───────────────┘
                     (all implement the Visualizer interface)

              + DebugBars (2D overlay, toggle on/off)
```

| Module | Responsibility |
|---|---|
| AudioEngine | Owns the `AudioContext`, connects the active source to an `AnalyserNode`, exposes the FFT arrays |
| spectrum | Shapes raw FFT decibels into 64 log-spaced bar levels (0–1): tilt, auto-gain, fast-attack/slow-fall |
| features | Pure functions: raw FFT → `bass`, `mid`, `treble`, `energy`, `beat`. Unit tested. |
| SceneManager | Three.js scene, camera, renderer, resize handling, bloom post-processing |
| Visualizers | Pluggable 3D modes implementing one interface |
| DebugBars | 2D spectrum overlay for checking audio data separately from 3D rendering |
| Controls | DOM/UI code only |

Audio doesn't know about 3D, and 3D doesn't know where audio comes from.

### Visualizer interface (strategy pattern)

```ts
interface Visualizer {
  init(scene: THREE.Scene): void;
  update(features: AudioFeatures, dt: number): void; // ~60x/sec
  dispose(): void; // free GPU memory when switching modes
}

interface AudioFeatures {
  bass: number;          // 0..1
  mid: number;           // 0..1
  treble: number;        // 0..1
  energy: number;        // 0..1
  beat: boolean;         // true on the frame a beat hits
  spectrum: Float32Array; // Spectrum.levels: 64 log-spaced bars, 0..1
  waveform: Uint8Array;  // raw time-domain samples
}
```

## 3. Frame loop

```
requestAnimationFrame (~60/sec)
  1. AudioEngine  → analyser.getFloatFrequencyData(frequencyDb)
  2. Spectrum     → update(frequencyDb, dt) → levels (64 bars, 0..1)
  3. features     → computeFeatures(levels, dt)
  4. visualizer   → update(features, dt)
  5. DebugBars    → draw(levels)   (if enabled)
  6. SceneManager → render()
```

`dt` = seconds since the last frame. All motion and smoothing scale by `dt` so they behave the same at 60Hz and 144Hz.

## 4. Audio design

**Playback:** files play through an `<audio>` element connected with `createMediaElementSource`. We get play/pause/seek for free, and the file streams instead of being fully decoded into memory.

**Audio graph per source:**
- File: `<audio> → analyser → speakers`
- Mic / capture: `stream → analyser` (**not** connected to speakers, which would cause echo or feedback). Capture's video track is stopped immediately.

**FFT:** `fftSize = 2048` → 1024 bins. Bin width = `sampleRate / fftSize` (~21.5Hz at 44.1kHz, ~23.4Hz at 48kHz). Band bin ranges are **computed from `audioContext.sampleRate` at runtime**, never hardcoded.

| Band | Range |
|---|---|
| Bass | 20–250 Hz |
| Mid | 250–4000 Hz |
| Treble | 4000–16000 Hz (capped: MP3s carry little above 16kHz) |

**Spectrum shaping (`spectrum.ts`).** We read real decibels with `getFloatFrequencyData`. The 0–255 byte version squashes everything into a fixed −100…−30 dB window, where each bar only moved ~15% of its height. Steps, per frame:

1. **Log-spaced bars:** 64 bars from 20 Hz to 16 kHz, each taking the loudest bin in its range.
2. **Tilt:** +3 dB/octave above 1 kHz (−3 below), flattening music's natural high-frequency roll-off so treble is visible.
3. **Auto-gain:** a ceiling follows the loudest bar (up instantly, down 4 dB/s, never below −60 dB); bars show the 40 dB below it. Quiet tracks or low Spotify volume still fill the range.
4. **Fast attack, slow fall:** bars rise instantly and fall at 1.5 heights/s. The analyser's own smoothing is 0.5 so kick drums stay punchy.

Measured on Seven Nation Army: bar swing went from ~15% to 23–49% of the height, and 25% playback volume gave nearly identical bars.

**Smoothing for features (frame-rate independent):**
```
value += (target - value) * (1 - Math.exp(-speed * dt))
```

**Beat detection:** compare bass *differences* in dB from a ~1s running average (not ratios, since dB is already a log scale), with a ~250ms cooldown. Thresholds are tuned against real music using the debug bars.

**Autoplay rule:** browsers block audio until the user interacts, so the `AudioContext` is created or resumed on the first click.

**Performance:** FFT arrays are allocated once and reused every frame. Renderer pixel ratio is capped at 2.

## 5. Visual design

Dark blue-black background, glowing colors (bloom), slowly orbiting camera. A minimal floating control bar fades out when the mouse is idle. When no audio is playing, the scene runs a gentle idle animation.

```
┌──────────────────────────────────────────────────┐
│ ▂▅▇▃▂ (debug bars, optional)                     │
│                                                  │
│                   3D VISUAL                      │
│                                                  │
│  ┌──────────────────────────────────────────┐    │
│  │ ⏯  ━━━━●━━━━━ 1:23 │ 📁 🎤 🖥 │ ◀ Mode ▶ │ 🐞 │    │
│  └──────────────────────────────────────────┘    │
└──────────────────────────────────────────────────┘
```

**Modes**
1. **Pulse Sphere:** surface bulges with bass, color shifts with treble, kicks outward on beats. Built on the CPU first, then rewritten as a GPU shader.
2. **Spectrum Ring:** 64 bars in a 3D circle, camera orbiting.
3. **Particle Field:** thousands of glowing points. Energy controls speed and spread, and beats send shockwaves.

## 6. Folder structure

```
music-visualizer/
├─ index.html
├─ package.json
├─ tsconfig.json
├─ .gitignore
├─ README.md
├─ docs/DESIGN.md
└─ src/
   ├─ main.ts
   ├─ style.css
   ├─ audio/        AudioEngine.ts, spectrum.ts, features.ts, features.test.ts
   ├─ scene/        SceneManager.ts
   ├─ visualizers/  Visualizer.ts, PulseSphere.ts, SpectrumRing.ts, ParticleField.ts
   ├─ debug/        DebugBars.ts
   └─ ui/           Controls.ts
```

Folders are created in the phase that first needs them.

**Dependencies:** `three` (runtime), `vite`, `typescript`, `vitest` (dev only). Each is added in the phase that first uses it. No music files are committed.

## 7. Phases

| # | Phase | Done when |
|---|---|---|
| 1 | Setup: git, Vite + TS, docs, GitHub, deploy hello world to Vercel | Live URL shows the placeholder page |
| 2 | Audio pipeline: file upload, Spotify capture test, debug bars | MP3 plays and bass bars jump on kick drums; we know whether Spotify capture works |
| 3 | Three.js basics: scene, camera, lights, spinning cube, orbit controls, resize | Cube spins, drag orbits, resizing doesn't stretch |
| 4 | Audio features + tests, Visualizer interface, Pulse Sphere (CPU) | Sphere pulses with bass; tests pass |
| 5a | Shaders + bloom: Pulse Sphere moved to GPU | Smooth 60fps with glow |
| 5b | Spectrum Ring, Particle Field, mode switching | 3 switchable modes |
| 6 | Mic + capture polish: permissions, stop button, error messages | Reacts to Spotify on the PC; failures show a clear message |
| 7 | UI polish (auto-hide, playback bar), README | Feels finished |

Each phase ends with a commit and push, which auto-deploys to Vercel.

## 8. Risks

| Risk | Plan |
|---|---|
| Spotify capture blocked | Tested early (Phase 2). Fall back to sharing the entire screen, or the mic. |
| Shaders feel overwhelming | Start with a one-color shader; CPU version stays as a fallback |
| Slow on weak laptops | Pixel ratio cap, particle-count setting |
| Safari/Firefox quirks | Chrome first; check others in Phase 7 |
