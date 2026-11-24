'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { Camera, Loader2, Sparkles, X } from 'lucide-react';
import { HYPOTHESIS_TEMPLATE, PHOTO_PROMPTS, readPhotoScores, type PhotoReading, type PhotoScore } from '@/lib/photo-hazard';
import { residentText, type ResidentLanguage } from '@/lib/resident-language';

/* The model runs in the browser through transformers.js. It is loaded from a CDN at runtime
   (kept out of the bundle) and only when someone adds a photo; the browser caches it after that.
   Use the self-contained build: transformers.web.min.js imports onnxruntime by bare package name,
   which only a bundler can resolve, so a browser import of it always fails. */
const TRANSFORMERS_URL = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.2/dist/transformers.min.js';
const MODEL_ID = 'Xenova/clip-vit-base-patch32';

type Classifier = (image: string, labels: string[], options: { hypothesis_template: string }) => Promise<PhotoScore[]>;
type Progress = { status: string; progress?: number };
type TransformersModule = {
    pipeline: (task: 'zero-shot-image-classification', model: string,
        options: { dtype: 'q8'; progress_callback: (info: Progress) => void }) => Promise<Classifier>;
};

let classifierPromise: Promise<Classifier> | null = null;
let progressListener: ((percent: number) => void) | null = null;

function loadClassifier(onProgress: (percent: number) => void): Promise<Classifier> {
    progressListener = onProgress;
    if (!classifierPromise) {
        classifierPromise = (async () => {
            const transformers = await import(/* webpackIgnore: true */ /* turbopackIgnore: true */ TRANSFORMERS_URL) as TransformersModule;
            return transformers.pipeline('zero-shot-image-classification', MODEL_ID, {
                dtype: 'q8',
                progress_callback: info => {
                    if (info.status === 'progress_total' && typeof info.progress === 'number') progressListener?.(info.progress);
                },
            });
        })();
        classifierPromise.catch(() => { classifierPromise = null; });
    }
    return classifierPromise;
}

/** Shrinks the photo so it is quick to analyse and small enough to keep with the report. */
function shrinkPhoto(file: File, maxSide = 448): Promise<string> {
    return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file);
        const image = new Image();
        image.onload = () => {
            const scale = Math.min(1, maxSide / Math.max(image.width, image.height));
            const canvas = document.createElement('canvas');
            canvas.width = Math.round(image.width * scale);
            canvas.height = Math.round(image.height * scale);
            const context = canvas.getContext('2d');
            URL.revokeObjectURL(url);
            if (!context) return reject(new Error('This browser cannot read the photo.'));
            context.drawImage(image, 0, 0, canvas.width, canvas.height);
            resolve(canvas.toDataURL('image/jpeg', 0.75));
        };
        image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('That file could not be opened as a photo.')); };
        image.src = url;
    });
}

type State =
    | { phase: 'empty' }
    | { phase: 'loading'; percent: number | null }
    | { phase: 'analysing' }
    | { phase: 'done'; reading: PhotoReading }
    | { phase: 'failed'; message: string; withPhoto: boolean; reason?: string };

interface Props {
    photo: string | null;
    onPhoto: (photo: string | null) => void;
    /** Called with the model's reading so the form can choose a category and fill in details. */
    onReading: (reading: PhotoReading) => void;
    kindLabel: (kind: PhotoReading['kind']) => string;
    language?: ResidentLanguage;
}

