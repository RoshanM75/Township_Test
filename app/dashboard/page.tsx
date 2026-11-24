'use client';

import { shadeChangeLabel, type ShadeResult } from '@/lib/shade-corrections';
import { malaysiaTimeLabel } from '@/lib/resident-language';

import { useEffect, useMemo, useState, Suspense } from 'react';
import { useRouter,useSearchParams } from 'next/navigation';
import type { MouseEvent } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import PreviewNotice from '@/components/walking/PreviewNotice';
import { IS_PAGES_PREVIEW } from '@/lib/site';
import {
    Footprints, AlertTriangle, AlertCircle, Lightbulb, Sun, Accessibility,
    MapPin, RefreshCw, Check, X, ClipboardList, Wallet,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { loadReports, checkReport, markReportFixed, loadWalkingData } from '@/lib/api';
import type { MaintenanceDefect } from '@/lib/types';
import { PILOTS,pilotFromParams,isPilotAvailable,type PilotId } from '@/lib/pilots';
import { useClientReady } from '@/lib/use-client-ready';
import PilotSelector from '@/components/walking/PilotSelector';
import ReviewerAccess, { useReviewerKey } from '@/components/review/ReviewerAccess';
import { reportStatus } from '@/lib/report-status';
import type { FormEvent } from 'react';
import PilotSources from '@/components/walking/PilotSources';
import PilotUnavailable from '@/components/walking/PilotUnavailable';
import { isOverdue, malaysiaDate, rankOpenCases, reportTarget } from '@/lib/operator';
import ActivityPanel from '@/components/operator/ActivityPanel';
import TargetsPanel from '@/components/operator/TargetsPanel';
import AssignmentEditor from '@/components/operator/AssignmentEditor';

const InteractiveMap = dynamic(() => import('@/components/map/InteractiveMap'), { ssr: false });

const POLL_MS = 30_000;

type Kind = 'shade' | 'light' | 'ramp' | 'crossing';
type Filter = 'all' | Kind;
type SortBy = 'priority' | 'recent';
type Section = 'cases' | 'activity' | 'targets';
type Notice = { tone: 'ok' | 'warn' | 'error'; text: string };

const KIND_META: Record<Kind, { label: string; Icon: LucideIcon; tone: string }> = {
    shade: { label: 'Shade', Icon: Sun, tone: 'text-orange-600' },
    light: { label: 'Lighting', Icon: Lightbulb, tone: 'text-amber-600' },
    ramp: { label: 'Ramps & access', Icon: Accessibility, tone: 'text-[#A4262C]' },
    crossing: { label: 'Pavement & other', Icon: Footprints, tone: 'text-slate-600' },
};
const KIND_ORDER: Kind[] = ['shade', 'light', 'ramp', 'crossing'];

function timeAgo(iso?: string): string {
    if (!iso) return '—';
    const t = Date.parse(iso);
    if (isNaN(t)) return '—';
    const mins = Math.round((Date.now() - t) / 60000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins} min ago`;
    const hrs = Math.round(mins / 60);
    if (hrs < 24) return `${hrs} h ago`;
    const days = Math.round(hrs / 24);
    if (days < 30) return `${days} d ago`;
    return new Date(t).toLocaleDateString('en-MY', { day: 'numeric', month: 'short' });
}

function SeverityBadge({ severity }: { severity: 'blocker' | 'comfort' }) {
    return severity === 'blocker' ? (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-bold bg-[#A4262C] text-white">
            <AlertTriangle className="w-3.5 h-3.5" aria-hidden /> Critical
        </span>
    ) : (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-bold bg-amber-100 text-amber-900 border border-amber-300">
            <AlertCircle className="w-3.5 h-3.5" aria-hidden /> Moderate
        </span>
    );
}

// Same shapes as the map pins: circle = critical, rounded square = moderate
function RankBadge({ rank, severity }: { rank: number; severity: 'blocker' | 'comfort' }) {
    return (
        <span
            className={`inline-flex items-center justify-center w-7 h-7 text-xs font-extrabold tabular-nums ${severity === 'blocker' ? 'rounded-full bg-[#A4262C] text-white' : 'rounded-lg bg-amber-400 text-slate-900'
                }`}
        >
            {rank}
        </span>
    );
}

function Kpi({ Icon, label, value, sub }: { Icon: LucideIcon; label: string; value: string; sub: string }) {
    return (
        <div className="bg-white rounded-2xl p-4 border border-slate-200/70 shadow-sm flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#A4262C]/10 flex items-center justify-center flex-shrink-0">
                <Icon className="w-5 h-5 text-[#A4262C]" aria-hidden />
            </div>
            <div className="min-w-0">
                <p className="text-xs font-semibold text-slate-600">{label}</p>
                <p className="text-2xl font-extrabold text-slate-900 tabular-nums leading-tight">{value}</p>
                <p className="text-xs text-slate-500">{sub}</p>
            </div>
        </div>
    );
}

export default function AdminDashboardPage() {
    const ready=useClientReady();
    return ready?<Suspense fallback={<p role="status">Loading area…</p>}><DashboardWithParams/></Suspense>:<main className="p-6" role="status">Loading maintenance dashboard…</main>;
}
function DashboardWithParams(){const params=useSearchParams(),area=pilotFromParams(params);return isPilotAvailable(area)?<DashboardWorkspace key={params.toString()} area={area}/>:<PilotUnavailable area={area}/>;}

function DashboardWorkspace({area}:{area:PilotId}) {
    const router=useRouter();
    const [reviewerKey, setReviewerKey] = useReviewerKey();
    const operatorKey = IS_PAGES_PREVIEW ? '' : reviewerKey;
    const [section, setSection] = useState<Section>('cases');
    const [focusTarget, setFocusTarget] = useState<NonNullable<ReturnType<typeof reportTarget>>>();
    const [teamFilter, setTeamFilter] = useState('');
    const [overdueOnly, setOverdueOnly] = useState(false);
    const [caseStatus, setCaseStatus] = useState('all');
    const [reviewTeam, setReviewTeam] = useState('');
    const [reviewNote, setReviewNote] = useState('');
    const [defects, setDefects] = useState<MaintenanceDefect[]>([]);
    const [loading, setLoading] = useState(true);
    const [dataCounts, setDataCounts] = useState({ places: 0 });
    const [loadError, setLoadError] = useState('');
    const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

    const [sortBy, setSortBy] = useState<SortBy>('priority');
    const [filter, setFilter] = useState<Filter>('all');
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [hoveredId, setHoveredId] = useState<string | null>(null);

    const [confirmFixId, setConfirmFixId] = useState<string | null>(null);
    const [fixingId, setFixingId] = useState<string | null>(null);
    const [notice, setNotice] = useState<Notice | null>(null);

    /* ---------------- Data ---------------- */

    const [refreshVersion, setRefreshVersion] = useState(0);

    useEffect(() => {
        let cancelled = false;
        async function loadData(silent = false) {
            try {
                const [{ reports }, walking] = await Promise.all([loadReports('open', area, operatorKey), loadWalkingData(area)]);
                if (cancelled) return;
                setDefects(reports);
                setDataCounts({ places: walking.assets.filter(a => ['destination','transit'].includes(a.kind)).length });
                setLoadError('');
                setLastUpdated(new Date());
            } catch (err) {
                if (!cancelled) setLoadError(err instanceof Error ? err.message : 'The report queue could not be loaded.');
            } finally {
                if (!cancelled && !silent) setLoading(false);
            }
        }

        void loadData();
        const timer = IS_PAGES_PREVIEW ? undefined : setInterval(() => void loadData(true), POLL_MS);
        return () => { cancelled = true; clearInterval(timer); };
    }, [refreshVersion, area, operatorKey]);

    // Notices fade away on their own
    useEffect(() => {
        if (!notice) return;
        const t = setTimeout(() => setNotice(null), 5000);
        return () => clearTimeout(t);
    }, [notice]);

    // "Mark fixed" needs a second click, which cancels itself after a few seconds
    useEffect(() => {
        if (!confirmFixId) return;
        const t = setTimeout(() => setConfirmFixId(null), 4000);
        return () => clearTimeout(t);
    }, [confirmFixId]);

    // Escape clears the selection
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setSelectedId(null); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, []);

    /* ---------------- Ranking ---------------- */

    const defectById = useMemo(() => {
        const m = new Map<string, MaintenanceDefect>();
        defects.forEach((d) => m.set(String(d.id), d));
        return m;
    }, [defects]);

    const today = lastUpdated ? malaysiaDate(lastUpdated.toISOString()) : '';
    const rankedAll = useMemo(() => rankOpenCases(defects, today).map(({ report, count }, index) => ({
        id: String(report.id), rank: index + 1, count, label: report.description || report.category,
        kind: (report.category === 'Shade Infrastructure' ? 'shade' : report.category === 'Safety Electrical' ? 'light'
            : ['Access Barrier', 'Universal Design'].includes(report.category) ? 'ramp' : 'crossing') as Kind,
        severity: report.severity ?? 'comfort',
    })), [defects, today]);
    const kindCounts = useMemo(() => {
        const counts: Record<Kind, number> = { shade: 0, light: 0, ramp: 0, crossing: 0 };
        rankedAll.forEach(item => { counts[item.kind]++; });
        return counts;
    }, [rankedAll]);
    const teams = [...new Set(defects.flatMap(report => report.responsible_team ? [report.responsible_team] : []))].sort();
    const visibleItems = useMemo(() => {
        const list = rankedAll.filter(item => {
            const report = defectById.get(item.id)!;
            return (filter === 'all' || item.kind === filter) &&
                (!teamFilter || (report.responsible_team ? `team:${report.responsible_team}` : 'unassigned') === teamFilter) &&
                (!overdueOnly || isOverdue(report, today)) &&
                (caseStatus === 'all' || (report.checked_at ? 'checked' : 'reported') === caseStatus);
        });
        if (sortBy === 'priority') return list;
        return list.sort((a, b) => (defectById.get(b.id)?.created_at ?? '').localeCompare(defectById.get(a.id)?.created_at ?? ''));
    }, [rankedAll, defectById, filter, teamFilter, overdueOnly, caseStatus, sortBy, today]);

    const metrics = {
        open: defects.length,
        blockers: defects.filter(report => report.severity === 'blocker').length,
        cost: defects.reduce((total, report) => total + (report.estimated_cost_rm ?? 0), 0),
        unassigned: defects.filter(report => !report.responsible_team).length,
    };

    /* ---------------- Selection and map ---------------- */

    const selectedItem = useMemo(
        () => (selectedId ? visibleItems.find((i) => String(i.id) === selectedId) ?? null : null),
        [selectedId, visibleItems],
    );
    const selectedDefect = selectedId ? defectById.get(selectedId) : null;
    const location = selectedDefect?.lat != null && selectedDefect.lng != null
        ? [selectedDefect.lat, selectedDefect.lng] as [number, number] : undefined;
    const related = selectedDefect ? defects.filter(report => report.id !== selectedDefect.id && report.kind === selectedDefect.kind &&
        (selectedDefect.asset_id ? report.asset_id === selectedDefect.asset_id :
            !report.asset_id && selectedDefect.edge_id !== null && report.edge_id === selectedDefect.edge_id)) : [];

    const pins = useMemo(() => {
        return visibleItems.flatMap((item) => {
            const d = defectById.get(String(item.id));
            const lat = d?.lat ?? d?.latitude;
            const lng = d?.lng ?? d?.longitude;
            if (lat == null || lng == null) return [];
            return [{
                id: String(item.id),
                lat: Number(lat),
                lng: Number(lng),
                rank: item.rank,
                severity: item.severity as 'blocker' | 'comfort',
                title: item.label,
                detail: d?.location_name ?? undefined,
            }];
        });
    }, [visibleItems, defectById]);

    function selectRow(id: string | number) {
        const key = String(id);
        setSelectedId((cur) => (cur === key ? null : key));
        setConfirmFixId(null);
        setReviewNote('');
    }

    // Keep the chosen row in view when it was picked from the map
    useEffect(() => {
        if (!selectedId) return;
        const target = window.matchMedia('(max-width: 1023px)').matches ? 'case-details' : `row-${selectedId}`;
        document.getElementById(target)?.scrollIntoView({ block: 'nearest' });
    }, [selectedId, section]);

    /* ---------------- Mark fixed ---------------- */

    function handleFixClick(id: string, e?: MouseEvent) {
        e?.stopPropagation(); // don't also select the row
        if (confirmFixId === id) markFixed(id);
        else setConfirmFixId(id);
    }

    async function markFixed(id: string) {
        const defect = defectById.get(id);
        if (!defect) return;
        setConfirmFixId(null);
        setFixingId(id);

        try {
            await markReportFixed(id, area, reviewerKey);
            setDefects((prev) => prev.filter((d) => String(d.id) !== id));
            setRefreshVersion(value => value + 1);
            setSelectedId((cur) => (cur === id ? null : cur));
            setNotice({ tone: 'ok', text: 'Marked as fixed.' });
        } catch (err) {
            console.error('Failed to update defect state:', err);
            setNotice({ tone: 'error', text: err instanceof Error ? err.message : 'Could not update the report.' });
        } finally {
            setFixingId(null);
        }
    }

    async function confirmReport(event: FormEvent<HTMLFormElement>, id: string) {
        event.preventDefault();
        if (!reviewerKey || fixingId) return;
        setFixingId(id);
        const dismiss = ((event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null)?.value === 'dismiss';
        const shadeResult = new FormData(event.currentTarget).get('shade_result') as ShadeResult | null;
        try {
            const { report } = await checkReport(id, area, reviewerKey,
                { team: defectById.get(id)?.responsible_team || reviewTeam, note: reviewNote, dismiss,
                    ...(!dismiss && shadeResult ? { shade_result: shadeResult } : {}) });
            setDefects(previous => dismiss ? previous.filter(item => String(item.id) !== id)
                : previous.map(item => String(item.id) === id ? report : item));
            setReviewNote('');
            setRefreshVersion(value => value + 1);
            setNotice({ tone: 'ok', text: dismiss ? 'Report reviewed and dismissed.' : report.map_updated_at ? 'Report checked and map updated.' : 'Report checked and assigned.' });
        } catch (error) { setNotice({ tone: 'error', text: error instanceof Error ? error.message : 'Could not check the report.' }); }
        finally { setFixingId(null); }
    }

    /* ---------------- Small render helpers ---------------- */

    // A plain function (not a component) so the button isn't re-created on every render
    function renderFixButton(id: string, size: 'sm' | 'md') {
        const confirming = confirmFixId === id;
        const busy = fixingId === id;
        if (!defectById.get(id)?.checked_at) return <button type="button" className="min-h-11 text-sm font-bold underline"
            onClick={event => { event.stopPropagation(); selectRow(id); }}>Review report</button>;
        const pad = size === 'sm' ? 'px-3 py-1.5 text-xs' : 'px-4 py-2 text-sm';
        return (
            <button
                onClick={(e) => handleFixClick(id, e)}
                disabled={busy || !reviewerKey}
                className={`${pad} rounded-lg font-bold border transition-colors disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700 ${confirming
                    ? 'bg-emerald-700 border-emerald-700 text-white hover:bg-emerald-800'
                    : 'bg-white border-emerald-700 text-emerald-800 hover:bg-emerald-50'
                    }`}
            >
                {busy ? 'Saving…' : confirming ? 'Click to confirm' : 'Mark fixed'}
            </button>
        );
    }

    const shownCost = visibleItems.reduce((acc, item) => acc + (defectById.get(item.id)?.estimated_cost_rm ?? 0), 0);
    const selectedTarget = selectedDefect ? reportTarget(selectedDefect) : null;

    /* ---------------- Render ---------------- */

    return (
        <div className="min-h-screen bg-[#f8f5f5] text-slate-800 font-sans pb-10">
            <div className="mx-auto max-w-7xl px-4"><PreviewNotice area={area}/></div>
            {/* Header */}
            <header className="bg-white border-b border-slate-200/80 border-t-4 border-t-[#A4262C] px-4 sm:px-8 py-3 flex flex-wrap items-center justify-between gap-3 sticky top-0 z-50">
                <h1 className="text-xl font-extrabold tracking-tight text-slate-900 flex flex-wrap items-center gap-2">
                    TownshipGo <span className="text-slate-300 font-normal">◆</span> <span className="text-slate-500 font-semibold text-base">Command Center</span>
                </h1>
                <div className="flex flex-wrap items-center gap-3">
                    <Link href={`/resident?area=${area}`} className="inline-flex min-h-11 items-center text-sm font-bold text-[#7F1D22] underline">Walking planner</Link>
                    <Link href={`/verification?area=${area}`} className="inline-flex min-h-11 items-center text-sm font-bold text-[#7F1D22] underline">Verification records</Link>

                    <span className="text-xs text-slate-500">
                        {IS_PAGES_PREVIEW ? 'Snapshot preview' : lastUpdated
                            ? `Updated ${lastUpdated.toLocaleTimeString('en-MY', { hour: '2-digit', minute: '2-digit' })} · refreshes every 30 s`
                            : 'Loading…'}
                    </span>
                    <button
                        onClick={() => { setLoading(true); setRefreshVersion((value) => value + 1); }}
                        disabled={loading}
                        className="flex min-h-11 items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#A4262C]"
                    >
                        <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} aria-hidden />
                        Refresh
                    </button>
                </div>
            </header>

            {loadError && (
                <div role="alert" className="bg-amber-50 border-b border-amber-300 text-amber-900 text-sm font-semibold px-8 py-2">
                    {loadError}
                </div>
            )}

            <main className="max-w-[1500px] mx-auto px-4 sm:px-6 mt-6 space-y-6">
                <PilotSelector area={area} onChange={next=>router.replace(`?area=${next}`)}/>
                {!IS_PAGES_PREVIEW && <ReviewerAccess reviewerKey={reviewerKey} onKey={key => {
                    setReviewerKey(key);
                    if (!key) { setTeamFilter(''); setOverdueOnly(false); setCaseStatus('all'); }
                }} />}
                <nav aria-label="Operator workspace" className="flex flex-wrap gap-2">
                    {([['cases', 'Maintenance queue'], ['activity', 'Activity and exports'], ['targets', 'Access and responsibility']] as const)
                        .map(([value, label]) => <button type="button" key={value} aria-pressed={section === value} onClick={() => {
                            setSection(value);
                            if (value === 'targets') setFocusTarget(undefined);
                        }} className={`min-h-11 rounded-lg border border-slate-300 px-3 text-sm font-bold ${section === value
                            ? 'bg-slate-900 text-white' : 'bg-white text-slate-800'}`}>{label}</button>)}
                </nav>
                {section !== 'cases' && !operatorKey && <p className="rounded-xl border border-slate-300 bg-white p-4">
                    {IS_PAGES_PREVIEW ? 'Live operator tools are available on the server app.' : 'Enter the reviewer key to open this workspace.'}
                </p>}
                {section === 'activity' && operatorKey && <ActivityPanel area={area} reviewerKey={operatorKey} onOpenCase={id => {
                    setSection('cases'); setFilter('all'); setTeamFilter(''); setOverdueOnly(false); setCaseStatus('all'); setSelectedId(id);
                }} />}
                {section === 'targets' && operatorKey && <TargetsPanel area={area} reviewerKey={operatorKey} initial={focusTarget} />}
                {section === 'cases' && <>
                <PilotSources area={area}/>
                {/* KPI strip */}
                <section aria-label="Key figures" className="grid grid-cols-1 min-[480px]:grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-4">
                    <Kpi Icon={ClipboardList} label="Open defects" value={metrics.open.toLocaleString()} sub="Waiting for a fix" />
                    <Kpi Icon={AlertTriangle} label="Critical blockers" value={metrics.blockers.toLocaleString()} sub="Stop some people walking" />
                    <Kpi Icon={Wallet} label="Backlog cost" value={`RM ${metrics.cost.toLocaleString()}`} sub="Estimated, all open defects" />
                    <Kpi Icon={Footprints} label="Mapped places" value={dataCounts.places.toLocaleString()} sub="Recorded destinations & stops" />
                    <Kpi Icon={ClipboardList} label="Unassigned cases" value={metrics.unassigned.toLocaleString()} sub="Open cases awaiting a team" />
                </section>

                <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">

                    {/* Left: map and detail, stays in view while the queue scrolls */}
                    <div className="lg:col-span-5 flex flex-col gap-4 lg:sticky lg:top-[5.25rem] lg:h-[calc(100vh-6.5rem)]">
                        <div className="bg-white rounded-2xl p-2 border border-slate-200/70 shadow-sm relative isolate flex-1 min-h-[320px]">
                            <div className="absolute top-4 left-4 z-[1100] bg-white/95 shadow-md rounded-xl px-3 py-1.5 border border-slate-200 flex items-center gap-2 max-w-[60%]">
                                <MapPin className="w-4 h-4 text-[#A4262C] flex-shrink-0" aria-hidden />
                                <span className="text-xs font-bold text-slate-800 truncate">
                                    {selectedDefect?.location_name ?? PILOTS[area].short_name}
                                </span>
                            </div>
                            <div className="absolute inset-2 rounded-xl overflow-hidden">
                                <InteractiveMap
                                    pins={pins}
                                    selectedPinId={selectedItem ? String(selectedItem.id) : null}
                                    focusLocation={selectedItem ? undefined : location}
                                    hoveredPinId={hoveredId}
                                    onPinSelect={(id) => { setSelectedId(String(id)); setConfirmFixId(null); }}
                                    startCoords={PILOTS[area].centre}
                                    reduceMotion
                                />
                            </div>
                        </div>

                        <div id="case-details" className="scroll-mt-24 bg-white rounded-2xl p-4 border border-slate-200/70 shadow-sm">
                            {selectedDefect ? (
                                <div className="space-y-3">
                                    <div className="flex items-start justify-between gap-3">
                                        <div className="flex items-start gap-3 min-w-0">
                                            {selectedItem && <RankBadge rank={selectedItem.rank} severity={selectedItem.severity} />}
                                            <div className="min-w-0">
                                                <h3 className="font-extrabold text-slate-900 leading-snug">{selectedDefect.description || selectedDefect.category}</h3>
                                                <p className="text-sm text-slate-600">{selectedDefect.location_name || `Walkway Edge #${selectedDefect.edge_id ?? '—'}`}</p>
                                            </div>
                                        </div>
                                        <button
                                            onClick={() => setSelectedId(null)}
                                            aria-label="Clear selection"
                                            className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#A4262C]"
                                        >
                                            <X className="w-4 h-4" aria-hidden />
                                        </button>
                                    </div>
                                    <dl className="grid grid-cols-4 gap-3 text-sm">
                                        <div><dt className="text-xs text-slate-500">Severity</dt><dd className="mt-0.5"><SeverityBadge severity={selectedDefect.severity ?? 'comfort'} /></dd></div>
                                        <div><dt className="text-xs text-slate-500">Type</dt><dd className="font-semibold">{selectedDefect.category}</dd></div>
                                        <div><dt className="text-xs text-slate-500">Estimated cost</dt><dd className="font-semibold tabular-nums">{selectedDefect.estimated_cost_rm ? `RM ${selectedDefect.estimated_cost_rm.toLocaleString()}` : 'Awaiting estimate'}</dd></div>
                                        <div><dt className="text-xs text-slate-500">Reported</dt><dd className="font-semibold">{timeAgo(selectedDefect.created_at)}</dd></div>
                                    </dl>
                                    <p className="text-sm font-bold">{reportStatus(selectedDefect)}
                                        {selectedDefect.responsible_team && ` · ${selectedDefect.responsible_team}`}</p>
                                    {selectedDefect.shade_change && <p className="text-sm">{shadeChangeLabel[selectedDefect.shade_change]}
                                        {selectedDefect.observed_at && ` · Observed ${malaysiaTimeLabel(selectedDefect.observed_at, 'en', true)} MYT`}</p>}
                                    {selectedDefect.map_updated_at && <p className="text-sm">Map updated {malaysiaTimeLabel(selectedDefect.map_updated_at, 'en', true)} MYT</p>}
                                    {selectedDefect.review_note && <p className="text-sm">{selectedDefect.review_note}</p>}
                                    {operatorKey && <AssignmentEditor key={selectedDefect.id} area={area} reviewerKey={operatorKey} report={selectedDefect} onSaved={report => {
                                        setDefects(previous => previous.map(row => String(row.id) === String(report.id) ? report : row));
                                        setRefreshVersion(value => value + 1);
                                        setNotice({ tone: 'ok', text: 'Assignment saved.' });
                                    }} />}
                                    {operatorKey && selectedTarget && <button type="button" className="min-h-11 text-sm font-bold text-[#7F1D22] underline"
                                        onClick={() => { setFocusTarget(selectedTarget); setSection('targets'); }}>View mapped target and responsibility</button>}
                                    {related.length > 0 && <details className="text-sm">
                                        <summary className="min-h-8 cursor-pointer font-bold">Related open reports · {related.length}</summary>
                                        <ul>{related.map(report => <li key={report.id}>
                                            <button type="button" className="min-h-11 text-left underline" onClick={() => selectRow(report.id)}>
                                                {reportStatus(report)} · {report.description}
                                            </button>
                                        </li>)}</ul>
                                    </details>}
                                    {selectedDefect.checked_at ? renderFixButton(String(selectedDefect.id), 'md') : !IS_PAGES_PREVIEW &&
                                        <form key={selectedDefect.id} className="space-y-2" onSubmit={event => void confirmReport(event, String(selectedDefect.id))}>
                                            {selectedDefect.kind === 'shade_correction' && <label className="block text-sm font-bold">Condition checked for this segment
                                                <select name="shade_result" defaultValue="" className="mt-1 block min-h-11 w-full rounded-md border border-slate-300 bg-white px-2" required>
                                                    <option value="" disabled>Choose the confirmed condition</option>
                                                    <option value="sun">Direct sun around the observed time</option>
                                                    <option value="shade">Shade around the observed time</option>
                                                    <option value="roof_removed">Roof cover removed or absent</option>
                                                </select>
                                            </label>}
                                            {!selectedDefect.responsible_team && <label className="block text-sm font-bold">Responsible team
                                                <input required maxLength={120} className="mt-1 min-h-11 w-full rounded border border-slate-400 px-2"
                                                    value={reviewTeam} onChange={event => setReviewTeam(event.target.value)} />
                                            </label>}
                                            <label className="block text-sm font-bold">What did the team check?
                                                <textarea required maxLength={600} className="mt-1 w-full rounded border border-slate-400 p-2"
                                                    value={reviewNote} onChange={event => setReviewNote(event.target.value)} />
                                            </label>
                                            <button type="submit" className="min-h-11 rounded-lg bg-slate-800 px-3 font-bold text-white disabled:opacity-50"
                                                disabled={!reviewerKey || !!fixingId}>{selectedDefect.kind === 'shade_correction' ? 'Check and update map' : 'Mark checked'}</button>
                                            <button type="submit" value="dismiss" formNoValidate className="ml-2 min-h-11 font-bold underline disabled:opacity-50"
                                                disabled={!reviewerKey || !!fixingId}>Dismiss report</button>
                                        </form>}
                                </div>
                            ) : (
                                <p className="text-sm text-slate-600 flex items-center gap-2">
                                    <MapPin className="w-4 h-4 text-slate-400 flex-shrink-0" aria-hidden />
                                    Select a row or a map pin to see its details. Pin numbers match the queue ranking.
                                </p>
                            )}
                        </div>
                    </div>

                    {/* Right: queue */}
                    <div className="lg:col-span-7 bg-white rounded-2xl p-5 border border-slate-200/70 shadow-sm space-y-4">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                            <div>
                                <h2 className="text-lg font-extrabold text-slate-900">Maintenance queue</h2>
                                <p className="text-xs text-slate-500">Priority uses severity, overdue work, related open reports and waiting time.</p>
                            </div>
                            <div role="group" aria-label="Sort order" className="inline-flex rounded-lg border border-slate-300 overflow-hidden text-xs font-bold">
                                {([['priority', 'Priority'], ['recent', 'Most recent']] as [SortBy, string][]).map(([v, label]) => (
                                    <button
                                        key={v}
                                        onClick={() => setSortBy(v)}
                                        disabled={v === 'recent' && !defects.length}
                                        aria-pressed={sortBy === v}
                                        className={`px-3 py-1.5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[#A4262C] ${sortBy === v ? 'bg-slate-900 text-white' : 'bg-white text-slate-700 hover:bg-slate-50'
                                            }`}
                                    >
                                        {label}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Filters */}
                        <div role="group" aria-label="Filter by type" className="flex flex-wrap gap-2">
                            {([['all', 'All', rankedAll.length], ...KIND_ORDER.map((k) => [k, KIND_META[k].label, kindCounts[k]])] as [Filter, string, number][]).map(([v, label, count]) => (
                                <button
                                    key={v}
                                    onClick={() => setFilter(v)}
                                    aria-pressed={filter === v}
                                    className={`px-3 py-1 rounded-full text-xs font-bold border transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#A4262C] ${filter === v
                                        ? 'bg-[#A4262C] border-[#A4262C] text-white'
                                        : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50'
                                        }`}
                                >
                                    {label} <span className="tabular-nums opacity-80">{count}</span>
                                </button>
                            ))}
                        </div>

                        {/* Table */}
                        {operatorKey && <div className="flex flex-wrap items-end gap-3">
                            <label className="flex flex-col text-sm font-semibold">Case team
                                <select className="min-h-11 rounded-lg border border-slate-400 px-2" value={teamFilter}
                                    onChange={event => setTeamFilter(event.target.value)}>
                                    <option value="">All teams</option><option value="unassigned">Unassigned</option>
                                    {teams.map(team => <option value={`team:${team}`} key={team}>{team}</option>)}
                                </select>
                            </label>
                            <label className="flex flex-col text-sm font-semibold">Case status
                                <select className="min-h-11 rounded-lg border border-slate-400 px-2" value={caseStatus}
                                    onChange={event => setCaseStatus(event.target.value)}>
                                    <option value="all">All open cases</option><option value="reported">Reported</option><option value="checked">Checked</option>
                                </select>
                            </label>
                            <label className="flex min-h-11 items-center gap-2 text-sm font-semibold">
                                <input type="checkbox" checked={overdueOnly} onChange={event => setOverdueOnly(event.target.checked)} />Overdue only
                            </label>
                        </div>}
                        <div className="overflow-x-auto">
                            <table className="w-full text-left border-collapse">
                                <thead>
                                    <tr className="text-xs font-semibold text-slate-500 border-b border-slate-200">
                                        <th className="py-2 pl-3 pr-2 w-12">#</th>
                                        <th className="py-2 px-2">Location and defect</th>
                                        <th className="py-2 px-2">Severity</th>
                                        <th className="py-2 px-2 text-right">Est. cost</th>
                                        <th className="py-2 px-2 w-28">Assignment</th>
                                        <th className="py-2 px-2">Reported</th>
                                        <th className="py-2 px-2 text-right">Action</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                    {loading ? (
                                        [0, 1, 2, 3, 4].map((i) => (
                                            <tr key={i}>
                                                <td colSpan={7} className="py-2">
                                                    <div className="h-10 rounded-lg bg-slate-100 animate-pulse" />
                                                </td>
                                            </tr>
                                        ))
                                    ) : visibleItems.length === 0 ? (
                                        <tr>
                                            <td colSpan={7} className="py-12 text-center">
                                                <Check className="w-8 h-8 mx-auto text-emerald-600" aria-hidden />
                                                <p className="mt-2 font-bold text-slate-800">
                                                    {IS_PAGES_PREVIEW ? 'Shared maintenance reports are unavailable in this preview.' : defects.length === 0 ? 'All clear. There are no open defects.' : 'No open defects of this type.'}
                                                </p>
                                            </td>
                                        </tr>
                                    ) : (
                                        visibleItems.map((item) => {
                                            const id = String(item.id);
                                            const rawDefect = defectById.get(id);
                                            const locationName = rawDefect?.location_name || `Walkway Edge #${rawDefect?.edge_id ?? '—'}`;
                                            const isSelected = selectedId === id;
                                            const meta = KIND_META[item.kind];

                                            return (
                                                <tr
                                                    key={id}
                                                    id={`row-${id}`}
                                                    tabIndex={0}
                                                    aria-selected={isSelected}
                                                    onClick={() => selectRow(item.id)}
                                                    onKeyDown={(e) => {
                                                        if (e.target !== e.currentTarget) return;
                                                        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectRow(item.id); }
                                                    }}
                                                    onMouseEnter={() => setHoveredId(id)}
                                                    onMouseLeave={() => setHoveredId(null)}
                                                    className={`cursor-pointer text-sm outline-none transition-colors focus-visible:bg-slate-100 ${isSelected ? 'bg-[#FBF1F1]' : 'hover:bg-slate-50'}`}
                                                >
                                                    <td className={`py-3 pl-3 pr-2 border-l-4 ${isSelected ? 'border-l-[#A4262C]' : 'border-l-transparent'}`}>
                                                        <RankBadge rank={item.rank} severity={item.severity} />
                                                    </td>
                                                    <td className="py-3 px-2 max-w-[260px]">
                                                        <p className="font-bold text-slate-900 truncate">{locationName}</p>
                                                        <p className="flex items-center gap-1.5 text-xs text-slate-600 truncate">
                                                            <meta.Icon className={`w-3.5 h-3.5 flex-shrink-0 ${meta.tone}`} aria-hidden />
                                                            <span className="truncate">{item.label}</span>
                                                        </p>
                                                    </td>
                                                    <td className="py-3 px-2"><SeverityBadge severity={item.severity} /></td>
                                                    <td className="py-3 px-2 text-right font-semibold tabular-nums whitespace-nowrap">
                                                        {rawDefect?.estimated_cost_rm ? `RM ${rawDefect.estimated_cost_rm.toLocaleString()}` : '—'}
                                                    </td>
                                                    <td className="py-3 px-2 text-sm">
                                                        <p>{rawDefect?.responsible_team || 'Unassigned'}</p>
                                                        {operatorKey && rawDefect?.due_on && <p className={isOverdue(rawDefect, today) ? 'font-bold text-[#7F1D22]' : 'text-slate-600'}>
                                                            {isOverdue(rawDefect, today) ? 'Overdue' : 'Due'} {rawDefect.due_on}
                                                        </p>}
                                                        {item.count > 1 && <p className="text-xs text-slate-600">{item.count} related reports</p>}
                                                    </td>
                                                    <td className="py-3 px-2 text-xs text-slate-600 whitespace-nowrap">{timeAgo(rawDefect?.created_at)}</td>
                                                    <td className="py-3 px-2 text-right">
                                                        {renderFixButton(id, 'sm')}
                                                    </td>
                                                </tr>
                                            );
                                        })
                                    )}
                                </tbody>
                            </table>
                        </div>

                        {!loading && visibleItems.length > 0 && (
                            <p className="text-xs text-slate-500 border-t border-slate-100 pt-3">
                                Showing <b className="tabular-nums">{visibleItems.length}</b> of <b className="tabular-nums">{rankedAll.length}</b> open defects
                                · <b className="tabular-nums">RM {shownCost.toLocaleString()}</b> estimated
                            </p>
                        )}
                    </div>
                </div>
                </>}
            </main>

            {/* Result of the last action */}
            {notice && (
                <div
                    role="status"
                    aria-live="polite"
                    className={`fixed bottom-6 right-6 z-[3000] max-w-sm px-4 py-3 rounded-xl shadow-lg text-sm font-semibold border ${notice.tone === 'ok' ? 'bg-emerald-50 border-emerald-300 text-emerald-900'
                        : notice.tone === 'warn' ? 'bg-amber-50 border-amber-300 text-amber-900'
                            : 'bg-red-50 border-red-300 text-red-900'
                        }`}
                >
                    {notice.text}
                </div>
            )}
        </div>
    );
}
