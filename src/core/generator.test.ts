import { describe, it, expect } from 'vitest';
import { generateTrack, GeneratedTrack } from './generator';
import { STARTER_SET, DELUXE_SET, Inventory, statesEqual, START_STATE, computePlacement } from './pieces';
import { OccupancyGrid } from './grid';

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

    it('never places cross pieces even when the inventory has them', () => {
        const track = generateTrack(DELUXE_SET, {
            minPieces: 14, maxPieces: 36, elevation: 0.4, seed: 7,
        }, 20);
        expect(track).not.toBeNull();
        validate(track!);
        expect(track!.pieces.every((p) => p.type !== 'cross')).toBe(true);
        expect(track!.used.cross).toBe(0);
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
});
