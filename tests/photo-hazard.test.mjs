import assert from 'node:assert/strict';
import test from 'node:test';
import { PHOTO_PROMPTS, readPhotoScores, photoDescription } from '../lib/photo-hazard.ts';

const scoresWith = (weights) => {
    const base = PHOTO_PROMPTS.map(prompt => ({ label: prompt.label, score: 0.01 }));
    for (const [label, score] of Object.entries(weights)) base.find(entry => entry.label === label).score = score;
    return base;
};

test('every photo description maps to a known hazard kind or to "not a hazard"', () => {
    const kinds = new Set(['blocked', 'no_ramp', 'light_out', 'no_shade', 'broken_surface', null]);
    for (const prompt of PHOTO_PROMPTS) {
        assert.ok(kinds.has(prompt.kind), prompt.label);
        assert.equal(Boolean(prompt.detail), prompt.kind !== null, prompt.label);
    }
    assert.equal(new Set(PHOTO_PROMPTS.map(p => p.label)).size, PHOTO_PROMPTS.length);
});

test('a clear photo picks its kind and wording', () => {
    const reading = readPhotoScores(scoresWith({ 'a broken street lamp': 0.8 }));
    assert.equal(reading.kind, 'light_out');
    assert.equal(reading.confident, true);
    assert.match(reading.detail, /lamp/i);
});

test('kinds with more descriptions are not favoured by sheer count', () => {
    // three weak "blocked" descriptions must not outvote one strong "no_shade" description
    const reading = readPhotoScores(scoresWith({
        'a footpath blocked by a parked car or motorcycle': 0.15, 'a fallen tree or branches blocking a walkway': 0.15,
        'construction barriers blocking a sidewalk': 0.15, 'a sunny footpath with no shade or trees': 0.3,
    }));
    assert.equal(reading.kind, 'no_shade');
});

test('photos that are not of a hazard fill in nothing', () => {
    const reading = readPhotoScores(scoresWith({ 'a selfie or portrait of a person': 0.9 }));
    assert.equal(reading.kind, null);
    assert.equal(photoDescription(reading, 'Main Library'), '');
});

test('close calls are suggestions, not confident answers', () => {
    const reading = readPhotoScores(scoresWith({ 'a cracked and broken sidewalk': 0.3, 'a high curb with no wheelchair ramp': 0.28 }));
    assert.equal(reading.kind, 'broken_surface');
    assert.equal(reading.confident, false);
});

test('unknown labels, bad scores and empty input are ignored safely', () => {
    assert.equal(readPhotoScores([]).kind, null);
    assert.equal(readPhotoScores([{ label: 'a cat', score: 1 }, { label: 'a broken street lamp', score: Number.NaN }]).kind, null);
});

test('the details sentence names the nearest path when there is one', () => {
    const reading = readPhotoScores(scoresWith({ 'a flooded footpath covered in water': 0.9 }));
    assert.equal(photoDescription(reading, 'Jalan Universiti'), 'Footpath flooded with standing water. Near Jalan Universiti.');
    assert.equal(photoDescription(reading, null), 'Footpath flooded with standing water.');
});
