// Headless logic tests. Exercises Game directly (no DOM/canvas/audio — those
// are wired up separately in main.js) to check the full mechanic set:
// per-vehicle drift/movement, jeep-only flag pickup, weapons damaging
// turrets, the shared finite-lives round-loss condition across all three
// vehicle types, mid-round vehicle switching at base, and (experimental)
// duel mode's mirrored map + AI opponent pathing.

import { Game } from "../src/game.js";
import { VEHICLE_TYPES, Vehicle } from "../src/vehicle.js";
import { Bullet } from "../src/entities.js";
import { ParticleSystem } from "../src/effects.js";
import { Camera } from "../src/camera.js";
import { MAP_DATA } from "../src/mapData.js";
import { mirrorMapData } from "../src/mirrorMap.js";
import { buildRoadGraph, findRoute } from "../src/pathfinding.js";
import { AIDriver } from "../src/aiDriver.js";

const dt = 1 / 60;
let allPass = true;

function check(label, cond) {
  console.log(`  ${cond ? "PASS" : "FAIL"} — ${label}`);
  if (!cond) allPass = false;
  return cond;
}

function makeInput() {
  const state = { throttle: 0, turn: 0, fire: false, fire2: false, turretTurn: 0 };
  return {
    set: (v) => Object.assign(state, v),
    getVector: () => ({ throttle: state.throttle, turn: state.turn, turretTurn: state.turretTurn }),
    isFiring: () => state.fire,
    isFiring2: () => state.fire2,
  };
}

// --- 1. Core loop per vehicle type (movement, pickup, win) -----------------
// Tests pickup/win mechanics via direct placement rather than a "steer
// straight at the target" autopilot: a naive pursuit bot has no obstacle
// avoidance and can genuinely wedge itself against a randomly-placed rock,
// or (independent of any obstacle) fall into the classic pure-pursuit
// failure mode of orbiting a point target forever once its minimum turning
// radius exceeds the arrival threshold. Neither is a real gameplay bug --
// a human player brakes and corrects -- so direct placement (already proven
// out for the real-world map in section 5) is what actually isolates the
// mechanic under test.
console.log("\n=== Core loop per vehicle (jeep should win; tank/heli cannot carry the flag) ===");
for (const type of Object.keys(VEHICLE_TYPES)) {
  const input = makeInput();
  const game = new Game(input, { useRealMap: false });
  game.chooseVehicle(type);

  // Basic physics sanity: holding forward throttle should actually move the
  // vehicle in open ground.
  const startX = game.vehicle.x;
  const startY = game.vehicle.y;
  input.set({ throttle: 1, turn: 0 });
  for (let i = 0; i < 60; i++) game.update(dt);
  const moved = Math.hypot(game.vehicle.x - startX, game.vehicle.y - startY) > 20;
  input.set({ throttle: 0, turn: 0 });

  // Pickup: place the vehicle directly on the flag.
  game.vehicle.x = game.flag.homeX;
  game.vehicle.y = game.flag.homeY;
  game.update(dt);
  const pickedUp = game.flag.carrier === game.vehicle;

  // Win: if it picked up the flag, deliver it home; otherwise confirm a win
  // is impossible without ever having carried it.
  game.vehicle.x = game.arena.playerBase.x;
  game.vehicle.y = game.arena.playerBase.y;
  game.update(dt);
  const won = game.state === "won";

  console.log(`[${type}]`);
  check("moves under forward throttle", moved);
  if (type === "jeep") {
    check("picked up the flag", pickedUp);
    check("won by delivering the flag home", won);
  } else {
    check("did NOT pick up the flag (jeep-only)", !pickedUp);
    check("did NOT trigger a win (can't carry flag)", !won);
  }
}

// --- 2. Weapons damage/destroy turrets (tank + heli only) -----------------
console.log("\n=== Player weapons vs turrets ===");
for (const type of ["tank", "heli"]) {
  const input = makeInput();
  const game = new Game(input);
  game.chooseVehicle(type);

  const turret = game.turrets[0];
  // Park just inside weapon+turret range, facing the turret, and hold fire.
  game.vehicle.x = turret.x;
  game.vehicle.y = turret.y - 150;
  game.vehicle.heading = Math.PI / 2; // facing +y, i.e. toward the turret

  let sawTurretHit = false;
  let sawTurretDestroyed = false;
  for (let i = 0; i < 60 * 15 && !turret.destroyed; i++) {
    // Turret return fire is randomized (spread + who-shoots-first luck), so
    // the lighter heli can occasionally die and respawn mid-loop before it
    // finishes off the turret. Re-pin position/heading every frame so a
    // respawn (which moves the vehicle back to base) doesn't derail this
    // test -- we're testing "can this weapon destroy a turret", not "can
    // this vehicle survive standing still under turret fire".
    game.vehicle.x = turret.x;
    game.vehicle.y = turret.y - 150;
    game.vehicle.heading = Math.PI / 2;
    input.set({ throttle: 0, turn: 0, fire: true });
    game.update(dt);
    for (const e of game.drainEvents()) {
      if (e === "turretHit") sawTurretHit = true;
      if (e === "turretDestroyed") sawTurretDestroyed = true;
    }
  }

  console.log(`[${type} — weapon: ${VEHICLE_TYPES[type].weapon.label}]`);
  check("fired on and hit the turret", sawTurretHit);
  check("destroyed the turret", turret.destroyed && sawTurretDestroyed);
}
{
  // Jeep has no weapon at all — firing should be a no-op, never spawn a bullet.
  const input = makeInput();
  const game = new Game(input);
  game.chooseVehicle("jeep");
  input.set({ throttle: 0, turn: 0, fire: true });
  for (let i = 0; i < 60; i++) game.update(dt);
  console.log("[jeep — unarmed]");
  check("firing produces no bullets (jeep has no weapon)", game.bullets.length === 0);
}

