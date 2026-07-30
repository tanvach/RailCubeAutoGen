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

const drawPlacement = (
    p: Projector, placement: PiecePlacement, solidFill: string,
    opts: { swing?: boolean; frameLabels?: boolean; exitFrame?: boolean } = {},
) => {
    const frameLabels = opts.frameLabels !== false;
    const exitFrame = opts.exitFrame !== false;
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
    // Compact unlabeled arrows when labels would sit inside cells (occupancy figs).
    const al = frameLabels ? p.half * 0.95 : p.half * 0.55;
    const d = p.dirScreen(placement.entry.dir, al);
    const u = p.dirScreen(placement.entry.up, al);
    out += arrow(e.x, e.y, e.x + d.x, e.y + d.y, COLORS.dir, frameLabels ? 'dir' : undefined);
    const upDrawn = arrow(e.x, e.y, e.x + u.x, e.y + u.y, COLORS.up, frameLabels ? 'up' : undefined);
    if (!upDrawn && frameLabels) out += outOfPlaneUp(e.x, e.y);
    else if (upDrawn) out += upDrawn;
    if (exitFrame) {
        const exitAl = p.half * 0.7;
        const ed = p.dirScreen(placement.exit.dir, exitAl);
        const eu = p.dirScreen(placement.exit.up, exitAl);
        out += arrow(x.x, x.y, x.x + ed.x, x.y + ed.y, COLORS.dir);
        const exitUp = arrow(x.x, x.y, x.x + eu.x, x.y + eu.y, COLORS.up);
        if (!exitUp && frameLabels) out += outOfPlaneUp(x.x, x.y);
        else if (exitUp) out += exitUp;
    }
    return out;
};

const legendDot = (x: number, y: number, fill: string, stroke: string, label: string, dash = false) =>
    `<rect x="${x}" y="${y - 6}" width="12" height="12" rx="2" fill="${fill}" ` +
    `stroke="${stroke}" stroke-width="1.2"${dash ? ` stroke-dasharray="3 2"` : ''}/>` +
    text(x + 18, y + 4, label, { size: 11, fill: COLORS.muted, weight: '400' });

/**
 * Isometric cube sketch. Convention (matches the drawn offsets):
 *   +x → right along the front face
 *   +y → up the page
 *   +z → depth, down-right (toward the back face)
 * So: front = −z face, back = +z face, right = +x face, top = +y face.
 */
const isoAxisScreen = (d: Vec3, len: number) => ({
    x: d.x * len + d.z * len * 0.55,
    y: -d.y * len + d.z * len * 0.48,
});

const drawIsoCube = (cx: number, cy: number, state: TrackState, size = 28) => {
    const s = size;
    const dzx = 18 * (size / 28), dzy = 16 * (size / 28);
    const pts = {
        // front (−z): f{x}{y}
        f00: [cx - s, cy + s * 0.3],
        f10: [cx + s, cy + s * 0.3],
        f01: [cx - s, cy - s * 0.9],
        f11: [cx + s, cy - s * 0.9],
        // back (+z)
        b00: [cx - s + dzx, cy + s * 0.3 + dzy],
        b10: [cx + s + dzx, cy + s * 0.3 + dzy],
        b01: [cx - s + dzx, cy - s * 0.9 + dzy],
        b11: [cx + s + dzx, cy - s * 0.9 + dzy],
    } as const;
    const poly = (keys: (keyof typeof pts)[], fill: string, opacity = 1) =>
        `<polygon points="${keys.map((k) => pts[k].join(',')).join(' ')}" ` +
        `fill="${fill}" fill-opacity="${opacity}" stroke="${COLORS.solidStroke}" stroke-width="1.2"/>`;

    // Draw order: far faces first. Bottom (−y), back (+z), then front (−z), right (+x).
    let out = poly(['f00', 'f10', 'b10', 'b00'], '#e5e7eb', 0.9); // −y
    out += poly(['b00', 'b10', 'b11', 'b01'], '#dbe3ee', 0.85); // +z (back)
    out += poly(['f00', 'f10', 'f11', 'f01'], '#f3f4f6', 0.95); // −z (front)
    out += poly(['f10', 'b10', 'b11', 'f11'], '#d1d5db', 0.9); // +x

    // Rail face = face whose outward normal is `up`.
    const rail = '#93c5fd';
    if (eq(state.up, v(0, 1, 0))) out += poly(['f01', 'f11', 'b11', 'b01'], rail, 0.9); // +y
    else if (eq(state.up, v(0, -1, 0))) out += poly(['f00', 'f10', 'b10', 'b00'], rail, 0.95); // −y
    else if (eq(state.up, v(0, 0, 1))) out += poly(['b00', 'b10', 'b11', 'b01'], rail, 0.95); // +z
    else if (eq(state.up, v(0, 0, -1))) out += poly(['f00', 'f10', 'f11', 'f01'], rail, 0.95); // −z
    else if (eq(state.up, v(1, 0, 0))) out += poly(['f10', 'b10', 'b11', 'f11'], rail, 0.95); // +x
    else if (eq(state.up, v(-1, 0, 0))) out += poly(['f00', 'b00', 'b01', 'f01'], rail, 0.95); // −x

    const origin = [cx + 4, cy + 2] as const;
    const al = size * 1.15;
    const d = isoAxisScreen(state.dir, al);
    const u = isoAxisScreen(state.up, al);
    out += arrow(origin[0], origin[1], origin[0] + d.x, origin[1] + d.y, COLORS.dir, 'dir');
    out += arrow(origin[0], origin[1], origin[0] + u.x, origin[1] + u.y, COLORS.up, 'up');
    return out;
};

