// The arena: world bounds, terrain obstacles, and the two bases.
// Kept deliberately simple (circles + a grid) so the prototype reads clearly
// and collision math stays cheap.

export class Arena {
  // `mapData`, if provided (see mapData.js), swaps the procedurally
  // generated arena for a real-world neighborhood layout: building
  // footprints become obstacles and OSM roads are drawn as street overlays.
  // Everything downstream (collision, camera, base logic) doesn't care which
  // mode it's in -- both produce the same {width, height, obstacles, playerBase,
  // enemyBase} shape.
  constructor(mapData = null) {
    this.isRealWorld = !!mapData;

    // Dimensions (and roads) first -- bases and obstacle generation both
    // depend on knowing the world size, and the procedural obstacle
    // generator additionally needs the bases to already exist so it can
    // keep rocks away from them.
    if (mapData) {
      this.width = mapData.worldWidth;
      this.height = mapData.worldHeight;
      this.roads = mapData.roads;
    } else {
      this.width = 3000;
      this.height = 2200;
      this.roads = [];
    }

    // Bases sit near the north/south ends either way -- on a real map that
    // naturally lines up with the export box's short edges.
    const baseRadius = 170;
    this.playerBase = { x: this.width / 2, y: baseRadius + 90, radius: baseRadius };
    this.enemyBase = { x: this.width / 2, y: this.height - baseRadius - 90, radius: baseRadius };

    if (mapData) {
      this.obstacles = this._buildingsToObstacles(mapData.buildings);
      this.groundDetails = [];
      // Real building layouts aren't guaranteed to leave the base spots
      // clear, so drop any obstacle that would overlap one.
      this.obstacles = this.obstacles.filter(
        (o) =>
          dist(o.x, o.y, this.playerBase.x, this.playerBase.y) > this.playerBase.radius + o.radius + 40 &&
          dist(o.x, o.y, this.enemyBase.x, this.enemyBase.y) > this.enemyBase.radius + o.radius + 40
      );
      // Tag a handful of destructible buildings with a hidden powerup (see
      // game.js, which spawns the actual pickup once a tagged building's
      // health hits zero). They're drawn gold (_drawBuilding) so the player
      // has something concrete to chase down instead of demolishing
      // buildings at random. Re-rolled fresh every round -- see reset() in
      // game.js, which builds a brand-new Arena (and re-runs this) each time
      // the player picks a vehicle from the select screen.
      this._seedPowerups(5);
    } else {
      // Scattered rock obstacles the vehicle collides with. Kept out of the
      // two base circles so there's always a way through.
      this.obstacles = this._generateObstacles(26);
      // Purely decorative dirt patches for a less flat, more "painted" ground.
      this.groundDetails = this._generateGroundDetails(90);
    }
  }

  // Converts building footprint polygons into the same {x, y, radius, facets}
  // shape the procedural rocks use, so collision/drawing code doesn't need to
  // know the difference. `radius` is still a bounding circle (used only as a
  // cheap broad-phase reject), but actual collision resolution walks the real
  // polygon edges -- see resolveObstacleCollisions -- so an elongated
  // building doesn't falsely block open street next to it. Buildings are
  // also destructible: they carry health and a `destructible` flag that
  // procedural rocks don't have, so weapon fire can blow a path through them.
  _buildingsToObstacles(buildings) {
    return buildings.map((flat) => {
      // Buildings ship as flat [x0,y0,x1,y1,...] arrays (more compact over the
      // wire than nested [x,y] pairs) -- reconstitute the point-pair polygon
      // before doing anything else with it.
      const poly = [];
      for (let i = 0; i < flat.length; i += 2) poly.push([flat[i], flat[i + 1]]);
      const cx = poly.reduce((s, p) => s + p[0], 0) / poly.length;
      const cy = poly.reduce((s, p) => s + p[1], 0) / poly.length;
      const radius = Math.max(...poly.map((p) => Math.hypot(p[0] - cx, p[1] - cy)));
      const facets = poly.map((p) => ({ x: p[0] - cx, y: p[1] - cy }));
      // Tuned so a tank's cannon (30 dmg/shot) clears one in 2 hits -- easy
      // enough that blasting a shortcut through a building feels worthwhile
      // mid-run, without being free.
      const maxHealth = 55;
      const paletteIndex = Math.abs(Math.round(cx * 13 + cy * 7)) % BUILDING_PALETTE.length;
      return { x: cx, y: cy, radius, facets, destructible: true, health: maxHealth, maxHealth, destroyed: false, paletteIndex };
    });
  }

