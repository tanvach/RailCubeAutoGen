import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { PiecePlacement } from '../core/pieces';
import { cross } from '../core/vec';

/** Plastic colors sampled from the reference photos. */
export const COLORS = {
    start: 0xf5f2ec,
    straight: 0xf0c419,
    curveBlue: 0x74c3e8,   // left when face-up
    curveGreen: 0xa9cf38,  // right when face-up
    inner: 0xf29022,
    outer: 0xe64a41,
    cross: 0xb591dd,
    connector: 0xc9c8c4,
    metal: 0xb9babe,
    hole: 0x4a4038,
    socket: 0x555049,
    pillar: 0xd8d5cd,
} as const;

const plastic = (color: number) =>
    new THREE.MeshStandardMaterial({ color, roughness: 0.42, metalness: 0.02 });

const MATS = {
    start: plastic(COLORS.start),
    straight: plastic(COLORS.straight),
    blue: plastic(COLORS.curveBlue),
    green: plastic(COLORS.curveGreen),
    inner: plastic(COLORS.inner),
    outer: plastic(COLORS.outer),
    cross: plastic(COLORS.cross),
    connector: plastic(COLORS.connector),
    // Brushed steel: partial metalness keeps a visible diffuse sheen under
    // the scene lights instead of turning black away from reflections.
    metal: new THREE.MeshStandardMaterial({
        color: COLORS.metal, roughness: 0.3, metalness: 0.65, envMapIntensity: 1.4,
    }),
    hole: new THREE.MeshStandardMaterial({ color: COLORS.hole, roughness: 0.8 }),
    socket: new THREE.MeshStandardMaterial({ color: COLORS.socket, roughness: 0.7 }),
    pillar: plastic(COLORS.pillar),
    trainBody: plastic(0xfefefe),
    trainBand: plastic(0x3a76c4),
    trainDark: new THREE.MeshStandardMaterial({ color: 0x3c3c3e, roughness: 0.6 }),
};

const box = (w: number, h: number, d: number, mat: THREE.Material, x = 0, y = 0, z = 0, r = 0.03) => {
    const geo = new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 2, h / 2, d / 2));
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    return m;
};

const plainBox = (w: number, h: number, d: number, mat: THREE.Material, x = 0, y = 0, z = 0) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    return m;
};

/** Connector knob (gray four-vaned plug on exit faces). */
const knob = (x: number, y: number, z: number, axis: THREE.Vector3) => {
    const g = new THREE.Group();
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.26, 0.07, 20), MATS.connector);
    disc.castShadow = true;
    g.add(disc);
    for (let i = 0; i < 4; i++) {
        const vane = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.1, 0.44), MATS.connector);
        vane.rotation.y = (i * Math.PI) / 4;
        vane.position.y = 0.01;
        g.add(vane);
    }
    g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis.clone().normalize());
    g.position.set(x, y, z);
    return g;
};

/**
 * How far face decals (holes, sockets) stand proud of the surface they mark.
 * Must be comfortably above depth-buffer noise at typical viewing distances,
 * or the decal flickers (z-fights) while orbiting.
 */
const DECAL_PROUD = 0.012;

/**
 * Disc embedded in a face. `(x, y, z)` is a point ON the face and `out` its
 * outward normal; the helper positions the disc so its visible cap always
 * clears the face by exactly DECAL_PROUD. Callers pass true face coordinates —
 * hand-tuned offsets are how decals end up coplanar (flicker) or buried
 * (invisible / popping through).
 */
const faceDisc = (radius: number, mat: THREE.Material, x: number, y: number, z: number, out: THREE.Vector3) => {
    const h = 0.06;
    const m = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, h, radius > 0.1 ? 20 : 14), mat);
    const n = out.clone().normalize();
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), n);
    m.position.set(x, y, z).addScaledVector(n, DECAL_PROUD - h / 2);
    return m;
};

/** Gray connector socket disc on an entry face. */
const socket = (x: number, y: number, z: number, out: THREE.Vector3) =>
    faceDisc(0.27, MATS.socket, x, y, z, out);

/** Small dark support hole (round, like the photos). */
const hole = (x: number, y: number, z: number, out: THREE.Vector3) =>
    faceDisc(0.055, MATS.hole, x, y, z, out);

