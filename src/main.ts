import "./style.css";
import * as THREE from "three";
import { AudioEngine } from "./audio/AudioEngine";
import { Spectrum } from "./audio/spectrum";
import { DebugBars } from "./debug/DebugBars";
import { SceneManager } from "./scene/SceneManager";

function getElement<T extends HTMLElement>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`${selector} not found in index.html`);
  return element;
}

const fileInput = getElement<HTMLInputElement>("#file-input");
const playButton = getElement<HTMLButtonElement>("#play-button");
const captureButton = getElement<HTMLButtonElement>("#capture-button");
const status = getElement<HTMLSpanElement>("#status");

const sceneManager = new SceneManager(getElement<HTMLDivElement>("#app"));

// Temporary demo content for Phase 3; replaced by visualizers in Phase 4.
// A mesh = geometry (the shape) + material (how the surface reacts to light).
const cube = new THREE.Mesh(
  new THREE.BoxGeometry(1, 1, 1),
  new THREE.MeshStandardMaterial({ color: 0x4cc9f0, roughness: 0.35, metalness: 0.2 }),
);
sceneManager.scene.add(cube);
// Faint floor grid (10×10 units) so you can tell which way is down while orbiting.
const grid = new THREE.GridHelper(10, 10, 0x334155, 0x1e293b);
grid.position.y = -1.5;
sceneManager.scene.add(grid);

let engine: AudioEngine | null = null;
let spectrum: Spectrum | null = null;
let debugBars: DebugBars | null = null;
let fileName = "";
let lastFrameTime = 0;

// Created on the first user action, not on page load: browsers block audio
// until the user has interacted with the page.
function getEngine(): AudioEngine {
  if (!engine) {
    engine = new AudioEngine();
    engine.onChange = render;
    spectrum = new Spectrum(engine.context.sampleRate, engine.analyser.fftSize);
    debugBars = new DebugBars();
    document.body.append(debugBars.canvas);
  }
  return engine;
}

/** time: milliseconds since page load, passed in by requestAnimationFrame. */
function frame(time: number): void {
  // Capped so a long pause (e.g. a background tab) doesn't cause one giant jump.
  const dt = lastFrameTime ? Math.min((time - lastFrameTime) / 1000, 0.1) : 0;
  lastFrameTime = time;

  if (engine && spectrum && debugBars) {
    engine.update();
    spectrum.update(engine.frequencyDb, dt);
    debugBars.draw(spectrum.levels);
  }

  // Radians per second × seconds elapsed: same speed at any frame rate.
  cube.rotation.x += 0.3 * dt;
  cube.rotation.y += 0.6 * dt;

  sceneManager.render();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

/** Updates buttons and status text from the engine's current state. */
function render(): void {
  const source = engine?.source ?? "none";
  const playing = engine?.isPlaying ?? false;

  playButton.disabled = source !== "file";
  playButton.textContent = source === "file" && playing ? "Pause" : "Play";
  captureButton.textContent = source === "capture" ? "Stop capture" : "Capture audio";

  status.classList.remove("error");
  if (source === "file") status.textContent = `${playing ? "Playing" : "Paused"}: ${fileName}`;
  else if (source === "capture") status.textContent = "Capturing shared audio";
  else status.textContent = "Load a file or capture audio to start";
}

function showError(error: unknown): void {
  // The user closing the share dialog is not really an error.
  const cancelled = error instanceof DOMException && error.name === "NotAllowedError";
  status.textContent = cancelled ? "Capture cancelled" : error instanceof Error ? error.message : String(error);
  status.classList.toggle("error", !cancelled);
}

fileInput.addEventListener("change", async () => {
  const file = fileInput.files?.[0];
  fileInput.value = ""; // so picking the same file again still fires "change"
  if (!file) return;

  fileName = file.name;
  try {
    await getEngine().loadFile(file);
    render();
  } catch (error) {
    render();
    showError(error);
  }
});

playButton.addEventListener("click", async () => {
  const audio = getEngine();
  try {
    if (audio.isPlaying) audio.pause();
    else await audio.play();
  } catch (error) {
    showError(error);
  }
});

captureButton.addEventListener("click", async () => {
  const audio = getEngine();
  try {
    if (audio.source === "capture") audio.stopCapture();
    else await audio.startCapture();
    render();
  } catch (error) {
    render();
    showError(error);
  }
});
