import { describe, it, expect } from 'vitest';
import {
    generateTrack, orientationLowerBound, elevationWeight, GeneratedTrack,
} from './generator';
import { STARTER_SET, DELUXE_SET, Inventory, statesEqual, START_STATE, computePlacement } from './pieces';
import { OccupancyGrid } from './grid';
import { Vec3, v, cross, neg } from './vec';

/** Re-validate a generated track from scratch: placement legality and closure. */
const validate = (track: GeneratedTrack) => {
    const grid = new OccupancyGrid();
    // Re-place every piece and check legality.
    track.pieces.forEach((p, i) => {
        expect(grid.canPlace(p), `piece ${i} (${p.type}) placement legal`).toBe(true);
        grid.place(p, i);
    });
    // Walk the steps and confirm the chain is continuous and closes.
    let state = START_STATE;
    for (const step of track.steps) {
        const piece = track.pieces[step.pieceIndex];
        if (step.kind === 'piece') {
            expect(statesEqual(piece.entry, state)).toBe(true);
            // Re-derive to confirm stored geometry matches the transform rules.
            const fresh = computePlacement(piece.type, state);
            expect(fresh.exit).toEqual(piece.exit);
            state = piece.exit;
        } else {
            expect(piece.crossingCell).toEqual(state.cell);
            state = {
                cell: {
                    x: state.cell.x + state.dir.x,
                    y: state.cell.y + state.dir.y,
                    z: state.cell.z + state.dir.z,
                },
                dir: state.dir,
                up: state.up,
            };
        }
    }
    expect(statesEqual(state, START_STATE), 'loop closes back into the start cube').toBe(true);
    // Floor constraint.
    for (const p of track.pieces) for (const c of p.cells) expect(c.y).toBeGreaterThanOrEqual(0);
};

const usedWithin = (track: GeneratedTrack, inv: Inventory) => {
    for (const k of Object.keys(inv) as (keyof Inventory)[]) {
        expect(track.used[k], `${k} within inventory`).toBeLessThanOrEqual(inv[k]);
    }
};

describe('orientation lower bound', () => {
    const AXES: Vec3[] = [v(1, 0, 0), v(-1, 0, 0), v(0, 1, 0), v(0, -1, 0), v(0, 0, 1), v(0, 0, -1)];
    const dot = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z;
    const ALL_ORIENTATIONS = AXES.flatMap((dir) =>
        AXES.filter((up) => dot(dir, up) === 0).map((up) => ({ dir, up })));

    it('covers all 24 orientations', () => {
        expect(ALL_ORIENTATIONS).toHaveLength(24);
    });

    it('is zero exactly at the start frame', () => {
        for (const { dir, up } of ALL_ORIENTATIONS) {
            const atHome = statesEqual({ cell: v(0, 0, 0), dir, up }, START_STATE);
            expect(orientationLowerBound(dir, up) === 0).toBe(atHome);
        }
    });

    it('charges 1, not 2, when a single piece can realign both axes', () => {
        // An outer curve entered with dir=+Y, up=-X exits with dir=+X, up=+Y —
        // the start frame. The previous hand-set bound charged 2 here and could
        // prune a legal closing move.
        const entry = { cell: v(-1, 0, 0), dir: v(0, 1, 0), up: v(-1, 0, 0) };
        expect(statesEqual(computePlacement('outer', entry).exit, START_STATE)).toBe(true);
        expect(orientationLowerBound(entry.dir, entry.up)).toBe(1);
    });

    it('matches the known distance distribution (diameter 4)', () => {
        const counts = [0, 0, 0, 0, 0];
        for (const { dir, up } of ALL_ORIENTATIONS) counts[orientationLowerBound(dir, up)]++;
        expect(counts).toEqual([1, 4, 10, 8, 1]);
        // The unique hardest case: heading home but hanging from the ceiling.
        expect(orientationLowerBound(v(1, 0, 0), v(0, -1, 0))).toBe(4);
    });

    it('is an exact word metric: every piece changes it by at most 1', () => {
        for (const { dir, up } of ALL_ORIENTATIONS) {
            const d = orientationLowerBound(dir, up);
            const moves = [
                { dir: cross(up, dir), up },  // curveLeft
                { dir: cross(dir, up), up },  // curveRight
                { dir: up, up: neg(dir) },    // inner
                { dir: neg(up), up: dir },    // outer
            ];
            const after = moves.map((m) => orientationLowerBound(m.dir, m.up));
            for (const a of after) expect(Math.abs(a - d)).toBeLessThanOrEqual(1);
            // Off home, some piece must make progress (BFS parents exist).
            if (d > 0) expect(Math.min(...after)).toBe(d - 1);
        }
    });
});