  // Tags up to `count` random destructible buildings with `hasPowerup` +
  // `powerupType`. Kept spread out (a minimum separation) so they don't
  // cluster into one lucky block, and so knocking down any single building
  // has decent odds of being the "wrong" one -- the whole point is that the
  // player can't tell which ones are seeded just by looking.
  _seedPowerups(count) {
    const POWERUP_TYPES = ["overcharge", "bigShot", "laser", "armor"];
    const minSeparation = 220;
    const eligible = this.obstacles.filter((o) => o.destructible);
    const chosen = [];
    let attempts = 0;
    while (chosen.length < count && attempts < eligible.length * 8 && eligible.length > 0) {
      attempts++;
      const candidate = eligible[Math.floor(Math.random() * eligible.length)];
      if (candidate.hasPowerup) continue;
      const farEnough = chosen.every((c) => dist(candidate.x, candidate.y, c.x, c.y) > minSeparation);
      if (farEnough) {
        candidate.hasPowerup = true;
        candidate.powerupType = POWERUP_TYPES[Math.floor(Math.random() * POWERUP_TYPES.length)];
        chosen.push(candidate);
      }
    }
  }

  _generateObstacles(count) {
    const obstacles = [];
    let attempts = 0;
    while (obstacles.length < count && attempts < count * 20) {
      attempts++;
      const x = 120 + Math.random() * (this.width - 240);
      const y = 500 + Math.random() * (this.height - 1000);
      const radius = 40 + Math.random() * 55;

      const farFromBases =
        dist(x, y, this.playerBase.x, this.playerBase.y) > this.playerBase.radius + radius + 60 &&
        dist(x, y, this.enemyBase.x, this.enemyBase.y) > this.enemyBase.radius + radius + 60;
      const notOverlapping = obstacles.every(
        (o) => dist(x, y, o.x, o.y) > o.radius + radius + 30
      );

      if (farFromBases && notOverlapping) {
        obstacles.push({ x, y, radius, facets: makeFacetedShape(radius) });
      }
    }
    return obstacles;
  }

  _generateGroundDetails(count) {
    const details = [];
    for (let i = 0; i < count; i++) {
      details.push({
        x: Math.random() * this.width,
        y: Math.random() * this.height,
        radius: 30 + Math.random() * 70,
        shade: Math.random() > 0.5 ? "rgba(0,0,0,0.06)" : "rgba(255,255,255,0.04)",
      });
    }
    return details;
  }

  clampToBounds(entity) {
    entity.x = Math.max(entity.radius, Math.min(this.width - entity.radius, entity.x));
    entity.y = Math.max(entity.radius, Math.min(this.height - entity.radius, entity.y));
  }