// --- 3. Lives: a shared garage across vehicle types, round lost only once
// every type is exhausted (2 tanks, 2 helis, 3 jeeps by default) ----------
console.log("\n=== Vehicle lives / round-loss (shared across all types) ===");
{
  const input = makeInput();
  const game = new Game(input);
  game.chooseVehicle("jeep");
  input.set({ throttle: 0, turn: 0 });

  console.log("[starting life counts]");
  check(
    "starts with the documented life counts (3 jeeps, 2 tanks, 2 helis)",
    game.lives.jeep === 3 && game.lives.tank === 2 && game.lives.heli === 2
  );

  // Kills the active vehicle, fast-forwards through the respawn delay if the
  // round didn't end, and returns the state right after the death (before
  // any respawn fast-forward) so callers can distinguish "respawning" from
  // "lost" at the exact moment lives ran out.
  function killAndRespawn() {
    game.health = 0;
    game.update(dt);
    const stateRightAfterDeath = game.state;
    for (let i = 0; i < 200 && game.state === "respawning"; i++) game.update(dt);
    return stateRightAfterDeath;
  }

  console.log("[jeep lives run out -- auto-switches to the tank instead of ending the round]");
  killAndRespawn(); // jeep: 3 -> 2
  killAndRespawn(); // jeep: 2 -> 1
  const thirdJeepDeathState = killAndRespawn(); // jeep: 1 -> 0, out of jeeps
  check("round is NOT lost once only the jeep type runs out (tank/heli remain)", thirdJeepDeathState === "respawning");
  check("game keeps playing after auto-switching away from the jeep", game.state === "playing");
  check("auto-switched into the tank once jeeps were exhausted", game.vehicle.type === "tank");
  check("jeep lives are at zero", game.lives.jeep === 0);

  console.log("[tank lives also run out -- auto-switches to the helicopter]");
  killAndRespawn(); // tank: 2 -> 1
  const secondTankDeathState = killAndRespawn(); // tank: 1 -> 0
  check("round still not lost once the tank also runs out (heli remains)", secondTankDeathState === "respawning");
  check("auto-switched into the helicopter once tanks were exhausted too", game.vehicle.type === "heli");

  console.log("[helicopter lives run out too -- whole garage is empty, round lost]");
  killAndRespawn(); // heli: 2 -> 1
  const finalDeathState = killAndRespawn(); // heli: 1 -> 0, every type now exhausted
  check("round is lost only once every vehicle type is exhausted", finalDeathState === "lost" && game.state === "lost");
  check(
    "all three types show zero lives left",
    game.lives.jeep === 0 && game.lives.tank === 0 && game.lives.heli === 0
  );
}

// --- 4. Mid-round vehicle switching at base --------------------------------
console.log("\n=== Base vehicle switching ===");
{
  const input = makeInput();
  const game = new Game(input);
  game.chooseVehicle("tank");
  const arenaRef = game.arena;
  const flagRef = game.flag;
  const turretsRef = game.turrets;

  const atBase = game.isAtOwnBase();
  const switched = game.switchVehicle("jeep");

  console.log("[switch at base]");
  check("vehicle starts inside its own base", atBase);
  check("switch succeeds while at base", switched);
  check("active vehicle is now the jeep", game.vehicle.type === "jeep");
  check("arena/flag/turrets are untouched by the switch", game.arena === arenaRef && game.flag === flagRef && game.turrets === turretsRef);
}
{
  const input = makeInput();
  const game = new Game(input);
  game.chooseVehicle("tank");
  // Drive well outside the base circle, then attempt to switch.
  game.vehicle.x = game.arena.playerBase.x;
  game.vehicle.y = game.arena.playerBase.y + game.arena.playerBase.radius + 400;
  const switched = game.switchVehicle("jeep");
  console.log("[switch away from base]");
  check("switch is rejected away from base", !switched && game.vehicle.type === "tank");
}

// --- 5. Real-world map data (buildings/roads) loads and renders cleanly ---
console.log("\n=== Real-world neighborhood map ===");
{
  const input = makeInput();
  const game = new Game(input);
  game.chooseVehicle("jeep");
  const arena = game.arena;

  check("arena is using the real-world map", arena.isRealWorld === true);
  check("world size matches the imported map data", arena.width > 0 && arena.height > 0);
  check("buildings were converted into obstacles", arena.obstacles.length > 100);
  check("roads were carried over", arena.roads.length > 0);
  check(
    "no building obstacle overlaps either base",
    arena.obstacles.every(
      (o) =>
        Math.hypot(o.x - arena.playerBase.x, o.y - arena.playerBase.y) > arena.playerBase.radius + o.radius &&
        Math.hypot(o.x - arena.enemyBase.x, o.y - arena.enemyBase.y) > arena.enemyBase.radius + o.radius
    )
  );

  // The real street grid is dense enough that a straight-line "just drive at
  // it" bot gets wedged against buildings (unlike the sparse procedural
  // arena) -- a human navigates by following streets and turning at
  // intersections instead. So rather than assert an autopilot can complete
  // the run, this proves the thing that actually matters: the two bases are
  // reachable from one another by *some* path through the actual road
  // network, i.e. the map isn't accidentally unwinnable.
  {
    const key = (x, y) => `${Math.round(x / 2)},${Math.round(y / 2)}`; // snap to merge near-duplicate float endpoints
    const adj = new Map();
    const keyToPoint = new Map();
    const addEdge = (a, b) => {
      if (!adj.has(a)) adj.set(a, new Set());
      if (!adj.has(b)) adj.set(b, new Set());
      adj.get(a).add(b);
      adj.get(b).add(a);
    };
    for (const road of arena.roads) {
      for (let i = 0; i < road.length - 1; i++) {
        const [x1, y1] = road[i];
        const [x2, y2] = road[i + 1];
        const k1 = key(x1, y1);
        const k2 = key(x2, y2);
        keyToPoint.set(k1, [x1, y1]);
        keyToPoint.set(k2, [x2, y2]);
        addEdge(k1, k2);
      }
    }
    const nearestNodeKey = (x, y) => {
      let best = null;
      let bestD = Infinity;
      for (const [k, [nx, ny]] of keyToPoint) {
        const d = Math.hypot(nx - x, ny - y);
        if (d < bestD) {
          bestD = d;
          best = k;
        }
      }
      return best;
    };
    const startKey = nearestNodeKey(arena.playerBase.x, arena.playerBase.y);
    const endKey = nearestNodeKey(arena.enemyBase.x, arena.enemyBase.y);
    const visited = new Set([startKey]);
    const queue = [startKey];
    let connected = false;
    while (queue.length) {
      const cur = queue.shift();
      if (cur === endKey) {
        connected = true;
        break;
      }
      for (const next of adj.get(cur) || []) {
        if (!visited.has(next)) {
          visited.add(next);
          queue.push(next);
        }
      }
    }
    check("road network has a path connecting the two bases", connected);
  }

  // Capture mechanics themselves (pickup, carry, win) still work with real
  // building obstacles in the mix -- tested by placing the jeep directly
  // rather than relying on autopilot navigation (see comment above).
  {
    game.vehicle.x = game.flag.homeX;
    game.vehicle.y = game.flag.homeY;
    game.update(dt);
    const pickedUp = game.flag.carrier === game.vehicle;

    game.vehicle.x = arena.playerBase.x;
    game.vehicle.y = arena.playerBase.y;
    game.update(dt);
    const won = game.state === "won";

    check("jeep can pick up the flag on the real map", pickedUp);
    check("delivering it home still triggers a win on the real map", won);
  }

  // A minimal fake canvas context: enough surface area for arena/entity/vehicle
  // draw code to run against without a real DOM, just to catch runtime errors
  // (draw() doesn't mutate game state, so this is purely a smoke test).
  const noop = () => {};
  const fakeCtx = new Proxy(
    {},
    {
      get(target, prop) {
        if (prop in target) return target[prop];
        if (["fillStyle", "strokeStyle", "lineWidth", "lineCap", "lineJoin", "font", "textAlign"].includes(prop)) {
          return target[prop] ?? "";
        }
        return noop;
      },
      set(target, prop, value) {
        target[prop] = value;
        return true;
      },
    }
  );

  let drawError = null;
  try {
    for (let i = 0; i < 5; i++) {
      game.update(dt);
      game.draw(fakeCtx, 1600, 900);
    }
  } catch (err) {
    drawError = err;
  }
  check("draw() runs against the real map without throwing", drawError === null);
  if (drawError) console.error(drawError);
}

