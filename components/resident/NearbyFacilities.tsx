'use client';

import { useState } from 'react';
import { Armchair, Cross, MapPin, Toilet } from 'lucide-react';
import { residentText, type ResidentLabel, type ResidentLanguage } from '@/lib/resident-language';
import { nearestFacilities, residentPlaceName, type NearbyFacility } from '@/lib/resident-walking';
import type { WalkingAsset } from '@/lib/walking';

export default function NearbyFacilities({ assets, centre, language, onFocus, onPlan }: {
    assets: WalkingAsset[]; centre: [number, number]; language: ResidentLanguage;
    onFocus: (asset: WalkingAsset) => void; onPlan: (asset: WalkingAsset) => void;
}) {
    const t = (label: ResidentLabel) => residentText(language, label);
    const [category, setCategory] = useState<NearbyFacility>('toilet');
    const list = nearestFacilities(assets, category, centre);
    return <div className="tg-stack">
        <div className="tg-nearby-options" role="group" aria-label={t('Nearby facilities')}>
            {([['toilet', 'Toilets', Toilet], ['rest', 'Seats', Armchair], ['clinic', 'Clinics', Cross]] as const).map(([kind, label, Icon]) =>
                <button type="button" className="tg-card" key={kind} aria-pressed={category === kind} onClick={() => setCategory(kind)}>
                    <Icon size={19} aria-hidden />{t(label)}
                </button>)}
        </div>
        {list.length ? <ul className="tg-nearby-list">
            {list.map(({ asset, distance }) => <li key={asset.id}>
                <strong>{residentPlaceName(asset)}</strong>
                <p className="tg-small">{Math.round(distance)} {t('m away on the map')}</p>
                <div className="tg-nearby-actions">
                    <button type="button" className="tg-text-action" onClick={() => onFocus(asset)}><MapPin size={17} aria-hidden />{t('Show on map')}</button>
                    <button type="button" className="tg-text-action" onClick={() => onPlan(asset)}>{t('Plan a walk')}</button>
                </div>
            </li>)}
        </ul> : <p className="tg-note" role="status">{t('No mapped facilities nearby.')}</p>}
    </div>;
}
