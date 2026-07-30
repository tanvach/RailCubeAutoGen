/**
 * Generate schematic SVG figures for docs/HOW_IT_WORKS.md.
 *
 * Geometry comes from src/core/pieces.ts (computePlacement) and
 * src/core/generator.ts (orientationLowerBound) so the figures cannot
 * drift from the model. Regenerate after piece-model changes with:
 *
 *   npx vite-node scripts/docs/gen-how-it-works-figures.ts
 *
 * Writes into docs/images/. Not part of the app build.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    PieceType, TrackState, PiecePlacement, computePlacement, START_STATE,
} from '../../src/core/pieces';
import { orientationLowerBound } from '../../src/core/generator';
import { Vec3, v, eq } from '../../src/core/vec';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '../../docs/images');

// ---------------------------------------------------------------------------
// Tiny SVG helpers
// ---------------------------------------------------------------------------

const COLORS = {
    bg: '#faf9f7',
    ink: '#1f2937',
    muted: '#6b7280',
    grid: '#e5e7eb',
    solid: '#d1d5db',
    solidStroke: '#4b5563',
    swing: '#fde68a',
    swingStroke: '#d97706',
    dir: '#2563eb',
    up: '#059669',
    entry: '#111827',
    exit: '#7c3aed',
    yellow: '#facc15',
    blue: '#3b82f6',
    green: '#22c55e',
    orange: '#f97316',
    red: '#ef4444',
    purple: '#a855f7',
} as const;

const r = (n: number) => Math.round(n * 10) / 10;

const esc = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const svgDoc = (w: number, h: number, body: string) =>
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" ` +
    `viewBox="0 0 ${w} ${h}" role="img">\n` +
    `<rect width="100%" height="100%" fill="${COLORS.bg}"/>\n` +
    `${body}\n</svg>\n`;

const text = (x: number, y: number, s: string, opts: {
    size?: number; fill?: string; weight?: string; anchor?: string;
} = {}) =>
    `<text x="${x}" y="${y}" font-family="ui-sans-serif, system-ui, sans-serif" ` +
    `font-size="${opts.size ?? 13}" fill="${opts.fill ?? COLORS.ink}" ` +
    `font-weight="${opts.weight ?? '500'}" text-anchor="${opts.anchor ?? 'start'}">${esc(s)}</text>`;

const arrow = (
    x1: number, y1: number, x2: number, y2: number,
    color: string, label?: string,
) => {
    const dx = x2 - x1, dy = y2 - y1;
    const len = Math.hypot(dx, dy);
    if (len < 2) return ''; // out-of-plane vector in this projection
    const ux = dx / len, uy = dy / len;
    const hx = x2 - ux * 8, hy = y2 - uy * 8;
    const px = -uy * 4.5, py = ux * 4.5;
    let out =
        `<line x1="${r(x1)}" y1="${r(y1)}" x2="${r(hx)}" y2="${r(hy)}" stroke="${color}" ` +
        `stroke-width="2.2" stroke-linecap="round"/>` +
        `<polygon points="${r(x2)},${r(y2)} ${r(hx + px)},${r(hy + py)} ${r(hx - px)},${r(hy - py)}" fill="${color}"/>`;
    if (label) {
        out += text(x2 + ux * 10 + px * 1.2, y2 + uy * 10 + py * 1.2 + 4, label, {
            size: 11, fill: color, weight: '600',
        });
    }
    return out;
};

/** Marker when `up` is perpendicular to the drawing plane. */
const outOfPlaneUp = (x: number, y: number) =>
    `<circle cx="${r(x)}" cy="${r(y - 14)}" r="5" fill="none" stroke="${COLORS.up}" stroke-width="1.6"/>` +
    `<circle cx="${r(x)}" cy="${r(y - 14)}" r="1.6" fill="${COLORS.up}"/>` +
    text(x + 8, y - 10, 'up', { size: 11, fill: COLORS.up, weight: '600' });

// ---------------------------------------------------------------------------
// 2D projectors: map grid cells → screen pixels inside a panel
// ---------------------------------------------------------------------------

type Projector = {
    /** Cell center in screen coords. */
    center: (c: Vec3) => { x: number; y: number };
    /** Half-size of a cell square on screen. */
    half: number;
    /** Project a direction vector (unit axis) as a screen delta of length `len`. */
    dirScreen: (d: Vec3, len: number) => { x: number; y: number };
};

