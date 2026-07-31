// Merges keyboard+mouse input and gamepad input into one object satisfying
// the same interface Game expects (getVector/getAim/isFiring/isFiring2), so
// Game itself doesn't need to know or care whether a given frame's input
// came from a keyboard/mouse, an Xbox controller, or both at once.
function clamp(v) {
  return Math.max(-1, Math.min(1, v));
}

export class CombinedInput {
  constructor(keyboard, gamepad) {
    this.keyboard = keyboard;
    this.gamepad = gamepad;
  }

  // Drive vector components are summed then clamped -- in practice a player
  // uses one device at a time, so this just avoids needing to pick a
  // "winner" when only one is actually being touched.
  getVector() {
    const k = this.keyboard.getVector();
    const g = this.gamepad.getVector();
    return {
      throttle: clamp(k.throttle + g.throttle),
      turn: clamp(k.turn + g.turn),
    };
  }

  // Aim, unlike throttle/turn, can't be meaningfully summed (two angles
  // don't average into anything useful), so this picks whichever device is
  // actually engaged this frame: the right stick wins if it's currently
  // deflected (an active twin-stick input takes priority), otherwise the
  // mouse's cursor-relative angle is used if it's ever moved, otherwise the
  // right stick's last-known direction (if the player has used it before),
  // otherwise nothing.
  getAim(ctx) {
    const g = this.gamepad.getAim();
    if (g.active) return g;
    const k = this.keyboard.getAim(ctx);
    if (k.active || k.angle !== null) return k;
    return g;
  }

  isFiring() {
    return this.keyboard.isFiring() || this.gamepad.isFiring();
  }

  isFiring2() {
    return this.keyboard.isFiring2() || this.gamepad.isFiring2();
  }
}
