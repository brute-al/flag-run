import { Vehicle, VEHICLE_TYPES } from "./vehicle.js";
import { Camera } from "./camera.js";
import { Arena } from "./arena.js";
import { Flag, Turret, Bullet, Powerup, POWERUP_INFO } from "./entities.js";
import { drawVehicle } from "./vehicleArt.js";
import { MAP_DATA } from "./mapData.js";
import { ParticleSystem } from "./effects.js";
import { mirrorMapData } from "./mirrorMap.js";
import { findRoute } from "./pathfinding.js";
import { AIDriver } from "./aiDriver.js";

const RESPAWN_DELAY = 1.6;

// How long a picked-up powerup buff lasts, in seconds.
const POWERUP_DURATION = 15;

// Ramming a destructible building only counts as an "impact" (not just
// resting against it) above this speed, and impacts are throttled by a
// cooldown so continuous contact doesn't melt a building in a single frame
// -- it should feel like repeated bangs, not an instant kill.
const RAM_SPEED_THRESHOLD = 50;
const RAM_COOLDOWN = 0.4;
const RAM_CONTACT_SLACK = 6;

// Gameplay effect of each powerup type, applied to every shot fired while
// it's active (see _weaponModifiers below). Visual identity (label/color)
// lives in entities.js's POWERUP_INFO instead, since that's shared with the
// world-space pickup icon.
const POWERUP_STATS = {
  overcharge: { damageMult: 2, radiusMult: 1, piercing: false, damageTakenMult: 1 },
  bigShot: { damageMult: 1.6, radiusMult: 2.2, piercing: false, damageTakenMult: 1 },
  laser: { damageMult: 1.15, radiusMult: 1.3, piercing: true, damageTakenMult: 1 },
  // The odd one out: doesn't touch outgoing damage at all, just halves
  // incoming damage (applied at the "vehicleHit" bullet-damage line below) --
  // "2x armor" in the sense that the vehicle can now soak twice the hits.
  armor: { damageMult: 1, radiusMult: 1, piercing: false, damageTakenMult: 0.5 },
};

export class Game {
  // `useRealMap` defaults on: the shipped game plays out on the imported
  // neighborhood layout (see mapData.js). Pass `{ useRealMap: false }` to get
  // the original procedural rock-field arena instead (used by some tests,
  // and a reasonable fallback if no map data is available).
  // `duel`: experimental opponent mode (see DEPLOY_NOTES.md), staged across
  // milestones. Mirrors the map to twice its height (mirrorMap.js) and spawns
  // a second, AI-driven vehicle at the mirrored base that autonomously paths
  // toward the player's own flag along the real road network (milestone 1).
  // Milestone 2 arms it: the AI drives a tank, fires its cannon at the player
  // when in range, and can itself be damaged/destroyed and respawn -- see
  // _setupDuel/_spawnAI and the AI weapon block in update(). Still not here:
  // the AI can't pick up the player's flag, and there's no win/loss condition
  // tied to any of this yet.
  constructor(input, { useRealMap = true, duel = false } = {}) {
    this.input = input;
    this.useRealMap = useRealMap;
    this.duel = duel;
    this.vehicleType = "jeep";
    this.events = [];
    this.paused = false; // true while the mid-round vehicle-swap overlay is open
    this.reset();
    this.state = "select"; // show the vehicle picker before the first run
  }

  // Called by the UI when the player picks a vehicle on the select screen
  // (and again any time they want to start a whole new round).
  chooseVehicle(type) {
    this.vehicleType = type;
    this.reset();
  }

  // Swap the active vehicle mid-round without touching the arena, flag,
  // turrets, or lives pool — only allowed while parked inside your own base.
  // This is how you clear turrets in a heavy vehicle, then hop in the jeep
  // for the actual pickup.
  switchVehicle(type) {
    if (this.state !== "playing") return false;
    if (!this.isAtOwnBase()) return false;
    if (this.lives[type] <= 0) return false;

    this.vehicleType = type;
    this.vehicle = this._spawnVehicleAtBase(type);
    this.health = this.vehicle.maxHealth;
    return true;
  }

  isAtOwnBase() {
    const d = Math.hypot(this.vehicle.x - this.arena.playerBase.x, this.vehicle.y - this.arena.playerBase.y);
    return d < this.arena.playerBase.radius;
  }

  _spawnVehicleAtBase(type) {
    // Spawn just south of the player base's center, facing further south
    // (positive-y / into the arena) so the vehicle drives toward the action.
    return new Vehicle(this.arena.playerBase.x, this.arena.playerBase.y + 40, Math.PI / 2, type);
  }

