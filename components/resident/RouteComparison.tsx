import { AlertTriangle, Check, CloudRain, Footprints, Lightbulb, Umbrella } from 'lucide-react';
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

export default function RouteComparison({ routes, modes, chosen, fastest, night, language, onChoose }: {
    routes: Partial<Record<Mode, JourneyRoute>>; modes: Mode[]; chosen: Mode; fastest: Mode; night: boolean;
    language: ResidentLanguage; onChoose: (mode: Mode) => void;
}) {
    const t = (label: ResidentLabel) => residentText(language, label);
    const base = routes[fastest]?.total_min ?? 0;

    function choices(items: Mode[]) {
        return items.map(mode => {
            const route = routes[mode];
            if (!route) return null;
            const Icon = icons[mode];
            const seconds = Math.max(0, Math.round((route.total_min - base) * 60));
            const extra = seconds >= 60 ? `${Math.ceil(seconds / 60)} min` : `${seconds} ${t('sec')}`;
            return <button type="button" key={mode} className="tg-route-card" aria-pressed={chosen === mode} onClick={() => onChoose(mode)}>
                <Icon size={20} aria-hidden />
                <span className="tg-route-card-label"><strong>{t(routeLabel(mode, night, fastest))}</strong>
                    <RouteCoverage route={route} language={language} />
                </span>
                <span className="tg-route-card-time"><strong>{walkMinutes(route)} min</strong>
                    {seconds ? <small>{extra} {t('longer')}</small> : <small>{Math.round(route.length_m)} m</small>}
                </span>
            </button>;
        });
    }

    const lead = [...new Set([fastest, 'sheltered' as Mode, chosen])].filter(mode => modes.includes(mode));
    const more = modes.filter(mode => !lead.includes(mode));
    return <div className="tg-stack" role="group" aria-label={t('Route choices')}>
        <div className="tg-route-grid">{choices(lead)}</div>
        {more.length > 0 && <details className="tg-details">
            <summary>{t('Other routes')}</summary>
            <div className="tg-route-grid">{choices(more)}</div>
        </details>}
    </div>;
}
