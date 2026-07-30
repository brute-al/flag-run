// Simple lerp-follow camera in world space.
export class Camera {
  constructor(x, y) {
    this.x = x;
    this.y = y;
    this.smoothing = 4.5; // higher = snappier follow

    // Screen shake: a short, decaying random jitter added on top of the
    // normal camera position at worldToScreen time. Every existing draw()
    // call (arena, entities, vehicle, particles) goes through worldToScreen
    // already, so shake affects the whole scene for free without any of
    // those call sites needing to know shake exists.
    this.shakeTime = 0;
    this.shakeDuration = 0;
    this.shakeMag = 0;
    this.shakeX = 0;
    this.shakeY = 0;
  }

  update(dt, targetX, targetY) {
    const t = 1 - Math.exp(-this.smoothing * dt);
    this.x += (targetX - this.x) * t;
    this.y += (targetY - this.y) * t;

    if (this.shakeTime > 0) {
      this.shakeTime -= dt;
      const frac = Math.max(0, this.shakeTime / this.shakeDuration);
      const amt = this.shakeMag * frac;
      this.shakeX = (Math.random() * 2 - 1) * amt;
      this.shakeY = (Math.random() * 2 - 1) * amt;
    } else {
      this.shakeX = 0;
      this.shakeY = 0;
      this.shakeMag = 0;
    }
  }

  // Kicks off (or extends) a short shake -- called on big impacts (vehicle,
  // turret, or building destroyed). Repeated overlapping calls take the
  // stronger magnitude and longer remaining duration rather than stacking
  // additively, so several explosions in quick succession read as "intense"
  // instead of flinging the camera off into noise.
  shake(magnitude, duration) {
    if (magnitude > this.shakeMag) this.shakeMag = magnitude;
    if (this.shakeTime <= 0) this.shakeDuration = duration;
    this.shakeTime = Math.max(this.shakeTime, duration);
  }

  // Convert world coords to screen coords given canvas size.
  worldToScreen(wx, wy, canvasW, canvasH) {
    return {
      x: wx - this.x + canvasW / 2 + this.shakeX,
      y: wy - this.y + canvasH / 2 + this.shakeY,
    };
  }
}