/** Extrude a 2D shape lying in the local XZ plane, spanning ly0..ly1 vertically. */
const extrudeFlat = (shape: THREE.Shape, ly0: number, ly1: number, mat: THREE.Material) => {
    const geo = new THREE.ExtrudeGeometry(shape, { depth: ly1 - ly0, bevelEnabled: false, curveSegments: 24 });
    // Shape (x, y) -> local (x, -z); extrusion +z -> local +y.
    geo.rotateX(-Math.PI / 2);
    geo.translate(0, ly0, 0);
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = true;
    m.receiveShadow = true;
    return m;
};

/** Ring sector shape around center (cx, cw) in shape coords. */
const ringSector = (cx: number, cw: number, r0: number, r1: number, a0: number, a1: number) => {
    const s = new THREE.Shape();
    s.absarc(cx, cw, r1, a0, a1, false);
    s.absarc(cx, cw, r0, a1, a0, true);
    s.closePath();
    return s;
};

/** Extrude a 2D profile lying in the local XY plane (thickness along Z). */
const extrudeProfile = (shape: THREE.Shape, thickness: number, mat: THREE.Material) => {
    const geo = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false, curveSegments: 24 });
    geo.translate(0, 0, -thickness / 2);
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = true;
    m.receiveShadow = true;
    return m;
};

// ---------------------------------------------------------------------------
// Piece builders. Local frame: entry cell center at origin, travel +X, rail
// face normal +Y. World placement rotates (X,Y,Z) -> (dir, up, dir x up).
// ---------------------------------------------------------------------------

const GROOVE_W = 0.32;      // groove width
const SHOULDER_TOP = 0.48;  // top surface height
const GROOVE_FLOOR = 0.38;  // groove floor height

// Outward face normals for decal placement.
const PX = new THREE.Vector3(1, 0, 0);
const NX = new THREE.Vector3(-1, 0, 0);
const PY = new THREE.Vector3(0, 1, 0);
const NY = new THREE.Vector3(0, -1, 0);
const PZ = new THREE.Vector3(0, 0, 1);
const NZ = new THREE.Vector3(0, 0, -1);

/** Straight groove segment along X: shoulders + metal strip, spanning x0..x1. */
const grooveAlongX = (g: THREE.Group, x0: number, x1: number, mat: THREE.Material, zc = 0) => {
    const len = x1 - x0;
    const cx = (x0 + x1) / 2;
    const sw = (0.96 - GROOVE_W) / 2;
    const sy = (GROOVE_FLOOR + SHOULDER_TOP) / 2;
    g.add(plainBox(len, SHOULDER_TOP - GROOVE_FLOOR, sw, mat, cx, sy, zc + GROOVE_W / 2 + sw / 2));
    g.add(plainBox(len, SHOULDER_TOP - GROOVE_FLOOR, sw, mat, cx, sy, zc - GROOVE_W / 2 - sw / 2));
    // The steel strip nearly fills the groove and sits just below the
    // shoulder tops, like the photos (not a deep dark channel).
    g.add(plainBox(len, 0.07, GROOVE_W - 0.06, MATS.metal, cx, GROOVE_FLOOR + 0.035, zc));
};

