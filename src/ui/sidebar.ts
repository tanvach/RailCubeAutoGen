import { Inventory, InventoryKey, STARTER_SET, DELUXE_SET } from '../core/pieces';
import { CrossMode } from '../core/generator';

export interface SidebarState {
    inventory: Inventory;
    minPieces: number;
    maxPieces: number;
    elevation: number;
    /** How the generator may use purple cross pieces. */
    crossMode: CrossMode;
    /** 'showcase' = generate many candidates, keep the most interesting. */
    style: 'classic' | 'showcase';
}

type OnGenerateCallback = (state: SidebarState) => void;
type Mode = 'simple' | 'advanced';

export interface SidebarCallbacks {
    onGenerate: OnGenerateCallback;
    onSave?: () => void;
    onShowTrainChange?: (on: boolean) => void;
}

const KITS: Record<string, Inventory> = {
    starter: STARTER_SET,
    deluxe: DELUXE_SET,
};

const SETTINGS_KEY = 'railcube.settings.v1';

/** One-word feel for each complexity notch (1..5). */
const COMPLEXITY_LABELS = ['Cozy loop', 'Easy', 'Balanced', 'Twisty', 'Wild'];

const INV_LABELS: Record<InventoryKey, string> = {
    straight: 'Straight (yellow)',
    curve: 'L/R Curve (blue/green)',
    inner: 'Inner Curve (orange)',
    outer: 'Outer Curve (red)',
    cross: 'Cross (purple)',
};

export class Sidebar {
    private container: HTMLElement;
    private onGenerate: OnGenerateCallback;
    private onSave: (() => void) | null;
    private onShowTrainChange: ((on: boolean) => void) | null;
    private kit: 'starter' | 'deluxe' | 'custom' = 'starter';
    private inventory: Inventory = { ...STARTER_SET };
    private size = 20;
    private elevation = 0.3;
    private mode: Mode = 'simple';
    private complexity = 3; // 1..5 Balanced — only used in simple mode
    private showTrain = true;
    private saveEnabled = false;
    private useCross = false;
    private crossStyle: 'straight' | 'crossing' = 'crossing';
    private interesting = false;

    constructor(containerId: string, onGenerate: OnGenerateCallback, onSave?: () => void);
    constructor(containerId: string, callbacks: SidebarCallbacks);
    constructor(
        containerId: string,
        onGenerateOrCallbacks: OnGenerateCallback | SidebarCallbacks,
        onSave?: () => void,
    ) {
        const el = document.getElementById(containerId);
        if (!el) throw new Error(`Sidebar container ${containerId} not found`);
        this.container = el;
        if (typeof onGenerateOrCallbacks === 'function') {
            this.onGenerate = onGenerateOrCallbacks;
            this.onSave = onSave ?? null;
            this.onShowTrainChange = null;
        } else {
            this.onGenerate = onGenerateOrCallbacks.onGenerate;
            this.onSave = onGenerateOrCallbacks.onSave ?? null;
            this.onShowTrainChange = onGenerateOrCallbacks.onShowTrainChange ?? null;
        }
        this.restore();
        this.render();
    }

    /** Whether the animated train is shown on the track (sticky with other settings). */
    public isShowTrain(): boolean {
        return this.showTrain;
    }

