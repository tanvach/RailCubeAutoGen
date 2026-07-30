import { Vec3, manhattan, cross, neg } from './vec';
import {
    PieceType, Inventory, InventoryKey, TrackState, PiecePlacement, Step,
    START_STATE, computePlacement, statesEqual, canCrossPass, inventoryKeyOf, usedInventory,
} from './pieces';
import { OccupancyGrid } from './grid';

export interface GeneratorOptions {
    /** Minimum / maximum number of physical pieces (including the start cube). */
    minPieces: number;
    maxPieces: number;
    /** 0 = flat track, 1 = strongly favor vertical (inner/outer) pieces. */
    elevation: number;
    /** RNG seed for reproducibility. */
    seed: number;
    /** Search budget (node expansions) before giving up this attempt. */
    maxNodes?: number;
}

export interface GeneratedTrack {
    pieces: PiecePlacement[];
    steps: Step[];
    used: Inventory;
}

/** Deterministic RNG (mulberry32). */
const mulberry32 = (seed: number) => {
    let a = seed >>> 0;
    return () => {
        a |= 0; a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
};

// Cross pieces are excluded on purpose: a cross is only meaningful when the
// loop actually re-crosses it via route 2, which forward search can't plan
// for. Placed anyway, it just acts as an over-wide straight and confuses the
// assembly program. Replay/manual programs still support it fully.
const CANDIDATES: PieceType[] = ['straight', 'curveLeft', 'curveRight', 'inner', 'outer'];

/** Max manhattan displacement of any single piece (curves/inner move 3). */
const MAX_STEP_DIST = 3;

// ---------------------------------------------------------------------------
// Exact orientation lower bound.
//
// Only curves (90° yaw about `up`) and inner/outer curves (opposite 90°
// pitches about `right`) change orientation, one step per piece. So any loop
// still needs at least as many pieces as the distance from the current
// (dir, up) to the start frame in the cube's 24-element rotation group under
// those four generators (the word metric on its Cayley graph). The generator
// set is closed under inverses, so one BFS out of the start frame computes
// the whole table. Replaces a hand-set bound that was slightly inadmissible:
// it charged 2 pieces whenever `up` was off, but a single outer curve can fix
// dir and up at once.
// ---------------------------------------------------------------------------

const orientKey = (dir: Vec3, up: Vec3): number =>
    (dir.x + 1) + (dir.y + 1) * 3 + (dir.z + 1) * 9 +
    ((up.x + 1) + (up.y + 1) * 3 + (up.z + 1) * 9) * 27;

const ORIENT_DIST: ReadonlyMap<number, number> = (() => {
    const dist = new Map<number, number>();
    let frontier = [{ dir: START_STATE.dir, up: START_STATE.up }];
    dist.set(orientKey(START_STATE.dir, START_STATE.up), 0);
    for (let d = 1; frontier.length > 0; d++) {
        const next: typeof frontier = [];
        for (const o of frontier) {
            const moves = [
                { dir: cross(o.up, o.dir), up: o.up }, // curveLeft
                { dir: cross(o.dir, o.up), up: o.up }, // curveRight
                { dir: o.up, up: neg(o.dir) },         // inner
                { dir: neg(o.up), up: o.dir },         // outer
            ];
            for (const m of moves) {
                const k = orientKey(m.dir, m.up);
                if (!dist.has(k)) {
                    dist.set(k, d);
                    next.push(m);
                }
            }
        }
        frontier = next;
    }
    return dist;
})();

/** Fewest pieces that could realign (dir, up) with the start frame. */
export const orientationLowerBound = (dir: Vec3, up: Vec3): number =>
    ORIENT_DIST.get(orientKey(dir, up))!;

export class Generator {
    private inventory: Inventory;
    private options: GeneratorOptions;
    private rand: () => number;
    private nodes = 0;

    private grid = new OccupancyGrid();
    private pieces: PiecePlacement[] = [];
    private steps: Step[] = [];

    constructor(inventory: Inventory, options: GeneratorOptions) {
        this.inventory = { ...inventory };
        this.options = options;
        this.rand = mulberry32(options.seed);
    }

    public generate(): GeneratedTrack | null {
        const start = computePlacement('start', START_STATE);
        this.grid.place(start, 0);
        this.pieces.push(start);
        this.steps.push({ kind: 'piece', pieceIndex: 0 });

        const budget = this.options.maxNodes ?? 300_000;
        if (this.solve(start.exit, 1, budget)) {
            return { pieces: this.pieces, steps: this.steps, used: usedInventory(this.pieces) };
        }
        return null;
    }

    private solve(state: TrackState, pieceCount: number, budget: number): boolean {
        if (this.nodes++ > budget) return false;

        // Loop closure?
        if (statesEqual(state, START_STATE)) {
            return pieceCount >= this.options.minPieces;
        }

        // The cell ahead is occupied: only a cross route-2 pass can continue.
        const solidIdx = this.grid.solidAt(state.cell);
        if (solidIdx !== undefined) {
            const piece = this.pieces[solidIdx];
            if (!canCrossPass(piece, state)) return false;
            // Route 2 can only be used once per cross.
            if (this.steps.some((s) => s.kind === 'crossPass' && s.pieceIndex === solidIdx)) return false;
            this.steps.push({ kind: 'crossPass', pieceIndex: solidIdx });
            const next: TrackState = {
                cell: { x: state.cell.x + state.dir.x, y: state.cell.y + state.dir.y, z: state.cell.z + state.dir.z },
                dir: state.dir,
                up: state.up,
            };
            if (this.solve(next, pieceCount, budget)) return true;
            this.steps.pop();
            return false;
        }

        // Pruning: can we still make it home?
        const remaining = this.options.maxPieces - pieceCount;
        if (remaining <= 0) return false;
        const dist = manhattan(state.cell, START_STATE.cell);
        if (dist > remaining * MAX_STEP_DIST) return false;
        if (orientationLowerBound(state.dir, state.up) > remaining) return false;

        // Weighted-random candidate order. When the piece budget gets tight
        // relative to the distance home, switch to homing: prefer pieces whose
        // exit moves toward the start cube (random order rarely wanders back).
        const elev = this.options.elevation;
        const homing = remaining * MAX_STEP_DIST - dist < 15;
        const scored = CANDIDATES
            .filter((t) => {
                const k = inventoryKeyOf(t) as InventoryKey;
                return this.inventory[k] > 0;
            })
            .map((t) => {
                let w = 1.0;
                if (t === 'curveLeft' || t === 'curveRight') w = 1.1 - elev * 0.4;
                else if (t === 'inner' || t === 'outer') w = 0.08 + elev * 2.2;
                const placement = computePlacement(t, state);
                const r = homing
                    ? manhattan(placement.exit.cell, START_STATE.cell) + this.rand() * 0.5
                    : this.rand() / w;
                return { placement, r };
            })
            .sort((a, b) => a.r - b.r);

        for (const { placement } of scored) {
            const t = placement.type;
            if (!this.grid.canPlace(placement)) continue;

            const k = inventoryKeyOf(t) as InventoryKey;
            this.inventory[k]--;
            const idx = this.pieces.length;
            this.grid.place(placement, idx);
            this.pieces.push(placement);
            this.steps.push({ kind: 'piece', pieceIndex: idx });

            if (this.solve(placement.exit, pieceCount + 1, budget)) return true;

            this.steps.pop();
            this.pieces.pop();
            this.grid.remove(placement);
            this.inventory[k]++;
        }

        return false;
    }
}

/**
 * Restart schedule: backtracking runtimes are heavy-tailed, so most seeds
 * close a loop quickly while an unlucky one can burn its whole budget.
 * Many cheap attempts first, escalating the budget only for stubborn
 * settings, is much faster in the median AND more likely to succeed than a
 * few expensive attempts.
 */
const RESTART_SCHEDULE = [
    { attempts: 40, maxNodes: 15_000 },
    { attempts: 20, maxNodes: 60_000 },
    { attempts: 8, maxNodes: 250_000 },
    { attempts: 6, maxNodes: 1_000_000 },
];

/** Try multiple seeds until a track is found. */
export const generateTrack = (
    inventory: Inventory,
    options: Omit<GeneratorOptions, 'seed'> & { seed?: number },
    attempts = 40,
    onProgress?: (attempt: number) => void,
): GeneratedTrack | null => {
    const baseSeed = options.seed ?? Math.floor(Math.random() * 2 ** 31);

    // Explicit maxNodes = fixed-budget mode (tests, benchmarks).
    if (options.maxNodes !== undefined) {
        for (let i = 0; i < attempts; i++) {
            onProgress?.(i);
            const gen = new Generator(inventory, { ...options, seed: baseSeed + i * 7919 });
            const result = gen.generate();
            if (result) return result;
        }
        return null;
    }

    let attempt = 0;
    for (const round of RESTART_SCHEDULE) {
        for (let i = 0; i < round.attempts; i++) {
            onProgress?.(attempt);
            const gen = new Generator(inventory, {
                ...options,
                seed: baseSeed + attempt * 7919,
                maxNodes: round.maxNodes,
            });
            const result = gen.generate();
            if (result) return result;
            attempt++;
        }
    }
    return null;
};