const buildStraightLike = (mat: THREE.Material, isStart: boolean) => {
    const g = new THREE.Group();
    g.add(box(0.98, GROOVE_FLOOR + 0.48, 0.96, mat, 0, (GROOVE_FLOOR - 0.48) / 2, 0, 0.05));
    grooveAlongX(g, -0.49, 0.49, mat);
    g.add(knob(0.5, 0, 0, PX));
    g.add(socket(-0.49, 0, 0, NX));       // entry face x = -0.49
    g.add(hole(0, 0, 0.48, PZ));          // side faces z = ±0.48
    g.add(hole(0, 0, -0.48, NZ));
    g.add(hole(0, -0.48, 0, NY));         // bottom face y = -0.48

    if (isStart) {
        // The real cube has one capsule sticker on a single shoulder, reading
        // along the rail with a red arrow pointing toward the exit (+X).
        const canvas = document.createElement('canvas');
        canvas.width = 512; canvas.height = 144;
        const ctx = canvas.getContext('2d');
        if (ctx) {
            ctx.clearRect(0, 0, 512, 144);
            ctx.fillStyle = '#faf8f4';
            ctx.strokeStyle = '#1d1d1f';
            ctx.lineWidth = 8;
            ctx.beginPath();
            ctx.roundRect(8, 8, 496, 128, 64);
            ctx.fill();
            ctx.stroke();
            ctx.fillStyle = '#cf2d24';
            ctx.font = 'bold 78px sans-serif';
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            ctx.fillText('START', 48, 78);
            // Drawn arrow (not a font glyph) pointing +X (the exit face).
            ctx.beginPath();
            ctx.moveTo(330, 60);
            ctx.lineTo(410, 60);
            ctx.lineTo(410, 36);
            ctx.lineTo(474, 72);
            ctx.lineTo(410, 108);
            ctx.lineTo(410, 84);
            ctx.lineTo(330, 84);
            ctx.closePath();
            ctx.fill();
            const tex = new THREE.CanvasTexture(canvas);
            tex.anisotropy = 4;
            const label = new THREE.Mesh(
                new THREE.PlaneGeometry(0.88, 0.2475),
                new THREE.MeshBasicMaterial({ map: tex, transparent: true }),
            );
            label.rotation.x = -Math.PI / 2;
            label.position.set(0, SHOULDER_TOP + DECAL_PROUD, -0.32);
            g.add(label);
        }
    }
    return g;
};

const buildCurve = (left: boolean) => {
    const g = new THREE.Group();
    // Arc pivot in local coords; sZ is the lateral sign (+Z = right side).
    const sZ = left ? -1 : 1;
    // Shape coords: (x, w) where w = -localZ. Pivot at (-0.5, -sZ * 1.5) in shape coords.
    const pw = -sZ * 1.5;
    const a0 = left ? -Math.PI / 2 : 0;
    const a1 = left ? 0 : Math.PI / 2;

    const topMat = left ? MATS.blue : MATS.green;
    const botMat = left ? MATS.green : MATS.blue;

    // The piece is flippable: groove, strip and holes exist on BOTH faces
    // (the two color halves are mirror images of each other).
    const body = ringSector(-0.5, pw, 1.02, 1.98, a0, a1);
    const shoulderIn = ringSector(-0.5, pw, 1.02, 1.34, a0, a1);
    const shoulderOut = ringSector(-0.5, pw, 1.66, 1.98, a0, a1);
    const stripRing = ringSector(-0.5, pw, 1.37, 1.63, a0, a1);

    g.add(extrudeFlat(body, -GROOVE_FLOOR, -0.02, botMat));
    g.add(extrudeFlat(body, -0.02, GROOVE_FLOOR, topMat));
    // Top face: shoulders leave the groove open at radius 1.34..1.66; the
    // steel strip nearly fills it, 0.03 below the shoulder tops.
    g.add(extrudeFlat(shoulderIn, GROOVE_FLOOR, SHOULDER_TOP, topMat));
    g.add(extrudeFlat(shoulderOut, GROOVE_FLOOR, SHOULDER_TOP, topMat));
    g.add(extrudeFlat(stripRing, GROOVE_FLOOR, SHOULDER_TOP - 0.03, MATS.metal));
    // Bottom face: mirror image.
    g.add(extrudeFlat(shoulderIn, -SHOULDER_TOP, -GROOVE_FLOOR, botMat));
    g.add(extrudeFlat(shoulderOut, -SHOULDER_TOP, -GROOVE_FLOOR, botMat));
    g.add(extrudeFlat(stripRing, -(SHOULDER_TOP - 0.03), -GROOVE_FLOOR, MATS.metal));

    // Connector knob at the exit face, socket at entry (face x = -0.5).
    g.add(knob(1.0, 0, sZ * 1.53, new THREE.Vector3(0, 0, sZ)));
    g.add(socket(-0.5, 0, 0, NX));

    // Shoulder holes on both faces, like the photos.
    for (const [r, angles] of [[1.82, [0.15, 0.42, 0.68, 0.95]], [1.18, [0.3, 0.85]]] as const) {
        for (const t of angles) {
            const ang = a0 + (a1 - a0) * t;
            const x = -0.5 + r * Math.cos(ang);
            const w = pw + r * Math.sin(ang);
            g.add(hole(x, SHOULDER_TOP, -w, PY));
            g.add(hole(x, -SHOULDER_TOP, -w, NY));
        }
    }
    return g;
};

