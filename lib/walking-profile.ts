import { normaliseNeeds } from './journeys.ts';
import { isWalkingProfile, requiresStepFreeProfile, type Profile } from './routing.ts';
import { DEFAULT_NEEDS, type WalkingNeeds } from './walking.ts';

export const WALKING_PROFILE_KEY = 'townshipgo:walking-profile:v1';
const OLD_PROFILE_KEY = 'townshipgo:selected-profile:v1';
const OLD_NEEDS_KEY = 'townshipgo:walking-needs:v1';

export interface WalkingSettings {
    profile: Profile;
    needs: WalkingNeeds;
}

export interface DeviceWalkingProfile {
    version: 1;
    status: 'new' | 'skipped' | 'complete';
    settings: WalkingSettings;
}

export function defaultWalkingSettings(): WalkingSettings {
    // Keep the legacy routing/API defaults intact. New walkers choose their own
    // requirements instead of starting with an implied mobility limitation.
    return { profile: 'everyday', needs: normaliseNeeds({ ...DEFAULT_NEEDS, max_slope_pct: 20 }) };
}

export function normaliseWalkingSettings(profile: unknown, needs: unknown): WalkingSettings {
    const mode = isWalkingProfile(profile) ? profile : 'everyday';
    const valid = normaliseNeeds(needs);
    return { profile: mode, needs: { ...valid, step_free: valid.step_free || requiresStepFreeProfile(mode) } };
}

export function newDeviceWalkingProfile(): DeviceWalkingProfile {
    return { version: 1, status: 'new', settings: defaultWalkingSettings() };
}

export function readDeviceWalkingProfile(storage: Pick<Storage, 'getItem'>): DeviceWalkingProfile {
    try {
        const raw = storage.getItem(WALKING_PROFILE_KEY);
        if (raw) {
            const value = JSON.parse(raw);
            if (value?.version === 1 && ['new', 'skipped', 'complete'].includes(value.status)
                && isWalkingProfile(value.settings?.profile) && value.settings.needs && typeof value.settings.needs === 'object') {
                return { version: 1, status: value.status, settings: normaliseWalkingSettings(value.settings.profile, value.settings.needs) };
            }
        }
    } catch { /* Try legacy device preferences; do not delete unreadable data. */ }
    try {
        const oldProfile = storage.getItem(OLD_PROFILE_KEY);
        const oldNeeds = storage.getItem(OLD_NEEDS_KEY);
        if (isWalkingProfile(oldProfile) || oldNeeds) {
            return { version: 1, status: 'new', settings: normaliseWalkingSettings(isWalkingProfile(oldProfile) ? oldProfile : 'senior', oldNeeds ? JSON.parse(oldNeeds) : DEFAULT_NEEDS) };
        }
    } catch { /* Unavailable or invalid legacy settings. */ }
    return newDeviceWalkingProfile();
}

export function writeDeviceWalkingProfile(storage: Pick<Storage, 'setItem' | 'removeItem'>, value: DeviceWalkingProfile) {
    storage.setItem(WALKING_PROFILE_KEY, JSON.stringify(value));
    // Only remove the old fields after the replacement has been written.
    try { storage.removeItem(OLD_PROFILE_KEY); storage.removeItem(OLD_NEEDS_KEY); } catch { /* The new record is authoritative. */ }
}

// Older share links can carry an entire walking profile. Read them as a
// temporary journey override only, never as the recipient's saved preferences.
export function sharedWalkingSettings(params: Pick<URLSearchParams, 'get'>, saved: WalkingSettings): WalkingSettings | null {
    const mode = params.get('profile');
    const raw = params.get('needs');
    const profile = isWalkingProfile(mode) ? mode : saved.profile;
    if (!raw && !isWalkingProfile(mode)) return null;
    let needs: unknown = { ...saved.needs, ...(profile !== saved.profile ? { speed_mps: null } : {}) };
    if (raw) {
        try {
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) needs = parsed;
        } catch { /* Use saved settings if a link was truncated or malformed. */ }
    }
    return normaliseWalkingSettings(profile, needs);
}

export function sharedWalkBudget(params: Pick<URLSearchParams, 'get'>): number | null {
    const raw = params.get('budget');
    const value = raw === null || raw.trim() === '' ? NaN : Number(raw);
    return Number.isFinite(value) && value >= 5 && value <= 120 ? value : null;
}
