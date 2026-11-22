'use client';

import { useEffect, useMemo, useRef, useState, Suspense } from 'react';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { useSearchParams,useRouter } from 'next/navigation';
import {
    MapPin, Navigation, LocateFixed, Search, CloudRain, Sun, X, Send, Share2, Check, ChevronDown, CircleDot,
    Footprints, Umbrella, Lightbulb, Ban, Accessibility,
    AlertTriangle, Phone, MessageCircle, Copy, Volume2, Compass, Bookmark, Route as RouteIcon,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { loadGraph as fetchGraph, loadHazards, loadReports, submitReport, loadWalkingData, loadWeather, loadWeatherWarnings, loadPilotContext } from '@/lib/api';
import { IS_PAGES_PREVIEW, sitePath } from '@/lib/site';
import type { ReportMarker } from '@/lib/types';
import { useClientReady } from '@/lib/use-client-ready';
import { readWalkParameters } from '@/lib/walk-parameters';
import { DESTINATIONS } from '@/lib/precinct';
import { normaliseNeeds } from '@/lib/journeys';
import { malaysiaHour } from '@/lib/verification';
import { forecastAt, type WalkingWeather } from '@/lib/comfort';
import type { WalkingData, WalkingAsset, JourneyPlan } from '@/lib/walking';
import { placeSearchText } from '@/lib/walking';
import RouteQualityBar from '@/components/walking/RouteQualityBar';
import WalkingRequirements from '@/components/walking/WalkingRequirements';
import DepartureControl from '@/components/walking/DepartureControl';
import RouteDetails from '@/components/walking/RouteDetails';
import PlaceDiscovery from '@/components/walking/PlaceDiscovery';
import WalkingConditions from '@/components/walking/WalkingConditions';
import ComfortBreakdown from '@/components/walking/ComfortBreakdown';
import type { EnvironmentLayer } from '@/lib/environment';
import {
    buildGraph, nearestEdge, slotForHour, PROFILES,
    type Profile, type Mode, type TimeSlot, type PathNode, type PathEdge,
    type HazardReport, type HazardKind, type RouteResult,
} from '@/lib/routing';
import { createWalkPack, emptyLibrary, readLibrary, writeLibrary, readWalkDraft, withPersonalUpdates,
    type WalkLibrary, type WalkPack, type ConditionUpdate, type CompletedWalk, type WalkFeedback, type WalkSession } from '@/lib/walk-library';
import { emptyTrack } from '@/lib/walk-tracking';
import { downloadPack, enableOfflineViewer } from '@/lib/offline-walk';
import ExploreWalks from '@/components/walking/ExploreWalks';
import SavedWalks from '@/components/walking/SavedWalks';
import WalkRecorder from '@/components/walking/WalkRecorder';
import WalkTimeline from '@/components/walking/WalkTimeline';
import PaceCalibration from '@/components/walking/PaceCalibration';
import QuickConditionUpdate from '@/components/walking/QuickConditionUpdate';
import PilotSelector from '@/components/walking/PilotSelector';
import PilotSources from '@/components/walking/PilotSources';
import PilotUnavailable from '@/components/walking/PilotUnavailable';
import { PILOTS,pilotFromParams,isPilotAvailable,pointInPilot,type PilotId,type PilotContext } from '@/lib/pilots';
import { usePlannerResult } from '@/lib/use-planner';
import { metres } from '@/lib/walking-geometry';


import ResidentMap, { type MapMode } from '@/components/map/ResidentMap';
import PanelGrip, { type PanelState } from '@/components/walking/PanelGrip';
import { presetStartPoints, type StartPoint } from '@/lib/start-points';
import WeatherStrip from '@/components/walking/WeatherStrip';
import WeatherWarningList from '@/components/walking/WeatherWarnings';
import TransitNearby from '@/components/walking/TransitNearby';
import AccessNotices from '@/components/walking/AccessNotices';
import { withMappedDetails } from '@/lib/pilot-walking-details';
import { activeAccessNotices } from '@/lib/access-notices';
import type { WeatherWarnings } from '@/lib/weather-warnings';
import HazardPhotoInput from '@/components/resident/HazardPhotoInput';
import { photoDescription, type PhotoReading } from '@/lib/photo-hazard';
import './resident.css';

/* ------------------------------------------------------------------ */
/* Constants                                                           */
/* ------------------------------------------------------------------ */

const EMERGENCY_NUMBER = '999'; // Malaysia. Remove the "Call for help" button if you don't want it.

const MODES: Mode[] = ['direct', 'coolest', 'sheltered', 'safest'];

const MODE_LABEL: Record<Mode, string> = { direct: 'Shortest', coolest: 'Shadiest', sheltered: 'Rain shelter', safest: 'Best lit' };
const MODE_ICON: Record<Mode, LucideIcon> = { direct: Footprints, coolest: Umbrella, sheltered: CloudRain, safest: Lightbulb };

const HAZARD_OPTIONS: { kind: HazardKind; label: string; Icon: LucideIcon }[] = [
    { kind: 'no_shade', label: 'Missing shade', Icon: Sun },
    { kind: 'light_out', label: 'Broken light', Icon: Lightbulb },
    { kind: 'broken_surface', label: 'Damaged footpath', Icon: AlertTriangle },
    { kind: 'no_ramp', label: 'Missing kerb ramp', Icon: Accessibility },
    { kind: 'blocked', label: 'Blocked path', Icon: Ban },
];

interface DeviceHazard extends ReportMarker {
    id: string;
    lat: number;
    lng: number;
    category: string;
    description: string;
    location: string;
    dataset: string | undefined;
    /** Small JPEG data URL of the hazard photo, kept with the report on this device. */
    photo?: string;
}
const hazardKey = (area: PilotId) => `townshipgo:hazards:v1:${area}`;
function readDeviceHazards(area: PilotId): DeviceHazard[] {
    try {
        const value = JSON.parse(localStorage.getItem(hazardKey(area)) ?? '[]');
        return Array.isArray(value) ? value.filter(report => report && typeof report.id === 'string'
            && typeof report.category === 'string' && typeof report.description === 'string'
            && typeof report.location === 'string' && Number.isFinite(report.lat) && Number.isFinite(report.lng)
            && (report.photo === undefined || (typeof report.photo === 'string' && report.photo.startsWith('data:image/')))
            && pointInPilot([report.lat, report.lng], area)) : [];
    } catch { return []; }
}

type Step = 'where' | 'route' | 'walking';
type TextScale = 'normal' | 'large' | 'xlarge';
type Prefs = { mapMode: MapMode; scale: TextScale; highContrast: boolean; reduceMotion: boolean; vibrate: boolean; speak: boolean };

const DEFAULT_PREFS: Prefs = { mapMode: '3d', scale: 'normal', highContrast: false, reduceMotion: false, vibrate: true, speak: false };
const PREFS_KEY = 'townshipgo:prefs';
const SCALE_PCT: Record<TextScale, string> = { normal: '100%', large: '112.5%', xlarge: '125%' };



/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

async function copyText(text: string): Promise<boolean> {
    try {
        if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(text);
            return true;
        }
    } catch { /* fall through to the old method */ }
    try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand('copy');
        document.body.removeChild(ta);
        return ok;
    } catch {
        return false;
    }
}

const minutesOf = (r: RouteResult & { total_min?: number }) => Math.max(1, Math.ceil(r.total_min ?? r.walk_min));

function reasonFor(mode: Mode, route: NonNullable<JourneyPlan['routes']['direct']>, night: boolean) {
    if (mode === 'sheltered') return `${Math.max(0, Math.round(route.length_m - route.unsheltered_m))} m with recorded roof cover`;
    if (mode === 'direct') return `${Math.round(route.length_m)} m total`;
    if (night) return `${Math.round(route.dark_m)} m estimated low light`;
    if (mode === 'safest') return 'Compares mapped crossings';
    return `${Math.round(route.sun_exposed_min)} min estimated sun`;
}

/* ------------------------------------------------------------------ */
/* Small shared components                                             */
/* ------------------------------------------------------------------ */

function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
    const dialog = useRef<HTMLDialogElement>(null);
    useEffect(() => {
        const element = dialog.current;
        element?.showModal();
        return () => element?.close();
    }, []);
    return (
        <dialog ref={dialog} aria-label={title} className="tg-dialog" onCancel={event => { event.preventDefault(); onClose(); }}
            onClick={event => { if (event.currentTarget === event.target) onClose(); }}>
            <div className="tg-dialog-panel">
                <div className="tg-sheet-handle" aria-hidden />
                <div className="flex items-center justify-between gap-3 mb-3">
                    <h2 className="tg-h2">{title}</h2>
                    <button type="button" className="tg-close" aria-label="Close" onClick={onClose}><X size={20} aria-hidden /></button>
                </div>
                {children}
            </div>
        </dialog>
    );
}

