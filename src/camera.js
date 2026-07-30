// Simple lerp-follow camera in world space.
export class Camera {
  constructor(x, y) {
    this.x = x;
    this.y = y;
    this.smoothing = 4.5; // higher = snappier follow
  }

  update(dt, targetX, targetY) {
    const t = 1 - Math.exp(-this.smoothing * dt);
    this.x += (targetX - this.x) * t;
    this.y += (targetY - this.y) * t;
  }

  // Convert world coords to screen coords given canvas size.
  worldToScreen(wx, wy, canvasW, canvasH) {
    return {
      x: wx - this.x + canvasW / 2,
      y: wy - this.y + canvasH / 2,
    };
  }
}