  reset() {
    // Duel mode plays out on a mirrored, double-height copy of the same map
    // data (see mirrorMap.js) so the AI's half is a fair mirror image of the
    // player's -- same building density, same road network. Arena itself
    // doesn't need to know the difference: it always places playerBase near
    // the top and enemyBase the same fixed distance from the bottom, so
    // handing it the doubled dataset is all that's needed.
    const rawMapData = this.useRealMap ? MAP_DATA : null;
    const mapData = this.duel && rawMapData ? mirrorMapData(rawMapData) : rawMapData;
    this.arena = new Arena(mapData);
    this.vehicle = this._spawnVehicleAtBase(this.vehicleType);
    this.camera = new Camera(this.vehicle.x, this.vehicle.y);
    this.flag = new Flag(this.arena.enemyBase.x, this.arena.enemyBase.y);
    this.turrets = this._placeTurrets();
    this.bullets = [];
    this.powerupPickups = []; // floating pickups spawned when a seeded building falls
    this.activePowerup = null; // { type, timeLeft } while a buff is running
    this.health = this.vehicle.maxHealth;
    this.ramCooldown = 0; // see RAM_COOLDOWN in update()
    // Purely visual: explosions, sparks, muzzle flashes, dust. See effects.js
    // -- nothing here is read by game logic, only by draw().
    this.particles = new ParticleSystem();
    this._dustCooldown = 0; // throttles dust puffs while driving fast, see update()
    // Lives are per-vehicle-type and last the whole round (they persist
    // across mid-round vehicle switches and respawns). Only the jeep has a
    // finite pool — running out of jeeps ends the round.
    this.lives = Object.fromEntries(Object.keys(VEHICLE_TYPES).map((k) => [k, VEHICLE_TYPES[k].lives]));
    this.state = "playing"; // "select" | "playing" | "won" | "lost" | "respawning"
    this.respawnTimer = 0;
    this.message = "";

    if (this.duel) {
      this._setupDuel();
    } else {
      this.aiVehicle = null;
      this.playerFlag = null;
      this.aiDriver = null;
      this.aiHealth = 0;
      this.aiRespawnTimer = 0;
    }

    this.events.push("roundReset");
  }

  // Sets up the experimental AI opponent for a whole new round: the player's
  // own flag (its target, sitting undefended at playerBase for now -- not
  // pickup-able by the AI yet, see the class-level comment above) and its own
  // AIDriver instance, then defers the vehicle/route setup to _spawnAI() so
  // the exact same logic can be reused for mid-round respawns.
  _setupDuel() {
    this.playerFlag = new Flag(this.arena.playerBase.x, this.arena.playerBase.y);
    this.aiDriver = new AIDriver();
    this.aiRespawnTimer = 0;
    this._spawnAI();
  }

  // (Re)spawns the AI opponent at its base with full health and a fresh
  // route toward the player's flag -- used both at round start (_setupDuel)
  // and after the AI's vehicle is destroyed (see the death handling in
  // update()). Milestone 2: the AI now drives an armed tank instead of
  // milestone 1's unarmed jeep, so it can actually fight back while pathing
  // toward the flag (see aiDriver.js's _computeCombat).
  _spawnAI() {
    const base = this.arena.enemyBase; // the far/mirrored base is the AI's home
    // Face north (into the arena, toward the player) -- the mirror image of
    // _spawnVehicleAtBase's "spawn south of playerBase, facing south" setup.
    this.aiVehicle = new Vehicle(base.x, base.y - 40, -Math.PI / 2, "tank");
    this.aiHealth = this.aiVehicle.maxHealth;
    const route = findRoute(this.arena.roads, this.aiVehicle.x, this.aiVehicle.y, this.playerFlag.x, this.playerFlag.y);
    this.aiDriver.setRoute(route);
  }

