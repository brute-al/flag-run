// Merges keyboard input and gamepad input into one object satisfying the
// same interface Game expects (getVector/isFiring/isFiring2), so Game
// itself doesn't need to know or care whether a given frame's input came
// from a keyboard, an Xbox controller, or both at once. Vector components
// are summed then clamped -- in practice a player uses one device at a
// time, so this just avoids needing to pick a "winner" when only one is
// actually being touched.
function clamp(v) {
  return Math.max(-1, Math.min(1, v));
}

export class CombinedInput {
  constructor(keyboard, gamepad) {
    this.keyboard = keyboard;
    this.gamepad = gamepad;
  }

  getVector() {
    const k = this.keyboard.getVector();
    const g = this.gamepad.getVector();
    return {
      throttle: clamp(k.throttle + g.throttle),
      turn: clamp(k.turn + g.turn),
      turretTurn: clamp(k.turretTurn + g.turretTurn),
    };
  }

  isFiring() {
    return this.keyboard.isFiring() || this.gamepad.isFiring();
  }

  isFiring2() {
    return this.keyboard.isFiring2() || this.gamepad.isFiring2();
  }
}
