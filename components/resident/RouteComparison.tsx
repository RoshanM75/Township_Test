import { AlertTriangle, Check, CloudRain, Footprints, Lightbulb, Umbrella, Circle, CheckCircle2 } from 'lucide-react';
import { routeChoiceGroups } from '@/lib/resident-presentation';
import { residentText, type ResidentLanguage, type ResidentLabel } from '@/lib/resident-language';
import { roofMetres, routeLabel, walkMinutes } from '@/lib/resident-walking';
import type { Mode } from '@/lib/routing';
import type { JourneyRoute } from '@/lib/walking';

const icons = { direct: Footprints, sheltered: CloudRain, coolest: Umbrella, safest: Lightbulb };

export function RouteCoverage({ route, language }: { route: JourneyRoute; language: ResidentLanguage }) {
    const distance = roofMetres(route);
    return <span className="tg-roof-detail" aria-label={`${distance} ${residentText(language, 'm of mapped roof cover')}`}>
        <span aria-hidden />{distance} {residentText(language, 'm mapped cover')}
    </span>;
}

export function RouteSun({ route, language, compact = false }: { route: JourneyRoute; language: ResidentLanguage; compact?: boolean }) {
    const exposure = route.sun_exposure;
    if (!exposure?.daylight_s) return null;
    const t = (label: ResidentLabel) => residentText(language, label);
    const allUnknown = exposure.unknown_s >= exposure.daylight_s - .01;
    const unknown = exposure.unknown_s >= 1 && `${Math.ceil(exposure.unknown_s / 60)} min ${t('shade unknown')}`;
    const minutes = exposure.sun_s / 60;
    return <span className="tg-route-sun">
        {allUnknown ? t('Shade unknown') : `${minutes >= .1 && minutes < 1 ? '<1' : Math.round(minutes)} min ${t('in direct sun')}`}
        {!allUnknown && unknown && ` · ${unknown}`}
        {!compact && exposure.longest_sun_m > 0 && <small>{t('Longest exposed stretch')} {Math.round(exposure.longest_sun_m)} m</small>}
    </span>;
}

export function RouteChecks({ route, language }: { route: JourneyRoute; language: ResidentLanguage }) {
    const t = (label: ResidentLabel) => residentText(language, label);
    const checked = route.suitability === 'green';
    return <p className={`tg-route-check ${checked ? 'tg-route-checked' : ''}`}>
        {checked ? <Check size={18} aria-hidden /> : <AlertTriangle size={18} aria-hidden />}
        <span>{t(checked ? 'Route checks are current' : 'Route conditions need checking')}
            {route.unverified_crossings > 0 && <small>{route.unverified_crossings} {t('crossings need checking')}</small>}
        </span>
    </p>;
}

export default function RouteComparison({ routes, modes, chosen, fastest, night, language, recommended, onChoose }: {
    routes: Partial<Record<Mode, JourneyRoute>>; modes: Mode[]; chosen: Mode; fastest: Mode; night: boolean;
    language: ResidentLanguage; recommended?: Mode | null; onChoose: (mode: Mode) => void;
}) {
    const t = (label: ResidentLabel) => residentText(language, label);
    const base = routes[fastest]?.total_min ?? 0;
    const baseSun = routes[fastest]?.sun_exposure;

    function choices(items: Mode[], samePath=false) {
        return items.map(mode => {
            const route = routes[mode];
            if (!route) return null;
            const Icon = icons[mode];
            const seconds = Math.max(0, Math.round((route.total_min - base) * 60));
            const sun = route.sun_exposure;
            const savings = sun && baseSun && sun.daylight_s > 0 ? Math.floor((baseSun.sun_s - sun.sun_s - sun.unknown_s) / 60) : 0;
            const extra = seconds >= 60 ? `${Math.ceil(seconds / 60)} min` : `${seconds} ${t('sec')}`;
            const selected=chosen===mode;
            return <button type="button" key={mode} className="tg-route-card" data-mode={mode} aria-pressed={selected} onClick={()=>onChoose(mode)}>
                <span className="tg-route-mode-icon"><Icon size={23} strokeWidth={1.8} aria-hidden/></span>
                <span className="tg-route-card-label">
                    <strong>{t(routeLabel(mode,night,fastest))}</strong>
                    {samePath&&<small className="tg-same-path-note">{t('Same mapped path')}</small>}
                    {recommended===mode&&<small className="tg-route-profile-match">{t('Suggested for your profile')}</small>}
                    <RouteCoverage route={route} language={language}/>
                    <RouteSun route={route} language={language} compact/>
                    {savings>0&&<small>{savings} min {t('less in direct sun')}</small>}
                    {route.mapped_rest_stops!==undefined&&route.mapped_rest_stops>0&&<small>{route.mapped_rest_stops} {t('mapped rest locations on route')}</small>}
                </span>
                <span className="tg-route-card-time"><strong>{walkMinutes(route)} <small>min</small></strong>
                    {seconds>0?<small>{extra} {t('longer')}</small>:<small>{Math.round(route.length_m)} m</small>}
                    {selected?<CheckCircle2 size={21} className="tg-choice-indicator" aria-hidden/>:<Circle size={21} className="tg-choice-indicator" aria-hidden/>}
                </span>
            </button>;
        });
    }

    const {lead,more}=routeChoiceGroups(routes,modes,chosen,fastest,recommended);
    return <div className="tg-stack" role="group" aria-label={t('Route choices')}>
        <div className="tg-route-grid">{choices(lead)}</div>
        {more.length > 0 && <details className="tg-details">
            <summary>{t('More route preferences')} · {more.length}</summary>
            <p className="tg-route-redundant">{t('Several route choices follow the same mapped path.')}</p>
            <div className="tg-route-grid">{choices(more,true)}</div>
        </details>}
    </div>;
}