    /** Reload the last-used settings so a browser refresh keeps the selection. */
    private restore() {
        try {
            const raw = localStorage.getItem(SETTINGS_KEY);
            if (!raw) return;
            const s = JSON.parse(raw);
            if (s.kit === 'starter' || s.kit === 'deluxe' || s.kit === 'custom') this.kit = s.kit;
            if (this.kit === 'custom' && s.inventory && typeof s.inventory === 'object') {
                for (const k of Object.keys(this.inventory) as InventoryKey[]) {
                    const v = Number(s.inventory[k]);
                    if (Number.isFinite(v)) this.inventory[k] = Math.max(0, Math.floor(v));
                }
            } else if (this.kit !== 'custom') {
                this.inventory = { ...KITS[this.kit] };
            }
            if (Number.isFinite(s.size)) this.size = Math.max(8, Math.floor(s.size));
            if (Number.isFinite(s.elevation)) this.elevation = Math.min(1, Math.max(0, s.elevation));
            if (s.mode === 'simple' || s.mode === 'advanced') this.mode = s.mode;
            if (Number.isFinite(s.complexity)) this.complexity = Math.min(5, Math.max(1, Math.round(s.complexity)));
            // Prefer showTrain; accept the older trainMoving key from a prior build.
            if (typeof s.showTrain === 'boolean') this.showTrain = s.showTrain;
            else if (typeof s.trainMoving === 'boolean') this.showTrain = s.trainMoving;
            if (typeof s.useCross === 'boolean') this.useCross = s.useCross;
            if (s.crossStyle === 'straight' || s.crossStyle === 'crossing') this.crossStyle = s.crossStyle;
            if (typeof s.interesting === 'boolean') this.interesting = s.interesting;
        } catch {
            // Corrupt or unavailable storage: keep defaults.
        }
    }

    private persist() {
        try {
            localStorage.setItem(SETTINGS_KEY, JSON.stringify({
                kit: this.kit,
                inventory: this.inventory,
                size: this.size,
                elevation: this.elevation,
                mode: this.mode,
                complexity: this.complexity,
                showTrain: this.showTrain,
                useCross: this.useCross,
                crossStyle: this.crossStyle,
                interesting: this.interesting,
            }));
        } catch {
            // Storage unavailable: selections just won't stick.
        }
    }

    public getState(): SidebarState {
        // The slider max tracks the inventory at render time, but custom
        // inventory edits don't re-render; clamp so size never exceeds what
        // the pieces on hand allow (+1 for the start cube).
        const total = Object.values(this.inventory).reduce((a, b) => a + b, 1);
        let size = this.size;
        let elevation = this.elevation;
        if (this.mode === 'simple') {
            // One dial: complexity 1..5 scales track size (small → whole kit)
            // and elevation. Elevation eases in and tops out at 0.65 — cranking
            // to 0.9 burned vertical pieces on short hops then padded long
            // floor loops, so Wild looked flat next to Balanced.
            const t = (this.complexity - 1) / 4;
            size = Math.round(10 + (total - 10) * t);
            elevation = Math.round(Math.pow(t, 1.35) * 65) / 100; // 0 .. 0.65
        }
        const maxPieces = Math.max(8, Math.min(size, total));
        return {
            inventory: { ...this.inventory },
            minPieces: Math.min(Math.max(6, Math.floor(maxPieces * 0.6)), maxPieces),
            maxPieces,
            elevation,
            crossMode: this.useCross && this.inventory.cross > 0 ? this.crossStyle : 'off',
            style: this.interesting ? 'showcase' : 'classic',
        };
    }

    public setLoading(isLoading: boolean) {
        const btn = this.container.querySelector('#generate-btn') as HTMLButtonElement | null;
        if (btn) {
            btn.disabled = isLoading;
            btn.textContent = isLoading ? 'Generating…' : 'Generate Track';
            btn.classList.toggle('opacity-60', isLoading);
        }
    }

    public setSaveEnabled(enabled: boolean) {
        this.saveEnabled = enabled;
        const btn = this.container.querySelector('#save-btn') as HTMLButtonElement | null;
        if (btn) btn.disabled = !enabled;
    }

    public setUsage(used: Inventory | null) {
        const el = this.container.querySelector('#usage');
        if (!el) return;
        if (!used) {
            el.innerHTML = '';
            return;
        }
        el.innerHTML = (Object.keys(INV_LABELS) as InventoryKey[])
            .filter((k) => this.inventory[k] > 0 || used[k] > 0)
            .map((k) => `
              <div class="flex justify-between text-xs text-gray-600">
                <span>${INV_LABELS[k]}</span>
                <span class="font-mono">${used[k]} / ${this.inventory[k]}</span>
              </div>`)
            .join('');
    }

