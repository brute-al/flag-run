// Arcade, momentum-based vehicle physics tuned for a skiddy "jeep" feel:
// the vehicle's heading and its velocity vector are two separate things.
// Turning rotates the heading; the old velocity keeps carrying the vehicle
// in its previous direction until "grip" slowly bleeds off the sideways
// (lateral) component of velocity and pulls it back in line with the wheels.
// Low grip => long, loose drifts. High grip => tight, planted handling.

// Presets, echoing the classic light-jeep / heavy-armor / aerial trio:
// jeep is fast and loose, tank is slow and planted with a big health pool,
// heli is fast and floaty and (via `isAerial`) ignores ground obstacles.
// `lives`: how many times this vehicle type can be destroyed and redeployed
// before it's gone for good. Infinity = expendable support vehicle. The jeep
// is the only flag carrier (`canCarryFlag`), so its lives are the actual
// win/loss clock for the round; heavy vehicles exist to clear the way and
// can be lost freely.
export const VEHICLE_TYPES = {
  jeep: {
    label: "Jeep",
    description: "Fast, light, unarmed — the only ride that can grab the flag. 2 lives: lose both and the round's over.",
    accel: 420,
    reverseAccel: 260,
    maxSpeed: 340,
    maxReverseSpeed: 160,
    turnRate: 3.0,
    turnSpeedFalloff: 0.35,
    grip: 2.6,
    rollingFriction: 0.65,
    radius: 11,
    maxHealth: 100,
    isAerial: false,
    canCarryFlag: true,
    lives: 2,
    weapon: null,
  },
  tank: {
    label: "Tank",
    description:
      "Slow, armored, packs a cannon with a turret you traverse using Q/E (or a controller's shoulder buttons) — the turret is bolted to the hull, so it turns along with you as you drive, but Q/E swings it to whatever offset you want and holds it there. Clear turrets so the jeep can get through. Unlimited redeploys.",
    accel: 260,
    reverseAccel: 150,
    maxSpeed: 210,
    maxReverseSpeed: 110,
    turnRate: 1.9,
    turnSpeedFalloff: 0.6,
    grip: 5.5,
    rollingFriction: 1.1,
    radius: 15,
    maxHealth: 180,
    isAerial: false,
    canCarryFlag: false,
    lives: Infinity,
    weapon: { damage: 30, fireInterval: 0.9, bulletSpeed: 520, spread: 0.02, label: "cannon" },
    // Turret traverse: the turret rides along with the hull (see the
    // heading-delta logic in Vehicle.update below), and `turretTurn` input
    // (Q/E, or a controller's shoulder buttons) swivels it further on top
    // of that -- like a real turret ring bolted to a moving hull.
    hasTurret: true,
    turretTurnRate: 3.2,
  },
  heli: {
    label: "Helicopter",
    description:
      "Fast, fragile. The stick moves it -- forward/back along the nose, left/right strafes sideways -- while Q/E (or a controller's shoulder buttons) spin the nose independently, so you can hover, rotate to face any way, then peel off in that direction. Chaingun (SPACE) for direct fire; missiles (F) arc over rooftops to reach elevated turrets. Unlimited redeploys.",
    accel: 360,
    reverseAccel: 220,
    maxSpeed: 380,
    maxReverseSpeed: 200,
    turnRate: 2.6,
    turnSpeedFalloff: 0.2,
    grip: 1.4,
    rollingFriction: 0.35,
    radius: 13,
    maxHealth: 70,
    isAerial: true,
    canCarryFlag: false,
    lives: Infinity,
    weapon: { damage: 7, fireInterval: 0.12, bulletSpeed: 600, spread: 0.06, label: "chaingun" },
    // Secondary weapon, heli-only: slower and heavier-hitting than the
    // chaingun, and flagged so its bullets skip building collision (see
    // Bullet's `tall` flag and game.js) -- these are meant specifically to
    // reach the tall turrets over rooftops without regular fire getting
    // stopped by whatever building happens to be in the way.
    weapon2: { damage: 25, fireInterval: 1.4, bulletSpeed: 380, spread: 0.015, radius: 6, label: "missile" },
  },
};

export class Vehicle {
  constructor(x, y, heading = 0, type = "jeep") {
    this.x = x;
    this.y = y;
    this.heading = heading; // radians
    this.vx = 0;
    this.vy = 0;

    const preset = VEHICLE_TYPES[type] || VEHICLE_TYPES.jeep;
    this.type = type;
    this.radius = preset.radius;
    this.accel = preset.accel;
    this.reverseAccel = preset.reverseAccel;
    this.maxSpeed = preset.maxSpeed;
    this.maxReverseSpeed = preset.maxReverseSpeed;
    this.turnRate = preset.turnRate;
    this.turnSpeedFalloff = preset.turnSpeedFalloff;
    this.grip = preset.grip;
    this.rollingFriction = preset.rollingFriction;
    this.maxHealth = preset.maxHealth;
    this.isAerial = preset.isAerial;
    this.canCarryFlag = preset.canCarryFlag;
    this.carrying = null; // flag reference, if any

    // Weapon state travels with the vehicle instance so cooldown resets
    // cleanly on respawn/switch. `null` for unarmed vehicles (the jeep).
    this.weapon = preset.weapon ? { ...preset.weapon, cooldown: 0 } : null;
    // Secondary weapon slot -- only the heli has one (its rooftop-arcing
    // missile). `null` for everything else.
    this.weapon2 = preset.weapon2 ? { ...preset.weapon2, cooldown: 0 } : null;

    // Turret aim -- only the tank has one. Starts aligned with the hull so
    // it looks natural on spawn; from then on it rides along with the hull
    // (see the heading-delta logic in update() below) while `turretTurn`
    // input (Q/E, or a controller's shoulder buttons) swivels it further on
    // top of that, like a real turret ring bolted to a moving hull.
    this.hasTurret = !!preset.hasTurret;
    this.turretTurnRate = preset.turretTurnRate || 0;
    this.turretAngle = heading;
  }

