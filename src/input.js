// Keyboard + mouse input state.
// getVector() gives a simple {throttle, turn} drive vector:
// throttle: -1 (reverse) .. 1 (forward)
// turn: -1 (left) .. 1 (right)
//
// Aiming (the tank's cannon / heli's chaingun-or-missile) is twin-stick
// style, decoupled entirely from driving: getAim() reports a world-space
// aim angle derived from the mouse cursor's position relative to the
// vehicle -- the PC equivalent of a controller's right stick (see
// gamepadInput.js), since a physical keyboard has no second analog input of
// its own. Q/E's old job (independently traversing the turret / spinning
// the heli's nose) is retired; the turret/nose now just tracks the cursor
// directly (see vehicle.js's `aimAngle` handling).

const KEY_MAP = {
  forward: ["KeyW", "ArrowUp"],
  backward: ["KeyS", "ArrowDown"],
  left: ["KeyA", "ArrowLeft"],
  right: ["KeyD", "ArrowRight"],
  // Secondary fire modifier -- only meaningful for the heli, which has no
  // fire button of its own anymore (see below): holding this while aiming
  // swaps the ongoing autofire from its chaingun to its longer-range,
  // rooftop-arcing missile (see vehicle2/weapon2 handling in game.js).
  fire2: ["KeyF"],
};

export class Input {
  constructor() {
    this.keys = new Set();
    // Screen-space mouse position, updated on every mousemove; null until
    // the mouse has moved at least once (nothing to aim at yet, so getAim()
    // reports no angle until then -- same as a controller's right stick
    // reporting nothing before it's been touched).
    this.mouseScreenX = null;
    this.mouseScreenY = null;
    this.mouseDown = false;

    window.addEventListener("keydown", (e) => this.keys.add(e.code));
    window.addEventListener("keyup", (e) => this.keys.delete(e.code));
    window.addEventListener("mousemove", (e) => {
      this.mouseScreenX = e.clientX;
      this.mouseScreenY = e.clientY;
    });
    // Left mouse button held = fire, the twin-stick equivalent of a
    // controller's right stick being pushed in a direction -- autofires
    // continuously in whatever direction the cursor is at while held (see
    // game.js), rather than needing a discrete per-shot press.
    window.addEventListener("mousedown", (e) => {
      if (e.button === 0) this.mouseDown = true;
    });
    window.addEventListener("mouseup", (e) => {
      if (e.button === 0) this.mouseDown = false;
    });
    // Prevent the page from scrolling when arrow keys are used.
    window.addEventListener(
      "keydown",
      (e) => {
        if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(e.code)) {
          e.preventDefault();
        }
      },
      { passive: false }
    );
  }

  _anyDown(codes) {
    return codes.some((c) => this.keys.has(c));
  }

  getVector() {
    let throttle = 0;
    let turn = 0;
    if (this._anyDown(KEY_MAP.forward)) throttle += 1;
    if (this._anyDown(KEY_MAP.backward)) throttle -= 1;
    if (this._anyDown(KEY_MAP.right)) turn += 1;
    if (this._anyDown(KEY_MAP.left)) turn -= 1;
    return { throttle, turn };
  }

  // `ctx` = { vehicleX, vehicleY, cameraX, cameraY, canvasW, canvasH } --
  // everything needed to convert the mouse's screen position into a
  // world-space angle relative to the vehicle (camera.worldToScreen's
  // inverse, ignoring the tiny screen-shake offset). Returns
  // `{ active, angle }`: `angle` is null until the mouse has moved at least
  // once; `active` mirrors the left mouse button (this frame's "autofire in
  // that direction" trigger -- see game.js).
  getAim(ctx) {
    if (this.mouseScreenX === null) return { active: false, angle: null };
    const worldMouseX = this.mouseScreenX + ctx.cameraX - ctx.canvasW / 2;
    const worldMouseY = this.mouseScreenY + ctx.cameraY - ctx.canvasH / 2;
    const angle = Math.atan2(worldMouseY - ctx.vehicleY, worldMouseX - ctx.vehicleX);
    return { active: this.mouseDown, angle };
  }

  isFiring() {
    return this.mouseDown;
  }

  isFiring2() {
    return this._anyDown(KEY_MAP.fire2);
  }
}
