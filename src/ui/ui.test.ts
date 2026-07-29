// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Sidebar } from './sidebar';
import { Instructions } from './instructions';
import { Favorites } from './favorites';
import { saveLastTrack, loadLastTrack } from './lastTrack';
import { replayProgram } from '../core/replay';
import { MANUAL_EXAMPLE_1, MANUAL_EXAMPLE_2 } from '../core/examples';

describe('Sidebar', () => {
    beforeEach(() => {
        localStorage.clear();
        document.body.innerHTML = '<div id="sidebar-root"></div>';
    });

    it('renders starter defaults and fires generate with state', () => {
        const spy = vi.fn();
        new Sidebar('sidebar-root', spy);
        (document.querySelector('#generate-btn') as HTMLButtonElement).click();
        expect(spy).toHaveBeenCalledTimes(1);
        const state = spy.mock.calls[0][0];
        expect(state.inventory.straight).toBe(15);
        expect(state.inventory.curve).toBe(8);
        expect(state.maxPieces).toBeGreaterThan(0);
    });

    it('switches to deluxe inventory', () => {
        const spy = vi.fn();
        new Sidebar('sidebar-root', spy);
        const select = document.querySelector('#kit-select') as HTMLSelectElement;
        select.value = 'deluxe';
        select.dispatchEvent(new Event('change'));
        (document.querySelector('#generate-btn') as HTMLButtonElement).click();
        const state = spy.mock.calls[0][0];
        expect(state.inventory.straight).toBe(31);
        expect(state.inventory.cross).toBe(2);
    });

    it('shows custom inventory editor', () => {
        new Sidebar('sidebar-root', () => {});
        const select = document.querySelector('#kit-select') as HTMLSelectElement;
        select.value = 'custom';
        select.dispatchEvent(new Event('change'));
        expect(document.querySelector('#custom-inventory')?.classList.contains('hidden')).toBe(false);
        expect(document.querySelectorAll('[data-inv]').length).toBe(5);
    });

    it('reports usage after generation', () => {
        const sidebar = new Sidebar('sidebar-root', () => {});
        sidebar.setUsage({ straight: 9, curve: 8, inner: 0, outer: 0, cross: 0 });
        expect(document.getElementById('usage')?.textContent).toContain('9 / 15');
    });

    it('persists selections across instances (browser refresh)', () => {
        new Sidebar('sidebar-root', () => {});
        const select = document.querySelector('#kit-select') as HTMLSelectElement;
        select.value = 'deluxe';
        select.dispatchEvent(new Event('change'));
        const slider = document.querySelector('#size-slider') as HTMLInputElement;
        slider.value = '25';
        slider.dispatchEvent(new Event('input'));

        // Fresh instance = page reload.
        document.body.innerHTML = '<div id="sidebar-root"></div>';
        const spy = vi.fn();
        new Sidebar('sidebar-root', spy);
        expect((document.querySelector('#kit-select') as HTMLSelectElement).value).toBe('deluxe');
        (document.querySelector('#generate-btn') as HTMLButtonElement).click();
        const state = spy.mock.calls[0][0];
        expect(state.inventory.straight).toBe(31);
        expect(state.maxPieces).toBe(25);
    });

    it('simple mode maps one complexity dial to size and elevation', () => {
        const spy = vi.fn();
        new Sidebar('sidebar-root', spy);
        (document.querySelector('[data-mode="simple"]') as HTMLButtonElement).click();
        const dial = document.querySelector('#complexity-slider') as HTMLInputElement;
        expect(dial).toBeTruthy();

        dial.value = '1';
        dial.dispatchEvent(new Event('input'));
        (document.querySelector('#generate-btn') as HTMLButtonElement).click();
        const low = spy.mock.calls[0][0];
        expect(low.maxPieces).toBe(10);
        expect(low.elevation).toBe(0);

        dial.value = '5';
        dial.dispatchEvent(new Event('input'));
        (document.querySelector('#generate-btn') as HTMLButtonElement).click();
        const high = spy.mock.calls[1][0];
        expect(high.maxPieces).toBe(32); // whole starter kit + start cube
        expect(high.elevation).toBeCloseTo(0.9);
        expect(high.maxPieces).toBeGreaterThan(low.maxPieces);

        // Mode itself is sticky too.
        document.body.innerHTML = '<div id="sidebar-root"></div>';
        new Sidebar('sidebar-root', () => {});
        expect(document.querySelector('#complexity-slider')).toBeTruthy();
    });
});

