import { PiecePlacement, Step, inventoryKeyOf } from './pieces';

/**
 * Aesthetic score for a generated track, used by the worker's "interesting"
 * mode to pick the best of many candidates. The ingredients mirror what makes
 * the printed manual's showcase layouts read as interesting:
 *
 *   - compact, interlocked footprints rather than sprawling rings
 *   - track passing over/under itself (bridges, tunnels)
 *   - several height levels, and riding walls or ceilings
 *   - a varied piece rhythm instead of long straight drags
 *   - figure-8 crossings
 *
 * Scores are only compared between candidates generated with the SAME
 * settings, so the weights matter more than absolute values.
 */
export interface ScoreBreakdown {
    compactness: number;
    overpass: number;
    levels: number;
    ride: number;
    variety: number;
    crossings: number;
    rhythm: number;
    total: number;
}

export interface ScorableTrack {
    pieces: PiecePlacement[];
    steps: Step[];
}

export const scoreTrack = (track: ScorableTrack): ScoreBreakdown => {
    const cells = track.pieces.flatMap((p) => p.cells);
    const n = track.pieces.length;

    // Bounding box.
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (const c of cells) {
        if (c.x < minX) minX = c.x;
        if (c.x > maxX) maxX = c.x;
        if (c.y < minY) minY = c.y;
        if (c.y > maxY) maxY = c.y;
        if (c.z < minZ) minZ = c.z;
        if (c.z > maxZ) maxZ = c.z;
    }
    const dx = maxX - minX + 1, dy = maxY - minY + 1, dz = maxZ - minZ + 1;

    // How much of the footprint the track actually fills. A sprawling ring
    // encloses a lot of empty floor; the manual's slotted/woven layouts pack
    // their bounding box tightly.
    const compactness = cells.length / (dx * dy * dz);

    // Columns (x,z) whose solid cells sit at 2+ different heights: the track
    // passes over itself there (bridge / tunnel look).
    const colLevels = new Map<number, Set<number>>();
    for (const c of cells) {
        const key = (c.x + 512) * 1024 + (c.z + 512);
        let set = colLevels.get(key);
        if (!set) colLevels.set(key, (set = new Set()));
        set.add(c.y);
    }
    let overpassCols = 0;
    for (const set of colLevels.values()) if (set.size >= 2) overpassCols++;
    const overpass = overpassCols / n;

    // Distinct solid heights (0 for a flat track).
    const levels = new Set(cells.map((c) => c.y)).size - 1;

    // Fraction of pieces ridden with the rail facing sideways or down.
    const offUp = track.pieces.filter((p) => p.entry.up.y !== 1).length;
    const ride = offUp / n;

    // Normalized entropy of the physical piece mix.
    const counts = new Map<string, number>();
    for (const p of track.pieces) {
        const k = inventoryKeyOf(p.type);
        if (k) counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    let entropy = 0;
    const physical = n - 1; // exclude the start cube
    for (const c of counts.values()) {
        const f = c / physical;
        entropy -= f * Math.log(f);
    }
    const variety = counts.size > 1 ? entropy / Math.log(5) : 0;

    // Route-2 figure-8 passes.
    const crossings = track.steps.filter((s) => s.kind === 'crossPass').length;

    // Longest run of consecutive straights; runs past 3 read as filler.
    let run = 0, worstRun = 0;
    for (const s of track.steps) {
        if (s.kind === 'piece' && track.pieces[s.pieceIndex].type === 'straight') {
            run++;
            if (run > worstRun) worstRun = run;
        } else {
            run = 0;
        }
    }
    const rhythm = Math.max(0, worstRun - 3);

    const total =
        2.2 * compactness +
        3.0 * Math.min(overpass, 0.6) +
        0.5 * Math.min(levels, 3) +
        1.6 * ride +
        1.0 * variety +
        1.0 * Math.min(crossings, 2) -
        0.18 * rhythm;

    return { compactness, overpass, levels, ride, variety, crossings, rhythm, total };
};