  // Spreads turrets along the whole route from your base to theirs (instead
  // of clustering all of them at the enemy base), so getting the flag means
  // fighting through defended territory the entire way, not just a single
  // choke point at the end. Positions are picked as fractions of the
  // player-base-to-enemy-base distance, offset left/right of the centerline,
  // then nudged to a nearby clear spot so a turret doesn't spawn embedded in
  // a building. One turret per fractional band (4 of the 8 total) is marked
  // "tall" -- an elevated sniper tower whose shots skip building collision
  // (see the bullet loop below), so it can still reach the player even from
  // behind cover, spread out so the whole route stays dangerous.
  _placeTurrets() {
    const w = this.arena.width;
    const startY = this.arena.playerBase.y + this.arena.playerBase.radius + 150;
    const endY = this.arena.enemyBase.y - this.arena.enemyBase.radius - 60;
    const routeLength = endY - startY;

    const layout = [
      { frac: 0.28, offset: -260, tall: true },
      { frac: 0.28, offset: 260 },
      { frac: 0.46, offset: 200, tall: true },
      { frac: 0.46, offset: -220 },
      { frac: 0.64, offset: -260 },
      { frac: 0.64, offset: 240, tall: true },
      { frac: 0.85, offset: -90 },
      { frac: 0.85, offset: 100, tall: true },
    ];

    const turrets = [];
    for (const spot of layout) {
      const targetX = w / 2 + spot.offset;
      const targetY = startY + routeLength * spot.frac;
      const pos = this._findClearTurretSpot(targetX, targetY, turrets);
      turrets.push(new Turret(pos.x, pos.y, { tall: !!spot.tall }));
    }
    return turrets;
  }

  // Searches outward in expanding rings from a desired spot for a position
  // clear of buildings, both bases, and other turrets. Falls back to the
  // original desired spot if nothing clearer turns up nearby (better to have
  // a turret slightly overlapping a wall than to silently drop it).
  _findClearTurretSpot(targetX, targetY, existingTurrets) {
    const buildingClearance = 55;
    const turretSeparation = 140;

    for (let ring = 0; ring < 10; ring++) {
      const searchRadius = ring * 40;
      const attempts = ring === 0 ? 1 : 8;
      for (let a = 0; a < attempts; a++) {
        const angle = (a / attempts) * Math.PI * 2;
        const x = targetX + Math.cos(angle) * searchRadius;
        const y = targetY + Math.sin(angle) * searchRadius;
        if (x < 60 || x > this.arena.width - 60 || y < 60 || y > this.arena.height - 60) continue;

        const clearOfBuildings = this.arena.obstacles.every(
          (o) => !o.destroyed && Math.hypot(x - o.x, y - o.y) > o.radius + buildingClearance
        );
        const clearOfBases =
          Math.hypot(x - this.arena.playerBase.x, y - this.arena.playerBase.y) > this.arena.playerBase.radius + 60 &&
          Math.hypot(x - this.arena.enemyBase.x, y - this.arena.enemyBase.y) > this.arena.enemyBase.radius + 60;
        const clearOfOtherTurrets = existingTurrets.every((t) => Math.hypot(x - t.x, y - t.y) > turretSeparation);

        if (clearOfBuildings && clearOfBases && clearOfOtherTurrets) {
          return { x, y };
        }
      }
    }
    return { x: targetX, y: targetY };
  }

  // Marks a building destroyed and, if it was one of the handful secretly
  // seeded with a powerup (see Arena._seedPowerups), drops the pickup it was
  // hiding -- exactly once, even if it somehow takes more damage after death.
  _destroyBuilding(o) {
    o.destroyed = true;
    this.events.push("buildingDestroyed");
    // Centralized here so it fires the same way regardless of whether the
    // building was shot down or rammed down.
    this.particles.explosion(o.x, o.y, "#8a7a5a", 1.1);
    this.camera.shake(6, 0.25);
    if (o.hasPowerup && !o.powerupSpawned) {
      o.powerupSpawned = true;
      this.powerupPickups.push(new Powerup(o.x, o.y, o.powerupType));
    }
  }

  // Applies a bullet's damage to the duel-mode AI opponent and handles its
  // death (fiery explosion, camera shake, respawn timer) -- shared by the
  // friendly-fire-vs-aiVehicle check (your own gun) and the territorial
  // turret-vs-aiVehicle check (your side's turrets defending against it) in
  // update()'s bullet loop, so "what happens when the AI takes a hit" lives
  // in one place instead of being duplicated between the two. Caller is
  // responsible for the distance check and for marking the bullet dead (or
  // adding it to hitTargets if piercing) -- this only handles the damage
  // and death consequences once a hit is already confirmed.
  _damageAI(bullet, sparkColor) {
    this.aiHealth -= bullet.damage;
    this.events.push("vehicleHit");
    this.particles.spark(this.aiVehicle.x, this.aiVehicle.y, sparkColor);
    if (this.aiHealth <= 0) {
      this.aiHealth = 0;
      this.events.push("vehicleDestroyed");
      this.particles.fieryExplosion(this.aiVehicle.x, this.aiVehicle.y, 1.6);
      this.camera.shake(10, 0.35);
      this.aiRespawnTimer = RESPAWN_DELAY;
    }
  }