const buildInner = () => {
    const g = new THREE.Group();
    // Profile in local XY: 2x2 block with concave carve of radius 1 at (-0.5, 1.5).
    const p = new THREE.Shape();
    p.moveTo(-0.5, -0.49);
    p.lineTo(1.5, -0.49);
    p.lineTo(1.5, 1.5);
    p.lineTo(0.5, 1.5);
    p.absarc(-0.5, 1.5, 1.0, 0, -Math.PI / 2, true);
    p.lineTo(-0.5, -0.49);

    // Side slabs (full profile) and a recessed middle where the groove runs.
    const sw = (0.96 - GROOVE_W) / 2;
    const side = extrudeProfile(p, sw, MATS.inner);
    side.position.z = GROOVE_W / 2 + sw / 2;
    g.add(side);
    const side2 = side.clone();
    side2.position.z = -(GROOVE_W / 2 + sw / 2);
    g.add(side2);

    // Middle body: same profile but carved 0.1 deeper (radius 1.1). Slightly
    // thicker than the groove so it overlaps the slabs (coplanar faces z-fight).
    const pm = new THREE.Shape();
    pm.moveTo(-0.5, -0.49);
    pm.lineTo(1.5, -0.49);
    pm.lineTo(1.5, 1.5);
    pm.lineTo(0.6, 1.5);
    pm.absarc(-0.5, 1.5, 1.1, 0, -Math.PI / 2, true);
    pm.lineTo(-0.5, -0.49);
    g.add(extrudeProfile(pm, GROOVE_W + 0.04, MATS.inner));

    // Metal strip: embedded in the groove floor (r 1.11), face 0.03 below
    // the carve surface (r 1.03) like the photos. The arc is inset a hair at
    // both ends so the strip's end caps never land exactly on the piece's
    // entry (x = -0.5) and top (y = 1.5) faces — coplanar metal-vs-orange
    // faces flicker.
    const aIn = 0.005;
    const strip = new THREE.Shape();
    strip.absarc(-0.5, 1.5, 1.11, -aIn, -Math.PI / 2 + aIn, true);
    strip.absarc(-0.5, 1.5, 1.03, -Math.PI / 2 + aIn, -aIn, false);
    strip.closePath();
    g.add(extrudeProfile(strip, GROOVE_W - 0.06, MATS.metal));

    g.add(knob(1.0, 1.5, 0, PY));
    g.add(socket(-0.5, 0, 0, NX));           // entry face x = -0.5

    // Support holes: one per solid cell on each flat face, like the physical
    // piece. Solid cell centers: (0,0), (1,0), (1,1). Faces: sides z = ±0.48,
    // bottom y = -0.49, far end x = 1.5.
    for (const [cx, cy] of [[0, 0], [1, 0], [1, 1]] as const) {
        g.add(hole(cx, cy, 0.48, PZ));       // front profile face
        g.add(hole(cx, cy, -0.48, NZ));      // back profile face
    }
    g.add(hole(0, -0.49, 0, NY));            // bottom, cell 0
    g.add(hole(1, -0.49, 0, NY));            // bottom, cell 1
    g.add(hole(1.5, 0, 0, PX));              // far end, lower cell
    g.add(hole(1.5, 1, 0, PX));              // far end, upper cell
    return g;
};

const OUTER_R = 0.55;
const OUTER_C = { x: 0.5 - OUTER_R, y: 0.5 - OUTER_R }; // fillet center (-0.05, -0.05)

/** Unit-square profile with the +X/+Y corner as a convex fillet. */
const outerProfile = (recess: number, yBottom: number) => {
    const r = OUTER_R - recess;
    const edge = 0.5 - recess;
    const s = new THREE.Shape();
    s.moveTo(-0.5, yBottom);
    s.lineTo(edge, yBottom);
    s.lineTo(edge, OUTER_C.y);
    s.absarc(OUTER_C.x, OUTER_C.y, r, 0, Math.PI / 2, false);
    s.lineTo(-0.5, edge);
    s.lineTo(-0.5, yBottom);
    return s;
};

