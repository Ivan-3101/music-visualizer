import * as THREE from "three";
import { mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";
import type { AudioFeatures } from "../audio/features";
import type { Visualizer } from "./Visualizer";

// Shared with PulseSphereCPU so the two versions behave the same.
export const RADIUS = 1.2;
export const IDLE_BUMP = 0.04; // surface movement with no music, so it "breathes"
export const BASS_BUMP = 0.45; // extra bulge at full bass, as a fraction of the radius
export const NOISE_SCALE = 1.6; // higher = more, smaller bumps
export const NOISE_SPEED = 0.35; // how fast the bump pattern flows; energy speeds it up
export const KICK_SIZE = 0.12; // a beat grows the whole sphere by this fraction...
export const KICK_DECAY = 7; // ...then springs back at this rate (per second)

const BASE_HUE = 0.58; // blue
const TREBLE_HUE = 0.92; // pink (passing through purple)

/** Hue (0..1) for a treble level: blue when there's none, pink at full. */
export function sphereHue(treble: number): number {
  return BASE_HUE + (TREBLE_HUE - BASE_HUE) * treble;
}

// The GPU can afford far more vertices than the CPU version (~42,000 vs ~6,000).
const DETAIL = 64;
const LIGHT_DIRECTION = new THREE.Vector3(3, 4, 5).normalize(); // same as SceneManager's sun

// 3D simplex noise: smooth randomness, nearby points get similar values.
// Copyright (C) 2011 Ashima Arts. Author: Ian McEwan, Ashima Arts.
// Distributed under the MIT License. https://github.com/ashima/webgl-noise
const simplexNoise = /* glsl */ `
  vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec4 permute(vec4 x) { return mod289(((x * 34.0) + 1.0) * x); }
  vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

  float snoise(vec3 v) {
    const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
    const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);

    vec3 i = floor(v + dot(v, C.yyy));
    vec3 x0 = v - i + dot(i, C.xxx);

    vec3 g = step(x0.yzx, x0.xyz);
    vec3 l = 1.0 - g;
    vec3 i1 = min(g.xyz, l.zxy);
    vec3 i2 = max(g.xyz, l.zxy);

    vec3 x1 = x0 - i1 + C.xxx;
    vec3 x2 = x0 - i2 + C.yyy;
    vec3 x3 = x0 - D.yyy;

    i = mod289(i);
    vec4 p = permute(permute(permute(
        i.z + vec4(0.0, i1.z, i2.z, 1.0))
      + i.y + vec4(0.0, i1.y, i2.y, 1.0))
      + i.x + vec4(0.0, i1.x, i2.x, 1.0));

    float n_ = 0.142857142857;
    vec3 ns = n_ * D.wyz - D.xzx;

    vec4 j = p - 49.0 * floor(p * ns.z * ns.z);

    vec4 x_ = floor(j * ns.z);
    vec4 y_ = floor(j - 7.0 * x_);

    vec4 x = x_ * ns.x + ns.yyyy;
    vec4 y = y_ * ns.x + ns.yyyy;
    vec4 h = 1.0 - abs(x) - abs(y);

    vec4 b0 = vec4(x.xy, y.xy);
    vec4 b1 = vec4(x.zw, y.zw);

    vec4 s0 = floor(b0) * 2.0 + 1.0;
    vec4 s1 = floor(b1) * 2.0 + 1.0;
    vec4 sh = -step(h, vec4(0.0));

    vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
    vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;

    vec3 p0 = vec3(a0.xy, h.x);
    vec3 p1 = vec3(a0.zw, h.y);
    vec3 p2 = vec3(a1.xy, h.z);
    vec3 p3 = vec3(a1.zw, h.w);

    vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
    p0 *= norm.x;
    p1 *= norm.y;
    p2 *= norm.z;
    p3 *= norm.w;

    vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
    m = m * m;
    return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
  }
`;

// Runs once per vertex: push it outward by noise, and work out the new surface normal.
const vertexShader = /* glsl */ `
  uniform float uTime;
  uniform float uBump;
  uniform float uRadius;
  uniform float uNoiseScale;

  varying vec3 vNormal;        // world space, for lighting
  varying vec3 vWorldPosition;

  ${simplexNoise}

  // Same math as the CPU version: radius × (1 + bump × noise in 0..1).
  // Sliding the noise field through the sphere over time makes blobs swell and fade.
  vec3 displaced(vec3 direction) {
    float n = snoise(direction * uNoiseScale + vec3(0.0, 0.0, uTime));
    return direction * uRadius * (1.0 + uBump * (n * 0.5 + 0.5));
  }

  void main() {
    vec3 direction = normalize(position);
    vec3 p = displaced(direction);

    // New normal: displace two nearby points; the edges to them lie along the
    // new surface, so their cross product points straight out of it.
    vec3 helper = abs(direction.y) < 0.99 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
    vec3 tangent = normalize(cross(helper, direction));
    vec3 bitangent = cross(direction, tangent);
    vec3 pTangent = displaced(normalize(direction + tangent * 0.01));
    vec3 pBitangent = displaced(normalize(direction + bitangent * 0.01));
    vec3 normal = normalize(cross(pTangent - p, pBitangent - p));

    vec4 world = modelMatrix * vec4(p, 1.0);
    vWorldPosition = world.xyz;
    vNormal = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

// Runs once per pixel: our own lighting (ShaderMaterial ignores the scene's lights).
const fragmentShader = /* glsl */ `
  uniform vec3 uColor;
  uniform float uGlow;
  uniform vec3 uLightDirection;

  varying vec3 vNormal;
  varying vec3 vWorldPosition;

  void main() {
    vec3 normal = normalize(vNormal); // blending across the triangle shortens it
    vec3 toCamera = normalize(cameraPosition - vWorldPosition);

    float diffuse = max(dot(normal, uLightDirection), 0.0);                              // faces the light
    float specular = pow(max(dot(normal, normalize(uLightDirection + toCamera)), 0.0), 48.0); // shiny highlight
    float rim = pow(1.0 - max(dot(normal, toCamera), 0.0), 3.0);                          // edges glow

    vec3 color = uColor * (0.12 + 0.88 * diffuse)
               + vec3(specular * 0.12) // kept low: bloom amplifies highlights
               + uColor * rim * (1.0 + uGlow * 5.0); // loud = rim brighter than the bloom threshold = glow
    gl_FragColor = vec4(color, 1.0);

    #include <colorspace_fragment>
  }
`;

/**
 * GPU version of the Pulse Sphere. JavaScript only updates a few uniforms
 * per frame; the vertex shader moves every vertex in parallel on the GPU.
 */
export class PulseSphere implements Visualizer {
  private mesh: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial> | null = null;
  private time = 0;
  private kick = 0;

  private readonly uniforms = {
    uTime: { value: 0 },
    uBump: { value: IDLE_BUMP },
    uRadius: { value: RADIUS },
    uNoiseScale: { value: NOISE_SCALE },
    uColor: { value: new THREE.Color() },
    uGlow: { value: 0 },
    uLightDirection: { value: LIGHT_DIRECTION },
  };

  init(scene: THREE.Scene): void {
    // Merging shared corners means each vertex is computed once instead of ~6 times.
    let geometry: THREE.BufferGeometry = new THREE.IcosahedronGeometry(RADIUS, DETAIL);
    geometry.deleteAttribute("uv");
    geometry.deleteAttribute("normal");
    geometry = mergeVertices(geometry);

    const material = new THREE.ShaderMaterial({ vertexShader, fragmentShader, uniforms: this.uniforms });
    this.mesh = new THREE.Mesh(geometry, material);
    scene.add(this.mesh);
  }

  update(features: AudioFeatures, dt: number): void {
    if (!this.mesh) return;

    this.time += dt * NOISE_SPEED * (1 + features.energy * 2);
    if (features.beat) this.kick = 1;
    this.kick *= Math.exp(-KICK_DECAY * dt);

    this.uniforms.uTime.value = this.time;
    this.uniforms.uBump.value = IDLE_BUMP + features.bass * BASS_BUMP;
    this.uniforms.uColor.value.setHSL(sphereHue(features.treble), 0.7, 0.5);
    this.uniforms.uGlow.value = features.energy;

    this.mesh.scale.setScalar(1 + this.kick * KICK_SIZE);
    this.mesh.rotation.y += dt * (0.1 + features.mid * 0.4);
  }

  dispose(): void {
    if (!this.mesh) return;
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.mesh.removeFromParent();
    this.mesh = null;
  }
}
