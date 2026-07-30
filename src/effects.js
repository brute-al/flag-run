// Lightweight particle system for visual "pizzazz" -- explosions, sparks,
// muzzle flashes, and dust. Purely decorative: nothing in here reads or
// writes any gameplay state (health, obstacles, bullets, etc.), so the
// headless test suite -- which drives Game.update() with no canvas at all --
// never needs to know this file exists. Game.draw() is the only thing that
// ever calls this.draw(); tests never call draw().
export class ParticleSystem {
  constructor() {
    this.particles = [];
  }

  update(dt) {
    for (const p of this.particles) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.drag) {
        p.vx *= p.drag;
        p.vy *= p.drag;
      }
      if (p.spin) p.angle += p.spin * dt;
      p.life -= dt;
    }
    this.particles = this.particles.filter((p) => p.life > 0);
  }

  // A burst of flying debris chips, an expanding shockwave ring, and a few
  // slow smoke puffs -- used for anything getting destroyed (vehicle,
  // turret, building). `scale` lets bigger things (a tank, a turret) throw a
  // bigger burst than a small chunk of building.
  explosion(x, y, color = "#e8843a", scale = 1) {
    const chipCount = Math.round(10 * scale);
    for (let i = 0; i < chipCount; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = (60 + Math.random() * 140) * scale;
      this.particles.push({
        type: "chip",
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        drag: 0.92,
        angle: Math.random() * Math.PI * 2,
        spin: (Math.random() * 2 - 1) * 8,
        size: (3 + Math.random() * 4) * scale,
        color,
        life: 0.5 + Math.random() * 0.4,
        maxLife: 0.9,
      });
    }
    this.particles.push({
      type: "ring",
      x,
      y,
      vx: 0,
      vy: 0,
      radius: 4 * scale,
      growth: 220 * scale,
      color,
      life: 0.35,
      maxLife: 0.35,
    });
    // Slower, longer-lived smoke drifting up a little so the impact site
    // keeps reading as "still smoldering" for a beat after the sharp
    // flash/debris fades.
    const smokeCount = Math.round(4 * scale);
    for (let i = 0; i < smokeCount; i++) {
      const angle = Math.random() * Math.PI * 2;
      this.particles.push({
        type: "smoke",
        x,
        y,
        vx: Math.cos(angle) * 12,
        vy: Math.sin(angle) * 12 - 14,
        drag: 0.96,
        size: (10 + Math.random() * 10) * scale,
        life: 0.6 + Math.random() * 0.4,
        maxLife: 1.0,
      });
    }
  }

  // A small, quick spray at a bullet impact point (building/turret/vehicle
  // hit) -- reads as "that shot actually landed" without a full explosion.
  spark(x, y, color = "#ffd166") {
    for (let i = 0; i < 5; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 60 + Math.random() * 100;
      this.particles.push({
        type: "spark",
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        drag: 0.85,
        size: 2 + Math.random() * 1.5,
        color,
        life: 0.15 + Math.random() * 0.1,
        maxLife: 0.25,
      });
    }
  }

  // A quick bright wedge at the gun tip, oriented along the shot -- reads as
  // a muzzle flash rather than a generic pop. Deliberately very short-lived.
  muzzleFlash(x, y, angle, color = "#ffe8a3") {
    this.particles.push({
      type: "flash",
      x,
      y,
      vx: 0,
      vy: 0,
      angle,
      size: 10,
      color,
      life: 0.06,
      maxLife: 0.06,
    });
  }

  // A single small puff of dust. Meant to be called repeatedly (throttled by
  // the caller, see game.js) behind a fast-moving grounded vehicle.
  dust(x, y) {
    this.particles.push({
      type: "smoke",
      x: x + (Math.random() * 10 - 5),
      y: y + (Math.random() * 10 - 5),
      vx: (Math.random() * 2 - 1) * 8,
      vy: (Math.random() * 2 - 1) * 8,
      drag: 0.95,
      size: 4 + Math.random() * 4,
      color: "dust",
      life: 0.35 + Math.random() * 0.2,
      maxLife: 0.55,
    });
  }

  draw(ctx, camera, canvasW, canvasH) {
    for (const p of this.particles) {
      const s = camera.worldToScreen(p.x, p.y, canvasW, canvasH);
      if (s.x < -40 || s.x > canvasW + 40 || s.y < -40 || s.y > canvasH + 40) continue;
      const lifeFrac = Math.max(0, p.life / p.maxLife);

      if (p.type === "chip") {
        ctx.save();
        ctx.translate(s.x, s.y);
        ctx.rotate(p.angle);
        ctx.globalAlpha = lifeFrac;
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
        ctx.restore();
      } else if (p.type === "ring") {
        const r = p.radius + (1 - lifeFrac) * p.growth;
        ctx.globalAlpha = lifeFrac * 0.6;
        ctx.strokeStyle = p.color;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
        ctx.stroke();
      } else if (p.type === "smoke") {
        ctx.globalAlpha = lifeFrac * (p.color === "dust" ? 0.35 : 0.4);
        ctx.fillStyle = p.color === "dust" ? "#c9c0a0" : "#555248";
        ctx.beginPath();
        ctx.arc(s.x, s.y, p.size * (1.4 - lifeFrac * 0.4), 0, Math.PI * 2);
        ctx.fill();
      } else if (p.type === "spark") {
        ctx.globalAlpha = lifeFrac;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(s.x, s.y, p.size, 0, Math.PI * 2);
        ctx.fill();
      } else if (p.type === "flash") {
        ctx.save();
        ctx.translate(s.x, s.y);
        ctx.rotate(p.angle);
        ctx.globalAlpha = lifeFrac;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(p.size * 1.6, -p.size * 0.5);
        ctx.lineTo(p.size * 1.6, p.size * 0.5);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
      ctx.globalAlpha = 1;
    }
  }
}
