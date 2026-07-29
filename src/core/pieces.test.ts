import { describe, it, expect } from 'vitest';
import { v } from './vec';
import { computePlacement, START_STATE, STARTER_SET, PieceType } from './pieces';
import { replayProgram } from './replay';

describe('piece transforms', () => {
    it('straight moves one cell forward', () => {
        const p = computePlacement('straight', START_STATE);
        expect(p.cells).toEqual([v(0, 0, 0)]);
        expect(p.exit).toEqual({ cell: v(1, 0, 0), dir: v(1, 0, 0), up: v(0, 1, 0) });
        expect(p.swing).toEqual([v(0, 1, 0)]);
    });

    it('curveLeft occupies 2x2 and exits perpendicular', () => {
        const p = computePlacement('curveLeft', START_STATE);
        // Heading +X with up +Y, left is -Z.
        expect(p.cells).toHaveLength(4);
        expect(p.cells).toContainEqual(v(0, 0, 0));
        expect(p.cells).toContainEqual(v(1, 0, 0));
        expect(p.cells).toContainEqual(v(0, 0, -1));
        expect(p.cells).toContainEqual(v(1, 0, -1));
        expect(p.exit).toEqual({ cell: v(1, 0, -2), dir: v(0, 0, -1), up: v(0, 1, 0) });
    });

    it('curveRight mirrors curveLeft', () => {
        const p = computePlacement('curveRight', START_STATE);
        expect(p.exit).toEqual({ cell: v(1, 0, 2), dir: v(0, 0, 1), up: v(0, 1, 0) });
    });

    it('inner turns into the rail plane (climb)', () => {
        const p = computePlacement('inner', START_STATE);
        expect(p.cells).toHaveLength(4);
        expect(p.cells).toContainEqual(v(0, 0, 0));
        expect(p.cells).toContainEqual(v(1, 0, 0));
        expect(p.cells).toContainEqual(v(0, 1, 0));
        expect(p.cells).toContainEqual(v(1, 1, 0));
        // Exit: heading up, rail now facing backwards.
        expect(p.exit).toEqual({ cell: v(1, 2, 0), dir: v(0, 1, 0), up: v(-1, 0, 0) });
    });

    it('outer wraps convexly around the edge (descend)', () => {
        const p = computePlacement('outer', START_STATE);
        expect(p.cells).toEqual([v(0, 0, 0)]);
        expect(p.exit).toEqual({ cell: v(0, -1, 0), dir: v(0, -1, 0), up: v(1, 0, 0) });
    });

    it('inner then continuing straight keeps rail on the same wall plane', () => {
        const inner = computePlacement('inner', START_STATE);
        const wall = computePlacement('straight', inner.exit);
        expect(wall.cells).toEqual([v(1, 2, 0)]);
        expect(wall.swing).toEqual([v(0, 2, 0)]); // train hangs on the -X side
        expect(wall.exit.dir).toEqual(v(0, 1, 0));
    });

    it('four inners make a vertical loop transform-wise', () => {
        let state = START_STATE;
        for (let i = 0; i < 4; i++) state = computePlacement('inner', state).exit;
        expect(state.dir).toEqual(START_STATE.dir);
        expect(state.up).toEqual(START_STATE.up);
    });

    it('four outers make a vertical loop transform-wise', () => {
        let state = START_STATE;
        for (let i = 0; i < 4; i++) state = computePlacement('outer', state).exit;
        expect(state.dir).toEqual(START_STATE.dir);
        expect(state.up).toEqual(START_STATE.up);
    });
});

// Ground-truth programs transcribed from the printed manual.
import { MANUAL_EXAMPLE_1, MANUAL_EXAMPLE_2 } from './examples';

const Y = 'straight' as PieceType;
const B = 'curveLeft' as PieceType;   // 青は左カーブ
const G = 'curveRight' as PieceType;  // 緑は右カーブ

describe('manual ground-truth programs', () => {
    it('example 1 (slotted frame) forms a closed loop', () => {
        const r = replayProgram(MANUAL_EXAMPLE_1);
        expect(r.error).toBeUndefined();
        expect(r.closed).toBe(true);
        expect(r.pieces).toHaveLength(20);
    });

    it('example 1 uses exactly the starter set inner curves and straights', () => {
        const counts = MANUAL_EXAMPLE_1.reduce<Record<string, number>>((acc, t) => {
            acc[t] = (acc[t] ?? 0) + 1;
            return acc;
        }, {});
        expect(counts['straight']).toBe(STARTER_SET.straight);
        expect(counts['inner']).toBe(STARTER_SET.inner);
    });

    it('example 2 (S-course) forms a closed loop', () => {
        const r = replayProgram(MANUAL_EXAMPLE_2);
        expect(r.error).toBeUndefined();
        expect(r.closed).toBe(true);
        // 6 left + 2 right = net 360 degrees, all 8 starter curves used.
        expect(MANUAL_EXAMPLE_2.filter((t) => t === B || t === G)).toHaveLength(STARTER_SET.curve);
    });
});

describe('cross piece', () => {
    it('figure-eight through a cross closes', () => {
        const r = replayProgram([
            'start', 'cross', Y, G, G, G, Y, 'crossPass', Y, B, Y, B, B,
        ]);
        expect(r.error).toBeUndefined();
        expect(r.closed).toBe(true);
    });

    it('cross pass requires perpendicular approach', () => {
        // Going straight into the crossing cell along the long axis is just route 1;
        // approaching route 2 parallel must fail.
        const r = replayProgram(['start', 'cross', 'crossPass']);
        expect(r.closed).toBe(false);
        expect(r.error).toContain('no cross');
    });
});

describe('physical constraints', () => {
    it('rejects going below the floor', () => {
        // outer at ground level dives below y=0.
        const r = replayProgram(['start', 'outer', Y]);
        expect(r.error).toBeDefined();
    });

    it('rejects colliding with placed pieces', () => {
        // Tight left turns that immediately re-enter occupied space.
        const r = replayProgram(['start', B, B, B, B]);
        expect(r.error).toBeDefined();
    });

    it('rejects a solid placed in another piece swing cell', async () => {
        const { OccupancyGrid } = await import('./grid');
        const grid = new OccupancyGrid();
        const start = computePlacement('start', START_STATE);
        grid.place(start, 0);
        // A cube directly above the start cube would block the train.
        const blocker = computePlacement('straight', {
            cell: v(0, 1, 0), dir: v(0, 0, 1), up: v(0, 1, 0),
        });
        expect(grid.canPlace(blocker)).toBe(false);
        // Two pieces may share the same swing cell (rails facing each other).
        const facing = computePlacement('straight', {
            cell: v(0, 2, 0), dir: v(1, 0, 0), up: v(0, -1, 0),
        });
        expect(grid.canPlace(facing)).toBe(true);
    });
});
