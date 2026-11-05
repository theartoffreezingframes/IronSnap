import * as THREE from 'three';

/**
 * The central holographic sphere: Fresnel core, two counter-rotating wireframe
 * shells, an equatorial ring and a soft additive halo that reads as "glow".
 * Pinching grabs it — it follows the pinch point, scales with pinch strength
 * and spins with your hand.
 */
const coreVertex = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vViewDir;
  varying vec3 vLocal;
  void main() {
    vLocal = position;
    vNormal = normalize(normalMatrix * normal);
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vViewDir = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }
`;

const coreFragment = /* glsl */ `
  precision highp float;
  varying vec3 vNormal;
  varying vec3 vViewDir;
  varying vec3 vLocal;
  uniform vec3 uColorA;
  uniform vec3 uColorB;
  uniform float uTime;
  uniform float uGrab;
  uniform float uEnergy;
  uniform float uOpacity;

  void main() {
    float fresnel = pow(1.0 - clamp(dot(normalize(vNormal), normalize(vViewDir)), 0.0, 1.0), 2.2);
    float scan = 0.5 + 0.5 * sin(vLocal.y * 16.0 - uTime * 2.4);
    scan = smoothstep(0.72, 1.0, scan) * 0.35;

    float bands = 0.5 + 0.5 * sin(vLocal.x * 9.0 + uTime * 1.4 + vLocal.z * 6.0);

    vec3 color = mix(uColorA, uColorB, fresnel * 0.85 + bands * 0.2);
    color += uColorA * uGrab * 0.4 * fresnel;

    float alpha = (0.05 + fresnel * 0.55 + scan * 0.3) * uOpacity;
    gl_FragColor = vec4(color * (1.0 + uEnergy * 0.12), alpha);
  }
`;

const haloVertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const haloFragment = /* glsl */ `
  precision mediump float;
  varying vec2 vUv;
  uniform vec3 uColor;
  uniform float uOpacity;
  uniform float uTime;
  void main() {
    float d = length(vUv - vec2(0.5)) * 2.0;
    float glow = pow(max(0.0, 1.0 - d), 3.2);
    float ring = smoothstep(0.72, 0.62, d) * smoothstep(0.52, 0.6, d) * 0.35;
    float pulse = 0.85 + 0.15 * sin(uTime * 1.6);
    gl_FragColor = vec4(uColor, (glow * 0.55 + ring) * uOpacity * pulse);
  }
