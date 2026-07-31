// Arcade, momentum-based vehicle physics tuned for a skiddy "jeep" feel:
// the vehicle's heading and its velocity vector are two separate things.
// Turning rotates the heading; the old velocity keeps carrying the vehicle
// in its previous direction until "grip" slowly bleeds off the sideways
// (lateral) component of velocity and pulls it back in line with the wheels.
// Low grip => long, loose drifts. High grip => tight, planted handling.

// Turns `current` toward `target` at up to `rate` radians/sec, via the
// shortest angular path, without ever overshooting past `target`. Used for
// twin-stick aiming (see the `aimAngle` handling in Vehicle.update below):
// the turret/heli nose chases the aim input (mouse cursor, or a controller's
// right stick) at a fast-but-finite rate rather than teleporting instantly,
// so it reads as a snappy turn rather than a pop.
function slewAngle(current, target, rate, dt) {
  let diff = target - current;
  diff = Math.atan2(Math.sin(diff), Math.cos(diff));
  const maxStep = rate * dt;
  if (Math.abs(diff) <= maxStep) return target;
  return current + Math.sign(diff) * maxStep;
}

// Presets, echoing the classic light-jeep / heavy-armor / aerial trio:
// jeep is fast and loose, tank is slow and planted with a big health pool,
// heli is fast and floaty and (via `isAerial`) ignores ground obstacles.
// `lives`: how many times this vehicle type can be destroyed and redeployed
// before that type is gone for the round. Every type now has a finite pool
// (2 tanks, 2 helis, 3 jeeps) that persists across respawns/switches; the
// round is only lost once every type's lives are exhausted (see game.js's
// death handling), not the moment any single type runs out -- running out of
// one type just means the game auto-switches you into whichever type still
// has lives left. The jeep is the only flag carrier (`canCarryFlag`), so
// losing all your jeeps doesn't end the round outright, but it does mean the
// flag can never be picked up again until the round resets.
export const VEHICLE_TYPES = {
  jeep: {
    label: "Jeep",
    description: "Fast, light, unarmed — the only ride that can grab the flag. Hovercraft movement like the tank: WASD slides it in any direction, no need to turn first. Very fragile: 3 lives, and ramming a building bruises the jeep itself, not just the building.",
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
    lives: 3,
    weapon: null,
    // Ramming: hitting a destructible building at speed chips away at it.
    // The jeep is light -- it can nudge a weak building down eventually, but
    // it's a poor substitute for the tank's cannon.
    ramDamage: 5,
    // Unlike the armored tank, the jeep isn't built to take a hit: slamming
    // into a building at speed costs the jeep itself mild/moderate health
    // too (see the ram-handling block in game.js), on top of whatever damage
    // it deals to the building. "Precious and important, but very weak."
    collisionDamage: 10,
  },
  tank: {
    label: "Tank",
    description:
      "Slow, armored, twin-stick aim and hovercraft movement: WASD slides it in any direction with no need to turn the hull first, while the turret independently tracks your mouse cursor (or a controller's right stick) and autofires the cannon whenever you're aiming somewhere — move one way, shoot another. Clear turrets so the jeep can get through. 2 lives.",
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
    lives: 2,
    weapon: { damage: 30, fireInterval: 0.9, bulletSpeed: 520, spread: 0.02, label: "cannon" },
    // Turret aim: twin-stick -- the turret tracks the player's aim input
    // (mouse cursor, or a controller's right stick) directly and completely
    // independent of the hull, via `aimSlewRate` (see Vehicle.update below).
    // `turretTurnRate` is kept as the *legacy* incremental traverse rate --
    // still used by the duel-mode AI opponent (aiDriver.js), which aims by
    // nudging a `turretTurn` value frame to frame rather than supplying an
    // absolute angle, exactly like the old Q/E scheme this replaced for the
    // human player.
    hasTurret: true,
    turretTurnRate: 3.2,
    aimSlewRate: 18,
    // Heavy and armored -- the tank can straight-up bulldoze a weak building
    // by ramming it repeatedly, on top of shooting it. Its armor means it
    // takes no extra self-damage from the impact (no collisionDamage), unlike
    // the jeep.
    ramDamage: 22,
  },
  heli: {
    label: "Helicopter",
    description:
      "Fast, fragile, twin-stick aim. WASD moves it -- forward/back along the nose, left/right strafes sideways -- while the nose independently tracks your mouse cursor (or a controller's right stick) and autofires the chaingun, fully decoupled from whichever way you're actually flying. Hold F to swap that autofire to longer-range missiles that arc over rooftops. 2 lives.",
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
    lives: 2,
    // Nose-tracking rate for twin-stick aim (see `aimSlewRate` on the tank
    // preset above, and Vehicle.update below) -- slightly slower than the
    // tank turret's since the whole airframe visually rotates here, not just
    // a small turret cap, so a dead-instant snap would read as a glitchy spin.
    aimSlewRate: 14,
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
    // How hard this vehicle dings a destructible building on contact, at
    // speed, per hit (see Game's ramCooldown handling). 0 for aerial types,
    // which never collide with ground obstacles in the first place.
    this.ramDamage = preset.ramDamage || 0;
    // How much the vehicle itself takes back from that same impact -- only
    // the jeep has this (see VEHICLE_TYPES.jeep above); 0 for everything
    // else, so ramming costs the tank nothing but a building's health.
    this.collisionDamage = preset.collisionDamage || 0;

    // Weapon state travels with the vehicle instance so cooldown resets
    // cleanly on respawn/switch. `null` for unarmed vehicles (the jeep).
    this.weapon = preset.weapon ? { ...preset.weapon, cooldown: 0 } : null;
    // Secondary weapon slot -- only the heli has one (its rooftop-arcing
    // missile). `null` for everything else.
    this.weapon2 = preset.weapon2 ? { ...preset.weapon2, cooldown: 0 } : null;

    // Turret aim -- only the tank has one. Starts aligned with the hull so
    // it looks natural on spawn. From then on, twin-stick aim input
    // (`aimAngle`, see update() below) drives it directly at `aimSlewRate`;
    // `turretTurnRate` is the older incremental rate still used by the
    // duel-mode AI opponent's own `turretTurn`-based aiming.
    this.hasTurret = !!preset.hasTurret;
    this.turretTurnRate = preset.turretTurnRate || 0;
    this.aimSlewRate = preset.aimSlewRate || 14;
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
      // Twin-stick aim: the nose (and therefore the chaingun/missile's fire
      // direction -- see game.js) tracks `input.aimAngle` directly, fully
      // decoupled from whatever the stick is doing to move it (see the
      // strafing logic below) -- a fast slew rather than an instant snap so
      // it reads as a turn, not a pop.
      if (input.aimAngle !== undefined && input.aimAngle !== null) {
        this.heading = slewAngle(this.heading, input.aimAngle, this.aimSlewRate, dt);
      } else {
        // Legacy incremental rotate (Q/E, or a controller's shoulder
        // buttons) -- no current caller drives a heli this way (the
        // duel-mode AI only ever flies a tank), but kept so any direct
        // caller that still feeds `turretTurn` instead of an absolute
        // `aimAngle` keeps working exactly as before.
        this.heading += (input.turretTurn || 0) * this.turnRate * dt;
      }
    } else if (input.omni) {
      // Hovercraft-style movement (see the thrust branch below): the hull
      // isn't turned by player input at all here -- it's purely cosmetic,
      // set further down (after velocity updates) to passively track
      // whichever direction the vehicle is actually traveling.
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
    } else if (input.omni) {
      // Hovercraft-style movement (currently just the player's own tank --
      // see the `omni` flag Game passes in game.js): the stick's raw x/y
      // (`turn` = horizontal, `-throttle` = vertical, the same convention
      // the keyboard/gamepad already produce) IS the movement direction,
      // completely independent of the hull's facing -- no need to turn the
      // vehicle body to change travel direction, matching the same "aim one
      // way, move another" twin-stick feel as the turret's own independent
      // aim. The duel-mode AI opponent's tank still drives the old
      // turn-to-face way (see the `else` branch below) since aiDriver.js's
      // pursuit steering assumes that model -- it never sets `omni`.
      let moveX = input.turn || 0;
      let moveY = -(input.throttle || 0);
      const inputMag = Math.hypot(moveX, moveY);
      if (inputMag > 1) {
        moveX /= inputMag;
        moveY /= inputMag;
      }
      this.vx += moveX * this.accel * dt;
      this.vy += moveY * this.accel * dt;

      // A pure "add thrust in the input direction" model has no way to
      // recover from a sideways bump (e.g. the bounce arena.js's
      // _resolveCircleCollision applies when ramming an obstacle) -- once
      // deflected, a frictionless-feeling hovercraft would just keep
      // drifting off at that new angle forever, since thrust re-applied
      // along the *held* direction doesn't fight a velocity component
      // that's perpendicular to it. Real hovercraft aren't that slippery
      // either -- they still mostly go where you point them, with some
      // slide. So: decompose velocity into along-input vs.
      // perpendicular-to-input, and pull the perpendicular part toward zero
      // with this vehicle's `grip`, the same stat that used to tame lateral
      // drift under the old car-physics model. Only applies while actively
      // pushing a direction -- an unheld tank just coasts on rolling
      // friction below, same as before.
      const mag2 = Math.hypot(moveX, moveY);
      if (mag2 > 0.001) {
        const dirX = moveX / mag2;
        const dirY = moveY / mag2;
        const vAlong = this.vx * dirX + this.vy * dirY;
        const vPerpX = this.vx - vAlong * dirX;
        const vPerpY = this.vy - vAlong * dirY;
        const grip = this.grip * this.gripMultiplier;
        const perpDecay = Math.max(0, 1 - grip * dt);
        this.vx = vAlong * dirX + vPerpX * perpDecay;
        this.vy = vAlong * dirY + vPerpY * perpDecay;
      }

      const curSpeed = Math.hypot(this.vx, this.vy);
      if (curSpeed > maxFwd) {
        const scale = maxFwd / curSpeed;
        this.vx *= scale;
        this.vy *= scale;
      }
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

    // Hovercraft hull is purely cosmetic (the turret already aims
    // independently, see below) -- just have it visually settle to face
    // wherever it's actually traveling, rather than staying wherever it last
    // happened to point.
    if (input.omni && !this.isAerial) {
      const travelSpeed = Math.hypot(this.vx, this.vy);
      if (travelSpeed > 5) {
        const travelAngle = Math.atan2(this.vy, this.vx);
        this.heading = slewAngle(this.heading, travelAngle, this.turnRate, dt);
      }
    }

    // Twin-stick aim: the turret tracks `input.aimAngle` directly and fully
    // independent of the hull -- no "offset from the hull" concept anymore,
    // just a turret ring slewing (at `aimSlewRate`) toward wherever you're
    // aiming, same as the heli's nose above.
    if (this.hasTurret) {
      if (input.aimAngle !== undefined && input.aimAngle !== null) {
        this.turretAngle = slewAngle(this.turretAngle, input.aimAngle, this.aimSlewRate, dt);
      } else {
        // Legacy incremental traverse (Q/E, or a controller's shoulder
        // buttons) -- still used by the duel-mode AI opponent (aiDriver.js),
        // which aims by nudging `turretTurn` frame to frame rather than
        // supplying an absolute angle: the turret rides along with however
        // much the hull turned this frame, plus whatever turretTurn dials in
        // on top, like a turret ring bolted to a moving hull.
        const headingDelta = this.heading - prevHeading;
        this.turretAngle += headingDelta + (input.turretTurn || 0) * this.turretTurnRate * dt;
      }
    }
  }

  get speed() {
    return Math.hypot(this.vx, this.vy);
  }
}