// ---------------------------------------------------------------------------
// Figure 1 — TrackState as a frame (§2)
// ---------------------------------------------------------------------------

const genTrackStateFrame = () => {
    const panelW = 200;
    const panelH = 220;
    const cases: { title: string; state: TrackState; note: string }[] = [
        {
            title: 'Floor',
            state: { cell: v(0, 0, 0), dir: v(1, 0, 0), up: v(0, 1, 0) },
            note: 'rail on +y face',
        },
        {
            // Use −z so the rail face is the visible front of this isometric sketch
            // (+z is the hidden back face under the same camera).
            title: 'Wall',
            state: { cell: v(0, 0, 0), dir: v(1, 0, 0), up: v(0, 0, -1) },
            note: 'rail on −z face (toward camera)',
        },
        {
            title: 'Ceiling',
            state: { cell: v(0, 0, 0), dir: v(1, 0, 0), up: v(0, -1, 0) },
            note: 'rail on −y face',
        },
    ];

    let body = text(24, 28, 'Same cell, same heading — three different frames', {
        size: 15, weight: '600',
    });
    body += text(24, 48,
        'dir = travel; up = rail normal toward the train. Axes: +x →, +y ↑, +z ↘ (away from camera).',
        { size: 12, fill: COLORS.muted, weight: '400' });

    cases.forEach((c, i) => {
        const ox = 24 + i * panelW;
        const oy = 70;
        body += `<rect x="${ox}" y="${oy}" width="${panelW - 16}" height="${panelH}" ` +
            `rx="10" fill="#fff" stroke="${COLORS.grid}" stroke-width="1"/>`;
        body += text(ox + 14, oy + 24, c.title, { size: 14, weight: '600' });
        body += text(ox + 14, oy + 42, c.note, { size: 11, fill: COLORS.muted, weight: '400' });
        body += drawIsoCube(ox + (panelW - 16) / 2 - 4, oy + 118, c.state);
        body += text(ox + 14, oy + panelH - 14,
            `dir=(1,0,0)  up=(${c.state.up.x},${c.state.up.y},${c.state.up.z})`, {
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
        body += text(ox + 12, oy + 38,
            meta.view === 'top' ? 'top-down xz · +x→ +z↓' : 'side xy · +x→ +y↑', {
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
    const panelH = 248;

    let body = text(20, 26, 'Solids never overlap; swing cells may be shared', {
        size: 15, weight: '600',
    });
    body += text(20, 46,
        'Amber dashed = swing. Colored fill = solid. Left/middle from computePlacement; right is the share rule.',
        { size: 11, fill: COLORS.muted, weight: '400' });

    // Axis key drawn outside the crowded cell grid so labels never sit on arrows.
    const axisKey = (ox: number, oy: number) =>
        text(ox + 14, oy + 56, 'blue → dir', {
            size: 10, fill: COLORS.dir, weight: '500',
        }) +
        text(ox + 90, oy + 56, 'green → up', {
            size: 10, fill: COLORS.up, weight: '500',
        });

    type Panel = { title: string; subtitle: string; build: (ox: number, oy: number) => string };
    const panels: Panel[] = [
        {
            title: 'Straight',
            subtitle: '1 solid + 1 swing above',
            build: (ox, oy) => {
                const placement = computePlacement('straight', START_STATE);
                const p = sideView(ox + 50, oy + 72, 36, 1.5);
                let out = axisKey(ox, oy);
                for (const c of [v(0, 0, 0), v(0, 1, 0), v(1, 0, 0)]) {
                    const pt = p.center(c);
                    out += `<rect x="${r(pt.x - p.half)}" y="${r(pt.y - p.half)}" width="36" height="36" ` +
                        `fill="none" stroke="${COLORS.grid}"/>`;
                }
                out += drawPlacement(p, placement, COLORS.yellow, {
                    swing: true, frameLabels: false, exitFrame: false,
                });
                out += text(ox + 14, oy + 218, 'side xy · +x→ +y↑', {
                    size: 10, fill: COLORS.muted, weight: '400',
                });
                return out;
            },
        },
        {
            // Outer’s swings lie in the dir/up plane, so they are drawable here.
            // Curve L’s swings sit at +up out of a top-down view — that panel was
            // claiming amber cells it never drew.
            title: 'Outer',
            subtitle: '1 solid + 3 corner swings',
            build: (ox, oy) => {
                const placement = computePlacement('outer', START_STATE);
                const p = sideView(ox + 44, oy + 72, 32, 1.5);
                let out = axisKey(ox, oy);
                for (let x = 0; x <= 1; x++) {
                    for (let y = -1; y <= 1; y++) {
                        const pt = p.center(v(x, y, 0));
                        out += `<rect x="${r(pt.x - p.half)}" y="${r(pt.y - p.half)}" width="32" height="32" ` +
                            `fill="none" stroke="${COLORS.grid}"/>`;
                    }
                }
                out += drawPlacement(p, placement, COLORS.red, {
                    swing: true, frameLabels: false, exitFrame: false,
                });
                out += text(ox + 14, oy + 218, 'side xy · swings from computePlacement', {
                    size: 10, fill: COLORS.muted, weight: '400',
                });
                return out;
            },
        },
        {
            title: 'Shared swing slot',
            subtitle: 'Two rails, one clearance cell',
            build: (ox, oy) => {
                // Rule schematic: facing rails both claim the middle swing cell.
                // Labels sit above the row; arrows run below them so nothing crosses text.
                const p = topDown(ox + 40, oy + 88, 44);
                let out = '';
                const left = v(0, 0, 0);
                const swing = v(1, 0, 0);
                const right = v(2, 0, 0);
                const lc = p.center(left), rc = p.center(right), sc = p.center(swing);
                out += text(lc.x, oy + 78, 'rail', {
                    size: 11, fill: COLORS.blue, weight: '700', anchor: 'middle',
                });
                out += text(sc.x, oy + 78, 'swing', {
                    size: 11, fill: COLORS.swingStroke, weight: '700', anchor: 'middle',
                });
                out += text(rc.x, oy + 78, 'rail', {
                    size: 11, fill: COLORS.green, weight: '700', anchor: 'middle',
                });
                for (const c of [left, swing, right]) {
                    const pt = p.center(c);
                    out += `<rect x="${r(pt.x - p.half)}" y="${r(pt.y - p.half)}" width="44" height="44" ` +
                        `fill="none" stroke="${COLORS.grid}"/>`;
                }
                out += cellRect(p, left, COLORS.blue, COLORS.solidStroke);
                out += cellRect(p, right, COLORS.green, COLORS.solidStroke);
                out += cellRect(p, swing, COLORS.swing, COLORS.swingStroke, true);
                // Opposing up normals into the shared cell — below the label row.
                out += arrow(lc.x + 12, lc.y, sc.x - 10, sc.y, COLORS.up);
                out += arrow(rc.x - 12, rc.y, sc.x + 10, sc.y, COLORS.up);
                out += text(ox + 14, oy + 218, 'rule schematic — see photo below', {
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
    const panelH = 242;
    let body = text(20, 26, 'Orientation debt: fewest pieces to realign (dir, up)', {
        size: 15, weight: '600',
    });
    body += text(20, 46,
        'From orientationLowerBound. Sketch axes: +x →, +y ↑, +z ↘. Cost 1 uses curveLeft’s exit frame.',
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

        body += drawIsoCube(ox + panelW / 2 - 4, oy + 128, c.state, 30);
        body += text(ox + 14, oy + panelH - 28,
            `dir=(${c.state.dir.x},${c.state.dir.y},${c.state.dir.z})  up=(${c.state.up.x},${c.state.up.y},${c.state.up.z})`, {
                size: 11, fill: COLORS.muted, weight: '400',
            });
        body += text(ox + 14, oy + panelH - 12, `orientationLowerBound = ${cost}`, {
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

// Sanity checks against the live model — fail loud if a figure would lie.
{
    const cl = computePlacement('curveLeft', START_STATE);
    const expectCells = (t: PieceType, n: number, swing: number) => {
        const p = computePlacement(t, START_STATE);
        if (p.cells.length !== n || p.swing.length !== swing) {
            throw new Error(`${t}: expected ${n} cells / ${swing} swing, got ${p.cells.length}/${p.swing.length}`);
        }
    };
    expectCells('straight', 1, 1);
    expectCells('curveLeft', 4, 4);
    expectCells('inner', 4, 0);
    expectCells('outer', 1, 3);
    expectCells('cross', 2, 2);
    if (orientationLowerBound(START_STATE.dir, START_STATE.up) !== 0) throw new Error('start cost');
    if (orientationLowerBound(cl.exit.dir, cl.exit.up) !== 1) throw new Error('curveLeft exit cost');
    if (orientationLowerBound(v(1, 0, 0), v(0, -1, 0)) !== 4) throw new Error('ceiling cost');
    // Iso mapping: +z screen delta must be down-right, −z up-left.
    const plusZ = isoAxisScreen(v(0, 0, 1), 10);
    const minusZ = isoAxisScreen(v(0, 0, -1), 10);
    if (!(plusZ.x > 0 && plusZ.y > 0)) throw new Error('+z should project down-right');
    if (!(minusZ.x < 0 && minusZ.y < 0)) throw new Error('−z should project up-left');
}

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