/** Top-down floor view: +x right, +z down the page (looking along −y). */
const topDown = (ox: number, oy: number, cellPx: number): Projector => ({
    half: cellPx / 2,
    center: (c) => ({ x: ox + (c.x + 0.5) * cellPx, y: oy + (c.z + 0.5) * cellPx }),
    dirScreen: (d, len) => ({ x: d.x * len, y: d.z * len }),
});

/** Side view in the dir/up plane of START_STATE: +x right, +y up the page. */
const sideView = (ox: number, oy: number, cellPx: number, yMax: number): Projector => ({
    half: cellPx / 2,
    center: (c) => ({
        x: ox + (c.x + 0.5) * cellPx,
        y: oy + (yMax - c.y - 0.5) * cellPx,
    }),
    dirScreen: (d, len) => ({ x: d.x * len, y: -d.y * len }),
});

const cellRect = (p: Projector, c: Vec3, fill: string, stroke: string, dash = false) => {
    const { x, y } = p.center(c);
    const h = p.half - 1.5;
    return `<rect x="${r(x - h)}" y="${r(y - h)}" width="${r(h * 2)}" height="${r(h * 2)}" ` +
        `rx="3" fill="${fill}" stroke="${stroke}" stroke-width="1.5"` +
        (dash ? ` stroke-dasharray="4 3"` : '') + `/>`;
};

const drawFrame = (p: Projector, state: TrackState) => {
    const c = p.center(state.cell);
    const al = p.half * 0.95;
    const d = p.dirScreen(state.dir, al);
    const u = p.dirScreen(state.up, al);
    let out = arrow(c.x, c.y, c.x + d.x, c.y + d.y, COLORS.dir, 'dir');
    const upDrawn = arrow(c.x, c.y, c.x + u.x, c.y + u.y, COLORS.up, 'up');
    if (upDrawn) out += upDrawn;
    else out += outOfPlaneUp(c.x, c.y);
    return out;
};

const drawPlacement = (
    p: Projector, placement: PiecePlacement, solidFill: string,
    opts: { swing?: boolean } = {},
) => {
    let out = '';
    if (opts.swing) {
        for (const c of placement.swing) {
            out += cellRect(p, c, COLORS.swing, COLORS.swingStroke, true);
        }
    }
    for (const c of placement.cells) {
        out += cellRect(p, c, solidFill, COLORS.solidStroke);
    }
    const e = p.center(placement.entry.cell);
    const x = p.center(placement.exit.cell);
    out += `<circle cx="${r(e.x)}" cy="${r(e.y)}" r="3.5" fill="${COLORS.entry}"/>`;
    out += `<circle cx="${r(x.x)}" cy="${r(x.y)}" r="3.5" fill="${COLORS.exit}"/>`;
    out += `<line x1="${r(e.x)}" y1="${r(e.y)}" x2="${r(x.x)}" y2="${r(x.y)}" ` +
        `stroke="${COLORS.muted}" stroke-width="1" stroke-dasharray="3 2" opacity="0.6"/>`;
    out += drawFrame(p, placement.entry);
    const exitAl = p.half * 0.7;
    const ed = p.dirScreen(placement.exit.dir, exitAl);
    const eu = p.dirScreen(placement.exit.up, exitAl);
    out += arrow(x.x, x.y, x.x + ed.x, x.y + ed.y, COLORS.dir);
    const upDrawn = arrow(x.x, x.y, x.x + eu.x, x.y + eu.y, COLORS.up);
    if (!upDrawn) out += outOfPlaneUp(x.x, x.y);
    else out += upDrawn;
    return out;
};

const legendDot = (x: number, y: number, fill: string, stroke: string, label: string, dash = false) =>
    `<rect x="${x}" y="${y - 6}" width="12" height="12" rx="2" fill="${fill}" ` +
    `stroke="${stroke}" stroke-width="1.2"${dash ? ` stroke-dasharray="3 2"` : ''}/>` +
    text(x + 18, y + 4, label, { size: 11, fill: COLORS.muted, weight: '400' });

// ---------------------------------------------------------------------------
// Figure 1 — TrackState as a frame (§2)
// ---------------------------------------------------------------------------

