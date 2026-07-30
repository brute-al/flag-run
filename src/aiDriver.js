// A simple autonomous "input" source for a non-player Vehicle: instead of
// reading keys/gamepad state, it steers along a precomputed route (see
// pathfinding.js's findRoute) toward a target. Implements the same
// getVector()/isFiring()/isFiring2() interface Input/GamepadInput do, so a
// Vehicle can be driven by it exactly the way the player's vehicle is
// driven: `vehicle.update(dt, aiDriver.getVector())`.
//
// Deliberately dumb for now -- milestone 1 of the duel-mode feature (see
// DEPLOY_NOTES.md) is "symmetric map + an AI vehicle that drives toward
// your flag, no combat yet". isFiring()/isFiring2() are always false;
// combat is a later milestone. It also doesn't re-plan mid-route or avoid
// the player -- it just follows the road route it was given.
// A vehicle's real minimum turning radius grows with speed (turnRate's
// effectiveness tapers off the faster you're going -- see Vehicle.update's
// turnSpeedFalloff). At the jeep's top speed that radius is 300+ units, so
// naively chasing a *tight* arrival radius at full speed is exactly the
// classic pure-pursuit failure mode test/sim.mjs's section 1 comment warns
// about: the vehicle orbits the waypoint forever, never quite closing the
// last few units. Fixed here with a wide arrival radius (waypoints don't
// need to be hit precisely, just passed near) and a throttle that scales
// down well before a sharp turn, both of which keep the vehicle's actual
// turning radius smaller than the gap between waypoints.
const WAYPOINT_ARRIVAL_RADIUS = 90;
const TURN_GAIN = 2.6; // how sharply it steers back toward the next waypoint
const MAX_THROTTLE = 0.55; // capped well below top speed so its turn radius stays tractable

// It has no obstacle avoidance at all (see the header comment) -- on a dense
// real-world street grid it will occasionally wedge itself against a
// building's corner, the other failure mode test/sim.mjs's section 1
// comment warns about. Rather than solve real obstacle avoidance for a
// "dumb rusher" milestone, it just notices when it's trying to move but
// isn't actually going anywhere, and backs itself out for a moment before
// resuming -- the same "reverse and try again" instinct a driver has when
// they've clipped a curb.
const STUCK_SPEED = 15; // below this while throttling forward, treat it as wedged
const STUCK_TIME_LIMIT = 0.5; // seconds of being wedged before reacting
const UNSTICK_DURATION = 0.7; // seconds spent reversing out before retrying
// A single reverse-and-retry doesn't always work -- a tight enough building
// corner can send it right back into the same wedge repeatedly, oscillating
// forever on the same waypoint. After several failed attempts in a row on
// the same waypoint, stop trying to hit it precisely and just skip ahead to
// the next one instead -- a locally slightly-worse route beats a permanent
// stalemate.
const MAX_UNSTICK_ATTEMPTS_PER_WAYPOINT = 3;

export class AIDriver {
  constructor() {
    this.route = [];
    this.waypointIndex = 0;
    this._vector = { throttle: 0, turn: 0, turretTurn: 0 };
    this._stuckTimer = 0;
    this._unstickTimer = 0;
    this._unstickTurn = 1;
    this._stuckWaypointIndex = -1;
    this._stuckAttempts = 0;
  }

  // Replace the current route (e.g. once at the start of a round). `route`
  // is the {x, y}[] array findRoute() returns.
  setRoute(route) {
    this.route = route || [];
    this.waypointIndex = 0;
  }

  get reachedEnd() {
    return this.route.length === 0 || this.waypointIndex >= this.route.length;
  }

