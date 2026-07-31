// Dev tool: measure generateTrack wall time across realistic UI settings.
//   npx vite-node scripts/bench-generator.ts
import { generateTrack } from '../src/core/generator';
import { STARTER_SET, DELUXE_SET } from '../src/core/pieces';

// Mirrors Simple-mode complexity dial mappings (sidebar getState).
const CASES = [
    { name: 'starter balanced (21p, 39%)', inv: STARTER_SET, min: 12, max: 21, elev: 0.39 },
    { name: 'starter wild    (32p, 65%)', inv: STARTER_SET, min: 19, max: 32, elev: 0.65 },
    { name: 'deluxe twisty   (52p, 44%)', inv: DELUXE_SET, min: 31, max: 52, elev: 0.44 },
    { name: 'deluxe wild     (66p, 65%)', inv: DELUXE_SET, min: 39, max: 66, elev: 0.65 },
] as const;

const SEEDS = [11, 222, 3333, 44444, 555555, 6666666, 777, 88, 9, 1010];

for (const c of CASES) {
    const times: number[] = [];
    let fails = 0;
    for (const seed of SEEDS) {
        const t0 = performance.now();
        const track = generateTrack(
            c.inv,
            { minPieces: c.min, maxPieces: c.max, elevation: c.elev, seed },
            60,
        );
        times.push(performance.now() - t0);
        if (!track) fails++;
    }
    times.sort((a, b) => a - b);
    const med = times[Math.floor(times.length / 2)];
    const p90 = times[Math.min(times.length - 1, Math.ceil(times.length * 0.9) - 1)];
    const max = times[times.length - 1];
    console.log(
        `${c.name}  median ${med.toFixed(0)}ms  p90 ${p90.toFixed(0)}ms  max ${max.toFixed(0)}ms` +
        (fails ? `  FAILURES ${fails}/${SEEDS.length}` : ''),
    );
}
