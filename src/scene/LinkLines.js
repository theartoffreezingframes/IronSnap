import * as THREE from 'three';

/**
 * Glowing connector lines drawn between neighbouring particles.
 * Progress-based dashes are generated in the fragment shader, so the CPU
 * never rewrites a single vertex after construction.
 */
const vertexShader = /* glsl */ `
  attribute float aProgress;
  attribute float aOffset;
  varying float vProgress;
  varying float vOffset;
  varying float vFade;
  void main() {
    vProgress = aProgress;
    vOffset = aOffset;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vFade = clamp(1.0 - (-mv.z - 4.0) / 26.0, 0.0, 1.0);
    gl_Position = projectionMatrix * mv;
  }
`;

const fragmentShader = /* glsl */ `
  precision mediump float;
  varying float vProgress;
  varying float vOffset;
  varying float vFade;
  uniform vec3 uColor;
  uniform float uTime;
  uniform float uOpacity;
  uniform float uSpeed;
  void main() {
    float dash = fract(vProgress * 2.4 - uTime * uSpeed + vOffset);
    float on = smoothstep(0.0, 0.18, dash) * smoothstep(1.0, 0.72, dash);
    float ends = smoothstep(0.0, 0.12, vProgress) * smoothstep(1.0, 0.88, vProgress);
    float alpha = on * ends * uOpacity * vFade;
    if (alpha < 0.004) discard;
    gl_FragColor = vec4(uColor, alpha);
  }
`;

export class LinkLines {
  constructor(scene, { count = 1200, radius = [3.1, 12.5], pixelRatio = 1 } = {}) {
    this.scene = scene;
    this.count = count;

    const positions = new Float32Array(count * 2 * 3);
    const progress = new Float32Array(count * 2);
    const offsets = new Float32Array(count * 2);

    for (let i = 0; i < count; i++) {
      const r = radius[0] + Math.pow(Math.random(), 0.7) * (radius[1] - radius[0]);
      const dir = randomDirection();
      const spread = 0.07 + Math.random() * 0.16;
      const dir2 = normalize({
        x: dir.x + (Math.random() - 0.5) * spread,
        y: dir.y + (Math.random() - 0.5) * spread,
        z: dir.z + (Math.random() - 0.5) * spread,
      });
      const r2 = r * (0.94 + Math.random() * 0.12);

      const base = i * 6;
      positions[base] = dir.x * r;
      positions[base + 1] = dir.y * r;
      positions[base + 2] = dir.z * r;
      positions[base + 3] = dir2.x * r2;
      positions[base + 4] = dir2.y * r2;
      positions[base + 5] = dir2.z * r2;

      progress[i * 2] = 0;
      progress[i * 2 + 1] = 1;
      const offset = Math.random();
      offsets[i * 2] = offset;
      offsets[i * 2 + 1] = offset;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aProgress', new THREE.BufferAttribute(progress, 1));
    geometry.setAttribute('aOffset', new THREE.BufferAttribute(offsets, 1));
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 40);

    this.uniforms = {
      uColor: { value: new THREE.Color('#4fd1ff') },
      uTime: { value: 0 },
      uOpacity: { value: 0.28 },
      uSpeed: { value: 0.22 },
    };

    this.material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    this.lines = new THREE.LineSegments(geometry, this.material);
    this.lines.frustumCulled = false;
    scene.add(this.lines);

    this.targetOpacity = 0.28;
    this.baseColor = new THREE.Color('#4fd1ff');
    this.targetColor = this.baseColor.clone();
  }

  setMode(mode) {
    this.targetColor.set(mode.colorA);
  }

  setOpacity(value) {
    this.targetOpacity = value;
  }

  setPixelRatio() {
    /* no-op: line width is not adjustable on most platforms */
  }

  update(dt, time, { scale = 1, expand = 0, energy = 1 } = {}) {
    this.uniforms.uTime.value = time;
    this.uniforms.uSpeed.value = 0.18 + energy * 0.14 + expand * 0.2;
    this.uniforms.uOpacity.value += (this.targetOpacity * (0.55 + expand * 0.6 + energy * 0.2) - this.uniforms.uOpacity.value) * Math.min(1, dt * 3);
    this.uniforms.uColor.value.lerp(this.targetColor, Math.min(1, dt * 2));

    this.lines.scale.setScalar(scale);
    this.lines.rotation.y += dt * 0.03 * energy;
    this.lines.rotation.x = Math.sin(time * 0.12) * 0.05;
  }

  dispose() {
    this.scene.remove(this.lines);
    this.lines.geometry.dispose();
    this.material.dispose();
  }
}

function randomDirection() {
  const theta = Math.random() * Math.PI * 2;
  const phi = Math.acos(2 * Math.random() - 1);
  return {
    x: Math.sin(phi) * Math.cos(theta),
    y: Math.cos(phi),
    z: Math.sin(phi) * Math.sin(theta),
  };
}

function normalize(v) {
  const len = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / len, y: v.y / len, z: v.z / len };
}

export default LinkLines;
