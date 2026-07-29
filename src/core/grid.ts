import { Vec3, key } from './vec';
import { PiecePlacement } from './pieces';

/**
 * Occupancy grid tracking solid piece cells and "swing" cells (space the train
 * sweeps through). Swing cells may be shared between pieces, but a solid cell
 * can never overlap another solid or any swing cell.
 *
 * Everything must stay at y >= 0 (the floor).
 */
export class OccupancyGrid {
    private solids = new Map<string, number>(); // cell -> piece index
    private swings = new Map<string, number>(); // cell -> refcount

    public canPlace(p: PiecePlacement): boolean {
        for (const c of p.cells) {
            if (c.y < 0) return false;
            const k = key(c);
            if (this.solids.has(k) || this.swings.has(k)) return false;
        }
        for (const c of p.swing) {
            if (c.y < 0) return false;
            if (this.solids.has(key(c))) return false;
        }
        return true;
    }

    public place(p: PiecePlacement, pieceIndex: number): void {
        for (const c of p.cells) this.solids.set(key(c), pieceIndex);
        for (const c of p.swing) {
            const k = key(c);
            this.swings.set(k, (this.swings.get(k) ?? 0) + 1);
        }
    }

    public remove(p: PiecePlacement): void {
        for (const c of p.cells) this.solids.delete(key(c));
        for (const c of p.swing) {
            const k = key(c);
            const n = this.swings.get(k);
            if (n === undefined) continue;
            if (n <= 1) this.swings.delete(k);
            else this.swings.set(k, n - 1);
        }
    }

    public solidAt(c: Vec3): number | undefined {
        return this.solids.get(key(c));
    }

    public isSolid(c: Vec3): boolean {
        return this.solids.has(key(c));
    }

    public solidCount(): number {
        return this.solids.size;
    }
}
