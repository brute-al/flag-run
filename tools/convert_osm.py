import xml.etree.ElementTree as ET
import math
import json
import sys

SRC = sys.argv[1] if len(sys.argv) > 1 else "map.osm"
OUT_JS = sys.argv[2] if len(sys.argv) > 2 else "mapData.js"

DRIVABLE_HIGHWAYS = {"residential", "tertiary", "secondary", "primary", "service", "living_street", "unclassified"}

tree = ET.parse(SRC)
root = tree.getroot()

bounds = root.find("bounds")
minlat, minlon = float(bounds.get("minlat")), float(bounds.get("minlon"))
maxlat, maxlon = float(bounds.get("maxlat")), float(bounds.get("maxlon"))
lat0 = (minlat + maxlat) / 2
lon0 = (minlon + maxlon) / 2

M_PER_DEG_LAT = 111320.0
m_per_deg_lon = 111320.0 * math.cos(math.radians(lat0))

def project(lat, lon):
    x = (lon - lon0) * m_per_deg_lon
    y = (lat0 - lat) * M_PER_DEG_LAT
    return x, y

bx0, by0 = project(maxlat, minlon)
bx1, by1 = project(minlat, maxlon)
minx, maxx = bx0, bx1
miny, maxy = by0, by1
real_w = maxx - minx
real_h = maxy - miny
print(f"selected export area: {real_w:.0f}m x {real_h:.0f}m", file=sys.stderr)

PAD_FRAC = 0.15
padx = real_w * PAD_FRAC
pady = real_h * PAD_FRAC

nodes = {}
for nd in root.findall("node"):
    nodes[nd.get("id")] = (float(nd.get("lat")), float(nd.get("lon")))

def in_padded_box(x, y):
    return (minx - padx) <= x <= (maxx + padx) and (miny - pady) <= y <= (maxy + pady)

buildings = []
roads = []

for way in root.findall("way"):
    tags = {t.get("k"): t.get("v") for t in way.findall("tag")}
    refs = [nd.get("ref") for nd in way.findall("nd")]
    pts = [nodes[r] for r in refs if r in nodes]
    if len(pts) < 2:
        continue
    projected = [project(lat, lon) for lat, lon in pts]
    if not any(in_padded_box(x, y) for x, y in projected):
        continue

    if "building" in tags:
        if refs[0] == refs[-1] and len(projected) >= 3:
            buildings.append(projected)
    elif tags.get("highway") in DRIVABLE_HIGHWAYS:
        roads.append(projected)

print(f"kept: {len(buildings)} building polygons, {len(roads)} road segments", file=sys.stderr)

SCALE = 2.0
MARGIN = 150

def to_game(pt):
    x, y = pt
    return (x - minx) * SCALE + MARGIN, (y - miny) * SCALE + MARGIN

buildings_game = [[to_game(p) for p in poly] for poly in buildings]
roads_game = [[to_game(p) for p in line] for line in roads]

# --- Simplification: Douglas-Peucker to drop near-collinear points (OSM
# buildings/roads carry a lot of redundant vertices from shared nodes with
# neighboring features), then round to whole game units. Both cut the
# embedded data size substantially with no visible loss at this scale.
def perp_dist(pt, a, b):
    (x, y), (ax, ay), (bx, by) = pt, a, b
    dx, dy = bx - ax, by - ay
    if dx == 0 and dy == 0:
        return math.hypot(x - ax, y - ay)
    t = ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)
    px, py = ax + t * dx, ay + t * dy
    return math.hypot(x - px, y - py)

def simplify(points, epsilon):
    if len(points) < 3:
        return points
    dmax, idx = 0, 0
    for i in range(1, len(points) - 1):
        d = perp_dist(points[i], points[0], points[-1])
        if d > dmax:
            dmax, idx = d, i
    if dmax > epsilon:
        left = simplify(points[: idx + 1], epsilon)
        right = simplify(points[idx:], epsilon)
        return left[:-1] + right
    return [points[0], points[-1]]

EPSILON = 9.0  # game units (~0.6m) -- well under building-scale detail

def finalize(poly, is_closed, do_simplify=True):
    body = poly[:-1] if is_closed else poly
    simplified = simplify(body, EPSILON) if (do_simplify and len(body) > 3) else body
    return [[round(x), round(y)] for x, y in simplified]

buildings_out = [finalize(poly, True) for poly in buildings_game]
# Roads are NOT simplified: independently simplifying each road polyline can
# drop the exact shared coordinate two roads meet at, breaking the
# intersection graph even though the lines still visually cross. Roads are a
# small fraction of the data anyway, so full precision here is cheap.
roads_out = [finalize(line, False, do_simplify=False) for line in roads_game]

# Drop tiny outbuildings (sheds/garages) -- not worth the vertex budget.
def bbox_radius(poly):
    xs = [p[0] for p in poly]; ys = [p[1] for p in poly]
    return max(max(xs)-min(xs), max(ys)-min(ys)) / 2
buildings_out = [p for p in buildings_out if bbox_radius(p) >= 14]

before_pts = sum(len(p) for p in buildings_game) + sum(len(p) for p in roads_game)
after_pts = sum(len(p) for p in buildings_out) + sum(len(p) for p in roads_out)
print(f"simplified points: {before_pts} -> {after_pts}", file=sys.stderr)

world_w = real_w * SCALE + MARGIN * 2
world_h = real_h * SCALE + MARGIN * 2

data = {
    "worldWidth": round(world_w, 1),
    "worldHeight": round(world_h, 1),
    "buildings": buildings_out,
    "roads": roads_out,
}

with open(OUT_JS, "w") as f:
    f.write("// Auto-generated from OpenStreetMap export data. Source: https://www.openstreetmap.org/export\n")
    f.write("// (c) OpenStreetMap contributors, ODbL 1.0 -- https://www.openstreetmap.org/copyright\n")
    f.write("export const MAP_DATA = ")
    f.write(json.dumps(data, separators=(",", ":")))
    f.write(";\n")

print(f"world size: {world_w:.0f} x {world_h:.0f} game units", file=sys.stderr)
print(f"wrote {OUT_JS}", file=sys.stderr)
