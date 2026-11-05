import * as THREE from 'three';

/**
 * ParticleField
 * -------------
 * Tens of thousands of GPU-animated points that morph between an expanded
 * universe and a compressed sphere. All displacement happens in the vertex
 * shader, so the CPU only touches a handful of uniforms per frame.
 */
const vertexShader = /* glsl */ `
  precision highp float;

  attribute float aSeed;
  attribute float aSize;
  attribute float aMix;

  uniform float uTime;
  uniform float uPixelRatio;
  uniform float uScale;
  uniform float uCompress;
  uniform float uExpand;
  uniform float uGrab;
  uniform float uExplode;
  uniform float uWaveRadius;
  uniform float uWaveStrength;
  uniform float uEnergy;
  uniform float uFlatten;
  uniform float uScatter;
  uniform vec3 uPointer;
  uniform float uPointerStrength;
  uniform vec3 uColorA;
  uniform vec3 uColorB;
  uniform vec3 uColorC;

  varying vec3 vColor;
  varying float vAlpha;

  void main() {
    vec3 dir = normalize(position);
    float baseR = length(position);
    float t = uTime;

    // ---- orbital drift ------------------------------------------------
    float spin = t * (0.08 + aSeed * 0.12) * uEnergy;
    float ca = cos(spin);
    float sa = sin(spin);
    vec3 p = vec3(dir.x * ca - dir.z * sa, dir.y, dir.x * sa + dir.z * ca);

    // gentle latitude wave so the cloud is never a perfect sphere
    p.y += sin(t * 0.5 + aSeed * 6.2831) * 0.06;
    p = normalize(p);

    // ---- radius: compress ⇄ expand -------------------------------------
    float shell = mix(1.0, 0.3, uCompress);
    float r = baseR * shell * uScale * (1.0 + uExpand * 0.3);
    r *= 1.0 + 0.04 * sin(t * 1.3 + aSeed * 6.2831);
    r += uScatter * (aSeed - 0.5) * 2.0;

    vec3 world = p * r;
    world.y *= mix(1.0, 0.28, uFlatten);
    world.xz *= mix(1.0, 1.18, uFlatten);

    // ---- shockwave shell ----------------------------------------------
    float wave = exp(-pow((r - uWaveRadius) / 2.1, 2.0)) * uWaveStrength;
    world += p * wave * 2.4;

    // ---- explosion -----------------------------------------------------
    world += p * uExplode * (1.6 + aSeed * 4.5);

    // ---- hand attraction ----------------------------------------------
    float d = distance(world, uPointer);
    float pull = uPointerStrength * smoothstep(7.5, 0.0, d);
    world = mix(world, uPointer, pull * 0.32);

    // ---- colour --------------------------------------------------------
    vec3 col = mix(uColorA, uColorB, aMix);
    col = mix(col, uColorC, smoothstep(3.0, 13.0, r) * 0.55);
    col *= 0.72 + 0.7 * (1.0 - clamp(r / 17.0, 0.0, 1.0));
    col += uColorA * uCompress * 0.35;
    col += vec3(1.0) * uGrab * 0.12;
    vColor = col;
    vAlpha = (0.55 + 0.45 * aSeed) * mix(1.0, 0.9, uCompress) + uExpand * 0.08;

    vec4 mv = modelViewMatrix * vec4(world, 1.0);
    gl_PointSize = aSize * uPixelRatio * (250.0 / max(-mv.z, 1.0));
    gl_PointSize *= mix(1.0, 1.45, uCompress);
    // Hard ceiling: a particle drifting past the lens must not become a
    // screen-filling blob once bloom is applied.
    gl_PointSize = min(gl_PointSize, 46.0 * uPixelRatio);
    gl_Position = projectionMatrix * mv;
  }
`;

const fragmentShader = /* glsl */ `
  precision mediump float;
  varying vec3 vColor;
  varying float vAlpha;
  uniform float uOpacity;

  void main() {
    vec2 uv = gl_PointCoord - vec2(0.5);
    float d = length(uv);
    if (d > 0.5) discard;
    float core = smoothstep(0.5, 0.03, d);
    float halo = pow(max(0.0, 1.0 - d * 2.0), 3.0);
    float alpha = (core * 0.75 + halo * 0.55) * vAlpha * uOpacity;
    gl_FragColor = vec4(vColor * (1.0 + halo * 0.8), alpha);
  }
`;

const DEFAULT_COLORS = { a: '#22d3ee', b: '#3b82f6', c: '#a855f7', radius: [3.1, 12.5] };

export class ParticleField {
  constructor(scene, { count = 18000, pixelRatio = 1, radius = DEFAULT_COLORS.radius } = {}) {
    this.scene = scene;
    this.count = count;

    const positions = new Float32Array(count * 3);
    const seeds = new Float32Array(count);
    const sizes = new Float32Array(count);
    const mixes = new Float32Array(count);

    // Fibonacci sphere for even angular coverage + radial jitter for volume.
    const golden = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < count; i++) {
      const y = 1 - (i / (count - 1)) * 2;
      const radiusAtY = Math.sqrt(Math.max(0, 1 - y * y));
      const theta = golden * i;
      const jitter = 0.75 + Math.random() * 0.6;
      const r = (radius[0] + Math.pow(Math.random(), 0.65) * (radius[1] - radius[0])) * jitter;

      positions[i * 3] = Math.cos(theta) * radiusAtY * r;
      positions[i * 3 + 1] = y * r;
      positions[i * 3 + 2] = Math.sin(theta) * radiusAtY * r;

      seeds[i] = Math.random();
      sizes[i] = 1.1 + Math.pow(Math.random(), 2.2) * 5.2;
      mixes[i] = Math.random();
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
    geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    geometry.setAttribute('aMix', new THREE.BufferAttribute(mixes, 1));
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 40);