const buildOuter = () => {
    const g = new THREE.Group();
    const sw = (0.96 - GROOVE_W) / 2;

    // Side slabs: the cube surface (fillet r=0.55, edges at 0.5).
    const slab = extrudeProfile(outerProfile(0, -0.49), sw, MATS.outer);
    slab.position.z = GROOVE_W / 2 + sw / 2;
    g.add(slab);
    const slab2 = slab.clone();
    slab2.position.z = -(GROOVE_W / 2 + sw / 2);
    g.add(slab2);

    // Groove floor: recessed 0.1 below the surface. Slightly thicker than the
    // groove so it overlaps the slabs — coplanar contact faces z-fight.
    g.add(extrudeProfile(outerProfile(0.1, -0.49), GROOVE_W + 0.04, MATS.outer));

    // Metal strip: embedded in the floor (r-0.11), face 0.03 below the
    // shoulder surface (r-0.03). Both ends stop a hair short of the entry
    // (x = -0.5) and exit (y = -0.49) faces — coplanar metal-vs-red end caps
    // flicker.
    const c = OUTER_C;
    const strip = new THREE.Shape();
    strip.moveTo(-0.495, c.y + OUTER_R - 0.11);
    strip.absarc(c.x, c.y, OUTER_R - 0.11, Math.PI / 2, 0, true);
    strip.lineTo(c.x + OUTER_R - 0.11, -0.485);
    strip.lineTo(c.x + OUTER_R - 0.03, -0.485);
    strip.lineTo(c.x + OUTER_R - 0.03, c.y);
    strip.absarc(c.x, c.y, OUTER_R - 0.03, 0, Math.PI / 2, false);
    strip.lineTo(-0.495, c.y + OUTER_R - 0.03);
    strip.closePath();
    g.add(extrudeProfile(strip, GROOVE_W - 0.06, MATS.metal));

    g.add(knob(0, -0.52, 0, NY));
    g.add(socket(-0.5, 0, 0, NX));           // entry face x = -0.5
    g.add(hole(0, 0, 0.48, PZ));             // side faces z = ±0.48
    g.add(hole(0, 0, -0.48, NZ));
    return g;
};

const buildCross = () => {
    const g = new THREE.Group();
    g.add(box(1.98, GROOVE_FLOOR + 0.48, 0.96, MATS.cross, 0.5, (GROOVE_FLOOR - 0.48) / 2, 0, 0.05));

    // Main groove along X (with a gap where the crossing groove passes at x=1).
    grooveAlongX(g, -0.49, 1 - GROOVE_W / 2, MATS.cross);
    grooveAlongX(g, 1 + GROOVE_W / 2, 1.49, MATS.cross);
    // Metal strip continues across the intersection.
    g.add(plainBox(GROOVE_W, 0.07, GROOVE_W - 0.06, MATS.metal, 1, GROOVE_FLOOR + 0.035, 0));

    // Crossing groove along Z at x=1: the segmented main shoulders already
    // leave the channel open; add the metal strip through it.
    const segLen = (0.96 - GROOVE_W) / 2;
    for (const zs of [1, -1]) {
        const zc = zs * (GROOVE_W / 2 + segLen / 2);
        g.add(plainBox(GROOVE_W - 0.06, 0.07, segLen, MATS.metal, 1, GROOVE_FLOOR + 0.035, zc));
    }

    g.add(knob(1.49, 0, 0, PX));             // half-embedded in exit face x = 1.49
    g.add(socket(-0.49, 0, 0, NX));          // entry face x = -0.49
    g.add(knob(1, 0, 0.48, PZ));             // crossing exit face z = 0.48
    g.add(socket(1, 0, -0.48, NZ));          // crossing entry face z = -0.48
    g.add(hole(0, 0, 0.48, PZ));             // side faces z = ±0.48
    g.add(hole(0, 0, -0.48, NZ));
    return g;
};

