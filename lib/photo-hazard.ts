import type { HazardKind } from './routing.ts';

/**
 * Reads a hazard photo with an image–text model (CLIP, zero-shot) in the browser.
 * The model compares the photo against the short descriptions below and the
 * best-matching hazard kind and wording fill in the report form.
 * Nothing is uploaded: the model is downloaded once and runs on the device.
 */

export interface PhotoPrompt {
    /** Text shown to the model. Short, concrete scene descriptions work best for CLIP. */
    label: string;
    /** Hazard kind this description stands for, or null when the photo is not a hazard. */
    kind: HazardKind | null;
    /** Sentence written into the report details when this description wins. */
    detail: string;
}

export const PHOTO_PROMPTS: readonly PhotoPrompt[] = [
    { label: 'a cracked and broken sidewalk', kind: 'broken_surface', detail: 'Cracked or broken paving on the footpath.' },
    { label: 'a footpath with potholes and loose paving tiles', kind: 'broken_surface', detail: 'Potholes or loose paving tiles on the footpath.' },
    { label: 'an uneven walkway with a missing drain cover', kind: 'broken_surface', detail: 'Uneven surface or missing drain cover on the walkway.' },
    { label: 'a footpath blocked by a parked car or motorcycle', kind: 'blocked', detail: 'Vehicle parked on the footpath, blocking the way.' },
    { label: 'a fallen tree or branches blocking a walkway', kind: 'blocked', detail: 'Fallen tree or branches blocking the walkway.' },
    { label: 'construction barriers blocking a sidewalk', kind: 'blocked', detail: 'Construction barriers blocking the sidewalk.' },
    { label: 'a flooded footpath covered in water', kind: 'blocked', detail: 'Footpath flooded with standing water.' },
    { label: 'a broken street lamp', kind: 'light_out', detail: 'Street lamp appears broken or not working.' },
    { label: 'a dark unlit footpath at night', kind: 'light_out', detail: 'Path is dark at night with no working lights.' },
    { label: 'a sunny footpath with no shade or trees', kind: 'no_shade', detail: 'Long stretch in direct sun with no shade or shelter.' },
    { label: 'an exposed walkway under strong midday sun', kind: 'no_shade', detail: 'Walkway fully exposed to strong sun.' },
    { label: 'a high curb with no wheelchair ramp', kind: 'no_ramp', detail: 'High kerb with no ramp for wheelchairs or prams.' },
    { label: 'stairs with no ramp for wheelchairs', kind: 'no_ramp', detail: 'Steps with no ramp alternative.' },
    { label: 'a selfie or portrait of a person', kind: null, detail: '' },
    { label: 'food or objects on a table', kind: null, detail: '' },
    { label: 'the inside of a room or building', kind: null, detail: '' },
    { label: 'a screenshot of a phone or computer screen', kind: null, detail: '' },
] as const;

export const HYPOTHESIS_TEMPLATE = 'a photo of {}';

/** Below this share of the vote the result is shown as a suggestion only. */
export const CONFIDENT = 0.45;
/** The winner must also beat the runner-up by this factor; near-ties are suggestions only. */
export const CLEAR_LEAD = 1.5;

export interface PhotoScore { label: string; score: number }

export interface PhotoReading {
    kind: HazardKind | null;
    /** Share of the vote for the winning kind, 0–1, after grouping descriptions by kind. */
    confidence: number;
    confident: boolean;
    detail: string;
    /** Winning description, for transparency in the UI. */
    label: string | null;
}

/**
 * Groups the model's scores by hazard kind (taking each kind's best description, so kinds
 * with more descriptions are not favoured) and returns the winner.
 */
export function readPhotoScores(scores: readonly PhotoScore[], prompts: readonly PhotoPrompt[] = PHOTO_PROMPTS): PhotoReading {
    const byLabel = new Map(prompts.map(prompt => [prompt.label, prompt]));
    const best = new Map<HazardKind | 'none', { score: number; prompt: PhotoPrompt }>();
    for (const { label, score } of scores) {
        const prompt = byLabel.get(label);
        if (!prompt || !Number.isFinite(score) || score < 0) continue;
        const key = prompt.kind ?? 'none';
        const current = best.get(key);
        if (!current || score > current.score) best.set(key, { score, prompt });
    }
    const total = [...best.values()].reduce((sum, entry) => sum + entry.score, 0);
    const ranked = [...best.entries()].sort((a, b) => b[1].score - a[1].score);
    if (!ranked.length || total <= 0) return { kind: null, confidence: 0, confident: false, detail: '', label: null };
    const [key, winner] = ranked[0];
    const confidence = winner.score / total;
    if (key === 'none') return { kind: null, confidence, confident: false, detail: '', label: winner.prompt.label };
    const runnerUp = ranked[1]?.[1].score ?? 0;
    const confident = confidence >= CONFIDENT && winner.score >= runnerUp * CLEAR_LEAD;
    return { kind: key, confidence, confident, detail: winner.prompt.detail, label: winner.prompt.label };
}

/** The sentence written into the report's details box. */
export function photoDescription(reading: PhotoReading, locationName?: string | null): string {
    if (!reading.kind || !reading.detail) return '';
    const place = locationName?.trim();
    return place ? `${reading.detail} Near ${place}.` : reading.detail;
}
