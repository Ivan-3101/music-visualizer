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

**Bands (`features.ts`):** bass, mid and treble are averages of the shaped bar levels in each band (bar ranges computed from `barToHz`: 25 / 26 / 13 bars), then smoothed with the formula above.

**Beat detection:** a beat fires when the raw (unsmoothed) bass:
1. is **rising** (an onset, not a steady level; otherwise a steady level fires repeatedly while the average warms up after silence);
2. is **0.10 above** its ~1s exponential running average (≈ 4 dB, a *difference*, since the levels are already on a dB scale);
3. is above 0.25 (near-silence never triggers);
4. comes **≥ 250 ms** after the previous beat.

Tuned on Seven Nation Army (~2.07 beats/s): 0.10 gave 1.9–2.0/s in the intro, 2.3/s in the verse and 1.9/s in the chorus. 0.12 missed ~25% of chorus kicks; 0.08 over-triggered everywhere. Covered by unit tests in `features.test.ts`.

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

**Rendering (Phase 5a)**
- **Pulse Sphere runs in a GPU shader** (`ShaderMaterial`). The vertex shader displaces each vertex with 3D simplex noise (Ashima Arts, MIT) and recomputes the normal from two nearby displaced points. The fragment shader does its own lighting: diffuse, a small specular, and a Fresnel rim whose brightness rises with energy. JavaScript only sets uniforms each frame. `?cpu` loads the CPU version for comparison.
- **Bloom:** `EffectComposer` → `RenderPass` → `UnrealBloomPass` (half resolution) → `OutputPass` → `FXAAPass` (with dithering added to its shader).
- **Dithering:** the dark, gradual glow showed visible bands (the screen has only 256 steps per channel). The last pass adds per-pixel noise smaller than one step (interleaved gradient noise) so neighbouring pixels round differently and the bands blend. It's built into the FXAA pass because a separate full-screen pass costs ~20 fps on integrated GPUs. Only the loud rim crosses the threshold (0.55), so the glow itself reacts to the music.
- **Background via `scene.background`, not `renderer.setClearColor`:** the clear color is converted once for the screen (sRGB) and then reused for the off-screen bloom image, which `OutputPass` converts again (near-black became grey).
- **Performance on the baseline GPU (Intel Iris Xe, 1920×1080):**

  | Step | FPS |
  |---|---|
  | No post-processing | 145 |
  | Bloom added (full resolution) | 45–49 |
  | Bloom at half resolution | 72–75 |
  | Canvas antialiasing off (wasted with post-processing) | 80–83 |
  | + FXAA pass (edges were visibly jagged without it) | **60–62** |

  MSAA on all of the composer's off-screen images was also tried: smoother than FXAA but 39–44 fps (2 samples was no faster than 4). MSAA on the scene only (its own multisampled target, fed into the chain with a `TexturePass`) was crisper than FXAA at ~50 fps.

  **Phase 7 quality setting:** "high" = scene-only MSAA, higher render resolution (up to 4K) and full-resolution bloom, for strong GPUs like an RTX 3060; "low" = no FXAA and smaller bloom for weak ones. A web page can't pick the GPU (`powerPreference` is ignored on Windows); the browser decides, set via Windows graphics settings.

  CPU vs GPU sphere (before bloom, 1280×720): CPU 6k vertices = 3.6–4.0 ms JS/frame; GPU 42k vertices = 0.7–0.9 ms. An RTX 3060 runs everything at 144+.

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
   ├─ visualizers/  Visualizer.ts, PulseSphere.ts (GPU), PulseSphereCPU.ts, SpectrumRing.ts, ParticleField.ts
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
