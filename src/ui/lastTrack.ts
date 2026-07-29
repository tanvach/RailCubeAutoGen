import { TrackData } from './favorites';

const STORAGE_KEY = 'railcube.lastTrack.v1';

/** Persist the currently displayed track so a browser refresh restores it. */
export const saveLastTrack = (track: TrackData): void => {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({
            pieces: track.pieces,
            steps: track.steps,
        }));
    } catch {
        // Quota / private mode: stickiness is best-effort.
    }
};

/** Load the last displayed track, or null if none / corrupt. */
export const loadLastTrack = (): TrackData | null => {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (!parsed || !Array.isArray(parsed.pieces) || !Array.isArray(parsed.steps)) return null;
        if (parsed.pieces.length === 0) return null;
        return { pieces: parsed.pieces, steps: parsed.steps };
    } catch {
        return null;
    }
};
