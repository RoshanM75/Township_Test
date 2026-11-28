'use client';

import { useEffect, useRef } from 'react';
import { ChevronDown, ChevronUp, Maximize2, Minimize2 } from 'lucide-react';
import { residentText, type ResidentLabel, type ResidentLanguage } from '@/lib/resident-language';

import { panelTap,panelStep,panelDrag,type PanelState } from '@/lib/resident-presentation';
export type {PanelState} from '@/lib/resident-presentation';

export default function PanelGrip({ state, openLabel, controls, language, onChange }: {
    state: PanelState; openLabel: ResidentLabel; controls: string; language: ResidentLanguage; onChange: (state: PanelState) => void;
}) {
    const start = useRef<number | null>(null);
    const handledPointer = useRef(false);
    const grip = useRef<HTMLButtonElement>(null);
    useEffect(()=>{
        const element=grip.current;
        // The sheet moves as pointer-up completes a touch action. Suppress the
        // subsequent emulated click so it cannot activate a newly exposed card.
        const preventEmulatedClick=(event:TouchEvent)=>{
            if(handledPointer.current&&event.cancelable)event.preventDefault();
        };
        element?.addEventListener('touchend',preventEmulatedClick,{passive:false});
        return ()=>element?.removeEventListener('touchend',preventEmulatedClick);
    },[]);
    const open = state !== 'min';
    const Icon = open ? ChevronDown : ChevronUp;
    const t=(label:ResidentLabel)=>residentText(language,label);
    const up=()=>onChange(panelStep(state,'up'));
    const down=()=>onChange(panelStep(state,'down'));
    return <div className="tg-grip-group">
        <button ref={grip} type="button" className="tg-panel-grip" aria-controls={controls} aria-expanded={open}
            onPointerDown={event => {
                if (!event.isPrimary || event.button !== 0) return;
                start.current = event.clientY;
                handledPointer.current = false;
                event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerUp={event => {
                if (start.current === null) return;
                const travel = event.clientY - start.current;
                start.current = null;
                const next=panelDrag(state,travel);
                if(next!==null){handledPointer.current=true;onChange(next);return;}
                // Some mobile browsers suppress the compatibility click on a tap
                // immediately after a drag. Complete touch taps on pointer-up.
                if(event.pointerType==='touch'){
                    handledPointer.current=true;
                    const bounds=event.currentTarget.getBoundingClientRect();
                    if(event.clientX>=bounds.left&&event.clientX<=bounds.right&&event.clientY>=bounds.top&&event.clientY<=bounds.bottom)onChange(panelTap(state));
                }
            }}
            onPointerCancel={() => { start.current = null; }}
            onKeyDown={event => {
                if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
                event.preventDefault();
                if(event.key==='ArrowUp')up();else down();
            }}
            onClick={event => {
                if (handledPointer.current && event.detail) { handledPointer.current = false; return; }
                onChange(panelTap(state));
            }}>
            <Icon size={18} strokeWidth={2} aria-hidden /> <span>{t(open ? 'Minimise' : openLabel)}</span>
        </button>
        {open && <button type="button" className="tg-panel-size" aria-controls={controls}
            aria-label={t(state==='full'?'Return to half view':'Expand to full view')}
            title={t(state==='full'?'Return to half view':'Expand to full view')}
            onClick={()=>onChange(state==='full'?'open':'full')}>
            {state==='full'?<Minimize2 size={18} aria-hidden/>:<Maximize2 size={18} aria-hidden/>}
        </button>}
    </div>;
}