    this.uniforms = {
      uTime: { value: 0 },
      uPixelRatio: { value: pixelRatio },
      uScale: { value: 1 },
      uCompress: { value: 0 },
      uExpand: { value: 0 },
      uGrab: { value: 0 },
      uExplode: { value: 0 },
      uWaveRadius: { value: 0 },
      uWaveStrength: { value: 0 },
      uEnergy: { value: 1 },
      uFlatten: { value: 0 },
      uScatter: { value: 0 },
      uPointer: { value: new THREE.Vector3(0, 0, 0) },
      uPointerStrength: { value: 0 },
      uColorA: { value: new THREE.Color(DEFAULT_COLORS.a) },
      uColorB: { value: new THREE.Color(DEFAULT_COLORS.b) },
      uColorC: { value: new THREE.Color(DEFAULT_COLORS.c) },
      uOpacity: { value: 0.94 },
    };

    this.material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.AdditiveBlending,
    });

    this.points = new THREE.Points(geometry, this.material);
    this.points.frustumCulled = false;
    scene.add(this.points);

    this.target = { scale: 1, compress: 0, expand: 0, grab: 0, energy: 1, flatten: 0, pointerStrength: 0 };
    this.current = { ...this.target };
    this.pointerTarget = new THREE.Vector3();
    this.colors = {
      a: new THREE.Color(DEFAULT_COLORS.a),
      b: new THREE.Color(DEFAULT_COLORS.b),
      c: new THREE.Color(DEFAULT_COLORS.c),
    };
    this.colorTargets = { ...this.colors };
    this.wave = { radius: 0, strength: 0, active: false };
    this.explosion = 0;
    this.scatter = 0;
  }

  setPixelRatio(ratio) {
    this.uniforms.uPixelRatio.value = ratio;
  }

  setMode(mode) {
    this.colorTargets.a.set(mode.colorA);
    this.colorTargets.b.set(mode.colorB);
    this.colorTargets.c.set(mode.colorC);
    this.target.energy = mode.energy;
    this.target.flatten = mode.id === 'ION' ? 0.55 : mode.id === 'VOID' ? 0.25 : mode.id === 'QUASAR' ? 0.35 : 0;
    this.target.scatter = mode.id === 'QUASAR' ? 0.7 : 0;
  }

  setTargets(partial) {
    Object.assign(this.target, partial);
  }

  setPointer(worldPosition, strength = 1) {
    this.pointerTarget.copy(worldPosition);
    this.target.pointerStrength = strength;
  }

  /** Radial shockwave travelling outwards through the cloud. */
  pulse(strength = 1) {
    this.wave.radius = 1.2;
    this.wave.strength = Math.min(1.6, strength);
    this.wave.active = true;
  }

  explode(strength = 1) {
    this.explosion = Math.max(this.explosion, Math.min(1.4, strength));
  }

  update(dt, time) {
    const damp = (rate) => 1 - Math.exp(-rate * dt);
    for (const key of Object.keys(this.target)) {
      if (key === 'pointerStrength') continue;
      this.current[key] += (this.target[key] - this.current[key]) * damp(6.5);
    }
    this.current.pointerStrength += (this.target.pointerStrength - this.current.pointerStrength) * damp(9);

    const u = this.uniforms;
    u.uTime.value = time;
    u.uScale.value = this.current.scale;
    u.uCompress.value = this.current.compress;
    u.uExpand.value = this.current.expand;
    u.uGrab.value = this.current.grab;
    u.uEnergy.value = this.current.energy;
    u.uFlatten.value = this.current.flatten;
    u.uScatter.value = this.current.scatter;
    u.uPointerStrength.value = this.current.pointerStrength;
    u.uPointer.value.lerp(this.pointerTarget, 1 - Math.exp(-5 * dt));

    // Colour transitions are eased so mode changes feel like a cross-fade.
    const colorBlend = 1 - Math.exp(-4 * dt);
    this.colors.a.lerp(this.colorTargets.a, colorBlend);
    this.colors.b.lerp(this.colorTargets.b, colorBlend);
    this.colors.c.lerp(this.colorTargets.c, colorBlend);
    u.uColorA.value.copy(this.colors.a);
    u.uColorB.value.copy(this.colors.b);
    u.uColorC.value.copy(this.colors.c);

    if (this.wave.active) {
      this.wave.radius += dt * 16;
      this.wave.strength *= Math.pow(0.06, dt);
      if (this.wave.strength < 0.01 || this.wave.radius > 26) {
        this.wave.active = false;
        this.wave.strength = 0;
      }
    }
    u.uWaveRadius.value = this.wave.radius;
    u.uWaveStrength.value = this.wave.strength;

    this.explosion *= Math.pow(0.02, dt);
    if (this.explosion < 0.002) this.explosion = 0;
    u.uExplode.value = this.explosion;

    this.points.rotation.y += dt * 0.02 * this.current.energy;
  }

  dispose() {
    this.scene.remove(this.points);
    this.points.geometry.dispose();
    this.material.dispose();
  }
}

export default ParticleField;