  // Pushes `entity` out of any obstacle it's overlapping and kills the
  // velocity component driving it into the obstacle (a soft bump, not a wall).
  // Uses the obstacle's actual polygon (not just its bounding circle) so an
  // elongated or L-shaped building doesn't block open street that's really
  // just near its bounding circle -- this is what was causing vehicles to
  // get stuck on "empty" pavement next to real building footprints.
  resolveObstacleCollisions(entity) {
    for (const o of this.obstacles) {
      if (o.destroyed) continue;

      // Cheap broad-phase reject using the bounding circle before doing any
      // per-edge polygon math.
      const dx0 = entity.x - o.x;
      const dy0 = entity.y - o.y;
      const roughDist = Math.hypot(dx0, dy0);
      if (roughDist > o.radius + entity.radius + 4) continue;

      const poly = o.facets;
      if (!poly || poly.length < 3) {
        this._resolveCircleCollision(entity, o, dx0, dy0, roughDist);
        continue;
      }

      let bestDist = Infinity;
      let closest = null;
      for (let i = 0; i < poly.length; i++) {
        const a = poly[i];
        const b = poly[(i + 1) % poly.length];
        const ax = o.x + a.x, ay = o.y + a.y;
        const bx = o.x + b.x, by = o.y + b.y;
        const cp = closestPointOnSegment(entity.x, entity.y, ax, ay, bx, by);
        const d = Math.hypot(entity.x - cp.x, entity.y - cp.y);
        if (d < bestDist) {
          bestDist = d;
          closest = cp;
        }
      }

      const inside = pointInPolygon(entity.x, entity.y, poly, o.x, o.y);
      if (!inside && bestDist >= entity.radius) continue; // no real overlap

      const d = Math.max(bestDist, 0.0001);
      // Outward direction from the nearest boundary point: away from the
      // entity's (outside) position, or the reverse when the entity center
      // is inside the footprint (can happen at low framerate/high speed) --
      // either way, the fix is to end up exactly `entity.radius` away from
      // that boundary point on the correct side of it. (An earlier version
      // of this measured the right direction but anchored the push at the
      // wrong base point/scale, which could shove a penetrating vehicle
      // *deeper* into a shape instead of out -- a real vehicle-gets-stuck
      // bug, not just a test artifact.)
      let nx, ny;
      if (inside) {
        nx = (closest.x - entity.x) / d;
        ny = (closest.y - entity.y) / d;
      } else {
        nx = (entity.x - closest.x) / d;
        ny = (entity.y - closest.y) / d;
      }
      entity.x = closest.x + nx * entity.radius;
      entity.y = closest.y + ny * entity.radius;

      if (typeof entity.vx === "number") {
        const vDotN = entity.vx * nx + entity.vy * ny;
        if (vDotN < 0) {
          entity.vx -= vDotN * nx * 1.3;
          entity.vy -= vDotN * ny * 1.3;
        }
      }
    }
  }

  _resolveCircleCollision(entity, o, dx0, dy0, roughDist) {
    const d = roughDist || 0.0001;
    const minDist = o.radius + entity.radius;
    if (d < minDist) {
      const overlap = minDist - d;
      const nx = dx0 / d;
      const ny = dy0 / d;
      entity.x += nx * overlap;
      entity.y += ny * overlap;
      if (typeof entity.vx === "number") {
        const vDotN = entity.vx * nx + entity.vy * ny;
        if (vDotN < 0) {
          entity.vx -= vDotN * nx * 1.3;
          entity.vy -= vDotN * ny * 1.3;
        }
      }
    }
  }

