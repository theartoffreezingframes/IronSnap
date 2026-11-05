import * as THREE from 'three';

/**
 * Transient effects: shockwaves, particle explosions, lightning arcs,
 * hand reticles, link beams and confirmation pulses.
 * Everything is pooled — no allocations inside the render loop.
 */

class Shockwave {
  constructor(scene) {
    this.mesh = new THREE.Mesh(
      new THREE.RingGeometry(0.86, 1, 128, 1),
      new THREE.MeshBasicMaterial({
        transparent: true,
        opacity: 0,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    this.mesh.visible = false;
    this.active = false;
    this.life = 0;
    this.duration = 1;
    scene.add(this.mesh);
  }

  spawn(position, { color = 0x22d3ee, size = 8, duration = 1.1, tilt = null }) {
    this.mesh.position.copy(position);
    this.mesh.position.z -= 0.05;
    this.mesh.material.color.set(color);
    this.mesh.rotation.set(
      tilt?.x ?? Math.random() * Math.PI,
      tilt?.y ?? Math.random() * Math.PI,
      tilt?.z ?? Math.random() * Math.PI * 0.3,
    );
    this.mesh.scale.setScalar(0.2);
    this.mesh.visible = true;
    this.active = true;
    this.life = 0;
    this.duration = duration;
    this.size = size;
  }

  update(dt) {
    if (!this.active) return;
    this.life += dt;
    const t = Math.min(1, this.life / this.duration);
    const eased = 1 - Math.pow(1 - t, 2.4);
    this.mesh.scale.setScalar(0.4 + eased * this.size);
    this.mesh.material.opacity = Math.pow(1 - t, 1.8) * 0.8;
    if (t >= 1) {
      this.active = false;
      this.mesh.visible = false;
    }
  }
}

class Explosion {
  constructor(scene, count = 160) {
    const positions = new Float32Array(count * 3);
    const dirs = new Float32Array(count * 3);
    const seeds = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const speed = 0.35 + Math.random() * 1.0;
      dirs[i * 3] = Math.sin(phi) * Math.cos(theta) * speed;
      dirs[i * 3 + 1] = Math.sin(phi) * Math.sin(theta) * speed;
      dirs[i * 3 + 2] = Math.cos(phi) * speed;
      seeds[i] = Math.random();
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aDir', new THREE.BufferAttribute(dirs, 3));
    geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));

    this.uniforms = {
      uProgress: { value: 0 },
      uSize: { value: 1 },
      uColor: { value: new THREE.Color(0x7ef9ff) },
      uPixelRatio: { value: 1 },
    };

    this.points = new THREE.Points(
      geometry,
      new THREE.ShaderMaterial({
        uniforms: this.uniforms,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        vertexShader: /* glsl */ `
          attribute vec3 aDir;
          attribute float aSeed;
          uniform float uProgress;
          uniform float uSize;
          uniform float uPixelRatio;
          varying float vAlpha;
          void main() {
            float p = uProgress;
            float ease = 1.0 - pow(1.0 - p, 2.2);
            vec3 pos = aDir * ease * (7.0 + aSeed * 9.0) * uSize;
            vAlpha = (1.0 - p) * (0.4 + aSeed * 0.6);
            vec4 mv = modelViewMatrix * vec4(pos, 1.0);
            gl_PointSize = (2.2 + aSeed * 4.0) * uPixelRatio * (150.0 / max(-mv.z, 1.0));
            gl_Position = projectionMatrix * mv;
          }
        `,
        fragmentShader: /* glsl */ `
          precision mediump float;
          varying float vAlpha;
          uniform vec3 uColor;
          void main() {
            float d = length(gl_PointCoord - vec2(0.5));
            if (d > 0.5) discard;
            float a = smoothstep(0.5, 0.0, d) * vAlpha;
            gl_FragColor = vec4(uColor * 1.4, a);
          }
        `,
      }),
    );
    this.points.visible = false;
    this.points.frustumCulled = false;
    this.active = false;
    this.life = 0;
    this.duration = 1.2;
    scene.add(this.points);
  }

  spawn(position, { color = 0x7ef9ff, strength = 1, duration = 1.2 } = {}) {
    this.points.position.copy(position);
    this.uniforms.uColor.value.set(color);
    this.uniforms.uProgress.value = 0;
    this.uniforms.uSize.value = strength;
    this.points.visible = true;
    this.active = true;
    this.life = 0;
    this.duration = duration;
  }

  update(dt) {
    if (!this.active) return;
    this.life += dt;
    this.uniforms.uProgress.value = Math.min(1, this.life / this.duration);
    if (this.uniforms.uProgress.value >= 1) {
      this.active = false;
      this.points.visible = false;
    }
  }
}

/** Jagged energy arc between two points (regenerated on a fixed cadence). */
class Lightning {
  constructor(scene, segments = 18, branches = 3) {
    this.segments = segments;
    this.branches = branches;
    this.positions = new Float32Array((segments + 1) * 3);
    this.branchPositions = new Float32Array(branches * 2 * 3);
    this.branchGeometry = new THREE.BufferGeometry();
    this.branchGeometry.setAttribute('position', new THREE.BufferAttribute(this.branchPositions, 3));

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));