  // Carrying the flag makes the vehicle heavier: slower and looser.
  get speedMultiplier() {
    return this.carrying ? 0.72 : 1;
  }
  get gripMultiplier() {
    return this.carrying ? 0.75 : 1;
  }

  update(dt, input) {
    const forward = { x: Math.cos(this.heading), y: Math.sin(this.heading) };
    const right = { x: -forward.y, y: forward.x };

    const speed = Math.hypot(this.vx, this.vy);
    const speedFrac = Math.min(speed / this.maxSpeed, 1);

    // Recorded before heading changes below so the turret-glue logic at the
    // bottom of this method can measure exactly how much the hull turned.
    const prevHeading = this.heading;

    if (this.isAerial) {
      // The heli's yaw reuses the same "independent, no-momentum-coupling"
      // rotate input as the tank's turret traverse (Q/E, or a controller's
      // shoulder buttons) -- full turnRate applies whether it's hovering
      // dead still or screaming along at top speed, completely decoupled
      // from whatever the stick is doing (see the strafing logic below).
      this.heading += (input.turretTurn || 0) * this.turnRate * dt;
    } else {
      // Turning authority tapers off a bit at high speed (harder to snap-turn
      // when driving along), but never drops to zero so drifting stays controllable.
      const turnAuthority = 1 - speedFrac * (1 - this.turnSpeedFalloff);
      // Turning only really "bites" while the vehicle has some momentum,
      // otherwise a stationary vehicle could spin in place unrealistically fast.
      const turnFromStandstill = 0.35;
      const effectiveTurn = turnAuthority * (turnFromStandstill + (1 - turnFromStandstill) * speedFrac);
      this.heading += input.turn * this.turnRate * effectiveTurn * dt;
    }

    const maxFwd = this.maxSpeed * this.speedMultiplier;
    const maxRev = this.maxReverseSpeed * this.speedMultiplier;

    if (this.isAerial) {
      // The stick maps straight onto the airframe's own forward/right axes:
      // throttle thrusts along the nose, and what used to be the "turn" axis
      // now thrusts sideways (strafe) instead of yawing. Pushing the stick
      // left/right moves the helicopter left/right relative to wherever it's
      // currently facing, fully independent of the dedicated rotate input
      // above -- so you can hover, spin to face any direction, then fly off
      // any direction relative to that facing (including straight sideways).
      if (input.throttle > 0) {
        this.vx += forward.x * this.accel * input.throttle * dt;
        this.vy += forward.y * this.accel * input.throttle * dt;
      } else if (input.throttle < 0) {
        this.vx += forward.x * this.reverseAccel * input.throttle * dt;
        this.vy += forward.y * this.reverseAccel * input.throttle * dt;
      }
      if (input.turn) {
        this.vx += right.x * this.accel * input.turn * dt;
        this.vy += right.y * this.accel * input.turn * dt;
      }

      // Cap overall speed regardless of travel direction (there's no
      // separate "forward vs. lateral" limit once movement is omnidirectional).
      const curSpeed = Math.hypot(this.vx, this.vy);
      if (curSpeed > maxFwd) {
        const scale = maxFwd / curSpeed;
        this.vx *= scale;
        this.vy *= scale;
      }

      // Gentle drag brings it back toward a stop when the stick is
      // released -- there's no "wheels on the ground" friction model to
      // lean on here, but a hovering aircraft should still settle down.
      this.vx *= Math.max(0, 1 - this.rollingFriction * dt);
      this.vy *= Math.max(0, 1 - this.rollingFriction * dt);
    } else {
      // Engine force applied along the *current heading*, not the velocity.
      if (input.throttle > 0) {
        this.vx += forward.x * this.accel * input.throttle * dt;
        this.vy += forward.y * this.accel * input.throttle * dt;
      } else if (input.throttle < 0) {
        this.vx += forward.x * this.reverseAccel * input.throttle * dt;
        this.vy += forward.y * this.reverseAccel * input.throttle * dt;
      }

      // Decompose velocity into forward/lateral components relative to heading.
      let vForward = this.vx * forward.x + this.vy * forward.y;
      let vLateral = this.vx * right.x + this.vy * right.y;

      // Grip pulls lateral velocity toward zero over time -> this is the drift recovery.
      const grip = this.grip * this.gripMultiplier;
      vLateral *= Math.max(0, 1 - grip * dt);

      // Rolling friction slows forward motion when there's no throttle input.
      if (input.throttle === 0) {
        vForward *= Math.max(0, 1 - this.rollingFriction * dt);
      }

      // Clamp forward speed to this vehicle's limits.
      vForward = Math.max(-maxRev, Math.min(maxFwd, vForward));

      // Recompose velocity from the (now-adjusted) components.
      this.vx = forward.x * vForward + right.x * vLateral;
      this.vy = forward.y * vForward + right.y * vLateral;
    }

    this.x += this.vx * dt;
    this.y += this.vy * dt;

    // The turret is bolted to the hull: whatever the hull turned this frame,
    // the turret turns with it (preserving whatever offset the player dialed
    // in), and `turretTurn` input (Q/E, or a controller's shoulder buttons)
    // swivels it further on top of that -- like swiveling a turret ring
    // while the tank itself is moving, rather than a fully independent aim.
    if (this.hasTurret) {
      const headingDelta = this.heading - prevHeading;
      this.turretAngle += headingDelta + (input.turretTurn || 0) * this.turretTurnRate * dt;
    }
  }

  get speed() {
    return Math.hypot(this.vx, this.vy);
  }
}