  draw(ctx, camera, canvasW, canvasH) {
    // Flat, posterized ground fill (no gradients — flat color is the toon look).
    ctx.fillStyle = "#38492b";
    ctx.fillRect(0, 0, canvasW, canvasH);

    // Painterly dirt patches break up the flat fill without adding gradients.
    for (const d of this.groundDetails) {
      const s = camera.worldToScreen(d.x, d.y, canvasW, canvasH);
      if (s.x < -d.radius || s.x > canvasW + d.radius || s.y < -d.radius || s.y > canvasH + d.radius) continue;
      ctx.fillStyle = d.shade;
      ctx.beginPath();
      ctx.arc(s.x, s.y, d.radius, 0, Math.PI * 2);
      ctx.fill();
    }

    // World-bounds-relative grid for a sense of motion/scale (procedural
    // arena only -- on a real map the roads themselves provide that read).
    if (!this.isRealWorld) {
      ctx.strokeStyle = "rgba(215, 232, 201, 0.10)";
      ctx.lineWidth = 1;
      const gridSize = 100;
      const startX = Math.floor((camera.x - canvasW) / gridSize) * gridSize;
      const startY = Math.floor((camera.y - canvasH) / gridSize) * gridSize;
      for (let x = startX; x < camera.x + canvasW; x += gridSize) {
        const s = camera.worldToScreen(x, 0, canvasW, canvasH);
        ctx.beginPath();
        ctx.moveTo(s.x, 0);
        ctx.lineTo(s.x, canvasH);
        ctx.stroke();
      }
      for (let y = startY; y < camera.y + canvasH; y += gridSize) {
        const s = camera.worldToScreen(0, y, canvasW, canvasH);
        ctx.beginPath();
        ctx.moveTo(0, s.y);
        ctx.lineTo(canvasW, s.y);
        ctx.stroke();
      }
    }

    // Real-world roads: drawn as flat street strips under the buildings.
    if (this.isRealWorld) {
      ctx.strokeStyle = "#5c5c52";
      ctx.lineWidth = 54;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      for (const road of this.roads) {
        ctx.beginPath();
        road.forEach((p, i) => {
          const s = camera.worldToScreen(p[0], p[1], canvasW, canvasH);
          if (i === 0) ctx.moveTo(s.x, s.y);
          else ctx.lineTo(s.x, s.y);
        });
        ctx.stroke();
      }
      ctx.strokeStyle = "#7a7a6e";
      ctx.lineWidth = 48;
      for (const road of this.roads) {
        ctx.beginPath();
        road.forEach((p, i) => {
          const s = camera.worldToScreen(p[0], p[1], canvasW, canvasH);
          if (i === 0) ctx.moveTo(s.x, s.y);
          else ctx.lineTo(s.x, s.y);
        });
        ctx.stroke();
      }
    }

    // World bounds (so the player can see the edge of the map).
    const topLeft = camera.worldToScreen(0, 0, canvasW, canvasH);
    ctx.strokeStyle = "#f2d94e";
    ctx.lineWidth = 4;
    ctx.strokeRect(topLeft.x, topLeft.y, this.width, this.height);

    // Bases.
    this._drawBase(ctx, camera, canvasW, canvasH, this.playerBase, "#4fa8e0", "YOUR BASE");
    this._drawBase(ctx, camera, canvasW, canvasH, this.enemyBase, "#d1483f", "ENEMY BASE");

    // Obstacles: hand-cut-looking procedural rocks, or actual building
    // footprints on a real map. Buildings get a small pseudo-3D extrusion
    // (a "wall" face offset below/right of the roof) plus a varied color
    // palette and simple windows so they read as buildings, not gravel.
    for (const o of this.obstacles) {
      const s = camera.worldToScreen(o.x, o.y, canvasW, canvasH);
      if (s.x < -o.radius - 20 || s.x > canvasW + o.radius + 20 || s.y < -o.radius - 20 || s.y > canvasH + o.radius + 20)
        continue;

      if (this.isRealWorld) {
        this._drawBuilding(ctx, s, o);
      } else {
        this._drawRock(ctx, s, o);
      }
    }
  }

