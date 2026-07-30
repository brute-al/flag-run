// Builds a symmetric "duel" map by mirroring an existing map dataset (see
// mapData.js: {worldWidth, worldHeight, buildings, roads}) about its own
// southern edge and stacking the mirrored copy below the original. The
// result is exactly twice the height. Arena's own base placement is already
// purely a function of width/height (playerBase near the top, enemyBase the
// same fixed distance from the bottom -- see arena.js), so handing it this
// doubled dataset automatically puts the AI's base at the exact mirror image
// of the player's, with matching buildings/roads on both sides -- no changes
// needed in Arena itself.
//
// Buildings ship as flat [x0,y0,x1,y1,...] arrays; roads ship as arrays of
// [x,y] point-pairs (see mapData.js's header comment). Only y is mirrored --
// x, and therefore the road network's left/right structure, is untouched.
import { buildRoadGraph, largestComponentMaxYPoint } from "./pathfinding.js";

export function mirrorMapData(mapData) {
  const { worldWidth, worldHeight, buildings, roads } = mapData;
  const mirrorY = (y) => 2 * worldHeight - y;

  const mirroredBuildings = buildings.map((flat) => {
    const out = new Array(flat.length);
    for (let i = 0; i < flat.length; i += 2) {
      out[i] = flat[i];
      out[i + 1] = mirrorY(flat[i + 1]);
    }
    return out;
  });

  const mirroredRoads = roads.map((road) => road.map(([x, y]) => [x, mirrorY(y)]));

  // Mirroring reflects every point about y = worldHeight, so the two halves
  // only share a physical road connection if some point in the original
  // network happens to sit exactly on that line -- not guaranteed (the
  // source map's roads were laid out to serve its own single pair of bases,
  // not to reach its own literal southern edge). Rather than hope for a
  // lucky coincidence, explicitly bridge the two halves with one short
  // connector road: anchored at the real road network's own southernmost
  // reachable point (the largest connected component's max-y node -- the
  // natural "end of the line" of the original map), running straight down
  // to that same point's mirror image in the new southern half. This
  // guarantees the AI can always path from its base to the player's,
  // whatever shape the source map happens to be.
  const anchor = largestComponentMaxYPoint(roads);
  const bridge = anchor ? [[anchor[0], anchor[1]], [anchor[0], mirrorY(anchor[1])]] : null;

  return {
    worldWidth,
    worldHeight: worldHeight * 2,
    buildings: [...buildings, ...mirroredBuildings],
    roads: bridge ? [...roads, ...mirroredRoads, bridge] : [...roads, ...mirroredRoads],
  };
}

// Re-exported so callers/tests that already need a road graph for the
// mirrored data (e.g. to confirm the bridge actually connects both halves)
// don't need a second import just for buildRoadGraph.
export { buildRoadGraph };
