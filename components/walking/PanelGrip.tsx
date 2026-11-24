'use client';

import { useRef } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { residentText, type ResidentLabel, type ResidentLanguage } from '@/lib/resident-language';

export type PanelState = 'min' | 'open';

export default function PanelGrip({ state, openLabel, controls, language, onChange }: {
    state: PanelState; openLabel: ResidentLabel; controls: string; language: ResidentLanguage; onChange: (state: PanelState) => void;
}) {
    const start = useRef<number | null>(null);
    const dragged = useRef(false);
    const open = state === 'open';
    const Icon = open ? ChevronDown : ChevronUp;
    return <button type="button" className="tg-panel-grip" aria-controls={controls} aria-expanded={open}
        onPointerDown={event => {
            if (!event.isPrimary || event.button !== 0) return;
            start.current = event.clientY;
            dragged.current = false;
            event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerUp={event => {
            if (start.current === null) return;
            const travel = event.clientY - start.current;
            start.current = null;
            if (Math.abs(travel) < 28) return;
            dragged.current = true;
            onChange(travel > 0 ? 'min' : 'open');
        }}
        onPointerCancel={() => { start.current = null; }}
        onKeyDown={event => {
            if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
            event.preventDefault();
            onChange(event.key === 'ArrowUp' ? 'open' : 'min');
        }}
        onClick={event => {
            if (dragged.current && event.detail) { dragged.current = false; return; }
            onChange(open ? 'min' : 'open');
        }}>
        <Icon size={18} aria-hidden /> {residentText(language, open ? 'Minimise' : openLabel)}
    </button>;
}
