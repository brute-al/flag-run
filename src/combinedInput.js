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
  // don't average into anything useful) -- and unlike drive, mixing devices
  // here actively hurts: a mouse cursor is *always* sitting somewhere, so
  // if it stayed in the mix once a controller is connected, it would fight
  // with the right stick the moment the stick recenters. So once a gamepad
  // is connected, it's the sole aim/fire input, full stop -- the mouse only
  // matters when no gamepad is connected at all.
  getAim(ctx) {
    if (this.gamepad.isConnected()) return this.gamepad.getAim();
    return this.keyboard.getAim(ctx);
  }

  isFiring() {
    if (this.gamepad.isConnected()) return this.gamepad.isFiring();
    return this.keyboard.isFiring();
  }

  isFiring2() {
    if (this.gamepad.isConnected()) return this.gamepad.isFiring2();
    return this.keyboard.isFiring2();
  }
}
