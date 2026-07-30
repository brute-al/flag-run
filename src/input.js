// Keyboard input state, mapped to a simple {throttle, turn} vector.
// throttle: -1 (reverse) .. 1 (forward)
// turn: -1 (left) .. 1 (right)

const KEY_MAP = {
  forward: ["KeyW", "ArrowUp"],
  backward: ["KeyS", "ArrowDown"],
  left: ["KeyA", "ArrowLeft"],
  right: ["KeyD", "ArrowRight"],
  fire: ["Space"],
  // Secondary fire -- only meaningful for the heli's missile (see
  // vehicle.js's `weapon2`), which arcs over rooftops instead of getting
  // blocked by whatever building is closest, like the chaingun does.
  fire2: ["KeyF"],
  // Independent turret traverse -- only meaningful on vehicles with a
  // rotating turret (the tank): swings the cannon's aim without turning
  // the hull, like a real tank. Mirrors a controller's shoulder buttons.
  turretLeft: ["KeyQ"],
  turretRight: ["KeyE"],
};

export class Input {
  constructor() {
    this.keys = new Set();
    window.addEventListener("keydown", (e) => this.keys.add(e.code));
    window.addEventListener("keyup", (e) => this.keys.delete(e.code));
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

    let turretTurn = 0;
    if (this._anyDown(KEY_MAP.turretRight)) turretTurn += 1;
    if (this._anyDown(KEY_MAP.turretLeft)) turretTurn -= 1;

    return { throttle, turn, turretTurn };
  }

  isFiring() {
    return this._anyDown(KEY_MAP.fire);
  }

  isFiring2() {
    return this._anyDown(KEY_MAP.fire2);
  }
}