// --- 6. Destructible buildings ---------------------------------------------
console.log("\n=== Destructible buildings ===");
{
  const input = makeInput();
  const game = new Game(input);
  game.chooseVehicle("tank");
  const arena = game.arena;
  const target = arena.obstacles.find((o) => o.destructible && !o.destroyed);

  if (!target) {
    check("found a destructible building to test against", false);
  } else {
    const startHealth = target.health;

    // Spawn a friendly bullet directly on the building and step once --
    // isolates the damage-application logic from driving/aiming.
    game.bullets.push(new Bullet(target.x, target.y, 0, 0, 40, true));
    game.update(dt);
    const events1 = game.drainEvents();

    console.log("[weapon fire vs a building]");
    check("friendly bullet damaged the building", target.health === startHealth - 40);
    check("buildingHit event fired", events1.includes("buildingHit"));
    check("not destroyed yet after one hit (maxHealth 55 > 40)", target.destroyed === false);

    // Finish it off.
    game.bullets.push(new Bullet(target.x, target.y, 0, 0, 60, true));
    game.update(dt);
    const events2 = game.drainEvents();

    check("building destroyed once health reaches 0", target.destroyed === true);
    check("buildingDestroyed event fired", events2.includes("buildingDestroyed"));

    // A destroyed building should stop blocking both vehicle movement and
    // bullets. Real building footprints sit close together (rowhouses,
    // shared walls), so testing at the destroyed building's exact centroid
    // against the FULL obstacle list can trip over a still-intact neighbor
    // that happens to also cover that point -- that would be a false
    // failure of a different building's collision, not this one's. Isolate
    // the check to just the destroyed obstacle to test the thing that
    // actually changed: does `destroyed` correctly get skipped.
    const savedObstacles = game.arena.obstacles;
    game.arena.obstacles = [target];

    game.vehicle.x = target.x;
    game.vehicle.y = target.y;
    game.vehicle.vx = 0;
    game.vehicle.vy = 0;
    game.arena.resolveObstacleCollisions(game.vehicle);
    check(
      "destroyed building no longer blocks vehicle movement",
      game.vehicle.x === target.x && game.vehicle.y === target.y
    );

    const passThroughBullet = new Bullet(target.x - 5, target.y, 0, 100, 10, true);
    game.bullets = [passThroughBullet];
    game.update(dt);
    check("destroyed building no longer blocks bullets", !passThroughBullet.dead);

    game.arena.obstacles = savedObstacles;
  }

  // Turret fire should erode buildings too, not just the player's own
  // weapons -- cover is meant to be a temporary resource that degrades
  // under sustained enemy fire, not a permanent safe spot.
  const target2 = arena.obstacles.find((o) => o.destructible && !o.destroyed);
  if (!target2) {
    check("found a second destructible building for the turret-fire check", false);
  } else {
    const startHealth2 = target2.health;
    // `friendly = false` (the default) mirrors an actual turret bullet.
    game.bullets.push(new Bullet(target2.x, target2.y, 0, 0, 9, false));
    game.update(dt);
    const events3 = game.drainEvents();

    console.log("[turret fire vs a building]");
    check("turret (non-friendly) bullet damaged the building", target2.health === startHealth2 - 9);
    check("buildingHit event fired for turret fire too", events3.includes("buildingHit"));
  }
}

// --- 7. Collision uses real building polygons, not inflated bounding circles ---
console.log("\n=== Polygon-accurate building collision ===");
{
  const input = makeInput();
  const game = new Game(input);
  game.chooseVehicle("jeep");
  const arena = game.arena;

  function closestPointOnSegmentLocal(px, py, ax, ay, bx, by) {
    const abx = bx - ax, aby = by - ay;
    const t = Math.max(0, Math.min(1, ((px - ax) * abx + (py - ay) * aby) / (abx * abx + aby * aby || 1e-9)));
    return { x: ax + abx * t, y: ay + aby * t };
  }
  function pointInPolygonLocal(px, py, facets) {
    let inside = false;
    for (let i = 0, j = facets.length - 1; i < facets.length; j = i++) {
      const xi = facets[i].x, yi = facets[i].y, xj = facets[j].x, yj = facets[j].y;
      const intersect = yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;
      if (intersect) inside = !inside;
    }
    return inside;
  }

  // Find a building whose bounding circle is noticeably bigger than its real
  // footprint (elongated/irregular shapes -- exactly what the old circle
  // approximation over-blocked). Buildings in a real street grid can be
  // concave (L-shapes, merged rowhouses), so don't just trust the geometric
  // heuristic: for each candidate, directly verify with point-in-polygon and
  // real edge distance that a point in the "gap" truly is outside the
  // footprint and clear of the vehicle radius, and use the first one that
  // checks out.
  const candidates = arena.obstacles
    .filter((o) => o.facets && o.facets.length >= 3)
    .map((o) => {
      let minEdgeDist = Infinity;
      for (let i = 0; i < o.facets.length; i++) {
        const a = o.facets[i];
        const b = o.facets[(i + 1) % o.facets.length];
        const cp = closestPointOnSegmentLocal(0, 0, a.x, a.y, b.x, b.y);
        minEdgeDist = Math.min(minEdgeDist, Math.hypot(cp.x, cp.y));
      }
      return { o, gap: o.radius - minEdgeDist };
    })
    .sort((a, b) => b.gap - a.gap);

  check("found a building where bounding-circle padding exceeds real edge distance", candidates[0]?.gap > 5);

  const vehicleRadius = game.vehicle.radius;
  let verified = null;
  for (const { o } of candidates.slice(0, 50)) {
    // Sample several directions from the centroid (not just the single
    // nearest-edge direction, which breaks down for concave shapes) looking
    // for a point that's inside the bounding circle, outside the real
    // polygon, and comfortably clear of the vehicle's radius.
    for (let a = 0; a < 16; a++) {
      const angle = (a / 16) * Math.PI * 2;
      const testDist = o.radius * 0.75;
      const px = Math.cos(angle) * testDist;
      const py = Math.sin(angle) * testDist;
      if (pointInPolygonLocal(px, py, o.facets)) continue;
      let bestEdgeDist = Infinity;
      for (let i = 0; i < o.facets.length; i++) {
        const fa = o.facets[i];
        const fb = o.facets[(i + 1) % o.facets.length];
        const cp = closestPointOnSegmentLocal(px, py, fa.x, fa.y, fb.x, fb.y);
        bestEdgeDist = Math.min(bestEdgeDist, Math.hypot(px - cp.x, py - cp.y));
      }
      if (bestEdgeDist > vehicleRadius + 8) {
        verified = { o, x: o.x + px, y: o.y + py };
        break;
      }
    }
    if (verified) break;
  }

  check("found a verified outside-polygon-but-inside-bounding-circle test point", verified !== null);
  if (verified) {
    game.vehicle.x = verified.x;
    game.vehicle.y = verified.y;
    game.vehicle.vx = 0;
    game.vehicle.vy = 0;
    const beforeX = game.vehicle.x;
    const beforeY = game.vehicle.y;

    // Isolate to just this building -- a dense real-world grid means other
    // nearby buildings could also (correctly) push the vehicle, which would
    // be a false failure of this specific check.
    const savedObstacles = game.arena.obstacles;
    game.arena.obstacles = [verified.o];
    game.arena.resolveObstacleCollisions(game.vehicle);
    game.arena.obstacles = savedObstacles;

    check(
      "vehicle in the bounding-circle-but-outside-polygon gap is NOT pushed (real street space is drivable)",
      game.vehicle.x === beforeX && game.vehicle.y === beforeY
    );
  }
}

