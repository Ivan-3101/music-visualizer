import * as THREE from "three";
import { SimplexNoise } from "three/addons/math/SimplexNoise.js";
import { mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";
import type { AudioFeatures } from "../audio/features";
import type { Visualizer } from "./Visualizer";

const RADIUS = 1.2;
const DETAIL = 24; // icosahedron subdivisions: ~6,000 vertices after merging

const IDLE_BUMP = 0.04; // surface movement with no music, so it "breathes"
const BASS_BUMP = 0.45; // extra bulge at full bass, as a fraction of the radius
const NOISE_SCALE = 1.6; // higher = more, smaller bumps
const NOISE_SPEED = 0.35; // how fast the bump pattern flows; energy speeds it up

const KICK_SIZE = 0.12; // a beat grows the whole sphere by this fraction...
const KICK_DECAY = 7; // ...then springs back at this rate (per second)

const BASE_HUE = 0.58; // blue
const TREBLE_HUE = 0.92; // pink (passing through purple)

/**
 * A sphere whose surface bulges with the bass, kicks outward on beats and
 * shifts color with the treble. The vertices are moved on the CPU every
 * frame (Phase 5a moves this into a GPU shader).
 */
export class PulseSphere implements Visualizer {
  private mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial> | null = null;
  private directions = new Float32Array(0); // each vertex's unit direction from the center
  private readonly noise = new SimplexNoise();
  private time = 0;
  private kick = 0;

  init(scene: THREE.Scene): void {
    // An icosphere spreads triangles evenly (no pinched poles, no seam).
    // Three.js gives every triangle its own copy of shared corners; merge them
    // so the surface can't tear when moved, and so normals come out smooth.
    // uv/normal are deleted first: copies that differ in them wouldn't merge.
    let geometry: THREE.BufferGeometry = new THREE.IcosahedronGeometry(RADIUS, DETAIL);
    geometry.deleteAttribute("uv");
    geometry.deleteAttribute("normal");
    geometry = mergeVertices(geometry);
    geometry.computeVertexNormals();

    const position = geometry.getAttribute("position");
    this.directions = new Float32Array(position.count * 3);
    const v = new THREE.Vector3();
    for (let i = 0; i < position.count; i++) {
      v.fromBufferAttribute(position, i).normalize();
      this.directions.set([v.x, v.y, v.z], i * 3);
    }

    const material = new THREE.MeshStandardMaterial({ roughness: 0.3, metalness: 0.1 });
    this.mesh = new THREE.Mesh(geometry, material);
    scene.add(this.mesh);
  }

  update(features: AudioFeatures, dt: number): void {
    if (!this.mesh) return;
    const { geometry, material } = this.mesh;

    this.time += dt * NOISE_SPEED * (1 + features.energy * 2);
    if (features.beat) this.kick = 1;
    this.kick *= Math.exp(-KICK_DECAY * dt);

    // Push each vertex out along its direction by a noise-shaped amount.
    const bump = IDLE_BUMP + features.bass * BASS_BUMP;
    const position = geometry.getAttribute("position") as THREE.BufferAttribute;
    const positions = position.array as Float32Array;
    const d = this.directions;
    for (let i = 0; i < d.length; i += 3) {
      const n = this.noise.noise4d(d[i] * NOISE_SCALE, d[i + 1] * NOISE_SCALE, d[i + 2] * NOISE_SCALE, this.time);
      const r = RADIUS * (1 + bump * (n * 0.5 + 0.5)); // noise is -1..1; use 0..1 so it only bulges outward
      positions[i] = d[i] * r;
      positions[i + 1] = d[i + 1] * r;
      positions[i + 2] = d[i + 2] * r;
    }
    position.needsUpdate = true; // re-upload positions to the GPU
    geometry.computeVertexNormals(); // so lighting follows the new shape

    this.mesh.scale.setScalar(1 + this.kick * KICK_SIZE);
    this.mesh.rotation.y += dt * (0.1 + features.mid * 0.4);

    const hue = BASE_HUE + (TREBLE_HUE - BASE_HUE) * features.treble;
    material.color.setHSL(hue, 0.7, 0.5);
    material.emissive.setHSL(hue, 0.8, 0.05 + features.energy * 0.2); // glows a little with loudness
  }

  dispose(): void {
    if (!this.mesh) return;
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.mesh.removeFromParent();
    this.mesh = null;
  }
}
