import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

const BACKGROUND = 0x05060a; // matches the page background in style.css

/**
 * The Three.js basics every visual needs: a scene (what exists), a camera
 * (where we look from), a renderer (draws it to a <canvas> via WebGL),
 * lights, mouse orbit controls and resize handling.
 */
export class SceneManager {
  readonly scene = new THREE.Scene();
  // 60° field of view; objects closer than 0.1 or further than 100 units aren't drawn.
  readonly camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
  readonly renderer = new THREE.WebGLRenderer({ antialias: true });

  private readonly container: HTMLElement;
  private readonly controls: OrbitControls;

  constructor(container: HTMLElement) {
    this.container = container;

    // Cap at 2: higher-density screens would cost far more GPU work for no visible gain.
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(BACKGROUND);
    container.append(this.renderer.domElement);

    this.camera.position.set(0, 1.5, 5);

    // Drag to orbit, scroll to zoom. Damping makes the camera glide to a stop.
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;

    // Ambient: weak light from everywhere, so the dark side isn't pure black.
    // Directional: like the sun; the contrast between lit and unlit faces shows the shape.
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.4));
    const sun = new THREE.DirectionalLight(0xffffff, 2.5);
    sun.position.set(3, 4, 5);
    this.scene.add(sun);

    // Fires whenever the container changes size (window resize, layout changes).
    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
  }

  /** Draws one frame. Call once per requestAnimationFrame. */
  render(): void {
    this.controls.update(); // needed every frame for damping
    this.renderer.render(this.scene, this.camera);
  }

  private resize(): void {
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    if (width === 0 || height === 0) return;

    // Without updating the aspect ratio, the image would stretch.
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }
}