// --- 8. Tall turrets fire over rooftops -------------------------------------
console.log("\n=== Tall turrets fire over rooftops ===");
{
  const input = makeInput();
  const game = new Game(input);
  game.chooseVehicle("jeep");

  const tallTurrets = game.turrets.filter((t) => t.tall);
  console.log("[turret layout]");
  check("8 turrets total", game.turrets.length === 8);
  check("exactly 4 of the 8 turrets are tall", tallTurrets.length === 4);

  const building = game.arena.obstacles.find((o) => o.destructible && !o.destroyed);
  if (!building) {
    check("found a building to test tall-turret fire against", false);
  } else {
    console.log("[tall vs normal turret fire through a building]");
    const tallBullet = new Bullet(building.x, building.y, 0, 0, 9, false, true);
    game.bullets = [tallBullet];
    game.update(dt);
    check("a tall-turret bullet passes straight through a building", !tallBullet.dead);

    const normalBullet = new Bullet(building.x, building.y, 0, 0, 9, false, false);
    game.bullets = [normalBullet];
    game.update(dt);
    check("a normal turret bullet at the same spot is still blocked by the building", normalBullet.dead);
  }
}

// --- 9. Helicopter throttle thrust is heading-relative ---------------------
// Regardless of how yaw/strafe are wired up (see section 13), throttle
// should always thrust along wherever the nose is currently pointing.
console.log("\n=== Helicopter throttle thrust is heading-relative ===");
{
  const heli = new Vehicle(0, 0, Math.PI / 2, "heli"); // facing +y
  heli.update(dt, { throttle: 1, turn: 0, turretTurn: 0 });
  console.log("[heli throttle]");
  check("heli thrust is heading-relative (vy > 0, matching its nose)", heli.vy > 0);
}

// --- 10. Helicopter secondary missile weapon (arcs over rooftops) ---------
console.log("\n=== Helicopter missile weapon ===");
{
  const input = makeInput();
  const game = new Game(input);
  game.chooseVehicle("heli");

  check("heli has a secondary missile weapon", !!game.vehicle.weapon2 && game.vehicle.weapon2.label === "missile");
  check("jeep/tank have no secondary weapon", !new Vehicle(0, 0, 0, "jeep").weapon2 && !new Vehicle(0, 0, 0, "tank").weapon2);

  // Missiles should hit turrets just like the chaingun does.
  const turret = game.turrets[0];
  game.vehicle.x = turret.x;
  game.vehicle.y = turret.y - 150;
  game.vehicle.heading = Math.PI / 2;

  let sawTurretHit = false;
  for (let i = 0; i < 60 * 3 && !sawTurretHit; i++) {
    input.set({ throttle: 0, turn: 0, fire: false, fire2: true });
    game.update(dt);
    for (const e of game.drainEvents()) {
      if (e === "turretHit") sawTurretHit = true;
    }
  }
  console.log("[missile vs turret]");
  check("holding the missile trigger (F) hits a turret", sawTurretHit);

  // The actual point of the missile: it should sail over a building instead
  // of colliding with it, unlike the regular chaingun round.
  const building = game.arena.obstacles.find((o) => o.destructible && !o.destroyed);
  if (!building) {
    check("found a building to test the missile against", false);
  } else {
    console.log("[missile vs a building it should fly over]");
    const missile = new Bullet(building.x, building.y, 0, 0, 25, true, true, 6);
    game.bullets = [missile];
    game.update(dt);
    check("a friendly missile passes straight through a building", !missile.dead);

    const chaingunRound = new Bullet(building.x, building.y, 0, 0, 7, true, false);
    game.bullets = [chaingunRound];
    game.update(dt);
    check("a regular chaingun round at the same spot is still blocked by the building", chaingunRound.dead);
  }
}

// --- 11. Tank turret glued to the hull, traversed with Q/E -----------------
console.log("\n=== Tank turret follows the hull, traversable independently ===");
{
  const input = makeInput();
  const game = new Game(input, { useRealMap: false });
  game.chooseVehicle("tank");

  console.log("[turret setup]");
  check("tank has an independently-aimable turret", game.vehicle.hasTurret === true);
  check("turret starts aligned with the hull heading", game.vehicle.turretAngle === game.vehicle.heading);
  check("jeep has no turret", !new Vehicle(0, 0, 0, "jeep").hasTurret);
  check("heli has no turret", !new Vehicle(0, 0, 0, "heli").hasTurret);

  // Q/E (or a gamepad's shoulder buttons, both feeding the same `turretTurn`
  // input) traverse the turret WITHOUT touching the hull heading.
  const startHeading = game.vehicle.heading;
  input.set({ throttle: 0, turn: 0, turretTurn: 1 });
  for (let i = 0; i < 30; i++) game.update(dt);
  console.log("[traversing the turret]");
  check("turning the turret changed turretAngle", game.vehicle.turretAngle !== startHeading);
  check("turning the turret left the hull heading untouched", game.vehicle.heading === startHeading);

  // But the turret is bolted to the hull: once the hull itself turns, the
  // turret should turn right along with it, preserving whatever offset the
  // player dialed in with Q/E -- like a real turret ring.
  const offsetAfterTraverse = game.vehicle.turretAngle - game.vehicle.heading;
  input.set({ throttle: 1, turn: 1, turretTurn: 0 });
  for (let i = 0; i < 30; i++) game.update(dt);
  console.log("[turret glued to a turning hull]");
  check("driving/turning the hull did change the hull heading", game.vehicle.heading !== startHeading);
  check("the turret angle changed along with the turning hull", game.vehicle.turretAngle !== offsetAfterTraverse + startHeading);
  const offsetNow = game.vehicle.turretAngle - game.vehicle.heading;
  check(
    "the turret's offset from the hull was preserved while the hull turned",
    Math.abs(offsetNow - offsetAfterTraverse) < 1e-6
  );

  // The cannon should still fire along the turret's angle, not the hull's --
  // point the hull one way and the turret the opposite way, then confirm
  // the shot travels along the turret's direction.
  game.vehicle.x = 0;
  game.vehicle.y = 0;
  game.vehicle.vx = 0;
  game.vehicle.vy = 0;
  game.vehicle.heading = Math.PI; // hull facing "west" (-x)
  game.vehicle.turretAngle = 0; // turret facing "east" (+x), independent of the hull
  game.vehicle.weapon.cooldown = 0;
  input.set({ throttle: 0, turn: 0, turretTurn: 0, fire: true });
  game.update(dt);
  const cannonBullet = game.bullets.find((b) => b.friendly);
  console.log("[cannon fires along the turret, not the hull]");
  check("a cannon round was fired", !!cannonBullet);
  if (cannonBullet) {
    check("it travels along the turret's angle (+x), not the hull's (-x)", cannonBullet.vx > 0);
  }
}