  // Looks up the current shot modifiers from whatever powerup (if any) is
  // active. Neutral defaults mean every call site can multiply/OR unconditionally
  // without a separate "is a powerup active" branch.
  _weaponModifiers() {
    const stats = this.activePowerup && POWERUP_STATS[this.activePowerup.type];
    if (!stats) return { damageMult: 1, radiusMult: 1, piercing: false, damageTakenMult: 1 };
    return stats;
  }

  // Returns queued sound-trigger events since the last call and clears them.
  // Kept as plain strings so audio.js doesn't need to know about game internals.
  drainEvents() {
    const events = this.events;
    this.events = [];
    return events;
  }

  update(dt) {
    if (this.paused) return;

    // Ticks independently of state so an explosion mid-respawn (or right as
    // the round ends) keeps animating instead of freezing on the last frame.
    this.particles.update(dt);

    if (this.state === "select" || this.state === "won" || this.state === "lost") {
      return;
    }

    if (this.state === "respawning") {
      this.respawnTimer -= dt;
      if (this.respawnTimer <= 0) {
        this.vehicle = this._spawnVehicleAtBase(this.vehicleType);
        this.health = this.vehicle.maxHealth;
        this.state = "playing";
        this.message = "";
      }
      return;
    }

    const rawInput = this.input.getVector();
    this.vehicle.update(dt, rawInput);
    this.arena.clampToBounds(this.vehicle);
    // Aerial vehicles (helicopter) fly over ground obstacles.
    if (!this.vehicle.isAerial) {
      this.arena.resolveObstacleCollisions(this.vehicle);
    }

    // Ramming: a grounded vehicle moving at speed and in contact with a
    // destructible building chips away at it, on a cooldown so sustained
    // contact reads as repeated impacts rather than an instant kill. The
    // tank's high ramDamage means it can flat-out bulldoze a weak building;
    // the jeep's is low enough that it's a poor substitute for the tank's
    // cannon. Aerial vehicles never collide with obstacles, so they're
    // naturally excluded.
    if (this.ramCooldown > 0) this.ramCooldown -= dt;
    if (!this.vehicle.isAerial && this.vehicle.ramDamage > 0 && this.vehicle.speed > RAM_SPEED_THRESHOLD && this.ramCooldown <= 0) {
      for (const o of this.arena.obstacles) {
        if (o.destroyed || !o.destructible) continue;
        const d = Math.hypot(this.vehicle.x - o.x, this.vehicle.y - o.y);
        if (d < o.radius + this.vehicle.radius + RAM_CONTACT_SLACK) {
          o.health -= this.vehicle.ramDamage;
          this.events.push("buildingHit");
          this.particles.spark(this.vehicle.x, this.vehicle.y, "#d8c9a0");
          // The jeep isn't armored like the tank -- ramming a building dings
          // its own health too (see Vehicle.collisionDamage), so plowing
          // through the neighborhood is a real risk for it, not a free move.
          if (this.vehicle.collisionDamage > 0) {
            this.health -= this.vehicle.collisionDamage;
            this.events.push("vehicleHit");
          }
          this.ramCooldown = RAM_COOLDOWN;
          if (o.health <= 0) this._destroyBuilding(o);
          break;
        }
      }
    }

    // Dust kicks up behind a fast-moving grounded vehicle -- the heli is
    // aerial and skips this, it's not kicking up gravel from the road.
    if (!this.vehicle.isAerial) {
      this._dustCooldown -= dt;
      if (this.vehicle.speed > 120 && this._dustCooldown <= 0) {
        this._dustCooldown = 0.05;
        const backX = this.vehicle.x - Math.cos(this.vehicle.heading) * this.vehicle.radius;
        const backY = this.vehicle.y - Math.sin(this.vehicle.heading) * this.vehicle.radius;
        this.particles.dust(backX, backY);
      }
    }

    // Experimental duel-mode AI opponent: drives itself along the route
    // computed once at round start (see _setupDuel) using the same physics
    // and obstacle collision as the player, and (once its respawn timer has
    // cleared) fights back -- see aiDriver.js's _computeCombat. While
    // aiRespawnTimer is counting down the AI is destroyed and simply absent
    // (no update, no draw -- see draw() below) until it ticks over and
    // _spawnAI() rebuilds it fresh at its base, mirroring the player's own
    // "respawning" state.
    if (this.duel && this.aiVehicle) {
      if (this.aiRespawnTimer > 0) {
        this.aiRespawnTimer -= dt;
        if (this.aiRespawnTimer <= 0) {
          this._spawnAI();
        }
      } else {
        this.aiDriver.update(this.aiVehicle, dt, this.vehicle);
        this.aiVehicle.update(dt, this.aiDriver.getVector());
        this.arena.clampToBounds(this.aiVehicle);
        if (!this.aiVehicle.isAerial) {
          this.arena.resolveObstacleCollisions(this.aiVehicle);
        }

        // AI opponent's weapon (milestone 2): fires along its independently-
        // aimed turret exactly like the player's own tank cannon below --
        // see aiDriver.js's _computeCombat for the aim/engagement-range/fire
        // decision. Marked non-friendly (not the player's own powerup
        // modifiers) so it damages the player vehicle via the same bullet-
        // vs-player-vehicle collision handling turret fire already uses
        // further down, not the friendly-bullet-vs-turret path.
        if (this.aiVehicle.weapon) {
          this.aiVehicle.weapon.cooldown -= dt;
          if (this.aiDriver.isFiring() && this.aiVehicle.weapon.cooldown <= 0) {
            this.aiVehicle.weapon.cooldown = this.aiVehicle.weapon.fireInterval;
            const aimAngle = this.aiVehicle.hasTurret ? this.aiVehicle.turretAngle : this.aiVehicle.heading;
            const spread = (Math.random() - 0.5) * 2 * this.aiVehicle.weapon.spread;
            const noseX = this.aiVehicle.x + Math.cos(aimAngle) * (this.aiVehicle.radius + 6);
            const noseY = this.aiVehicle.y + Math.sin(aimAngle) * (this.aiVehicle.radius + 6);
            const bullet = new Bullet(
              noseX,
              noseY,
              aimAngle + spread,
              this.aiVehicle.weapon.bulletSpeed,
              this.aiVehicle.weapon.damage,
              false,
              false,
              4
            );
            this.bullets.push(bullet);
            this.particles.muzzleFlash(noseX, noseY, aimAngle, "#ffb37a");
            this.events.push("aiFireCannon");
          }
        }
      }
    }

    this.camera.update(dt, this.vehicle.x, this.vehicle.y);

    // Player weapon (tank cannon / heli chaingun). Jeep has no weapon.
    // The tank's cannon fires along its independently-aimed turret, not
    // its hull heading -- everything else without a turret (the heli's
    // forward-facing chaingun) still fires straight along heading.
    if (this.vehicle.weapon) {
      this.vehicle.weapon.cooldown -= dt;
      if (this.input.isFiring() && this.vehicle.weapon.cooldown <= 0) {
        this.vehicle.weapon.cooldown = this.vehicle.weapon.fireInterval;
        const aimAngle = this.vehicle.hasTurret ? this.vehicle.turretAngle : this.vehicle.heading;
        const spread = (Math.random() - 0.5) * 2 * this.vehicle.weapon.spread;
        const noseX = this.vehicle.x + Math.cos(aimAngle) * (this.vehicle.radius + 6);
        const noseY = this.vehicle.y + Math.sin(aimAngle) * (this.vehicle.radius + 6);
        // A powerup pickup (see below) can juice this shot: OVERCHARGE doubles
        // damage, BIG SHOT fattens the round and hits harder, LASER pierces
        // through whatever it hits instead of stopping on the first thing.
        // (ARMOR doesn't touch outgoing shots at all -- see the vehicleHit
        // damage line further down for its effect.)
        const mod = this._weaponModifiers();
        const bullet = new Bullet(
          noseX,
          noseY,
          aimAngle + spread,
          this.vehicle.weapon.bulletSpeed,
          this.vehicle.weapon.damage * mod.damageMult,
          true,
          false,
          4 * mod.radiusMult
        );
        bullet.piercing = mod.piercing;
        this.bullets.push(bullet);
        this.particles.muzzleFlash(noseX, noseY, aimAngle, this.vehicle.weapon.label === "cannon" ? "#ffdca3" : "#fff3c4");
        this.events.push(this.vehicle.weapon.label === "cannon" ? "playerFireCannon" : "playerFireMg");
      }
    }

    // Secondary weapon (heli-only missile). `tall: true` on the bullet
    // means it skips building collision entirely -- unlike the chaingun's
    // regular rounds, which stop on whatever's closest, this one arcs over
    // rooftops so it can actually reach a tall turret hiding behind cover.
    if (this.vehicle.weapon2) {
      this.vehicle.weapon2.cooldown -= dt;
      if (this.input.isFiring2() && this.vehicle.weapon2.cooldown <= 0) {
        this.vehicle.weapon2.cooldown = this.vehicle.weapon2.fireInterval;
        const spread = (Math.random() - 0.5) * 2 * this.vehicle.weapon2.spread;
        const noseX = this.vehicle.x + Math.cos(this.vehicle.heading) * (this.vehicle.radius + 6);
        const noseY = this.vehicle.y + Math.sin(this.vehicle.heading) * (this.vehicle.radius + 6);
        const mod = this._weaponModifiers();
        const missile = new Bullet(
          noseX,
          noseY,
          this.vehicle.heading + spread,
          this.vehicle.weapon2.bulletSpeed,
          this.vehicle.weapon2.damage * mod.damageMult,
          true,
          true,
          this.vehicle.weapon2.radius * mod.radiusMult
        );
        missile.piercing = mod.piercing;
        this.bullets.push(missile);
        this.particles.muzzleFlash(noseX, noseY, this.vehicle.heading, "#ffcf8a");
        this.events.push("playerFireMissile");
      }
    }

    // Flag pickup / carry / capture — only the jeep can carry it.
    this.flag.update();
    if (!this.flag.carrier && this.vehicle.canCarryFlag) {
      const d = Math.hypot(this.vehicle.x - this.flag.x, this.vehicle.y - this.flag.y);
      if (d < this.vehicle.radius + this.flag.radius + 6) {
        this.flag.carrier = this.vehicle;
        this.vehicle.carrying = this.flag;
        this.flag.capturedByPlayer = true;
        this.events.push("flagPickup");
      }
    } else if (this.flag.carrier === this.vehicle) {
      const dHome = Math.hypot(this.vehicle.x - this.arena.playerBase.x, this.vehicle.y - this.arena.playerBase.y);
      if (dHome < this.arena.playerBase.radius) {
        this.state = "won";
        this.message = "MISSION COMPLETE — press R to pick a vehicle and run it again";
        this.events.push("flagCapture");
      }
    }

    // Powerup pickups: bob in place, get scooped up on contact (by any
    // vehicle -- an unarmed jeep just can't put it to use until it swaps
    // into the tank or heli), and the active buff counts down to nothing.
    // Picking up a new one while one is already running simply replaces it.
    for (const pickup of this.powerupPickups) pickup.update(dt);
    this.powerupPickups = this.powerupPickups.filter((pickup) => {
      const d = Math.hypot(this.vehicle.x - pickup.x, this.vehicle.y - pickup.y);
      if (d < this.vehicle.radius + pickup.radius) {
        this.activePowerup = { type: pickup.type, timeLeft: POWERUP_DURATION };
        this.events.push("powerupPickup");
        return false;
      }
      return true;
    });
    if (this.activePowerup) {
      this.activePowerup.timeLeft -= dt;
      if (this.activePowerup.timeLeft <= 0) {
        this.activePowerup = null;
        this.events.push("powerupExpired");
      }
    }

    // Turrets track and fire. In duel mode they're territorial: a turret
    // sitting north of the mirrored map's exact halfway line (arena.height /
    // 2 -- the same line mirrorMap.js reflected everything about) is on your
    // side, so it defends it by targeting the AI opponent; a turret south of
    // that line is on the AI's side and defends it by targeting you. Outside
    // duel mode there's no AI vehicle to speak of, so every turret just
    // targets the player, exactly like before.
    for (const turret of this.turrets) {
      let targetX = this.vehicle.x;
      let targetY = this.vehicle.y;
      let targetsPlayer = true;
      if (this.duel && turret.y < this.arena.height / 2) {
        // On your side of the line -- nothing to defend against while the
        // AI is destroyed/respawning, so just sit idle rather than aim at
        // its old, now-meaningless last position.
        if (!this.aiVehicle || this.aiRespawnTimer > 0) continue;
        targetX = this.aiVehicle.x;
        targetY = this.aiVehicle.y;
        targetsPlayer = false;
      }
      const fired = turret.update(dt, targetX, targetY, this.bullets, targetsPlayer);
      if (fired) {
        this.events.push("turretFire");
        this.particles.muzzleFlash(turret.x, turret.y, turret.aimAngle, "#ffb37a");
      }
    }

    // Bullets move; rocks provide cover for everyone; friendly bullets hit
    // turrets, turret bullets hit the player vehicle.
    for (const bullet of this.bullets) {
      bullet.update(dt);
      if (bullet.dead) continue;

      // Tall-turret rounds fly in above rooftop height, so they skip
      // building collision entirely instead of slamming into whatever's
      // directly between the tower and its target -- that's what makes an
      // elevated turret a threat to a target using a building as cover.
      if (!bullet.tall) {
        for (const o of this.arena.obstacles) {
          if (o.destroyed) continue;
          // A piercing (LASER) round keeps going after this building instead
          // of stopping here -- `hitTargets` just stops it from re-hitting
          // the same one every frame while it's still overlapping it.
          if (bullet.piercing && bullet.hitTargets.has(o)) continue;
          if (Math.hypot(bullet.x - o.x, bullet.y - o.y) < o.radius + bullet.radius) {
            this.particles.spark(bullet.x, bullet.y, bullet.friendly ? "#8fe3ff" : "#ffb37a");
            if (bullet.piercing) {
              bullet.hitTargets.add(o);
            } else {
              bullet.dead = true;
            }
            // Any fire -- yours or a turret's -- chips away at destructible
            // buildings. That cuts both ways: a tank/heli can blow a path
            // through cover, but sustained turret fire will just as happily
            // grind down whatever building you're hiding behind, so cover is
            // a temporary resource, not a permanent safe spot. Procedural
            // rocks are never damaged either way.
            if (o.destructible) {
              o.health -= bullet.damage;
              this.events.push("buildingHit");
              if (o.health <= 0) {
                this._destroyBuilding(o);
              }
            }
            if (!bullet.piercing) break;
          }
        }
        if (bullet.dead) continue;
      }

      if (bullet.friendly) {
        for (const turret of this.turrets) {
          if (turret.destroyed) continue;
          if (bullet.piercing && bullet.hitTargets.has(turret)) continue;
          if (Math.hypot(bullet.x - turret.x, bullet.y - turret.y) < bullet.radius + turret.radius) {
            if (bullet.piercing) {
              bullet.hitTargets.add(turret);
            } else {
              bullet.dead = true;
            }
            turret.takeDamage(bullet.damage);
            this.events.push("turretHit");
            this.particles.spark(bullet.x, bullet.y, "#8fe3ff");
            if (turret.destroyed) {
              this.events.push("turretDestroyed");
              // A turret is a real fuel/ammo detonation, not crumbling
              // masonry, so it gets the fireball treatment (flames + a
              // black smoke column) rather than the plain rubble explosion.
              this.particles.fieryExplosion(turret.x, turret.y, 1.3);
              this.camera.shake(8, 0.3);
            }
            if (!bullet.piercing) break;
          }
        }

        // Milestone 2: friendly (player) fire can also hit the duel-mode AI
        // opponent, exactly like it hits a turret above -- same distance
        // check, same piercing/hitTargets bookkeeping, just against
        // aiVehicle instead. `!bullet.dead` guards against a non-piercing
        // round that already spent itself on a turret this same frame.
        if (this.duel && this.aiVehicle && this.aiRespawnTimer <= 0 && !bullet.dead) {
          if (!bullet.piercing || !bullet.hitTargets.has(this.aiVehicle)) {
            const dAi = Math.hypot(bullet.x - this.aiVehicle.x, bullet.y - this.aiVehicle.y);
            if (dAi < bullet.radius + this.aiVehicle.radius) {
              if (bullet.piercing) {
                bullet.hitTargets.add(this.aiVehicle);
              } else {
                bullet.dead = true;
              }
              this._damageAI(bullet, "#8fe3ff");
            }
          }
        }
      } else if (bullet.targetsPlayer === false) {
        // Territorial duel-mode turret fire aimed at the AI opponent (see
        // the turret-targeting block above), not you -- same hit/death
        // handling as the friendly-fire-vs-aiVehicle block above, just
        // triggered by one of your own side's turrets instead of your gun.
        if (this.duel && this.aiVehicle && this.aiRespawnTimer <= 0) {
          const dAiTurret = Math.hypot(bullet.x - this.aiVehicle.x, bullet.y - this.aiVehicle.y);
          if (dAiTurret < bullet.radius + this.aiVehicle.radius) {
            bullet.dead = true;
            this._damageAI(bullet, "#ffb37a");
          }
        }
      } else {
        const d = Math.hypot(bullet.x - this.vehicle.x, bullet.y - this.vehicle.y);
        if (d < bullet.radius + this.vehicle.radius) {
          bullet.dead = true;
          // ARMOR halves this via damageTakenMult; every other powerup (and
          // no powerup at all) leaves it at a neutral 1.
          this.health -= bullet.damage * this._weaponModifiers().damageTakenMult;
          this.events.push("vehicleHit");
          this.particles.spark(this.vehicle.x, this.vehicle.y, "#ff6b4a");
        }
      }
    }
    this.bullets = this.bullets.filter((b) => !b.dead);

    if (this.health <= 0 && this.state === "playing") {
      this.events.push("vehicleDestroyed");
      // Losing your vehicle is the biggest hit in the game -- give it the
      // full fireball (flames cooling to black smoke) instead of the plain
      // rubble explosion buildings get.
      this.particles.fieryExplosion(this.vehicle.x, this.vehicle.y, 1.6);
      this.camera.shake(12, 0.4);
      if (this.vehicle.carrying) {
        this.flag.dropAt(this.vehicle.x, this.vehicle.y);
        this.vehicle.carrying = null;
        // The jeep going down mid-carry ends the "hauling the flag" tension,
        // separate from the pickup/capture chimes.
        this.events.push("flagDropped");
      }
      this.health = 0;

      const type = this.vehicle.type;
      if (Number.isFinite(this.lives[type])) this.lives[type] -= 1;

      // Every vehicle type now has its own finite life pool (2 tanks, 2
      // helis, 3 jeeps by default -- see VEHICLE_TYPES). The round is only
      // lost once the whole garage is empty, not the moment any single type
      // runs dry: if this type is out but another still has a life left,
      // auto-switch into it for the next respawn instead of ending the round.
      const anyLivesLeft = Object.values(this.lives).some((n) => n > 0);
      if (!anyLivesLeft) {
        this.state = "lost";
        this.message = "OUT OF VEHICLES — ROUND LOST — press R to try again";
      } else {
        this.state = "respawning";
        this.respawnTimer = RESPAWN_DELAY;
        if (this.lives[type] <= 0) {
          const nextType = Object.keys(this.lives).find((t) => this.lives[t] > 0);
          this.vehicleType = nextType;
          const outLabel = VEHICLE_TYPES[type].label.toUpperCase();
          const nextLabel = VEHICLE_TYPES[nextType].label.toUpperCase();
          this.message = `OUT OF ${outLabel}S — respawning as ${nextLabel}...`;
        } else {
          this.message = "VEHICLE DESTROYED — respawning...";
        }
      }
    }
  }

