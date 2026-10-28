import type * as THREE from "three";
import type { AudioFeatures } from "../audio/features";

/**
 * One visual mode. main.ts only talks to this interface, so modes can be
 * swapped without touching anything else:
 *   current.dispose(); next.init(scene);
 */
export interface Visualizer {
  /** Create 3D objects and add them to the scene. */
  init(scene: THREE.Scene): void;

  /** Animate from the latest audio features. Called every frame. dt: seconds since last frame. */
  update(features: AudioFeatures, dt: number): void;

  /**
   * Remove objects and free their GPU memory. The garbage collector doesn't
   * free GPU buffers: geometries and materials must be disposed explicitly.
   */
  dispose(): void;
}