    private render() {
        const maxTotal = Object.values(this.inventory).reduce((a, b) => a + b, 1);
        this.size = Math.min(this.size, maxTotal);

        this.container.innerHTML = `
      <div class="space-y-5">
        <div class="hidden md:block">
          <h1 class="text-lg font-extrabold text-gray-800">Rail Cube <span class="text-blue-500">Auto-Gen</span></h1>
          <p class="text-xs text-gray-500 mt-1">Procedural closed loops for the Rail Cube magnetic train set.</p>
        </div>

        <div>
          <label class="block text-sm font-semibold text-gray-700 mb-1">Kit</label>
          <select id="kit-select" class="block w-full rounded-md border border-gray-300 bg-white shadow-sm text-sm p-2">
            <option value="starter" ${this.kit === 'starter' ? 'selected' : ''}>Starter Set</option>
            <option value="deluxe" ${this.kit === 'deluxe' ? 'selected' : ''}>Deluxe Set</option>
            <option value="custom" ${this.kit === 'custom' ? 'selected' : ''}>Custom Inventory</option>
          </select>
        </div>

        <div id="custom-inventory" class="${this.kit === 'custom' ? '' : 'hidden'} space-y-2">
          ${(Object.keys(INV_LABELS) as InventoryKey[]).map((k) => `
            <label class="flex items-center justify-between text-xs text-gray-600">
              <span>${INV_LABELS[k]}</span>
              <input data-inv="${k}" type="number" min="0" max="99" value="${this.inventory[k]}"
                class="w-16 rounded border border-gray-300 p-1 text-right text-sm" />
            </label>`).join('')}
        </div>

        <div class="grid grid-cols-2 gap-1 bg-gray-100 rounded-lg p-1 text-sm font-semibold">
          <button data-mode="simple" class="rounded-md py-1 transition
            ${this.mode === 'simple' ? 'bg-white shadow text-blue-600' : 'text-gray-500 hover:text-gray-700'}">Simple</button>
          <button data-mode="advanced" class="rounded-md py-1 transition
            ${this.mode === 'advanced' ? 'bg-white shadow text-blue-600' : 'text-gray-500 hover:text-gray-700'}">Advanced</button>
        </div>

        ${this.mode === 'simple' ? `
        <div>
          <label class="block text-sm font-semibold text-gray-700">Complexity
            <span id="complexity-val" class="font-mono text-blue-600">${COMPLEXITY_LABELS[this.complexity - 1]}</span>
          </label>
          <input type="range" id="complexity-slider" min="1" max="5" step="1" value="${this.complexity}"
            class="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-500">
          <p class="text-[11px] text-gray-400 mt-1">One dial: sets track size and elevation together.</p>
        </div>` : `
        <div>
          <label class="block text-sm font-semibold text-gray-700">Track size
            <span id="size-val" class="font-mono text-blue-600">${this.size}</span> pieces
          </label>
          <input type="range" id="size-slider" min="8" max="${maxTotal}" value="${this.size}"
            class="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-500">
        </div>

        <div>
          <label class="block text-sm font-semibold text-gray-700">Elevation
            <span id="elevation-val" class="font-mono text-orange-600">${Math.round(this.elevation * 100)}%</span>
            <span class="text-xs font-normal text-gray-500">(flat ↔ 3D)</span>
          </label>
          <input type="range" id="elevation-slider" min="0" max="1" step="0.1" value="${this.elevation}"
            class="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-orange-500">
        </div>`}

        <div class="space-y-2 pt-1">
          <label class="flex items-center gap-2 text-sm text-gray-600 select-none
            ${this.inventory.cross > 0 ? 'cursor-pointer' : 'opacity-50'}">
            <input type="checkbox" id="cross-toggle" ${this.useCross ? 'checked' : ''}
              ${this.inventory.cross > 0 ? '' : 'disabled'}
              class="h-4 w-4 rounded border-gray-300 accent-purple-600 cursor-pointer" />
            Use cross pieces <span class="font-semibold text-purple-600">(purple)</span>
          </label>
          <p id="cross-none-hint" class="text-[11px] text-gray-400 ${this.inventory.cross > 0 ? 'hidden' : ''}">
            This kit has no cross pieces — pick the Deluxe Set or add some in a custom inventory.</p>
          <div id="cross-style-box" class="${this.useCross && this.inventory.cross > 0 ? '' : 'hidden'} space-y-1 pl-6">
            <div class="grid grid-cols-2 gap-1 bg-gray-100 rounded-lg p-1 text-xs font-semibold">
              <button data-cross-style="straight" class="rounded-md py-1 transition
                ${this.crossStyle === 'straight' ? 'bg-white shadow text-purple-600' : 'text-gray-500 hover:text-gray-700'}">Straight ×2</button>
              <button data-cross-style="crossing" class="rounded-md py-1 transition
                ${this.crossStyle === 'crossing' ? 'bg-white shadow text-purple-600' : 'text-gray-500 hover:text-gray-700'}">Crossing</button>
            </div>
            <p class="text-[11px] text-gray-400">${this.crossStyle === 'crossing'
                ? 'The loop weaves back through the cross (routes 1 → 2), figure-8 style. Searches longer.'
                : 'Crosses lay flat as 2-unit straight track (route 1).'}</p>
          </div>
        </div>

        <label class="flex items-start gap-2 text-sm text-gray-600 cursor-pointer select-none">
          <input type="checkbox" id="interesting-toggle" ${this.interesting ? 'checked' : ''}
            class="mt-0.5 h-4 w-4 rounded border-gray-300 accent-blue-600 cursor-pointer" />
          <span>Interesting mode
            <span class="block text-[11px] font-normal text-gray-400">Tries many layouts and keeps the most
              interesting (bridges, weaves, levels). Takes up to ~15 s.</span>
          </span>
        </label>

        <button id="generate-btn"
          class="w-full bg-blue-600 text-white font-bold py-2.5 px-4 rounded-lg hover:bg-blue-700 transition shadow">
          Generate Track
        </button>

        ${this.onSave ? `
        <button id="save-btn" ${this.saveEnabled ? '' : 'disabled'}
          class="w-full bg-white text-blue-600 font-semibold py-2 px-4 rounded-lg border border-blue-300
            hover:bg-blue-50 transition disabled:opacity-40 disabled:cursor-not-allowed">
          ☆ Save to Favorites
        </button>` : ''}

        <label class="flex items-center gap-2 text-sm text-gray-600 cursor-pointer select-none">
          <input type="checkbox" id="train-toggle" ${this.showTrain ? 'checked' : ''}
            class="h-4 w-4 rounded border-gray-300 text-blue-600 accent-blue-600 cursor-pointer" />
          Show train
        </label>

        <div id="usage" class="space-y-1 pt-2 border-t border-gray-200"></div>

        <a href="https://github.com/tanvach/RailCubeAutoGen"
          target="_blank" rel="noopener noreferrer"
          class="group mt-2 flex items-center gap-2.5 rounded-lg border border-gray-200/80
            bg-gradient-to-br from-gray-50 to-white px-3 py-2.5 no-print transition
            hover:border-gray-300 hover:shadow-sm">
          <svg class="h-4 w-4 shrink-0 text-gray-700 group-hover:text-gray-900" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
            <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0016 8c0-4.42-3.58-8-8-8z"/>
          </svg>
          <span class="min-w-0 flex-1">
            <span class="block text-[11px] font-semibold tracking-wide text-gray-700 group-hover:text-gray-900">View source</span>
            <span class="block truncate text-[10px] text-gray-400 group-hover:text-gray-500">github.com/tanvach/RailCubeAutoGen</span>
          </span>
          <svg class="h-3 w-3 shrink-0 text-gray-300 transition group-hover:translate-x-0.5 group-hover:text-gray-500"
            viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.75" aria-hidden="true">
            <path d="M2.5 6h7M6.5 3l3 3-3 3" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </a>
      </div>
    `;
        this.attachEvents();
    }