  draw(ctx, canvasW, canvasH) {
    if (this.state === "select") return; // HTML overlay covers the canvas
    this.arena.draw(ctx, this.camera, canvasW, canvasH);
    this.flag.draw(ctx, this.camera, canvasW, canvasH);
    // Duel mode's second flag (the player's own, at their base -- the AI's
    // target). Undefended and un-pickupable for now, see aiDriver.js.
    if (this.duel && this.playerFlag) this.playerFlag.draw(ctx, this.camera, canvasW, canvasH);
    for (const pickup of this.powerupPickups) pickup.draw(ctx, this.camera, canvasW, canvasH);
    for (const turret of this.turrets) turret.draw(ctx, this.camera, canvasW, canvasH);
    for (const bullet of this.bullets) bullet.draw(ctx, this.camera, canvasW, canvasH);
    if (this.state !== "respawning") {
      const s = this.camera.worldToScreen(this.vehicle.x, this.vehicle.y, canvasW, canvasH);
      const healthFrac = Math.max(0, Math.min(1, this.health / this.vehicle.maxHealth));
      drawVehicle(ctx, s.x, s.y, this.vehicle, healthFrac);
    }
    if (this.duel && this.aiVehicle && this.aiRespawnTimer <= 0) {
      const s = this.camera.worldToScreen(this.aiVehicle.x, this.aiVehicle.y, canvasW, canvasH);
      const aiHealthFrac = Math.max(0, Math.min(1, this.aiHealth / this.aiVehicle.maxHealth));
      drawVehicle(ctx, s.x, s.y, this.aiVehicle, aiHealthFrac);
    }
    // Drawn last (and regardless of state) so an explosion/dust cloud from
    // the moment before a respawn keeps rendering on top of everything else.
    this.particles.draw(ctx, this.camera, canvasW, canvasH);
  }

  getHudState() {
    const lives = this.lives
      ? { ...this.lives }
      : Object.fromEntries(Object.keys(VEHICLE_TYPES).map((k) => [k, VEHICLE_TYPES[k].lives]));
    return {
      healthPct: this.state === "select" ? 1 : Math.max(0, this.health / this.vehicle.maxHealth),
      flagStatus: this.flag.carrier
        ? "FLAG: in your hands — get it home!"
        : this.flag.capturedByPlayer
        ? "FLAG: dropped in the field"
        : "FLAG: at enemy base",
      message: this.message,
      state: this.state,
      lives,
      weaponLabel: this.vehicle && this.vehicle.weapon ? this.vehicle.weapon.label : null,
      weapon2Label: this.vehicle && this.vehicle.weapon2 ? this.vehicle.weapon2.label : null,
      canSwap: this.state === "playing" && this.isAtOwnBase(),
      powerupLabel: this.activePowerup ? POWERUP_INFO[this.activePowerup.type].label : null,
      powerupTimeLeft: this.activePowerup ? Math.max(0, this.activePowerup.timeLeft) : 0,
    };
  }
}