  // Call once per frame with the vehicle it's driving and the frame's dt,
  // before reading getVector() -- it needs the vehicle's current
  // position/heading/speed to compute this frame's steering (and to notice
  // when it's stuck), which a plain Input source never needs since it just
  // reflects raw key state.
  update(vehicle, dt) {
    const STOPPED = { throttle: 0, turn: 0, turretTurn: 0 };

    if (this._unstickTimer > 0) {
      this._unstickTimer -= dt;
      this._vector = { throttle: -1, turn: this._unstickTurn, turretTurn: 0 };
      return;
    }

    if (this.reachedEnd) {
      this._vector = STOPPED;
      return;
    }

    // Advance through any waypoints already close enough, but never skip
    // past the very last one here -- reaching that one is handled
    // separately below, since it's the true destination, not just a
    // pass-through road point.
    while (
      this.waypointIndex < this.route.length - 1 &&
      Math.hypot(
        this.route[this.waypointIndex].x - vehicle.x,
        this.route[this.waypointIndex].y - vehicle.y
      ) < WAYPOINT_ARRIVAL_RADIUS
    ) {
      this.waypointIndex++;
    }

    const wp = this.route[this.waypointIndex];
    const dist = Math.hypot(wp.x - vehicle.x, wp.y - vehicle.y);

    // Arrived at the final waypoint -- mark the route complete (this is
    // what makes `reachedEnd` actually become true) and stop, rather than
    // endlessly orbiting on top of the destination.
    if (this.waypointIndex === this.route.length - 1 && dist < WAYPOINT_ARRIVAL_RADIUS) {
      this.waypointIndex = this.route.length;
      this._vector = STOPPED;
      this._stuckTimer = 0;
      return;
    }

    const targetAngle = Math.atan2(wp.y - vehicle.y, wp.x - vehicle.x);
    let angleDiff = targetAngle - vehicle.heading;
    // Normalize to (-PI, PI] so it always turns the short way round.
    angleDiff = Math.atan2(Math.sin(angleDiff), Math.cos(angleDiff));
    const absDiff = Math.abs(angleDiff);

    const turn = Math.max(-1, Math.min(1, angleDiff * TURN_GAIN));
    // Graduated braking into turns, not just a single on/off cutoff -- a
    // vehicle that stays at MAX_THROTTLE through a sharp correction has a
    // wide enough turning radius to overshoot the next waypoint entirely
    // (see the constants comment above), so the sharper the heading error,
    // the harder it eases off, down to a near-crawl for a near-reversal.
    let throttle = MAX_THROTTLE;
    if (absDiff > 1.4) throttle = MAX_THROTTLE * 0.2;
    else if (absDiff > 0.6) throttle = MAX_THROTTLE * 0.5;

    // Wedged against something (see the STUCK_* constants comment) -- back
    // out and turn away from whatever direction it was just trying to go,
    // then let normal steering take back over next frame.
    if (vehicle.speed < STUCK_SPEED) {
      this._stuckTimer += dt;
      if (this._stuckTimer > STUCK_TIME_LIMIT) {
        this._stuckTimer = 0;

        if (this._stuckWaypointIndex !== this.waypointIndex) {
          this._stuckWaypointIndex = this.waypointIndex;
          this._stuckAttempts = 0;
        }
        this._stuckAttempts++;

        if (this._stuckAttempts > MAX_UNSTICK_ATTEMPTS_PER_WAYPOINT && this.waypointIndex < this.route.length - 1) {
          // Reversing hasn't worked several times in a row on this same
          // waypoint -- give up on hitting it precisely and skip ahead.
          this.waypointIndex++;
          this._stuckAttempts = 0;
        }

        this._unstickTimer = UNSTICK_DURATION;
        this._unstickTurn = turn >= 0 ? -1 : 1;
        this._vector = { throttle: -1, turn: this._unstickTurn, turretTurn: 0 };
        return;
      }
    } else {
      this._stuckTimer = 0;
    }

    this._vector = { throttle, turn, turretTurn: 0 };
  }

  getVector() {
    return this._vector;
  }

  isFiring() {
    return false;
  }

  isFiring2() {
    return false;
  }
}