    private attachEvents() {
        const q = <T extends Element>(sel: string) => this.container.querySelector(sel) as T | null;

        q<HTMLButtonElement>('#generate-btn')?.addEventListener('click', () => {
            this.onGenerate(this.getState());
        });

        q<HTMLButtonElement>('#save-btn')?.addEventListener('click', () => {
            this.onSave?.();
        });

        q<HTMLInputElement>('#train-toggle')?.addEventListener('change', (e) => {
            this.showTrain = (e.target as HTMLInputElement).checked;
            this.persist();
            this.onShowTrainChange?.(this.showTrain);
        });

        this.container.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((btn) => {
            btn.addEventListener('click', () => {
                this.mode = btn.dataset.mode as Mode;
                this.persist();
                this.render();
            });
        });

        q<HTMLInputElement>('#cross-toggle')?.addEventListener('change', (e) => {
            this.useCross = (e.target as HTMLInputElement).checked;
            this.persist();
            this.render();
        });

        this.container.querySelectorAll<HTMLButtonElement>('[data-cross-style]').forEach((btn) => {
            btn.addEventListener('click', () => {
                this.crossStyle = btn.dataset.crossStyle as 'straight' | 'crossing';
                this.persist();
                this.render();
            });
        });

        q<HTMLInputElement>('#interesting-toggle')?.addEventListener('change', (e) => {
            this.interesting = (e.target as HTMLInputElement).checked;
            this.persist();
        });

        q<HTMLInputElement>('#complexity-slider')?.addEventListener('input', (e) => {
            this.complexity = parseInt((e.target as HTMLInputElement).value, 10);
            const el = q<HTMLElement>('#complexity-val');
            if (el) el.textContent = COMPLEXITY_LABELS[this.complexity - 1];
            this.persist();
        });

        q<HTMLInputElement>('#size-slider')?.addEventListener('input', (e) => {
            this.size = parseInt((e.target as HTMLInputElement).value, 10);
            const el = q<HTMLElement>('#size-val');
            if (el) el.textContent = String(this.size);
            this.persist();
        });

        q<HTMLInputElement>('#elevation-slider')?.addEventListener('input', (e) => {
            this.elevation = parseFloat((e.target as HTMLInputElement).value);
            const el = q<HTMLElement>('#elevation-val');
            if (el) el.textContent = `${Math.round(this.elevation * 100)}%`;
            this.persist();
        });

        q<HTMLSelectElement>('#kit-select')?.addEventListener('change', (e) => {
            const val = (e.target as HTMLSelectElement).value as typeof this.kit;
            this.kit = val;
            if (val !== 'custom') this.inventory = { ...KITS[val] };
            this.persist();
            this.render();
        });

        this.container.querySelectorAll<HTMLInputElement>('[data-inv]').forEach((input) => {
            input.addEventListener('input', () => {
                const k = input.dataset.inv as InventoryKey;
                this.inventory[k] = Math.max(0, parseInt(input.value || '0', 10));
                this.persist();
                // Custom edits don't re-render, but the cross toggle's enabled
                // state depends on the cross count — sync it in place.
                if (k === 'cross') {
                    const toggle = q<HTMLInputElement>('#cross-toggle');
                    const hint = q<HTMLElement>('#cross-none-hint');
                    const box = q<HTMLElement>('#cross-style-box');
                    const has = this.inventory.cross > 0;
                    if (toggle) {
                        toggle.disabled = !has;
                        toggle.closest('label')?.classList.toggle('opacity-50', !has);
                        toggle.closest('label')?.classList.toggle('cursor-pointer', has);
                    }
                    hint?.classList.toggle('hidden', has);
                    box?.classList.toggle('hidden', !(has && this.useCross));
                }
            });
        });
    }
}