  _drawRock(ctx, s, o) {
    ctx.beginPath();
    o.facets.forEach((p, i) => {
      const px = s.x + p.x;
      const py = s.y + p.y;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.closePath();
    ctx.fillStyle = "#6b6552";
    ctx.fill();
    ctx.strokeStyle = "#2e2b22";
    ctx.lineWidth = 3;
    ctx.stroke();

    // Single flat highlight facet (top-left triangle) for the toon-lit look.
    const p0 = o.facets[0];
    const p1 = o.facets[1];
    ctx.beginPath();
    ctx.moveTo(s.x, s.y);
    ctx.lineTo(s.x + p0.x, s.y + p0.y);
    ctx.lineTo(s.x + p1.x, s.y + p1.y);
    ctx.closePath();
    ctx.fillStyle = "rgba(255,255,255,0.16)";
    ctx.fill();
  }

  _drawBuilding(ctx, s, o) {
    if (o.destroyed) {
      this._drawRubble(ctx, s, o);
      return;
    }

    const colors = BUILDING_PALETTE[o.paletteIndex] || BUILDING_PALETTE[0];
    const extrude = { x: 5, y: 7 }; // down-right offset, a cheap pseudo-3D wall

    const pathAt = (offset) => {
      ctx.beginPath();
      o.facets.forEach((p, i) => {
        const px = s.x + p.x + offset.x;
        const py = s.y + p.y + offset.y;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });
      ctx.closePath();
    };

    // A building secretly seeded with a powerup (see Arena._seedPowerups)
    // reads as gold with a soft pulsing halo, so hunting one down is an
    // active, visible choice instead of a blind demolition derby. Reuses the
    // flag/world-bounds gold (#f2d94e) so it reads as "the same kind of
    // special" as the rest of the game's gold accents.
    if (o.hasPowerup) {
      const pulse = 0.5 + 0.5 * Math.sin(Date.now() / 260 + o.x * 0.01);
      ctx.fillStyle = `rgba(242, 217, 78, ${0.22 + pulse * 0.18})`;
      ctx.beginPath();
      ctx.arc(s.x, s.y, o.radius + 14 + pulse * 5, 0, Math.PI * 2);
      ctx.fill();
    }

    // Ground contact shadow.
    ctx.fillStyle = "rgba(0,0,0,0.18)";
    pathAt({ x: extrude.x + 2, y: extrude.y + 3 });
    ctx.fill();

    // Wall face: the same footprint offset down-right, in a darker shade,
    // so the roof appears to sit up above street level. Gold-tinted instead
    // of its normal palette color when it's hiding a powerup.
    ctx.fillStyle = o.hasPowerup ? "#c9a23a" : colors.wall;
    pathAt(extrude);
    ctx.fill();
    ctx.strokeStyle = o.hasPowerup ? "#5c4711" : colors.stroke;
    ctx.lineWidth = 2;
    ctx.stroke();

    // Roof: the real (undisplaced) footprint on top.
    ctx.fillStyle = o.hasPowerup ? "#f2d94e" : colors.roof;
    pathAt({ x: 0, y: 0 });
    ctx.fill();
    ctx.strokeStyle = o.hasPowerup ? "#8a6a10" : colors.stroke;
    ctx.lineWidth = o.hasPowerup ? 3 : 2;
    ctx.stroke();

    // Single flat highlight facet for the toon-lit look.
    const p0 = o.facets[0];
    const p1 = o.facets[1];
    ctx.beginPath();
    ctx.moveTo(s.x, s.y);
    ctx.lineTo(s.x + p0.x, s.y + p0.y);
    ctx.lineTo(s.x + p1.x, s.y + p1.y);
    ctx.closePath();
    ctx.fillStyle = "rgba(255,255,255,0.18)";
    ctx.fill();

    // Simple window grid on buildings big enough to read clearly.
    if (o.radius > 22) {
      const cols = o.radius > 40 ? 3 : 2;
      const rows = o.radius > 40 ? 3 : 2;
      const span = o.radius * 0.9;
      ctx.fillStyle = "rgba(70,90,100,0.55)";
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const wx = s.x - span / 2 + (span / (cols - 1 || 1)) * c;
          const wy = s.y - span / 2 + (span / (rows - 1 || 1)) * r;
          if (!pointInPolygon(wx, wy, o.facets, s.x, s.y)) continue;
          ctx.fillRect(wx - 2.5, wy - 2.5, 5, 5);
        }
      }
    }

    // Health pip while damaged, so it's clear weapons are working on it.
    if (o.health < o.maxHealth) {
      const pct = Math.max(0, o.health / o.maxHealth);
      ctx.fillStyle = "#1a1a1a";
      ctx.fillRect(s.x - o.radius * 0.5, s.y - o.radius - 12, o.radius, 5);
      ctx.fillStyle = "#e0563f";
      ctx.fillRect(s.x - o.radius * 0.5, s.y - o.radius - 12, o.radius * pct, 5);
    }
  }

