import { Vec3, manhattan, cross, neg, add } from './vec';
import {
    PieceType, Inventory, InventoryKey, TrackState, PiecePlacement, Step,
    START_STATE, computePlacement, statesEqual, canCrossPass, inventoryKeyOf, usedInventory,
} from './pieces';
import { OccupancyGrid } from './grid';

/**
 * How the generator may use purple cross pieces:
 *   off      - never placed (default; matches the pre-cross behavior)
 *   straight - placed as a 2-unit straight (route 1). If the loop happens to
 *              run back into the marked "2" cell perpendicular, the free
 *              route-2 pass is still taken opportunistically.
 *   crossing - a placed cross MUST be re-crossed via route 2 before the loop
 *              closes (figure-8 style), and at least one cross must be used.
 */
export type CrossMode = 'off' | 'straight' | 'crossing';

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
    /** Cross piece policy; 'off' when omitted. */
    crossMode?: CrossMode;
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

// Cross pieces join the candidate list only when a crossMode asks for them:
// forward search can't *plan* a route-2 re-cross, but with 'crossing' mode the
// closure requirement plus waypoint-aware pruning/homing below make the search
// actively steer the tail of the loop back through the marked "2" cell.
const BASE_CANDIDATES: PieceType[] = ['straight', 'curveLeft', 'curveRight', 'inner', 'outer'];
const CROSS_CANDIDATES: PieceType[] = [...BASE_CANDIDATES, 'cross'];

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

/** Style weight for a candidate at the given elevation slider position. */
export const elevationWeight = (type: PieceType, elev: number): number => {
    const e = Math.min(1, Math.max(0, elev));
    // Quadratic vertical ramp: mid settings stay mostly flat; high elev climbs.
    // (A linear 0.08+2.2e made Balanced ≈ Wild on the starter kit's 8 verticals.)
    if (type === 'curveLeft' || type === 'curveRight') return 1.2 - e * 0.7;
    if (type === 'inner' || type === 'outer') return 0.06 + e * e * 2.8;
    if (type === 'straight') return 1.15 - e * 0.55;
    if (type === 'cross') return 0.9 - e * 0.45; // rides in-plane, like a long straight
    return 1;
};

export class Generator {
    private inventory: Inventory;
    private options: GeneratorOptions;
    private crossMode: CrossMode;
    private rand: () => number;
    private nodes = 0;

    private grid = new OccupancyGrid();
    private pieces: PiecePlacement[] = [];
    private steps: Step[] = [];
    /** Placed crosses whose route 2 hasn't been used yet (pieceIndex). */
    private pendingCrosses = new Set<number>();
    private crossesPlaced = 0;

    constructor(inventory: Inventory, options: GeneratorOptions) {
        this.inventory = { ...inventory };
        this.options = options;
        this.crossMode = options.crossMode ?? 'off';
        this.rand = mulberry32(options.seed);
    }

    public generate(): GeneratedTrack | null {
        // A figure-8 is impossible without a cross piece on hand.
        if (this.crossMode === 'crossing' && this.inventory.cross <= 0) return null;

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
            if (pieceCount < this.options.minPieces) return false;
            // Crossing mode: every placed cross must have been re-crossed via
            // route 2, and the loop must contain at least one cross.
            if (this.crossMode === 'crossing') {
                return this.crossesPlaced > 0 && this.pendingCrosses.size === 0;
            }
            return true;
        }

        // The cell ahead is occupied: only a cross route-2 pass can continue.
        const solidIdx = this.grid.solidAt(state.cell);
        if (solidIdx !== undefined) {
            const piece = this.pieces[solidIdx];
            if (!canCrossPass(piece, state)) return false;
            // Route 2 can only be used once per cross.
            if (!this.pendingCrosses.has(solidIdx)) return false;
            this.pendingCrosses.delete(solidIdx);
            this.steps.push({ kind: 'crossPass', pieceIndex: solidIdx });
            const next: TrackState = {
                cell: { x: state.cell.x + state.dir.x, y: state.cell.y + state.dir.y, z: state.cell.z + state.dir.z },
                dir: state.dir,
                up: state.up,
            };
            if (this.solve(next, pieceCount, budget)) return true;
            this.steps.pop();
            this.pendingCrosses.add(solidIdx);
            return false;
        }

