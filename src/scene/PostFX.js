import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

/**
 * Bloom pipeline. Wrapped so a driver failure can never take the whole app
 * down — SceneManager simply falls back to a direct render.
 */
export class PostFX {
  constructor(renderer, scene, camera, { strength = 0.8, radius = 0.7, threshold = 0.2 } = {}) {
    this.enabled = true;
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;

    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    this.composer = new EffectComposer(renderer);
    this.composer.renderTarget1.texture.type = THREE.HalfFloatType;
    this.composer.renderTarget2.texture.type = THREE.HalfFloatType;

    this.renderPass = new RenderPass(scene, camera);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), strength, radius, threshold);
    this.outputPass = new OutputPass();

    this.composer.addPass(this.renderPass);
    this.composer.addPass(this.bloom);
    this.composer.addPass(this.outputPass);
    this.setSize(size.x, size.y);
  }

  setSize(width, height) {
    this.composer.setSize(width, height);
    this.bloom.setSize(width, height);
  }

  setEnabled(enabled) {
    this.enabled = enabled;
  }

  setStrength(strength) {
    this.bloom.strength = strength;
  }

  render() {
    this.composer.render();
  }

  dispose() {
    this.composer.dispose?.();
    this.bloom.dispose?.();
    this.outputPass.dispose?.();
  }
}

export default PostFX;
