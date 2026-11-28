'use client';
import { useId } from 'react';
import { requiresStepFreeProfile, type Profile } from '@/lib/routing';
import { type WalkingNeeds } from '@/lib/walking';
import { residentText, type ResidentLabel, type ResidentLanguage } from '@/lib/resident-language';

export default function WalkingRequirements({ needs, profile, onChange, language = 'en' }: { needs: WalkingNeeds; profile: Profile; onChange: (value: WalkingNeeds) => void; language?: ResidentLanguage }) {
    const t = (label: ResidentLabel) => residentText(language, label);
    const id = useId();
    const set = <K extends keyof WalkingNeeds>(key: K, value: WalkingNeeds[K]) => onChange({ ...needs, [key]: value });
    return (
        <details className="tg-details tg-profile-advanced">
            <summary>{t('Advanced access and rest settings')}</summary>
            <div className="mt-3 space-y-3 text-sm">
                {([
                    ['step_free', 'Step-free paths and access points'],
                    ['avoid_uncontrolled_crossings', 'Use controlled or marked crossings'],
                    ['avoid_uneven_surfaces', 'Avoid uneven or broken surfaces'],
                    ['require_tactile_crossings', 'Require tactile paving at crossings'],
                    ['require_tactile_continuity', 'Require checked continuous tactile guidance'],
                    ['require_audible_crossings', 'Require audible pedestrian signals at crossings'],
                    ['verified_only', 'Require current checks for critical conditions'],
                    ['require_rests', 'I need regular, verified rest facilities'],
                ] as const).map(([key, label]) => <label key={key} className="flex min-h-11 items-center gap-3">
                    <input type="checkbox" className="h-5 w-5" checked={key === 'step_free' && requiresStepFreeProfile(profile) ? true : needs[key]}
                        disabled={key === 'step_free' && requiresStepFreeProfile(profile)} onChange={e => set(key, e.target.checked)} />{t(label)}
                </label>)}
                <div className="grid grid-cols-2 gap-3">
                    <label htmlFor={`${id}-slope`}>{t('Maximum slope (%)')}
                        <input id={`${id}-slope`} type="number" min={0} max={20} step={.5} value={needs.max_slope_pct} className="mt-1 min-h-11 w-full rounded border border-slate-400 px-2" onChange={e => set('max_slope_pct', Math.max(0, Math.min(20, Number(e.target.value))))} />
                    </label>
                    <label htmlFor={`${id}-pace`}>{t('Walking pace')}
                        <select id={`${id}-pace`} value={needs.speed_mps ?? ''} className="mt-1 min-h-11 w-full rounded border border-slate-400 bg-white px-2" onChange={e => set('speed_mps', e.target.value ? Number(e.target.value) : null)}>
                            <option value="">{t('Profile estimate')}</option><option value="0.5">0.5 m/s</option><option value="0.6">0.6 m/s</option><option value="0.7">0.7 m/s</option><option value="1">1 m/s</option><option value="1.3">1.3 m/s</option>
                            {needs.speed_mps !== null && ![.5,.6,.7,1,1.3].includes(needs.speed_mps) && <option value={needs.speed_mps}>{t('Personal pace')}: {needs.speed_mps} m/s</option>}
                        </select>
                    </label>
                    <label htmlFor={`${id}-width`}>{t('Minimum clear path width')}
                        <select id={`${id}-width`} className="mt-1 min-h-11 w-full rounded border border-slate-400 bg-white px-2"
                            value={needs.min_clear_width_m ?? ''} onChange={e => set('min_clear_width_m', e.target.value ? Number(e.target.value) : null)}>
                            <option value="">{t('No minimum')}</option>
                            {[...new Set([.75, .9, 1, 1.2, 1.5, 1.8, 2, ...(needs.min_clear_width_m === null ? [] : [needs.min_clear_width_m])])].sort((a,b)=>a-b).map(width => <option key={width} value={width}>{width} m</option>)}
                        </select>
                    </label>
                </div>
                {needs.require_rests && <div className="grid grid-cols-2 gap-3">
                    <label htmlFor={`${id}-interval`}>{t('Rest at least every')}
                        <select id={`${id}-interval`} value={needs.rest_interval_min} className="mt-1 min-h-11 w-full rounded border border-slate-400 bg-white px-2" onChange={e => set('rest_interval_min', Number(e.target.value))}>
                            {[...new Set([1,3,5,10,15,20,30,needs.rest_interval_min])].sort((a,b)=>a-b).map(n => <option key={n} value={n}>{n} {t('Minutes').toLowerCase()}</option>)}
                        </select>
                    </label>
                    <label htmlFor={`${id}-duration`}>{t('Time at each rest')}
                        <select id={`${id}-duration`} value={needs.rest_duration_min} className="mt-1 min-h-11 w-full rounded border border-slate-400 bg-white px-2" onChange={e => set('rest_duration_min', Number(e.target.value))}>
                            {[...new Set([1,2,3,5,10,needs.rest_duration_min])].sort((a,b)=>a-b).map(n => <option key={n} value={n}>{n} {t('Minutes').toLowerCase()}</option>)}
                        </select>
                    </label>
                </div>}
                {needs.require_rests && <div className="space-y-1">{([
                    ['rest_backrest','Seat needs a backrest'], ['rest_armrests','Seat needs armrests'], ['rest_shelter','Rest facilities need shelter'],
                ] as const).map(([key,label]) => <label key={key} className="flex min-h-11 items-center gap-3"><input type="checkbox" className="h-5 w-5" checked={needs[key]} onChange={e => set(key,e.target.checked)} />{t(label)}</label>)}</div>}
                <p className="text-xs leading-relaxed text-slate-600">{t('Width, tactile paving and audible signals have limited map coverage. A selected requirement can exclude paths or crossings with missing matching information. Required rests use current facility checks.')}</p>
            </div>
        </details>
    );
}