  _drawRubble(ctx, s, o) {
    ctx.beginPath();
    o.facets.forEach((p, i) => {
      const px = s.x + p.x * 0.55; // collapsed footprint reads as a flattened lot
      const py = s.y + p.y * 0.55;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.closePath();
    ctx.fillStyle = RUBBLE_COLOR.fill;
    ctx.fill();
    ctx.strokeStyle = RUBBLE_COLOR.stroke;
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 4]);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  _drawBase(ctx, camera, canvasW, canvasH, base, color, label) {
    const s = camera.worldToScreen(base.x, base.y, canvasW, canvasH);
    ctx.fillStyle = color + "33";
    ctx.beginPath();
    ctx.arc(s.x, s.y, base.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = 4;
    ctx.setLineDash([14, 10]);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = "#1a1a1a";
    ctx.font = "bold 14px 'Courier New', monospace";
    ctx.textAlign = "center";
    ctx.fillText(label, s.x + 1, s.y - base.radius - 11);
    ctx.fillStyle = color;
    ctx.fillText(label, s.x, s.y - base.radius - 12);
  }
}

function dist(x1, y1, x2, y2) {
  return Math.hypot(x1 - x2, y1 - y2);
}

// A small fixed palette so real-world buildings read as a varied town
// instead of one flat khaki color repeated 675 times. Each building picks a
// palette entry deterministically from its own position (see paletteIndex
// in _buildingsToObstacles), so it stays the same building-to-building
// across frames without needing to store anything extra.
const BUILDING_PALETTE = [
  { roof: "#c9a876", wall: "#8a6f4a", stroke: "#3a2f1c" },
  { roof: "#a8a89c", wall: "#6e6e63", stroke: "#2e2e29" },
  { roof: "#b98a72", wall: "#7a5842", stroke: "#3a2a1c" },
  { roof: "#9db38a", wall: "#657050", stroke: "#2c331f" },
  { roof: "#c2b280", wall: "#7d7350", stroke: "#392f1c" },
  { roof: "#8fa3ad", wall: "#5c6b73", stroke: "#26333a" },
];
const RUBBLE_COLOR = { fill: "#4a463c", stroke: "#26241d" };

// Closest point on segment a->b to point p, used for polygon-edge collision.
function closestPointOnSegment(px, py, ax, ay, bx, by) {
  const abx = bx - ax;
  const aby = by - ay;
  const lenSq = abx * abx + aby * aby || 1e-9;
  let t = ((px - ax) * abx + (py - ay) * aby) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return { x: ax + abx * t, y: ay + aby * t };
}

// Standard ray-casting point-in-polygon test. `facets` are offsets relative
// to (ox, oy) -- the same shape used for both collision and drawing.
function pointInPolygon(px, py, facets, ox, oy) {
  let inside = false;
  for (let i = 0, j = facets.length - 1; i < facets.length; j = i++) {
    const xi = ox + facets[i].x, yi = oy + facets[i].y;
    const xj = ox + facets[j].x, yj = oy + facets[j].y;
    const intersect = yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

// Builds a jittered-radius polygon (in local coords, centered on origin) so
// rocks read as faceted chunks instead of perfect circles.
function makeFacetedShape(radius) {
  const sides = 7 + Math.floor(Math.random() * 3);
  const points = [];
  for (let i = 0; i < sides; i++) {
    const angle = (i / sides) * Math.PI * 2;
    const r = radius * (0.75 + Math.random() * 0.35);
    points.push({ x: Math.cos(angle) * r, y: Math.sin(angle) * r });
  }
  return points;
}