describe('Instructions', () => {
    beforeEach(() => {
        document.body.innerHTML = '<div id="instr-root"></div>';
    });

    it('renders one chip per traversal step plus counts', () => {
        const instr = new Instructions('instr-root');
        const demo = replayProgram(MANUAL_EXAMPLE_2);
        instr.render(demo.pieces, demo.steps);
        const root = document.getElementById('instr-root')!;
        expect(root.textContent).toContain('Assembly Program');
        expect(root.textContent).toContain('18 pieces');
        // 9 straights + 8 curves summary
        expect(root.textContent).toContain('9');
        expect(root.textContent).toContain('L/R Curve');
    });

    it('labels cross passes with route numbers', () => {
        const instr = new Instructions('instr-root');
        const r = replayProgram([
            'start', 'cross', 'straight', 'curveRight', 'curveRight', 'curveRight',
            'straight', 'crossPass', 'straight', 'curveLeft', 'straight', 'curveLeft', 'curveLeft',
        ]);
        expect(r.closed).toBe(true);
        instr.render(r.pieces, r.steps);
        const chips = Array.from(document.querySelectorAll('#instr-root span[style]')).map((e) => e.textContent?.trim());
        expect(chips).toContain('1'); // cross route 1
        expect(chips).toContain('2'); // cross route 2
    });
});

describe('Favorites', () => {
    beforeEach(() => {
        localStorage.clear();
        document.body.innerHTML = '<div id="fav-root"></div>';
    });

    const demo = () => {
        const r = replayProgram(MANUAL_EXAMPLE_1);
        expect(r.closed).toBe(true);
        return { pieces: r.pieces, steps: r.steps };
    };

    it('shows an empty-state hint initially', () => {
        new Favorites('fav-root', () => {});
        expect(document.getElementById('fav-root')?.textContent).toContain('Favorites');
    });

    it('saves a track with thumbnail and lists it', () => {
        const favs = new Favorites('fav-root', () => {});
        const item = favs.add('My Loop', demo(), 'data:image/jpeg;base64,xyz');
        expect(item.name).toBe('My Loop');
        expect(favs.count).toBe(1);
        const card = document.querySelector('.favorite-card');
        expect(card).toBeTruthy();
        expect(card?.textContent).toContain('My Loop');
        expect(card?.textContent).toContain('20 pieces');
        expect(card?.querySelector('img')?.getAttribute('src')).toContain('data:image/jpeg');
    });

    it('round-trips placements exactly through localStorage', () => {
        const favs = new Favorites('fav-root', () => {});
        favs.add('Frame', demo(), 'thumb');
        // New instance reads from storage.
        const spy = vi.fn();
        new Favorites('fav-root', spy);
        (document.querySelector('.favorite-card') as HTMLElement).click();
        expect(spy).toHaveBeenCalledTimes(1);
        const loaded = spy.mock.calls[0][0];
        expect(JSON.parse(JSON.stringify(demo().pieces))).toEqual(loaded.pieces);
        expect(JSON.parse(JSON.stringify(demo().steps))).toEqual(loaded.steps);
    });

    it('auto-names when no name is given', () => {
        const favs = new Favorites('fav-root', () => {});
        expect(favs.add('  ', demo(), 't').name).toBe('Track 1');
        expect(favs.add('', demo(), 't').name).toBe('Track 2');
    });

    it('deletes via the × button without triggering load', () => {
        const spy = vi.fn();
        const favs = new Favorites('fav-root', spy);
        favs.add('X', demo(), 't');
        (document.querySelector('.favorite-delete') as HTMLElement).click();
        expect(favs.count).toBe(0);
        expect(spy).not.toHaveBeenCalled();
        expect(localStorage.getItem('railcube.favorites.v1')).toBe('[]');
    });
});

describe('lastTrack', () => {
    beforeEach(() => localStorage.clear());

    it('round-trips a track through localStorage', () => {
        const r = replayProgram(MANUAL_EXAMPLE_2);
        expect(r.closed).toBe(true);
        saveLastTrack({ pieces: r.pieces, steps: r.steps });
        const loaded = loadLastTrack();
        expect(loaded).not.toBeNull();
        expect(JSON.parse(JSON.stringify(r.pieces))).toEqual(loaded!.pieces);
        expect(JSON.parse(JSON.stringify(r.steps))).toEqual(loaded!.steps);
    });

    it('returns null when nothing is stored', () => {
        expect(loadLastTrack()).toBeNull();
    });

    it('returns null for corrupt storage', () => {
        localStorage.setItem('railcube.lastTrack.v1', '{not-json');
        expect(loadLastTrack()).toBeNull();
        localStorage.setItem('railcube.lastTrack.v1', '{"pieces":[],"steps":[]}');
        expect(loadLastTrack()).toBeNull();
    });
});
