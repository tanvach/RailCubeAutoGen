import { generateTrack, GeneratedTrack, CrossMode } from './generator';
import { Inventory } from './pieces';
import { scoreTrack } from './score';

export type GenerationStyle = 'classic' | 'showcase';

export type WorkerRequest = {
    inventory: Inventory;
    options: {
        minPieces: number;
        maxPieces: number;
        elevation: number;
        crossMode?: CrossMode;
        /** 'showcase' generates many candidates and keeps the best-scoring one. */
        style?: GenerationStyle;
    };
};

export type WorkerResponse = {
    type: 'success' | 'failure' | 'progress';
    data?: GeneratedTrack;
    message?: string;
    /** True when constraints were softened to close a loop. */
    relaxed?: boolean;
    /** Human-readable note about what was relaxed, for a toast. */
    note?: string;
};

/** Wall-clock budget for showcase mode's candidate hunt. */
const SHOWCASE_DEADLINE_MS = 15_000;
const SHOWCASE_TARGET = 8;

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
    const { inventory, options } = e.data;
    const crossMode: CrossMode = options.crossMode ?? 'off';
    const style: GenerationStyle = options.style ?? 'classic';
    const start = performance.now();

    const onProgress = (attempt: number) => {
        if (attempt > 0 && attempt % 10 === 0) {
            postMessage({ type: 'progress', message: `Searching... attempt ${attempt}` } satisfies WorkerResponse);
        }
    };

    /**
     * One full generation at the given settings, including the escalating
     * restart schedule. Returns the track plus a note when constraints had to
     * be softened to close a loop.
     */
    const generateWithFallback = (quiet = false): { track: GeneratedTrack | null; relaxed: boolean; note?: string } => {
        const report = quiet ? undefined : onProgress;
        const opts = { minPieces: options.minPieces, maxPieces: options.maxPieces, elevation: options.elevation, crossMode };

        let track = generateTrack(inventory, opts, 60, report);
        if (track) return { track, relaxed: false };

        // Extreme settings (very long + very vertical) sometimes can't close.
        // Rather than fail, soften the request once: shorter minimum, slightly
        // less vertical. In practice this rescues nearly every hard case fast.
        if (!quiet) postMessage({ type: 'progress', message: 'Tough settings — relaxing slightly…' } satisfies WorkerResponse);
        track = generateTrack(
            inventory,
            { ...opts, minPieces: Math.max(6, Math.floor(options.minPieces * 0.6)), elevation: options.elevation * 0.8 },
            60,
            report,
        );
        if (track) {
            return { track, relaxed: true, note: 'Those settings were very tough — relaxed them slightly to close the loop.' };
        }

        // A figure-8 that still won't close: fall back to using the crosses as
        // plain straights so the user gets a track instead of an error.
        if (crossMode === 'crossing') {
            if (!quiet) postMessage({ type: 'progress', message: 'No figure-8 found — trying crosses as straights…' } satisfies WorkerResponse);
            track = generateTrack(inventory, { ...opts, crossMode: 'straight' }, 60, report);
            if (track) {
                return { track, relaxed: true, note: 'Could not close a figure-8 with these settings — used the cross pieces as straight track instead.' };
            }
        }
        return { track: null, relaxed: true };
    };

    /**
     * Showcase mode: keep generating fresh candidates until the deadline (or
     * enough of them), score each on manual-style "interestingness" (compact
     * interlocked footprint, overpasses, levels, wall rides, crossings), and
     * return the winner.
     */
    const generateShowcase = (): { track: GeneratedTrack | null; relaxed: boolean; note?: string } => {
        let best: GeneratedTrack | null = null;
        let bestScore = -Infinity;
        let found = 0;

        while (performance.now() - start < SHOWCASE_DEADLINE_MS && found < SHOWCASE_TARGET) {
            const opts = { minPieces: options.minPieces, maxPieces: options.maxPieces, elevation: options.elevation, crossMode };
            const track = generateTrack(inventory, opts, 60);
            if (!track) break; // a whole schedule failed; more seeds won't help
            found++;
            const s = scoreTrack(track).total;
            if (s > bestScore) { bestScore = s; best = track; }
            postMessage({
                type: 'progress',
                message: `Exploring layouts — candidate ${found} of ${SHOWCASE_TARGET}…`,
            } satisfies WorkerResponse);
        }

        if (best) return { track: best, relaxed: false };
        // Couldn't complete even one candidate: reuse the classic fallbacks.
        return generateWithFallback();
    };

    const result = style === 'showcase' ? generateShowcase() : generateWithFallback();

    const ms = (performance.now() - start).toFixed(0);
    if (result.track) {
        postMessage({
            type: 'success',
            data: result.track,
            relaxed: result.relaxed,
            note: result.note,
            message: `Generated ${result.track.pieces.length} pieces in ${ms}ms`,
        } satisfies WorkerResponse);
    } else {
        postMessage({
            type: 'failure',
            message: 'Could not close a loop with these settings. Try a longer track or more pieces.',
        } satisfies WorkerResponse);
    }
};