// --- 12. Gamepad input merges with keyboard without needing one connected -
console.log("\n=== Gamepad input (no controller connected) ===");
{
  const { GamepadInput } = await import("../src/gamepadInput.js");
  const { CombinedInput } = await import("../src/combinedInput.js");
  const pad = new GamepadInput();
  const vec = pad.getVector();
  console.log("[gamepad with nothing connected]");
  check("produces a neutral vector when no gamepad is connected", vec.throttle === 0 && vec.turn === 0 && vec.turretTurn === 0);
  check("isFiring/isFiring2 are false with nothing connected", !pad.isFiring() && !pad.isFiring2());

  const kb = makeInput();
  const combined = new CombinedInput(kb, pad);
  kb.set({ throttle: 1, turn: -1, turretTurn: 1, fire: true, fire2: false });
  const merged = combined.getVector();
  console.log("[combined input with keyboard only]");
  check("keyboard-only input passes through the combiner unchanged", merged.throttle === 1 && merged.turn === -1 && merged.turretTurn === 1);
  check("isFiring reflects the keyboard when the gamepad is idle", combined.isFiring() === true && combined.isFiring2() === false);
}

// --- 13. Helicopter: stick strafes, rotate input spins it in place --------
// The heli's yaw reuses the same "independent, no-momentum-coupling" rotate
// input as the tank's turret traverse (Q/E, or a controller's shoulder
// buttons) -- fully decoupled from translation. Pushing the stick left/right
// now strafes the airframe relative to its own nose instead of yawing it.
console.log("\n=== Helicopter: stick strafes, rotate input spins it ===");
{
  const heli = new Vehicle(0, 0, 0, "heli");
  heli.vx = 0;
  heli.vy = 0;
  heli.update(dt, { throttle: 0, turn: 0, turretTurn: 1 });
  const turnRate = VEHICLE_TYPES.heli.turnRate;
  const expectedFullRate = turnRate * dt;
  console.log("[heli rotate input while stationary]");
  check(
    "heli heading changed at (approximately) the full turnRate from the rotate input",
    Math.abs(heli.heading - expectedFullRate) < 1e-6
  );

  // A ground vehicle, by contrast, steers with its own `turn` input and
  // stays damped at standstill -- a regression guard that the heli's rotate
  // scheme (and turnRate/dt shortcut above) is heli-only.
  const tank = new Vehicle(0, 0, 0, "tank");
  tank.vx = 0;
  tank.vy = 0;
  tank.update(dt, { throttle: 0, turn: 1, turretTurn: 0 });
  const tankExpectedFullRate = VEHICLE_TYPES.tank.turnRate * dt;
  check(
    "tank (ground vehicle) is still damped at standstill on its own turn input",
    Math.abs(tank.heading - tankExpectedFullRate) > 1e-6
  );

  console.log("[heli stick strafing]");
  const heli2 = new Vehicle(0, 0, 0, "heli");
  heli2.vx = 0;
  heli2.vy = 0;
  const headingBefore = heli2.heading;
  heli2.update(dt, { throttle: 0, turn: 1, turretTurn: 0 });
  check("pushing the strafe axis left the heli's heading untouched", heli2.heading === headingBefore);
  check("pushing the strafe axis gave the heli lateral velocity", Math.hypot(heli2.vx, heli2.vy) > 0);
}