const genTrackStateFrame = () => {
    const cellPx = 72;
    const panelW = 200;
    const panelH = 210;
    const cases: { title: string; state: TrackState; note: string }[] = [
        {
            title: 'Floor',
            state: { cell: v(0, 0, 0), dir: v(1, 0, 0), up: v(0, 1, 0) },
            note: 'rail on top',
        },
        {
            title: 'Wall',
            state: { cell: v(0, 0, 0), dir: v(1, 0, 0), up: v(0, 0, 1) },
            note: 'rail on +z face',
        },
        {
            title: 'Ceiling',
            state: { cell: v(0, 0, 0), dir: v(1, 0, 0), up: v(0, -1, 0) },
            note: 'rail underneath',
        },
    ];

    // Isometric-ish cube: show faces depending on up.
    const drawCube = (cx: number, cy: number, state: TrackState) => {
        const s = 28;
        // Simple 2.5D cube outline
        const pts = {
            f00: [cx - s, cy + s * 0.3],
            f10: [cx + s, cy + s * 0.3],
            f01: [cx - s, cy - s * 0.9],
            f11: [cx + s, cy - s * 0.9],
            // depth toward +z visually down-right
            b00: [cx - s + 18, cy + s * 0.3 + 16],
            b10: [cx + s + 18, cy + s * 0.3 + 16],
            b01: [cx - s + 18, cy - s * 0.9 + 16],
            b11: [cx + s + 18, cy - s * 0.9 + 16],
        } as const;
        const poly = (keys: (keyof typeof pts)[], fill: string, opacity = 1) =>
            `<polygon points="${keys.map((k) => pts[k].join(',')).join(' ')}" ` +
            `fill="${fill}" fill-opacity="${opacity}" stroke="${COLORS.solidStroke}" stroke-width="1.2"/>`;

        // Which face is the rail? Highlight by up.
        let out = poly(['f00', 'f10', 'b10', 'b00'], '#e5e7eb', 0.9); // bottom-ish
        out += poly(['f00', 'f10', 'f11', 'f01'], '#f3f4f6', 0.95); // front
        out += poly(['f10', 'b10', 'b11', 'f11'], '#d1d5db', 0.9); // right

        // Rail face tint
        const railFill = '#93c5fd';
        if (eq(state.up, v(0, 1, 0))) {
            out += poly(['f01', 'f11', 'b11', 'b01'], railFill, 0.85); // top
        } else if (eq(state.up, v(0, -1, 0))) {
            out += poly(['f00', 'f10', 'b10', 'b00'], railFill, 0.9); // bottom
        } else if (eq(state.up, v(0, 0, 1))) {
            out += poly(['f10', 'b10', 'b11', 'f11'], railFill, 0.9); // +z ≈ right in this sketch
        }

        // Arrows from cube center
        const origin = [cx + 6, cy + 2] as const;
        // dir along +x ≈ right on front face
        out += arrow(origin[0], origin[1], origin[0] + 34, origin[1], COLORS.dir, 'dir');
        if (eq(state.up, v(0, 1, 0))) {
            out += arrow(origin[0], origin[1], origin[0], origin[1] - 34, COLORS.up, 'up');
        } else if (eq(state.up, v(0, -1, 0))) {
            out += arrow(origin[0], origin[1], origin[0], origin[1] + 34, COLORS.up, 'up');
        } else if (eq(state.up, v(0, 0, 1))) {
            out += arrow(origin[0], origin[1], origin[0] + 22, origin[1] + 20, COLORS.up, 'up');
        }
        return out;
    };

    let body = text(24, 28, 'Same cell, same heading — three different frames', {
        size: 15, weight: '600',
    });
    body += text(24, 48, 'dir is travel; up is the rail-face normal (toward the train). right = dir × up.', {
        size: 12, fill: COLORS.muted, weight: '400',
    });

    cases.forEach((c, i) => {
        const ox = 24 + i * panelW;
        const oy = 70;
        body += `<rect x="${ox}" y="${oy}" width="${panelW - 16}" height="${panelH}" ` +
            `rx="10" fill="#fff" stroke="${COLORS.grid}" stroke-width="1"/>`;
        body += text(ox + 14, oy + 24, c.title, { size: 14, weight: '600' });
        body += text(ox + 14, oy + 42, c.note, { size: 11, fill: COLORS.muted, weight: '400' });
        body += drawCube(ox + (panelW - 16) / 2 - 4, oy + 115, c.state);
        body += text(ox + 14, oy + panelH - 14,
            `up = (${c.state.up.x}, ${c.state.up.y}, ${c.state.up.z})`, {
                size: 11, fill: COLORS.muted, weight: '400',
            });
    });

    const w = 24 + 3 * panelW + 8;
    const h = 70 + panelH + 24;
    return svgDoc(w, h, body);
};

