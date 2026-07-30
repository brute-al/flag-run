// Shared road-network graph + routing. The connectivity check in
// test/sim.mjs (section 5) originally built this same kind of graph
// inline just to prove the two bases are reachable from each other; this
// module factors that out into something reusable so the AI opponent (see
// aiDriver.js) can actually navigate the streets, not just prove they
// connect.
//
// Nodes are keyed by a coordinate snapped to a small grid so that
// near-duplicate floating point road endpoints (e.g. two segments meant to
// meet at the same intersection, off by a fraction of a unit) collapse into
// one node instead of silently failing to connect.
function key(x, y) {
  return `${Math.round(x / 2)},${Math.round(y / 2)}`;
}

// Builds an adjacency graph from a `roads` array (see mapData.js: each road
// is a polyline of [x, y] point-pairs; consecutive points in a polyline are
// treated as a drivable edge). Returns { adj, keyToPoint } where `adj` maps
// a node key to a Set of neighboring node keys, and `keyToPoint` maps a node
// key back to its real-world [x, y] coordinate.
export function buildRoadGraph(roads) {
  const adj = new Map();
  const keyToPoint = new Map();
  const addEdge = (x1, y1, x2, y2) => {
    const k1 = key(x1, y1);
    const k2 = key(x2, y2);
    if (!adj.has(k1)) adj.set(k1, new Set());
    if (!adj.has(k2)) adj.set(k2, new Set());
    adj.get(k1).add(k2);
    adj.get(k2).add(k1);
    keyToPoint.set(k1, [x1, y1]);
    keyToPoint.set(k2, [x2, y2]);
  };
  for (const road of roads) {
    for (let i = 0; i < road.length - 1; i++) {
      const [x1, y1] = road[i];
      const [x2, y2] = road[i + 1];
      addEdge(x1, y1, x2, y2);
    }
  }
  return { adj, keyToPoint };
}

// Nearest graph node to an arbitrary world position (used to snap a
// vehicle's actual position, or a target like a flag, onto the road graph).
export function nearestNode(graph, x, y) {
  let best = null;
  let bestD = Infinity;
  for (const [k, [nx, ny]] of graph.keyToPoint) {
    const d = Math.hypot(nx - x, ny - y);
    if (d < bestD) {
      bestD = d;
      best = k;
    }
  }
  return best;
}

// Finds the largest connected component in a road graph and, within it, the
// node with the greatest y coordinate. Used by mirrorMap.js to find a
// sensible "southernmost point of the real network" anchor for bridging a
// mirrored map's two halves -- deliberately robust to whatever shape the
// source data happens to be, rather than assuming any particular road
// reaches the map's literal edge.
export function largestComponentMaxYPoint(roads) {
  const { adj, keyToPoint } = buildRoadGraph(roads);
  const seen = new Set();
  let best = null; // { size, maxYPoint }
  for (const startKey of adj.keys()) {
    if (seen.has(startKey)) continue;
    seen.add(startKey);
    const queue = [startKey];
    const component = [startKey];
    while (queue.length) {
      const cur = queue.shift();
      for (const next of adj.get(cur)) {
        if (!seen.has(next)) {
          seen.add(next);
          component.push(next);
          queue.push(next);
        }
      }
    }
    if (!best || component.length > best.size) {
      let maxYPoint = null;
      for (const ck of component) {
        const p = keyToPoint.get(ck);
        if (!maxYPoint || p[1] > maxYPoint[1]) maxYPoint = p;
      }
      best = { size: component.length, maxYPoint };
    }
  }
  return best ? best.maxYPoint : null;
}

// BFS shortest path by hop count (roads are unweighted here -- good enough
// for "follow the streets toward the target", not a true shortest-distance
// route). Returns an array of {x, y} waypoints from (fromX, fromY) to
// (toX, toY), always ending at the exact destination (not just the nearest
// road node to it). Falls back to a direct two-point line if there's no
// road data at all, or -- which shouldn't happen on a connected map, see
// the road-connectivity test -- no path is found, so callers never have to
// special-case a null/empty result.
export function findRoute(roads, fromX, fromY, toX, toY) {
  const graph = buildRoadGraph(roads);
  const startKey = nearestNode(graph, fromX, fromY);
  const endKey = nearestNode(graph, toX, toY);
  const directFallback = [
    { x: fromX, y: fromY },
    { x: toX, y: toY },
  ];
  if (!startKey || !endKey) return directFallback;

  if (startKey === endKey) {
    return [{ x: fromX, y: fromY }, { x: toX, y: toY }];
  }

  const visited = new Set([startKey]);
  const prev = new Map();
  const queue = [startKey];
  let found = false;
  while (queue.length && !found) {
    const cur = queue.shift();
    for (const next of graph.adj.get(cur) || []) {
      if (visited.has(next)) continue;
      visited.add(next);
      prev.set(next, cur);
      if (next === endKey) {
        found = true;
        break;
      }
      queue.push(next);
    }
  }
  if (!found) return directFallback;

  const pathKeys = [endKey];
  let cur = endKey;
  while (cur !== startKey) {
    cur = prev.get(cur);
    pathKeys.push(cur);
  }
  pathKeys.reverse();

  const waypoints = pathKeys.map((k) => {
    const [x, y] = graph.keyToPoint.get(k);
    return { x, y };
  });
  // The last graph node may be tens of units from the true destination (a
  // flag/base isn't necessarily sitting exactly on a road point) -- append
  // the real target so whoever follows this route actually arrives.
  waypoints.push({ x: toX, y: toY });
  return waypoints;
}
