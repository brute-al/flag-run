// Reads the first connected gamepad each frame and exposes the same
// {throttle, turn} drive vector, plus getAim()/isFiring()/isFiring2(), as
// the keyboard+mouse Input class, so the two can be merged transparently by
// CombinedInput -- Game itself never needs to know which device produced
// a given frame's input.
//
// Assumes the browser's "standard" gamepad mapping, which is what an Xbox
// controller (and most modern controllers) report over USB or Bluetooth in
// Chrome/Edge/Firefox: axes[0]/[1] = left stick x/y (drive), axes[2]/[3] =
// right stick x/y (aim -- twin-stick style, see getAim() below),
// buttons[0]/[1] = A/B, buttons[6]/[7] = left/right triggers, buttons[3] =
// Y, buttons[9] = Start/Menu.
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
    // Twin-stick aim: the right stick's last-deflected direction persists
    // here even after the stick is released back to center (a real turret
    // shouldn't snap back to some default just because you let go), same
    // spirit as the mouse's always-live cursor position in Input.getAim().
    this._lastAimAngle = null;
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

  // Whether a gamepad has ever been touched this session (browsers only
  // start reporting a pad after a button press -- see the class comment).
  // CombinedInput uses this to make the gamepad the *exclusive* aim/fire
  // input once one is connected, so the mouse's resting cursor position
  // can't fight with the right stick.
  isConnected() {
    return this.index !== null;
  }

  getVector() {
    const pad = this._pad();
    if (!pad) return { throttle: 0, turn: 0 };

    // Left stick: forward = throttle (the Gamepad API reports "up" as a
    // negative y-axis value, so this is inverted), left/right = turn.
    const throttle = deadzone(-(pad.axes[1] || 0));
    const turn = deadzone(pad.axes[0] || 0);
    return { throttle, turn };
  }

  // Twin-stick aim via the right stick. Unlike throttle (a signed scalar
  // that needs the "up = positive" flip), an *angle* doesn't need any sign
  // correction: this game's world/screen space already increases downward
  // for +y exactly like the Gamepad API's axes do, so raw atan2(y, x) lines
  // up directly with heading/turretAngle's existing convention.
  getAim() {
    const pad = this._pad();
    if (!pad) return { active: false, angle: this._lastAimAngle };
    const rx = pad.axes[2] || 0;
    const ry = pad.axes[3] || 0;
    if (Math.hypot(rx, ry) < DEADZONE) {
      return { active: false, angle: this._lastAimAngle };
    }
    this._lastAimAngle = Math.atan2(ry, rx);
    return { active: true, angle: this._lastAimAngle };
  }

  // Right stick pushed past its deadzone = fire, the twin-stick convention
  // of autofiring continuously in whatever direction you're holding the
  // stick, rather than needing a separate trigger button.
  isFiring() {
    const pad = this._pad();
    if (!pad) return false;
    const rx = pad.axes[2] || 0;
    const ry = pad.axes[3] || 0;
    return Math.hypot(rx, ry) >= DEADZONE;
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
