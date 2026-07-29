import { Vec3, v, add, neg, cross, eq, scale } from './vec';

/**
 * Rail Cube piece model, derived from the physical set (SunSmile レールキューブ).
 *
 * The train is magnetic and can ride rails facing up, down, or sideways, so the
 * track state is a cell position plus TWO orthogonal unit axis vectors:
 *   dir - direction of travel
 *   up  - the rail-face normal (points from the rail surface toward the train)
 *
 * Piece types (colors from the real set):
 *   start      white  1x1x1  straight-through, powers the loop
 *   straight   yellow 1x1x1
 *   curveLeft  blue face up   2x2x1 quarter-annulus, in-plane 90° turn
 *   curveRight green face up  (same physical part flipped over)
 *   inner      orange 2x2x1  concave 90° turn out of the rail plane
 *   outer      red    1x1x1  convex 90° turn around a cube edge
 *   cross      purple 2x1x1  two crossing rails; traversed twice per loop
 */
export type PieceType =
    | 'start'
    | 'straight'
    | 'curveLeft'
    | 'curveRight'
    | 'inner'
    | 'outer'
    | 'cross';

/** Physical inventory pools. curveLeft/curveRight share the same physical part. */
export type InventoryKey = 'straight' | 'curve' | 'inner' | 'outer' | 'cross';

export const inventoryKeyOf = (t: PieceType): InventoryKey | null => {
    switch (t) {
        case 'start': return null; // always exactly one
        case 'straight': return 'straight';
        case 'curveLeft':
        case 'curveRight': return 'curve';
        case 'inner': return 'inner';
        case 'outer': return 'outer';
        case 'cross': return 'cross';
    }
};

export type Inventory = Record<InventoryKey, number>;

export const STARTER_SET: Inventory = { straight: 15, curve: 8, inner: 4, outer: 4, cross: 0 };
export const DELUXE_SET: Inventory = { straight: 31, curve: 16, inner: 8, outer: 8, cross: 2 };

/** Count physical pieces used by a set of placements. */
export const usedInventory = (pieces: { type: PieceType }[]): Inventory => {
    const used: Inventory = { straight: 0, curve: 0, inner: 0, outer: 0, cross: 0 };
    for (const p of pieces) {
        const k = inventoryKeyOf(p.type);
        if (k) used[k]++;
    }
    return used;
};

export interface TrackState {
    cell: Vec3;
    dir: Vec3;
    up: Vec3;
}

export interface PiecePlacement {
    type: PieceType;
    /** Entry state. entry.cell is the first cell of the piece. */
    entry: TrackState;
    /** Solid cells occupied by the piece body. */
    cells: Vec3[];
    /**
     * Cells the train sweeps through while on this piece. They must not contain
     * another piece's body, but MAY be shared with other pieces' swing cells
     * (e.g. a narrow slot with rails on both walls).
     */
    swing: Vec3[];
    /** State entering the next piece. exit.cell is the next piece's entry cell. */
    exit: TrackState;
    /** For cross pieces: the cell where the perpendicular route 2 passes. */
    crossingCell?: Vec3;
}

export const START_STATE: TrackState = {
    cell: v(0, 0, 0),
    dir: v(1, 0, 0),
    up: v(0, 1, 0),
};

export const statesEqual = (a: TrackState, b: TrackState): boolean =>
    eq(a.cell, b.cell) && eq(a.dir, b.dir) && eq(a.up, b.up);

/** Compute the placement of a piece entered at the given state. */
export const computePlacement = (type: PieceType, entry: TrackState): PiecePlacement => {
    const { cell: e, dir: d, up: n } = entry;

    switch (type) {
        case 'start':
        case 'straight': {
            return {
                type, entry,
                cells: [e],
                swing: [add(e, n)],
                exit: { cell: add(e, d), dir: d, up: n },
            };
        }

        case 'curveLeft':
        case 'curveRight': {
            // 2x2 quarter-annulus in the rail plane. Left = up x dir.
            const s = type === 'curveLeft' ? cross(n, d) : cross(d, n);
            const cells = [e, add(e, d), add(e, s), add(add(e, d), s)];
            return {
                type, entry,
                cells,
                swing: cells.map((c) => add(c, n)),
                exit: { cell: add(add(e, d), scale(s, 2)), dir: s, up: n },
            };
        }

        case 'inner': {
            // 2x2 concave wedge in the dir/up plane. The carve (where the train
            // swings) is inside the piece body, so no external swing cells.
            const cells = [e, add(e, d), add(e, n), add(add(e, d), n)];
            return {
                type, entry,
                cells,
                swing: [],
                exit: { cell: add(add(e, d), scale(n, 2)), dir: n, up: neg(d) },
            };
        }

        case 'outer': {
            // 1x1 cube; rail wraps convexly around the edge between the up-face
            // and the dir-face. Train sweeps the corner region outside the cube.
            return {
                type, entry,
                cells: [e],
                swing: [add(e, n), add(e, d), add(add(e, d), n)],
                exit: { cell: add(e, neg(n)), dir: neg(n), up: d },
            };
        }

        case 'cross': {
            // 2 cells long; route 1 runs straight through the long axis.
            // Route 2 crosses perpendicular at the far cell (marked "2" on the toy).
            const far = add(e, d);
            return {
                type, entry,
                cells: [e, far],
                swing: [add(e, n), add(far, n)],
                exit: { cell: add(e, scale(d, 2)), dir: d, up: n },
                crossingCell: far,
            };
        }
    }
};

/**
 * Can a train traveling in state `state` pass through an already-placed cross
 * piece via its perpendicular route 2?
 */
export const canCrossPass = (piece: PiecePlacement, state: TrackState): boolean => {
    if (piece.type !== 'cross' || !piece.crossingCell) return false;
    if (!eq(piece.crossingCell, state.cell)) return false;
    if (!eq(piece.entry.up, state.up)) return false;
    // Must be perpendicular to the cross's long axis (and in the rail plane).
    const d = piece.entry.dir;
    const dot = d.x * state.dir.x + d.y * state.dir.y + d.z * state.dir.z;
    return dot === 0;
};

/** A traversal step: either place a new piece, or pass through a cross's route 2. */
export type Step =
    | { kind: 'piece'; pieceIndex: number }
    | { kind: 'crossPass'; pieceIndex: number };

export interface TrackResult {
    pieces: PiecePlacement[];
    steps: Step[];
}