export default function HazardPhotoInput({ photo, onPhoto, onReading, kindLabel, language = 'en' }: Props) {
    const inputId = useId();
    const inputRef = useRef<HTMLInputElement>(null);
    const runRef = useRef(0);
    const [state, setState] = useState<State>({ phase: 'empty' });
    // When the form clears the photo (for example after saving), stop any reading still in progress.
    useEffect(() => { if (!photo) runRef.current++; }, [photo]);
    // Messages about a photo only make sense while that photo is attached.
    const shown: State = photo || (state.phase === 'failed' && !state.withPhoto) ? state : { phase: 'empty' };

    async function choose(file: File | undefined) {
        if (!file) return;
        const run = ++runRef.current;
        let shrunk: string;
        try { shrunk = await shrinkPhoto(file); }
        catch (error) { setState({ phase: 'failed', withPhoto: false, message: error instanceof Error ? error.message : 'Could not open the photo.' }); return; }
        onPhoto(shrunk);
        setState({ phase: 'loading', percent: null });
        try {
            const classify = await loadClassifier(percent => { if (runRef.current === run) setState({ phase: 'loading', percent }); });
            if (runRef.current !== run) return;
            setState({ phase: 'analysing' });
            const scores = await classify(shrunk, PHOTO_PROMPTS.map(prompt => prompt.label), { hypothesis_template: HYPOTHESIS_TEMPLATE });
            if (runRef.current !== run) return;
            const reading = readPhotoScores(scores);
            setState({ phase: 'done', reading });
            onReading(reading);
        } catch (error) {
            console.error('[TownshipGo] photo reader failed', error);
            const reason = error instanceof Error ? error.message : String(error);
            if (runRef.current === run) setState({ phase: 'failed', withPhoto: true, reason: reason.slice(0, 160),
                message: 'The photo is attached, but it could not be analysed here. Choose the category yourself.' });
        }
    }

    function clear() {
        runRef.current++;
        onPhoto(null);
        setState({ phase: 'empty' });
        if (inputRef.current) inputRef.current.value = '';
    }

    return (
        <div className="tg-photo">
            <p className="tg-label">{residentText(language, 'Photo (optional)')}</p>
            <div className="tg-photo-row">
                {photo ? (
                    <div className="tg-photo-thumb">
                        {/* eslint-disable-next-line @next/next/no-img-element -- local data URL preview */}
                        <img src={photo} alt="Your hazard photo" />
                        <button type="button" onClick={clear} aria-label={residentText(language, 'Remove photo')}><X size={17} aria-hidden /></button>
                    </div>
                ) : (
                    <label htmlFor={inputId} className="tg-photo-add">
                        <Camera size={22} aria-hidden />
                        <span>{residentText(language, 'Add photo')}</span>
                    </label>
                )}
                <input ref={inputRef} id={inputId} type="file" accept="image/*" className="sr-only"
                    onChange={event => void choose(event.target.files?.[0])} />
                <div className="tg-photo-status" role="status" aria-live="polite">
                    {shown.phase === 'empty' && <p className="tg-small"><Sparkles size={14} aria-hidden /> Add a photo and we’ll fill in the hazard type and details for you.</p>}
                    {shown.phase === 'loading' && <p className="tg-small"><Loader2 size={14} className="tg-spin" aria-hidden />
                        {shown.percent === null ? 'Preparing photo reader…' : `Downloading photo reader (first time only) ${Math.round(shown.percent)}%`}</p>}
                    {shown.phase === 'analysing' && <p className="tg-small"><Loader2 size={14} className="tg-spin" aria-hidden /> Reading your photo…</p>}
                    {shown.phase === 'done' && (shown.reading.kind
                        ? <p className="tg-small"><Sparkles size={14} aria-hidden />
                            {shown.reading.confident ? 'Looks like' : 'Might be'} <strong>{kindLabel(shown.reading.kind)}</strong> ({Math.round(shown.reading.confidence * 100)}%).
                            {shown.reading.confident ? ' Details filled in below. Edit them if needed.' : ' Check the category before sending.'}</p>
                        : <p className="tg-small">We couldn’t spot a footpath hazard in this photo. Choose the category yourself.</p>)}
                    {shown.phase === 'failed' && <p className="tg-small">{shown.message}
                        {shown.reason && <span className="tg-photo-reason">Reason: {shown.reason}</span>}</p>}
                </div>
            </div>
        </div>
    );
}
