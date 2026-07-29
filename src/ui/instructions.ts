import { PiecePlacement, Step, InventoryKey, inventoryKeyOf } from '../core/pieces';

/**
 * "Program note" style assembly instructions: a sequence of colored chips in
 * build order, exactly like the manual's プログラミング練習表.
 */
export class Instructions {
    private container: HTMLElement;
    private onPrint: (() => void) | null = null;

    constructor(containerId: string, onPrint?: () => void) {
        const el = document.getElementById(containerId);
        if (!el) throw new Error(`Instructions container ${containerId} not found`);
        this.container = el;
        this.onPrint = onPrint ?? null;
    }

    public renderEmpty(message: string) {
        this.container.innerHTML = `<p class="text-gray-400 text-sm p-4">${message}</p>`;
    }

    public render(pieces: PiecePlacement[], steps: Step[]) {
        // Number cross pieces in order of first appearance (route 1 vs route 2).
        const crossRoute = new Map<number, number>(); // pieceIndex -> times seen

        const chips = steps.map((step) => {
            const piece = pieces[step.pieceIndex];
            const seen = crossRoute.get(step.pieceIndex) ?? 0;
            if (piece.type === 'cross') crossRoute.set(step.pieceIndex, seen + 1);
            return this.chip(piece, step, seen + 1);
        });

        const counts = this.countSummary(pieces);

        this.container.innerHTML = `
      <div class="p-4 print-block">
        <div class="flex items-baseline justify-between mb-2">
          <h3 class="font-bold text-gray-800">Assembly Program</h3>
          <span class="text-xs text-gray-500">${pieces.length} pieces — connect in order, knob → socket</span>
        </div>
        <div class="flex flex-wrap items-center gap-y-2">
          ${chips.join('')}
        </div>
        <div class="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-600 border-t border-gray-200 pt-2">
          ${counts}
        </div>
      </div>
    `;

        this.container.querySelector('#print-btn')?.addEventListener('click', () => {
            this.onPrint?.();
        });
    }

    private chip(piece: PiecePlacement, step: Step, crossNth: number): string {
        const style: Record<string, { bg: string; label: string; text?: string }> = {
            start: { bg: 'background:#f5f2ec;border-color:#cf2d24', label: 'START', text: 'color:#cf2d24' },
            straight: { bg: 'background:#f0c419', label: '' },
            curveLeft: { bg: 'background:#74c3e8', label: 'L' },
            curveRight: { bg: 'background:#a9cf38', label: 'R' },
            inner: { bg: 'background:#f29022', label: '' },
            outer: { bg: 'background:#e64a41', label: '' },
            cross: { bg: 'background:#b591dd', label: String(crossNth) },
        };
        const s = style[piece.type];
        const label = step.kind === 'crossPass' ? String(crossNth) : s.label;
        const sizing = piece.type === 'start' ? 'w-11 text-[9px]' : 'w-8 text-[10px]';
        return `
      <span class="inline-flex items-center">
        <span class="${sizing} h-8 rounded-md border-2 border-black/10 shadow-sm flex items-center justify-center
          font-bold text-white/90" style="${s.bg};${s.text ?? ''}">${label}</span>
        <svg class="w-3 h-3 text-gray-400 mx-0.5 chip-arrow" viewBox="0 0 12 12" fill="currentColor">
          <path d="M4 2l4 4-4 4z"/>
        </svg>
      </span>`;
    }

    private countSummary(pieces: PiecePlacement[]): string {
        const names: Record<InventoryKey, string> = {
            straight: 'Straight', curve: 'L/R Curve', inner: 'Inner', outer: 'Outer', cross: 'Cross',
        };
        const counts: Partial<Record<InventoryKey, number>> = {};
        for (const p of pieces) {
            const k = inventoryKeyOf(p.type);
            if (k) counts[k] = (counts[k] ?? 0) + 1;
        }
        return (Object.keys(names) as InventoryKey[])
            .filter((k) => counts[k])
            .map((k) => `<span><b>${counts[k]}</b> × ${names[k]}</span>`)
            .join('') + (this.onPrint ? `<span class="ml-auto no-print">
              <button type="button" id="print-btn" class="text-blue-600 hover:underline">Print</button>
            </span>` : '');
    }
}
