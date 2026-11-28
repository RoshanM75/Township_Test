'use client';

import { useCallback, useEffect, useMemo, useRef, useState, Suspense } from 'react';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { useSearchParams,useRouter } from 'next/navigation';
import {
    MapPin, Navigation, LocateFixed, CloudRain, Sun, X, Send, Share2, Check, ChevronDown, CircleDot,
    Footprints, Lightbulb, Ban, Accessibility, ChevronRight, ShieldCheck, Armchair, ArrowUpRight, Thermometer,
    AlertTriangle, Phone, MessageCircle, Copy, Volume2, Compass, Bookmark, Route as RouteIcon, ClipboardList, UserRound, SlidersHorizontal, LockKeyhole,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { loadGraph as fetchGraph, loadHazards, loadReports, submitReport, loadWalkingData, loadWeather, loadWeatherWarnings, loadPilotContext, loadCommunityRoutes } from '@/lib/api';
import { IS_PAGES_PREVIEW, sitePath } from '@/lib/site';
import type { MaintenanceDefect } from '@/lib/types';
import { useClientReady } from '@/lib/use-client-ready';
import { readSharedDeparture, readWalkParameters } from '@/lib/walk-parameters';
import { DESTINATIONS } from '@/lib/precinct';
import { evidenceFor, malaysiaHour } from '@/lib/verification';
import { forecastAt, malaysiaInput, fromMalaysiaInput, type WalkingWeather } from '@/lib/comfort';
import { WALK_BUDGETS, type WalkingData, type WalkingAsset, type JourneyPlan } from '@/lib/walking';
import RouteQualityBar from '@/components/walking/RouteQualityBar';
import { WalkingProfilePanel, WalkingProfileSetup, WalkingProfileEditor, compactWalkingSummary } from '@/components/walking/WalkingProfile';
import type { FrequentPlace } from '@/lib/profile-activity';
import { newDeviceWalkingProfile, normaliseWalkingSettings, readDeviceWalkingProfile, writeDeviceWalkingProfile, sharedWalkingSettings, sharedWalkBudget, type WalkingSettings, type DeviceWalkingProfile } from '@/lib/walking-profile';
import DepartureControl from '@/components/walking/DepartureControl';
import DepartureOptions from '@/components/walking/DepartureOptions';
import { solarModel, type ShadeDataset } from '@/lib/solar-shade';
import { SHADE_CHANGES, shadeChangeLabel, type ShadeChange } from '@/lib/shade-corrections';
import { spotDetails } from '@/lib/shade-display';
import type { SearchCommand } from '@/lib/planning-dispatch';
import RouteDetails from '@/components/walking/RouteDetails';
import PlaceDiscovery from '@/components/walking/PlaceDiscovery';
import WalkingConditions from '@/components/walking/WalkingConditions';
import JourneyReadiness, { JourneyBarriers } from '@/components/walking/JourneyReadiness';
import UsualRoutes, { UsualRouteForm } from '@/components/walking/UsualRoutes';
import GroupWalk from '@/components/walking/GroupWalk';
import ErrandPlanner, { ErrandItinerary } from '@/components/walking/ErrandPlanner';
import { errandRequestFromRoute, readErrands, type ErrandRequest } from '@/lib/errand-planner';
import { journeyReadiness } from '@/lib/journey-readiness';
import { inspectRoutine, type RoutineFeed } from '@/lib/usual-routes';
import { useRoutineFeeds } from '@/lib/use-routine-feeds';
import { CONDITION_LABELS,type RouteBarrier } from '@/lib/route-conditions';
import { observationFields } from '@/lib/verification-fields';
import ComfortBreakdown from '@/components/walking/ComfortBreakdown';
import type { EnvironmentLayer } from '@/lib/environment';
import {
    buildGraph, nearestEdge, slotForHour,
    type Mode, type TimeSlot, type PathNode, type PathEdge,
    type HazardReport, type HazardKind, type RouteResult,
} from '@/lib/routing';
import { createWalkPack, emptyLibrary, readLibrary, writeLibrary, readWalkDraft, withPersonalUpdates,
    type WalkLibrary, type WalkPack, type ConditionUpdate, type CompletedWalk, type WalkFeedback, type WalkSession } from '@/lib/walk-library';
import { emptyTrack } from '@/lib/walk-tracking';
import { downloadPack, enableOfflineViewer } from '@/lib/offline-walk';
import ExploreWalks from '@/components/walking/ExploreWalks';
import ExploreShortcuts, { ReturnWalkCard, type ExploreTask } from '@/components/walking/ExploreShortcuts';
import SavedWalks from '@/components/walking/SavedWalks';
import WalkRecorder from '@/components/walking/WalkRecorder';
import WalkTimeline from '@/components/walking/WalkTimeline';
import QuickConditionUpdate from '@/components/walking/QuickConditionUpdate';
import PilotSelector from '@/components/walking/PilotSelector';
import PilotSources from '@/components/walking/PilotSources';
import PilotUnavailable from '@/components/walking/PilotUnavailable';
import { PILOTS,pilotFromParams,isPilotAvailable,pointInPilot,type PilotId,type PilotContext } from '@/lib/pilots';
import { usePlannerResult } from '@/lib/use-planner';
import { metres, pointAt, projectPoint } from '@/lib/walking-geometry';
import CommunityRoutes from '@/components/walking/CommunityRoutes';
import type { CommunityRoute } from '@/lib/community-routes';
import { checkedRouteReports } from '@/lib/report-status';
import { malaysiaTimeLabel, residentText, type ResidentLabel, type ResidentLanguage } from '@/lib/resident-language';
import { residentPlaceName, ROUTE_MODES, routeLabel, routeRoofLines, searchResidentPlaces, walkWeather } from '@/lib/resident-walking';
import { transitApproachAssets } from '@/lib/transit';


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
import NearbyFacilities from '@/components/resident/NearbyFacilities';
import ReportHistory, { issueLabel, type DeviceReport } from '@/components/resident/ReportHistory';
import RouteComparison, { RouteChecks, RouteCoverage, RouteSun } from '@/components/resident/RouteComparison';
import { photoDescription, type PhotoReading } from '@/lib/photo-hazard';
import './resident.css';
import './experience.css';

/* ------------------------------------------------------------------ */
/* Constants                                                           */
/* ------------------------------------------------------------------ */

const EMERGENCY_NUMBER = '999'; // Malaysia. Remove the "Call for help" button if you don't want it.

const HAZARD_OPTIONS: { kind: HazardKind; Icon: LucideIcon }[] = [
    { kind: 'blocked', Icon: Ban },
    { kind: 'lift_out', Icon: Accessibility },
    { kind: 'broken_surface', Icon: AlertTriangle },
    { kind: 'light_out', Icon: Lightbulb },
    { kind: 'no_ramp', Icon: Accessibility },
    { kind: 'no_shade', Icon: Sun },
    { kind: 'shade_correction', Icon: Sun },
    { kind: 'details_outdated', Icon: MapPin },
    { kind: 'check_requested', Icon: ClipboardList },
];

interface DeviceHazard extends DeviceReport {
    lat: number;
    lng: number;
    dataset: string | undefined;
    edge_id?: number;
    asset_id?: string;
}
const hazardKey = (area: PilotId) => `townshipgo:hazards:v1:${area}`;
const receiptKey = (area: PilotId) => `townshipgo:report-receipts:v1:${area}`;
function readReportReceipts(area: PilotId): Record<string, string | true> {
    try {
        const stored = JSON.parse(localStorage.getItem(receiptKey(area)) ?? '{}');
        const valid: Record<string, string | true> = {};
        for (const [id, value] of Object.entries(stored)) {
            if (/^\d+$/.test(id) && (value === true || (typeof value === 'string' && value.startsWith('data:image/jpeg;base64,')))) valid[id] = value;
        }
        return valid;
    } catch { return {}; }
}
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
type Prefs = { mapMode: MapMode; scale: TextScale; highContrast: boolean; reduceMotion: boolean; vibrate: boolean; speak: boolean; language: ResidentLanguage; showActivity: boolean; showFrequentPlaces: boolean };

const DEFAULT_PREFS: Prefs = { mapMode: '3d', scale: 'normal', highContrast: false, reduceMotion: false, vibrate: true, speak: false, language: 'en', showActivity: true, showFrequentPlaces: true };
const PREFS_KEY = 'townshipgo:prefs';
const COMMUNITY_ID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
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

/* ------------------------------------------------------------------ */
/* Small shared components                                             */
/* ------------------------------------------------------------------ */

function Sheet({ title, onClose, children, language = 'en' }: { title: string; onClose: () => void; children: ReactNode; language?: ResidentLanguage }) {
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
                <div className="tg-dialog-heading">
                    <h2 className="tg-h2">{title}</h2>
                    <button type="button" className="tg-close" aria-label={residentText(language, 'Close')} onClick={onClose}><X size={20} aria-hidden /></button>
                </div>
                {children}
            </div>
        </dialog>
    );
}