const BUILDERS: Record<string, () => THREE.Group> = {
    start: () => buildStraightLike(MATS.start, true),
    straight: () => buildStraightLike(MATS.straight, false),
    curveLeft: () => buildCurve(true),
    curveRight: () => buildCurve(false),
    inner: buildInner,
    outer: buildOuter,
    cross: buildCross,
};

/** World transform for a placement's local frame. */
export const placementMatrix = (p: PiecePlacement): THREE.Matrix4 => {
    const d = p.entry.dir;
    const n = p.entry.up;
    const r = cross(d, n); // local +Z in world
    const m = new THREE.Matrix4();
    m.makeBasis(
        new THREE.Vector3(d.x, d.y, d.z),
        new THREE.Vector3(n.x, n.y, n.z),
        new THREE.Vector3(r.x, r.y, r.z),
    );
    m.setPosition(p.entry.cell.x, p.entry.cell.y, p.entry.cell.z);
    return m;
};

/**
 * Multi-cell pieces are shrunk slightly about their footprint center so
 * adjacent pieces show a seam instead of merging into one continuous solid.
 */
const SEAM: Partial<Record<string, { scale: number; center: [number, number, number] }>> = {
    curveLeft: { scale: 0.98, center: [0, 0, -1] },
    curveRight: { scale: 0.98, center: [0, 0, 1] },
    inner: { scale: 0.98, center: [0.5, 0.5, 0] },
    cross: { scale: 0.98, center: [0.5, 0, 0] },
    outer: { scale: 0.97, center: [0, 0, 0] },
};

export const buildPieceMesh = (p: PiecePlacement): THREE.Group => {
    const mesh = BUILDERS[p.type]();
    let root = mesh;
    const seam = SEAM[p.type];
    if (seam) {
        root = new THREE.Group();
        const [cx, cy, cz] = seam.center;
        mesh.position.set(-cx, -cy, -cz);
        root.add(mesh);
        root.position.set(cx, cy, cz);
        root.scale.setScalar(seam.scale);
    }
    root.applyMatrix4(placementMatrix(p));
    return root;
};

// ---------------------------------------------------------------------------
// Rail path (for the animated train). Local-frame samples with surface normals.
// ---------------------------------------------------------------------------

export interface PathSample {
    pos: THREE.Vector3;
    up: THREE.Vector3;
}

const N_ARC = 14;

const localRail = (type: string): PathSample[] => {
    const out: PathSample[] = [];
    const push = (x: number, y: number, z: number, ux: number, uy: number, uz: number) =>
        out.push({ pos: new THREE.Vector3(x, y, z), up: new THREE.Vector3(ux, uy, uz) });

    switch (type) {
        case 'start':
        case 'straight':
            push(-0.5, 0.5, 0, 0, 1, 0);
            push(0.5, 0.5, 0, 0, 1, 0);
            break;
        case 'cross':
            push(-0.5, 0.5, 0, 0, 1, 0);
            push(1.5, 0.5, 0, 0, 1, 0);
            break;
        case 'curveLeft':
        case 'curveRight': {
            const sZ = type === 'curveLeft' ? -1 : 1;
            const M = new THREE.Vector3(-0.5, 0.5, sZ * 1.5);
            const u = new THREE.Vector3(0, 0, -sZ);
            const vv = new THREE.Vector3(1, 0, 0);
            for (let i = 0; i <= N_ARC; i++) {
                const t = (i / N_ARC) * (Math.PI / 2);
                const pos = M.clone()
                    .addScaledVector(u, 1.5 * Math.cos(t))
                    .addScaledVector(vv, 1.5 * Math.sin(t));
                push(pos.x, pos.y, pos.z, 0, 1, 0);
            }
            break;
        }
        case 'inner': {
            const C = new THREE.Vector3(-0.5, 1.5, 0);
            const u = new THREE.Vector3(0, -1, 0);
            const vv = new THREE.Vector3(1, 0, 0);
            for (let i = 0; i <= N_ARC; i++) {
                const t = (i / N_ARC) * (Math.PI / 2);
                const radial = u.clone().multiplyScalar(Math.cos(t)).addScaledVector(vv, Math.sin(t));
                const pos = C.clone().addScaledVector(radial, 1.0);
                push(pos.x, pos.y, pos.z, -radial.x, -radial.y, -radial.z);
            }
            break;
        }
        case 'outer': {
            push(-0.5, 0.5, 0, 0, 1, 0);
            const C = new THREE.Vector3(OUTER_C.x, OUTER_C.y, 0);
            const u = new THREE.Vector3(0, 1, 0);
            const vv = new THREE.Vector3(1, 0, 0);
            for (let i = 0; i <= N_ARC; i++) {
                const t = (i / N_ARC) * (Math.PI / 2);
                const radial = u.clone().multiplyScalar(Math.cos(t)).addScaledVector(vv, Math.sin(t));
                const pos = C.clone().addScaledVector(radial, OUTER_R);
                push(pos.x, pos.y, pos.z, radial.x, radial.y, radial.z);
            }
            push(0.5, -0.5, 0, 1, 0, 0);
            break;
        }
    }
    return out;
};

