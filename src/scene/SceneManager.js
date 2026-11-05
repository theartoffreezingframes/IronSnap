import * as THREE from 'three';
import { PostFX } from './PostFX.js';

/**
 * SceneManager — renderer, camera, resize, quality and the hand→world mapping.
 */
export class SceneManager {
  constructor(canvas, { quality = 'high' } = {}) {
    this.canvas = canvas;
    this.quality = quality;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x03060d);

    this.camera = new THREE.PerspectiveCamera(52, 1, 0.1, 200);
    this.camera.position.set(0, 0, 16);
    this.camera.lookAt(0, 0, 0);

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: quality !== 'low',
      alpha: false,
      powerPreference: 'high-performance',
      stencil: false,
    });
    this.renderer.setClearColor(0x03060d, 1);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;

    this.maxPixelRatio = quality === 'low' ? 1.25 : quality === 'medium' ? 1.5 : 1.8;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.maxPixelRatio));

    this.postFX = null;
    if (quality !== 'low') {
      try {
        this.postFX = new PostFX(this.renderer, this.scene, this.camera, {
          strength: quality === 'high' ? 0.55 : 0.45,
          radius: 0.55,
          threshold: 0.32,
        });
      } catch (err) {
        console.warn('[scene] post-processing unavailable, falling back to direct render', err);
        this.postFX = null;
      }
    }

    this.pointer = new THREE.Vector2(0, 0);
    this._tmp = new THREE.Vector3();
    this._resize = this._resize.bind(this);
    this.resizeObserver = new ResizeObserver(this._resize);
    this.resizeObserver.observe(canvas.parentElement || document.body);
    window.addEventListener('resize', this._resize, { passive: true });
    this._resize();
  }

  _resize() {
    const parent = this.canvas.parentElement || document.body;
    const width = Math.max(parent.clientWidth || window.innerWidth, 1);
    const height = Math.max(parent.clientHeight || window.innerHeight, 1);
    this.width = width;
    this.height = height;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.maxPixelRatio));
    this.renderer.setSize(width, height, false);
    this.postFX?.setSize(width, height);
  }

  /** Map normalised screen coords (0..1, y down) onto the world plane z = depth. */
  worldFromScreen(x, y, depth = 0, target = new THREE.Vector3()) {
    this._tmp.set(x * 2 - 1, 1 - y * 2, 0.5).unproject(this.camera);
    this._tmp.sub(this.camera.position).normalize();
    const denominator = Math.abs(this._tmp.z) < 1e-5 ? 1e-5 : this._tmp.z;
    const t = (depth - this.camera.position.z) / denominator;
    return target.copy(this.camera.position).addScaledVector(this._tmp, t);
  }

  rayDirection(x, y, target = new THREE.Vector3()) {
    this._tmp.set(x * 2 - 1, 1 - y * 2, 0.5).unproject(this.camera);
    return target.copy(this._tmp).sub(this.camera.position).normalize();
  }

  setQuality(level) {
    this.quality = level;
    this.maxPixelRatio = level === 'low' ? 1.15 : level === 'medium' ? 1.45 : 1.8;
    this.postFX?.setEnabled(level !== 'low');
    this._resize();
  }

  setExposure(value) {
    this.renderer.toneMappingExposure = value;
  }

  render() {
    if (this.postFX?.enabled) this.postFX.render();
    else this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.resizeObserver.disconnect();
    window.removeEventListener('resize', this._resize);
    this.postFX?.dispose();
    this.renderer.dispose();
  }
}

export default SceneManager;
