import { describe, it, expect } from 'vitest';
import { scoreTrack } from './score';
import { replayProgram } from './replay';
import { generateTrack } from './generator';
import { DELUXE_SET, PieceType } from './pieces';
import { MANUAL_EXAMPLE_1 } from './examples';

/** Replay a program and assert it closes before scoring it. */
const replayClosed = (program: (PieceType | 'crossPass')[]) => {
    const r = replayProgram(program);
    expect(r.closed, 'test program closes').toBe(true);
    return { pieces: r.pieces, steps: r.steps };
};

// Smallest flat ring: a plain 4-curve oval with filler straights.
const PLAIN_OVAL: (PieceType | 'crossPass')[] = [
    'start', 'straight', 'straight', 'curveLeft', 'curveLeft',
    'straight', 'straight', 'straight', 'curveLeft', 'curveLeft',
];

describe('scoreTrack', () => {
    it('prefers the manual slotted frame over a plain oval', () => {
        // The manual's flat slotted frame interlocks around a slot — visibly
        // more interesting than a bare ring, and the score should agree.
        const frame = scoreTrack(replayClosed(MANUAL_EXAMPLE_1));
        const oval = scoreTrack(replayClosed(PLAIN_OVAL));
        expect(frame.total).toBeGreaterThan(oval.total);
    });

    it('rewards figure-8 crossings', () => {
        const fig8 = replayClosed([
            'start', 'cross', 'straight', 'curveRight', 'curveRight', 'curveRight',
            'straight', 'crossPass', 'straight', 'curveLeft', 'straight', 'curveLeft', 'curveLeft',
        ]);
        const s = scoreTrack(fig8);
        expect(s.crossings).toBe(1);
        expect(s.total).toBeGreaterThan(scoreTrack(replayClosed(PLAIN_OVAL)).total);
    });

    it('penalizes long straight drags via rhythm', () => {
        const s = scoreTrack(replayClosed(PLAIN_OVAL));
        expect(s.rhythm).toBe(0); // runs of 2-3 are fine
        const draggy = replayClosed([
            'start', 'straight', 'straight', 'straight', 'straight', 'straight', 'curveLeft', 'curveLeft',
            'straight', 'straight', 'straight', 'straight', 'straight', 'straight', 'curveLeft', 'curveLeft',
        ]);
        expect(scoreTrack(draggy).rhythm).toBeGreaterThan(0);
    });

    it('counts overpasses and levels on a 3D track', () => {
        // Any elevated generated track should register levels; overpass columns
        // appear when the track passes over itself.
        const track = generateTrack(DELUXE_SET, {
            minPieces: 18, maxPieces: 40, elevation: 0.6, seed: 11,
        });
        expect(track).not.toBeNull();
        const s = scoreTrack(track!);
        expect(s.levels).toBeGreaterThan(0);
        expect(s.ride).toBeGreaterThan(0);
        const flat = scoreTrack(replayClosed(PLAIN_OVAL));
        expect(flat.levels).toBe(0);
        expect(flat.ride).toBe(0);
        expect(flat.overpass).toBe(0);
    });
});