/** Rail samples in world space for one traversal step. */
export const railSamplesForStep = (
    p: PiecePlacement,
    kind: 'piece' | 'crossPass',
    stateDir?: { x: number; y: number; z: number },
): PathSample[] => {
    if (kind === 'crossPass' && p.crossingCell && stateDir) {
        // Straight line through the crossing cell, along the approach direction.
        const c = p.crossingCell;
        const n = p.entry.up;
        const base = new THREE.Vector3(c.x + n.x * 0.5, c.y + n.y * 0.5, c.z + n.z * 0.5);
        const d = new THREE.Vector3(stateDir.x, stateDir.y, stateDir.z);
        const up = new THREE.Vector3(n.x, n.y, n.z);
        return [
            { pos: base.clone().addScaledVector(d, -0.5), up },
            { pos: base.clone().addScaledVector(d, 0.5), up },
        ];
    }
    const m = placementMatrix(p);
    const rot = new THREE.Matrix3().setFromMatrix4(m);
    return localRail(p.type).map((s) => ({
        pos: s.pos.clone().applyMatrix4(m),
        up: s.up.clone().applyMatrix3(rot),
    }));
};

// ---------------------------------------------------------------------------
// Train and supports.
// ---------------------------------------------------------------------------

export const buildTrain = (): THREE.Group => {
    const g = new THREE.Group();
    // Magnetic runner: reaches down through the groove to the strip surface
    // (0.05 below the rail plane the train origin rides on).
    g.add(plainBox(0.46, 0.09, 0.24, MATS.trainDark, 0, -0.005, 0));
    // Blue skirt band around the base.
    g.add(box(0.66, 0.1, 0.38, MATS.trainBand, 0, 0.09, 0, 0.03));
    // White body with a cabin hump.
    g.add(box(0.62, 0.26, 0.34, MATS.trainBody, 0, 0.26, 0, 0.1));
    g.add(box(0.3, 0.1, 0.3, MATS.trainBody, -0.08, 0.42, 0, 0.05));
    // Windows: shallow insets proud of each side, not slabs cut through the
    // whole body (those read as a dark plane slicing the model).
    for (const zs of [1, -1]) {
        for (const x of [0.14, -0.02, -0.18]) {
            g.add(box(0.11, 0.1, 0.02, MATS.trainDark, x, 0.31, zs * 0.17, 0.01));
        }
    }
    // Windshield at the front.
    g.add(box(0.02, 0.1, 0.2, MATS.trainDark, 0.31, 0.31, 0, 0.01));
    return g;
};

export const buildPillar = (x: number, z: number, cellBottomY: number): THREE.Group => {
    const g = new THREE.Group();
    const h = cellBottomY + 0.5; // from ground plane (-0.5) to the cell bottom
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, h, 10), MATS.pillar);
    shaft.position.set(x, -0.5 + h / 2, z);
    shaft.castShadow = true;
    g.add(shaft);
    const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 0.06, 12), MATS.pillar);
    foot.position.set(x, -0.47, z);
    g.add(foot);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.06, 0.16), MATS.pillar);
    head.position.set(x, -0.5 + h - 0.03, z);
    g.add(head);
    return g;
};
