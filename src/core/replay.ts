import {
    PieceType, PiecePlacement, Step, TrackResult, TrackState,
    START_STATE, computePlacement, statesEqual, canCrossPass,
} from './pieces';
import { OccupancyGrid } from './grid';

export interface ReplayResult extends TrackResult {
    closed: boolean;
    /** First problem found, for debugging failed programs. */
    error?: string;
}

/**
 * Interpret a "program" (an ordered piece sequence, as printed in the manual's
 * programming practice sheets) into placed geometry. `'crossPass'` entries mean
 * the train re-crosses the most recently reachable cross piece via route 2.
 */
export const replayProgram = (program: (PieceType | 'crossPass')[]): ReplayResult => {
    const grid = new OccupancyGrid();
    const pieces: PiecePlacement[] = [];
    const steps: Step[] = [];
    let state: TrackState = START_STATE;

    for (let i = 0; i < program.length; i++) {
        const entry = program[i];

        if (entry === 'crossPass') {
            const idx = pieces.findIndex((p) => canCrossPass(p, state));
            if (idx === -1) {
                return { pieces, steps, closed: false, error: `step ${i}: no cross to pass at ${JSON.stringify(state)}` };
            }
            steps.push({ kind: 'crossPass', pieceIndex: idx });
            state = { cell: { x: state.cell.x + state.dir.x, y: state.cell.y + state.dir.y, z: state.cell.z + state.dir.z }, dir: state.dir, up: state.up };
            continue;
        }

        const placement = computePlacement(entry, state);
        if (!grid.canPlace(placement)) {
            return { pieces, steps, closed: false, error: `step ${i}: cannot place ${entry} at ${JSON.stringify(state)}` };
        }
        grid.place(placement, pieces.length);
        steps.push({ kind: 'piece', pieceIndex: pieces.length });
        pieces.push(placement);
        state = placement.exit;
    }

    return { pieces, steps, closed: statesEqual(state, START_STATE) };
};
