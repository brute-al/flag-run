// A simple autonomous "input" source for a non-player Vehicle: instead of
// reading keys/gamepad state, it steers along a precomputed route (see
// pathfinding.js's findRoute) toward a target. Implements the same
// getVector()/isFiring()/isFiring2() interface Input/GamepadInput do, so a
// Vehicle can be driven by it exactly the way the player's vehicle is
// driven: `vehicle.update(dt, aiDriver.getVector())`.
//
// Milestone 1 (see DEPLOY_NOTES.md) was drive-only: "symmetric map + an AI
// vehicle that drives toward your flag, no combat yet". Milestone 2 adds
// combat on top of that same driving logic -- see _computeCombat() below --
// while staying just as "dumb" everywhere else: it doesn't re-plan mid-route,
// dodge, retreat, or take cover, it just follows the road route it was given
// and opportunistically shoots at a target when one's given and in range.
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

// Combat (milestone 2): meaningful only for an armed, turreted vehicle
// (currently just the tank) -- a no-op for anything else, like milestone 1's
// unarmed jeep AI, so it's always safe to call regardless of what's driving.
// "Simple rusher" per the design brief the user picked: the hull keeps
// driving toward its objective via the waypoint-following logic below no
// matter what's happening with the target, while the turret (bolted to the
// hull, see vehicle.js) independently swivels toward and fires at the target
// whenever it's within range and roughly aimed -- it never breaks off its
// route to chase, retreat, or take cover.
const ENGAGEMENT_RANGE = 560; // roughly matches a defensive turret's own range
const TURRET_TURN_GAIN = 3.2; // how eagerly the turret sweeps onto the target
const FIRE_AIM_TOLERANCE = 0.12; // radians of aim error still "close enough" to shoot

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
    this._firing = false; // combat: whether the weapon should fire this frame
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

  // Turret aim + fire decision. Independent of the driving state machine in
  // update() below -- computed unconditionally every frame so combat still
  // works whether the hull is cruising toward a waypoint, stuck and
  // reversing, or parked at the end of its route. Returns
  // { turretTurn, firing }; update() folds turretTurn into whatever
  // `_vector` it builds this frame instead of hardcoding it to 0.
  _computeCombat(vehicle, target) {
    if (!target || !vehicle.hasTurret || !vehicle.weapon) {
      return { turretTurn: 0, firing: false };
    }

    const dx = target.x - vehicle.x;
    const dy = target.y - vehicle.y;
    const dist = Math.hypot(dx, dy);
    if (dist > ENGAGEMENT_RANGE) {
      // Out of range -- let the turret just ride along with the hull
      // (turretTurn 0) instead of swiveling toward a target it can't hit yet.
      return { turretTurn: 0, firing: false };
    }

    const targetAngle = Math.atan2(dy, dx);
    let turretDiff = targetAngle - vehicle.turretAngle;
    turretDiff = Math.atan2(Math.sin(turretDiff), Math.cos(turretDiff));

    return {
      turretTurn: Math.max(-1, Math.min(1, turretDiff * TURRET_TURN_GAIN)),
      firing: Math.abs(turretDiff) < FIRE_AIM_TOLERANCE,
    };
  }

  // Call once per frame with the vehicle it's driving, the frame's dt, and
  // (optionally) a combat target such as the player's vehicle, before
  // reading getVector()/isFiring(). `target` defaults to null and is simply
  // ignored for a vehicle with no weapon/turret, so existing callers that
  // only care about driving (e.g. milestone 1's jeep AI, and tests) can keep
  // calling update(vehicle, dt) unchanged.
  update(vehicle, dt, target = null) {
    const combat = this._computeCombat(vehicle, target);
    this._firing = combat.firing;

    const STOPPED = { throttle: 0, turn: 0, turretTurn: combat.turretTurn };

    if (this._unstickTimer > 0) {
      this._unstickTimer -= dt;
      this._vector = { throttle: -1, turn: this._unstickTurn, turretTurn: combat.turretTurn };
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
      // Parked at the destination doesn't mean combat stops -- STOPPED
      // already carries this frame's real turretTurn, not a hardcoded 0.
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
        this._vector = { throttle: -1, turn: this._unstickTurn, turretTurn: combat.turretTurn };
        return;
      }
    } else {
      this._stuckTimer = 0;
    }

    this._vector = { throttle, turn, turretTurn: combat.turretTurn };
  }

  getVector() {
    return this._vector;
  }

  isFiring() {
    return this._firing;
  }

  isFiring2() {
    return false;
  }
}
