import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { FXAAPass } from "three/addons/postprocessing/FXAAPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";

const BACKGROUND = 0x05060a; // matches the page background in style.css

// Bloom: pixels brighter than THRESHOLD get blurred and added back on top (glow).
// The sphere's lit face stays below it; its rim crosses it when the music is loud.
const BLOOM_THRESHOLD = 0.55;
const BLOOM_STRENGTH = 0.9;
const BLOOM_RADIUS = 0.35; // higher spreads a haze over the whole screen
// Bloom blurs every pixel many times; on integrated GPUs that's the most
// expensive part of the frame. A blur has no fine detail, so computing it at
// half width and height (1/4 of the pixels) looks almost the same.
const BLOOM_RESOLUTION_SCALE = 0.5;

/**
 * Adds dithering to the end of a pass's fragment shader. The screen has 256
 * brightness steps per channel, which is too few for the dark, gradual glow: it
 * showed visible bands. Noise smaller than one step makes neighbouring pixels
 * round differently, which blends the bands. It goes in the last pass (where the
 * image is reduced to 256 steps) because a separate full-screen pass costs
 * ~20 fps on integrated GPUs.
 */
function addDithering(material: THREE.ShaderMaterial): void {
  const source = material.fragmentShader.trimEnd();
  if (!source.endsWith("}")) {
    throw new Error("Unexpected shader shape (Three.js update?): dithering could not be added");
  }
  // main() is the last function in Three's pass shaders: insert before its closing brace.
  material.fragmentShader = `${source.slice(0, -1)}
    // Interleaved gradient noise: a cheap per-pixel pattern used in games for dithering.
    float ditherNoise = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
    gl_FragColor.rgb += (ditherNoise - 0.5) / 255.0;
  }`;
}

/**
 * The Three.js basics every visual needs: a scene (what exists), a camera
 * (where we look from), a renderer (draws it to a <canvas> via WebGL),
 * lights, mouse orbit controls, resize handling and bloom post-processing.
 */
export class SceneManager {
  readonly scene = new THREE.Scene();
  // 60° field of view; objects closer than 0.1 or further than 100 units aren't drawn.
  readonly camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
  // No antialias here: with post-processing the scene is drawn off-screen, so the
  // canvas's multisampling only cost GPU time (~10% on integrated GPUs) for no
  // benefit. Edges are smoothed by the FXAA pass instead.
  readonly renderer = new THREE.WebGLRenderer({ antialias: false });

  private readonly container: HTMLElement;
  private readonly controls: OrbitControls;
  private readonly composer: EffectComposer;
  private readonly bloom: UnrealBloomPass;

  constructor(container: HTMLElement) {
    this.container = container;

    // Cap at 2: higher-density screens would cost far more GPU work for no visible gain.
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.append(this.renderer.domElement);

    // scene.background, not renderer.setClearColor: the clear color is converted
    // once for the screen (sRGB) and then reused for the off-screen bloom image,
    // which OutputPass converts again, turning near-black grey. scene.background
    // is converted fresh for whichever target is being drawn.
    this.scene.background = new THREE.Color(BACKGROUND);

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

    // Post-processing chain: draw the scene off-screen, add glow, convert to sRGB
    // for the screen, then smooth edges (FXAA) and dither as the last step.
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), BLOOM_STRENGTH, BLOOM_RADIUS, BLOOM_THRESHOLD);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    // FXAA softens high-contrast pixel steps in the final image. It goes after
    // OutputPass because it's tuned for screen (sRGB) colors. On Intel Iris Xe at
    // 1080p: none ~80 fps, FXAA ~60. MSAA on the scene only was crisper but ~50 fps;
    // it's planned for the Phase 7 high-quality setting.
    const fxaa = new FXAAPass();
    addDithering(fxaa.material);
    this.composer.addPass(fxaa);

    // Fires whenever the container changes size (window resize, layout changes).
    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
  }

  /** Draws one frame. Call once per requestAnimationFrame. */
  render(): void {
    this.controls.update(); // needed every frame for damping
    this.composer.render();
  }

  private resize(): void {
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    if (width === 0 || height === 0) return;

    // Without updating the aspect ratio, the image would stretch.
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(width, height); // sets every pass to full size...
    const pixelRatio = this.renderer.getPixelRatio();
    this.bloom.setSize(
      // ...then shrink just the bloom pass
      width * pixelRatio * BLOOM_RESOLUTION_SCALE,
      height * pixelRatio * BLOOM_RESOLUTION_SCALE,
    );
  }
}
