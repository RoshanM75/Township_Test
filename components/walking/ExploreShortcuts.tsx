'use client';

import { MapPin, ListChecks, Route, TrainFront, ChevronRight, RotateCcw, type LucideIcon } from 'lucide-react';
import { residentText, type ResidentLanguage, type ResidentLabel } from '@/lib/resident-language';

const tasks: { id: 'nearby'|'errands'|'guides'|'transit'; label: ResidentLabel; Icon: LucideIcon; tone: string }[] = [
    { id: 'nearby', label: 'Nearby places', Icon: MapPin, tone: 'green' },
    { id: 'errands', label: 'Errands', Icon: ListChecks, tone: 'rose' },
    { id: 'guides', label: 'Local guides', Icon: Route, tone: 'gold' },
    { id: 'transit', label: 'Transit', Icon: TrainFront, tone: 'blue' },
];

export type ExploreTask = typeof tasks[number]['id'];

export default function ExploreShortcuts({ language, ready, guidesReady, transitReady, onChoose }: {
    language: ResidentLanguage; ready: boolean; guidesReady: boolean; transitReady: boolean; onChoose: (task: ExploreTask) => void;
}) {
    return <div className="tg-explore-shortcuts" role="group" aria-label={residentText(language, 'Everyday walking tools')}>
        {tasks.map(({ id, label, Icon, tone }) => {
            const enabled=id==='guides'?guidesReady:id==='transit'?transitReady:ready;
            return <button type="button" key={id} className="tg-shortcut" disabled={!enabled} onClick={()=>onChoose(id)}>
                <span className="tg-shortcut-icon" data-tone={tone}><Icon size={21} strokeWidth={1.85} aria-hidden /></span>
                <span>{residentText(language,label)}</span>
            </button>;
        })}
    </div>;
}

export function ReturnWalkCard({ language, ready, onReturn }: {language:ResidentLanguage; ready:boolean; onReturn:(minutes:number)=>void}) {
    const t=(label:ResidentLabel)=>residentText(language,label);
    return <section className="tg-return-card">
        <div className="tg-return-copy">
            <span className="tg-return-icon"><RotateCcw size={24} strokeWidth={1.8} aria-hidden /></span>
            <div><h2>{t('A walk that brings you back')}</h2><p>{t('Start and finish at the same place, at your pace.')}</p></div>
        </div>
        <div className="tg-return-actions">
            {[15,30].map(minutes=><button className="tg-btn" key={minutes} type="button" disabled={!ready} onClick={()=>onReturn(minutes)}>{t('Up to')} {minutes} min <ChevronRight size={17} aria-hidden/></button>)}
        </div>
        <p className="tg-small">{t('Includes the return, crossing waits and required rests. Paths may be retraced.')}</p>
    </section>;
}
