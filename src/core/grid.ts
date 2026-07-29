import { Vec3 } from './vec';
import { PiecePlacement } from './pieces';

// Packed integer cell key: ~10x cheaper than template strings in the
// generator's hot loop. Coordinates are bounded by track length (< ±512).
const B = 512;
const pack = (c: Vec3): number => (c.x + B) + ((c.y + B) << 10) + ((c.z + B) << 20);

/**
 * Occupancy grid tracking solid piece cells and "swing" cells (space the train
 * sweeps through). Swing cells may be shared between pieces, but a solid cell
 * can never overlap another solid or any swing cell.
 *
 * Everything must stay at y >= 0 (the floor).
 */
export class OccupancyGrid {
    private solids = new Map<number, number>(); // packed cell -> piece index
    private swings = new Map<number, number>(); // packed cell -> refcount

    public canPlace(p: PiecePlacement): boolean {
        for (const c of p.cells) {
            if (c.y < 0) return false;
            const k = pack(c);
            if (this.solids.has(k) || this.swings.has(k)) return false;
        }
        for (const c of p.swing) {
            if (c.y < 0) return false;
            if (this.solids.has(pack(c))) return false;
        }
        return true;
    }

    public place(p: PiecePlacement, pieceIndex: number): void {
        for (const c of p.cells) this.solids.set(pack(c), pieceIndex);
        for (const c of p.swing) {
            const k = pack(c);
            this.swings.set(k, (this.swings.get(k) ?? 0) + 1);
        }
    }

    public remove(p: PiecePlacement): void {
        for (const c of p.cells) this.solids.delete(pack(c));
        for (const c of p.swing) {
            const k = pack(c);
            const n = this.swings.get(k);
            if (n === undefined) continue;
            if (n <= 1) this.swings.delete(k);
            else this.swings.set(k, n - 1);
        }
    }

    public solidAt(c: Vec3): number | undefined {
        return this.solids.get(pack(c));
    }

    public isSolid(c: Vec3): boolean {
        return this.solids.has(pack(c));
    }

    public solidCount(): number {
        return this.solids.size;
    }
}
