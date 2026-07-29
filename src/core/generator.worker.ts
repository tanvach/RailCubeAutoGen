import { generateTrack, GeneratedTrack } from './generator';
import { Inventory } from './pieces';

export type WorkerRequest = {
    inventory: Inventory;
    options: {
        minPieces: number;
        maxPieces: number;
        elevation: number;
    };
};

export type WorkerResponse = {
    type: 'success' | 'failure' | 'progress';
    data?: GeneratedTrack;
    message?: string;
};

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
    const { inventory, options } = e.data;
    const start = performance.now();

    const track = generateTrack(
        inventory,
        { ...options, maxNodes: 250_000 },
        60,
        (attempt) => {
            if (attempt > 0 && attempt % 5 === 0) {
                postMessage({ type: 'progress', message: `Searching... attempt ${attempt}` } satisfies WorkerResponse);
            }
        },
    );

    const ms = (performance.now() - start).toFixed(0);
    if (track) {
        postMessage({
            type: 'success',
            data: track,
            message: `Generated ${track.pieces.length} pieces in ${ms}ms`,
        } satisfies WorkerResponse);
    } else {
        postMessage({
            type: 'failure',
            message: 'Could not close a loop with these settings. Try a longer track or more pieces.',
        } satisfies WorkerResponse);
    }
};
