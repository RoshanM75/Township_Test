'use client';

import { useRef } from 'react';
import { ChevronDown, ChevronUp, ChevronsUp } from 'lucide-react';

/** Mobile panel heights: just the grip, part of the screen, or most of the screen. */
export type PanelState = 'min' | 'partial' | 'full';

const ORDER: PanelState[] = ['min', 'partial', 'full'];

/** Approximate snap heights in px for the current screen; they mirror resident.css. */
function snapHeights(): Record<PanelState, number> {
    const vh = window.innerHeight;
    const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    return { min: 3.4 * rem, partial: Math.min(0.32 * vh, 18 * rem), full: 0.78 * vh };
}

/** Picks the state to settle on after a drag, from where the panel ended up and how fast it was moving. */
export function settleState(height: number, velocity: number, heights: Record<PanelState, number>): PanelState {
    // A quick flick moves one step in the flick's direction (negative velocity = upward).
    const projected = height - velocity * 180;
    let best: PanelState = 'partial', distance = Infinity;
    for (const state of ORDER) {
        const d = Math.abs(heights[state] - projected);
        if (d < distance) { distance = d; best = state; }
    }
    return best;
}

const LABEL: Record<PanelState, (walk: boolean) => string> = {
    min: walk => (walk ? 'Show walk controls' : 'Show panel'),
    partial: () => 'Expand panel',
    full: () => 'Collapse panel',
};

export default function PanelGrip({ state, walk, onChange }: { state: PanelState; walk: boolean; onChange: (state: PanelState) => void }) {
    const drag = useRef<{ y: number; height: number; sheet: HTMLElement; lastY: number; lastT: number; velocity: number; moved: boolean } | null>(null);
    const suppressClick = useRef(false);
    const Icon = state === 'min' ? ChevronUp : state === 'partial' ? ChevronsUp : ChevronDown;

    function step(direction: 1 | -1) {
        const next = ORDER[Math.min(ORDER.length - 1, Math.max(0, ORDER.indexOf(state) + direction))];
        if (next !== state) onChange(next);
    }

    return (
        <button type="button" className="tg-panel-grip" aria-controls="walking-panel" aria-expanded={state !== 'min'}
            data-state={state}
            onPointerDown={event => {
                if (!event.isPrimary || event.button !== 0) return;
                const sheet = event.currentTarget.closest<HTMLElement>('.tg-sheet');
                if (!sheet) return;
                drag.current = { y: event.clientY, height: sheet.getBoundingClientRect().height, sheet,
                    lastY: event.clientY, lastT: event.timeStamp, velocity: 0, moved: false };
                suppressClick.current = false;
                event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerMove={event => {
                const d = drag.current;
                if (!d) return;
                const dy = event.clientY - d.y;
                if (!d.moved && Math.abs(dy) < 6) return;
                d.moved = true;
                const dt = Math.max(1, event.timeStamp - d.lastT);
                d.velocity = 0.8 * ((event.clientY - d.lastY) / dt) + 0.2 * d.velocity; // px per ms, smoothed
                d.lastY = event.clientY; d.lastT = event.timeStamp;
                const { min, full } = snapHeights();
                const height = Math.min(full + 24, Math.max(min, d.height - dy));
                d.sheet.classList.add('is-dragging');
                d.sheet.style.setProperty('--sheet-drag', `${height}px`);
            }}
            onPointerUp={() => {
                const d = drag.current;
                drag.current = null;
                if (!d?.moved) return;
                suppressClick.current = true;
                const height = d.sheet.getBoundingClientRect().height;
                const next = settleState(height, d.velocity, snapHeights());
                // Hand the height back to CSS in the same frame as the new state, so the sheet animates from here.
                d.sheet.classList.remove('is-dragging');
                d.sheet.style.removeProperty('--sheet-drag');
                onChange(next);
            }}
            onPointerCancel={() => {
                const d = drag.current;
                drag.current = null;
                if (d) { d.sheet.classList.remove('is-dragging'); d.sheet.style.removeProperty('--sheet-drag'); }
            }}
            onKeyDown={event => {
                if (event.key === 'ArrowUp') { event.preventDefault(); step(1); }
                if (event.key === 'ArrowDown') { event.preventDefault(); step(-1); }
            }}
            onClick={event => {
                if (suppressClick.current && event.detail !== 0) { suppressClick.current = false; return; }
                // Tap: open from minimised, otherwise toggle between part and full height.
                onChange(state === 'min' ? 'partial' : state === 'partial' ? 'full' : 'partial');
            }}
        >
            <span className="tg-panel-grip-bar" aria-hidden />
            <span><Icon size={15} aria-hidden />{LABEL[state](walk)}</span>
        </button>
    );
}