function SettingSwitch({ label, hint, checked, onChange, language }: {
    label: string; hint: string; checked: boolean; onChange: (v: boolean) => void; language: ResidentLanguage;
}) {
    return (
        <button role="switch" aria-checked={checked} className="tg-card" onClick={() => onChange(!checked)}>
            <span style={{ flex: 1 }}>
                <span style={{ display: 'block', fontWeight: 800 }}>{label}</span>
                <span className="tg-small" style={{ display: 'block' }}>{hint}</span>
            </span>
            <span className="tg-state">{residentText(language, checked ? 'On' : 'Off')}</span>
        </button>
    );
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

function ResidentPageContent() {
    const searchParams = useSearchParams();
    const router=useRouter();
    const openingShared = ['destId', 'startLat', 'community', 'shortcut', 'return', 'errands', 'startAsset', 'replan'].some(key => searchParams.has(key));
    const [boot]=useState(()=>{
        try {const collection=readLibrary(localStorage),draft=readWalkDraft(localStorage);const active=draft&&!collection.library.history.some(w=>w.id===draft.id)?draft:null;
            return {collection,draft:active,area:active&&!openingShared?(active.pack.area_id??'elmina'):pilotFromParams(searchParams)};
        }catch{return {collection:{library:emptyLibrary(),warning:'Device storage is unavailable. You can still plan and download walk packs.'},draft:null,area:pilotFromParams(searchParams)};}
    });
    const area=boot.area,configuration=PILOTS[area];
    const initialWalk = readWalkParameters(searchParams, area==='elmina'?DESTINATIONS.map(d=>d.id):[], configuration.centre);
    const initialReplan = boot.collection.library.packs.find(pack => pack.id === searchParams.get('replan') && (pack.area_id ?? 'elmina') === area);
    const initialStartAsset=initialReplan?.route.start_asset_id ?? searchParams.get('startAsset') ?? undefined;
    const entryLinkResolved=useRef(false);
    const initialOriginUsed=useRef(initialWalk.fromLink || !!initialReplan || !!initialStartAsset);

    const [userCoords, setUserCoords] = useState<[number, number]>(initialReplan?.origin ?? initialWalk.origin);
    const [startAssetId, setStartAssetId]=useState<string|undefined>(initialStartAsset);
    const [conditionFetchedAt,setConditionFetchedAt]=useState<string|null>(null);
    const [conditionUnavailable,setConditionUnavailable]=useState(false);
    const [usingGPS, setUsingGPS] = useState(false);
    const [geoBusy, setGeoBusy] = useState(false);
    const [geoMsg, setGeoMsg] = useState<string | null>(null);
    const [destId, setDestId] = useState<string>(initialReplan ? initialReplan.route.destination.external_id || initialReplan.route.destination.id : searchParams.get('destId') || initialWalk.destination || '');
    const [placeQuery, setPlaceQuery] = useState('');
    const [searchOpen, setSearchOpen] = useState(false);
    const [searchIndex,setSearchIndex]=useState(-1);
    const [showStartPicker, setShowStartPicker] = useState(false);
    const [startQuery, setStartQuery] = useState('');
    const [pilotData,setPilotData]=useState<PilotContext|null>(null);
    const [startingWalk,setStartingWalk]=useState(false);
    const [deviceProfile, setDeviceProfile] = useState(() => {
        try { return readDeviceWalkingProfile(localStorage); } catch { return newDeviceWalkingProfile(); }
    });
    const [tripProfile, setTripProfile] = useState<WalkingSettings | null>(() => {
        const replan = boot.collection.library.packs.find(pack => pack.id === searchParams.get('replan') && (pack.area_id ?? 'elmina') === area);
        return replan ? normaliseWalkingSettings(replan.profile, replan.needs) : sharedWalkingSettings(searchParams, deviceProfile.settings);
    });
    const activeWalkingSettings = tripProfile ?? deviceProfile.settings;
    const { profile, needs } = activeWalkingSettings;

    const [initialTime] = useState(() => new Date().toISOString());
    const [planningNow,setPlanningNow]=useState(initialTime);
    const [departure, setDeparture] = useState(() => readSharedDeparture(searchParams.get('departure')));
    const [entranceId, setEntranceId] = useState(initialReplan && !initialReplan.route.return_walk && !initialReplan.route.errand_stops ? initialReplan.route.entrance.id : searchParams.get('entrance') || '');
    const [sourceWalkingData, setWalkingData] = useState<WalkingData | null>(null);
    const [networkSnapshot, setNetworkSnapshot] = useState<string | null>(null);
    const [exactDestination, setExactDestination] = useState<string | null>(initialReplan?.route.destination.name ?? (searchParams.get('destId')?'Requested place':null));
    const [nodes, setNodes] = useState<PathNode[]>([]);
    const [edges, setEdges] = useState<PathEdge[]>([]);
    const [hazards, setHazards] = useState<HazardReport[]>([]);
    const [reports, setReports] = useState<MaintenanceDefect[]>([]);
    const [communityRoutes, setCommunityRoutes] = useState<CommunityRoute[]>([]);
    const [communityId, setCommunityId] = useState(() => {
        const value = initialReplan?.route.community_id ?? searchParams.get('community');
        return value && COMMUNITY_ID.test(value) ? value.toLowerCase() : null;
    });
    const [communityVersion, setCommunityVersion] = useState(0);
    const sharedShortcut = searchParams.get('shortcut');
    const shortcutId = sharedShortcut && COMMUNITY_ID.test(sharedShortcut) ? sharedShortcut.toLowerCase() : undefined;
    const [showCommunity, setShowCommunity] = useState(Boolean(shortcutId));
    const [shortcutWalk, setShortcutWalk] = useState<CompletedWalk>();
    const [showNearby, setShowNearby] = useState(false);
    const [showDiscovery,setShowDiscovery]=useState(false);
    const [showTransit,setShowTransit]=useState(false);
    const [showFacilities,setShowFacilities]=useState(false);
    const [showWeather,setShowWeather]=useState(false);
    const [routePanel,setRoutePanel]=useState<'routes'|'access'|'settings'>('routes');

    const [loadingDb, setLoadingDb] = useState(true);
    const [dataError, setDataError] = useState(false);
    const [reloadVersion, setReloadVersion] = useState(0);

    const [shadeData, setShadeData] = useState<ShadeDataset>();
    const shadeModel = useMemo(() => shadeData && solarModel(shadeData), [shadeData]);
    const [weather, setWeather] = useState<WalkingWeather | null>(null);
    const [warningFeed, setWarningFeed] = useState<WeatherWarnings | null>(null);
    const [chosenMode, setChosenMode] = useState<Mode | null>(initialWalk.mode);
    const [errands,setErrands]=useState<ErrandRequest|null>(()=>initialReplan ? errandRequestFromRoute(initialReplan.route) : readErrands(searchParams.get('errands')));
    const [showErrands,setShowErrands]=useState(false);
    const [groupMembers,setGroupMembers]=useState<WalkingSettings[]>([]);
    const [groupBase,setGroupBase]=useState<WalkingSettings|null>(null);
    const [showGroup,setShowGroup]=useState(false);
    const [showUsual,setShowUsual]=useState(false);
    const [routineEditId,setRoutineEditId]=useState(initialReplan?.routine ? initialReplan.id : null);
    const [routineRefresh,setRoutineRefresh]=useState(0);
    const [step, setStep] = useState<Step>(initialReplan||initialWalk.fromLink||searchParams.get('destId')||communityId||errands ? 'route' : 'where');
    const initialLibrary=boot.collection;
    const [library, setLibrary] = useState<WalkLibrary>(initialLibrary.library);
    const libraryRef = useRef(library);
    const [libraryMessage, setLibraryMessage] = useState<string | null>(initialLibrary.warning);
    const [walkSession, setWalkSession] = useState<WalkSession | null>(boot.draft);
    const [sessionFinished, setSessionFinished] = useState(false);
    const [view, setView] = useState<'plan' | 'walk' | 'saved' | 'profile'>(walkSession && !openingShared ? 'walk' : 'plan');
    const panelBodyRef=useRef<HTMLDivElement>(null);
    const sheetRef=useRef<HTMLElement>(null);
    useEffect(()=>{ if(panelBodyRef.current)panelBodyRef.current.scrollTop=0; if(sheetRef.current)sheetRef.current.scrollTop=0; },[view,step,routePanel]);
    const [returning, setReturning] = useState(initialReplan?.route.return_walk ?? searchParams.get('return') === '1');
    const [budgetOverride, setBudgetOverride] = useState<number | null>(() => sharedWalkBudget(searchParams) ?? tripProfile?.needs.budget_min ?? null);
    const [savingPack, setSavingPack] = useState(false);
    const [panelState, setPanelState] = useState<PanelState>(()=>window.matchMedia('(min-width:1024px)').matches?'open':'min');
    const panelMinimized = panelState === 'min';
    const setPanelMinimized = (minimized: boolean) => setPanelState(minimized&&!window.matchMedia('(min-width:1024px)').matches?'min':'open');
    const [livePoint, setLivePoint] = useState<[number, number] | null>(null);
    const [mapFocus, setMapFocus] = useState<[number, number] | undefined>();

    // Hazard reporting
    const [showReportModal, setShowReportModal] = useState(false);
    const [showReportHistory, setShowReportHistory] = useState(false);
    const [reportReceipts, setReportReceipts] = useState(() => readReportReceipts(area));
    const [pickingHazard, setPickingHazard] = useState(false);
    const [requestedField,setRequestedField]=useState<string|undefined>();
    const [reportEdgeId, setReportEdgeId] = useState<number | null>(null);
    const [observedTime, setObservedTime] = useState('');
    const [shadeChange, setShadeChange] = useState<ShadeChange | ''>('');
    const [reportAsset, setReportAsset] = useState<WalkingAsset | null>(null);
    const [reportPoint, setReportPoint] = useState<[number, number] | null>(null);
    const [reportLocated, setReportLocated] = useState(false);
    const [deviceHazards, setDeviceHazards] = useState(() => readDeviceHazards(area));
    const [informationLayer, setInformationLayer] = useState<EnvironmentLayer | 'routes'>(searchParams.get('layer') === 'shade' ? 'shade' : 'routes');
    const [selectedKind, setSelectedKind] = useState<HazardKind | null>(null);
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
        return { ...DEFAULT_PREFS,
            mapMode: stored?.mapMode === '2d' ? '2d' : '3d',
            scale: stored?.scale === 'large' || stored?.scale === 'xlarge' ? stored.scale : 'normal',
            highContrast: stored?.highContrast === true,
            reduceMotion: typeof stored?.reduceMotion === 'boolean' ? stored.reduceMotion : systemReduce,
            vibrate: stored?.vibrate !== false,
            speak: stored?.speak === true,
            language: stored?.language === 'ms' ? 'ms' : 'en',
            showActivity: stored?.showActivity !== false,
            showFrequentPlaces: stored?.showFrequentPlaces !== false,
        };
    });
    const language = prefs.language === 'ms' ? 'ms' : 'en';
    const t = (label: ResidentLabel) => residentText(language, label);
    const [showSettings, setShowSettings] = useState(false);
    const [showProfileSetup, setShowProfileSetup] = useState(() => deviceProfile.status === 'new' && !openingShared && !boot.draft);
    const [profileEditor, setProfileEditor] = useState<'default' | 'trip' | null>(null);
    const [showProfilePrivacy, setShowProfilePrivacy] = useState(false);
    const [profileMessage, setProfileMessage] = useState<ResidentLabel | null>(null);
    const [showShare, setShowShare] = useState(false);
    const [shareBaseUrl, setShareBaseUrl] = useState('');
    const [shareSettings, setShareSettings] = useState<WalkingSettings | null>(null);
    const [sharePreferences, setSharePreferences] = useState(false);
    const shareUrl = useMemo(() => {
        if (!shareBaseUrl || !sharePreferences || !shareSettings) return shareBaseUrl;
        const link = new URL(shareBaseUrl);
        link.searchParams.set('profile', shareSettings.profile);
        link.searchParams.set('needs', JSON.stringify(shareSettings.needs));
        return link.toString();
    }, [shareBaseUrl, sharePreferences, shareSettings]);
    const [copied, setCopied] = useState(false);
    const [shareNote, setShareNote] = useState<string | null>(null);
    const canShare = typeof navigator.share === 'function';
    const canSpeak = 'speechSynthesis' in window;

    /* ---------- Preferences ---------- */
    useEffect(() => {
        if (!profileMessage || profileMessage === 'Device storage could not save your profile. These choices work for this visit only.') return;
        const timer = setTimeout(() => setProfileMessage(null), 4500);
        return () => clearTimeout(timer);
    }, [profileMessage]);

    useEffect(() => {
        try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch { /* ignore */ }
    }, [prefs]);

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
        u.lang = language === 'ms' ? 'ms-MY' : 'en-MY';
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

        let mappedContext: PilotContext | null = null;
        let loadedDataset: string | undefined;
        // Resolve an entrance-only incoming link once, not on subsequent refreshes.
        let refreshing=false;

        async function loadGraph() {
            try {
                const [graphData, hazardData, reportData, walking,context] = await Promise.all([
                    fetchGraph(area), loadHazards(area), loadReports('all',area), loadWalkingData(area),loadPilotContext(area),
                ]);
                if (cancelled) return;
                const mapped = withMappedDetails(graphData.edges, { ...walking,
                    area_id: area, dataset_id: walking.dataset_id ?? graphData.source.dataset_id }, context);
                mappedContext = context;
                loadedDataset = walking.dataset_id ?? graphData.source.dataset_id;
                setPilotData(context);
                if(!entryLinkResolved.current && initialStartAsset) {
                    const start=mapped.walking.assets.find(a=>a.id===initialStartAsset && a.edge_id!==null);
                    if(start && !initialReplan && !initialWalk.fromLink) setUserCoords([start.lat,start.lng]);
                    entryLinkResolved.current=true;
                }
                if(!initialOriginUsed.current){setUserCoords(graphData.source.origin?.coordinates??context.origin.coordinates);initialOriginUsed.current=true;}
                setNodes(graphData.nodes);
                setNetworkSnapshot(graphData.source.snapshot_at ?? null);
                setWalkingData(mapped.walking);
                setEdges(mapped.edges);
                setHazards(hazardData.hazards);
                setReports(reportData.reports);
                setDataError(false);
                setConditionFetchedAt(new Date().toISOString()); setConditionUnavailable(false);
            } catch (error) {
                if (!cancelled) {
                    console.error("Could not load pedestrian data:", error);
                    setDataError(true); setConditionUnavailable(true);
                }
            } finally {
                if (!cancelled) setLoadingDb(false);
            }
        }

        async function refreshReports() {
            if(refreshing || cancelled || document.hidden) return;
            refreshing=true;
            try {
                const [live, queue, data] = await Promise.all([loadHazards(area), loadReports('all', area), loadWalkingData(area)]);
                if (!cancelled) {
                    if (loadedDataset && data.dataset_id && loadedDataset!==data.dataset_id) {
                        await loadGraph();
                        return;
                    }
                    setHazards(previous => JSON.stringify(previous) === JSON.stringify(live.hazards) ? previous : live.hazards);
                    setReports(previous => JSON.stringify(previous) === JSON.stringify(queue.reports) ? previous : queue.reports);
                    if (mappedContext) {
                        const mapped=withMappedDetails([],data,mappedContext).walking;
                        setWalkingData(previous => previous && JSON.stringify({...previous,as_of:''})===JSON.stringify({...mapped,as_of:''}) ? previous : mapped);
                    }
                    setConditionFetchedAt(new Date().toISOString()); setConditionUnavailable(false);
                }
            } catch { if(!cancelled)setConditionUnavailable(true); }
            finally { refreshing=false; }
        }
        const onVisible=()=>{if(!document.hidden && !IS_PAGES_PREVIEW)void refreshReports();};
        document.addEventListener('visibilitychange',onVisible);
        void refreshWeather();
        void refreshWarnings();
        void loadGraph();
        const timer = window.setInterval(refreshWeather, 15 * 60 * 1000);
        const warningTimer = window.setInterval(refreshWarnings, 5 * 60 * 1000);
        const reportTimer = IS_PAGES_PREVIEW ? undefined : window.setInterval(refreshReports, 30000);
        return () => {
            cancelled = true;
            window.clearInterval(timer);
            window.clearInterval(warningTimer);
            window.clearInterval(reportTimer);
            document.removeEventListener('visibilitychange',onVisible);
        };
    }, [reloadVersion,area,initialReplan,initialStartAsset,initialWalk.fromLink]);

    useEffect(() => {
        const controller = new AbortController();
        fetch(sitePath(`/map-area/${area}-shade.json`), { signal: controller.signal }).then(response => {
            if (!response.ok) throw new Error('Shade model unavailable');
            return response.json() as Promise<ShadeDataset>;
        }).then(data => { if (!controller.signal.aborted) setShadeData(data); }).catch(() => { /* The map keeps its mapped and checked conditions. */ });
        return () => controller.abort();
    }, [area]);

    useEffect(() => {
        if (IS_PAGES_PREVIEW) return;
        let cancelled = false;
        async function refresh() {
            try {
                const { routes } = await loadCommunityRoutes(area, undefined, communityId ?? shortcutId);
                if (!cancelled) setCommunityRoutes(previous => JSON.stringify(previous) === JSON.stringify(routes) ? previous : routes);
            } catch { /* A temporary service outage leaves the most recent list open. */ }
        }
        void refresh();
        const timer = window.setInterval(refresh, 30000);
        return () => { cancelled = true; window.clearInterval(timer); };
    }, [area, communityId, communityVersion, shortcutId]);

    /* ---------- Routing ---------- */
    const planningTime = departure ?? planningNow;
    const accessNotices = useMemo(() => activeAccessNotices(edges, sourceWalkingData, planningNow), [edges, sourceWalkingData, planningNow]);
    const nearbyWeatherWarning = warningFeed?.warnings.some(warning => warning.mentions_area && warning.valid_to > planningNow);
    const fixedIds = useMemo(() => new Set(reports.filter(report => report.status === 'fixed').map(report => String(report.id))), [reports]);
    const walkingData = useMemo(() => sourceWalkingData
        ? withPersonalUpdates(sourceWalkingData, library.updates.filter(update => !update.report_id || !fixedIds.has(update.report_id)), planningNow) : null,
        [sourceWalkingData, library.updates, fixedIds, planningNow]);
    const slot: TimeSlot = slotForHour(malaysiaHour(planningTime));
    const isNight = slot === 'night';
    const graph = useMemo(() => buildGraph(nodes, edges), [nodes, edges]);
    const startPoints = useMemo(() => pilotData && sourceWalkingData ? presetStartPoints(pilotData, sourceWalkingData.assets, graph) : [],
        [pilotData, sourceWalkingData, graph]);
    const places = useMemo(() => {
        if (!walkingData) return [];
        const visible = walkingData.assets.filter(a => ['destination', 'transit', 'toilet', 'water', 'rest', 'shelter'].includes(a.kind));
        if (!pilotData) return visible;
        const alreadyMapped = new Set(visible.map(asset => asset.id));
        const unlinkedRail = transitApproachAssets(pilotData, true).filter(asset => asset.kind === 'transit' && !alreadyMapped.has(asset.id));
        return [...visible, ...unlinkedRail];
    }, [walkingData, pilotData]);
    const destination = places.find(a => a.id === destId || a.external_id === destId) ?? (exactDestination ? null : places.find(a=>a.id===pilotData?.featured_ids[0])??places[0]) ?? null;
    const currentDest = destination ? { id: destination.external_id || destination.id, name: residentPlaceName(destination), coords: [destination.lat, destination.lng] as [number, number] } : {id:'',name:exactDestination||'Choose a mapped place',coords:configuration.centre};
    const entrances = walkingData?.assets.filter(a => a.kind === 'entrance' && a.parent_id === destination?.id && a.edge_id !== null) ?? [];
    const connectedPlaces = useMemo(() => new Set(walkingData?.assets.flatMap(asset =>
        asset.edge_id !== null ? [asset.parent_id ?? asset.id] : []) ?? []), [walkingData]);
    const forecast = forecastAt(weather, planningTime);
    const tripNeeds = useMemo(() => budgetOverride === null ? needs : { ...needs, budget_min: budgetOverride }, [needs, budgetOverride]);
    const toolRequest = useMemo(() => ({ origin: userCoords, profile, needs: tripNeeds, departure_at: planningTime, start_asset_id: startAssetId }), [userCoords, profile, tripNeeds, planningTime,startAssetId]);
    const remoteRoutineFeeds=useRoutineFeeds(library.packs,area,library.packs.some(pack=>pack.routine?.enabled),routineRefresh);
    const routineFeeds=useMemo<Partial<Record<PilotId,RoutineFeed>>>(()=>{
        const feeds:Partial<Record<PilotId,RoutineFeed>>={
            ...remoteRoutineFeeds,
            ...(walkingData && conditionFetchedAt ? {[area]:{walking:walkingData,edges,hazards,reports,community:communityRoutes,
                fetched_at:conditionFetchedAt,snapshot:IS_PAGES_PREVIEW,unavailable:conditionUnavailable}}:{}),
        };
        if(IS_PAGES_PREVIEW)for(const [id,feed] of Object.entries(feeds)){
            const privateReports=id===area?deviceHazards:readDeviceHazards(id as PilotId);
            feeds[id as PilotId]={...feed,local_reports:privateReports.filter(report=>report.dataset===feed.walking.dataset_id)
                .map(report=>({id:report.id,kind:report.kind,category:report.category,location_name:report.location,created_at:report.created_at,asset_id:report.asset_id,edge_id:report.edge_id}))};
        }
        return feeds;
    },[remoteRoutineFeeds,walkingData,conditionFetchedAt,area,edges,hazards,reports,communityRoutes,conditionUnavailable,deviceHazards]);
    const routineAttention=useMemo(()=>library.packs.filter(pack=>pack.routine?.enabled &&
        inspectRoutine(pack,routineFeeds[pack.area_id??'elmina'],planningNow).changes.length>0).length,[library.packs,routineFeeds,planningNow]);
    const planningSnapshot = useMemo(() => walkingData && nodes.length ? { nodes, edges, walking: walkingData, hazards, shade: shadeData } : null,
        [nodes, edges, walkingData, hazards, shadeData]);
    const selectedCommunity = communityRoutes.find(route => route.id === communityId);
    const journeyCommand: SearchCommand | null = step !== 'route' ? null : errands
        ? {type:'errands',input:toolRequest,errands,feels_like:forecast?.feels_like_c}
        : communityId
        ? selectedCommunity ? { type: 'community', input: toolRequest, community: selectedCommunity } : null
        : returning ? { type: 'return', input: toolRequest, feels_like: forecast?.feels_like_c }
        : destination ? { type: 'journey', input: { ...toolRequest, destination, entrance_id: entranceId || undefined }, feels_like: forecast?.feels_like_c, suggestBudget: true } : null;
    const journeySearch = usePlannerResult<JourneyPlan>(planningSnapshot, journeyCommand);
    const plan=journeySearch.result;
    const matchingPlaces = useMemo(() => searchResidentPlaces(places, placeQuery.trim().split(',')[0], pilotData?.featured_ids ?? [], connectedPlaces),
        [places, placeQuery, pilotData, connectedPlaces]);
    const searchResults = useMemo(()=>matchingPlaces.slice(0,8),[matchingPlaces]);
    useEffect(()=>{
        if(searchOpen&&searchIndex>=0){
            const option=searchResults[searchIndex];
            if(option)document.getElementById('place-option-'+option.id)?.scrollIntoView({block:'nearest'});
        }
    },[searchOpen,searchIndex,searchResults]);
    const suggestedPlaces = (pilotData?.featured_ids ?? []).flatMap(id => places.find(place => place.id === id) ?? []).slice(0, 3);
    const pinCentre = mapFocus ?? (view === 'walk' ? livePoint ?? walkSession?.pack.origin : undefined) ?? userCoords;
    const transitCentre = pilotData?.neighbourhoods?.find(item => item.coordinates === mapFocus)?.coordinates ?? userCoords;
    const mapAssets = useMemo(() => {
        const assets = walkingData?.assets ?? [];
        const arrival = assets.filter(asset => asset.kind === 'entrance' && asset.parent_id === destination?.id && asset.edge_id !== null);
        const nearby = assets.filter(asset => (['rest', 'toilet', 'water', 'shelter', 'transit'].includes(asset.kind) && asset.source !== 'gtfs') ||
            (asset.kind === 'destination' && asset.category === 'healthcare'));
        nearby.sort((a, b) => metres([a.lng, a.lat], [pinCentre[1], pinCentre[0]]) - metres([b.lng, b.lat], [pinCentre[1], pinCentre[0]]));
        const itinerary=(view==='walk'&&walkSession?walkSession.pack.route:plan?.routes.direct)?.errand_stops??[];
        const points=[...itinerary.map(stop=>stop.entrance),...arrival,...nearby.slice(0,step==='route'||view==='walk'?9:15)];
        return [...new Map(points.map(asset=>[asset.id,asset])).values()];
    }, [walkingData, destination, pinCentre, step, view,plan,walkSession]);
    const recommended: Mode = plan?.recommended ?? (isNight ? 'safest' : 'coolest');

    const visibleModes = ROUTE_MODES.filter(mode => plan?.routes[mode] && !(isNight && mode === 'coolest'));
    const fastest = visibleModes.reduce<Mode>((best, mode) => (plan?.routes[mode]?.total_min ?? Infinity) < (plan?.routes[best]?.total_min ?? Infinity) ? mode : best, 'direct');

    const activeMode = chosenMode && !(isNight && chosenMode === 'coolest') ? chosenMode : recommended;

    const activeRoute = view === 'walk' && walkSession ? walkSession.pack.route :
        plan?.routes[activeMode] ?? plan?.routes.direct ?? Object.values(plan?.routes ?? {})[0];
    const shownMode: Mode = activeRoute?.mode ?? activeMode;
    const readiness=useMemo(()=>activeRoute && walkingData ? journeyReadiness(activeRoute,view==='walk'&&walkSession?walkSession.pack.profile:profile,
        view==='walk'&&walkSession?walkSession.pack.needs:tripNeeds,edges,walkingData,hazards,reports,activeRoute.arrival_at) : null,
        [activeRoute,walkingData,view,walkSession,profile,tripNeeds,edges,hazards,reports]);
    const plannedRoof = useMemo(() => activeRoute
        ? routeRoofLines(activeRoute, view === 'walk' ? walkSession?.pack.edges ?? edges : edges, walkingData?.verifications ?? []) : [],
    [activeRoute, edges, walkingData, view, walkSession]);
    const weatherCue = activeRoute && view === 'plan' ? walkWeather(weather, planningTime, activeRoute.total_min) : null;
    const arrivalCheck = activeRoute && evidenceFor(walkingData?.verifications ?? [], activeRoute.entrance.kind === 'entrance' ? 'entrance' : 'facility',
        activeRoute.entrance.id, activeRoute.arrival_at).step_free;
    const reportEdge = useMemo(() => {
        if (!reportPoint || !pointInPilot(reportPoint, area)) return null;
        if (reportEdgeId !== null) return graph.edges.get(reportEdgeId) ?? null;
        const near = nearestEdge(graph, ...reportPoint);
        return near && near.distance_m <= (selectedKind === 'shade_correction' ? 30 : 150) ? graph.edges.get(near.edge_id) ?? null : null;
    }, [reportPoint, reportEdgeId, graph, area, selectedKind]);
    const observedAt = fromMalaysiaInput(observedTime);
    const shadeReportReady = Boolean(reportEdge && !reportAsset && shadeChange && observedAt);
    const localReports = useMemo(() => deviceHazards.filter(report => report.dataset === sourceWalkingData?.dataset_id),
        [deviceHazards, sourceWalkingData?.dataset_id]);
    const mapReports = useMemo(() => [...reports.filter(report => report.status !== 'fixed'&&report.kind!=='check_requested'), ...localReports.filter(report=>report.kind!=='check_requested')], [reports, localReports]);
    const reportAssets = useMemo(() => reportPoint ? (sourceWalkingData?.assets ?? []).filter(asset => asset.source !== 'gtfs' && (selectedKind !== 'lift_out' || asset.kind === 'entrance'))
        .map(asset => ({ asset, distance: metres([asset.lng, asset.lat], [reportPoint[1], reportPoint[0]]) }))
        .filter(item => item.distance <= 100).sort((a, b) => a.distance - b.distance)
        .slice(0, 12).map(item => item.asset) : [], [reportPoint, sourceWalkingData, selectedKind]);
    const records = walkingData?.verifications;
    const describeSpot = useCallback((asset: WalkingAsset) => spotDetails(asset, planningTime, records ?? [], language, shadeModel, activeRoute),
        [planningTime, records, language, shadeModel, activeRoute]);
    const openShadeReport = useCallback((id: number, point?: [number, number]) => {
        const edge = graph.edges.get(id);
        if (!edge || edge.geometry.length < 2) return;
        const [lng, lat] = point ? projectPoint(edge.geometry, [point[1], point[0]]).point : pointAt(edge.geometry, .5);
        setReportEdgeId(id);
        setReportPoint([lat, lng]);
        setReportAsset(null);
        setSelectedKind('shade_correction');
        setShadeChange('');
        setObservedTime(malaysiaInput(new Date().toISOString()));
        setReportNotes('');
        setReportPhoto(null);
        setAutoNote(null);
        setReportMsg(null);
        setShowReportHistory(false);
        setShowReportModal(true);
    }, [graph]);
    const activeWalkReports = useMemo(() => walkSession ? checkedRouteReports(walkSession.pack.route, reports) : [], [walkSession, reports]);

    const mapRoutes = useMemo(
        () =>
            view === 'walk' && walkSession ? [{ id: walkSession.pack.route.mode, name: 'Your recorded walk plan', route_type: walkSession.pack.route.mode, coordinates: walkSession.pack.route.coordinates }] :
                [...new Set([fastest, 'sheltered' as Mode, shownMode])].flatMap((m) => {
                const r = plan?.routes[m];
                return r
                    ? [{
                        id: m,
                        name: residentText(language, routeLabel(m, isNight, fastest)),
                        route_type: m === 'safest' ? 'night_safe' : m,
                        coordinates: r.coordinates,
                        shade_factor: isNight ? r.avg_lit : r.avg_shade,
                        surface_temp_base_c: 0,
                        length_meters: Math.round(r.length_m),
                    }]
                    : [];
            }),
        [plan, isNight, view, walkSession, fastest, shownMode, language],
    );

    /* ---------- Things the person does ---------- */
    function clearGroup() {
        setGroupMembers([]); setGroupBase(null);
    }
    function chooseDest(id: string) {
        if (step !== 'where' && (id !== destId || returning || communityId || errands)) { setBudgetOverride(null); setTripProfile(null); clearGroup(); }
        setErrands(null); setRoutineEditId(null);
        setCommunityId(null);
        setMapFocus(undefined);
        setReturning(false);
        setChosenMode(null);
        setDestId(id);
        setExactDestination(places.find(a => a.id === id || a.external_id === id)?.name ?? 'Selected place');
        setEntranceId('');
        buzz();
    }
    function persistWalkingProfile(value: DeviceWalkingProfile) {
        setDeviceProfile(value);
        try {
            writeDeviceWalkingProfile(localStorage, value);
            return true;
        } catch {
            setProfileMessage('Device storage could not save your profile. These choices work for this visit only.');
            return false;
        }
    }

    function saveDefaultWalkingSettings(settings: WalkingSettings) {
        const value = normaliseWalkingSettings(settings.profile, { ...settings.needs, budget_min: deviceProfile.settings.needs.budget_min });
        if (persistWalkingProfile({ version: 1, status: 'complete', settings: value })) {
            setProfileMessage('Your profile is saved.');
        }
        setTripProfile(null); clearGroup(); setChosenMode(null); setProfileEditor(null);
    }

    function dismissProfileSetup() {
        if (deviceProfile.status === 'new') persistWalkingProfile({ ...deviceProfile, status: 'skipped' });
        setShowProfileSetup(false);
    }

    function useSavedWalkingPace(speed: number) {
        const settings = deviceProfile.settings;
        saveDefaultWalkingSettings({ ...settings, needs: { ...settings.needs, speed_mps: speed } });
        setLibraryMessage('Your personal pace is selected for this walking profile.');
    }

    function resetWalkingProfile() {
        if (!window.confirm(t('Reset your saved walking profile and display preferences? Saved walks, history and reports will be kept.'))) return;
        if (persistWalkingProfile({ ...newDeviceWalkingProfile(), status: 'skipped' })) setProfileMessage('Your walking profile has been reset.');
        setPrefs({ ...DEFAULT_PREFS, mapMode: prefs.mapMode, reduceMotion: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false,
            showActivity: prefs.showActivity, showFrequentPlaces: prefs.showFrequentPlaces });
        setTripProfile(null); clearGroup(); setChosenMode(null); setShowProfilePrivacy(false);
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
                if (communityId) { setCommunityId(null); setStep('where'); setTripProfile(null); setBudgetOverride(null); }
                setUserCoords(coords); setStartAssetId(undefined);
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
        if (communityId) { setCommunityId(null); setStep('where'); setTripProfile(null); setBudgetOverride(null); }
        setUserCoords(point.coordinates); setStartAssetId(point.asset_id);
        setUsingGPS(false);
        setGeoMsg(null);
        setMapFocus(undefined);
        setShowStartPicker(false);
        buzz();
    }

    function selectCommunity(route: CommunityRoute) {
        if (!route.path) return;
        if (step !== 'where') { setTripProfile(null); setBudgetOverride(null); clearGroup(); }
        setErrands(null); setStartAssetId(undefined); setRoutineEditId(null);
        setRoutePanel('routes');setCommunityId(route.id);
        setUserCoords(route.path.coordinates[0]);
        setUsingGPS(false);
        setReturning(false);
        setChosenMode('direct');
        setStep('route');
        setView('plan');
        setMapFocus(undefined);
        setShowCommunity(false);
        setPanelMinimized(false);
    }

    async function startWalk() {
        if (walkSession && !sessionFinished) {
            const sessionArea = walkSession.pack.area_id ?? 'elmina';
            if (sessionArea !== area) { router.replace(`/resident?area=${sessionArea}`); return; }
            setView('walk');
            setPanelMinimized(false);
            setLibraryMessage('Your current walk is still in progress. Finish it before starting another.');
            return;
        }
        if (!activeRoute || !walkingData) return;
        const now = new Date().toISOString();
        setStartingWalk(true);
        let fresh:JourneyPlan|null=null;
        try {
            const input = { ...toolRequest, departure_at: now };
            fresh = await journeySearch.run<JourneyPlan>(errands
                ? {type:'errands',input,errands:errandRequestFromRoute(activeRoute)??errands,feels_like:forecastAt(weather,now)?.feels_like_c}
                : selectedCommunity
                ? { type: 'community', input, community: selectedCommunity }
                : { type: returning ? 'return' : 'journey', input: { ...input, ...(destination ? { destination } : {}), entrance_id: entranceId || undefined },
                    feels_like: forecastAt(weather, now)?.feels_like_c });
        }
        catch{setLibraryMessage('The current route could not be checked. Please refresh and try again.');return;}finally{setStartingWalk(false);}
        const route = fresh?.routes[shownMode];
        if (!route) { setLibraryMessage('This route no longer matches your needs for a walk starting now. Refresh and review the route before setting out.'); return; }
        const pack = createWalkPack(route, profile, tripNeeds, selectedCommunity?.path?.coordinates[0] ?? userCoords, edges, walkingData, undefined, networkSnapshot);
        setWalkSession({ id: crypto.randomUUID(), pack, started_at: now, elapsed_ms: 0, track: emptyTrack() });
        setSessionFinished(false); setLivePoint(null); setView('walk');
        setPanelMinimized(true);
        buzz(80);
        setStep('walking');
        speak(language === 'ms'
            ? `Perjalanan anda telah bermula. Kira-kira ${minutesOf(route)} minit. ${route.return_walk ? 'Kembali ke titik mula anda.' : `Ke ${route.destination.name}.`}`
            : `Your walk has started. About ${minutesOf(route)} minutes. ${route.return_walk ? 'Return to your starting point.' : `To ${route.destination.name}.`}`);
    }

    function changeLibrary(next: WalkLibrary) {
        try { writeLibrary(next, localStorage); libraryRef.current = next; setLibrary(next); return true; }
        catch (error) { setLibraryMessage(error instanceof Error ? error.message : 'Device storage is unavailable.'); return false; }
    }
    function finishRecording(walk: CompletedWalk) {
        const ok = changeLibrary({ ...libraryRef.current, history: [walk, ...libraryRef.current.history.filter(w => w.id !== walk.id)] });
        setPanelMinimized(false);
        if (ok) { setSessionFinished(true); setPlanningNow(new Date().toISOString()); speak(t('Walk finished.')); } return ok;
    }
    function saveFeedback(id: string, feedback: WalkFeedback) {
        if (!libraryRef.current.history.some(w => w.id === id)) return false;
        return changeLibrary({ ...libraryRef.current, history: libraryRef.current.history.map(w => w.id === id ? { ...w, feedback } : w) });
    }
    function planReturn(minutes: number) { setShowFacilities(false);setRoutePanel('routes'); if (step !== 'where') {setTripProfile(null);clearGroup();} setErrands(null);setRoutineEditId(null);setCommunityId(null); setReturning(true); setBudgetOverride(minutes); setEntranceId(''); setChosenMode(null); setStep('route'); setView('plan'); setPanelMinimized(false); }
    function focusWalkPoint(point: [number, number]) { if(panelState==='full')setPanelState('open');setMapFocus(point); requestAnimationFrame(()=>document.querySelector('.tg-map')?.scrollIntoView({block:'center',behavior:prefs.reduceMotion?'auto':'smooth'})); }
    function chooseFacility(asset: WalkingAsset) { setShowFacilities(false);setRoutePanel('routes'); chooseDest(asset.external_id || asset.id); setStep('route'); setView('plan'); setPanelMinimized(false); }
    function replanPack(pack: WalkPack) {
        setRoutePanel('routes');
        const target=pack.area_id??'elmina';
        if(target!==area){if(walkSession&&!sessionFinished){setLibraryMessage('Finish the current walk before switching areas.');return;}
            router.replace('/resident?'+new URLSearchParams({area:target,replan:pack.id}));return;}
        clearGroup(); setErrands(errandRequestFromRoute(pack.route)); setStartAssetId(pack.route.start_asset_id); setRoutineEditId(pack.routine?pack.id:null);
        setCommunityId(pack.route.community_id ?? null);
        initialOriginUsed.current=true; setUserCoords(pack.origin); setUsingGPS(false);
        setBudgetOverride(pack.needs.budget_min);
        setTripProfile(normaliseWalkingSettings(pack.profile, { ...pack.needs, budget_min: deviceProfile.settings.needs.budget_min }));
        setMapFocus(undefined);
        setExactDestination(pack.route.destination.name);
        setReturning(!!pack.route.return_walk); setDestId(pack.route.destination.external_id || pack.route.destination.id); setEntranceId(pack.route.return_walk || pack.route.errand_stops ? '' : pack.route.entrance.id);
        setDeparture(new Date().toISOString()); setChosenMode(null); setStep('route'); setView('plan'); setPanelMinimized(false); setReloadVersion(v => v + 1); }
    function planErrandJourney(request:ErrandRequest,budget:number) {
        setRoutePanel('routes');setErrands(request);setBudgetOverride(budget);setReturning(false);setCommunityId(null);setEntranceId('');setChosenMode('direct');
        setMapFocus(undefined);setStep('route');setView('plan');setShowErrands(false);setPanelMinimized(false);
    }
    function saveUsualRoute(label:string,enabled:boolean) {
        if(!activeRoute||!walkingData)return;
        const saved=createWalkPack(activeRoute,profile,tripNeeds,selectedCommunity?.path?.coordinates[0]??userCoords,edges,walkingData,undefined,networkSnapshot);
        const existing=libraryRef.current.packs.find(pack=>pack.id===routineEditId && pack.routine);
        const pack:WalkPack={...saved,id:existing?.id??saved.id,routine:{label,enabled}};
        if(changeLibrary({...libraryRef.current,packs:[pack,...libraryRef.current.packs.filter(p=>p.id!==pack.id)]})){
            setRoutineEditId(pack.id);setShowUsual(false);setLibraryMessage('Usual route saved privately in Saved.');
        }
    }
    function monitorUsualRoute(id:string,enabled:boolean) {
        changeLibrary({...libraryRef.current,packs:libraryRef.current.packs.map(pack=>pack.id===id&&pack.routine?{...pack,routine:{...pack.routine,enabled}}:pack)});
    }
    async function savePack() {
        if (!activeRoute || !walkingData) return;
        const pack = createWalkPack(activeRoute, profile, tripNeeds, selectedCommunity?.path?.coordinates[0] ?? userCoords, edges, walkingData, undefined, networkSnapshot);
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
            const asset = update.target_type === 'facility' ? sourceWalkingData?.assets.find(item => item.id === update.target_id) : null;
            const edge = edges.find(item => String(item.id) === update.target_id && update.target_type !== 'facility');
            if (!asset && !edge) return false;
            const [lng, lat] = asset ? [asset.lng, asset.lat] : pointAt(edge!.geometry, .5);
            const { report } = await submitReport({ area_id: area, lat, lng, edge_id: edge?.id, asset_id: asset?.id,
                kind: update.kind === 'seat_unavailable' ? 'blocked' : update.kind, description: update.notes });
            const next = { ...libraryRef.current, updates: libraryRef.current.updates.map(u => u.id === update.id
                ? { ...u, shared_at: new Date().toISOString(), report_id: String(report.id) } : u) };
            if (!changeLibrary(next)) { libraryRef.current = next; setLibrary(next); setLibraryMessage('The report was shared, but this browser could not update its device copy.'); }
            setReloadVersion(v => v + 1); return true;
        } catch { return false; }
    }

    function readRouteAloud() {
        if (!activeRoute) return;
        if (language === 'ms') {
            speak(
                `${activeRoute.return_walk ? 'Kembali ke titik mula anda' : `Ke ${activeRoute.destination.name}`}. ${t(routeLabel(shownMode, isNight, fastest))}. Kira-kira ${minutesOf(activeRoute)} minit, ${Math.round(activeRoute.length_m)} meter. ` +
                `${activeRoute.verified_rest_stops} perhentian rehat disahkan. ` +
                (activeRoute.sun_exposure && !isNight ? `Kira-kira ${Math.round(activeRoute.sun_exposure.sun_s / 60)} minit di bawah cahaya matahari langsung, ${Math.ceil(activeRoute.sun_exposure.unknown_s / 60)} minit dengan teduhan tidak diketahui. ` : '') +
                `${activeRoute.unverified_crossings} lintasan perlu disemak. Tiba di ${activeRoute.entrance.name}. ${activeRoute.suitability === 'green' ? 'Laluan ini memenuhi keperluan anda dan semakan terkini.' : 'Laluan ini perlu disahkan.'}`,
                true,
            );
            return;
        }
        speak(
            `${activeRoute.return_walk ? 'Return to your starting point' : `To ${activeRoute.destination.name}`}. ${t(routeLabel(shownMode, isNight, fastest))} route. About ${minutesOf(activeRoute)} minutes, ` +
            `${Math.round(activeRoute.length_m)} metres. ${activeRoute.verified_rest_stops} verified rest stops. ` +
            (activeRoute.sun_exposure && !isNight ? `About ${Math.round(activeRoute.sun_exposure.sun_s / 60)} minutes in direct sun, ${Math.ceil(activeRoute.sun_exposure.unknown_s / 60)} minutes with unknown shade. ` : '') +
            `${activeRoute.unverified_crossings} crossings need checks. ` +
            `Arrival at ${activeRoute.entrance.name}. ${activeRoute.suitability === 'green' ? 'This route meets your needs and current checks.' : 'This route needs confirmation.'}`,
            true,
        );
    }

    /* ---------- Sharing ---------- */
    const walkMin = activeRoute ? minutesOf(activeRoute) : null;
    const shareMessage = activeRoute?.errand_stops
        ? `My walking errands: ${activeRoute.errand_stops.map(stop=>stop.destination.name).join(' → ')}${activeRoute.errand_returns?' → return to start':''}. About ${walkMin} minutes including stops. Departure ${malaysiaTimeLabel(activeRoute.departure_at,language,true)} MYT.`
        : `${activeRoute?.return_walk ? 'I am taking a return walk' : `I'm walking to ${activeRoute?.destination.name ?? currentDest.name}`} on the ${t(routeLabel(shownMode, isNight, fastest)).toLowerCase()} route` +
        `${walkMin ? `, about ${walkMin} minutes` : ''}. Departure ${malaysiaTimeLabel(activeRoute?.departure_at ?? planningTime, language, true)} MYT.`;

    function openShare() {
        const captured = view === 'walk' ? walkSession?.pack : undefined;
        const origin = captured?.origin ?? selectedCommunity?.path?.coordinates[0] ?? userCoords;
        const sharedRoute = captured?.route ?? activeRoute;
        const params = new URLSearchParams({
            area,
            startLat: String(origin[0]),
            startLng: String(origin[1]),
            destId: sharedRoute?.destination.external_id || sharedRoute?.destination.id || destId,
            mode: sharedRoute?.mode ?? shownMode,
            budget: String(captured?.needs.budget_min ?? tripNeeds.budget_min),
            departure: sharedRoute?.departure_at ?? planningTime,
            ...(informationLayer === 'shade' ? { layer: 'shade' } : {}),
            ...(sharedRoute?.community_id ? { community: sharedRoute.community_id } : {}),
            ...(sharedRoute?.return_walk ? { return: '1' } : {}),
            ...(sharedRoute?.start_asset_id ? { startAsset: sharedRoute.start_asset_id } : {}),
            ...(sharedRoute?.errand_stops ? { errands:JSON.stringify(errandRequestFromRoute(sharedRoute)) } : {}),
            ...(sharedRoute && !sharedRoute.return_walk ? { entrance: sharedRoute.entrance.id } : {}),
        });
        setShareSettings({ profile: captured?.profile ?? profile, needs: captured?.needs ?? tripNeeds });
        setSharePreferences(false);
        setShareBaseUrl(`${window.location.origin}${window.location.pathname}?${params.toString()}`);
        setCopied(false);
        setShareNote(null);
        setShowShare(true);
        buzz();
    }

    async function shareShortcut(route: CommunityRoute) {
        const url = new URL(window.location.pathname, window.location.origin);
        url.search = new URLSearchParams({ area, shortcut: route.id, departure: planningTime }).toString();
        return copyText(url.toString());
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
        setRequestedField(undefined);
        setReportEdgeId(null);
        setReportAsset(null);
        setSelectedKind(null);
        setReportPoint(livePoint ?? mapFocus ?? userCoords);
        setReportMsg(null);
        setShowReportHistory(false);
        setSearchOpen(false);
        setShowReportModal(true);
        buzz();
    }

    function openRouteCheck(barrier:RouteBarrier) {
        const isEdge=barrier.target_type==='path'||barrier.target_type==='crossing';
        const asset=isEdge?null:sourceWalkingData?.assets.find(a=>a.id===barrier.target_id && a.source!=='gtfs')??null;
        const edge=isEdge?graph.edges.get(Number(barrier.target_id)):undefined;
        if(!asset&&!edge){setLibraryMessage('This point is not a reportable target in the current dataset. Refresh the map and choose a mapped path.');return;}
        setRequestedField(observationFields(barrier.target_type).some(f=>f.key===barrier.field)?barrier.field:undefined);
        setReportEdgeId(edge?.id??null);setReportAsset(asset);setReportPoint(barrier.point);setSelectedKind('check_requested');
        setReportNotes('Please check '+(CONDITION_LABELS[barrier.field]??barrier.field)+' at '+barrier.name+' — '+barrier.reason+'. Information requested; not a confirmed defect.');
        setReportPhoto(null);setAutoNote(null);setReportMsg(null);setSearchOpen(false);setShowReportHistory(false);setShowReportModal(true);
    }
    function openAssetReport(asset: WalkingAsset) {
        setRequestedField(undefined);
        setReportEdgeId(null);
        if (asset.source === 'gtfs') return;
        setReportAsset(asset);
        setReportPoint([asset.lat, asset.lng]);
        setSelectedKind(asset.kind === 'destination' ? 'details_outdated' : 'blocked');
        setReportMsg(null);
        setShowReportHistory(false);
        setShowReportModal(true);
    }

    function chooseReportPoint(lat: number, lng: number) {
        setRequestedField(undefined);
        setReportEdgeId(null);
        setReportAsset(null);
        setReportPoint([lat, lng]);
        setReportMsg(null);
        setPickingHazard(false);
        setShowReportModal(true);
    }

    function locateReport() {
        setRequestedField(undefined);
        if (!navigator.geolocation) {
            setReportMsg('Location is unavailable. Choose the location on the map.');
            return;
        }
        setReportLocated(true);
        navigator.geolocation.getCurrentPosition(position => {
            setReportEdgeId(null);
            setReportAsset(null);
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
        setSelectedKind(previous => previous ?? reading.kind);
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

    function chooseReportKind(kind: HazardKind) {
        if(kind!=='check_requested')setRequestedField(undefined);
        setSelectedKind(kind);
        if (kind === 'shade_correction') {
            setReportAsset(null);
            if (!observedTime) setObservedTime(malaysiaInput(new Date().toISOString()));
        }
        buzz();
    }

    async function submitCapexDefect() {
        if (!selectedKind || (!reportEdge && !reportAsset) || !reportPoint || isSubmittingReport
            || (selectedKind === 'lift_out' && reportAsset?.kind !== 'entrance') || (selectedKind === 'details_outdated' && !reportAsset)
            || (selectedKind === 'shade_correction' && !shadeReportReady)) return;
        if (selectedKind === 'shade_correction' && observedAt && Date.parse(observedAt) > Date.now() + 60000) {
            setReportMsg(t('Choose an observation time in the past.'));
            return;
        }
        setReportMsg(null);
        setIsSubmittingReport(true);
        const [lat, lng] = reportPoint;
        const observation = selectedKind === 'shade_correction' && shadeChange && observedAt
            ? { shade_change: shadeChange, observed_at: observedAt } : {};
        try {
            if (IS_PAGES_PREVIEW) {
                updateDeviceHazards([{ id: crypto.randomUUID(), lat, lng, category: issueLabel[selectedKind], kind: selectedKind,
                    description: reportNotes.trim(), ...observation, created_at: new Date().toISOString(),
                    location: reportAsset?.name ?? reportEdge?.name ?? 'Mapped footpath', dataset: sourceWalkingData?.dataset_id,
                    ...(reportAsset ? {asset_id:reportAsset.id}:{edge_id:reportEdge?.id}),
                    ...(reportPhoto ? { photo: reportPhoto } : {}) },
                ...deviceHazards]);
                setReportMsg(t('Saved on this device'));
                speak(language === 'ms' ? 'Laporan anda disimpan pada peranti ini.' : 'Your report was saved on this device.');
            } else {
                const { hazard, report } = await submitReport({
                    area_id: area, edge_id: reportAsset ? undefined : reportEdge?.id, asset_id: reportAsset?.id, lat, lng, kind: selectedKind, description: reportNotes, ...observation, ...(selectedKind==='check_requested' && requestedField?{requested_field:requestedField}:{}),
                });
                setHazards(previous => [...previous, hazard]);
                setReports(previous => [report, ...previous]);
                const receipt: Record<string, string | true> = { ...reportReceipts, [String(report.id)]: reportPhoto ?? true };
                try { localStorage.setItem(receiptKey(area), JSON.stringify(receipt)); }
                catch {
                    // A large image can exhaust the local quota. Retain the report ID for status updates.
                    try { localStorage.setItem(receiptKey(area), JSON.stringify(Object.fromEntries(Object.keys(receipt).map(id => [id, true])))); }
                    catch { /* The current session can still show the report. */ }
                }
                setReportReceipts(receipt);
                setReloadVersion(value => value + 1);
                setReportMsg(t('Report sent to maintenance.'));
                speak(language === 'ms' ? 'Laporan anda telah dihantar.' : 'Your report was sent.');
            }
            setReportNotes('');
            setRequestedField(undefined);setAutoNote(null);
            setReportPhoto(null);
            setReportPoint(null);
            setReportEdgeId(null);
            setObservedTime('');
            setShadeChange('');
            setReportAsset(null);
            setSelectedKind(null);
            setShowReportModal(false);
            setShowReportHistory(true);
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
    const startName = (point: StartPoint) => {
        const place = places.find(asset => asset.id === point.id);
        return place ? residentPlaceName(place) : point.label;
    };
    const originLabel = selectedCommunity ? t('Community route start') : usingGPS ? t('Your location') : startAssetId && walkingData?.assets.find(a=>a.id===startAssetId) ? walkingData.assets.find(a=>a.id===startAssetId)!.name : selectedStart ? startName(selectedStart)
        : loadingDb ? configuration.origin_label : t('Your chosen starting point');
    const availableStarts = showStartPicker ? startPoints.filter(point => startName(point).toLowerCase().includes(startQuery.trim().toLowerCase())) : [];

    function selectSearchResult(place: WalkingAsset) {
        setShowDiscovery(false);setShowTransit(false);setShowFacilities(false);setRoutePanel('routes');setSearchIndex(-1);
        chooseDest(place.external_id || place.id);
        setReturning(false);
        setPlaceQuery('');
        setSearchOpen(false);
        setMapFocus(undefined);
        setPanelMinimized(true);
        setStep('route');
        setView('plan');
        requestAnimationFrame(()=>document.querySelector<HTMLElement>('.tg-summary-heading')?.focus({preventScroll:true}));
    }

    function planFrequentPlace(place: FrequentPlace) {
        if (!isPilotAvailable(place.area)) {
            setLibraryMessage(t('This place is no longer available in the current map.'));
            return;
        }
        if (walkSession && !sessionFinished) {
            setLibraryMessage(t('Finish the current walk before planning a new journey.'));
            return;
        }
        if (place.area !== area) {
            router.replace('/resident?' + new URLSearchParams({ area: place.area, destId: place.place_id }));
            return;
        }
        const asset = places.find(item => item.id === place.place_id || item.external_id === place.place_id);
        if (!asset && !loadingDb) {
            setLibraryMessage(t('This place is no longer available in the current map.'));
            return;
        }
        setTripProfile(null); clearGroup();setBudgetOverride(null); setDeparture(null); setPlanningNow(new Date().toISOString());
        if (asset) selectSearchResult(asset);
        else {
            // Keep the selected start while current map data is still loading.
            chooseDest(place.place_id); setExactDestination(place.name);
            setPlaceQuery(''); setSearchOpen(false); setPanelMinimized(true); setStep('route'); setView('plan');
        }
    }

    function changeDeparture(value: string) {
        setDeparture(value);
        if (step === 'route') setInformationLayer('shade');
    }

    const departureControl = <DepartureControl language={language} departure={planningTime} now={!departure} onChange={changeDeparture} revealTime={plan?.issue?.kind === 'closed'}
        onNow={() => { setDeparture(null); setPlanningNow(new Date().toISOString()); }} forecast={forecast} />;

    const planningControls = <div className="tg-plan-profile">
        <div className="tg-plan-profile-line">
            <span className="tg-profile-mini-icon"><UserRound size={19} aria-hidden /></span>
            <div><strong>{groupMembers.length ? `${groupMembers.length+1} ${t('Walking together').toLowerCase()}` : t(tripProfile ? 'Using settings for this journey' : 'Using your walking profile')}</strong>
                <p>{compactWalkingSummary(activeWalkingSettings, language)}</p></div>
            <button type="button" className="tg-text-action" aria-label={t('Adjust for this journey')} onClick={() => groupMembers.length ? setShowGroup(true):setProfileEditor('trip')}><SlidersHorizontal size={17} aria-hidden />{t('Adjust')}</button>
        </div>
        <button type="button" className="tg-btn" onClick={()=>setShowGroup(true)}>{t('Walking together')}{groupMembers.length?' · '+(groupMembers.length+1):''}</button>
        <label className="tg-plan-budget"><span><strong>{t('Total trip budget')}</strong><small>{t('Per journey')}</small></span>
            <select className="tg-input" value={tripNeeds.budget_min} onChange={e => { setBudgetOverride(Number(e.target.value)); setChosenMode(null); }}>
                {[...new Set([...WALK_BUDGETS, tripNeeds.budget_min])].sort((a,b) => a-b).map(n => <option key={n} value={n}>{n} min</option>)}
            </select>
        </label>
    </div>;

    function chooseExploreTask(task:ExploreTask) {
        setSearchOpen(false);
        if(task==='nearby')setShowDiscovery(true);
        else if(task==='errands')setShowErrands(true);
        else if(task==='guides'){setShortcutWalk(undefined);setShowCommunity(true);}
        else if(task==='transit')setShowTransit(true);
    }
    const localPlaces = <PlaceDiscovery snapshot={planningSnapshot} request={toolRequest} budget={tripNeeds.budget_min}
        warning={!!nearbyWeatherWarning} onChoose={(asset,requirements,mode)=>{
            selectSearchResult(asset);
            if(requirements){
                const selected=normaliseWalkingSettings(profile,{...requirements,budget_min:activeWalkingSettings.needs.budget_min});
                if(JSON.stringify(selected)!==JSON.stringify(activeWalkingSettings))setTripProfile(selected);
            }
            setChosenMode(mode??null);
        }} onReport={asset=>{setShowDiscovery(false);openAssetReport(asset);}} language={language} />;
    const quickUpdate = <QuickConditionUpdate area={area} dataset={walkingData?.dataset_id} edges={edges.filter(e => activeRoute?.edge_ids.includes(e.id))} facilities={walkingData?.assets ?? []} onSave={saveUpdate} onShare={shareUpdate} />;
    const routeReady = Boolean(activeRoute && !loadingDb && !journeySearch.pending);
    const choosingRoute = view === 'plan' && step === 'route';
    const noRoute = choosingRoute && !activeRoute && !loadingDb && !journeySearch.pending;
    const routeIssue = plan?.issue;
    const failureMessage = plan?.reasons[0] ?? (journeySearch.error || (communityId
        ? 'This community route is unavailable for planning. Check its status in Community routes.'
        : 'Choose a mapped place to plan a trip.'));
    function routeRecovery() {
        if (routeIssue?.kind === 'budget') {
            const budget = routeIssue.suggested_min;
            return { label: `${t('Try with')} ${budget} min`, run: () => setBudgetOverride(budget) };
        }
        if (routeIssue?.kind === 'closed') {
            return { label: t('Change departure time'), run: () => {setRoutePanel('settings');setPanelMinimized(false);} };
        }
        if ((routeIssue?.kind === 'entrance' || routeIssue?.kind === 'connection') &&
            entranceId && entrances.some(entrance => entrance.id !== entranceId)) {
            return { label: t('Try another entrance'), run: () => setEntranceId('') };
        }
        if (routeIssue?.kind === 'start' || routeIssue?.kind === 'connection') {
            return { label: t('Choose a starting point'), run: () => { setStartQuery(''); setShowStartPicker(true); } };
        }
        if (routeIssue?.kind === 'needs' || tripNeeds.require_rests || tripNeeds.verified_only) return { label: t('Adjust for this journey'), run: () => setProfileEditor('trip') };
        return null;
    }
    const failureAction = noRoute ? routeRecovery() : null;
    function closeRouteOptions() {
        setCommunityId(null);setStep('where');setReturning(false);setErrands(null);setRoutineEditId(null);
        setBudgetOverride(null);setTripProfile(null);clearGroup();setChosenMode(null);setPanelMinimized(true);setRoutePanel('routes');
    }
    const reviewNeeded=!!(readiness?.incomplete||!readiness||conditionUnavailable||nearbyWeatherWarning||IS_PAGES_PREVIEW);
    const routeTitle=errands?t('Your stops')+' · '+errands.stops.length:communityId?selectedCommunity?.title??t('Community routes'):returning?t('Return to your starting point'):currentDest.name;
    const myReports = { ...reportReceipts };
    for (const update of library.updates) if (update.report_id) myReports[update.report_id] ??= true;

    /* ---------------------------------------------------------------- */

    return (
        <div lang={language} data-view={view} data-step={step} data-scale={prefs.scale} data-panel-minimized={panelMinimized || pickingHazard} data-panel={pickingHazard ? 'min' : panelState}
             className={`tg font-sans ${prefs.highContrast ? 'hc' : ''} ${prefs.reduceMotion ? 'rm' : ''}`}>

            <div className="tg-topbar">
            <a href="#walk-planning" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[3000] focus:rounded-xl focus:bg-white focus:p-3 focus:font-bold text-slate-900"
                onClick={() => setPanelMinimized(false)}>{t('Skip to walk planning')}</a>
            <header className="tg-header">
                <Link href="/" className="tg-brand" aria-label="TownshipGo home">
                    <span><Footprints size={19} aria-hidden /></span> TownshipGo
                </Link>
                {view !== 'profile' && <PilotSelector area={area} onChange={changeArea} language={language} />}
                <button className="tg-iconbtn" onClick={() => setShowSettings(true)} aria-label={t('Text size and display settings')}>Aa</button>
            </header>
            {view === 'plan' && (
                <div className="tg-trip-fields">
                <button type="button" className="tg-start-field" onClick={() => { setSearchOpen(false); setStartQuery(''); setShowStartPicker(true); }} aria-haspopup="dialog">
                    <span className="tg-origin-mark"><CircleDot size={18} aria-hidden /></span><span>{t('From')}</span><strong>{originLabel}</strong><ChevronDown size={16} aria-hidden />
                </button>
                <form className="tg-search" onSubmit={event => {
                    event.preventDefault();
                    const selected=searchResults[Math.max(0,Math.min(searchIndex,searchResults.length-1))];
                    if (selected) selectSearchResult(selected);
                }} onKeyDown={event => {
                    if (event.key === 'Escape') {setSearchOpen(false);setSearchIndex(-1);}
                    if((event.key==='ArrowDown'||event.key==='ArrowUp')&&event.target instanceof HTMLInputElement&&searchResults.length){
                        event.preventDefault();setSearchOpen(true);
                        setSearchIndex(index=>event.key==='ArrowDown'?(index+1)%searchResults.length:(index<=0?searchResults.length-1:index-1));
                    }
                }} onBlur={event => {
                    if (!event.currentTarget.contains(event.relatedTarget)) setSearchOpen(false);
                }}>
                    <div className="tg-search-input">
                        <MapPin size={21} strokeWidth={2} aria-hidden />
                        <label htmlFor="destination-search" className="sr-only">{t('Find a place')}</label>
                        <input id="destination-search" type="search" autoComplete="off" value={placeQuery} onFocus={() => {setSearchOpen(true);setSearchIndex(-1);}}
                            onChange={event => { setPlaceQuery(event.target.value); setSearchOpen(true);setSearchIndex(-1); }}
                            placeholder={choosingRoute&&errands?t('Errand itinerary'):choosingRoute && !returning ? currentDest.name : t('Where are you walking to?')}
                            role="combobox" aria-autocomplete="list" aria-expanded={searchOpen}
                            aria-activedescendant={searchOpen&&searchIndex>=0&&searchResults[searchIndex]?'place-option-'+searchResults[searchIndex].id:undefined}
                            aria-controls={searchOpen ? 'mapped-places' : undefined} />
                        {placeQuery&&<button type="button" className="tg-search-clear" aria-label={t('Clear search')} onClick={()=>{setPlaceQuery('');setSearchIndex(-1);setSearchOpen(true);document.getElementById('destination-search')?.focus();}}><X size={17} aria-hidden/></button>}
                    </div>
                    <button type="button" className="tg-location" aria-label={t('Use my location')} title={t('Use my location')} onClick={handleGetLocation} disabled={geoBusy}><LocateFixed size={20} aria-hidden /></button>
                    {searchOpen && <div className="tg-search-results">
                        {searchResults.length ? (
                            <ul role="listbox" id="mapped-places" aria-label={t(placeQuery.trim() ? 'Matching places' : 'Suggested places')}>
                                {searchResults.map((place,index) => <li key={place.id} role="presentation">
                                    <button type="button" role="option" id={'place-option-'+place.id} aria-selected={index===searchIndex} tabIndex={-1}
                                        onPointerDown={event=>{if(event.pointerType==='mouse')event.preventDefault();}} onClick={() => selectSearchResult(place)}>
                                        <span className="tg-search-result-icon"><MapPin size={18} aria-hidden /></span><span className="tg-search-result-name">{residentPlaceName(place)}</span><ArrowUpRight size={16} aria-hidden/>
                                    </button>
                                </li>)}
                            </ul>
                        ) : <p id="mapped-places" role="status">{t(loadingDb ? 'Loading mapped places…' : 'No mapped places match this search.')}</p>}
                    </div>}
                </form>
                </div>
            )}
            {view === 'plan' && geoMsg && !showStartPicker && <p className="tg-banner" role="status">{geoMsg}</p>}
            {libraryMessage && <div role="status" className="tg-banner tg-app-message"><p>{libraryMessage}</p>
                <button type="button" className="tg-close" aria-label={t('Close')} onClick={() => setLibraryMessage(null)}><X size={18} aria-hidden /></button>
            </div>}

            {view !== 'profile' && dataError && (
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
                    language={language}
                    labelScale={parseFloat(SCALE_PCT[prefs.scale] ?? '100') / 100}
                    mapMode={prefs.mapMode === '2d' ? '2d' : '3d'}
                    onMapModeChange={mode => setPref('mapMode', mode)}
                    routes={mapRoutes}
                    activeRouteId={activeRoute?.mode ?? ''}
                    reports={mapReports}
                    assets={mapAssets}
                    describeAsset={describeSpot}
                    solar={shadeModel}
                    shadeAt={planningTime}
                    routeShade={view === 'plan' ? activeRoute?.sun_exposure?.stretches : undefined}
                    onShadeReport={openShadeReport}
                    startCoords={view === 'walk' && walkSession ? walkSession.pack.origin : selectedCommunity?.path?.coordinates[0] ?? userCoords}
                    endCoords={activeRoute ? activeRoute.return_walk||activeRoute.errand_returns ? undefined : [activeRoute.entrance.lat,activeRoute.entrance.lng] : step === 'route' && destination && !errands && !returning && !communityId ? currentDest.coords : undefined}
                    endDetail={activeRoute ? [activeRoute.entrance.name, ...describeSpot(activeRoute.entrance)].join(' · ') : undefined}
                    startLabel={t(activeRoute?.return_walk||activeRoute?.errand_returns?'Start and return':usingGPS?'You':'Start')}
                    routeRoof={plannedRoof}
                    reduceMotion={prefs.reduceMotion}
                    highContrast={prefs.highContrast}
                    environment={walkingData ? { edges, records: walkingData.verifications, at: planningTime } : undefined}
                    informationLayer={informationLayer}
                    onInformationLayerChange={setInformationLayer}
                    focusLocation={mapFocus}
                    neighbourhoods={view !== 'walk' && !pickingHazard ? pilotData?.neighbourhoods : undefined}
                    onNeighbourhoodChange={setMapFocus}
                    fitLabel={t(activeRoute?'Whole route':'Recenter')}
                    onNearby={walkingData && !pickingHazard ? () => setShowNearby(true) : undefined}
                    liveLocation={livePoint ?? undefined}
                    selectedLocation={showReportModal ? reportPoint ?? undefined : undefined}
                    onLocationSelect={pickingHazard ? chooseReportPoint : undefined}
                />
                {pickingHazard
                    ? <div className="tg-pick" role="status"><span>{t('Tap the map at the problem.')}</span><button className="tg-close" type="button" aria-label={t('Cancel picking a location')} onClick={() => { setPickingHazard(false); setShowReportModal(true); }}><X size={19} aria-hidden /></button></div>
                    : <button type="button" className="tg-map-report" aria-label={t('Report a problem')} onClick={openReport}>
                        <AlertTriangle size={19} aria-hidden /><span>{t('Report issue')}</span>
                    </button>}
            </div>

            <section ref={sheetRef} id="walk-planning" aria-label={t(view === 'profile' ? 'My walking profile' : 'Walk planning')} tabIndex={-1} className="tg-sheet">
                {view === 'plan' && !pickingHazard && <div className="tg-sheet-preview">
                    <div className="tg-sheet-handle" aria-hidden />
                    <div className="tg-sheet-row tg-peek-heading">
                        <h1 className="tg-summary-heading" tabIndex={-1} aria-live="polite">
                            {choosingRoute ? (routeReady ? errands ? t('Errand itinerary') : t(routeLabel(shownMode,isNight,fastest)) : t(noRoute?'No matching route':'Choose a route')) : t('Explore your area')}
                        </h1>
                        {!choosingRoute&&panelMinimized&&<button type="button" aria-label={t('Forecast')} title={t('Forecast')} className="tg-peek-weather" onClick={()=>setShowWeather(true)}>
                            {(forecast?.rain_probability??0)>=50?<CloudRain size={18} aria-hidden/>:<Thermometer size={18} aria-hidden/>}
                            <span>{forecast?.air_temp_c!=null?Math.round(forecast.air_temp_c)+'°':t('Forecast')}</span>
                        </button>}
                        <PanelGrip state={panelState} openLabel={noRoute?'Route help':choosingRoute?'Compare routes':'Explore nearby'} language={language}
                            controls="walking-panel" onChange={next=>{if(panelMinimized&&next!=='min'&&choosingRoute)setRoutePanel('routes');setPanelState(next);}} />
                        {choosingRoute&&<button type="button" className="tg-peek-close" onClick={closeRouteOptions} aria-label={t('Close route options')}><X size={19} aria-hidden/></button>}
                    </div>
                    {!choosingRoute&&<ExploreShortcuts language={language} ready={Boolean(walkingData)&&!loadingDb} guidesReady={Boolean(walkingData?.dataset_id)}
                        transitReady={Boolean(pilotData)&&area!=='elmina'&&Boolean(pilotData?.transit.stops.length)} onChoose={chooseExploreTask}/>}
                    {choosingRoute && (activeRoute ? <>
                        <div className="tg-route-summary">
                            <div className="tg-route-hero" aria-live="polite">
                                <div><strong>{minutesOf(activeRoute)} <small>min</small></strong><span>{Math.round(activeRoute.length_m)} m</span></div>
                                <RouteCoverage route={activeRoute} language={language}/>
                                <RouteSun route={activeRoute} language={language} compact/>
                            </div>
                            <button className="tg-btn tg-btn-primary tg-start-walk" onClick={()=>void startWalk()} disabled={!routeReady||startingWalk}>
                                <Navigation size={20} aria-hidden/>{t(startingWalk?'Checking your route…':'Start walk')}
                            </button>
                        </div>
                        <div className="tg-route-cues">
                            <button type="button" className="tg-readiness-pill" data-review={reviewNeeded} onClick={()=>{setRoutePanel('access');if(panelMinimized)setPanelMinimized(false);}}>
                                {reviewNeeded?<AlertTriangle size={16} aria-hidden/>:<ShieldCheck size={16} aria-hidden/>}
                                {t(reviewNeeded?'Needs review':'Recorded checks current')}<ChevronRight size={14} aria-hidden/>
                            </button>
                            {weatherCue&&<button type="button" className="tg-weather-pill" onClick={()=>{setRoutePanel('access');if(panelMinimized)setPanelMinimized(false);}}>
                                {weatherCue==='rain'?<CloudRain size={16} aria-hidden/>:<Sun size={16} aria-hidden/>}
                                {t(weatherCue==='rain'?'Rain likely during this walk':'Warm conditions during this walk')}
                            </button>}
                            {nearbyWeatherWarning&&<button type="button" className="tg-readiness-pill" data-review="true" onClick={()=>setShowWeather(true)}><AlertTriangle size={16} aria-hidden/>{t('Weather warning')}</button>}
                        </div>
                    </> : noRoute ? panelMinimized && <div className="tg-route-status" role="status">
                        <p>{failureMessage}</p>
                        {failureAction&&<button type="button" className="tg-text-action" onClick={failureAction.run}>{failureAction.label}</button>}
                    </div> : <div className="tg-loading-row" role="status"><span className="tg-loader" aria-hidden/>{t(loadingDb?'Loading footpaths…':'Finding walking routes…')}</div>)}
                    {!choosingRoute&&nearbyWeatherWarning&&<button type="button" className="tg-readiness-pill" data-review="true" onClick={()=>setShowWeather(true)}><AlertTriangle size={16} aria-hidden/>{t('Weather warning')}<ChevronRight size={15} aria-hidden/></button>}
                </div>}

                {view !== 'walk' && <div ref={panelBodyRef} id="walking-panel" className="tg-panel-body">
                    {view==='saved'&&<header className="tg-saved-heading"><span className="tg-kicker"><LockKeyhole size={15} aria-hidden/>{t('On this device')}</span><h1>{t('Saved journeys')}</h1><p>{t('Review familiar walks and keep useful routes for later.')}</p></header>}
                    {view === 'saved' && <UsualRoutes packs={library.packs} feeds={routineFeeds} now={planningNow} language={language} onMonitor={monitorUsualRoute}
                        onReplan={replanPack} onRefresh={()=>{setReloadVersion(v=>v+1);setRoutineRefresh(v=>v+1);}}
                        onPlan={()=>{setView('plan');setStep('where');clearGroup();setTripProfile(null);setBudgetOverride(null);setErrands(null);setCommunityId(null);setReturning(false);setChosenMode(null);setRoutineEditId(null);setPanelMinimized(false);}}/>}
                    {view === 'saved' && <SavedWalks library={library} profile={deviceProfile.settings.profile} pace={deviceProfile.settings.needs.speed_mps} area={area} reports={reports} onChange={changeLibrary} onReplan={replanPack} onFeedback={saveFeedback}
                        onUsePace={useSavedWalkingPace} onShare={shareUpdate} />}
                    {view === 'profile' && <WalkingProfilePanel profile={deviceProfile} language={language}
                        history={library.history} activityNow={Date.parse(planningNow)} showActivity={prefs.showActivity} showFrequentPlaces={prefs.showFrequentPlaces} onPlanFrequentPlace={planFrequentPlace}
                        savedCount={library.packs.length + library.history.length} communityReady={Boolean(walkingData?.dataset_id)}
                        onEdit={() => setProfileEditor('default')} onSetup={() => setShowProfileSetup(true)}
                        onDisplay={() => setShowSettings(true)} onSaved={() => setView('saved')}
                        onReports={() => { setReportMsg(null); setShowReportHistory(true); }}
                        onCommunity={() => { setShortcutWalk(undefined); setShowCommunity(true); }}
                        onPrivacy={() => setShowProfilePrivacy(true)} />}
                    {view === 'plan' && !panelMinimized && !pickingHazard && <div className="tg-stack">
                        {!!accessNotices.length && <AccessNotices notices={accessNotices} onFocus={focusWalkPoint} />}
                        {nearbyWeatherWarning && <WeatherWarningList feed={warningFeed} now={planningNow} />}
                        {step === 'where' && <>
                            <div className="tg-section-heading"><div><p className="tg-kicker">{t('Plan your next walk')}</p><h2>{t('Suggested places')}</h2></div></div>
                            {suggestedPlaces.length>0 ? <div className="tg-featured-places">
                                {suggestedPlaces.map(place=><button key={place.id} type="button" onClick={()=>selectSearchResult(place)}>
                                    <span className="tg-featured-icon"><MapPin size={21} aria-hidden/></span><span><strong>{residentPlaceName(place)}</strong><small>{t('Plan a walk')}</small></span><ChevronRight size={19} aria-hidden/>
                                </button>)}
                            </div> : <p className="tg-note">{t(loadingDb?'Loading mapped places…':'No places yet')}</p>}
                            <ReturnWalkCard language={language} ready={Boolean(walkingData)} onReturn={planReturn}/>
                            <div className="tg-explore-links">
                                <button type="button" className="tg-featured-link" onClick={()=>setShowFacilities(true)} disabled={!walkingData}>
                                    <span className="tg-featured-icon"><Armchair size={21} aria-hidden/></span><span><strong>{t('Find a facility')}</strong><small>{t('Verified rest and facilities')}</small></span><ChevronRight size={18} aria-hidden/>
                                </button>
                                <button type="button" className="tg-featured-link" onClick={()=>setShowWeather(true)}>
                                    <span className="tg-featured-icon" data-tone="gold"><CloudRain size={21} aria-hidden/></span><span><strong>{t('Forecast')}</strong><small>{forecast?.air_temp_c!=null?Math.round(forecast.air_temp_c)+'°C · '+(forecast.rain_probability==null?t('Forecast'):Math.round(forecast.rain_probability)+'% '+t('chance of rain')):t('Forecast unavailable at this time')}</small></span><ChevronRight size={18} aria-hidden/>
                                </button>
                            </div>
                            <details className="tg-details tg-trip-options"><summary><SlidersHorizontal size={19} aria-hidden/>{t('Trip settings')}</summary>
                                {planningControls}{departureControl}
                            </details>
                            <details className="tg-details">
                                <summary>{t('More walking options')}</summary>
                                <div className="tg-stack">
                                    <button type="button" className="tg-text-action text-left" onClick={() => setReloadVersion(version => version + 1)}>Refresh paths and checks</button>
                                    <Link href={'/verification?area=' + area} className="tg-btn">Places and verification coverage<ArrowUpRight size={17} aria-hidden/></Link>
                                    <PilotSources area={area} context={pilotData ?? undefined} />
                                </div>
                            </details>
                        </>}
                        {step === 'route' && <>
                            <div className="tg-route-destination"><span className="tg-kicker">{t('My trip')}</span><h2>{routeTitle}</h2></div>
                            <div className="tg-route-sections" role="group" aria-label={t('Walk details')}>
                                {([{id:'routes',label:'Routes and stops',short:'Routes',Icon:RouteIcon},{id:'access',label:'Access and conditions',short:'Access',Icon:ShieldCheck},{id:'settings',label:'Trip settings',short:'Settings',Icon:SlidersHorizontal}] as const).map(({id,label,short,Icon})=>
                                    <button type="button" key={id} aria-label={t(label)} aria-pressed={routePanel===id} onClick={()=>setRoutePanel(id)}><Icon size={18} aria-hidden/><span>{t(short)}</span></button>)}
                            </div>
                            {noRoute && <div className="tg-note tg-warnbox tg-failure-card" role="status">
                                <div className="tg-failure-heading"><AlertTriangle size={23} aria-hidden/><h3>{t('No matching route')}</h3></div>
                                <p>{failureMessage}</p>
                                {plan?.reasons.slice(1).map(reason=><p key={reason}>{reason}</p>)}
                                {failureAction&&<button type="button" className="tg-btn" onClick={failureAction.run}>{failureAction.label}<ChevronRight size={16} aria-hidden/></button>}
                            </div>}
                            {routePanel==='routes'&&<>
                                {noRoute&&<JourneyBarriers barriers={plan?.barriers??[]} onCheck={openRouteCheck} onFocus={focusWalkPoint}/>}
                                {errands&&noRoute&&<button type="button" className="tg-btn" onClick={()=>setShowErrands(true)}>Edit stops and time budget</button>}
                                {errands&&plan&&activeRoute&&<ErrandItinerary route={activeRoute} compared={plan.compared_itineraries} language={language} onEdit={()=>setShowErrands(true)} onFocus={focusWalkPoint}/>}
                                {!errands&&plan&&activeRoute&&<RouteComparison routes={plan.routes} modes={visibleModes} chosen={shownMode} fastest={fastest} night={isNight} language={language} recommended={plan.recommended}
                                    onChoose={mode=>{chooseMode(mode);setMapFocus(undefined);}}/>}
                                {activeRoute&&<>
                                    <button type="button" className="tg-review-link" onClick={()=>setRoutePanel('access')}>
                                        <span className="tg-featured-icon" data-tone={reviewNeeded?'gold':'green'}>{reviewNeeded?<AlertTriangle size={21} aria-hidden/>:<ShieldCheck size={21} aria-hidden/>}</span>
                                        <span><strong>{t('Journey readiness')}</strong><small>{t(reviewNeeded?'Needs review':'Recorded checks current')}</small></span><ChevronRight size={19} aria-hidden/>
                                    </button>
                                    <div className="tg-route-tools">
                                        <button type="button" className="tg-btn" onClick={()=>setShowUsual(true)}><Bookmark size={19} aria-hidden/>{t('Save usual route')}</button>
                                        <button type="button" className="tg-btn" onClick={openShare}><Share2 size={19} aria-hidden/>{t('Share plan')}</button>
                                    </div>
                                </>}
                                {noRoute&&<button type="button" className="tg-featured-link" onClick={()=>setRoutePanel('settings')}><SlidersHorizontal size={20} aria-hidden/><span>{t('Trip settings')}</span><ChevronRight size={17} aria-hidden/></button>}
                            </>}
                            {routePanel==='access'&&<>
                                {activeRoute&&readiness&&<JourneyReadiness route={activeRoute} readiness={readiness} language={language}
                                    fetchedAt={conditionFetchedAt} snapshot={IS_PAGES_PREVIEW} unavailable={conditionUnavailable} warning={!!nearbyWeatherWarning} onCheck={openRouteCheck} onFocus={focusWalkPoint}/>}
                                {noRoute&&<JourneyBarriers barriers={plan?.barriers??[]} onCheck={openRouteCheck} onFocus={focusWalkPoint}/>}
                                {weatherCue&&<div className="tg-walk-weather">
                                    {weatherCue==='rain'?<CloudRain size={19} aria-hidden/>:<Sun size={19} aria-hidden/>}
                                    <span>{t(weatherCue==='rain'?'Rain likely during this walk':'Warm conditions during this walk')}</span>
                                    {plan?.routes[weatherCue==='rain'?'sheltered':'coolest']&&shownMode!==(weatherCue==='rain'?'sheltered':'coolest')&&
                                        <button type="button" className="tg-text-action" onClick={()=>{chooseMode(weatherCue==='rain'?'sheltered':'coolest');setMapFocus(undefined);}}>{t(weatherCue==='rain'?'See sheltered route':'See shadier route')}</button>}
                                </div>}
                                {activeRoute&&<RouteSun route={activeRoute} language={language}/>}
                                {activeRoute&&<RouteChecks route={activeRoute} language={language}/>}
                            {!errands && !returning && !communityId && (activeRoute || entrances.length > 0) && <div className="tg-arrival tg-note">
                                {activeRoute && <div className="tg-arrival-heading"><MapPin size={20} aria-hidden />
                                    <div><p className="tg-label">{t('Arrival entrance')}</p><strong>{activeRoute.entrance.name}</strong>
                                        <p className="tg-small">{arrivalCheck?.status === 'verified'
                                            ? (arrivalCheck.value === true ? t('Step-free access checked') : t('Stairs or barriers recorded'))
                                            : t('Access needs checking')}</p>
                                        <p className="tg-small">{describeSpot(activeRoute.entrance).slice(0, 2).join(' · ')}</p></div></div>}
                                {entrances.length > 1 && <label className="tg-label">{t('Choose an entrance')}
                                    <select className="tg-input" value={entranceId} onChange={event => { setEntranceId(event.target.value); setChosenMode(null); }}>
                                        <option value="">{t('Best available access point')}</option>
                                        {entrances.map(entrance => <option key={entrance.id} value={entrance.id}>{entrance.name}</option>)}
                                    </select>
                                </label>}
                            </div>}

                                {shadeModel&&activeRoute&&<button type="button" className="tg-btn" aria-pressed={informationLayer==='shade'} onClick={()=>{setInformationLayer(informationLayer==='shade'?'routes':'shade');setPanelState('min');}}><Sun size={19} aria-hidden/>{t('Show shade on map')}</button>}
                                <details className="tg-details">
                                <summary>{t('Access and route details')}</summary>
                                <div className="tg-stack mt-3">
                                    {activeRoute && <>
                                        <ComfortBreakdown route={activeRoute} edges={edges} records={walkingData?.verifications ?? []} night={isNight} />
                                        <WalkTimeline route={activeRoute} edges={edges} records={walkingData?.verifications ?? []} language={language} onFocus={focusWalkPoint} onShadeReport={openShadeReport} />
                                        <RouteDetails route={activeRoute} />
                                        <div className="grid grid-cols-2 gap-2">
                                            <button className="tg-btn" disabled={savingPack} onClick={() => void savePack()}><Bookmark size={18} aria-hidden />{savingPack ? 'Preparing…' : 'Save offline'}</button>
                                            <button className="tg-btn" onClick={() => { if (walkingData) downloadPack(createWalkPack(activeRoute, profile, tripNeeds, userCoords, edges, walkingData, undefined, networkSnapshot)); }}>Download walk pack</button>
                                            {canSpeak && <button className="tg-btn" onClick={readRouteAloud}><Volume2 size={18} aria-hidden />Read aloud</button>}
                                        </div>
                                    </>}
                                    <WalkingConditions night={isNight} forecast={forecast} onCompare={mode=>{setChosenMode(mode);setStep('route');}}
                                        onInspectCover={()=>{setInformationLayer('cover');if(plan?.routes.sheltered)chooseMode('sheltered');setPanelState('min');}}/>
                                    {quickUpdate}
                                </div>
                                </details>
                            </>}
                            {routePanel==='settings'&&<>
                                {planningControls}
                                {departureControl}
                                {!errands&&planningSnapshot?.shade&&journeyCommand&&!!activeRoute?.sun_exposure?.daylight_s&&<DepartureOptions
                                    snapshot={planningSnapshot} plan={journeyCommand} route={activeRoute} weather={weather} language={language}
                                    onChoose={time=>{if(!returning&&!communityId)setEntranceId(activeRoute.entrance.id);setChosenMode(shownMode);changeDeparture(time);}}/>}
                            </>}
                        </>}
                    </div>}
                </div>}

                {walkSession && <div className="tg-recorder" hidden={view !== 'walk'}>
                    <WalkRecorder key={walkSession.id} session={walkSession} language={language} voiceEnabled={prefs.speak && view === 'walk'} onComplete={finishRecording} onFeedback={saveFeedback} onPosition={setLivePoint}
                        onShareShortcut={walkingData?.dataset_id ? walk => { setShortcutWalk(walk); setShowCommunity(true); } : undefined}
                        panelControl={!pickingHazard && <PanelGrip state={panelState} language={language} controls="walk-recording-controls"
                            openLabel={activeWalkReports.length ? 'Conditions changed' : 'Walk controls'} onChange={setPanelState} />}
                        onNewWalk={() => { setWalkSession(null); setLivePoint(null); setBudgetOverride(null); setTripProfile(null); clearGroup(); setErrands(null);setRoutineEditId(null); setView('plan'); setStep('where'); setPanelMinimized(true); }}>
                        {activeWalkReports.length > 0 && <div role="status" className="tg-note tg-warnbox">
                            <p className="font-bold">{t('Conditions changed')}</p>
                            <ul className="list-disc pl-5">{activeWalkReports.map(report => <li key={report.id}>{report.location_name} · {report.description}</li>)}</ul>
                            <button type="button" className="tg-text-action" onClick={() => replanPack(walkSession.pack)}>Review routes with current conditions</button>
                        </div>}
                        <details className="tg-details"><summary>Your original walk plan</summary>
                            <RouteQualityBar route={walkSession.pack.route} />
                            <WalkTimeline route={walkSession.pack.route} edges={walkSession.pack.edges} records={walkingData?.verifications ?? []} language={language} onFocus={focusWalkPoint} />
                        </details>
                        {quickUpdate}
                        <div className="grid grid-cols-2 gap-2"><button className="tg-btn" onClick={openShare}><Share2 size={20} aria-hidden />Share</button><a className="tg-btn" href={'tel:' + EMERGENCY_NUMBER}><Phone size={20} aria-hidden />Call for help</a></div>
                    </WalkRecorder>
                </div>}
            </section>
            <nav className="tg-tabs" aria-label={t('Walking sections')}>
                {([['plan', 'Map', Compass], ['walk', 'Walk', Navigation], ['saved', 'Saved', Bookmark]] as const)
                    .filter(([id]) => id !== 'walk' || walkSession).map(([id, label, Icon]) =>
                    <button type="button" key={id} aria-current={view === id ? 'page' : undefined} onClick={() => {
                        const sessionArea = walkSession?.pack.area_id ?? 'elmina';
                        if (id === 'walk' && sessionArea !== area) { router.replace(`/resident?area=${sessionArea}`); return; }
                        setView(id);
                        setSearchOpen(false);setPickingHazard(false);
                        setPanelMinimized(id !== 'walk' || !sessionFinished);
                        if (id === 'plan' && step === 'walking') setStep('route');
                        requestAnimationFrame(() => document.getElementById('walk-planning')?.focus({ preventScroll: true }));
                    }}><Icon size={21} aria-hidden />{t(label)}{id==='saved' && routineAttention>0&&<span className="tg-routine-badge" aria-label={routineAttention+' usual routes have changes'}>{routineAttention}</span>}</button>)}
                <button type="button" onClick={() => { setReportMsg(null); setShowReportHistory(true); }}><ClipboardList size={21} aria-hidden />{t('Reports')}</button>
                <button type="button" aria-current={view === 'profile' ? 'page' : undefined} onClick={() => {
                    setView('profile'); setSearchOpen(false); setPickingHazard(false);
                    requestAnimationFrame(() => document.getElementById('walk-planning')?.focus({ preventScroll: true }));
                }}><UserRound size={21} aria-hidden />{t('Profile')}</button>
            </nav>

            {/* ---------------- Dialogs ---------------- */}

            {showProfileSetup && <Sheet title={t('Set up your walking profile')} onClose={dismissProfileSetup} language={language}>
                <WalkingProfileSetup initial={deviceProfile.settings} display={{ language, scale: prefs.scale, speak: prefs.speak }} canSpeak={canSpeak} firstTime={deviceProfile.status === 'new'}
                    onDismiss={dismissProfileSetup} onSave={(settings, display) => {
                        saveDefaultWalkingSettings(settings);
                        setPrefs(p => ({ ...p, ...display }));
                        setShowProfileSetup(false);
                    }} />
            </Sheet>}

            {showUsual && activeRoute && <Sheet title={t('Save usual route')} language={language} onClose={()=>setShowUsual(false)}>
                <UsualRouteForm initialLabel={library.packs.find(p=>p.id===routineEditId)?.routine?.label??(activeRoute.errand_stops?'My everyday errands':activeRoute.return_walk?'My return walk':activeRoute.destination.name)}
                    onSave={saveUsualRoute} initialEnabled={library.packs.find(p=>p.id===routineEditId)?.routine?.enabled}/>
            </Sheet>}
            {showGroup && <Sheet title={t('Walking together')} language={language} onClose={()=>setShowGroup(false)}>
                <GroupWalk base={groupBase??{...activeWalkingSettings,needs:tripNeeds}} initial={groupMembers} language={language}
                    onApply={(members,settings)=>{setGroupBase(groupBase??{...activeWalkingSettings,needs:tripNeeds});setGroupMembers(members);setTripProfile(settings);setChosenMode(null);setShowGroup(false);}}
                    onReset={()=>{clearGroup();setTripProfile(null);setChosenMode(null);setShowGroup(false);}}/>
            </Sheet>}
            {showErrands && <Sheet title={t('Plan errands')} language={language} onClose={()=>setShowErrands(false)}>
                <ErrandPlanner places={places.filter(place=>place.source!=='gtfs')} origin={userCoords} initial={errands} initialBudget={tripNeeds.budget_min} onPlan={planErrandJourney}/>
            </Sheet>}

            {profileEditor && <Sheet title={t(profileEditor === 'trip' ? 'Adjust for this journey' : 'Edit walking profile')} language={language} onClose={() => setProfileEditor(null)}>
                <WalkingProfileEditor initial={profileEditor === 'trip' ? activeWalkingSettings : deviceProfile.settings} language={language}
                    trip={profileEditor === 'trip'} hasOverride={Boolean(tripProfile)} onClose={() => setProfileEditor(null)} onSave={saveDefaultWalkingSettings}
                    onResetTrip={() => { clearGroup();setTripProfile(null); setChosenMode(null); setProfileEditor(null); }}
                    onUseTrip={settings => {
                        clearGroup();
                        setTripProfile(normaliseWalkingSettings(settings.profile, { ...settings.needs, budget_min: deviceProfile.settings.needs.budget_min }));
                        setChosenMode(null); setProfileEditor(null); setProfileMessage('Profile updated for this journey only.');
                    }} />
            </Sheet>}

            {showProfilePrivacy && <Sheet title={t('Privacy and reset')} language={language} onClose={() => setShowProfilePrivacy(false)}>
                <div className="tg-stack">
                    <p className="tg-note flex items-start gap-2"><LockKeyhole size={20} className="shrink-0" aria-hidden />{t('Your walking settings and display preferences are kept in this browser, not in an account. They are not included in a shared route link unless you choose to include them.')}</p>
                    <p className="tg-small">{t('Planning uses your selected walking area, start and destination. Saved walk packs can include the walking requirements used to plan them.')}</p>
                    <SettingSwitch label={t('Show activity summaries')} language={language}
                        hint={t('Hide or show this information on Profile. Your completed walks remain saved.')}
                        checked={prefs.showActivity} onChange={value => setPref('showActivity', value)} />
                    <SettingSwitch label={t('Show frequently visited places')} language={language}
                        hint={t('Hide or show this information on Profile. Your completed walks remain saved.')}
                        checked={prefs.showFrequentPlaces} onChange={value => setPref('showFrequentPlaces', value)} />
                    <p className="tg-small">{t('Visit summaries come from arrivals you confirm. Remove a walk in Saved to remove its contribution, or hide the summaries on this device.')}</p>
                    <button type="button" className="tg-btn" onClick={() => { setShowProfilePrivacy(false); setView('saved'); }}>{t('View history')}</button>
                    <p className="tg-small">{t('Resetting does not delete walks, shortcuts or reports you have already saved or submitted.')}</p>
                    <button type="button" className="tg-btn tg-btn-outline" onClick={resetWalkingProfile}>{t('Reset walking profile')}</button>
                </div>
            </Sheet>}

            {profileMessage && <div role="status" className="tg-profile-notice"><span>{t(profileMessage)}</span><button className="tg-close" type="button" aria-label={t('Close')} onClick={() => setProfileMessage(null)}><X size={19} aria-hidden /></button></div>}


            {showCommunity && walkingData?.dataset_id && <Sheet title={t(shortcutWalk ? 'Share a local shortcut' : 'Community routes')} language={language}
                onClose={() => { setShowCommunity(false); setShortcutWalk(undefined); }}>
                <CommunityRoutes area={area} dataset={walkingData.dataset_id} graph={{ nodes, edges }} walks={library.history}
                    startPoints={startPoints} routes={communityRoutes} walking={walkingData} hazards={hazards} now={planningNow} onPlan={selectCommunity} initialWalk={shortcutWalk} initialRouteId={shortcutId} onShare={shareShortcut} language={language}
                    onShared={() => setCommunityVersion(value => value + 1)} />
            </Sheet>}

            {showDiscovery && <Sheet title={t('Find places and comfort')} language={language} onClose={()=>setShowDiscovery(false)}>
                {localPlaces}
            </Sheet>}
            {showTransit&&pilotData&&<Sheet title={t('Transit access')} language={language} onClose={()=>setShowTransit(false)}>
                <TransitNearby context={pilotData} assets={walkingData?.assets??[]} origin={transitCentre} at={planningTime}
                    onChoose={selectSearchResult} onFocus={point=>{setShowTransit(false);focusWalkPoint(point);setPanelMinimized(true);}} data={walkingData} hazards={hazards} onStart={asset=>{
                        setShowTransit(false);chooseStart({id:asset.id,label:asset.name,coordinates:[asset.lat,asset.lng],asset_id:asset.id});setView('plan');setStep('where');setErrands(null);
                        setReturning(false);setRoutineEditId(null);setPanelMinimized(true);setPlaceQuery('');setSearchOpen(true);
                        requestAnimationFrame(()=>document.getElementById('destination-search')?.focus({preventScroll:true}));
                    }}/>
            </Sheet>}
            {showFacilities&&<Sheet title={t('Find mapped facilities')} language={language} onClose={()=>setShowFacilities(false)}>
                <ExploreWalks nodes={nodes} edges={edges} data={walkingData} request={toolRequest} hazards={hazards} onChoose={chooseFacility}
                    onLocate={handleGetLocation} locating={geoBusy} locationLabel={originLabel} locationMessage={geoMsg}
                    onLastPosition={livePoint?()=>{setUserCoords(livePoint);setStartAssetId(undefined);setUsingGPS(true);setGeoMsg('Using your last recorded GPS fix. Refresh your location if you have moved since then.');}:undefined}/>
            </Sheet>}
            {showWeather&&<Sheet title={t('Forecast')} language={language} onClose={()=>setShowWeather(false)}>
                <div className="tg-stack"><WeatherStrip weather={weather} now={planningNow}/><WeatherWarningList feed={warningFeed} now={planningNow}/></div>
            </Sheet>}

            {showNearby && walkingData && <Sheet title={t('Nearby facilities')} onClose={() => setShowNearby(false)} language={language}>
                <NearbyFacilities assets={walkingData.assets} centre={pinCentre} language={language}
                    onFocus={asset => { setShowNearby(false); setPanelMinimized(true); focusWalkPoint([asset.lat, asset.lng]); }}
                    describe={describeSpot} onPlan={asset => { setShowNearby(false); selectSearchResult(asset); }} />
            </Sheet>}

            {showStartPicker && (
                <Sheet title={t('Choose a starting point')} onClose={() => setShowStartPicker(false)} language={language}>
                    <div className="tg-stack">
                        <button type="button" className="tg-btn" onClick={handleGetLocation} disabled={geoBusy}>
                            <LocateFixed size={19} aria-hidden />{t(geoBusy ? 'Finding your location…' : 'Use my location')}
                        </button>
                        {geoMsg && <p className="tg-note tg-warnbox" role="status">{geoMsg}</p>}
                        {startPoints.length > 0 ? (
                            <>
                                <label className="tg-label">{t('Find a place')}
                                    <input type="search" className="tg-input" value={startQuery} onChange={event => setStartQuery(event.target.value)} />
                                </label>
                                <ul className="tg-start-list" aria-label={t('Mapped starting points')}>
                                    {availableStarts.map(point => <li key={point.id}>
                                        <button type="button" className="tg-card" aria-pressed={!usingGPS && selectedStart?.id === point.id}
                                            onClick={() => chooseStart(point)}>
                                            {point.id === 'area-start' ? <CircleDot size={18} aria-hidden /> : <MapPin size={18} aria-hidden />}
                                            <span>{startName(point)}</span>
                                            {!usingGPS && selectedStart?.id === point.id && <Check size={18} aria-hidden />}
                                        </button>
                                    </li>)}
                                </ul>
                                {!availableStarts.length && <p className="tg-small" role="status">{t('No starting points match this search.')}</p>}
                            </>
                        ) : <p className="tg-small" role="status">{loadingDb ? 'Loading mapped starting points…' : 'Starting points are unavailable.'}</p>}
                    </div>
                </Sheet>
            )}

            {showSettings && (
                <Sheet title={t('Text and display')} onClose={() => setShowSettings(false)} language={language}>
                    <div className="tg-stack">
                        <label className="tg-label">{t('App language')}
                            <select className="tg-input" value={language} onChange={event => setPref('language', event.target.value === 'ms' ? 'ms' : 'en')}>
                                <option value="en" lang="en">English</option><option value="ms" lang="ms">Bahasa Melayu</option>
                            </select>
                        </label>
                        <p className="tg-label">{t('Text size')}</p>
                        <div role="radiogroup" aria-label={t('Text size')} className="grid grid-cols-3 gap-2">
                            {([['normal', 'Normal'], ['large', 'Large'], ['xlarge', 'Extra large']] as [TextScale, ResidentLabel][]).map(([v, label]) => (
                                <button
                                    key={v}
                                    role="radio"
                                    aria-checked={prefs.scale === v}
                                    className="tg-card tg-card-center"
                                    style={{ padding: '.6rem .4rem' }}
                                    onClick={() => setPref('scale', v)}
                                >
                                    {t(label)}
                                </button>
                            ))}
                        </div>

                        <SettingSwitch
                            label={t('High contrast')} language={language}
                            hint="Black text, white background, thicker borders"
                            checked={prefs.highContrast}
                            onChange={(v) => setPref('highContrast', v)}
                        />
                        <SettingSwitch
                            label={t('Reduce movement')} language={language}
                            hint="The map jumps instead of gliding"
                            checked={prefs.reduceMotion}
                            onChange={(v) => setPref('reduceMotion', v)}
                        />
                        <SettingSwitch
                            label={t('Vibrate when I tap')} language={language}
                            hint="A short buzz to confirm a tap"
                            checked={prefs.vibrate}
                            onChange={(v) => setPref('vibrate', v)}
                        />
                        {canSpeak && (
                            <SettingSwitch
                                label={t('Spoken directions and updates')} language={language}
                                hint={t('Hear route updates when GPS guidance is enabled.')}
                                checked={prefs.speak}
                                onChange={(v) => setPref('speak', v)}
                            />
                        )}
                        <p className="tg-small" style={{ margin: 0 }}>Your choices are saved on this device.</p>
                    </div>
                </Sheet>
            )}

            {showShare && (
                <Sheet title="Share your walk" onClose={() => setShowShare(false)} language={language}>
                    <div className="tg-stack">
                        <label className="tg-card tg-share-privacy">
                            <input type="checkbox" checked={sharePreferences} onChange={e => { setSharePreferences(e.target.checked); setCopied(false); setShareNote(null); }} />
                            <span><strong>{t('Include walking preferences in the link')}</strong><small>{t('Anyone with the link can read the included walking requirements.')}</small></span>
                        </label>
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
                            {t('The link opens your selected start, destination and time. Route choices use the recipient’s walking profile unless you include yours. It does not track you live.')}
                        </p>
                    </div>
                </Sheet>
            )}

            {showReportHistory && <Sheet title={t('Report history')} language={language} onClose={() => setShowReportHistory(false)}>
                {reportMsg && <p className="tg-note mb-3" role="status">{reportMsg}</p>}
                <ReportHistory reports={reports} mine={myReports} deviceReports={deviceHazards} preview={IS_PAGES_PREVIEW} language={language}
                    onNew={openReport} onRemove={id => {
                        try { updateDeviceHazards(deviceHazards.filter(report => report.id !== id)); setReportMsg(null); }
                        catch { setReportMsg('Could not remove the saved report.'); }
                    }} />
            </Sheet>}

            {showReportModal && (
                <Sheet title={t(selectedKind==='check_requested'?'Request a field check':'Report a problem')} onClose={() => setShowReportModal(false)} language={language}>
                    <form className="tg-stack tg-report-form" onSubmit={event => { event.preventDefault(); void submitCapexDefect(); }}>
                        <fieldset>
                            <legend className="tg-label mb-2">{t('What happened?')}</legend>
                            <div className="tg-report-categories tg-report-quick">
                                {HAZARD_OPTIONS.slice(0, 3).map(({ kind, Icon }) => <label key={kind}>
                                    <input className="sr-only" type="radio" name="report-kind" value={kind} checked={selectedKind === kind}
                                        onChange={() => chooseReportKind(kind)} />
                                    <span><Icon size={20} aria-hidden />{t(issueLabel[kind])}</span>
                                </label>)}
                            </div>
                            <details className="tg-details mt-2" open={Boolean(selectedKind && HAZARD_OPTIONS.slice(3).some(option => option.kind === selectedKind)) || undefined}>
                                <summary>{t('Other problems')}</summary>
                                <div className="tg-report-categories">
                                    {HAZARD_OPTIONS.slice(3).map(({ kind, Icon }) => <label key={kind}>
                                        <input className="sr-only" type="radio" name="report-kind" value={kind} checked={selectedKind === kind}
                                            onChange={() => chooseReportKind(kind)} />
                                        <span><Icon size={19} aria-hidden />{t(issueLabel[kind])}</span>
                                    </label>)}
                                </div>
                            </details>
                        </fieldset>
                        {selectedKind==='check_requested' && <p className="tg-note">Ask a reviewer to confirm this mapped condition. A request is not an observed hazard and does not block the route by itself.</p>}
                        <div className="tg-report-location">
                            <p className="tg-label">{t('Incident location')}</p>
                            <p className="flex items-start gap-2"><MapPin size={20} aria-hidden />
                                {reportAsset ? reportAsset.name : reportPoint && reportEdge ? reportEdge.name || t('On the map')
                                    : reportPoint ? t('Choose a point near a mapped path.') : t('Choose where you saw the problem.')}
                            </p>
                            {!!reportPoint && selectedKind !== 'shade_correction' && (selectedKind === 'lift_out' || selectedKind === 'details_outdated' || reportAsset) && <label className="tg-label">
                                {t(selectedKind === 'lift_out' ? 'Choose the affected entrance' : 'What is affected?')}
                                <select className="tg-input" value={reportAsset?.id ?? ''} onChange={event => {
                                    const asset = reportAssets.find(item => item.id === event.target.value);
                                    setRequestedField(undefined);setReportAsset(asset ?? null);
                                    if (asset) setReportPoint([asset.lat, asset.lng]);
                                }}>
                                    <option value="">{t(selectedKind === 'lift_out' ? 'Choose an entrance' : 'Path or crossing at the pin')}</option>
                                    {reportAsset && !reportAssets.some(item => item.id === reportAsset.id) && <option value={reportAsset.id}>{reportAsset.name}</option>}
                                    {reportAssets.map(asset => <option key={asset.id} value={asset.id}>{asset.name}</option>)}
                                </select>
                            </label>}
                            <div className="grid grid-cols-2 gap-2">
                                <button type="button" className="tg-btn" onClick={() => { setShowReportModal(false); if (view === 'saved' || view === 'profile') setView('plan'); setPickingHazard(true); }}>{t('Pick on map')}</button>
                                <button type="button" className="tg-btn" disabled={reportLocated} onClick={locateReport}>{t(reportLocated ? 'Finding…' : 'My location')}</button>
                            </div>
                        </div>
                        {selectedKind === 'shade_correction' && <div className="tg-stack">
                            <label className="tg-label">{t('What changed?')}
                                <select className="tg-input" required value={shadeChange} onChange={event => setShadeChange(event.target.value as ShadeChange | '')}>
                                    <option value="" disabled>{t('What changed?')}</option>
                                    {SHADE_CHANGES.map(change => <option key={change} value={change}>{t(shadeChangeLabel[change])}</option>)}
                                </select>
                            </label>
                            <label className="tg-label">{t('Observed at (Malaysia time)')}
                                <input className="tg-input" type="datetime-local" required value={observedTime}
                                    onChange={event => setObservedTime(event.target.value)} />
                            </label>
                        </div>}
                        <details className="tg-details">
                            <summary>{t('More details (optional)')}</summary>
                            <div className="tg-stack">
                                <HazardPhotoInput photo={reportPhoto} onPhoto={setReportPhoto} onReading={applyPhotoReading} language={language}
                                    kindLabel={kind => t(kind ? issueLabel[kind] : 'Report a problem')} />
                                {reportPhoto && <p className="tg-small">{t('Photo saved on this device.')}</p>}
                                <label className="tg-label">{t('Notes (optional)')}<textarea className="tg-input mt-1" value={reportNotes} maxLength={500}
                                    onChange={event => setReportNotes(event.target.value)} /></label>
                            </div>
                        </details>
                        {reportMsg && <p className="tg-note" role="status">{reportMsg}</p>}
                        <button type="submit" className="tg-btn tg-btn-primary" disabled={loadingDb || isSubmittingReport || !selectedKind || (!reportEdge && !reportAsset)
                            || (selectedKind === 'lift_out' && reportAsset?.kind !== 'entrance') || (selectedKind === 'details_outdated' && !reportAsset)
                            || (selectedKind === 'shade_correction' && !shadeReportReady)}>
                            <Send size={18} aria-hidden />{t(isSubmittingReport ? 'Saving…' : IS_PAGES_PREVIEW ? 'Save report' : 'Submit report')}
                        </button>
                    </form>
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
