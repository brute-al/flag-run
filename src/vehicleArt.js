// Per-vehicle-type rendering. Kept separate from game.js so the "art style"
// (flat toon fills + bold outlines + a single hard-edged highlight band,
// instead of gradients/soft shading) lives in one place and is easy to
// swap out wholesale later (e.g. for a 3D toon-shaded renderer).

import { damageTint } from "./colorUtils.js";
import { POWERUP_INFO } from "./entities.js";

const OUTLINE = "#1a1a1a";
const OUTLINE_WIDTH = 3;

function outlinedPath(ctx, fillStyle, drawPath) {
  drawPath();
  ctx.fillStyle = fillStyle;
  ctx.fill();
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = OUTLINE_WIDTH;
  ctx.stroke();
}

function roundRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// `healthFrac` (0..1, defaults to full health) lets the player's own vehicle
// redden the same way an enemy turret does as it takes damage -- the same
// "angrier the more hurt it is" visual language used across the game.
// `lift` (0 by default) draws the vehicle's body raised above its own ground
// shadow, the same oblique-camera cue buildings/turrets use -- purely a
// screen-space offset for the whole body+turret assembly, so it doesn't
// touch `vehicle.x`/`vehicle.y` (still true ground position for physics,
// collision, and aim math) or any of the rotation logic below.
// `powerupType` (null by default) draws the active-buff visual around the
// vehicle: a shield "bubble" ring for ARMOR (so its damage reduction is
// obvious at a glance, not just a HUD countdown) or a pulsing energy aura for
// LASER (so autofire feels visibly charged while it's piercing). Both reuse
// POWERUP_INFO's existing glow/color per type -- the same colors the
// floating world pickup icon uses -- so whatever glow you picked up off the
// ground is the same glow you're now wearing. OVERCHARGE and SPLASH don't
// get one: they're about the shot leaving the barrel, not a standing effect
// on the vehicle itself.
export function drawVehicle(ctx, screenX, screenY, vehicle, healthFrac = 1, lift = 0, powerupType = null) {
  if (lift > 0) {
    ctx.fillStyle = "rgba(0,0,0,0.25)";
    ctx.beginPath();
    ctx.ellipse(screenX, screenY, 15, 6, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  const bodyY = screenY - lift;

  if (powerupType === "armor") {
    const info = POWERUP_INFO.armor;
    const pulse = Math.sin(performance.now() / 260) * 2;
    ctx.beginPath();
    ctx.arc(screenX, bodyY, 27 + pulse, 0, Math.PI * 2);
    ctx.fillStyle = info.glow;
    ctx.fill();
    ctx.strokeStyle = info.color;
    ctx.lineWidth = 2.5;
    ctx.stroke();
  } else if (powerupType === "laser") {
    const info = POWERUP_INFO.laser;
    const pulse = Math.sin(performance.now() / 180) * 4;
    ctx.beginPath();
    ctx.arc(screenX, bodyY, 24 + pulse, 0, Math.PI * 2);
    ctx.fillStyle = info.glow;
    ctx.fill();
  }

  if (vehicle.hasTurret) {
    // Hull and turret are drawn as two separately-rotated layers sharing
    // the same origin: the hull spins with the vehicle's heading (driving
    // direction), while the turret spins with its own independent
    // `turretAngle` -- that's what lets the tank drive one way while its
    // cannon keeps aiming another, and it's why the turret visibly swings
    // on its own instead of needing a separate reticle to show where it's
    // pointed.
    ctx.save();
    ctx.translate(screenX, bodyY);
    ctx.rotate(vehicle.heading);
    drawTankHull(ctx, healthFrac);
    ctx.restore();

    ctx.save();
    ctx.translate(screenX, bodyY);
    ctx.rotate(vehicle.turretAngle);
    drawTankTurret(ctx, healthFrac);
    ctx.restore();
  } else {
    ctx.save();
    ctx.translate(screenX, bodyY);
    ctx.rotate(vehicle.heading);

    if (vehicle.type === "heli") drawHeli(ctx, healthFrac);
    else drawJeep(ctx, healthFrac);

    ctx.restore();
  }

  if (vehicle.carrying) {
    ctx.fillStyle = "#f2d94e";
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(screenX, bodyY - 30, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
}

function drawJeep(ctx, healthFrac = 1) {
  // Body (nose points toward +x, matching heading convention elsewhere).
  outlinedPath(ctx, damageTint("#4fa8e0", healthFrac), () => roundRectPath(ctx, -16, -10, 32, 20, 4));
  // Windshield / cab accent block toward the rear.
  outlinedPath(ctx, damageTint("#2f6a91", healthFrac), () => roundRectPath(ctx, 4, -9, 11, 18, 2));
  // Hard-edged highlight band (cel-shading's single light stripe).
  ctx.fillStyle = "rgba(255,255,255,0.35)";
  ctx.fillRect(-14, -9, 30, 4);
  // Wheels.
  ctx.fillStyle = OUTLINE;
  ctx.fillRect(-13, -13, 9, 4);
  ctx.fillRect(-13, 9, 9, 4);
  ctx.fillRect(6, -13, 9, 4);
  ctx.fillRect(6, 9, 9, 4);
}

// Hull + tracks only -- rotates with the vehicle's heading (driving
// direction). The turret is drawn separately (see drawTankTurret) so it can
// rotate independently.
function drawTankHull(ctx, healthFrac = 1) {
  // Tracks (drawn first so the hull overlaps their inner edge). Left
  // untinted -- treads reading as damaged doesn't communicate anything
  // useful, so only the armored hull body reddens.
  outlinedPath(ctx, "#2a2f1c", () => roundRectPath(ctx, -20, -16, 40, 8, 3));
  outlinedPath(ctx, "#2a2f1c", () => roundRectPath(ctx, -20, 8, 40, 8, 3));
  // Hull.
  outlinedPath(ctx, damageTint("#5d6b3a", healthFrac), () => roundRectPath(ctx, -18, -11, 36, 22, 5));
  // Highlight band on the hull.
  ctx.fillStyle = "rgba(255,255,255,0.28)";
  ctx.fillRect(-16, -10, 34, 4);
}

// Turret ring + barrel only -- rotates with `turretAngle`, independent of
// the hull. Centered at the origin (rather than offset like the old
// single-piece drawing) so it has a clean pivot point to spin around.
function drawTankTurret(ctx, healthFrac = 1) {
  ctx.beginPath();
  ctx.arc(0, 0, 11, 0, Math.PI * 2);
  ctx.fillStyle = damageTint("#43502c", healthFrac);
  ctx.fill();
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = OUTLINE_WIDTH;
  ctx.stroke();
  // Barrel left untinted -- it reads more like gun metal than armor, and
  // keeping it dark helps the reddened turret ring stay legible against it.
  ctx.fillStyle = "#2f3a1e";
  ctx.fillRect(6, -3, 20, 6);
  ctx.strokeRect(6, -3, 20, 6);
  // Small highlight for the toon-lit look, matching the hull's band.
  ctx.fillStyle = "rgba(255,255,255,0.25)";
  ctx.beginPath();
  ctx.arc(0, 0, 11, Math.PI, Math.PI * 1.5);
  ctx.lineTo(0, 0);
  ctx.closePath();
  ctx.fill();
}

function drawHeli(ctx, healthFrac = 1) {
  // Tail boom (drawn behind the fuselage, pointing to the rear).
  outlinedPath(ctx, damageTint("#5c6a55", healthFrac), () => {
    ctx.beginPath();
    ctx.moveTo(-8, -3);
    ctx.lineTo(-34, -1.5);
    ctx.lineTo(-34, 1.5);
    ctx.lineTo(-8, 3);
    ctx.closePath();
  });
  // Fuselage.
  outlinedPath(ctx, damageTint("#6b7a63", healthFrac), () => {
    ctx.beginPath();
    ctx.ellipse(2, 0, 17, 11, 0, 0, Math.PI * 2);
  });
  // Cockpit glass.
  outlinedPath(ctx, "#3f5a63", () => {
    ctx.beginPath();
    ctx.ellipse(10, 0, 7, 6.5, 0, 0, Math.PI * 2);
  });
  // Highlight band.
  ctx.fillStyle = "rgba(255,255,255,0.3)";
  ctx.beginPath();
  ctx.ellipse(0, -6, 10, 3, 0, 0, Math.PI * 2);
  ctx.fill();

  // Spinning main rotor, animated off wall-clock time (purely visual).
  const spin = (performance.now() / 45) % (Math.PI * 2);
  ctx.save();
  ctx.rotate(spin);
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(-30, 0);
  ctx.lineTo(30, 0);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(0, -30);
  ctx.lineTo(0, 30);
  ctx.stroke();
  ctx.restore();
  ctx.fillStyle = "#2a2a2a";
  ctx.beginPath();
  ctx.arc(0, 0, 3, 0, Math.PI * 2);
  ctx.fill();
}
