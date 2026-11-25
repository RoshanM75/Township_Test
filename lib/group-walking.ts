import { PROFILES, requiresStepFreeProfile, type Profile } from './routing.ts';
import { normaliseNeeds } from './journeys.ts';
import type { WalkingSettings } from './walking-profile.ts';

/** Merge constraints, never average away a member's required condition. */
export function groupWalkingSettings(members: WalkingSettings[]): WalkingSettings {
    if (!members.length) throw Error('Choose at least one walker.');
    const all = members.map(member => ({ profile: member.profile, needs: normaliseNeeds(member.needs) }));
    const selected: Profile = all.some(m => m.profile === 'wheelchair') ? 'wheelchair'
        : all.some(m => m.profile === 'stroller') ? 'stroller'
        : all.slice().sort((a,b) => PROFILES[a.profile].speed_mps - PROFILES[b.profile].speed_mps)[0].profile;
    const needs = all.map(m => m.needs);
    const rests = needs.filter(n => n.require_rests);
    const widths = needs.flatMap(n => n.min_clear_width_m === null ? [] : [n.min_clear_width_m]);
    return { profile: selected, needs: normaliseNeeds({
        ...needs[0], step_free: all.some(m => m.needs.step_free || requiresStepFreeProfile(m.profile)),
        speed_mps: Math.min(...all.map(m => m.needs.speed_mps ?? PROFILES[m.profile].speed_mps)),
        max_slope_pct: Math.min(...needs.map(n => n.max_slope_pct), selected === 'wheelchair' ? 8.33 : 20),
        min_clear_width_m: widths.length ? Math.max(...widths) : null,
        avoid_uncontrolled_crossings: needs.some(n => n.avoid_uncontrolled_crossings),
        avoid_uneven_surfaces: needs.some(n => n.avoid_uneven_surfaces),
        require_tactile_crossings: needs.some(n => n.require_tactile_crossings),
        require_audible_crossings: needs.some(n => n.require_audible_crossings),
        verified_only: needs.some(n => n.verified_only),
        require_rests: rests.length > 0,
        rest_interval_min: rests.length ? Math.min(...rests.map(n => n.rest_interval_min)) : needs[0].rest_interval_min,
        rest_duration_min: Math.max(...needs.map(n => n.rest_duration_min)),
        rest_backrest: rests.some(n => n.rest_backrest),
        rest_armrests: rests.some(n => n.rest_armrests),
        rest_shelter: rests.some(n => n.rest_shelter),
        comfort: [...new Set(needs.flatMap(n => n.comfort ?? []))],
        budget_min: Math.min(...needs.map(n => n.budget_min)),
    }) };
}