// --- 14. Damage-color helper ------------------------------------------------
console.log("\n=== Damage-tint color helper ===");
{
  const { lerpColor, damageTint, DAMAGE_COLOR } = await import("../src/colorUtils.js");
  console.log("[lerpColor]");
  check("t=0 returns the first color unchanged", lerpColor("#4fa8e0", "#ff2a2a", 0) === "#4fa8e0");
  check("t=1 returns the second color", lerpColor("#4fa8e0", "#ff2a2a", 1) === "#ff2a2a");

  console.log("[damageTint]");
  check("full health (1) leaves the base color untouched", damageTint("#4fa8e0", 1) === "#4fa8e0");
  const halfHurt = damageTint("#4fa8e0", 0.5);
  const nearDead = damageTint("#4fa8e0", 0.05);
  check("tint at half health differs from the base color", halfHurt !== "#4fa8e0");
  check("tint gets closer to the damage color as health drops further", nearDead !== halfHurt);
  check("damage color constant is a valid hex color", /^#[0-9a-f]{6}$/i.test(DAMAGE_COLOR));
}

// --- 15. Powerups hidden in buildings ---------------------------------------
// A handful of buildings secretly carry a powerup (OVERCHARGE / BIG SHOT /
// LASER / ARMOR). Knocking one down drops a pickup; driving over it starts a
// timed buff; that buff modifies every shot fired while it's running (or,
// for ARMOR, every hit the vehicle takes instead).
console.log("\n=== Powerups hidden in buildings ===");
{
  const input = makeInput();
  const game = new Game(input);
  game.chooseVehicle("tank");
  const arena = game.arena;
  const VALID_TYPES = ["overcharge", "bigShot", "laser", "armor"];

  console.log("[seeding]");
  const seeded = arena.obstacles.filter((o) => o.hasPowerup);
  check("a handful of buildings were seeded with a powerup", seeded.length > 0 && seeded.length <= 5);
  check("every seeded building has a valid powerup type", seeded.every((o) => VALID_TYPES.includes(o.powerupType)));

  const target = seeded[0];
  if (!target) {
    check("found a seeded building to test destruction against", false);
  } else {
    // Real-world buildings sit close enough together that a bullet aimed at
    // one exact spot can have its bounding-circle broad-phase match a
    // different building first (already covered, correctly, by the polygon
    // collision tests) -- that's a targeting concern, not what this test is
    // about. So the destroy-and-drop-a-pickup behavior is exercised directly
    // rather than through bullet-vs-building collision search.
    console.log("[destroying a seeded building drops a pickup]");
    target.health = 0;
    game._destroyBuilding(target);
    const events = game.drainEvents();
    check("the seeded building was destroyed", target.destroyed === true);
    check("buildingDestroyed fired", events.includes("buildingDestroyed"));
    check("a powerup pickup was dropped at the building's spot", game.powerupPickups.length === 1);
    const pickup = game.powerupPickups[0];
    check("the pickup's type matches the building's hidden type", !!pickup && pickup.type === target.powerupType);

    console.log("[driving over the pickup starts the buff]");
    game.vehicle.x = pickup.x;
    game.vehicle.y = pickup.y;
    game.update(dt);
    const events2 = game.drainEvents();
    check("powerupPickup event fired", events2.includes("powerupPickup"));
    check("the pickup was collected", game.powerupPickups.length === 0);
    check(
      "activePowerup now matches the collected type",
      !!game.activePowerup && game.activePowerup.type === target.powerupType
    );
    check("the buff timer starts near its full duration", game.activePowerup.timeLeft > 14);
  }

  console.log("[expiry]");
  game.activePowerup = { type: "overcharge", timeLeft: 0.001 };
  game.update(dt);
  const eventsExpire = game.drainEvents();
  check("the buff clears once its timer runs out", game.activePowerup === null);
  check("powerupExpired event fired", eventsExpire.includes("powerupExpired"));

  console.log("[weapon modifiers]");
  game.activePowerup = null;
  const neutral = game._weaponModifiers();
  check(
    "no active powerup means neutral modifiers",
    neutral.damageMult === 1 && neutral.radiusMult === 1 && !neutral.piercing && neutral.damageTakenMult === 1
  );

  game.activePowerup = { type: "overcharge", timeLeft: 5 };
  check("OVERCHARGE doubles damage", game._weaponModifiers().damageMult === 2);

  game.activePowerup = { type: "bigShot", timeLeft: 5 };
  const bigShotMod = game._weaponModifiers();
  check("BIG SHOT fattens the bullet radius", bigShotMod.radiusMult > 1);
  check("BIG SHOT also hits harder", bigShotMod.damageMult > 1);

  game.activePowerup = { type: "laser", timeLeft: 5 };
  check("LASER makes shots piercing", game._weaponModifiers().piercing === true);

  console.log("[ARMOR: defensive, not offensive]");
  game.activePowerup = { type: "armor", timeLeft: 5 };
  const armorMod = game._weaponModifiers();
  check("ARMOR doesn't touch outgoing damage or radius", armorMod.damageMult === 1 && armorMod.radiusMult === 1);
  check("ARMOR isn't piercing", armorMod.piercing === false);
  check("ARMOR halves incoming damage", armorMod.damageTakenMult === 0.5);

  // Parked inside the player's own base -- guaranteed clear of any building
  // (they're filtered out near both bases, see Arena's constructor), so the
  // bullet can't get intercepted by an obstacle before reaching the vehicle.
  const baseX = arena.playerBase.x;
  const baseY = arena.playerBase.y;

  console.log("[ARMOR actually halves damage taken from a hit]");
  game.state = "playing";
  game.health = 100;
  game.vehicle.x = baseX;
  game.vehicle.y = baseY;
  game.bullets = [new Bullet(baseX, baseY, 0, 0, 20, false)]; // enemy bullet, sitting right on the vehicle
  game.update(dt);
  check("a 20-damage hit under ARMOR only took 10 health", game.health === 90);
  game.activePowerup = null;

  console.log("[without ARMOR, the same hit takes full damage]");
  game.health = 100;
  game.vehicle.x = baseX;
  game.vehicle.y = baseY;
  game.bullets = [new Bullet(baseX, baseY, 0, 0, 20, false)];
  game.update(dt);
  check("the same 20-damage hit with no powerup took the full 20", game.health === 80);
}

// --- 15b. Powerup seeding re-randomizes every round -------------------------
// _seedPowerups runs again each time reset() builds a brand-new Arena (i.e.
// every time the player picks a vehicle from the select screen), so which
// buildings hide a powerup -- and which types -- shouldn't be frozen at
// first load. This can't assert the *exact* set differs (it's random, so an
// assertion like that would itself be flaky -- see the ramming section's
// note on avoiding RNG-dependent tests), but it can assert every fresh Arena
// gets its own valid, independent seeding.
console.log("\n=== Powerup seeding re-randomizes each round ===");
{
  const input = makeInput();
  const game = new Game(input);
  game.chooseVehicle("tank");
  const arenaRound1 = game.arena;
  const seededRound1 = arenaRound1.obstacles.filter((o) => o.hasPowerup);

  game.chooseVehicle("tank"); // picking a vehicle again = a whole new round
  const arenaRound2 = game.arena;
  const seededRound2 = arenaRound2.obstacles.filter((o) => o.hasPowerup);

  check("a new round gets a brand-new Arena instance", arenaRound2 !== arenaRound1);
  check("the new round still seeds a handful of powerup buildings", seededRound2.length > 0 && seededRound2.length <= 5);
  check(
    "every re-seeded building has a valid powerup type",
    seededRound2.every((o) => ["overcharge", "bigShot", "laser", "armor"].includes(o.powerupType))
  );
  check(
    "the new round's seeded buildings are fresh objects, not the old round's",
    seededRound2.every((o) => !seededRound1.includes(o))
  );
}

// --- 16. Laser piercing bullets pass through obstacles and turrets --------
console.log("\n=== Laser piercing bullets ===");
{
  const input = makeInput();
  const game = new Game(input);
  game.chooseVehicle("tank");
  const building = game.arena.obstacles.find((o) => o.destructible && !o.destroyed);

  if (!building) {
    check("found a building to test piercing against", false);
  } else {
    const startHealth = building.health;
    const bullet = new Bullet(building.x, building.y, 0, 0, 10, true);
    bullet.piercing = true;
    game.bullets = [bullet];
    game.update(dt);

    console.log("[piercing bullet vs a building]");
    check("the building still took damage", building.health === startHealth - 10);
    check("the piercing bullet survived the hit instead of dying", !bullet.dead);
    check("the bullet is still in play", game.bullets.includes(bullet));

    // Still overlapping the same building next frame -- the hit-once guard
    // should stop it from being damaged again while it hasn't moved past it.
    game.update(dt);
    check("the same building isn't hit twice while still overlapping it", building.health === startHealth - 10);
  }

  console.log("[piercing bullet vs a turret]");
  const turret = game.turrets[0];
  const startTurretHealth = turret.health;
  const laserBullet = new Bullet(turret.x, turret.y, 0, 0, 10, true);
  laserBullet.piercing = true;
  game.bullets = [laserBullet];
  game.update(dt);
  check("the turret took damage", turret.health === startTurretHealth - 10);
  check("the piercing bullet survived hitting the turret too", !laserBullet.dead);
}

// --- 17. Ramming: driving into a building at speed damages it -------------
// A synthetic circle-only obstacle (no facets) is used here instead of a
// real map building -- it isolates the test from the real map's polygon
// collision specifics (already covered by section 7) and gives fully
// deterministic contact geometry to drive the ram-cooldown timing against.
console.log("\n=== Ramming buildings ===");
function makeSyntheticBuilding(x, y, radius = 30, health = 55) {
  return { x, y, radius, facets: [], destructible: true, health, maxHealth: health, destroyed: false, paletteIndex: 0 };
}
{
  const input = makeInput();
  const game = new Game(input);
  game.chooseVehicle("tank");
  const target = makeSyntheticBuilding(400, 0);
  game.arena.obstacles = [target];

  console.log("[tank ramming]");
  // Already in contact, already moving fast toward it (heading 0 == +x, same
  // direction as the building), so the very first update can register a hit.
  game.vehicle.x = target.x - (target.radius + game.vehicle.radius);
  game.vehicle.y = target.y;
  game.vehicle.heading = 0;
  game.vehicle.vx = 200; // well above RAM_SPEED_THRESHOLD
  game.vehicle.vy = 0;

  const startHealth = target.health;
  input.set({ throttle: 1, turn: 0 });
  for (let i = 0; i < 400 && !target.destroyed; i++) game.update(dt);

  check("ramming a building at speed damages it", target.health < startHealth || target.destroyed);
  check("sustained ramming eventually destroys a standard building", target.destroyed === true);
}

console.log("[jeep can ram too, but far weaker than the tank]");
{
  const jeep = new Vehicle(0, 0, 0, "jeep");
  const tank = new Vehicle(0, 0, 0, "tank");
  const heli = new Vehicle(0, 0, 0, "heli");
  check("jeep has some ram damage", jeep.ramDamage > 0);
  check("tank rams much harder than the jeep", tank.ramDamage > jeep.ramDamage);
  check("helicopter has no ram damage (it flies over obstacles, never collides with them)", heli.ramDamage === 0);

  console.log("[only the jeep takes self-damage from a building collision]");
  check("jeep has collisionDamage set (it's fragile, not armored)", jeep.collisionDamage > 0);
  check("tank has no collisionDamage (armored -- ramming costs it nothing)", tank.collisionDamage === 0);
  check("helicopter has no collisionDamage (aerial, never collides with buildings)", heli.collisionDamage === 0);
}

console.log("[jeep ramming a building also damages the jeep itself]");
{
  const input = makeInput();
  const game = new Game(input);
  game.chooseVehicle("jeep");
  const target = makeSyntheticBuilding(400, 0);
  game.arena.obstacles = [target];

  // Same contact setup as the tank-ramming test above: already touching the
  // building, already moving fast toward it.
  game.vehicle.x = target.x - (target.radius + game.vehicle.radius);
  game.vehicle.y = target.y;
  game.vehicle.heading = 0;
  game.vehicle.vx = 200; // well above RAM_SPEED_THRESHOLD
  game.vehicle.vy = 0;

  const startHealth = game.health;
  input.set({ throttle: 1, turn: 0 });
  game.update(dt);
  const events = game.drainEvents();

  check("ramming a building costs the jeep some of its own health", game.health < startHealth);
  check("a vehicleHit event fired for the jeep's self-damage", events.includes("vehicleHit"));
}

console.log("[tank ramming a building takes no self-damage -- it's armored]");
{
  const input = makeInput();
  const game = new Game(input);
  game.chooseVehicle("tank");
  const target = makeSyntheticBuilding(400, 0);
  game.arena.obstacles = [target];

  game.vehicle.x = target.x - (target.radius + game.vehicle.radius);
  game.vehicle.y = target.y;
  game.vehicle.heading = 0;
  game.vehicle.vx = 200;
  game.vehicle.vy = 0;

  const startHealth = game.health;
  input.set({ throttle: 1, turn: 0 });
  game.update(dt);

  check("tank ramming the same way takes no self-damage", game.health === startHealth);
}

console.log("[helicopter never rams -- it's aerial and skips obstacle collision entirely]");
{
  const input = makeInput();
  const game = new Game(input);
  game.chooseVehicle("heli");
  const target = makeSyntheticBuilding(0, 0);
  game.arena.obstacles = [target];
  game.vehicle.x = target.x;
  game.vehicle.y = target.y;
  game.vehicle.vx = 300;
  game.vehicle.vy = 0;
  const startHealth = target.health;
  input.set({ throttle: 1, turn: 0 });
  for (let i = 0; i < 60; i++) game.update(dt);
  check("flying straight through a building's spot never triggers ram damage", target.health === startHealth);
}

console.log("[contact below the ram-speed threshold does no damage]");
{
  const input = makeInput();
  const game = new Game(input);
  game.chooseVehicle("tank");
  const target = makeSyntheticBuilding(0, 0);
  game.arena.obstacles = [target];
  // Resting right at the contact boundary, but not moving.
  game.vehicle.x = target.x - (target.radius + game.vehicle.radius);
  game.vehicle.y = target.y;
  game.vehicle.vx = 0;
  game.vehicle.vy = 0;
  const startHealth = target.health;
  input.set({ throttle: 0, turn: 0 });
  for (let i = 0; i < 30; i++) game.update(dt);
  check("resting against a building below the speed threshold doesn't ram it", target.health === startHealth);
}

// --- 18. Particle/effects system (explosions, sparks, muzzle flashes, dust) -
// Purely visual (see effects.js's header comment) -- these checks work
// directly against ParticleSystem/Camera in isolation, plus a couple of
// integration checks that Game actually spawns particles at the right
// moments. None of this touches gameplay state, so it can't regress any of
// the mechanic checks above.
console.log("\n=== Particle/effects system ===");
{
  const ps = new ParticleSystem();
  console.log("[explosion]");
  ps.explosion(0, 0, "#e8843a", 1);
  check("an explosion spawns multiple particles", ps.particles.length > 5);
  const countAfterSpawn = ps.particles.length;
  for (let i = 0; i < 200; i++) ps.update(1 / 60); // well past every particle's life
  check("particles fully decay and get swept away over time", ps.particles.length === 0);
  check("something was actually spawned to decay from", countAfterSpawn > 0);
}
{
  console.log("[spark / muzzleFlash / dust each spawn something]");
  const ps = new ParticleSystem();
  ps.spark(0, 0);
  check("spark() adds particles", ps.particles.length > 0);
  ps.muzzleFlash(0, 0, 0);
  check("muzzleFlash() adds a particle", ps.particles.length > 1);
  ps.dust(0, 0);
  check("dust() adds a particle", ps.particles.length > 2);
}

console.log("\n=== Camera screen shake ===");
{
  const cam = new Camera(0, 0);
  const before = cam.worldToScreen(0, 0, 800, 600);
  check("with no shake triggered, worldToScreen is exactly centered", before.x === 400 && before.y === 300);

  cam.shake(20, 0.3);
  cam.update(1 / 60, 0, 0); // camera target == current pos, so this isolates the shake offset
  const during = cam.worldToScreen(0, 0, 800, 600);
  console.log("[shake in progress]");
  check("an active shake offsets worldToScreen away from center", during.x !== 400 || during.y !== 300);

  for (let i = 0; i < 60; i++) cam.update(1 / 60, 0, 0); // run well past the 0.3s duration
  const after = cam.worldToScreen(0, 0, 800, 600);
  console.log("[shake decays out]");
  check("shake settles back to exactly centered once its duration elapses", after.x === 400 && after.y === 300);
}

console.log("\n=== Game wires particles/shake into actual events ===");
{
  const input = makeInput();
  const game = new Game(input);
  game.chooseVehicle("tank");

  console.log("[firing the cannon spawns a muzzle flash]");
  game.vehicle.weapon.cooldown = 0;
  input.set({ throttle: 0, turn: 0, fire: true });
  const countBeforeFire = game.particles.particles.length;
  game.update(dt);
  check("firing added at least one particle (the muzzle flash)", game.particles.particles.length > countBeforeFire);
  input.set({ throttle: 0, turn: 0, fire: false });

  console.log("[destroying a building triggers an explosion + camera shake]");
  const target = game.arena.obstacles.find((o) => o.destructible && !o.destroyed);
  check("found a destructible building to test against", !!target);
  if (target) {
    const countBeforeDestroy = game.particles.particles.length;
    target.health = 0;
    game._destroyBuilding(target);
    check("destroying a building adds explosion particles", game.particles.particles.length > countBeforeDestroy);
    check("destroying a building kicks off a camera shake", game.camera.shakeTime > 0);
  }

  console.log("[vehicle destruction triggers a bigger explosion + stronger shake]");
  game.camera.shakeTime = 0;
  game.camera.shakeMag = 0;
  const countBeforeVehicleDeath = game.particles.particles.length;
  game.health = 0;
  game.update(dt);
  check("the vehicle exploding adds particles", game.particles.particles.length > countBeforeVehicleDeath);
  check("the vehicle exploding kicks off a (stronger) camera shake", game.camera.shakeMag >= 12);
}

// --- 19. Duel mode (experimental, milestone 1): mirrored map + AI opponent -
// Covers the pieces added for "could we do a mirrored map with a computer
// opponent racing for my flag" (see DEPLOY_NOTES.md's staged plan): the map
// mirror transform, the shared road-graph pathfinding it and the AI both
// rely on, the AI's own steering controller in isolation, and finally the
// whole thing wired into a real Game instance to prove it actually drives
// toward the target on the real, doubled map -- not just that a route
// theoretically exists. Single-player mode (the default, `duel: false`) is
// also checked here to confirm none of this leaks into it.
console.log("\n=== Duel mode: map mirroring ===");
{
  const mirrored = mirrorMapData(MAP_DATA);
  console.log("[mirrorMapData]");
  check("doubles the world height", mirrored.worldHeight === MAP_DATA.worldHeight * 2);
  check("leaves the world width untouched", mirrored.worldWidth === MAP_DATA.worldWidth);
  check("doubles the building count", mirrored.buildings.length === MAP_DATA.buildings.length * 2);
  check(
    "adds one bridge road on top of the mirrored copy of every original road",
    mirrored.roads.length === MAP_DATA.roads.length * 2 + 1
  );

  // Spot-check the mirror math itself: the first building's every point
  // should reappear, in the same x order, reflected about worldHeight.
  const originalBuilding = MAP_DATA.buildings[0];
  const mirroredCopy = mirrored.buildings[MAP_DATA.buildings.length]; // first building of the mirrored half
  let mirrorMathOk = true;
  for (let i = 0; i < originalBuilding.length; i += 2) {
    const expectedX = originalBuilding[i];
    const expectedY = 2 * MAP_DATA.worldHeight - originalBuilding[i + 1];
    if (mirroredCopy[i] !== expectedX || mirroredCopy[i + 1] !== expectedY) {
      mirrorMathOk = false;
      break;
    }
  }
  check("mirrored building points reflect exactly about worldHeight (x unchanged, y flipped)", mirrorMathOk);

  console.log("[bridge actually connects the two halves]");
  const graph = buildRoadGraph(mirrored.roads);
  // Sample a point near the very top of the original half and one near the
  // very bottom of the mirrored half -- if the bridge works, these should
  // land in the same connected component.
  const topSample = [MAP_DATA.worldWidth / 2, 200];
  const bottomSample = [MAP_DATA.worldWidth / 2, mirrored.worldHeight - 200];
  const route = findRoute(mirrored.roads, topSample[0], topSample[1], bottomSample[0], bottomSample[1]);
  check(
    "a route exists all the way from the top of the mirrored map to the bottom",
    route.length > 2 // more than just the direct-line fallback
  );
  check("!graph is non-empty (roads actually produced a real graph)", graph.adj.size > 0);
}

console.log("\n=== Duel mode: AIDriver steering ===");
{
  // Isolated from the real map/physics scale -- a short synthetic route a
  // vehicle should be able to complete in well under a second of simulated
  // time, so this stays fast and deterministic regardless of map size.
  const driver = new AIDriver();
  const vehicle = new Vehicle(0, 0, 0, "jeep");
  driver.setRoute([
    { x: 0, y: 0 },
    { x: 200, y: 0 },
    { x: 200, y: 200 },
  ]);

  check("never fires (no combat this milestone)", !driver.isFiring() && !driver.isFiring2());

  let ticks = 0;
  while (!driver.reachedEnd && ticks < 60 * 10) {
    driver.update(vehicle, dt);
    vehicle.update(dt, driver.getVector());
    ticks++;
  }
  const finalDist = Math.hypot(vehicle.x - 200, vehicle.y - 200);
  console.log("[following a short synthetic route]");
  check("reached the end of its route", driver.reachedEnd);
  // "Arrived" means within the driver's own arrival radius, not pinpoint --
  // see aiDriver.js's header comment on why a wide radius is deliberate.
  check("ended up close to the final waypoint", finalDist < 100);
}

console.log("\n=== Duel mode: wired into a real Game ===");
{
  console.log("[single-player mode is completely unaffected (duel defaults off)]");
  const soloInput = makeInput();
  const soloGame = new Game(soloInput);
  soloGame.chooseVehicle("jeep");
  check("no AI vehicle in single-player mode", soloGame.aiVehicle === null);
  check("no player-side duel flag in single-player mode", soloGame.playerFlag === null);
  check("arena is the normal, un-mirrored height", soloGame.arena.height === MAP_DATA.worldHeight);

  console.log("[duel mode sets up a mirrored arena, AI vehicle, and second flag]");
  const input = makeInput();
  const game = new Game(input, { duel: true });
  game.chooseVehicle("jeep");

  check("arena height is doubled for duel mode", game.arena.height === MAP_DATA.worldHeight * 2);
  check("an AI vehicle was spawned", !!game.aiVehicle);
  check("the AI drives a jeep", game.aiVehicle.type === "jeep");
  check("the AI spawned at the mirrored (far) base", Math.abs(game.aiVehicle.y - game.arena.enemyBase.y) < 100);
  check("the player's own flag was placed at their base", !!game.playerFlag);
  check(
    "the player's flag sits at playerBase",
    game.playerFlag.x === game.arena.playerBase.x && game.playerFlag.y === game.arena.playerBase.y
  );

  console.log("[AI actually drives toward the player's flag over time]");
  const startDist = Math.hypot(game.aiVehicle.x - game.playerFlag.x, game.aiVehicle.y - game.playerFlag.y);
  for (let i = 0; i < 60 * 90; i++) game.update(dt); // 90 sim-seconds -- a generous budget for the long mirrored route
  const endDist = Math.hypot(game.aiVehicle.x - game.playerFlag.x, game.aiVehicle.y - game.playerFlag.y);
  check("the AI made real progress toward the player's flag", endDist < startDist * 0.6);
  check("the AI vehicle actually moved from its spawn point", endDist !== startDist);
}

console.log(allPass ? "\nALL PASS" : "\nSOME CHECKS FAILED");
if (!allPass) process.exit(1);
