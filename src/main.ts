import './style.css';
import { SceneController } from './view/scene';
import { Sidebar } from './ui/sidebar';
import { Instructions } from './ui/instructions';
import { Favorites, TrackData } from './ui/favorites';
import { saveLastTrack, loadLastTrack } from './ui/lastTrack';
import { usedInventory } from './core/pieces';
import { WorkerRequest, WorkerResponse } from './core/generator.worker';
import { replayProgram } from './core/replay';
import { MANUAL_EXAMPLE_2 } from './core/examples';

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <div class="flex h-screen flex-col md:flex-row overflow-hidden bg-gray-50">
    <div class="w-full md:w-72 shrink-0 bg-white border-r border-gray-200 overflow-y-auto z-10 no-print">
      <div id="sidebar-container" class="p-5"></div>
      <div id="favorites-panel" class="px-5 pb-5"></div>
    </div>

    <div class="print-column flex-1 relative flex flex-col min-w-0">
      <!-- Snapshot kept in sync with the viewport so print preview always has it. -->
      <div id="print-view" class="print-only">
        <img id="print-snapshot" alt="Track preview" />
      </div>
      <div id="canvas-container" class="flex-1 min-h-0 relative overflow-hidden no-print">
        <div id="loading-overlay" class="absolute inset-0 bg-black/25 flex items-center justify-center hidden z-20">
          <div class="bg-white px-6 py-4 rounded-xl shadow-lg text-center">
            <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-2"></div>
            <p id="loading-text" class="text-sm font-semibold text-gray-700">Generating…</p>
          </div>
        </div>
        <div id="toast" class="absolute left-1/2 -translate-x-1/2 top-4 bg-gray-800 text-white
          text-sm px-4 py-2 rounded-lg shadow hidden z-30"></div>
      </div>
      <div id="instructions-container" class="shrink-0 max-h-[38%] overflow-y-auto bg-white border-t border-gray-200 print-block"></div>
    </div>
  </div>
`;

// Degrade gracefully if WebGL is unavailable: the 3D view goes away but
// generation and printable instructions still work.
let scene: SceneController | null = null;
try {
    scene = new SceneController(document.getElementById('canvas-container')!);
} catch {
    document.getElementById('canvas-container')!.innerHTML = `
      <div class="flex h-full items-center justify-center p-6 text-center text-sm text-gray-500">
        3D preview unavailable (WebGL could not start in this browser).<br>
        Generated tracks still appear as assembly instructions below.
      </div>`;
}

const printSnapshot = document.getElementById('print-snapshot') as HTMLImageElement;

/**
 * Keep a print-ready JPEG of the viewport (WebGL canvases often print blank).
 * Skip capture when the canvas is hidden / zero-sized — that happens once
 * print media kicks in, and overwriting here would blank the preview.
 */
const refreshPrintSnapshot = () => {
    if (!scene || !currentTrack) {
        printSnapshot.removeAttribute('src');
        return;
    }
    const host = document.getElementById('canvas-container');
    if (!host || host.clientWidth < 2 || host.clientHeight < 2) return;
    printSnapshot.src = scene.captureThumbnail(1280, 800);
};

const printTrack = () => {
    refreshPrintSnapshot();
    // Let the browser paint the <img> before opening the print dialog /
    // preview — otherwise Safari/Chrome often show a blank slot.
    requestAnimationFrame(() => {
        requestAnimationFrame(() => window.print());
    });
};

const instructions = new Instructions('instructions-container', printTrack);
const loadingOverlay = document.getElementById('loading-overlay')!;
const loadingText = document.getElementById('loading-text')!;
const toast = document.getElementById('toast')!;

let currentTrack: TrackData | null = null;

const applyTrack = (track: TrackData) => {
    currentTrack = track;
    scene?.renderTrack(track);
    instructions.render(track.pieces, track.steps);
    sidebar.setUsage(usedInventory(track.pieces));
    sidebar.setSaveEnabled(true);
    saveLastTrack(track);
    // Defer one frame so Three.js has drawn the new meshes before we capture.
    requestAnimationFrame(() => refreshPrintSnapshot());
};

// Also refresh if the user prints via the system menu (⌘P) instead of our button.
// Do NOT listen to matchMedia('print') — by then the canvas is already
// display:none and a capture would overwrite the good snapshot with blank.
window.addEventListener('beforeprint', refreshPrintSnapshot);

let toastTimer: number | undefined;
const showToast = (msg: string) => {
    toast.textContent = msg;
    toast.classList.remove('hidden');
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toast.classList.add('hidden'), 5000);
};

const worker = new Worker(new URL('./core/generator.worker.ts', import.meta.url), { type: 'module' });

worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
    const { type, data, message, relaxed } = e.data;

    if (type === 'progress') {
        loadingText.textContent = message || 'Generating…';
        return;
    }

    sidebar.setLoading(false);
    loadingOverlay.classList.add('hidden');

    if (type === 'success' && data) {
        applyTrack(data);
        if (relaxed) showToast('Those settings were very tough — relaxed them slightly to close the loop.');
    } else {
        showToast(message || 'Failed to generate a track.');
    }
};

worker.onerror = () => {
    sidebar.setLoading(false);
    loadingOverlay.classList.add('hidden');
    showToast('Generation crashed unexpectedly — please try again.');
};

const favorites = new Favorites('favorites-panel', (saved) => {
    applyTrack({ pieces: saved.pieces, steps: saved.steps });
    showToast(`Loaded "${saved.name}"`);
});

const sidebar = new Sidebar('sidebar-container', {
    onGenerate: (state) => {
        sidebar.setLoading(true);
        loadingOverlay.classList.remove('hidden');
        loadingText.textContent = 'Searching for a closed loop…';

        const req: WorkerRequest = {
            inventory: state.inventory,
            options: {
                minPieces: state.minPieces,
                maxPieces: state.maxPieces,
                elevation: state.elevation,
            },
        };
        worker.postMessage(req);
    },
    onSave: () => {
        if (!currentTrack) return;
        const thumbnail = scene?.captureThumbnail() ?? '';
        const item = favorites.add('', currentTrack, thumbnail);
        showToast(`Saved "${item.name}" to favorites`);
    },
    onShowTrainChange: (on) => scene?.setShowTrain(on),
});
scene?.setShowTrain(sidebar.isShowTrain());

// Restore the last generated/loaded track across refresh; fall back to the
// manual S-course demo on a first visit.
const restored = loadLastTrack();
if (restored) {
    applyTrack(restored);
} else {
    const demo = replayProgram(MANUAL_EXAMPLE_2);
    if (demo.closed) applyTrack(demo);
}

// Dev hook: replay an arbitrary piece program from the console.
(window as unknown as Record<string, unknown>).__railcube = {
    renderProgram: (program: Parameters<typeof replayProgram>[0]) => {
        const r = replayProgram(program);
        applyTrack(r);
        return { closed: r.closed, error: r.error };
    },
};
