# Project Specification: Rail Cube Auto-Generator

https://www.railcubetoys.com

> **Status (2026-07): Implemented.** This document is the original brief, **corrected**
> after building against the physical set and its printed Japanese manual (photos in
> `references/`). Where this spec originally guessed the physics wrong, the corrected
> sections below say so and match the code. See [README.md](README.md) for usage and
> [ARCHITECTURE.md](ARCHITECTURE.md) for the implemented design.

## 1. Role & Objective
**Role:** Senior Frontend Creative Developer (Three.js / TypeScript).
**Objective:** Build a client-side Single Page Application (SPA) that procedurally generates valid, looping 3D track layouts for "Rail Cube" magnetic monorail toys. The app must visualize the track in 3D and generate "Program Note" style assembly instructions (a sequence of block colors).

## 2. Tech Stack
* **Framework:** Vanilla TypeScript.
* **Build Tool:** Vite.
* **3D Engine:** Three.js.
* **Styling:** Tailwind CSS.
* **Deployment:** Static HTML (GitHub Pages compatible). **No server-side code.**
* **Testing:** Vitest (added during implementation; TDD per §8).

## 3. Data Modeling (The "Physics")
The system works on a **3D Integer Grid `(x, y, z)`**. One unit = one cube cell.

> **Correction:** the original version of this section assumed all pieces are 1×1×1 with
> yaw/pitch exits. The printed manual and piece photos showed otherwise — the train is
> magnetic and rides rails facing up, down, or sideways, and several pieces span multiple
> cells. The table below is the corrected, implemented model. A track state is
> `(cell, dir, up)` where `up` is the rail-face normal the train rides on.

### Block Definitions (corrected from the printed manual)
*"Entry" is the face the train arrives through; the loop always starts at the white cube heading +X with the rail on top.*

| Block Color | Type Name | Qty (Starter) | Footprint | Behavior |
| :--- | :--- | :--- | :--- | :--- |
| **White** | Start Cube | 1 | 1×1×1 | Straight-through; powers the loop; loop must close back into it. |
| **Yellow** | Straight | 15 | 1×1×1 | Continues in the entry direction. |
| **Blue/Green** | L/R Curve | 8 | 2×2×1 | 90° in-plane turn (quarter annulus). **One physical piece, flippable: blue face up = left, green = right.** |
| **Red** | Outer Curve | 4 | 1×1×1 | Convex 90° wrap around the cube edge (e.g. top → side). |
| **Orange** | Inner Curve | 4 | 2×2×1 | Concave 90° turn out of the rail plane (e.g. floor → wall); two stacked form a semicircular slot end. |
| **Purple** | Cross | 0 (Deluxe: 2) | 2×1×1 | Two crossing rails; traversed twice per loop (routes numbered 1/2 on the toy). |

* **Deluxe Set:** 31 Yellow, 16 Curve, 8 Red, 8 Orange, 2 Purple Cross. **Implemented.**

### Geometric Constraints (implemented)
1.  **Connectivity:** each piece's exit state equals the next piece's entry state.
2.  **Self-Collision:** solid cells never overlap; solid cells never overlap another
    piece's *swing cells* (the space the train sweeps through).
3.  **Shared swing space:** two rails may face each other across a slot — swing cells are
    shareable, which the manual's slotted-frame example requires.
4.  **Loop Closure:** the final state must equal the start state exactly (cell, dir, and
    rail normal).
5.  **Floor:** nothing below `y = 0`.
6.  **Supports:** elevated pieces get visual support pillars in the renderer; pillar count
    is not (yet) part of the search objective.

## 4. The Generator Algorithm
**Problem:** Constraint satisfaction / loop-finding on the grid, over `(cell, dir, up)`.
**Strategy (implemented):** seeded backtracking search in a Web Worker.

1.  **Inputs:** inventory (Starter / Deluxe / Custom), min/max piece count, elevation bias.
2.  **Initialization:** place the white cube at `(0,0,0)` heading `+X`, rail up.
3.  **Recursive step:**
    * Weighted-random candidate order; `elevation` shifts weight between in-plane curves
      and vertical (inner/outer) pieces.
    * Pruning: Manhattan distance home vs. remaining piece budget; orientation
      realignment budget; inventory checks.
    * Occupancy check via the solid/swing grid.
    * **Cross handling:** entering an occupied cell is only legal as a cross route-2 pass
      (perpendicular, same rail normal, once per cross). The generator intentionally never
      *places* crosses — without a planned route 2 they're just confusing wide straights.
      Cross pieces remain fully supported in replayed programs and favorites.
4.  **Completion:** state equals the start state with ≥ min pieces placed.
5.  **Retries:** deterministic seeds (mulberry32); retry derived seeds until a loop closes,
    reporting progress to the UI.

## 5. UI/UX Specification

### A. Sidebar Controls — implemented
* **Kit Selector:** "Starter Set", "Deluxe Set", "Custom Inventory" (per-piece number inputs).
* **Track Size slider** (piece budget) and **Elevation slider** (flat ↔ vertical bias).
* **Generate Button** with loading spinner; search runs in a Web Worker.
* **Favorites:** save the current track with a rendered thumbnail (localStorage), restore
  with one click.
* **Inventory Display:** live "used / total" per piece type after each generation.

### B. Main Viewport (Three.js) — implemented
* Faithful piece meshes: rail grooves with magnetic strip, two-tone curve bodies,
  concave/convex profiles, connector knobs; colors matched to the physical set.
* Support pillars under elevated pieces.
* OrbitControls, floor grid, automatic camera framing.
* **Animated train** following the exact rail path at constant speed, including wall and
  ceiling riding.

### C. Instructions Panel — implemented
* **Sequence View:** colored chips in build order matching the manual's notation
  (START, L/R on curves, numbered cross routes).
* **Piece-count summary** and a **Print** button; `@media print` shows only the program.

## 6. Implementation Plan — completed
1.  ~~Setup: scaffolding.~~
2.  ~~Geometry proof~~ — superseded: ground truth now comes from replaying the printed
    manual's programs as tests (`src/core/examples.ts`, `pieces.test.ts`).
3.  ~~Algorithm core in pure TS.~~
4.  ~~Visuals connected to the algorithm output.~~
5.  ~~UI polish: sidebar, custom inventory, print mode.~~

## 7. Assets & Reference
* `references/` contains photos of every physical piece and both pages of the printed
  Japanese manual; the piece model and inventories were derived from these.
* The track is a magnetic monorail: the train rides the groove's metal strip on any face
  orientation (confirmed by manual section 2).

## 8. Implementation Guidelines
TDD as required: unit tests for piece transforms, ground-truth replay tests against the
printed manual, property tests re-validating every generated track, and UI tests (sidebar,
instructions, favorites). 33 tests, all passing; `npm run build` type-checks cleanly.
