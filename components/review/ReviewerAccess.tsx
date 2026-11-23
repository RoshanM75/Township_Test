'use client';

import { useState } from 'react';

const tabKey = 'townshipgo:reviewer-key';

export function useReviewerKey() {
    const [key, setKey] = useState(() => {
        try { return sessionStorage.getItem(tabKey) ?? ''; } catch { return ''; }
    });
    return [key, (value: string) => {
        const next = value.trim();
        try {
            if (next) sessionStorage.setItem(tabKey, next);
            else sessionStorage.removeItem(tabKey);
        } catch { /* The key can still be used in memory. */ }
        setKey(next);
    }] as const;
}

export default function ReviewerAccess({ reviewerKey, onKey }: { reviewerKey: string; onKey: (value: string) => void }) {
    const [input, setInput] = useState('');
    return <section className="rounded-xl border border-slate-300 bg-white p-3">
        {reviewerKey ? <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-semibold">Reviewer key set for this tab</p>
            <button type="button" className="min-h-11 underline" onClick={() => onKey('')}>Clear key</button>
        </div> : <form className="flex flex-wrap items-end gap-2" onSubmit={event => {
            event.preventDefault(); onKey(input); setInput('');
        }}>
            <label className="flex min-w-0 flex-1 flex-col gap-1 text-sm font-semibold">Reviewer key
                <input required type="password" autoComplete="off" className="min-h-11 rounded-lg border border-slate-400 px-3"
                    value={input} onChange={event => setInput(event.target.value)} />
            </label>
            <button className="min-h-11 rounded-lg bg-slate-800 px-4 font-semibold text-white" type="submit">Use key</button>
        </form>}
    </section>;
}