`;

export class Hologram {
  constructor(scene, { pixelRatio = 1 } = {}) {
    this.scene = scene;
    this.root = new THREE.Group();
    this.root.position.set(0, 0, 0);
    scene.add(this.root);

    this.colors = { a: new THREE.Color('#22d3ee'), b: new THREE.Color('#a855f7') };
    this.colorTargets = { a: this.colors.a.clone(), b: this.colors.b.clone() };

    this.uniforms = {
      uColorA: { value: this.colors.a },
      uColorB: { value: this.colors.b },
      uTime: { value: 0 },
      uGrab: { value: 0 },
      uEnergy: { value: 1 },
      uOpacity: { value: 0.38 },
    };

    this.core = new THREE.Mesh(
      new THREE.IcosahedronGeometry(1.25, 4),
      new THREE.ShaderMaterial({
        vertexShader: coreVertex,
        fragmentShader: coreFragment,
        uniforms: this.uniforms,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      }),
    );
    this.root.add(this.core);

    // Solid inner nucleus
    this.nucleus = new THREE.Mesh(
      new THREE.SphereGeometry(0.22, 32, 24),
      new THREE.MeshBasicMaterial({ color: 0x8fe4ff, transparent: true, opacity: 0.28 }),
    );
    this.root.add(this.nucleus);

    // Two wireframe shells
    this.shellA = new THREE.Mesh(
      new THREE.IcosahedronGeometry(2.1, 1),
      new THREE.MeshBasicMaterial({
        color: 0x59e8ff,
        wireframe: true,
        transparent: true,
        opacity: 0.3,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    this.shellB = new THREE.Mesh(
      new THREE.IcosahedronGeometry(2.55, 2),
      new THREE.MeshBasicMaterial({
        color: 0x7c5cff,
        wireframe: true,
        transparent: true,
        opacity: 0.1,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    this.root.add(this.shellA, this.shellB);

    // Equatorial ring
    this.equator = new THREE.Mesh(
      new THREE.TorusGeometry(2.3, 0.008, 8, 220),
      new THREE.MeshBasicMaterial({
        color: 0x9ceaff,
        transparent: true,
        opacity: 0.6,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    this.equator.rotation.x = Math.PI / 2;
    this.root.add(this.equator);

    // Billboard halo
    this.haloUniforms = {
      uColor: { value: this.colors.a.clone() },
      uOpacity: { value: 0.3 },
      uTime: { value: 0 },
    };
    this.halo = new THREE.Mesh(
      new THREE.PlaneGeometry(9, 9),
      new THREE.ShaderMaterial({
        vertexShader: haloVertex,
        fragmentShader: haloFragment,
        uniforms: this.haloUniforms,
        transparent: true,
        depthWrite: false,
        depthTest: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.halo.renderOrder = -1;
    this.root.add(this.halo);

    this.home = new THREE.Vector3(0, 0, 0);
    this.targetPosition = new THREE.Vector3();
    this.targetScale = 1;
    this.grab = 0;
    this.grabTarget = 0;
    this.energy = 1;
    this.spin = new THREE.Vector2();
    this.spinVelocity = new THREE.Vector2();
    this.lastGrabPoint = new THREE.Vector3();
    this.confirm = 0;
    this.pixelRatio = pixelRatio;
  }

  setMode(mode) {
    this.colorTargets.a.set(mode.colorA);
    this.colorTargets.b.set(mode.colorB);
    this.energy = mode.energy;
  }

  setGrab(active, worldPoint, strength = 0) {
    this.grabTarget = active ? Math.max(0.25, strength) : 0;
    if (active && worldPoint) this.targetPosition.copy(worldPoint);
    else this.targetPosition.copy(this.home);
  }

  setScale(scale) {
    this.targetScale = scale;
  }

  triggerConfirm() {
    this.confirm = 1;
  }

  update(dt, time, camera) {
    const ease = (a, b, rate) => a + (b - a) * (1 - Math.exp(-rate * dt));
    this.grab = ease(this.grab, this.grabTarget, 9);

    this.root.position.lerp(this.targetPosition, 1 - Math.exp(-9 * dt));
    this.root.position.y += Math.sin(time * 0.8) * 0.0016;
    const scale = ease(this.root.scale.x, this.targetScale * (1 + this.grab * 0.32 + this.confirm * 0.18), 8);
    this.root.scale.setScalar(scale);

    // Spin: hand movement while grabbed drives inertia.
    if (this.grab > 0.1) {
      const delta = this.targetPosition.clone().sub(this.lastGrabPoint);
      this.spinVelocity.x += delta.y * 0.25;
      this.spinVelocity.y += -delta.x * 0.35;
      this.lastGrabPoint.copy(this.targetPosition);
    }
    this.spinVelocity.multiplyScalar(Math.pow(0.12, dt));
    this.spin.x += this.spinVelocity.x * dt;
    this.spin.y += this.spinVelocity.y * dt;

    this.core.rotation.y += dt * (0.22 + this.energy * 0.16) + this.spin.y * 0.35;
    this.core.rotation.x += dt * 0.1 + this.spin.x * 0.35;
    this.core.rotation.y %= Math.PI * 2;
    this.core.rotation.x %= Math.PI * 2;

    this.shellA.rotation.y -= dt * (0.16 + this.energy * 0.1);
    this.shellA.rotation.x += dt * 0.07;
    this.shellB.rotation.y += dt * 0.11;
    this.shellB.rotation.z -= dt * 0.06;
    this.shellB.scale.setScalar(1 + Math.sin(time * 0.9) * 0.02 + this.grab * 0.06);

    this.equator.rotation.z += dt * 0.35;
    this.equator.rotation.x = Math.PI / 2 + Math.sin(time * 0.5) * 0.12;

    this.nucleus.scale.setScalar(1 + Math.sin(time * 2.1) * 0.06 + this.grab * 0.22 + this.confirm * 0.4);
    this.nucleus.material.opacity = 0.32 + this.grab * 0.3 + this.confirm * 0.3;

    this.uniforms.uTime.value = time;
    this.uniforms.uGrab.value = this.grab;
    this.uniforms.uEnergy.value = this.energy;
    this.haloUniforms.uTime.value = time;
    this.haloUniforms.uOpacity.value = 0.16 + this.grab * 0.3 + this.confirm * 0.4;

    // Colours ease between modes.
    const blend = 1 - Math.exp(-4 * dt);
    this.colors.a.lerp(this.colorTargets.a, blend);
    this.colors.b.lerp(this.colorTargets.b, blend);
    this.shellA.material.color.copy(this.colors.a);
    this.shellB.material.color.copy(this.colors.b);
    this.equator.material.color.copy(this.colors.a).lerp(new THREE.Color(0xffffff), 0.4);
    this.nucleus.material.color.copy(this.colors.a).lerp(new THREE.Color(0xffffff), 0.6);
    this.haloUniforms.uColor.value.copy(this.colors.a);

    if (camera) this.halo.quaternion.copy(camera.quaternion);

    this.confirm *= Math.pow(0.06, dt);
    if (this.confirm < 0.001) this.confirm = 0;
  }

  dispose() {
    this.scene.remove(this.root);
    this.root.traverse((obj) => {
      obj.geometry?.dispose?.();
      obj.material?.dispose?.();
    });
  }
}

export default Hologram;
