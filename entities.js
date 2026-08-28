// Flag, turret, and bullet entities for the extraction core loop.

import { damageTint } from "./colorUtils.js";

export class Flag {
  constructor(x, y) {
    this.homeX = x;
    this.homeY = y;
    this.x = x;
    this.y = y;
    this.radius = 16;
    this.carrier = null; // vehicle reference while held
    // Name predates duel mode's symmetric second flag (game.js's
    // `playerFlag`) -- despite the name, it's just "has this flag ever left
    // home," used by both flags to tell "still at base" apart from
    // "dropped somewhere in the field" once whoever's carrying it (the
    // player, or the AI opponent) puts it down without delivering it.
    this.capturedByPlayer = false;
  }

  update() {
    if (this.carrier) {
      this.x = this.carrier.x;
      this.y = this.carrier.y;
    }
  }

  dropAt(x, y) {
    this.carrier = null;
    this.x = x;
    this.y = y;
  }

  returnHome() {
    this.carrier = null;
    this.x = this.homeX;
    this.y = this.homeY;
    this.capturedByPlayer = false;
  }

  draw(ctx, camera, canvasW, canvasH) {
    const s = camera.worldToScreen(this.x, this.y, canvasW, canvasH);
    ctx.save();
    ctx.translate(s.x, s.y);

    // Faint contact shadow to plant it on the ground.
    ctx.fillStyle = "rgba(0,0,0,0.25)";
    ctx.beginPath();
    ctx.ellipse(0, 10, 10, 4, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = "#1a1a1a";
    ctx.lineWidth = 2;
    ctx.fillStyle = "#2a2a2a";
    ctx.fillRect(-2, -20, 4, 28);
    ctx.strokeRect(-2, -20, 4, 28);

    ctx.beginPath();
    ctx.moveTo(2, -20);
    ctx.lineTo(26, -13);
    ctx.lineTo(2, -6);
    ctx.closePath();
    ctx.fillStyle = "#f2d94e";
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
}

export class Bullet {
  // `friendly` = fired by the player (damages turrets, and in duel mode the
  // AI vehicle); false = enemy fire (damages a vehicle -- see
  // `targetsPlayer` for which one). Just controls collision targeting +
  // color. `tall` = flies in over rooftop height and skips building
  // collision entirely (see game.js): true for an elevated turret's shots,
  // and also for the heli's missile (see vehicle.js's `weapon2`) so it can
  // reach a target -- or a tall turret -- that's using a building as cover
  // from ground-level fire. `radius` defaults to the small chaingun/turret-
  // round size; the missile passes a chunkier one. `targetsPlayer` only
  // matters for non-friendly fire: true (the default) means it damages the
  // player vehicle -- every non-duel turret shot and the AI opponent's own
  // cannon always want this. `false` is duel mode's territorial turrets
  // (see game.js's turret-targeting block): a turret on your side of the
  // mirrored map's halfway line fires on the AI opponent instead, so its
  // bullets need to say so.
  constructor(x, y, angle, speed, damage, friendly = false, tall = false, radius = 4, targetsPlayer = true) {
    this.x = x;
    this.y = y;
    this.vx = Math.cos(angle) * speed;
    this.vy = Math.sin(angle) * speed;
    this.radius = radius;
    this.damage = damage;
    this.friendly = friendly;
    this.tall = tall;
    this.targetsPlayer = targetsPlayer;
    this.dead = false;
    this.life = 3; // seconds before it fizzles out
    // Set by game.js when the LASER powerup is active. A piercing round
    // keeps flying (and keeps dealing damage) after hitting a building or
    // turret instead of dying on the first thing it touches; `hitTargets`
    // stops it from hitting the exact same obstacle/turret twice while
    // still overlapping it.
    this.piercing = false;
    this.hitTargets = new Set();
  }

  update(dt) {
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.life -= dt;
    if (this.life <= 0) this.dead = true;
  }

  draw(ctx, camera, canvasW, canvasH) {
    const s = camera.worldToScreen(this.x, this.y, canvasW, canvasH);
    // Friendly + tall = the heli's missile: its own distinct color so it
    // reads differently from both the regular chaingun tracer and an enemy
    // tall turret's rounds. A piercing (LASER powerup) round overrides all
    // of that with its own electric violet, since it reads as a completely
    // different weapon regardless of which gun fired it.
    const core = this.piercing
      ? "#c86bff"
      : this.friendly
      ? this.tall
        ? "#ffb347"
        : "#5fd0e0"
      : this.tall
      ? "#ffcf4a"
      : "#ff6b4a";
    const glow = this.piercing
      ? "rgba(200,107,255,0.4)"
      : this.friendly
      ? this.tall
        ? "rgba(255,179,71,0.35)"
        : "rgba(95,208,224,0.35)"
      : this.tall
      ? "rgba(255,207,74,0.35)"
      : "rgba(255,107,74,0.35)";
    // Small glow behind the flat core for a punchy, arcade-y tracer look.
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(s.x, s.y, this.radius + 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = core;
    ctx.strokeStyle = "#1a1a1a";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(s.x, s.y, this.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
}

export class Turret {
  // `tall`: an elevated sniper tower. Visually raised on a support pole, and
  // its shots skip building collision entirely (see the "tall" Bullet flag
  // and game.js), so it threatens the player over rooftops -- the one
  // enemy that cover doesn't fully solve, meant to pressure the player into
  // either rushing it directly or picking it off from range with the heli.
  constructor(x, y, { tall = false } = {}) {
    this.x = x;
    this.y = y;
    this.tall = tall;
    this.radius = 22;
    this.aimAngle = -Math.PI / 2;
    this.range = 620;
    this.fireCooldown = 0;
    this.fireInterval = 1.1;
    this.bulletSpeed = 460;
    this.damage = 9;
    this.inaccuracy = 0.09; // radians of random spread
    // Turrets are meant to be a real fight now that there are more of them
    // guarding the route -- 150 HP takes 5 tank cannon hits or ~22 chaingun
    // hits, up from the old 60 (2 cannon hits).
    this.maxHealth = 150;
    this.health = this.maxHealth;
    this.destroyed = false;
  }

  // `targetsPlayer` (default true) is just forwarded onto the Bullet it
  // fires -- see Bullet's own header comment. Every call site outside duel
  // mode leaves it at the default, so a turret's shots always mean "hit the
  // player" exactly like before; duel mode's territorial turrets (see
  // game.js) pass `false` for turrets on the player's side of the mirrored
  // map's halfway line, whose shots are meant for the AI opponent instead.
  update(dt, targetX, targetY, bullets, targetsPlayer = true) {
    if (this.destroyed) return false;

    const dx = targetX - this.x;
    const dy = targetY - this.y;
    const d = Math.hypot(dx, dy);
    this.aimAngle = Math.atan2(dy, dx);

    this.fireCooldown -= dt;
    if (d <= this.range && this.fireCooldown <= 0) {
      this.fireCooldown = this.fireInterval;
      const spread = (Math.random() - 0.5) * 2 * this.inaccuracy;
      bullets.push(
        new Bullet(this.x, this.y, this.aimAngle + spread, this.bulletSpeed, this.damage, false, this.tall, 4, targetsPlayer)
      );
      return true;
    }
    return false;
  }

  takeDamage(amount) {
    if (this.destroyed) return;
    this.health -= amount;
    if (this.health <= 0) this.destroyed = true;
  }

  draw(ctx, camera, canvasW, canvasH) {
    const s = camera.worldToScreen(this.x, this.y, canvasW, canvasH);
    // Every turret draws its head raised above its true ground position, on
    // a braced support pole -- the oblique camera's basic cue that anything
    // with real height stands up off the ground plane instead of being a
    // flat decal. Tall (rooftop-piercing) turrets stay dramatically more
    // elevated than regular ones (34px vs. 12px) so that distinction --
    // "this one's shots clear cover" -- still reads at a glance and isn't
    // washed out now that regular turrets get a lift of their own.
    const lift = this.destroyed ? 0 : this.tall ? 34 : 12;
    const hx = s.x;
    const hy = s.y - lift;

    if (lift > 0) {
      // Ground shadow at the true position, plus the support tower itself,
      // tinted to match this turret's own palette (steel-blue for tall,
      // a neutral dark tone for regular) rather than a single hardcoded
      // color, so the pole doesn't clash with whichever body color it's
      // actually holding up.
      const poleColor = this.tall ? "#22344a" : "#332920";
      const poleColorDark = this.tall ? "#111c28" : "#1a140d";

      ctx.fillStyle = "rgba(0,0,0,0.28)";
      ctx.beginPath();
      ctx.ellipse(s.x, s.y + 4, 16, 6, 0, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = poleColor;
      ctx.lineWidth = this.tall ? 6 : 4;
      ctx.beginPath();
      ctx.moveTo(s.x - 10, s.y);
      ctx.lineTo(hx - 5, hy);
      ctx.moveTo(s.x + 10, s.y);
      ctx.lineTo(hx + 5, hy);
      ctx.stroke();
      ctx.strokeStyle = poleColorDark;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(s.x - 8, s.y - lift * 0.5);
      ctx.lineTo(s.x + 8, s.y - lift * 0.5);
      ctx.stroke();
    }

    // How beat-up this turret looks scales with its remaining health -- a
    // fresh turret reads in its normal brown/red tones, a badly damaged one
    // shifts toward an angry, saturated red, independent of the "tall" or
    // "destroyed" states (which already have their own distinct look).
    const healthPct = this.maxHealth > 0 ? this.health / this.maxHealth : 1;

    ctx.save();
    ctx.translate(hx, hy);

    // Regular turrets read as round brown bunkers; tall sniper turrets get
    // a completely different silhouette (square) and a cool steel-blue
    // palette instead of a similar warm brown/red, so which ones fire over
    // rooftops is obvious at a glance instead of only showing up as a small
    // "▲" icon and a raised pole once you're already looking closely.
    const basePlateColor = this.tall ? "#2f4a68" : "#5a4632";
    const bodyColor = this.tall ? "#3d6ba0" : "#7a2e28";

    ctx.fillStyle = this.destroyed ? "#2a221c" : damageTint(basePlateColor, healthPct);
    if (this.tall) {
      const bp = this.radius + 6;
      ctx.fillRect(-bp, -bp, bp * 2, bp * 2);
      ctx.strokeStyle = "#1a1a1a";
      ctx.lineWidth = 3;
      ctx.strokeRect(-bp, -bp, bp * 2, bp * 2);
    } else {
      ctx.beginPath();
      ctx.arc(0, 0, this.radius + 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#1a1a1a";
      ctx.lineWidth = 3;
      ctx.stroke();
    }

    ctx.fillStyle = this.destroyed ? "#3a2f2a" : damageTint(bodyColor, healthPct);
    if (this.tall) {
      const r = this.radius;
      ctx.fillRect(-r, -r, r * 2, r * 2);
      ctx.strokeRect(-r, -r, r * 2, r * 2);
    } else {
      ctx.beginPath();
      ctx.arc(0, 0, this.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }

    if (!this.destroyed) {
      // Hard-edged highlight facet (upper-left quarter/corner).
      ctx.fillStyle = "rgba(255,255,255,0.2)";
      if (this.tall) {
        const r = this.radius;
        ctx.beginPath();
        ctx.moveTo(-r, -r);
        ctx.lineTo(r, -r);
        ctx.lineTo(-r, r);
        ctx.closePath();
        ctx.fill();
      } else {
        ctx.beginPath();
        ctx.arc(0, 0, this.radius, Math.PI, Math.PI * 1.5);
        ctx.lineTo(0, 0);
        ctx.closePath();
        ctx.fill();
      }

      ctx.rotate(this.aimAngle);
      ctx.fillStyle = "#2a2a2a";
      ctx.fillRect(0, -4, this.radius + 18, 8);
      ctx.strokeStyle = "#1a1a1a";
      ctx.lineWidth = 1.5;
      ctx.strokeRect(0, -4, this.radius + 18, 8);
    }
    ctx.restore();

    if (!this.destroyed) {
      // small health pip above the (possibly elevated) turret head
      const pct = Math.max(0, this.health / this.maxHealth);
      const barY = hy - this.radius - 14;
      ctx.fillStyle = "#1a1a1a";
      ctx.fillRect(hx - 20, barY, 40, 6);
      ctx.fillStyle = this.tall ? "#ffcf4a" : "#e0563f";
      ctx.fillRect(hx - 20, barY, 40 * pct, 6);

      if (this.tall) {
        // Small marker so the "fires over cover" threat reads at a glance.
        ctx.fillStyle = "#ffcf4a";
        ctx.font = "bold 12px 'Courier New', monospace";
        ctx.textAlign = "center";
        ctx.fillText("▲", hx, barY - 4);
      }
    }
  }
}

// Visual + label info for each powerup type, shared by the pickup's own
// draw() below and by game.js's HUD state -- one source of truth so the
// floating icon in the world and the HUD readout always agree on name/color.
export const POWERUP_INFO = {
  overcharge: { label: "OVERCHARGE", glyph: "4X", color: "#ffcf4a", glow: "rgba(255,207,74,0.45)" },
  // Replaced BIG SHOT: a fatter bullet radius sounded fun but actually made
  // shots clip buildings you weren't aiming at (see game.js's POWERUP_STATS
  // comment) -- SPLASH keeps a normal-width, normal-hitbox bullet and instead
  // deals area damage around wherever it actually lands, so the "big impact"
  // feeling comes from the explosion, not a wider flight path.
  splash: { label: "SPLASH", glyph: "*", color: "#ff8a3d", glow: "rgba(255,138,61,0.45)" },
  laser: { label: "LASER", glyph: "~", color: "#c86bff", glow: "rgba(200,107,255,0.45)" },
  // Defensive rather than offensive: halves incoming damage (see
  // POWERUP_STATS.armor's damageTakenMult in game.js) instead of buffing the
  // weapon, so its icon deliberately reads "shield" rather than "shot".
  armor: { label: "ARMOR", glyph: "⬡", color: "#5fe0a0", glow: "rgba(95,224,160,0.45)" },
};

// A powerup pickup left behind when a building that was secretly seeded
// with one (see Arena._seedPowerups) gets destroyed. Purely a floating,
// bobbing icon with no combat behavior of its own -- game.js handles the
// pickup-radius check and applies the actual gameplay effect.
export class Powerup {
  constructor(x, y, type) {
    this.x = x;
    this.y = y;
    this.type = type;
    this.radius = 16;
    this.bob = Math.random() * Math.PI * 2;
  }

  update(dt) {
    this.bob += dt * 2.4;
  }

  draw(ctx, camera, canvasW, canvasH) {
    const info = POWERUP_INFO[this.type] || POWERUP_INFO.overcharge;
    const s = camera.worldToScreen(this.x, this.y, canvasW, canvasH);
    const lift = Math.sin(this.bob) * 4;
    const y = s.y - 12 + lift;

    // Contact shadow at ground level, independent of the bob.
    ctx.fillStyle = "rgba(0,0,0,0.25)";
    ctx.beginPath();
    ctx.ellipse(s.x, s.y + 4, 11, 4, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = info.glow;
    ctx.beginPath();
    ctx.arc(s.x, y, this.radius + 7, 0, Math.PI * 2);
    ctx.fill();

    // Diamond body, rotating slowly so it reads as "special" against the
    // otherwise static rubble it's sitting on.
    ctx.save();
    ctx.translate(s.x, y);
    ctx.rotate(Math.PI / 4 + this.bob * 0.15);
    ctx.fillStyle = info.color;
    ctx.strokeStyle = "#1a1a1a";
    ctx.lineWidth = 2;
    ctx.fillRect(-9, -9, 18, 18);
    ctx.strokeRect(-9, -9, 18, 18);
    ctx.restore();

    ctx.fillStyle = "#1a1a1a";
    ctx.font = "bold 11px 'Courier New', monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(info.glyph, s.x, y);
    ctx.textBaseline = "alphabetic"; // restore the canvas default for other draw() callers
  }
}