// ---------------------------------------------------------------------------
// Figure 2 — Piece rigid motions (§3)
// ---------------------------------------------------------------------------

const PIECE_META: {
    type: PieceType; label: string; fill: string; view: 'top' | 'side';
}[] = [
    { type: 'straight', label: 'Straight', fill: COLORS.yellow, view: 'top' },
    { type: 'curveLeft', label: 'Curve L', fill: COLORS.blue, view: 'top' },
    { type: 'inner', label: 'Inner', fill: COLORS.orange, view: 'side' },
    { type: 'outer', label: 'Outer', fill: COLORS.red, view: 'side' },
    { type: 'cross', label: 'Cross', fill: COLORS.purple, view: 'top' },
];

const genPieceMotions = () => {
    const cellPx = 34;
    const panelW = 172;
    const panelH = 220;
    const cols = 5;
    const entry = START_STATE;

    let body = text(20, 26, 'Each piece is a fixed motion in the local frame', {
        size: 15, weight: '600',
    });
    body += text(20, 46,
        'Filled = solid cells. Black = entry, purple = exit. ⊙ marks up when it points out of the page.',
        { size: 11, fill: COLORS.muted, weight: '400' });

    PIECE_META.forEach((meta, i) => {
        const placement = computePlacement(meta.type, entry);
        const ox = 16 + (i % cols) * panelW;
        const oy = 62;
        const pw = panelW - 12;
        const clipId = `clip-${meta.type}`;
        body += `<rect x="${ox}" y="${oy}" width="${pw}" height="${panelH}" ` +
            `rx="10" fill="#fff" stroke="${COLORS.grid}"/>`;
        body += text(ox + 12, oy + 22, meta.label, { size: 13, weight: '600' });
        body += text(ox + 12, oy + 38, meta.view === 'top' ? 'top-down (xz)' : 'side (xy)', {
            size: 10, fill: COLORS.muted, weight: '400',
        });

        const all = [...placement.cells, placement.exit.cell];
        const xs = all.map((c) => c.x);
        const zs = all.map((c) => c.z);
        const ys = all.map((c) => c.y);
        const minX = Math.min(...xs);
        const maxX = Math.max(...xs);
        const minZ = Math.min(...zs);
        const maxZ = Math.max(...zs);
        const minY = Math.min(...ys, 0);
        const maxY = Math.max(...ys, 0);

        // Content area under the title
        const contentX = ox + 10;
        const contentY = oy + 48;
        const contentW = pw - 20;
        const contentH = panelH - 70;
        body += `<clipPath id="${clipId}"><rect x="${contentX}" y="${contentY}" ` +
            `width="${contentW}" height="${contentH}" rx="4"/></clipPath>`;
        body += `<g clip-path="url(#${clipId})">`;

        let proj: Projector;
        if (meta.view === 'top') {
            const spanX = maxX - minX + 1;
            const spanZ = maxZ - minZ + 1;
            const scale = Math.min(cellPx, (contentW - 8) / spanX, (contentH - 8) / spanZ);
            const usedW = spanX * scale;
            const usedH = spanZ * scale;
            const originX = contentX + (contentW - usedW) / 2 - minX * scale;
            const originY = contentY + (contentH - usedH) / 2 - minZ * scale;
            proj = topDown(originX, originY, scale);
            for (let x = minX; x <= maxX; x++) {
                for (let z = minZ; z <= maxZ; z++) {
                    const c = proj.center(v(x, 0, z));
                    body += `<rect x="${r(c.x - proj.half)}" y="${r(c.y - proj.half)}" ` +
                        `width="${r(scale)}" height="${r(scale)}" fill="none" stroke="${COLORS.grid}"/>`;
                }
            }
        } else {
            const spanX = maxX - minX + 1;
            const spanY = maxY - minY + 1;
            const scale = Math.min(cellPx, (contentW - 8) / spanX, (contentH - 8) / spanY);
            const usedW = spanX * scale;
            const usedH = spanY * scale;
            const originX = contentX + (contentW - usedW) / 2 - minX * scale;
            const originY = contentY + (contentH - usedH) / 2;
            proj = sideView(originX, originY, scale, maxY);
            for (let x = minX; x <= maxX; x++) {
                for (let y = minY; y <= maxY; y++) {
                    const c = proj.center(v(x, y, 0));
                    body += `<rect x="${r(c.x - proj.half)}" y="${r(c.y - proj.half)}" ` +
                        `width="${r(scale)}" height="${r(scale)}" fill="none" stroke="${COLORS.grid}"/>`;
                }
            }
        }

        body += drawPlacement(proj, placement, meta.fill, { swing: false });

        if (meta.type === 'cross') {
            const far = placement.crossingCell!;
            const fc = proj.center(far);
            body += `<text x="${r(fc.x)}" y="${r(fc.y + 4)}" text-anchor="middle" ` +
                `font-family="ui-sans-serif, system-ui, sans-serif" font-size="10" ` +
                `font-weight="700" fill="#fff">2</text>`;
        }
        body += `</g>`;

        if (meta.type === 'outer') {
            body += text(ox + 12, oy + panelH - 12, 'exit = cell − up', {
                size: 10, fill: COLORS.red, weight: '600',
            });
        }
        if (meta.type === 'cross') {
            body += text(ox + 12, oy + panelH - 12, 'route 2 at far cell', {
                size: 10, fill: COLORS.purple, weight: '600',
            });
        }
    });

    const w = 16 + cols * panelW + 8;
    const h = 62 + panelH + 20;
    return svgDoc(w, h, body);
};

