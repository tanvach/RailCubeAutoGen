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
    /** True when constraints were softened to close a loop. */
    relaxed?: boolean;
};

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
    const { inventory, options } = e.data;
    const start = performance.now();

    const onProgress = (attempt: number) => {
        if (attempt > 0 && attempt % 10 === 0) {
            postMessage({ type: 'progress', message: `Searching... attempt ${attempt}` } satisfies WorkerResponse);
        }
    };

    // No explicit maxNodes: generateTrack uses its escalating restart schedule
    // (many cheap seeds first), which is far faster in the median.
    let track = generateTrack(inventory, options, 60, onProgress);
    let relaxed = false;

    // Extreme settings (very long + very vertical) sometimes can't close.
    // Rather than fail, soften the request once: shorter minimum, slightly
    // less vertical. In practice this rescues nearly every hard case fast.
    if (!track) {
        relaxed = true;
        postMessage({ type: 'progress', message: 'Tough settings — relaxing slightly…' } satisfies WorkerResponse);
        track = generateTrack(
            inventory,
            {
                ...options,
                minPieces: Math.max(6, Math.floor(options.minPieces * 0.6)),
                elevation: options.elevation * 0.8,
            },
            60,
            onProgress,
        );
    }

    const ms = (performance.now() - start).toFixed(0);
    if (track) {
        postMessage({
            type: 'success',
            data: track,
            relaxed,
            message: `Generated ${track.pieces.length} pieces in ${ms}ms`,
        } satisfies WorkerResponse);
    } else {
        postMessage({
            type: 'failure',
            message: 'Could not close a loop with these settings. Try a longer track or more pieces.',
        } satisfies WorkerResponse);
    }
};
