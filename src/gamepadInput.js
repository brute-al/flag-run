// Reads the first connected gamepad each frame and exposes the same
// {throttle, turn, turretTurn} vector shape (plus isFiring/isFiring2) as
// the keyboard Input class, so the two can be merged transparently by
// CombinedInput -- Game itself never needs to know which device produced
// a given frame's input.
//
// Assumes the browser's "standard" gamepad mapping, which is what an Xbox
// controller (and most modern controllers) report over USB or Bluetooth in
// Chrome/Edge/Firefox: axes[0]/[1] = left stick x/y, buttons[0]/[1] = A/B,
// buttons[4]/[5] = left/right shoulder bumpers, buttons[6]/[7] = left/right
// triggers, buttons[3] = Y, buttons[9] = Start/Menu.
// https://w3c.github.io/gamepad/#remapping
//
// Note: browsers only start reporting a gamepad's live state after the
// player presses at least one button on it while the page has focus (a
// privacy/fingerprinting protection) -- nothing happens until then, which
// is expected, not a bug.
const DEADZONE = 0.18;

function deadzone(v) {
  return Math.abs(v) < DEADZONE ? 0 : v;
}

export class GamepadInput {
  constructor() {
    this.index = null;
    // Guard for non-browser environments (e.g. the headless test suite,
    // which exercises this class directly) -- just stays permanently
    // "nothing connected" rather than throwing.
    if (typeof window === "undefined") return;
    window.addEventListener("gamepadconnected", (e) => {
      if (this.index === null) this.index = e.gamepad.index;
    });
    window.addEventListener("gamepaddisconnected", (e) => {
      if (this.index === e.gamepad.index) this.index = null;
    });
  }

  _pad() {
    if (this.index === null) return null;
    if (typeof navigator === "undefined" || !navigator.getGamepads) return null;
    return navigator.getGamepads()[this.index] || null;
  }

  getVector() {
    const pad = this._pad();
    if (!pad) return { throttle: 0, turn: 0, turretTurn: 0 };

    // Left stick: forward = throttle (the Gamepad API reports "up" as a
    // negative y-axis value, so this is inverted), left/right = turn.
    const throttle = deadzone(-(pad.axes[1] || 0));
    const turn = deadzone(pad.axes[0] || 0);

    // Shoulder bumpers swing the turret independent of the stick, mirroring
    // the keyboard's Q/E -- left bumper rotates it left, right rotates right.
    let turretTurn = 0;
    if (pad.buttons[4]?.pressed) turretTurn -= 1;
    if (pad.buttons[5]?.pressed) turretTurn += 1;

    return { throttle, turn, turretTurn };
  }

  isFiring() {
    const pad = this._pad();
    return !!(pad && (pad.buttons[0]?.pressed || pad.buttons[7]?.pressed)); // A or right trigger
  }

  isFiring2() {
    const pad = this._pad();
    return !!(pad && (pad.buttons[1]?.pressed || pad.buttons[6]?.pressed)); // B or left trigger
  }

  // Raw menu-button states for main.js to edge-detect (fire once per press,
  // not every frame it's held) -- restart and vehicle swap aren't part of
  // the per-frame driving/firing vector, so they're exposed separately.
  isRestartHeld() {
    const pad = this._pad();
    return !!(pad && pad.buttons[9]?.pressed); // Start/Menu
  }

  isSwapHeld() {
    const pad = this._pad();
    return !!(pad && pad.buttons[3]?.pressed); // Y
  }
}
