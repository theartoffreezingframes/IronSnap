import * as THREE from 'three';

/**
 * Deep-space backdrop: a shader-drawn nebula dome plus a twinkling star shell.
 * Both are cheap (one quad-sphere + one point cloud) and react to visual modes.
 */
const domeVertex = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const domeFragment = /* glsl */ `
  precision highp float;
  varying vec3 vDir;
  uniform float uTime;
  uniform vec3 uColorTop;
  uniform vec3 uColorBottom;
  uniform vec3 uColorAccent;
  uniform float uEnergy;

  float hash(vec3 p) {
    p = fract(p * 0.3183099 + 0.1);
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }

  float noise(vec3 x) {
    vec3 i = floor(x);
    vec3 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(hash(i + vec3(0,0,0)), hash(i + vec3(1,0,0)), f.x),
          mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
      mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x),
          mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
  }

  float fbm(vec3 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 4; i++) {
      v += a * noise(p);
      p *= 2.02;
      a *= 0.5;
    }
    return v;
  }

  void main() {
    vec3 dir = normalize(vDir);
    float h = clamp(dir.y * 0.5 + 0.5, 0.0, 1.0);
    vec3 color = mix(uColorBottom, uColorTop, pow(h, 1.6));

    float clouds = fbm(dir * 2.6 + vec3(0.0, uTime * 0.008, uTime * 0.004));
    clouds = smoothstep(0.42, 0.95, clouds);
    color += uColorAccent * clouds * (0.16 + 0.12 * uEnergy);

    float glow = fbm(dir * 5.0 - vec3(uTime * 0.012, 0.0, 0.0));
    color += uColorAccent * pow(glow, 4.0) * 0.22 * uEnergy;

    // Vignette towards the poles keeps the HUD readable.
    float vig = smoothstep(1.25, 0.15, length(dir.xy));
    color *= mix(0.55, 1.0, vig);

    gl_FragColor = vec4(color, 1.0);
  }
`;

const starVertex = /* glsl */ `
  attribute float aSeed;
  attribute float aSize;
  uniform float uTime;
  uniform float uPixelRatio;
  uniform float uEnergy;
  varying float vAlpha;
  void main() {
    vec3 p = position;
    float twinkle = 0.55 + 0.45 * sin(uTime * (0.6 + aSeed * 2.2) + aSeed * 12.0);
    vAlpha = twinkle * (0.35 + 0.65 * aSeed);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_PointSize = aSize * uPixelRatio * (170.0 / -mv.z) * (0.8 + 0.4 * twinkle);
    gl_Position = projectionMatrix * mv;
  }
`;

const starFragment = /* glsl */ `
  precision mediump float;
  varying float vAlpha;
  uniform vec3 uColor;
  void main() {
    float d = length(gl_PointCoord - vec2(0.5));
    if (d > 0.5) discard;
    float a = smoothstep(0.5, 0.0, d);
    gl_FragColor = vec4(uColor, a * vAlpha * 0.9);
  }
`;

export class Backdrop {
  constructor(scene, { stars = 2600, pixelRatio = 1 } = {}) {
    this.scene = scene;

    this.domeUniforms = {
      uTime: { value: 0 },
      uColorTop: { value: new THREE.Color(0x061223) },
      uColorBottom: { value: new THREE.Color(0x01030a) },
      uColorAccent: { value: new THREE.Color(0x1e4f7a) },
      uEnergy: { value: 1 },
    };
    this.dome = new THREE.Mesh(
      new THREE.SphereGeometry(70, 48, 32),
      new THREE.ShaderMaterial({
        vertexShader: domeVertex,
        fragmentShader: domeFragment,
        uniforms: this.domeUniforms,
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
      }),
    );
    this.dome.frustumCulled = false;
    scene.add(this.dome);

    // Star shell
    const positions = new Float32Array(stars * 3);
    const seeds = new Float32Array(stars);
    const sizes = new Float32Array(stars);
    for (let i = 0; i < stars; i++) {
      const r = 26 + Math.random() * 38;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta) * 0.75;
      positions[i * 3 + 2] = r * Math.cos(phi);
      seeds[i] = Math.random();
      sizes[i] = 1.2 + Math.random() * 3.0;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
    geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));

    this.starUniforms = {
      uTime: { value: 0 },
      uPixelRatio: { value: pixelRatio },
      uEnergy: { value: 1 },
      uColor: { value: new THREE.Color(0xa9d8ff) },
    };
    this.stars = new THREE.Points(
      geometry,
      new THREE.ShaderMaterial({
        vertexShader: starVertex,
        fragmentShader: starFragment,
        uniforms: this.starUniforms,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.stars.frustumCulled = false;
    scene.add(this.stars);
  }

  setMode(mode) {
    this.domeUniforms.uColorTop.value.set(mode.colors.top);
    this.domeUniforms.uColorBottom.value.set(mode.colors.bottom);
    this.domeUniforms.uColorAccent.value.set(mode.colors.accent);
    this.starUniforms.uColor.value.set(mode.colors.star || '#a9d8ff');
  }

  setPixelRatio(ratio) {
    this.starUniforms.uPixelRatio.value = ratio;
  }

  update(dt, time, { energy = 1, expand = 0 } = {}) {
    this.domeUniforms.uTime.value = time;
    this.starUniforms.uTime.value = time;
    this.domeUniforms.uEnergy.value = energy;
    this.dome.rotation.y = time * 0.006;
    this.stars.rotation.y = time * 0.012;
    this.stars.rotation.z = Math.sin(time * 0.05) * 0.02;
    const scale = 1 + expand * 0.05;
    this.stars.scale.setScalar(scale);
  }

  dispose() {
    this.scene.remove(this.dome, this.stars);
    this.dome.geometry.dispose();
    this.dome.material.dispose();
    this.stars.geometry.dispose();
    this.stars.material.dispose();
  }
}

export default Backdrop;