// ---------------------------------------------------------------------------
// Figure 3 — Solid vs swing (§4)
// ---------------------------------------------------------------------------

const genSolidVsSwing = () => {
    const panelW = 260;
    const panelH = 230;

    let body = text(20, 26, 'Solids never overlap; swing cells may be shared', {
        size: 15, weight: '600',
    });
    body += text(20, 46,
        'Amber dashed = swing (clearance). Colored fill = solid. Geometry from computePlacement.',
        { size: 11, fill: COLORS.muted, weight: '400' });

    type Panel = { title: string; subtitle: string; build: (ox: number, oy: number) => string };
    const panels: Panel[] = [
        {
            title: 'Straight',
            subtitle: '1 solid + 1 swing above',
            build: (ox, oy) => {
                const placement = computePlacement('straight', START_STATE);
                const p = sideView(ox + 50, oy + 50, 44, 1.5);
                let out = '';
                for (const c of [v(0, 0, 0), v(0, 1, 0), v(1, 0, 0)]) {
                    const pt = p.center(c);
                    out += `<rect x="${pt.x - p.half}" y="${pt.y - p.half}" width="44" height="44" ` +
                        `fill="none" stroke="${COLORS.grid}"/>`;
                }
                out += drawPlacement(p, placement, COLORS.yellow, { swing: true });
                return out;
            },
        },
        {
            title: 'Curve L',
            subtitle: '4 solids + 4 swings above',
            build: (ox, oy) => {
                const placement = computePlacement('curveLeft', START_STATE);
                // Top-down solids; swing is +up (out of page).
                const p = topDown(ox + 36, oy + 44, 36);
                let out = '';
                for (let x = 0; x <= 1; x++) {
                    for (let z = -1; z <= 0; z++) {
                        const c = p.center(v(x, 0, z));
                        out += `<rect x="${c.x - p.half}" y="${c.y - p.half}" width="36" height="36" ` +
                            `fill="none" stroke="${COLORS.grid}"/>`;
                    }
                }
                for (const c of placement.cells) {
                    out += cellRect(p, c, COLORS.blue, COLORS.solidStroke);
                }
                out += text(ox + 14, oy + 188, 'swing = same 4 cells, +up (out of page)', {
                    size: 10, fill: COLORS.swingStroke, weight: '600',
                });
                const e = p.center(placement.entry.cell);
                const x = p.center(placement.exit.cell);
                out += `<circle cx="${e.x}" cy="${e.y}" r="3.5" fill="${COLORS.entry}"/>`;
                out += `<circle cx="${x.x}" cy="${x.y}" r="3.5" fill="${COLORS.exit}"/>`;
                out += drawFrame(p, placement.entry);
                return out;
            },
        },
        {
            title: 'Shared swing slot',
            subtitle: 'Two rails, one clearance cell',
            build: (ox, oy) => {
                // Rule schematic (not a full placement replay): two facing rails
                // share one swing cell — the constraint §4 teaches before the photo.
                const p = topDown(ox + 40, oy + 50, 48);
                let out = '';
                const left = v(0, 0, 0);
                const swing = v(1, 0, 0);
                const right = v(2, 0, 0);
                for (const c of [left, swing, right]) {
                    const pt = p.center(c);
                    out += `<rect x="${pt.x - p.half}" y="${pt.y - p.half}" width="48" height="48" ` +
                        `fill="none" stroke="${COLORS.grid}"/>`;
                }
                out += cellRect(p, left, COLORS.blue, COLORS.solidStroke);
                out += cellRect(p, right, COLORS.green, COLORS.solidStroke);
                out += cellRect(p, swing, COLORS.swing, COLORS.swingStroke, true);
                out += text(p.center(left).x, p.center(left).y + 4, 'rail', {
                    size: 10, fill: '#fff', weight: '700', anchor: 'middle',
                });
                out += text(p.center(right).x, p.center(right).y + 4, 'rail', {
                    size: 10, fill: '#fff', weight: '700', anchor: 'middle',
                });
                out += text(p.center(swing).x, p.center(swing).y + 4, 'swing', {
                    size: 10, fill: COLORS.swingStroke, weight: '700', anchor: 'middle',
                });
                out += text(ox + 14, oy + 188, 'shareable — see manual frame below', {
                    size: 10, fill: COLORS.muted, weight: '400',
                });
                return out;
            },
        },
    ];

    panels.forEach((panel, i) => {
        const ox = 16 + i * (panelW + 12);
        const oy = 62;
        body += `<rect x="${ox}" y="${oy}" width="${panelW}" height="${panelH}" ` +
            `rx="10" fill="#fff" stroke="${COLORS.grid}"/>`;
        body += text(ox + 14, oy + 24, panel.title, { size: 13, weight: '600' });
        body += text(ox + 14, oy + 42, panel.subtitle, {
            size: 11, fill: COLORS.muted, weight: '400',
        });
        body += panel.build(ox, oy);
    });

    body += legendDot(20, 62 + panelH + 28, COLORS.yellow, COLORS.solidStroke, 'solid');
    body += legendDot(100, 62 + panelH + 28, COLORS.swing, COLORS.swingStroke, 'swing (shareable)', true);

    const w = 16 + 3 * (panelW + 12) + 4;
    const h = 62 + panelH + 48;
    return svgDoc(w, h, body);
};

