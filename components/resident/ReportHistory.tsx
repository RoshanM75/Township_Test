'use client';

import { useState } from 'react';
import { Check, Circle, ClipboardList, Plus } from 'lucide-react';
import { residentText, type ResidentLanguage, type ResidentLabel } from '@/lib/resident-language';
import type { HazardKind } from '@/lib/routing';
import type { MaintenanceDefect } from '@/lib/types';

export const issueLabel: Record<HazardKind, ResidentLabel> = {
    blocked: 'Blocked path', lift_out: 'Lift out', broken_surface: 'Broken pavement', light_out: 'Broken light',
    no_ramp: 'Missing kerb ramp', no_shade: 'Missing shade', details_outdated: 'Incorrect place details',
};

export interface DeviceReport {
    id: string;
    category: string;
    description: string;
    location: string;
    created_at?: string;
    kind?: string;
    photo?: string;
}

function ReportTimeline({ report, language }: { report: MaintenanceDefect; language: ResidentLanguage }) {
    const stages: { title: ResidentLabel; date?: string | null; done: boolean }[] = [
        { title: 'Reported', date: report.created_at, done: true },
        { title: 'Checked', date: report.checked_at, done: Boolean(report.checked_at) },
        report.dismissed_at ? { title: 'Dismissed', date: report.dismissed_at, done: true }
            : { title: 'Fixed', date: report.fixed_at, done: report.status === 'fixed' },
    ];
    return <ol className="tg-report-timeline">
        {stages.map(({ title, date, done }) => <li key={title} data-done={done}>
            {done ? <Check size={16} aria-hidden /> : <Circle size={15} aria-hidden />}
            <span><strong>{residentText(language, title)}</strong>{date && <time dateTime={date}>{dateLabel(date, language)}</time>}</span>
        </li>)}
    </ol>;
}

function dateLabel(value: string, language: ResidentLanguage) {
    return new Date(value).toLocaleString(language === 'ms' ? 'ms-MY' : 'en-MY', {
        timeZone: 'Asia/Kuala_Lumpur', dateStyle: 'medium', timeStyle: 'short',
    });
}

export default function ReportHistory({ reports, mine, deviceReports, preview, language, onNew, onRemove }: {
    reports: MaintenanceDefect[]; mine: Record<string, string | true>; deviceReports: DeviceReport[]; preview: boolean;
    language: ResidentLanguage; onNew: () => void; onRemove: (id: string) => void;
}) {
    const t = (label: ResidentLabel) => residentText(language, label);
    const [scope, setScope] = useState<'mine' | 'area'>('mine');
    const shown = preview ? deviceReports : reports.filter(report => scope === 'area' || Object.hasOwn(mine, report.id));
    return <div className="tg-stack">
        <button type="button" className="tg-btn" onClick={onNew}><Plus size={20} aria-hidden />{t('Report a problem')}</button>
        {!preview && <div className="tg-report-filters" role="group" aria-label={t('Report history')}>
            <button type="button" className="tg-card" aria-pressed={scope === 'mine'} onClick={() => setScope('mine')}>{t('My reports')}</button>
            <button type="button" className="tg-card" aria-pressed={scope === 'area'} onClick={() => setScope('area')}>{t('Area reports')}</button>
        </div>}
        {shown.length ? <ul className="tg-report-list">
            {shown.map(report => {
                const label = report.kind && Object.hasOwn(issueLabel, report.kind) ? t(issueLabel[report.kind as HazardKind]) : report.category;
                const photo = preview && 'photo' in report ? report.photo : mine[String(report.id)];
                return <li key={report.id}>
                    {/* eslint-disable-next-line @next/next/no-img-element -- photo data is kept on the reporter's own device */}
                    {typeof photo === 'string' && <img className="tg-report-photo" src={photo} alt={t('Photo (optional)')} />}
                    <strong>{label}</strong>
                    <p>{'location' in report ? report.location : report.location_name}</p>
                    {report.description && <p className="tg-small">{report.description}</p>}
                    {'location' in report ? <>
                        <p className="tg-small">{t('Saved on this device')}{report.created_at && ` · ${dateLabel(report.created_at, language)}`}</p>
                        <button type="button" className="tg-text-action" onClick={() => onRemove(String(report.id))}>{t('Remove from device')}</button>
                    </> : <>
                        <ReportTimeline report={report} language={language} />
                        {report.responsible_team && <p className="tg-small">{report.responsible_team}</p>}
                        {report.review_note && <p className="tg-small">{report.review_note}</p>}
                    </>}
                </li>;
            })}
        </ul> : <p className="tg-note" role="status"><ClipboardList size={18} aria-hidden />{t('No reports yet.')}</p>}
    </div>;
}