describe('generator', () => {
    it('generates a valid flat starter-set loop', () => {
        const track = generateTrack(STARTER_SET, {
            minPieces: 10, maxPieces: 20, elevation: 0, seed: 1,
        });
        expect(track).not.toBeNull();
        validate(track!);
        usedWithin(track!, STARTER_SET);
    });

    it('generates valid elevated loops', () => {
        const track = generateTrack(STARTER_SET, {
            minPieces: 12, maxPieces: 28, elevation: 0.8, seed: 2,
        });
        expect(track).not.toBeNull();
        validate(track!);
        usedWithin(track!, STARTER_SET);
        const vertical = track!.pieces.filter((p) => p.type === 'inner' || p.type === 'outer');
        expect(vertical.length).toBeGreaterThan(0);
    });

    it('generates valid deluxe loops across many seeds', () => {
        for (let seed = 10; seed < 16; seed++) {
            const track = generateTrack(DELUXE_SET, {
                minPieces: 14, maxPieces: 40, elevation: 0.5, seed, maxNodes: 150_000,
            }, 15);
            expect(track, `seed ${seed}`).not.toBeNull();
            validate(track!);
            usedWithin(track!, DELUXE_SET);
        }
    });

    it('never places cross pieces by default, even when the inventory has them', () => {
        const track = generateTrack(DELUXE_SET, {
            minPieces: 14, maxPieces: 36, elevation: 0.4, seed: 7,
        }, 20);
        expect(track).not.toBeNull();
        validate(track!);
        expect(track!.pieces.every((p) => p.type !== 'cross')).toBe(true);
        expect(track!.used.cross).toBe(0);
    });

    it('straight crossMode lays crosses as 2-unit straight track', () => {
        const track = generateTrack(DELUXE_SET, {
            minPieces: 14, maxPieces: 30, elevation: 0.3, seed: 300, crossMode: 'straight',
        });
        expect(track).not.toBeNull();
        validate(track!);
        usedWithin(track!, DELUXE_SET);
        expect(track!.used.cross).toBeGreaterThan(0);
    });

    it('crossing crossMode closes a figure-8: every cross re-crossed via route 2', () => {
        for (const seed of [200, 204]) {
            const track = generateTrack(DELUXE_SET, {
                minPieces: 14, maxPieces: 30, elevation: 0.35, seed, crossMode: 'crossing',
            });
            expect(track, `seed ${seed}`).not.toBeNull();
            validate(track!);
            usedWithin(track!, DELUXE_SET);
            const crosses = track!.pieces.filter((p) => p.type === 'cross').length;
            const passes = track!.steps.filter((s) => s.kind === 'crossPass').length;
            expect(crosses).toBeGreaterThan(0);
            expect(passes).toBe(crosses);
        }
    });

    it('crossing crossMode fails fast when the kit has no cross pieces', () => {
        const t0 = performance.now();
        const track = generateTrack(STARTER_SET, {
            minPieces: 10, maxPieces: 20, elevation: 0, seed: 1, crossMode: 'crossing',
        });
        expect(track).toBeNull();
        expect(performance.now() - t0).toBeLessThan(500);
    });

    it('is deterministic for a given seed in crossing mode', () => {
        const opts = { minPieces: 14, maxPieces: 30, elevation: 0.35, seed: 200, crossMode: 'crossing' as const };
        const a = generateTrack(DELUXE_SET, opts);
        const b = generateTrack(DELUXE_SET, opts);
        expect(a).not.toBeNull();
        expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    });

    it('respects a tiny inventory or fails cleanly', () => {
        const tiny: Inventory = { straight: 2, curve: 4, inner: 0, outer: 0, cross: 0 };
        const track = generateTrack(tiny, {
            minPieces: 4, maxPieces: 7, elevation: 0, seed: 3,
        }, 20);
        if (track) {
            validate(track);
            usedWithin(track, tiny);
        }
        // Either outcome is acceptable; must not throw or return invalid data.
    });

    it('is deterministic for a given seed', () => {
        const a = generateTrack(STARTER_SET, { minPieces: 10, maxPieces: 20, elevation: 0.3, seed: 42 });
        const b = generateTrack(STARTER_SET, { minPieces: 10, maxPieces: 20, elevation: 0.3, seed: 42 });
        expect(a).not.toBeNull();
        expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    });

    it('keeps mid elevation flatter than high elevation in style weights', () => {
        // Regression: linear 0.08+2.2e made elev=0.45 prefer verticals over straights.
        expect(elevationWeight('inner', 0.35)).toBeLessThan(elevationWeight('straight', 0.35));
        expect(elevationWeight('inner', 0.65)).toBeGreaterThan(elevationWeight('straight', 0.65));
    });

    it('Wild settings spend more time off the floor than Balanced', () => {
        // Simple-mode starter mappings (see sidebar getState).
        const balElev = Math.round(Math.pow(0.5, 1.35) * 65) / 100;
        const wildElev = Math.round(Math.pow(1, 1.35) * 65) / 100;
        const offFloorFrac = (min: number, max: number, elev: number, seed: number) => {
            const track = generateTrack(STARTER_SET, {
                minPieces: min, maxPieces: max, elevation: elev, seed, maxNodes: 250_000,
            }, 30);
            if (!track) return null;
            const off = track.pieces.filter((p) => p.entry.up.y !== 1).length;
            return off / track.pieces.length;
        };
        let bal = 0, wild = 0, n = 0;
        for (let s = 0; s < 12; s++) {
            const a = offFloorFrac(12, 21, balElev, 400 + s * 17);
            const b = offFloorFrac(19, 32, wildElev, 400 + s * 17);
            if (a == null || b == null) continue;
            bal += a;
            wild += b;
            n++;
        }
        expect(n).toBeGreaterThan(6);
        expect(wild / n).toBeGreaterThan(bal / n);
    });
});