// ---------------------------------------------------------------------------
// Figure 4 — Orientation debt (§6.1)
// ---------------------------------------------------------------------------

const genOrientationDebt = () => {
    const cases = [
        {
            title: 'Cost 0 — start frame',
            state: { cell: v(0, 0, 0), dir: v(1, 0, 0), up: v(0, 1, 0) },
            detailLines: ['Already home.', 'No pieces needed to realign.'],
        },
        {
            title: 'Cost 1 — one yaw away',
            state: (() => {
                // curveLeft exit: dir = cross(up, dir) = cross(Y,X) = −Z.
                const p = computePlacement('curveLeft', START_STATE);
                return { cell: v(0, 0, 0), dir: p.exit.dir, up: p.exit.up };
            })(),
            detailLines: ['One curve (yaw) restores', 'the start orientation.'],
        },
        {
            title: 'Cost 4 — ceiling hang',
            state: { cell: v(0, 0, 0), dir: v(1, 0, 0), up: v(0, -1, 0) },
            detailLines: ['dir correct, up inverted.', 'Needs a roll; no piece rolls.'],
        },
    ];

    // Verify costs against the real table
    for (const c of cases) {
        const cost = orientationLowerBound(c.state.dir, c.state.up);
        const expected = c.title.startsWith('Cost 0') ? 0
            : c.title.startsWith('Cost 1') ? 1 : 4;
        if (cost !== expected) {
            throw new Error(
                `orientation figure out of sync: "${c.title}" has cost ${cost}, expected ${expected}`,
            );
        }
    }

    const panelW = 250;
    const panelH = 228;
    let body = text(20, 26, 'Orientation debt: fewest pieces to realign (dir, up)', {
        size: 15, weight: '600',
    });
    body += text(20, 46,
        'Costs from the BFS word metric on the cube rotation group (orientationLowerBound).',
        { size: 11, fill: COLORS.muted, weight: '400' });

    cases.forEach((c, i) => {
        const ox = 16 + i * (panelW + 12);
        const oy = 62;
        const cost = orientationLowerBound(c.state.dir, c.state.up);
        body += `<rect x="${ox}" y="${oy}" width="${panelW}" height="${panelH}" ` +
            `rx="10" fill="#fff" stroke="${COLORS.grid}"/>`;
        body += text(ox + 14, oy + 24, c.title, { size: 13, weight: '600' });
        c.detailLines.forEach((line, li) => {
            body += text(ox + 14, oy + 44 + li * 14, line, {
                size: 11, fill: COLORS.muted, weight: '400',
            });
        });

        // Cube + arrows (reuse isometric sketch)
        const cx = ox + panelW / 2 - 4;
        const cy = oy + 120;
        const s = 30;
        const pts = {
            f00: [cx - s, cy + s * 0.3],
            f10: [cx + s, cy + s * 0.3],
            f01: [cx - s, cy - s * 0.9],
            f11: [cx + s, cy - s * 0.9],
            b00: [cx - s + 18, cy + s * 0.3 + 16],
            b10: [cx + s + 18, cy + s * 0.3 + 16],
            b01: [cx - s + 18, cy - s * 0.9 + 16],
            b11: [cx + s + 18, cy - s * 0.9 + 16],
        } as const;
        const poly = (keys: (keyof typeof pts)[], fill: string, opacity = 1) =>
            `<polygon points="${keys.map((k) => pts[k].join(',')).join(' ')}" ` +
            `fill="${fill}" fill-opacity="${opacity}" stroke="${COLORS.solidStroke}" stroke-width="1.2"/>`;
        body += poly(['f00', 'f10', 'b10', 'b00'], '#e5e7eb', 0.9);
        body += poly(['f00', 'f10', 'f11', 'f01'], '#f3f4f6', 0.95);
        body += poly(['f10', 'b10', 'b11', 'f11'], '#d1d5db', 0.9);
        if (eq(c.state.up, v(0, 1, 0))) {
            body += poly(['f01', 'f11', 'b11', 'b01'], '#93c5fd', 0.85);
        } else if (eq(c.state.up, v(0, -1, 0))) {
            body += poly(['f00', 'f10', 'b10', 'b00'], '#93c5fd', 0.9);
        } else {
            // yawed: rail still on top for curveLeft exit (up unchanged)
            body += poly(['f01', 'f11', 'b11', 'b01'], '#93c5fd', 0.85);
        }

        const origin = [cx + 6, cy + 2] as const;
        // dir: for start +X right; for curveLeft exit dir = -Z → toward viewer-ish (down-left in our iso)
        if (eq(c.state.dir, v(1, 0, 0))) {
            body += arrow(origin[0], origin[1], origin[0] + 36, origin[1], COLORS.dir, 'dir');
        } else if (eq(c.state.dir, v(0, 0, -1))) {
            body += arrow(origin[0], origin[1], origin[0] - 10, origin[1] + 28, COLORS.dir, 'dir');
        } else if (eq(c.state.dir, v(0, 0, 1))) {
            body += arrow(origin[0], origin[1], origin[0] + 22, origin[1] + 20, COLORS.dir, 'dir');
        }

        if (eq(c.state.up, v(0, 1, 0))) {
            body += arrow(origin[0], origin[1], origin[0], origin[1] - 36, COLORS.up, 'up');
        } else if (eq(c.state.up, v(0, -1, 0))) {
            body += arrow(origin[0], origin[1], origin[0], origin[1] + 36, COLORS.up, 'up');
        }

        body += text(ox + 14, oy + panelH - 16, `orientationLowerBound = ${cost}`, {
            size: 12, fill: cost === 4 ? COLORS.red : COLORS.ink, weight: '700',
        });
    });

    const w = 16 + 3 * (panelW + 12) + 4;
    const h = 62 + panelH + 24;
    return svgDoc(w, h, body);
};

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

mkdirSync(OUT, { recursive: true });

const figures: { file: string; svg: string }[] = [
    { file: 'track-state-frame.svg', svg: genTrackStateFrame() },
    { file: 'piece-motions.svg', svg: genPieceMotions() },
    { file: 'solid-vs-swing.svg', svg: genSolidVsSwing() },
    { file: 'orientation-debt.svg', svg: genOrientationDebt() },
];

for (const f of figures) {
    const path = join(OUT, f.file);
    writeFileSync(path, f.svg, 'utf8');
    console.log(`wrote ${path}`);
}

console.log(`\n${figures.length} figures → docs/images/`);
console.log('Re-run after piece-model changes: npx vite-node scripts/docs/gen-how-it-works-figures.ts');
