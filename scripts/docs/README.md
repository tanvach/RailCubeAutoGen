# Doc figure generators

Scripts here rebuild the schematic SVGs used by `docs/HOW_IT_WORKS.md`.
They are not part of the app build.

## How It Works figures

```bash
npx vite-node scripts/docs/gen-how-it-works-figures.ts
```

Writes into `docs/images/`:

| File | Section | Source of truth |
| --- | --- | --- |
| `track-state-frame.svg` | §2 | TrackState `(dir, up)` conventions |
| `piece-motions.svg` | §3 | `computePlacement` footprints |
| `solid-vs-swing.svg` | §4 | solids/swing from `computePlacement` + shareable-swing rule |
| `orientation-debt.svg` | §6.1 | `orientationLowerBound` (asserts costs 0 / 1 / 4) |

Re-run after changing piece geometry or the orientation metric. The script asserts
cell/swing counts, the 0/1/4 orientation costs, and that isometric +z/−z project
the right way before writing files.
