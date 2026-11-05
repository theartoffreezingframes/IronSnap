import * as THREE from 'three';

/**
 * Animated orbital rings with travelling satellites and tick marks.
 * Radii breathe with the field scale, tilt changes with the visual mode.
 */
const RING_DEFS = [
  { radius: 4.2, tube: 0.008, tilt: [Math.PI / 2.35, 0, 0.2], speed: 0.22, color: 0x22d3ee, ticks: 56 },
  { radius: 5.4, tube: 0.006, tilt: [Math.PI / 1.75, 0.5, -0.25], speed: -0.16, color: 0x3b82f6, ticks: 64 },
  { radius: 6.9, tube: 0.005, tilt: [Math.PI / 2.9, -0.35, 0.5], speed: 0.11, color: 0xa855f7, ticks: 72 },
  { radius: 8.4, tube: 0.004, tilt: [Math.PI / 2.05, 0.9, 0.1], speed: -0.08, color: 0x7dd3fc, ticks: 80 },
];

export class OrbitalRings {
  constructor(scene, { pixelRatio = 1, detail = 'high' } = {}) {
    this.scene = scene;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.rings = [];
    this.pixelRatio = pixelRatio;
    this.scale = 1;
    this.targetScale = 1;
    this.impulseValue = 0;
    this.energy = 1;
    this.colorTargets = [];

    const count = detail === 'low' ? 2 : RING_DEFS.length;
    for (let i = 0; i < count; i++) {
      const def = RING_DEFS[i];
      const pivot = new THREE.Group();
      pivot.rotation.set(...def.tilt);

      const geometry = new THREE.TorusGeometry(def.radius, def.tube, 6, 220);
      const material = new THREE.MeshBasicMaterial({
        color: def.color,
        transparent: true,
        opacity: 0.34 - i * 0.04,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const ring = new THREE.Mesh(geometry, material);
      pivot.add(ring);

      // Tick marks around the ring
      const tickPositions = new Float32Array(def.ticks * 3);
      for (let t = 0; t < def.ticks; t++) {
        const angle = (t / def.ticks) * Math.PI * 2;
        tickPositions[t * 3] = Math.cos(angle) * def.radius;
        tickPositions[t * 3 + 1] = Math.sin(angle) * def.radius;
        tickPositions[t * 3 + 2] = 0;
      }
      const tickGeo = new THREE.BufferGeometry();
      tickGeo.setAttribute('position', new THREE.BufferAttribute(tickPositions, 3));
      const ticks = new THREE.Points(
        tickGeo,
        new THREE.PointsMaterial({
          color: def.color,
          size: 0.05,
          transparent: true,
          opacity: 0.5,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          sizeAttenuation: true,
        }),
      );
      pivot.add(ticks);

      // Satellites
      const satellites = [];
      const satCount = i < 2 ? 2 : 1;
      for (let s = 0; s < satCount; s++) {
        const sat = new THREE.Mesh(
          new THREE.SphereGeometry(0.055 - i * 0.006, 12, 12),
          new THREE.MeshBasicMaterial({
            color: def.color,
            transparent: true,
            opacity: 0.95,
          }),
        );
        pivot.add(sat);
        satellites.push({ mesh: sat, phase: Math.random() * Math.PI * 2, speed: 0.6 + Math.random() * 0.5 });
      }

      this.group.add(pivot);
      this.rings.push({
        pivot,
        ring,
        ticks,
        satellites,
        def,
        baseRadius: def.radius,
        baseOpacity: material.opacity,
      });
      this.colorTargets.push(new THREE.Color(def.color));
    }

    this.modeColors = RING_DEFS.map((d) => new THREE.Color(d.color));
  }

  setMode(mode) {
    const accent = new THREE.Color(mode.accent);
    this.colorTargets = this.rings.map((ring) => accent.clone().lerp(new THREE.Color(ring.def.color), 0.45));
    this.energy = mode.energy;
  }

  setPixelRatio(ratio) {
    this.pixelRatio = ratio;
    for (const ring of this.rings) ring.ticks.material.size = 0.05 * Math.min(1.4, ratio);
  }

  impulse(strength = 1) {
    this.impulseValue = Math.min(1.2, this.impulseValue + strength);
  }

  update(dt, time, { scale = 1, expand = 0, energy = 1, mode = 'NEBULA' } = {}) {
    this.targetScale = scale * (1 + expand * 0.16) + this.impulseValue * 0.5;
    this.scale += (this.targetScale - this.scale) * (1 - Math.exp(-5 * dt));
    this.impulseValue *= Math.pow(0.05, dt);
    this.energy = energy;

    for (let i = 0; i < this.rings.length; i++) {
      const ring = this.rings[i];
      const color = this.colorTargets[i] || this.modeColors[i];
      ring.ring.material.color.lerp(color, Math.min(1, dt * 2));
      ring.ticks.material.color.copy(ring.ring.material.color);

      ring.pivot.rotation.z = ring.def.tilt[2] + Math.sin(time * 0.2 + i) * 0.12;
      ring.pivot.rotation.y = ring.def.tilt[1] + time * ring.def.speed * 0.25 * (0.6 + energy * 0.4);
      ring.pivot.rotation.x = ring.def.tilt[0] + Math.cos(time * 0.15 + i * 0.7) * 0.08;

      const radiusScale = this.scale * (1 + Math.sin(time * 0.7 + i * 1.3) * 0.012);
      ring.ring.scale.setScalar(radiusScale);
      ring.ticks.scale.setScalar(radiusScale);

      ring.ring.material.opacity = ring.baseOpacity * (0.7 + energy * 0.3) * (1 + expand * 0.35);
      ring.ticks.material.opacity = 0.28 + energy * 0.22;

      for (const sat of ring.satellites) {
        const angle = sat.phase + time * sat.speed * (0.4 + energy * 0.6);
        sat.mesh.position.set(
          Math.cos(angle) * ring.def.radius * radiusScale,
          Math.sin(angle) * ring.def.radius * radiusScale,
          0,
        );
        sat.mesh.material.color.lerp(ring.ring.material.color, Math.min(1, dt * 2));
      }
    }

    this.group.rotation.y += dt * 0.02 * (mode === 'ION' ? 2 : 1);
  }

  dispose() {
    this.scene.remove(this.group);
    this.group.traverse((obj) => {
      obj.geometry?.dispose?.();
      obj.material?.dispose?.();
    });
  }
}

export default OrbitalRings;
