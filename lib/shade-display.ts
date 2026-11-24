import { malaysiaTimeLabel, residentText, type ResidentLabel, type ResidentLanguage } from './resident-language.ts';
import { spotShade } from './route-shade.ts';
import type { ShadeReading, SolarModel } from './solar-shade.ts';
import { evidenceFor } from './verification.ts';
import type { JourneyRoute, VerificationRecord, WalkingAsset } from './walking.ts';

export function shadeLabel({ condition, source }: ShadeReading, language: ResidentLanguage) {
    let label: ResidentLabel = 'Shade unknown';
    if (condition === 'sun') label = source === 'checked' ? 'Field-checked direct sun' : 'Estimated direct sun';
    if (condition === 'shade') label = source === 'checked' ? 'Field-checked shade' : 'Estimated shade';
    if (condition === 'covered') label = source === 'checked' ? 'Checked roof cover' : 'Mapped roof cover';
    if (condition === 'night') label = 'Outside daylight';
    return residentText(language, label);
}

export function spotDetails(asset: WalkingAsset, time: string, records: VerificationRecord[], language: ResidentLanguage,
    model?: SolarModel, route?: JourneyRoute) {
    const rest = route?.steps?.find(step => step.kind === 'rest' && step.asset_id === asset.id);
    const arrival = route?.entrance.id === asset.id ? route.arrival_at : rest && route
        ? new Date(Date.parse(route.departure_at) + (rest.start_min + Math.max(0, rest.end_min - rest.start_min -
            route.rest_min / Math.max(1, route.rest_stops.length)) / 2) * 60000).toISOString() : undefined;
    const at = arrival ?? time;
    const t = (label: ResidentLabel) => residentText(language, label);
    const check = evidenceFor(records, asset.kind === 'entrance' ? 'entrance' : 'facility', asset.id, at);
    return [
        `${t(arrival ? 'At arrival' : 'Shade at this time')} · ${malaysiaTimeLabel(at, language)} MYT`,
        shadeLabel(spotShade(asset, at, records, model), language),
        check.step_free?.status === 'verified' ? t(check.step_free.value === true ? 'Step-free access checked' : 'Stairs or barriers recorded') : '',
        check.has_seat?.status === 'verified' && check.has_seat.value === true ? t('Seat checked') : '',
    ].filter(Boolean);
}