        // Pruning: can we still make it home? In crossing mode the path must
        // also detour through every pending route-2 cell, so the bound is the
        // longest state -> crossing cell -> home leg. Each cross pass moves the
        // train one cell without spending a piece, so grant that much slack
        // (pending passes + crosses still in inventory) to stay admissible.
        const remaining = this.options.maxPieces - pieceCount;
        if (remaining <= 0) return false;
        let need = manhattan(state.cell, START_STATE.cell);
        if (this.crossMode === 'crossing') {
            for (const idx of this.pendingCrosses) {
                const c = this.pieces[idx].crossingCell!;
                const viaCross = manhattan(state.cell, c) + manhattan(c, START_STATE.cell);
                if (viaCross > need) need = viaCross;
            }
        }
        const slack = this.crossMode === 'off' ? 0 : this.pendingCrosses.size + this.inventory.cross;
        if (need > remaining * MAX_STEP_DIST + slack) return false;
        if (orientationLowerBound(state.dir, state.up) > remaining) return false;

        // Weighted-random candidate order. When the piece budget gets tight
        // relative to the distance still owed, switch to homing: prefer pieces
        // whose exit moves toward the goal (random order rarely wanders back).
        // With a route-2 pass still owed, the goal is the nearest pending
        // crossing cell, not the start cube.
        const elev = this.options.elevation;
        const onFloor = state.up.y === 1;
        // A pending route-2 pass is a rare event to stumble into, so start
        // steering toward it earlier than plain homing would.
        const owesCross = this.crossMode === 'crossing' && this.pendingCrosses.size > 0;
        const homing = remaining * MAX_STEP_DIST + slack - need < (owesCross ? 25 : 15);
        let target = START_STATE.cell;
        let pendingCell: Vec3 | null = null;
        if (owesCross) {
            // Route 2 must be entered perpendicular to the cross, so the real
            // waypoints are the two free approach cells beside the "2" cell —
            // homing on the (solid) crossing cell itself steers the path into
            // the cross's long axis, which can never connect.
            let best = Infinity;
            for (const idx of this.pendingCrosses) {
                const p = this.pieces[idx];
                const c = p.crossingCell!;
                const s = cross(p.entry.dir, p.entry.up);
                for (const a of [add(c, s), add(c, neg(s))]) {
                    const d = manhattan(state.cell, a);
                    if (d < best) { best = d; pendingCell = a; }
                }
            }
            if (homing) target = pendingCell!;
        }
        const candidates = this.crossMode === 'off' ? BASE_CANDIDATES : CROSS_CANDIDATES;
        const scored = candidates
            .filter((t) => {
                const k = inventoryKeyOf(t) as InventoryKey;
                return this.inventory[k] > 0;
            })
            .map((t) => {
                let w = elevationWeight(t, elev);
                // Crossing mode wants exactly-one cross woven in: push the
                // first placement, damp a second while route 2 is still owed
                // (every extra pending cross multiplies the closure burden).
                if (t === 'cross' && this.crossMode === 'crossing') {
                    w *= this.pendingCrosses.size === 0 ? 1.6 : 0.25;
                }
                const placement = computePlacement(t, state);
                // Persistence: once off the floor, prefer staying off it. Raw
                // vertical-piece weight alone burns inners/outers on short hops
                // then pads the rest of a long Wild track on the floor.
                if (elev > 0.2 && !homing) {
                    const exitOnFloor = placement.exit.up.y === 1;
                    if (onFloor && !exitOnFloor) w *= 1 + elev;
                    else if (!onFloor && !exitOnFloor) w *= 1 + elev * 1.8;
                    else if (!onFloor && exitOnFloor) w *= Math.max(0.2, 1 - elev * 0.65);
                }
                // Gravity toward the owed route-2 cell: bias the wander to
                // orbit back across the cross instead of drifting away.
                if (pendingCell && !homing) {
                    const before = manhattan(state.cell, pendingCell);
                    const after = manhattan(placement.exit.cell, pendingCell);
                    if (after < before) w *= 1.25;
                    else if (after > before) w *= 0.8;
                }
                const r = homing
                    ? manhattan(placement.exit.cell, target) + this.rand() * 0.5
                    : this.rand() / Math.max(w, 0.05);
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
            if (t === 'cross') {
                this.pendingCrosses.add(idx);
                this.crossesPlaced++;
            }

            if (this.solve(placement.exit, pieceCount + 1, budget)) return true;

            if (t === 'cross') {
                this.pendingCrosses.delete(idx);
                this.crossesPlaced--;
            }
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

// Figure-8 closure is a rare event per attempt, and when a seed does close it
// usually closes fast — so crossing mode leans even harder on cheap restarts
// (more seeds) rather than deeper searches.
const CROSSING_RESTART_SCHEDULE = [
    { attempts: 80, maxNodes: 25_000 },
    { attempts: 40, maxNodes: 100_000 },
    { attempts: 10, maxNodes: 400_000 },
    { attempts: 6, maxNodes: 1_500_000 },
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

    const schedule = options.crossMode === 'crossing' ? CROSSING_RESTART_SCHEDULE : RESTART_SCHEDULE;

    let attempt = 0;
    for (const round of schedule) {
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