    this.group = new THREE.Group();
    this.coreLine = new THREE.Line(
      this.geometry,
      new THREE.LineBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    this.glowLine = new THREE.Line(
      this.geometry,
      new THREE.LineBasicMaterial({
        color: 0x66f0ff,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    this.glowLine.scale.set(1.02, 1.02, 1.02);
    this.haloLine = new THREE.Line(
      this.geometry,
      new THREE.LineBasicMaterial({
        color: 0x2ee6ff,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    this.haloLine.position.z = -0.02;
    this.branchLine = new THREE.LineSegments(
      this.branchGeometry,
      new THREE.LineBasicMaterial({
        color: 0x9ae6ff,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    this.group.add(this.haloLine, this.glowLine, this.coreLine, this.branchLine);
    this.group.visible = false;
    scene.add(this.group);

    this.active = false;
    this.color = new THREE.Color(0x66f0ff);
    this.lastRegen = -1;
    this.intensity = 0;
  }

  setColor(color) {
    this.color.set(color);
    this.glowLine.material.color.copy(this.color);
    this.branchLine.material.color.copy(this.color);
    this.haloLine.material.color.copy(this.color).lerp(new THREE.Color(0xffffff), 0.35);
  }

  setActive(active) {
    this.active = active;
    this.group.visible = active;
    this.intensity += active ? 0.2 : -0.2;
    this.intensity = Math.max(0, Math.min(1, this.intensity));
    if (!active) {
      this.coreLine.material.opacity = 0;
      this.glowLine.material.opacity = 0;
      this.haloLine.material.opacity = 0;
      this.branchLine.material.opacity = 0;
    }
  }

  _generate(a, b, time) {
    const { segments } = this;
    const points = [];
    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      points.push(new THREE.Vector3().lerpVectors(a, b, t));
    }
    const length = a.distanceTo(b) || 1;
    const jitter = length * 0.16;
    for (let pass = 0; pass < 3; pass++) {
      const step = Math.pow(2, pass);
      for (let i = step; i < segments; i += step * 2) {
        const offset = new THREE.Vector3(
          (Math.random() - 0.5) * jitter,
          (Math.random() - 0.5) * jitter,
          (Math.random() - 0.5) * jitter,
        );
        points[i].add(offset.multiplyScalar(1 / step));
      }
    }
    for (let i = 0; i <= segments; i++) {
      this.positions[i * 3] = points[i].x;
      this.positions[i * 3 + 1] = points[i].y;
      this.positions[i * 3 + 2] = points[i].z;
    }
    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.computeBoundingSphere();

    const dir = new THREE.Vector3().subVectors(b, a);
    for (let i = 0; i < this.branches; i++) {
      const startIndex = 2 + Math.floor(Math.random() * (segments - 4));
      const start = points[startIndex];
      const end = start
        .clone()
        .add(
          new THREE.Vector3(
            (Math.random() - 0.5) * length * 0.5,
            (Math.random() - 0.5) * length * 0.5,
            (Math.random() - 0.5) * length * 0.5,
          ),
        )
        .addScaledVector(dir, 0.15);
      const base = i * 6;
      this.branchPositions[base] = start.x;
      this.branchPositions[base + 1] = start.y;
      this.branchPositions[base + 2] = start.z;
      this.branchPositions[base + 3] = end.x;
      this.branchPositions[base + 4] = end.y;
      this.branchPositions[base + 5] = end.z;
    }
    this.branchGeometry.attributes.position.needsUpdate = true;
    this.branchGeometry.computeBoundingSphere();
    this.lastRegen = time;
  }

  update(dt, time, a, b) {
    if (!this.active || !a || !b) return;
    if (time - this.lastRegen > 0.045) this._generate(a, b, time);
    const flicker = 0.7 + Math.random() * 0.3;
    this.coreLine.material.opacity = flicker;
    this.glowLine.material.opacity = flicker * 0.85;
    this.haloLine.material.opacity = flicker * 0.35;
    this.branchLine.material.opacity = flicker * 0.65;
  }
}

class Reticle {
  constructor(scene) {
    this.group = new THREE.Group();
    this.ring = new THREE.Mesh(
      new THREE.RingGeometry(0.3, 0.34, 48),
      new THREE.MeshBasicMaterial({
        color: 0x22d3ee,
        transparent: true,
        opacity: 0,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    this.inner = new THREE.Mesh(
      new THREE.RingGeometry(0.06, 0.09, 24),
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    this.group.add(this.ring, this.inner);
    this.group.visible = false;
    scene.add(this.group);
    this.opacity = 0;
    this.targetOpacity = 0;
  }

  set(position, color, active) {
    if (position) this.group.position.copy(position);
    this.ring.material.color.set(color);
    this.targetOpacity = active ? 0.85 : 0;
    this.group.visible = active || this.opacity > 0.02;
  }

  update(dt, time) {
    this.opacity += (this.targetOpacity - this.opacity) * Math.min(1, dt * 8);
    this.ring.material.opacity = this.opacity * 0.8;
    this.inner.material.opacity = this.opacity;
    this.ring.scale.setScalar(1 + Math.sin(time * 3) * 0.06);
    this.group.rotation.z = time * 0.8;
    if (this.opacity < 0.02 && this.targetOpacity === 0) this.group.visible = false;
  }
}

class Beam {
  constructor(scene) {
    this.positions = new Float32Array(2 * 3);
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.line = new THREE.Line(
      this.geometry,
      new THREE.LineBasicMaterial({
        color: 0x22d3ee,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    this.line.visible = false;
    this.line.frustumCulled = false;
    scene.add(this.line);
    this.opacity = 0;
    this.targetOpacity = 0;
  }

  set(from, to, color, strength = 1) {
    this.positions[0] = from.x;
    this.positions[1] = from.y;
    this.positions[2] = from.z;
    this.positions[3] = to.x;
    this.positions[4] = to.y;
    this.positions[5] = to.z;
    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.computeBoundingSphere();
    this.line.material.color.set(color);
    this.targetOpacity = 0.14 + strength * 0.3;
    this.line.visible = true;
  }

  hide() {
    this.targetOpacity = 0;
  }

  update(dt) {
    this.opacity += (this.targetOpacity - this.opacity) * Math.min(1, dt * 5);
    this.line.material.opacity = this.opacity;
    if (this.opacity < 0.01) this.line.visible = false;
  }
}

export class Effects {
  constructor(scene, { pixelRatio = 1, quality = 'high' } = {}) {
    this.scene = scene;
    this.pixelRatio = pixelRatio;
    this.mode = { colorA: '#22d3ee', colorB: '#a855f7', accent: 0x22d3ee };

    this.shockwaves = Array.from({ length: 6 }, () => new Shockwave(scene));
    this.explosions = Array.from({ length: 4 }, () => new Explosion(scene, quality === 'low' ? 80 : 160));
    this.lightnings = [new Lightning(scene), new Lightning(scene)];
    this.reticles = [new Reticle(scene), new Reticle(scene)];
    this.beams = [new Beam(scene), new Beam(scene)];
    this.confirmRings = Array.from({ length: 2 }, () => new Shockwave(scene));

    for (const explosion of this.explosions) explosion.uniforms.uPixelRatio.value = pixelRatio;
  }

  setPixelRatio(ratio) {
    this.pixelRatio = ratio;
    for (const explosion of this.explosions) explosion.uniforms.uPixelRatio.value = ratio;
  }

  setMode(mode) {
    this.mode = mode;
    for (const lightning of this.lightnings) lightning.setColor(mode.colorA);
    for (const reticle of this.reticles) reticle.ring.material.color.set(mode.colorA);
  }

  shockwave(position, opts = {}) {
    const target = this.shockwaves.find((s) => !s.active) || this.shockwaves[0];
    target.spawn(position, { color: opts.color ?? this.mode.accent, ...opts });
  }

  explode(position, opts = {}) {
    const target = this.explosions.find((e) => !e.active) || this.explosions[0];
    target.spawn(position, { color: opts.color ?? this.mode.colorA, ...opts });
    this.shockwave(position, { color: opts.color ?? this.mode.accent, size: 6 + (opts.strength ?? 1) * 5 });
  }

  confirm(position, color = 0x22ffb2) {
    const target = this.confirmRings.find((s) => !s.active) || this.confirmRings[0];
    target.spawn(position, { color, size: 7, duration: 1.5, tilt: { x: Math.PI / 2, y: 0, z: 0 } });
    this.shockwave(position, { color, size: 4.5, duration: 0.9 });
  }

  lightning(index, from, to, color, active) {
    const arc = this.lightnings[index % this.lightnings.length];
    if (!arc) return;
    if (color) arc.setColor(color);
    arc.setActive(active);
    if (active) arc.pending = { from, to };
  }

  reticle(index, position, color, active) {
    const reticle = this.reticles[index % this.reticles.length];
    if (!reticle) return;
    reticle.set(position, color, active);
  }

  beam(index, from, to, color, strength = 1) {
    const beam = this.beams[index % this.beams.length];
    if (!beam) return;
    beam.set(from, to, color, strength);
  }

  hideBeam(index) {
    this.beams[index % this.beams.length]?.hide();
  }

  update(dt, time) {
    for (const s of this.shockwaves) s.update(dt);
    for (const s of this.confirmRings) s.update(dt);
    for (const e of this.explosions) e.update(dt);
    for (const arc of this.lightnings) {
      const pending = arc.pending;
      if (arc.active && pending) arc.update(dt, time, pending.from, pending.to);
    }
    for (const r of this.reticles) r.update(dt, time);
    for (const b of this.beams) b.update(dt);
  }

  reset() {
    for (const s of [...this.shockwaves, ...this.confirmRings]) {
      s.active = false;
      s.mesh.visible = false;
    }
    for (const e of this.explosions) {
      e.active = false;
      e.points.visible = false;
    }
    for (const arc of this.lightnings) arc.setActive(false);
    for (const r of this.reticles) r.set(null, 0x22d3ee, false);
    for (const b of this.beams) b.hide();
  }

  dispose() {
    this.reset();
    const dispose = (obj) => {
      obj.geometry?.dispose?.();
      obj.material?.dispose?.();
    };
    for (const s of [...this.shockwaves, ...this.confirmRings]) dispose(s.mesh);
    for (const e of this.explosions) dispose(e.points);
    for (const arc of this.lightnings) {
      dispose(arc.geometry);
      dispose(arc.branchGeometry);
      this.scene.remove(arc.group);
    }
    for (const r of this.reticles) {
      r.group.traverse(dispose);
      this.scene.remove(r.group);
    }
    for (const b of this.beams) {
      dispose(b.line);
      this.scene.remove(b.line);
    }
  }
}

export default Effects;
