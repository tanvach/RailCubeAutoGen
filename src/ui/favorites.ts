import { PiecePlacement, Step } from '../core/pieces';

export interface SavedTrack {
    id: string;
    name: string;
    createdAt: number;
    /** JPEG data URL captured from the viewport when saved. */
    thumbnail: string;
    pieces: PiecePlacement[];
    steps: Step[];
}

export interface TrackData {
    pieces: PiecePlacement[];
    steps: Step[];
}

type LoadCallback = (track: SavedTrack) => void;

const STORAGE_KEY = 'railcube.favorites.v1';
const MAX_FAVORITES = 12;

/**
 * Favorite tracks, persisted to localStorage. Placements and steps are plain
 * JSON data, so a saved track round-trips exactly and can be re-rendered
 * without re-running the generator.
 */
export class Favorites {
    private container: HTMLElement;
    private onLoad: LoadCallback;
    private items: SavedTrack[];

    constructor(containerId: string, onLoad: LoadCallback) {
        const el = document.getElementById(containerId);
        if (!el) throw new Error(`Favorites container ${containerId} not found`);
        this.container = el;
        this.onLoad = onLoad;
        this.items = this.read();
        this.render();
    }

    public get count(): number {
        return this.items.length;
    }

    public getAll(): SavedTrack[] {
        return [...this.items];
    }

    public add(name: string, track: TrackData, thumbnail: string): SavedTrack {
        const item: SavedTrack = {
            id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
            name: name.trim() || `Track ${this.items.length + 1}`,
            createdAt: Date.now(),
            thumbnail,
            pieces: track.pieces,
            steps: track.steps,
        };
        this.items.unshift(item);
        while (this.items.length > MAX_FAVORITES) this.items.pop();
        this.write();
        this.render();
        return item;
    }

    public remove(id: string): void {
        this.items = this.items.filter((i) => i.id !== id);
        this.write();
        this.render();
    }

    private read(): SavedTrack[] {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (!raw) return [];
            const parsed = JSON.parse(raw);
            if (!Array.isArray(parsed)) return [];
            return parsed.filter((i) => i && Array.isArray(i.pieces) && Array.isArray(i.steps));
        } catch {
            return [];
        }
    }

    private write(): void {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(this.items));
        } catch {
            // Quota exceeded (thumbnails are the bulk): drop the oldest and retry once.
            if (this.items.length > 1) {
                this.items.pop();
                this.write();
                this.render();
            }
        }
    }

    private render(): void {
        if (this.items.length === 0) {
            this.container.innerHTML = `
        <div class="pt-4 border-t border-gray-200">
          <h3 class="text-sm font-semibold text-gray-700 mb-1">Favorites</h3>
          <p class="text-xs text-gray-400">Generate a track, then save it here with its picture.</p>
        </div>`;
            return;
        }

        this.container.innerHTML = `
      <div class="pt-4 border-t border-gray-200">
        <h3 class="text-sm font-semibold text-gray-700 mb-2">Favorites</h3>
        <div class="grid grid-cols-2 gap-2">
          ${this.items.map((i) => `
            <div class="favorite-card group relative rounded-lg border border-gray-200 overflow-hidden
              bg-gray-50 hover:border-blue-400 cursor-pointer transition" data-id="${i.id}">
              ${i.thumbnail
                ? `<img src="${i.thumbnail}" alt="${i.name}" class="w-full aspect-[8/5] object-cover bg-gray-200" />`
                : `<div class="w-full aspect-[8/5] bg-gray-200 flex items-center justify-center text-gray-400 text-xs">No image</div>`}
              <div class="px-2 py-1">
                <div class="text-xs font-semibold text-gray-700 truncate">${escapeHtml(i.name)}</div>
                <div class="text-[10px] text-gray-400">${i.pieces.length} pieces</div>
              </div>
              <button class="favorite-delete absolute top-1 right-1 w-5 h-5 rounded-full bg-black/50 text-white
                text-[10px] leading-none opacity-0 group-hover:opacity-100 transition" data-id="${i.id}" title="Delete">✕</button>
            </div>`).join('')}
        </div>
      </div>`;

        this.container.querySelectorAll('.favorite-card').forEach((card) => {
            card.addEventListener('click', (e) => {
                const id = (card as HTMLElement).dataset.id;
                const item = this.items.find((i) => i.id === id);
                if (!item) return;
                if ((e.target as HTMLElement).closest('.favorite-delete')) return;
                this.onLoad(item);
            });
        });
        this.container.querySelectorAll('.favorite-delete').forEach((btn) => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const id = (btn as HTMLElement).dataset.id;
                if (id) this.remove(id);
            });
        });
    }
}

const escapeHtml = (s: string): string =>
    s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] ?? c));
