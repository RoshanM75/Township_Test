'use client';

import { useState } from 'react';
import { Download } from 'lucide-react';
import { downloadOperatorData } from '@/lib/api';
import type { PilotId } from '@/lib/pilots';

export default function ExportControls({ area, reviewerKey, dataset, days }: {
    area: PilotId; reviewerKey: string; dataset: 'cases' | 'checks'; days?: number;
}) {
    const [format, setFormat] = useState<'csv' | 'geojson' | 'json'>('csv');
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState('');
    return <form className="flex flex-wrap items-end gap-2" onSubmit={event => {
        event.preventDefault(); setBusy(true); setMessage('');
        void downloadOperatorData(area, reviewerKey, dataset, format, days).catch((err: unknown) =>
            setMessage(err instanceof Error ? err.message : 'The data could not be exported.')).finally(() => setBusy(false));
    }}>
        <label className="flex flex-col text-sm font-semibold">Export format
            <select className="min-h-11 rounded-lg border border-slate-400 bg-white px-2" value={format}
                onChange={event => setFormat(event.target.value as typeof format)}>
                <option value="csv">CSV spreadsheet</option><option value="geojson">GeoJSON map</option><option value="json">JSON data</option>
            </select>
        </label>
        <button className="flex min-h-11 items-center gap-2 rounded-lg border border-slate-400 bg-white px-3 text-sm font-bold disabled:opacity-50" disabled={busy}>
            <Download size={17} aria-hidden />{busy ? 'Preparing…' : dataset === 'cases' ? 'Download cases' : 'Download access checks'}
        </button>
        {message && <p role="alert" className="basis-full text-sm text-red-800">{message}</p>}
    </form>;
}