function SettingSwitch({ label, hint, checked, onChange }: {
    label: string; hint: string; checked: boolean; onChange: (v: boolean) => void;
}) {
    return (
        <button role="switch" aria-checked={checked} className="tg-card" onClick={() => onChange(!checked)}>
            <span style={{ flex: 1 }}>
                <span style={{ display: 'block', fontWeight: 800 }}>{label}</span>
                <span className="tg-small" style={{ display: 'block' }}>{hint}</span>
            </span>
            <span className="tg-state">{checked ? 'On' : 'Off'}</span>
        </button>
    );
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

function ResidentPageContent() {
    const searchParams = useSearchParams();
    const router=useRouter();
    const [boot]=useState(()=>{
        try {const collection=readLibrary(localStorage),draft=readWalkDraft(localStorage);const active=draft&&!collection.library.history.some(w=>w.id===draft.id)?draft:null;
            return {collection,draft:active,area:active?(active.pack.area_id??'elmina'):pilotFromParams(searchParams)};
        }catch{return {collection:{library:emptyLibrary(),warning:'Device storage is unavailable. You can still plan and download walk packs.'},draft:null,area:pilotFromParams(searchParams)};}
    });
    const area=boot.area,configuration=PILOTS[area];
    const initialWalk = readWalkParameters(searchParams, area==='elmina'?DESTINATIONS.map(d=>d.id):[], configuration.centre);
    const initialOriginUsed=useRef(initialWalk.fromLink);

    const [userCoords, setUserCoords] = useState<[number, number]>(initialWalk.origin);
    const [usingGPS, setUsingGPS] = useState(false);
    const [geoBusy, setGeoBusy] = useState(false);
    const [geoMsg, setGeoMsg] = useState<string | null>(null);
    const [destId, setDestId] = useState<string>(searchParams.get('destId') || initialWalk.destination || '');
    const [placeQuery, setPlaceQuery] = useState('');
    const [searchOpen, setSearchOpen] = useState(false);
    const [showStartPicker, setShowStartPicker] = useState(false);
    const [pilotData,setPilotData]=useState<PilotContext|null>(null);
    const [startingWalk,setStartingWalk]=useState(false);
    const [profile, setProfile] = useState<Profile>(() => {
        if (searchParams.has('profile')) return initialWalk.profile;
        try { const saved=localStorage.getItem('townshipgo:selected-profile:v1');return saved && Object.keys(PROFILES).includes(saved) ? saved as Profile : initialWalk.profile; } catch { return initialWalk.profile; }
    });

    const [initialTime] = useState(() => new Date().toISOString());
    const [planningNow,setPlanningNow]=useState(initialTime);
    const [departure, setDeparture] = useState<string | null>(() => {
        const raw = searchParams.get('departure');
        return raw && Number.isFinite(Date.parse(raw)) && Date.parse(raw) >= Date.now() - 900000 ? raw : null;
    });
    const [entranceId, setEntranceId] = useState(searchParams.get('entrance') || '');
    const [sourceWalkingData, setWalkingData] = useState<WalkingData | null>(null);
    const [networkSnapshot, setNetworkSnapshot] = useState<string | null>(null);
    const [exactDestination, setExactDestination] = useState<string | null>(searchParams.get('destId')?'Requested place':null);
    const [needs, setNeeds] = useState(() => {
        try {
            const parsed=normaliseNeeds(JSON.parse(searchParams.get('needs') || localStorage.getItem('townshipgo:walking-needs:v1') || '{}'));
            const previous=localStorage.getItem('townshipgo:selected-profile:v1');
            return !searchParams.has('needs') && previous && previous !== profile ? { ...parsed, speed_mps: null } : parsed;
        }
        catch { return normaliseNeeds({}); }
    });

    const [nodes, setNodes] = useState<PathNode[]>([]);
    const [edges, setEdges] = useState<PathEdge[]>([]);
    const [hazards, setHazards] = useState<HazardReport[]>([]);
    const [reports, setReports] = useState<ReportMarker[]>([]);
    const [loadingDb, setLoadingDb] = useState(true);
    const [dataError, setDataError] = useState(false);
    const [reloadVersion, setReloadVersion] = useState(0);

    const [weather, setWeather] = useState<WalkingWeather | null>(null);
    const [warningFeed, setWarningFeed] = useState<WeatherWarnings | null>(null);
    const [chosenMode, setChosenMode] = useState<Mode | null>(initialWalk.mode);
    const [step, setStep] = useState<Step>(initialWalk.fromLink||searchParams.get('destId') ? 'route' : 'where');
    const initialLibrary=boot.collection;
    const [library, setLibrary] = useState<WalkLibrary>(initialLibrary.library);
    const libraryRef = useRef(library);
    const [libraryMessage, setLibraryMessage] = useState<string | null>(initialLibrary.warning);
    const [walkSession, setWalkSession] = useState<WalkSession | null>(boot.draft);
    const [sessionFinished, setSessionFinished] = useState(false);
    const [view, setView] = useState<'explore' | 'plan' | 'walk' | 'saved'>(walkSession && !initialWalk.fromLink ? 'walk' : 'plan');
    const [returning, setReturning] = useState(searchParams.get('return') === '1');
    const [savingPack, setSavingPack] = useState(false);
    const [panelState, setPanelState] = useState<PanelState>(view === 'walk' ? 'min' : 'partial');
    const panelMinimized = panelState === 'min';
    // Showing new content opens the panel to part height; minimising keeps the old behaviour.
    const setPanelMinimized = (minimized: boolean) => setPanelState(current => minimized ? 'min' : current === 'full' ? 'full' : 'partial');
    const [livePoint, setLivePoint] = useState<[number, number] | null>(null);
    const [mapFocus, setMapFocus] = useState<[number, number] | undefined>();

    // Hazard reporting
    const [showReportModal, setShowReportModal] = useState(false);
    const [pickingHazard, setPickingHazard] = useState(false);
    const [reportPoint, setReportPoint] = useState<[number, number] | null>(null);
    const [reportLocated, setReportLocated] = useState(false);
    const [deviceHazards, setDeviceHazards] = useState(() => readDeviceHazards(area));
    const [informationLayer, setInformationLayer] = useState<EnvironmentLayer | 'routes'>('routes');
    const [selectedKind, setSelectedKind] = useState<HazardKind>('broken_surface');
    const [reportNotes, setReportNotes] = useState('');
    const [reportPhoto, setReportPhoto] = useState<string | null>(null);
    const [autoNote, setAutoNote] = useState<string | null>(null);
    const [isSubmittingReport, setIsSubmittingReport] = useState(false);
    const [reportMsg, setReportMsg] = useState<string | null>(null);

    // Settings, sharing, confirmation
    const [prefs, setPrefs] = useState<Prefs>(() => {
        let stored: Partial<Prefs> | null = null;
        try {
            const raw = localStorage.getItem(PREFS_KEY);
            if (raw) stored = JSON.parse(raw);
        } catch { /* ignore inaccessible storage */ }
        const systemReduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
        return { ...DEFAULT_PREFS, reduceMotion: systemReduce, ...(stored ?? {}) };
    });
    const [showSettings, setShowSettings] = useState(false);
    const [showShare, setShowShare] = useState(false);
    const [shareUrl, setShareUrl] = useState('');
    const [copied, setCopied] = useState(false);
    const [shareNote, setShareNote] = useState<string | null>(null);
    const canShare = typeof navigator.share === 'function';
    const canSpeak = 'speechSynthesis' in window;

    /* ---------- Preferences ---------- */
    useEffect(() => {
        try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch { /* ignore */ }
    }, [prefs]);

    useEffect(() => {
        try { localStorage.setItem('townshipgo:walking-needs:v1', JSON.stringify(needs)); } catch { /* storage may be unavailable */ }
    }, [needs]);
    useEffect(() => { try { localStorage.setItem('townshipgo:selected-profile:v1', profile); } catch { /* storage may be unavailable */ } }, [profile]);
    useEffect(()=>{const refresh=()=>setPlanningNow(new Date().toISOString());const timer=setInterval(refresh,60000);const visible=()=>{if(document.visibilityState==='visible')refresh();};document.addEventListener('visibilitychange',visible);return()=>{clearInterval(timer);document.removeEventListener('visibilitychange',visible);};},[]);

    // Text size scales the whole page because everything is sized in rem
    useEffect(() => {
        const root = document.documentElement;
        const previous = root.style.fontSize;
        root.style.fontSize = SCALE_PCT[prefs.scale];
        return () => { root.style.fontSize = previous; };
    }, [prefs.scale]);

    function setPref<K extends keyof Prefs>(key: K, value: Prefs[K]) {
        setPrefs((p) => ({ ...p, [key]: value }));
    }

    function buzz(ms = 40) {
        if (prefs.vibrate && typeof navigator.vibrate === 'function') navigator.vibrate(ms);
    }

    function speak(text: string, force = false) {
        if (!force && !prefs.speak) return;
        if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
        window.speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(text);
        u.rate = 0.9;
        window.speechSynthesis.speak(u);
    }

    /* ---------- Data ---------- */
    useEffect(() => {
        let cancelled = false;
        async function refreshWeather() {
            const forecast = await loadWeather(area);
            if (!cancelled) setWeather(forecast);
        }
        async function refreshWarnings() {
            const feed = await loadWeatherWarnings(area);
            if (!cancelled) setWarningFeed(feed);
        }

        async function loadGraph() {
            try {
                const [graphData, hazardData, reportData, walking,context] = await Promise.all([
                    fetchGraph(area), loadHazards(area), loadReports('open',area), loadWalkingData(area),loadPilotContext(area),
                ]);
                if (cancelled) return;
                const mapped = withMappedDetails(graphData.edges, { ...walking,
                    area_id: area, dataset_id: walking.dataset_id ?? graphData.source.dataset_id }, context);
                setPilotData(context);
                if(!initialOriginUsed.current){setUserCoords(graphData.source.origin?.coordinates??context.origin.coordinates);initialOriginUsed.current=true;}
                setNodes(graphData.nodes);
                setNetworkSnapshot(graphData.source.snapshot_at ?? null);
                setWalkingData(mapped.walking);
                setEdges(mapped.edges);
                setHazards(hazardData.hazards);
                setReports(reportData.reports);
                setDataError(false);
            } catch (error) {
                if (!cancelled) {
                    console.error("Could not load pedestrian data:", error);
                    setDataError(true);
                }
            } finally {
                if (!cancelled) setLoadingDb(false);
            }
        }

        void refreshWeather();
        void refreshWarnings();
        void loadGraph();
        const timer = window.setInterval(refreshWeather, 15 * 60 * 1000);
        const warningTimer = window.setInterval(refreshWarnings, 5 * 60 * 1000);
        return () => {
            cancelled = true;
            window.clearInterval(timer);
            window.clearInterval(warningTimer);
        };
    }, [reloadVersion,area]);

    /* ---------- Routing ---------- */
    const planningTime = departure ?? planningNow;
    const accessNotices = useMemo(() => activeAccessNotices(edges, sourceWalkingData, planningNow), [edges, sourceWalkingData, planningNow]);
    const nearbyWeatherWarning = warningFeed?.warnings.some(warning => warning.mentions_area && warning.valid_to > planningNow);
    const walkingData = useMemo(() => sourceWalkingData ? withPersonalUpdates(sourceWalkingData, library.updates, planningTime) : null, [sourceWalkingData, library.updates, planningTime]);
    const slot: TimeSlot = slotForHour(malaysiaHour(planningTime));
    const isNight = slot === 'night';
    const graph = useMemo(() => buildGraph(nodes, edges), [nodes, edges]);
    const startPoints = useMemo(() => pilotData && sourceWalkingData ? presetStartPoints(pilotData, sourceWalkingData.assets, graph) : [],
        [pilotData, sourceWalkingData, graph]);
    const places = useMemo(() => walkingData?.assets.filter(a => ['destination', 'transit', 'toilet', 'water', 'rest', 'shelter'].includes(a.kind)) ?? [], [walkingData]);
    const destination = places.find(a => a.id === destId || a.external_id === destId) ?? (exactDestination ? null : places.find(a=>a.id===pilotData?.featured_ids[0])??places[0]) ?? null;
    const currentDest = destination ? { id: destination.external_id || destination.id, name: destination.name, coords: [destination.lat, destination.lng] as [number, number] } : {id:'',name:exactDestination||'Choose a mapped place',coords:configuration.centre};
    const entrances = walkingData?.assets.filter(a => a.kind === 'entrance' && a.parent_id === destination?.id) ?? [];
    const forecast = forecastAt(weather, planningTime);
    const toolRequest = useMemo(() => ({ origin: userCoords, profile, needs, departure_at: planningTime }), [userCoords, profile, needs, planningTime]);
    const planningSnapshot=useMemo(()=>walkingData&&nodes.length?{nodes,edges,walking:walkingData,hazards}:null,[nodes,edges,walkingData,hazards]);
    const journeySearch = usePlannerResult<JourneyPlan>(planningSnapshot, step !== 'route' ? null : returning
        ? { type: 'return', input: toolRequest, feels_like: forecast?.feels_like_c }
        : destination ? { type: 'journey', input: { ...toolRequest, destination, entrance_id: entranceId || undefined }, feels_like: forecast?.feels_like_c } : null);
    const plan=journeySearch.result;
    const searchTerm = placeQuery.trim().split(',')[0].trim().toLowerCase();
    const matchingPlaces=useMemo(()=>places.filter(a=>!searchTerm||placeSearchText(a).includes(searchTerm))
        .sort((a,b)=>{const rank=(id:string)=>{const index=pilotData?.featured_ids.indexOf(id)??-1;return index<0?100:index;};return rank(a.id)-rank(b.id)||a.name.localeCompare(b.name);}),[places,searchTerm,pilotData]);
    const searchResults = matchingPlaces.slice(0, 8);
    const suggestedPlaces = (pilotData?.featured_ids ?? []).flatMap(id => places.find(place => place.id === id) ?? []).slice(0, 3);
    const mapAssets=useMemo(()=>walkingData?.assets.filter(a=>(['rest','toilet','water','shelter','transit'].includes(a.kind) &&
        (a.source!=='gtfs'||a.id===destination?.id))||(a.kind==='entrance'&&a.parent_id===destination?.id))
        .sort((a,b)=>metres([a.lng,a.lat],[userCoords[1],userCoords[0]])-metres([b.lng,b.lat],[userCoords[1],userCoords[0]])).slice(0,80)??[],[walkingData,destination,userCoords]);
    const recommended: Mode = plan?.recommended ?? (isNight ? 'safest' : 'coolest');

    const visibleModes = MODES.filter(mode => plan?.routes[mode] && !(isNight && mode === 'coolest'));

    const activeMode = chosenMode && !(isNight && chosenMode === 'coolest') ? chosenMode : recommended;

    const activeRoute = view === 'walk' && walkSession ? walkSession.pack.route :
        plan?.routes[activeMode] ?? plan?.routes.direct ?? Object.values(plan?.routes ?? {})[0];
    const shownMode: Mode = activeRoute?.mode ?? activeMode;
    const shortest = plan?.routes.direct;
    const sameAsShortest = activeRoute && shortest && shownMode !== 'direct'
        && activeRoute.coordinates.length === shortest.coordinates.length
        && activeRoute.coordinates.every(([lat, lng], index) => lat === shortest.coordinates[index][0] && lng === shortest.coordinates[index][1]);
    const reportEdge = useMemo(() => {
        if (!reportPoint || !pointInPilot(reportPoint, area)) return null;
        const near = nearestEdge(graph, ...reportPoint);
        return near && near.distance_m <= 150 ? edges.find(edge => edge.id === near.edge_id) ?? null : null;
    }, [reportPoint, graph, edges, area]);
    const localReports = useMemo(() => deviceHazards.filter(report => report.dataset === sourceWalkingData?.dataset_id),
        [deviceHazards, sourceWalkingData?.dataset_id]);
    const mapReports = useMemo(() => [...reports, ...localReports], [reports, localReports]);

    const mapRoutes = useMemo(
        () =>
            view === 'walk' && walkSession ? [{ id: walkSession.pack.route.mode, name: 'Your recorded walk plan', route_type: walkSession.pack.route.mode, coordinates: walkSession.pack.route.coordinates }] : MODES.flatMap((m) => {
                const r = plan?.routes[m];
                return r
                    ? [{
                        id: m,
                        name: MODE_LABEL[m],
                        route_type: m === 'safest' ? 'night_safe' : m,
                        coordinates: r.coordinates,
                        shade_factor: isNight ? r.avg_lit : r.avg_shade,
                        surface_temp_base_c: 0,
                        length_meters: Math.round(r.length_m),
                    }]
                    : [];
            }),
        [plan, isNight, view, walkSession],
    );

    /* ---------- Things the person does ---------- */
    function chooseDest(id: string) {
        setMapFocus(undefined);
        setReturning(false);
        setChosenMode(null);
        setDestId(id);
        setExactDestination(places.find(a => a.id === id || a.external_id === id)?.name ?? 'Selected place');
        setEntranceId('');
        buzz();
    }
    function chooseProfile(p: Profile) {
        setChosenMode(null);
        if (p !== profile) setNeeds(n => ({ ...n, speed_mps: null }));
        setProfile(p);
        buzz();
    }
    function chooseMode(m: Mode) {
        setChosenMode(m);
        buzz();
    }

    function handleGetLocation() {
        setGeoMsg(null);
        if (!('geolocation' in navigator)) {
            setGeoMsg(`This device cannot share its location. You can use the ${configuration.origin_label}.`);
            return;
        }
        setGeoBusy(true);
        navigator.geolocation.getCurrentPosition(
            (pos) => {
                const coords: [number, number] = [pos.coords.latitude, pos.coords.longitude];
                setGeoBusy(false);
                if (!pointInPilot(coords, area)) {
                    setGeoMsg('Your location is outside this walking area. Use the area start or choose another area.');
                    return;
                }
                initialOriginUsed.current = true;
                setUserCoords(coords);
                setMapFocus(undefined);
                setUsingGPS(true);
                setShowStartPicker(false);
            },
            () => {
                setGeoBusy(false);
                setGeoMsg(`We could not find your location. Check that location is turned on, or use the ${configuration.origin_label}.`);
            },
            { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 },
        );
    }

    function chooseStart(point: StartPoint) {
        initialOriginUsed.current = true;
        setUserCoords(point.coordinates);
        setUsingGPS(false);
        setGeoMsg(null);
        setMapFocus(undefined);
        setShowStartPicker(false);
        buzz();
    }

    async function startWalk() {
        if (walkSession && !sessionFinished) {
            setView('walk');
            setPanelMinimized(false);
            setLibraryMessage('Your current walk is still in progress. Finish it before starting another.');
            return;
        }
        if (!activeRoute || !walkingData) return;
        const now = new Date().toISOString();
        setStartingWalk(true);
        let fresh:JourneyPlan|null=null;
        try { fresh=await journeySearch.run<JourneyPlan>({type:returning?'return':'journey',input:{...toolRequest,...(destination?{destination}:{}),entrance_id:entranceId||undefined,departure_at:now}}); }
        catch{setLibraryMessage('The current route could not be checked. Please refresh and try again.');return;}finally{setStartingWalk(false);}
        const route = fresh?.routes[shownMode];
        if (!route) { setLibraryMessage('This route no longer matches your needs for a walk starting now. Refresh and review the route before setting out.'); return; }
        const pack = createWalkPack(route, profile, needs, userCoords, edges, walkingData, undefined, networkSnapshot);
        setWalkSession({ id: crypto.randomUUID(), pack, started_at: now, elapsed_ms: 0, track: emptyTrack() });
        setSessionFinished(false); setLivePoint(null); setView('walk');
        setPanelMinimized(true);
        buzz(80);
        setStep('walking');
        speak(`Your walk has started. About ${minutesOf(route)} minutes. ${route.return_walk ? 'Return to your starting point.' : `To ${route.destination.name}.`}`);
    }

    function changeLibrary(next: WalkLibrary) {
        try { writeLibrary(next, localStorage); libraryRef.current = next; setLibrary(next); return true; }
        catch (error) { setLibraryMessage(error instanceof Error ? error.message : 'Device storage is unavailable.'); return false; }
    }
    function finishRecording(walk: CompletedWalk) {
        const ok = changeLibrary({ ...libraryRef.current, history: [walk, ...libraryRef.current.history.filter(w => w.id !== walk.id)] });
        if (ok) setSessionFinished(true); return ok;
    }
    function saveFeedback(id: string, feedback: WalkFeedback) {
        if (!libraryRef.current.history.some(w => w.id === id)) return false;
        return changeLibrary({ ...libraryRef.current, history: libraryRef.current.history.map(w => w.id === id ? { ...w, feedback } : w) });
    }
    function planReturn(minutes: number) { setReturning(true); setNeeds(n => ({ ...n, budget_min: minutes })); setEntranceId(''); setChosenMode(null); setStep('route'); setView('plan'); setPanelMinimized(false); }
    function focusWalkPoint(point: [number, number]) { setMapFocus(point); requestAnimationFrame(()=>document.querySelector('.tg-map')?.scrollIntoView({block:'center',behavior:prefs.reduceMotion?'auto':'smooth'})); }
    function chooseFacility(asset: WalkingAsset) { chooseDest(asset.external_id || asset.id); setStep('route'); setView('plan'); setPanelMinimized(false); }
    function replanPack(pack: WalkPack) {
        const target=pack.area_id??'elmina';
        if(target!==area){if(walkSession&&!sessionFinished){setLibraryMessage('Finish the current walk before switching areas.');return;}
            router.replace('/resident?'+new URLSearchParams({area:target,startLat:String(pack.origin[0]),startLng:String(pack.origin[1]),destId:pack.route.destination.external_id||pack.route.destination.id,profile:pack.profile,needs:JSON.stringify(pack.needs),...(pack.route.return_walk?{return:'1'}:{entrance:pack.route.entrance.id})}));return;}
        setUserCoords(pack.origin); setUsingGPS(false); setProfile(pack.profile); setNeeds(normaliseNeeds(pack.needs));
        setMapFocus(undefined);
        setExactDestination(pack.route.destination.name);
        setReturning(!!pack.route.return_walk); setDestId(pack.route.destination.external_id || pack.route.destination.id); setEntranceId(pack.route.return_walk ? '' : pack.route.entrance.id);
        setDeparture(new Date().toISOString()); setChosenMode(null); setStep('route'); setView('plan'); setPanelMinimized(false); setReloadVersion(v => v + 1); }
    async function savePack() {
        if (!activeRoute || !walkingData) return;
        const pack = createWalkPack(activeRoute, profile, needs, userCoords, edges, walkingData, undefined, networkSnapshot);
        if (!changeLibrary({ ...libraryRef.current, packs: [pack, ...libraryRef.current.packs] })) return;
        setSavingPack(true);
        const ready = await enableOfflineViewer(); setSavingPack(false);
        setLibraryMessage(ready ? 'Walk saved. Your offline collection is ready in Saved.' : 'Walk saved on this device. Download a walk pack in Saved for dependable offline access.');
    }
    function saveUpdate(update: ConditionUpdate) { const ok=changeLibrary({ ...libraryRef.current, updates: [update, ...libraryRef.current.updates] });if(ok&&!departure)setPlanningNow(update.observed_at);return ok; }
    function changeArea(next: PilotId) {
        if (walkSession && !sessionFinished) {
            setPanelMinimized(false);
            setLibraryMessage('Finish the current walk before switching areas.');
            return;
        }
        router.replace(`/resident?area=${next}`);
    }
    async function shareUpdate(update: ConditionUpdate) {
        if (IS_PAGES_PREVIEW) return false;
        try {
            const response = await fetch(sitePath('/api/condition-updates'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(update) });
            if (!response.ok) return false;
            const next = { ...libraryRef.current, updates: libraryRef.current.updates.map(u => u.id === update.id ? { ...u, shared_at: new Date().toISOString() } : u) };
            if (!changeLibrary(next)) { libraryRef.current = next; setLibrary(next); setLibraryMessage('The report was shared, but this browser could not update its device copy.'); }
            setReloadVersion(v => v + 1); return true;
        } catch { return false; }
    }

    function readRouteAloud() {
        if (!activeRoute) return;
        speak(
            `${activeRoute.return_walk ? 'Return to your starting point' : `To ${activeRoute.destination.name}`}. ${MODE_LABEL[shownMode]} route. About ${minutesOf(activeRoute)} minutes, ` +
            `${Math.round(activeRoute.length_m)} metres. ${activeRoute.verified_rest_stops} verified rest stops. ` +
            `${Math.round(activeRoute.uncovered_m)} metres uncovered, estimated. ${activeRoute.unverified_crossings} crossings need checks. ` +
            `Arrival at ${activeRoute.entrance.name}. ${activeRoute.suitability === 'green' ? 'This route meets your needs and current checks.' : 'This route needs confirmation.'}`,
            true,
        );
    }

    /* ---------- Sharing ---------- */
    const walkMin = activeRoute ? minutesOf(activeRoute) : null;
    const shareMessage =
        `${activeRoute?.return_walk ? 'I am taking a return walk' : `I'm walking to ${activeRoute?.destination.name ?? currentDest.name}`} on the ${MODE_LABEL[shownMode].toLowerCase()} route` +
        `${walkMin ? `, about ${walkMin} minutes` : ''}. Here is my route:`;

    function openShare() {
        const captured = view === 'walk' ? walkSession?.pack : undefined;
        const origin = captured?.origin ?? userCoords;
        const sharedRoute = captured?.route ?? activeRoute;
        const params = new URLSearchParams({
            area,
            startLat: origin[0].toFixed(5),
            startLng: origin[1].toFixed(5),
            destId: sharedRoute?.destination.external_id || sharedRoute?.destination.id || destId,
            mode: shownMode,
            profile: captured?.profile ?? profile,
            needs: JSON.stringify(captured?.needs ?? needs),
            departure: sharedRoute?.departure_at ?? planningTime,
            ...(sharedRoute?.return_walk ? { return: '1' } : {}),
            ...(sharedRoute && !sharedRoute.return_walk ? { entrance: sharedRoute.entrance.id } : {}),
        });
        setShareUrl(`${window.location.origin}${window.location.pathname}?${params.toString()}`);
        setCopied(false);
        setShareNote(null);
        setShowShare(true);
        buzz();
    }

    async function nativeShare() {
        try {
            await navigator.share({ title: 'My walk on TownshipGo', text: shareMessage, url: shareUrl });
        } catch (err) {
            if ((err as DOMException)?.name !== 'AbortError') {
                setShareNote('Sharing did not work. Try "Copy message" instead.');
            }
        }
    }

    async function copyShare() {
        const ok = await copyText(`${shareMessage} ${shareUrl}`);
        setCopied(ok);
        setShareNote(ok ? null : 'Copying did not work. Press and hold the message above to copy it.');
        if (ok) buzz();
    }

    /* ---------- Reporting a problem ---------- */
    function openReport() {
        setReportPoint(livePoint ?? (usingGPS ? userCoords : null));
        setReportMsg(null);
        setSearchOpen(false);
        setShowReportModal(true);
        buzz();
    }

    function chooseReportPoint(lat: number, lng: number) {
        setReportPoint([lat, lng]);
        setReportMsg(null);
        setPickingHazard(false);
        setShowReportModal(true);
    }

    function locateReport() {
        if (!navigator.geolocation) {
            setReportMsg('Location is unavailable. Choose the location on the map.');
            return;
        }
        setReportLocated(true);
        navigator.geolocation.getCurrentPosition(position => {
            setReportPoint([position.coords.latitude, position.coords.longitude]);
            setReportMsg(null);
            setReportLocated(false);
        }, () => {
            setReportMsg('Location is unavailable. Choose the location on the map.');
            setReportLocated(false);
        }, { enableHighAccuracy: true, timeout: 8000, maximumAge: 30000 });
    }

    /* A photo reading picks the category and writes the details, unless the person already typed their own. */
    function applyPhotoReading(reading: PhotoReading) {
        if (!reading.kind) return;
        setSelectedKind(reading.kind);
        const text = photoDescription(reading, reportEdge?.name);
        if (text && (!reportNotes.trim() || reportNotes === autoNote)) {
            setReportNotes(text);
            setAutoNote(text);
        }
        buzz();
    }

    function updateDeviceHazards(next: DeviceHazard[]) {
        localStorage.setItem(hazardKey(area), JSON.stringify(next));
        setDeviceHazards(next);
    }

    async function submitCapexDefect() {
        if (!reportEdge || !reportPoint || isSubmittingReport) return;
        setReportMsg(null);
        setIsSubmittingReport(true);
        const [lat, lng] = reportPoint;
        try {
            if (IS_PAGES_PREVIEW) {
                const category = HAZARD_OPTIONS.find(option => option.kind === selectedKind)!.label;
                updateDeviceHazards([{ id: crypto.randomUUID(), lat, lng, category, description: reportNotes.trim(),
                    location: reportEdge.name ?? 'Mapped footpath', dataset: sourceWalkingData?.dataset_id,
                    ...(reportPhoto ? { photo: reportPhoto } : {}) },
                ...deviceHazards]);
                setReportMsg('Saved on this device.');
                speak('Your report was saved on this device.');
            } else {
                const { hazard, report } = await submitReport({
                    area_id: area, edge_id: reportEdge.id, lat, lng, kind: selectedKind, description: reportNotes,
                });
                setHazards(previous => [...previous, hazard]);
                setReports(previous => [report, ...previous]);
                setReportMsg('Report sent to the maintenance queue.');
                speak('Your report was sent.');
            }
            setReportNotes('');
            setAutoNote(null);
            setReportPhoto(null);
            setReportPoint(null);
            buzz(120);
        } catch (error) {
            setReportMsg(IS_PAGES_PREVIEW ? 'Could not save this report on your device.'
                : error instanceof Error ? error.message : 'Could not send the report. Try again when connected.');
        } finally {
            setIsSubmittingReport(false);
        }
    }

    /* ---------- Keep the screen on while walking ---------- */
    useEffect(() => {
        if (step !== 'walking') return;
        let lock: WakeLockSentinel | null = null;
        let cancelled = false;

        const acquire = async () => {
            try {
                const wl = navigator.wakeLock;
                if (!wl) return;
                lock = await wl.request('screen');
                if (cancelled) lock.release?.();
            } catch { /* not supported or refused */ }
        };
        const onVisible = () => { if (document.visibilityState === 'visible') acquire(); };

        acquire();
        document.addEventListener('visibilitychange', onVisible);
        return () => {
            cancelled = true;
            document.removeEventListener('visibilitychange', onVisible);
            try { lock?.release?.(); } catch { /* ignore */ }
        };
    }, [step]);

    /* ---------- Derived display values ---------- */
    const selectedStart = startPoints.find(point => Math.abs(point.coordinates[0] - userCoords[0]) < 1e-7
        && Math.abs(point.coordinates[1] - userCoords[1]) < 1e-7);
    const originLabel = usingGPS ? 'Your location' : selectedStart?.label ?? (loadingDb ? configuration.origin_label : 'Your chosen starting point');

    function selectSearchResult(place: WalkingAsset) {
        chooseDest(place.external_id || place.id);
        setReturning(false);
        setPlaceQuery('');
        setSearchOpen(false);
        setMapFocus(undefined);
        setPanelMinimized(false);
        setStep('route');
        setView('plan');
    }

    const planningControls = <div className="space-y-3">
        <WalkingRequirements needs={needs} profile={profile} onChange={value => { setNeeds(normaliseNeeds(value)); setChosenMode(null); }} />
        <DepartureControl departure={planningTime} onChange={value => { setDeparture(value); setChosenMode(null); }} onNow={() => { setDeparture(null);setPlanningNow(new Date().toISOString()); setReloadVersion(v => v + 1); }} forecast={forecast} />
    </div>;

    const quickUpdate = <QuickConditionUpdate area={area} dataset={walkingData?.dataset_id} edges={edges.filter(e => activeRoute?.edge_ids.includes(e.id))} facilities={walkingData?.assets ?? []} onSave={saveUpdate} onShare={shareUpdate} />;

    /* ---------------------------------------------------------------- */

    return (
        <div data-view={view} data-panel-minimized={panelMinimized || pickingHazard} data-panel={pickingHazard ? 'min' : panelState} className={`tg font-sans relative w-full h-[100dvh] flex flex-col overflow-hidden shadow-2xl ${prefs.highContrast ? 'hc' : ''} ${prefs.reduceMotion ? 'rm' : ''}`}>

            <div className="tg-topbar">
            <a href="#walk-planning" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[3000] focus:rounded-xl focus:bg-white focus:p-3 focus:font-bold text-slate-900">Skip to walk planning</a>
            <header className="tg-header">
                <Link href="/" className="tg-brand" aria-label="TownshipGo home">
                    <span><Footprints size={19} aria-hidden /></span> TownshipGo
                </Link>
                <PilotSelector area={area} onChange={changeArea} />
                <button className="tg-iconbtn" onClick={() => setShowSettings(true)} aria-label="Text size and display settings">Aa</button>
            </header>
            {view !== 'saved' && view !== 'walk' && (
                <div className="tg-trip-fields">
                <button type="button" className="tg-start-field" onClick={() => { setSearchOpen(false); setShowStartPicker(true); }} aria-haspopup="dialog">
                    <CircleDot size={19} aria-hidden /><span>From</span><strong>{originLabel}</strong><ChevronDown size={16} aria-hidden />
                </button>
                <form className="tg-search" onSubmit={event => {
                    event.preventDefault();
                    if (searchResults[0]) selectSearchResult(searchResults[0]);
                }} onKeyDown={event => {
                    if (event.key === 'Escape') setSearchOpen(false);
                }} onBlur={event => {
                    if (!event.currentTarget.contains(event.relatedTarget)) setSearchOpen(false);
                }}>
                    <label className="tg-search-input">
                        <Search size={20} aria-hidden />
                        <span className="sr-only">Find a place</span>
                        <input type="search" autoComplete="off" value={placeQuery} onFocus={() => setSearchOpen(true)}
                            onChange={event => { setPlaceQuery(event.target.value); setSearchOpen(true); }}
                            placeholder={view === 'plan' && step === 'route' && !returning ? currentDest.name : 'Where are you going?'}
                            aria-controls={searchOpen ? 'mapped-places' : undefined} />
                    </label>
                    <button type="button" className="tg-location" aria-label="Use my location" title="Use my location" onClick={handleGetLocation} disabled={geoBusy}><LocateFixed size={20} aria-hidden /></button>
                    {searchOpen && <div id="mapped-places" className="tg-search-results">
                        {searchResults.length ? (
                            <ul aria-label={placeQuery.trim() ? 'Matching places' : 'Suggested places'}>
                                {searchResults.map(place => <li key={place.id}>
                                    <button type="button" onClick={() => selectSearchResult(place)}>
                                        <MapPin size={17} aria-hidden /><span>{place.name}</span>
                                    </button>
                                </li>)}
                            </ul>
                        ) : <p role="status">{loadingDb ? 'Loading mapped places…' : 'No mapped places match this search.'}</p>}
                    </div>}
                </form>
                </div>
            )}
            {geoMsg && !showStartPicker && <p className="tg-banner" role="status">{geoMsg}</p>}

            {dataError && (
                <div role="alert" className="tg-banner">
                    <span>We could not load the walking paths.</span>
                    <button className="tg-btn" style={{ width: 'auto' }} onClick={() => {
                        setLoadingDb(true); setReloadVersion((version) => version + 1);
                    }}>Try again</button>
                    {library.packs.length > 0 && <a href={sitePath('/offline-walks.html')} className="font-bold underline">Open offline walks</a>}
                </div>
            )}
            </div>

            <div className="tg-map">
                <ResidentMap
                    area={area}
                    mapMode={prefs.mapMode === '2d' ? '2d' : '3d'}
                    onMapModeChange={mode => setPref('mapMode', mode)}
                    routes={mapRoutes}
                    activeRouteId={activeRoute?.mode ?? ''}
                    reports={mapReports}
                    assets={mapAssets}
                    startCoords={view === 'walk' && walkSession ? walkSession.pack.origin : userCoords}
                    endCoords={activeRoute ? [activeRoute.entrance.lat, activeRoute.entrance.lng] : step === 'route' && destination && !returning ? currentDest.coords : undefined}
                    startLabel={usingGPS ? 'You' : 'Start'}
                    reduceMotion={prefs.reduceMotion}
                    highContrast={prefs.highContrast}
                    environment={walkingData ? { edges, records: walkingData.verifications, at: planningTime } : undefined}
                    informationLayer={informationLayer}
                    onInformationLayerChange={setInformationLayer}
                    focusLocation={mapFocus}
                    liveLocation={livePoint ?? undefined}
                    selectedLocation={showReportModal ? reportPoint ?? undefined : undefined}
                    onLocationSelect={pickingHazard ? chooseReportPoint : undefined}
                />
                {pickingHazard
                    ? <div className="tg-pick" role="status"><span>Tap the map at the hazard.</span><button className="tg-close" type="button" aria-label="Cancel picking a location" onClick={() => { setPickingHazard(false); setShowReportModal(true); }}><X size={19} aria-hidden /></button></div>
                    : <button type="button" className="tg-map-report" onClick={openReport}><AlertTriangle size={19} aria-hidden /> Report hazard</button>}
            </div>

            <section id="walk-planning" aria-label="Walk planning" tabIndex={-1} className="tg-sheet">
                {view !== 'saved' && !pickingHazard && <PanelGrip state={panelState} walk={view === 'walk'} onChange={setPanelState} />}
                <div id="walking-panel" className="tg-panel-body">
                {libraryMessage && <div role="status" className="tg-note mb-3"><p>{libraryMessage}</p><button className="min-h-11 text-sm font-bold underline" onClick={() => setLibraryMessage(null)}>Dismiss message</button></div>}
                {!!accessNotices.length && <div className="mb-3"><AccessNotices notices={accessNotices} onFocus={focusWalkPoint} /></div>}
                {nearbyWeatherWarning && (view !== 'plan' || step !== 'where') && <div className="mb-3"><WeatherWarningList feed={warningFeed} now={planningNow} /></div>}
                {view === 'explore' && <div className="tg-stack">
                    {pilotData && area !== 'elmina' && <TransitNearby context={pilotData} assets={walkingData?.assets ?? []} origin={userCoords} at={planningTime}
                        onChoose={selectSearchResult} onFocus={focusWalkPoint} />}
                    <ExploreWalks nodes={nodes} edges={edges} data={walkingData} request={toolRequest} hazards={hazards} onChoose={chooseFacility} onReturn={planReturn}
                    onLocate={handleGetLocation} locating={geoBusy} locationLabel={originLabel} locationMessage={geoMsg}
                    onLastPosition={livePoint ? () => { setUserCoords(livePoint); setUsingGPS(true); setGeoMsg('Using your last recorded GPS fix. Refresh your location if you have moved since then.'); } : undefined} />
                    </div>}
                {view === 'saved' && <SavedWalks library={library} profile={profile} pace={needs.speed_mps} onChange={changeLibrary} onReplan={replanPack} onFeedback={saveFeedback}
                    onUsePace={speed => { setNeeds(n => ({ ...n, speed_mps: speed })); setLibraryMessage('Your personal pace is selected for this walking profile.'); }} onShare={shareUpdate} />}
                {view === 'walk' && !walkSession && <div className="tg-stack"><h1 className="tg-h2">Ready when you are</h1><p className="tg-small">Choose and review a route first. During the walk you can pause, optionally record GPS, and save how it felt.</p><button className="tg-btn tg-btn-primary" onClick={() => { setView('plan'); setStep('where'); }}>Plan a walk</button></div>}

                {view === 'plan' && step === 'where' && (
                    <div className="tg-stack">
                        {suggestedPlaces.length > 0 && <div className="tg-suggestions" aria-label="Suggested destinations">
                            {suggestedPlaces.map(place => <button key={place.id} type="button" onClick={() => selectSearchResult(place)}><MapPin size={15} aria-hidden />{place.name}</button>)}
                        </div>}
                        <WeatherStrip weather={weather} now={planningNow} />
                        <WeatherWarningList feed={warningFeed} now={planningNow} />
                        {pilotData && area !== 'elmina' && <TransitNearby context={pilotData} assets={walkingData?.assets ?? []} origin={userCoords} at={planningTime}
                            onChoose={selectSearchResult} onFocus={focusWalkPoint} />}
                        <details className="tg-details">
                            <summary>Walking options and area data</summary>
                            <div className="tg-stack mt-3">
                                <div role="group" aria-label="Who is walking" className="grid grid-cols-2 gap-2">
                                    {(Object.keys(PROFILES) as Profile[]).map(p => <button key={p} type="button" aria-pressed={profile === p}
                                        className="tg-card tg-card-center" onClick={() => chooseProfile(p)}>
                                        {profile === p && <Check size={18} aria-hidden />}{PROFILES[p].label}
                                    </button>)}
                                </div>
                                {planningControls}
                                <PaceCalibration history={library.history} profile={profile} current={needs.speed_mps} onUse={speed => setNeeds(n => ({ ...n, speed_mps: speed }))} />
                                <div className="grid grid-cols-2 gap-2">{[15,30].map(n => <button className="tg-btn" key={n} onClick={() => planReturn(n)}>Return walk · {n} min</button>)}</div>
                                {destination && <button className="tg-btn tg-btn-primary" onClick={() => selectSearchResult(destination)}>Plan to {destination.name}</button>}
                                <PlaceDiscovery snapshot={planningSnapshot} request={toolRequest} budget={needs.budget_min} onChoose={selectSearchResult} />
                                <button type="button" className="tg-text-action text-left" onClick={() => setReloadVersion(version => version + 1)}>Refresh paths and checks</button>
                                <Link href={`/verification?area=${area}`} className="inline-flex min-h-11 items-center font-bold underline">Places and verification coverage</Link>
                                <PilotSources area={area} context={pilotData??undefined} />
                            </div>
                        </details>
                    </div>
                )}

                {view === 'plan' && step === 'route' && (
                    <div className="tg-stack">
                        <div className="tg-sheet-row">
                            <div className="min-w-0">
                                <h1 className="tg-h2">Choose a route</h1>
                                <p className="tg-small truncate">{returning ? 'Return to your starting point' : `To ${currentDest.name}`}</p>
                            </div>
                            <button type="button" aria-label="Close route options" className="tg-close" onClick={() => { setStep('where'); setPanelMinimized(false); }}><X size={21} aria-hidden /></button>
                        </div>
                        {loadingDb || journeySearch.pending ? (
                            <p className="tg-note" role="status">{loadingDb ? 'Loading footpaths…' : 'Finding walking routes…'}</p>
                        ) : !plan || !activeRoute ? (
                            <div className="tg-note tg-warnbox" role="status">
                                <RouteQualityBar />
                                {plan?.reasons.map(reason => <p key={reason} className="mt-2">{reason}</p>)}
                                {!plan && <p>{journeySearch.error || 'Choose a mapped place to plan a trip.'}</p>}
                            </div>
                        ) : (
                            <div role="group" aria-label="Route choices" className="tg-route-grid">
                                {visibleModes.map(mode => {
                                    const route = plan.routes[mode]!;
                                    const Icon = MODE_ICON[mode];
                                    return <button type="button" key={mode} aria-pressed={shownMode === mode}
                                        className="tg-route-card" onClick={() => { chooseMode(mode); setMapFocus(undefined); }}>
                                        <Icon size={18} aria-hidden />
                                        <strong>{mode === 'safest' && !isNight ? 'Crossings' : MODE_LABEL[mode]}</strong>
                                        <span>{minutesOf(route)} min</span>
                                    </button>;
                                })}
                            </div>
                        )}
                        {activeRoute && <div className="tg-route-note">
                            <RouteQualityBar route={activeRoute} best={shownMode === recommended} compact />
                            <p className="tg-small">{sameAsShortest ? 'Same path as Shortest · ' : ''}{reasonFor(shownMode, activeRoute, isNight)}</p>
                        </div>}
                        <button className="tg-btn tg-btn-primary" onClick={startWalk} disabled={loadingDb || journeySearch.pending || startingWalk || !activeRoute}>
                            <Navigation size={20} aria-hidden />{startingWalk ? 'Checking your route…' : 'Start walking'}
                        </button>
                        <details className="tg-details">
                            <summary>Route details and walking preferences</summary>
                            <div className="tg-stack mt-3">
                                {planningControls}
                                {!returning && entrances.length > 0 && <label className="tg-label">Arrival access point
                                    <select className="tg-input" value={entranceId} onChange={event => { setEntranceId(event.target.value); setChosenMode(null); }}>
                                        <option value="">Best available access point</option>
                                        {entrances.filter(entrance => entrance.edge_id !== null).map(entrance => <option key={entrance.id} value={entrance.id}>
                                            {entrance.name}{entrance.properties.osm_wheelchair === 'yes' ? ' · wheelchair access mapped' : ''}
                                        </option>)}
                                    </select>
                                </label>}
                                {activeRoute && <>
                                    <ComfortBreakdown route={activeRoute} edges={edges} records={walkingData?.verifications ?? []} night={isNight} />
                                    <WalkTimeline route={activeRoute} edges={edges} records={walkingData?.verifications ?? []} onFocus={focusWalkPoint} />
                                    <RouteDetails route={activeRoute} />
                                    <div className="grid grid-cols-2 gap-2">
                                        <button className="tg-btn" disabled={savingPack} onClick={() => void savePack()}><Bookmark size={18} aria-hidden />{savingPack ? 'Preparing…' : 'Save offline'}</button>
                                        <button className="tg-btn" onClick={openShare}><Share2 size={18} aria-hidden />Share plan</button>
                                        <button className="tg-btn" onClick={() => { if (walkingData) downloadPack(createWalkPack(activeRoute,profile,needs,userCoords,edges,walkingData,undefined,networkSnapshot)); }}>Download walk pack</button>
                                        {canSpeak && <button className="tg-btn" onClick={readRouteAloud}><Volume2 size={18} aria-hidden />Read aloud</button>}
                                    </div>
                                </>}
                                <WalkingConditions night={isNight} forecast={forecast} onCompare={mode => { setChosenMode(mode); setStep('route'); }}
                                    onInspectCover={() => { setInformationLayer('cover'); if (plan?.routes.sheltered) chooseMode('sheltered'); }} />
                                {quickUpdate}
                            </div>
                        </details>
                    </div>
                )}

                {/* STEP 3: walking */}
                {walkSession && <div style={{ display: view === 'walk' ? 'block' : 'none' }}>
                    <WalkRecorder key={walkSession.id} session={walkSession} onComplete={finishRecording} onFeedback={saveFeedback} onPosition={setLivePoint}
                        onNewWalk={() => { setWalkSession(null); setLivePoint(null); setView('plan'); setStep('where'); setPanelMinimized(false); }} />
                    {!sessionFinished && <div className="tg-stack mt-4">
                        <details className="rounded-xl border border-slate-300 p-3"><summary className="min-h-8 cursor-pointer font-bold">Your original walk plan</summary><p className="tg-small mt-2">Planned at {new Date(walkSession.pack.route.departure_at).toLocaleTimeString('en-MY',{timeZone:'Asia/Kuala_Lumpur',hour:'2-digit',minute:'2-digit'})} Malaysia time. This plan stays fixed while you record; pause and review if conditions change.</p><RouteQualityBar route={walkSession.pack.route} /><WalkTimeline route={walkSession.pack.route} edges={walkSession.pack.edges} records={walkingData?.verifications ?? []} onFocus={focusWalkPoint} /></details>
                        {quickUpdate}
                        <button className="tg-btn" onClick={openReport}><AlertTriangle size={22} aria-hidden />Report a hazard</button>
                        <div className="grid grid-cols-2 gap-2"><button className="tg-btn" onClick={openShare}><Share2 size={20} aria-hidden />Share</button><a className="tg-btn" href={`tel:${EMERGENCY_NUMBER}`}><Phone size={20} aria-hidden />Call for help</a></div>
                    </div>}
                </div>}
                </div>
            </section>
            <nav className="tg-tabs" aria-label="Walking sections">{([
                ['explore','Explore',Compass],['plan','Plan',RouteIcon],['walk','Walk',Navigation],['saved','Saved',Bookmark],
            ] as const).map(([id, label, Icon]) => <button key={id} aria-current={view === id ? 'page' : undefined} onClick={() => {
                setView(id);
                setSearchOpen(false);
                setPanelMinimized(id === 'walk' && id !== view && !!walkSession && !sessionFinished);
                if (id === 'plan' && step === 'walking') setStep('route');
                requestAnimationFrame(() => document.getElementById('walk-planning')?.focus({ preventScroll: true }));
            }}><Icon size={21} aria-hidden />{label}{id === 'walk' && walkSession && !sessionFinished ? ' •' : ''}</button>)}<button type="button" onClick={openReport}><AlertTriangle size={21} aria-hidden />Reports</button></nav>

            {/* ---------------- Dialogs ---------------- */}

            {showStartPicker && (
                <Sheet title="Choose a starting point" onClose={() => setShowStartPicker(false)}>
                    <div className="tg-stack">
                        <button type="button" className="tg-btn" onClick={handleGetLocation} disabled={geoBusy}>
                            <LocateFixed size={19} aria-hidden />{geoBusy ? 'Finding your location…' : 'Use my location'}
                        </button>
                        {geoMsg && <p className="tg-note tg-warnbox" role="status">{geoMsg}</p>}
                        {startPoints.length > 0 ? (
                            <ul className="tg-start-list" aria-label="Mapped starting points">
                                {startPoints.map(point => <li key={point.id}>
                                    <button type="button" className="tg-card" aria-pressed={!usingGPS && selectedStart?.id === point.id}
                                        onClick={() => chooseStart(point)}>
                                        {point.id === 'area-start' ? <CircleDot size={18} aria-hidden /> : <MapPin size={18} aria-hidden />}
                                        <span>{point.label}</span>
                                        {!usingGPS && selectedStart?.id === point.id && <Check size={18} aria-hidden />}
                                    </button>
                                </li>)}
                            </ul>
                        ) : <p className="tg-small" role="status">{loadingDb ? 'Loading mapped starting points…' : 'Starting points are unavailable.'}</p>}
                    </div>
                </Sheet>
            )}

            {showSettings && (
                <Sheet title="Text and display" onClose={() => setShowSettings(false)}>
                    <div className="tg-stack">
                        <p className="tg-label">Text size</p>
                        <div role="radiogroup" aria-label="Text size" className="grid grid-cols-3 gap-2">
                            {([['normal', 'Normal'], ['large', 'Large'], ['xlarge', 'Extra large']] as [TextScale, string][]).map(([v, label]) => (
                                <button
                                    key={v}
                                    role="radio"
                                    aria-checked={prefs.scale === v}
                                    className="tg-card tg-card-center"
                                    style={{ padding: '.6rem .4rem' }}
                                    onClick={() => setPref('scale', v)}
                                >
                                    {label}
                                </button>
                            ))}
                        </div>

                        <SettingSwitch
                            label="High contrast"
                            hint="Black text, white background, thicker borders"
                            checked={prefs.highContrast}
                            onChange={(v) => setPref('highContrast', v)}
                        />
                        <SettingSwitch
                            label="Reduce movement"
                            hint="The map jumps instead of gliding"
                            checked={prefs.reduceMotion}
                            onChange={(v) => setPref('reduceMotion', v)}
                        />
                        <SettingSwitch
                            label="Vibrate when I tap"
                            hint="A short buzz to confirm a tap"
                            checked={prefs.vibrate}
                            onChange={(v) => setPref('vibrate', v)}
                        />
                        {canSpeak && (
                            <SettingSwitch
                                label="Speak updates"
                                hint="Says out loud when your walk starts, ends or a report is sent"
                                checked={prefs.speak}
                                onChange={(v) => setPref('speak', v)}
                            />
                        )}
                        <p className="tg-small" style={{ margin: 0 }}>Your choices are saved on this device.</p>
                    </div>
                </Sheet>
            )}

            {showShare && (
                <Sheet title="Share your walk" onClose={() => setShowShare(false)}>
                    <div className="tg-stack">
                        <p className="tg-note" style={{ margin: 0, userSelect: 'text' }}>
                            {shareMessage}
                            <br />
                            <span style={{ wordBreak: 'break-all', fontWeight: 500 }}>{shareUrl}</span>
                        </p>

                        <a
                            className="tg-btn tg-btn-wa"
                            href={`https://wa.me/?text=${encodeURIComponent(`${shareMessage} ${shareUrl}`)}`}
                            target="_blank"
                            rel="noopener noreferrer"
                        >
                            <MessageCircle size={24} aria-hidden /> Send on WhatsApp
                        </a>

                        {canShare && (
                            <button className="tg-btn" onClick={nativeShare}>
                                <Share2 size={22} aria-hidden /> More ways to share
                            </button>
                        )}

                        <button className="tg-btn" onClick={copyShare}>
                            {copied ? <Check size={22} aria-hidden /> : <Copy size={22} aria-hidden />}
                            {copied ? 'Copied' : 'Copy message'}
                        </button>

                        <div role="status" aria-live="polite">
                            {copied && <p className="tg-note" style={{ margin: 0 }}>Copied. You can paste it into any chat.</p>}
                            {shareNote && <p className="tg-note tg-warnbox" style={{ margin: 0 }}>{shareNote}</p>}
                        </div>

                        <p className="tg-small" style={{ margin: 0 }}>
                            Whoever opens the link sees the same route you chose. It does not track you live.
                        </p>
                    </div>
                </Sheet>
            )}

            {showReportModal && (
                <Sheet title="Report a hazard" onClose={() => setShowReportModal(false)}>
                    <form className="tg-stack" onSubmit={event => { event.preventDefault(); void submitCapexDefect(); }}>
                        <p className="tg-small">{IS_PAGES_PREVIEW ? 'Reports are saved on this device.' : 'Reports go to the maintenance queue for this walking area.'}</p>
                        <fieldset>
                            <legend className="tg-label mb-2">What’s the hazard?</legend>
                            <div className="tg-report-categories">
                                {HAZARD_OPTIONS.map(({ kind, label, Icon }) => <label key={kind}>
                                    <input className="sr-only" type="radio" name="report-kind" value={kind} checked={selectedKind === kind}
                                        onChange={() => { setSelectedKind(kind); buzz(); }} />
                                    <span><Icon size={18} aria-hidden />{label}</span>
                                </label>)}
                            </div>
                        </fieldset>
                        <div className="tg-report-location">
                            <p className="tg-label">Incident location</p>
                            <p className="flex items-center gap-2 text-sm"><MapPin size={18} aria-hidden />
                                {reportPoint ? reportEdge ? `${reportEdge.name || 'Mapped footpath'} · ${reportPoint.map(value => value.toFixed(5)).join(', ')}`
                                    : 'Choose a point near a mapped path in this area.' : 'Choose where you saw the hazard.'}
                            </p>
                            <div className="grid grid-cols-2 gap-2">
                                <button type="button" className="tg-btn" onClick={() => { setShowReportModal(false); if (view === 'saved') setView('plan'); setPickingHazard(true); }}>Pick on map</button>
                                <button type="button" className="tg-btn" disabled={reportLocated} onClick={locateReport}>{reportLocated ? 'Finding…' : 'My location'}</button>
                            </div>
                        </div>
                        <HazardPhotoInput photo={reportPhoto} onPhoto={setReportPhoto} onReading={applyPhotoReading}
                            kindLabel={kind => HAZARD_OPTIONS.find(option => option.kind === kind)?.label ?? 'a hazard'} />
                        {reportPhoto && !IS_PAGES_PREVIEW && <p className="tg-small">The photo helps fill in this form; only the details are sent with the report for now.</p>}
                        <label className="tg-label">Details (optional)<textarea className="tg-input mt-1" value={reportNotes} maxLength={500}
                            onChange={event => setReportNotes(event.target.value)} placeholder="For example, a loose slab beside the crossing" /></label>
                        {reportMsg && <p className="tg-note" role="status">{reportMsg}</p>}
                        <button type="submit" className="tg-btn tg-btn-primary" disabled={loadingDb || isSubmittingReport || !reportEdge}>
                            <Send size={18} aria-hidden /> {isSubmittingReport ? 'Saving…' : IS_PAGES_PREVIEW ? 'Save report' : 'Submit report'}
                        </button>
                    </form>
                    {(IS_PAGES_PREVIEW ? deviceHazards.length > 0 : reports.length > 0) && <details className="tg-details mt-3" open={Boolean(reportMsg)}>
                        <summary>{IS_PAGES_PREVIEW ? `Saved on this device (${deviceHazards.length})` : `Open area reports (${reports.length})`}</summary>
                        <ul className="tg-report-list">
                            {(IS_PAGES_PREVIEW ? deviceHazards : reports).map((report, index) => <li key={report.id ?? index}>
                                {/* eslint-disable-next-line @next/next/no-img-element -- photo stored on this device as a data URL */}
                                {'photo' in report && typeof report.photo === 'string' && <img className="tg-report-photo" src={report.photo} alt="" />}
                                <strong>{report.category || 'Reported hazard'}</strong>
                                {report.description && <p>{report.description}</p>}
                                {'location' in report && typeof report.location === 'string' && <p>{report.location}</p>}
                                {IS_PAGES_PREVIEW && <button type="button" className="tg-text-action" onClick={() => {
                                    try { updateDeviceHazards(deviceHazards.filter(saved => saved.id !== report.id)); }
                                    catch { setReportMsg('Could not remove the saved report.'); }
                                }}>Remove from device</button>}
                            </li>)}
                        </ul>
                    </details>}
                </Sheet>
            )}

        </div>
    );
}

function ResidentPageWithParams() {
    const searchParams = useSearchParams();
    const ready = useClientReady();
    const area=pilotFromParams(searchParams);
    if(!isPilotAvailable(area))return <PilotUnavailable area={area}/>;
    return ready ? <ResidentPageContent key={searchParams.toString()} /> : <div role="status">Loading your walk…</div>;
}

export default function ResidentPage() {
    return (
        <Suspense fallback={<div role="status" style={{ padding: '1.5rem', textAlign: 'center', fontSize: '1rem', fontWeight: 700, color: '#444B55' }} className="font-sans">Loading your walk…</div>}>
            <ResidentPageWithParams />
        </Suspense>
    );
}
