import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { PiecePlacement, Step } from '../core/pieces';
import { key } from '../core/vec';
import { buildPieceMesh, buildTrain, buildPillar, railSamplesForStep, PathSample } from './meshes';

const WORLD_UP = new THREE.Vector3(0, 1, 0);

export interface TrackScene {
    pieces: PiecePlacement[];
    steps: Step[];
}

export class SceneController {
    private scene = new THREE.Scene();
    private camera: THREE.PerspectiveCamera;
    private renderer: THREE.WebGLRenderer;
    private controls: OrbitControls;
    private trackGroup = new THREE.Group();
    private train = buildTrain();

    // Arc-length parameterized rail path for the train.
    private path: PathSample[] = [];
    private cumLen: number[] = [];
    private totalLen = 0;
    private trainDist = 0;
    private lastTime = performance.now();
    public trainSpeed = 1.6; // cells per second
    private showTrain = true;
    private bounds: THREE.Box3 | null = null;
    private userAdjusted = false;

    private fill = new THREE.DirectionalLight(0xffffff, 2);

    /** Camera offset direction: the -X/+Z quadrant, so START reads pointing right. */
    private static readonly VIEW_DIR = new THREE.Vector3(-0.8, 0.75, 1.15);

    constructor(container: HTMLElement) {
        this.scene.background = new THREE.Color(0xe8eef4);
        this.scene.fog = new THREE.Fog(0xe8eef4, 40, 90);

        this.camera = new THREE.PerspectiveCamera(
            50, container.clientWidth / container.clientHeight, 0.1, 200,
        );
        this.camera.position.set(9, 8, 11);

        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        // Phones are usually 3x DPR; rendering that many pixels costs frames
        // for little visible gain on a small panel.
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, window.innerWidth < 768 ? 1.5 : 2));
        this.renderer.setSize(container.clientWidth, container.clientHeight);
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        container.appendChild(this.renderer.domElement);

        // Environment map so the polished steel strips have something to
        // reflect (pure lights leave metals nearly black).
        const pmrem = new THREE.PMREMGenerator(this.renderer);
        this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
        pmrem.dispose();

        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.maxPolarAngle = Math.PI * 0.55;
        // Fires on user input only, so auto-framing can defer to a hand-set view.
        this.controls.addEventListener('start', () => { this.userAdjusted = true; });

        // Lights
        this.scene.add(new THREE.HemisphereLight(0xffffff, 0xc8bfae, 0.9));
        const sun = new THREE.DirectionalLight(0xfff4e0, 1.6);
        sun.position.set(12, 22, 8);
        sun.castShadow = true;
        sun.shadow.mapSize.set(2048, 2048);
        sun.shadow.camera.left = -25;
        sun.shadow.camera.right = 25;
        sun.shadow.camera.top = 25;
        sun.shadow.camera.bottom = -25;
        sun.shadow.bias = -0.0004;
        this.scene.add(sun);

        // Orbiting to the far side of a track leaves every face the camera can
        // see on the sun's dark side. This fill tracks the camera (see aimFill)
        // so whatever you turn toward stays readable.
        this.scene.add(this.fill, this.fill.target);

        // Ground (cells rest with their bottoms at y = -0.5)
        const ground = new THREE.Mesh(
            new THREE.PlaneGeometry(300, 300),
            new THREE.MeshStandardMaterial({ color: 0xf2efe8, roughness: 0.95 }),
        );
        ground.rotation.x = -Math.PI / 2;
        ground.position.y = -0.5;
        ground.receiveShadow = true;
        this.scene.add(ground);

        const grid = new THREE.GridHelper(60, 60, 0xd0ccc0, 0xdedacd);
        grid.position.y = -0.495;
        this.scene.add(grid);

        this.scene.add(this.trackGroup);
        this.train.visible = false;
        this.scene.add(this.train);

        new ResizeObserver(() => this.onResize(container)).observe(container);
        this.animate();
    }

    public renderTrack(track: TrackScene | null) {
        this.trackGroup.clear();
        this.path = [];
        this.cumLen = [];
        this.totalLen = 0;
        this.trainDist = 0;
        this.train.visible = false;
        this.bounds = null;
        this.userAdjusted = false;
        if (!track || track.pieces.length === 0) return;

        for (const piece of track.pieces) {
            this.trackGroup.add(buildPieceMesh(piece));
        }

        // Support pillars under elevated pieces (visual only).
        this.addSupports(track.pieces);

        // Rail path following traversal order.
        this.buildPath(track);
        this.syncTrainVisibility();

        this.fitCamera();
    }

    /** Show or hide the animated train (hidden = no distraction on the track). */
    public setShowTrain(on: boolean) {
        this.showTrain = on;
        this.syncTrainVisibility();
    }

    private syncTrainVisibility() {
        this.train.visible = this.showTrain && this.path.length > 1;
        if (this.train.visible) this.placeTrain(this.trainDist);
    }

    private addSupports(pieces: PiecePlacement[]) {
        const solid = new Set<string>();
        const blocked = new Set<string>(); // pillars must not pass through these
        for (const p of pieces) {
            for (const c of p.cells) { solid.add(key(c)); blocked.add(key(c)); }
            for (const c of p.swing) blocked.add(key(c));
        }
        const columns = new Set<string>();

        // Minimal supports: connectors hold short spans, so only prop up long
        // floating runs. Walk the loop in order; a piece resting on the ground
        // or on another cell resets the run, and every third consecutive
        // floating piece gets one pillar.
        let floating = 0;
        for (const p of pieces) {
            const anchored = p.cells.some(
                (c) => c.y === 0 || solid.has(key({ x: c.x, y: c.y - 1, z: c.z })),
            );
            if (anchored) { floating = 0; continue; }
            floating++;
            if (floating < 3) continue;
            // Don't attach to the running face: skip pieces whose rail faces down.
            if (p.entry.up.y < 0 || p.exit.up.y < 0) continue;
            for (const c of p.cells) {
                if (c.y <= 0) continue;
                // Only the lowest cell of this piece in its column.
                if (p.cells.some((o) => o.x === c.x && o.z === c.z && o.y < c.y)) continue;
                const colKey = `${c.x},${c.z}`;
                if (columns.has(colKey)) continue;
                // Column below must be completely empty.
                let clear = true;
                for (let y = c.y - 1; y >= 0; y--) {
                    if (blocked.has(key({ x: c.x, y, z: c.z }))) { clear = false; break; }
                }
                if (!clear) continue;
                columns.add(colKey);
                this.trackGroup.add(buildPillar(c.x, c.z, c.y - 0.5));
                floating = 0;
                break;
            }
        }
    }

    private buildPath(track: TrackScene) {
        // Reconstruct the traversal direction for cross passes.
        let dir = { x: 1, y: 0, z: 0 };
        let up = { x: 0, y: 1, z: 0 };
        const pts: PathSample[] = [];
        for (const step of track.steps) {
            const piece = track.pieces[step.pieceIndex];
            const samples = railSamplesForStep(piece, step.kind, dir);
            for (const s of samples) {
                const last = pts[pts.length - 1];
                if (last && last.pos.distanceToSquared(s.pos) < 1e-8) continue;
                pts.push(s);
            }
            if (step.kind === 'piece') {
                dir = piece.exit.dir;
                up = piece.exit.up;
            }
        }
        void up;
        this.path = pts;
        this.cumLen = [0];
        for (let i = 1; i < pts.length; i++) {
            this.totalLen += pts[i].pos.distanceTo(pts[i - 1].pos);
            this.cumLen.push(this.totalLen);
        }
    }

    private placeTrain(dist: number) {
        if (this.path.length < 2 || this.totalLen === 0) return;
        const d = ((dist % this.totalLen) + this.totalLen) % this.totalLen;
        let i = this.cumLen.findIndex((l) => l > d);
        if (i <= 0) i = 1;
        const t = (d - this.cumLen[i - 1]) / (this.cumLen[i] - this.cumLen[i - 1]);

        const a = this.path[i - 1];
        const b = this.path[i];
        const pos = a.pos.clone().lerp(b.pos, t);
        const upv = a.up.clone().lerp(b.up, t).normalize();
        const fwd = b.pos.clone().sub(a.pos).normalize();

        const right = new THREE.Vector3().crossVectors(fwd, upv).normalize();
        const trueUp = new THREE.Vector3().crossVectors(right, fwd).normalize();
        const m = new THREE.Matrix4().makeBasis(fwd, trueUp, right);
        this.train.quaternion.setFromRotationMatrix(m);
        this.train.position.copy(pos);
    }

    private fitCamera() {
        const bbox = new THREE.Box3().setFromObject(this.trackGroup);
        if (bbox.isEmpty()) return;
        this.bounds = bbox;
        const center = bbox.getCenter(new THREE.Vector3());
        const size = bbox.getSize(new THREE.Vector3());
        const roomy = SceneController.VIEW_DIR.length() * (Math.max(size.x, size.y, size.z) * 0.72 + 3);
        // A mostly flat track foreshortens into a thin band from a low angle,
        // which wastes a squarish (portrait phone) frame — tilt further up as
        // the canvas gets narrower. Wide canvases keep the original angle.
        const narrow = THREE.MathUtils.clamp((1.7 - this.camera.aspect) / 0.6, 0, 1);
        const dir = SceneController.VIEW_DIR.clone();
        dir.y += narrow * 0.85;
        dir.normalize();
        this.controls.target.copy(center);
        // Keep the roomy framing where it fits; a narrow canvas (portrait
        // phone) sees less width at the same distance, so pull back instead.
        this.camera.position.copy(center)
            .addScaledVector(dir, Math.max(roomy, this.fitDistance(center, dir)));
        this.controls.update();
    }

    /**
     * Nearest distance from `center` along `dir` that keeps every corner of the
     * track bounds inside the frustum. On portrait phones the horizontal field
     * of view is the tight constraint, so this is what prevents cropping.
     */
    private fitDistance(center: THREE.Vector3, dir: THREE.Vector3): number {
        if (!this.bounds) return 0;
        const tanV = Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2);
        const tanH = tanV * this.camera.aspect;
        const right = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 1, 0));
        if (right.lengthSq() < 1e-6) right.set(1, 0, 0);
        right.normalize();
        const up = new THREE.Vector3().crossVectors(right, dir).normalize();

        // A corner at depth (d - along) must satisfy |lateral| <= tan * depth.
        const p = new THREE.Vector3();
        let need = 0;
        for (let i = 0; i < 8; i++) {
            p.set(
                i & 1 ? this.bounds.max.x : this.bounds.min.x,
                i & 2 ? this.bounds.max.y : this.bounds.min.y,
                i & 4 ? this.bounds.max.z : this.bounds.min.z,
            ).sub(center);
            const lateral = Math.max(Math.abs(p.dot(right)) / tanH, Math.abs(p.dot(up)) / tanV);
            need = Math.max(need, p.dot(dir) + lateral);
        }
        return need * 1.06;
    }

    /**
     * Hold the fill over the viewer's left shoulder, off-axis enough to still
     * shade the pieces rather than flatten them like a headlight. It stays at a
     * fixed intensity: the sunlit side already renders at full brightness, so
     * the extra light only shows up where the sun doesn't reach.
     */
    private aimFill() {
        const offset = this.camera.position.clone().sub(this.controls.target);
        const dist = offset.length();
        if (dist < 1e-6) return;
        const dir = offset.divideScalar(dist);
        const right = new THREE.Vector3().crossVectors(dir, WORLD_UP);
        if (right.lengthSq() < 1e-6) right.set(1, 0, 0);
        right.normalize();
        const up = new THREE.Vector3().crossVectors(right, dir).normalize();
        this.fill.position.copy(this.camera.position)
            .addScaledVector(right, -0.55 * dist)
            .addScaledVector(up, 0.5 * dist);
        this.fill.target.position.copy(this.controls.target);
    }

    /** After a resize or device rotation, pull back if the track would crop. */
    private keepInView() {
        if (!this.bounds) return;
        const offset = this.camera.position.clone().sub(this.controls.target);
        const dist = offset.length();
        if (dist < 1e-6) return;
        const dir = offset.divideScalar(dist);
        const need = this.fitDistance(this.controls.target, dir);
        if (dist >= need) return;
        this.camera.position.copy(this.controls.target).addScaledVector(dir, need);
        this.controls.update();
    }

    /** Capture the current viewport as a small JPEG data URL (for favorites). */
    public captureThumbnail(width = 320, height = 200): string {
        // Render synchronously so the drawing buffer is valid for readback.
        this.renderer.render(this.scene, this.camera);
        const src = this.renderer.domElement;
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return '';
        // Cover-fit the viewport into the thumbnail.
        const scale = Math.max(width / src.width, height / src.height);
        const w = src.width * scale;
        const h = src.height * scale;
        ctx.drawImage(src, (width - w) / 2, (height - h) / 2, w, h);
        return canvas.toDataURL('image/jpeg', 0.75);
    }

    private onResize(container: HTMLElement) {
        if (container.clientWidth < 2 || container.clientHeight < 2) return;
        this.camera.aspect = container.clientWidth / container.clientHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(container.clientWidth, container.clientHeight);
        // Re-frame on rotation / window changes, but never override a view the
        // user set by hand — then just make sure nothing gets cropped.
        if (this.userAdjusted) this.keepInView();
        else this.fitCamera();
    }

    private animate = () => {
        requestAnimationFrame(this.animate);
        const now = performance.now();
        const dt = Math.min((now - this.lastTime) / 1000, 0.1);
        this.lastTime = now;
        if (this.train.visible) {
            this.trainDist += dt * this.trainSpeed;
            this.placeTrain(this.trainDist);
        }
        this.controls.update();
        this.aimFill();
        this.renderer.render(this.scene, this.camera);
    };
}
