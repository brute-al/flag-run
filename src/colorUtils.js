// Tiny shared color-math helper so both the turret and the player vehicle can
// "redden" toward a damage color as their health drops, without duplicating
// hex-parsing logic in entities.js and vehicleArt.js.

function hexToRgb(hex) {
  const clean = hex.replace("#", "");
  const full = clean.length === 3 ? clean.split("").map((c) => c + c).join("") : clean;
  const num = parseInt(full, 16);
  return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255 };
}

function rgbToHex(r, g, b) {
  const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)));
  return "#" + [clamp(r), clamp(g), clamp(b)].map((v) => v.toString(16).padStart(2, "0")).join("");
}

// Blends from `hexA` toward `hexB` by fraction `t` (0 = pure A, 1 = pure B).
export function lerpColor(hexA, hexB, t) {
  const a = hexToRgb(hexA);
  const b = hexToRgb(hexB);
  const clampedT = Math.max(0, Math.min(1, t));
  return rgbToHex(
    a.r + (b.r - a.r) * clampedT,
    a.g + (b.g - a.g) * clampedT,
    a.b + (b.b - a.b) * clampedT
  );
}

// Shared "damage red" every low-health tint blends toward, so the turret and
// every vehicle type read as the same visual language (the more battered
// something is, the angrier/redder it looks).
export const DAMAGE_COLOR = "#ff2a2a";

// `healthFrac` is 0 (dead) .. 1 (full health). Reddening ramps in gradually
// and caps out at 80% blended so a badly-hurt target still reads as "this
// specific thing" rather than turning into a flat red blob.
export function damageTint(baseHex, healthFrac) {
  const t = (1 - Math.max(0, Math.min(1, healthFrac))) * 0.8;
  return lerpColor(baseHex, DAMAGE_COLOR, t);
}
