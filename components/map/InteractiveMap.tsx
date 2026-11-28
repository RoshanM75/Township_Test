'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import type { ReportMarker } from '@/lib/types';
import type { WalkingAsset, VerificationRecord } from '@/lib/walking';
import type { PathEdge } from '@/lib/routing';
import { environmentSegments, environmentCoverage, type EnvironmentLayer, type EnvironmentSegment } from '@/lib/environment';
import { DEFAULT_ORIGIN } from '@/lib/precinct';
import { residentText, type ResidentLanguage } from '@/lib/resident-language';
import { MAP_CAUTION, ROOF_COVER, ROUTE_ALTERNATIVE, ROUTE_OUTLINE, WALK_ROUTE, WALK_ROUTE_HC, mapFacilitySymbol } from './walking-map-theme';
import { MapContainer, TileLayer, Pane, Marker, Popup, Polyline, Tooltip, CircleMarker, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import './resident-map.css';
import { Plus, Minus, Route as RouteIcon, Layers } from 'lucide-react';
import type { ShadeStretch } from '@/lib/route-shade';
import type { SolarModel } from '@/lib/solar-shade';
import { shadeLabel } from '@/lib/shade-display';
import LocalBasemap from './LocalBasemap';
import type { MapAppearance, TerrainDetail } from '@/lib/map-detail';
import { useMapTerrain } from './useMapTerrain';
import { isPilot } from '@/lib/pilots';

interface RouteItem {
    id: string;
    name: string;
    route_type: string;
    coordinates: [number, number][];
}

/** A ranked defect pin for the admin dashboard */
interface OverviewPin {
    id: string | number;
    lat: number;
    lng: number;
    rank: number;
    severity: 'blocker' | 'comfort';
    title: string;
    detail?: string;
}

export interface InteractiveMapProps {
    routes?: RouteItem[];
    activeRouteId?: string;
    reports?: ReportMarker[];
    startCoords?: [number, number];
    endCoords?: [number, number];
    endDetail?: string;
    /** "Start" for the default origin, "You" when using GPS */
    startLabel?: string;
    reduceMotion?: boolean;
    highContrast?: boolean;
    labelScale?: number;
    language?: ResidentLanguage;
    routeRoof?: [number, number][][];
    routeShade?: ShadeStretch[];
    shadeAt?: string;
    solar?: SolarModel;
    conditionSegments?: EnvironmentSegment[];
    describeAsset?: (asset: WalkingAsset) => string[];
    onShadeReport?: (id: number, point?: [number, number]) => void;

    /**
     * Admin dashboard mode. When `pins` is given the map shows numbered, ranked defect pins
     * instead of the start / destination / route display, and ignores routes, reports and endCoords.
     */
    pins?: OverviewPin[];
    selectedPinId?: string | number | null;
    hoveredPinId?: string | number | null;
    onPinSelect?: (id: string | number) => void;
    /** Text of the "fit everything" button */
    fitLabel?: string;
    assets?: WalkingAsset[];
    onLocationSelect?: (lat: number, lng: number) => void;
    selectedLocation?: [number, number];
    environment?: { edges: PathEdge[]; records: VerificationRecord[]; at: string };
    informationLayer?: EnvironmentLayer | 'routes';
    showLayerControls?: boolean;
    localBasemap?: string;
    mapAppearance?: MapAppearance;
    showTerrain?: boolean;
    showTerrainMesh?: boolean;
    terrainDetail?: TerrainDetail | null;
    onInformationLayerChange?: (layer: EnvironmentLayer | 'routes') => void;
    focusLocation?: [number, number];
    liveLocation?: [number, number];
}

function LocationPicker({ onSelect }: { onSelect?: (lat: number, lng: number) => void }) {
    useMapEvents({ click: event => onSelect?.(event.latlng.lat, event.latlng.lng) });
    return null;
}

// Leaflet 1.9 can leave a queued canvas redraw after a synchronous redraw
// clears its frame handle. On fast pilot/mode switches that callback can run
// after the canvas context is destroyed. Guard only the resident renderer
// instances, retaining canvas performance for the detailed local basemap.
const leafletCanvasRedraw = (L.Canvas.prototype as unknown as { _redraw: (this: L.Canvas) => void })._redraw;
class ResidentCanvas extends L.Canvas {
    private attached = false;
    onAdd(map: L.Map): this {
        this.attached = true;
        return super.onAdd(map);
    }
    onRemove(map: L.Map): this {
        this.attached = false;
        return super.onRemove(map);
    }
    _redraw() {
        if (this.attached) leafletCanvasRedraw.call(this);
    }
}

const assetIcon = (symbol: string) => L.divIcon({ className: 'tg-leaflet-facility', iconSize: [44,44], iconAnchor: [22,22],
    html: `<span>${symbol}</span>` });

const WARN = '#F2B400';
const INK = '#1B1F23';

/* ---------- Walk mode pins: shape + text label, never colour alone ---------- */
function labelPill(text: string, bg: string, fg: string) {
    return `<div style="margin-top:4px;padding:2px 10px;border-radius:999px;background:${bg};color:${fg};
        font:800 .875rem/1.3 system-ui,sans-serif;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.35);
        white-space:nowrap">${text}</div>`;
}

function makePin(kind: 'start' | 'end' | 'hazard', label: string, brand: string, dx = 0) {
    let circle = '';
    let pill = '';

    if (kind === 'start') {
        circle = `<div style="width:44px;height:44px;border-radius:50%;background:${brand};border:4px solid #fff;
            box-shadow:0 2px 6px rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center">
            <div style="width:14px;height:14px;border-radius:50%;background:#fff"></div></div>`;
        pill = labelPill(label, brand, '#fff');
    } else if (kind === 'end') {
        circle = `<div style="width:44px;height:44px;border-radius:50%;background:${INK};border:4px solid #fff;
            box-shadow:0 2px 6px rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.6"
                stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M6 3v18"/><path d="M6 4h12l-3 4 3 4H6" fill="#fff"/></svg></div>`;
        pill = labelPill(label, INK, '#fff');
    } else {
        circle = `<svg width="46" height="42" viewBox="0 0 46 42" aria-hidden="true">
            <path d="M23 3 L43 38 H3 Z" fill="${WARN}" stroke="${INK}" stroke-width="3.5" stroke-linejoin="round"/>
            <rect x="21" y="15" width="4" height="12" rx="2" fill="${INK}"/>
            <circle cx="23" cy="32" r="2.4" fill="${INK}"/></svg>`;
        pill = labelPill(label, WARN, INK);
    }

    return L.divIcon({
        className: '',
        html: `<div style="display:flex;flex-direction:column;align-items:center;width:130px">${circle}${pill}</div>`,
        iconSize: [130, 76],
        iconAnchor: [65 + dx, 22], // dx > 0 shifts the pin to the left of its real position
        popupAnchor: [-dx, -20],
    });
}

/* ---------- Overview mode pins: numbered by priority. Circle = critical, rounded square = moderate ---------- */
function makeRankPin(rank: number, severity: 'blocker' | 'comfort', state: 'normal' | 'hover' | 'selected', brand: string) {
    const critical = severity === 'blocker';
    const size = state === 'selected' ? 44 : state === 'hover' ? 38 : 32;
    const bg = critical ? brand : WARN;
    const fg = critical ? '#fff' : INK;
    const radius = critical ? '50%' : '9px';
    const shadow = state === 'selected' ? `0 0 0 3px #fff, 0 0 0 6px ${INK}` : '0 2px 5px rgba(0,0,0,.45)';
    const fontSize = state === 'selected' ? 18 : 14;

    return L.divIcon({
        className: '',
        html: `<div style="width:${size}px;height:${size}px;border-radius:${radius};background:${bg};color:${fg};
            border:3px solid #fff;box-shadow:${shadow};display:flex;align-items:center;justify-content:center;
            font:800 ${fontSize}px/1 system-ui,sans-serif">${Number(rank)}</div>`,
        iconSize: [size, size],
        iconAnchor: [size / 2, size / 2],
    });
}

/* Gives a pin a spoken name without Leaflet's hover tooltip (which was covering other pins) */
function ariaLabelOnAdd(label: string) {
    return (e: L.LeafletEvent) => {
        (e.target as L.Marker).getElement()?.setAttribute('aria-label', label);
    };
}

/* ---------- Camera + zoom buttons ---------- */
function MapBehavior({
    points,
    focus,
    reduceMotion,
    brand,
    fitLabel,
    maxZoom,
    language,
}: {
    points: [number, number][];
    focus: [number, number] | null;
    reduceMotion: boolean;
    brand: string;
    fitLabel: string;
    maxZoom: number;
    language: ResidentLanguage;
}) {
    const map = useMap();
    const deferredCamera = useRef<(() => void) | null>(null);

    const fit = useCallback(
        (animate: boolean) => {
            const el = map.getContainer();
            if (points.length === 0 || !el.isConnected || !el.clientWidth || !el.clientHeight) return;
            map.fitBounds(L.latLngBounds(points), {
                paddingTopLeft: [40, 40],
                paddingBottomRight: [76, 76],
                maxZoom,
                animate: animate && !reduceMotion,
                duration: 1,
            });
        },
        [map, points, reduceMotion, maxZoom],
    );

    // Fly to the focused point if there is one, otherwise show everything
    const focusKey = focus ? `${focus[0]},${focus[1]}` : '';
    useEffect(() => {
        const applyCamera = () => {
            const el = map.getContainer();
            if (!el.isConnected || !el.clientWidth || !el.clientHeight) {
                deferredCamera.current = applyCamera;
                return;
            }
            deferredCamera.current = null;
            if (focus) {
                const zoom = Math.max(map.getZoom(), 17);
                if (reduceMotion) map.setView(focus, zoom, { animate: false });
                else map.flyTo(focus, zoom, { duration: 0.8 });
            } else {
                fit(true);
            }
        };
        applyCamera();
        return () => { if (deferredCamera.current === applyCamera) deferredCamera.current = null; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [fit, focusKey]);

    // The panels around the map can change size, so keep Leaflet in sync
    useEffect(() => {
        const el = map.getContainer();
        let active = true;
        // Saved/Profile hide the map. Updating Leaflet at zero size can move
        // its camera off the displayed area, and queued observers must not
        // touch a removed map when a pilot tab is replaced.
        const ro = new ResizeObserver(() => {
            if (active && el.isConnected && el.clientWidth && el.clientHeight) {
                map.invalidateSize({ animate: false });
                deferredCamera.current?.();
            }
        });
        ro.observe(el);
        return () => { active = false; ro.disconnect(); };
    }, [map]);

    useEffect(()=>{
        const scale=L.control.scale({position:'bottomright',imperial:false,maxWidth:90});scale.addTo(map);
        return()=>{scale.remove();};
    },[map]);

    // Taps on our buttons must not reach the map
    const stopPropagation = useCallback((el: HTMLDivElement | null) => {
        if (el) {
            L.DomEvent.disableClickPropagation(el);
            L.DomEvent.disableScrollPropagation(el);
        }
    }, []);

    const squareBtn: CSSProperties = {
        width: 48,
        height: 48,
        borderRadius: 14,
        border: '1px solid #d6d4cf',
        background: '#fff',
        color: '#1B1F23',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
        boxShadow: '0 3px 12px rgba(39,35,43,.14)',
    };

    return (
        <>
            {/* Zoom: top right */}
            <div
                ref={stopPropagation} className="tg-leaflet-zoom"
                style={{ position: 'absolute', top: 12, right: 12, zIndex: 1000, display: 'flex', flexDirection: 'column', gap: 10 }}
            >
                <button type="button" aria-label={residentText(language, 'Zoom in')} style={squareBtn} onClick={() => map.zoomIn()}>
                    <Plus size={23} strokeWidth={2.4} aria-hidden />
                </button>
                <button type="button" aria-label={residentText(language, 'Zoom out')} style={squareBtn} onClick={() => map.zoomOut()}>
                    <Minus size={23} strokeWidth={2.4} aria-hidden />
                </button>
            </div>

            {/* Fit everything: bottom left, away from the pins and the zoom buttons */}
            <div className="tg-leaflet-fit" ref={stopPropagation} style={{ position: 'absolute', left: 12, bottom: 34, zIndex: 1000 }}>
                <button
                    type="button"
                    aria-label={fitLabel}
                    onClick={() => fit(true)}
                    style={{
                        ...squareBtn,
                        width: 'auto',
                        padding: '0 14px',
                        gap: 8,
                        background: ROUTE_OUTLINE,
                        border: '1px solid #ded2ca',
                        color: brand,
                        font: '650 .9rem var(--font-geist-sans),system-ui,sans-serif',
                    }}
                >
                    <RouteIcon size={20} aria-hidden />
                    <span>{fitLabel}</span>
                </button>
            </div>
        </>
    );
}

export default function InteractiveMap({
    routes = [],
    activeRouteId = '',
    reports = [],
    startCoords = DEFAULT_ORIGIN,
    endCoords: requestedEndCoords,
    endDetail,
    startLabel = 'Start',
    reduceMotion = false,
    highContrast = false,
    labelScale = 1,
    language = 'en',
    routeRoof = [],
    pins,
    selectedPinId = null,
    hoveredPinId = null,
    onPinSelect,
    fitLabel,
    assets = [],
    onLocationSelect,
    selectedLocation,
    environment,
    informationLayer,
    conditionSegments, routeShade, describeAsset, onShadeReport, solar, shadeAt,
    showLayerControls = true,
    localBasemap, mapAppearance = 'detailed', showTerrain = true, terrainDetail,
    onInformationLayerChange,
    focusLocation,
    liveLocation,
}: InteractiveMapProps) {
    const baseArea=localBasemap?.match(/\/map-area\/([^/]+)\.geojson$/)?.[1];
    const localTerrain=useMapTerrain(terrainDetail===undefined&&isPilot(baseArea)?baseArea:undefined);
    const terrain=terrainDetail===undefined?localTerrain.detail:terrainDetail;
    const endCoords=requestedEndCoords??startCoords;
    const hasDestination=Boolean(requestedEndCoords);
    const brand = highContrast ? WALK_ROUTE_HC : WALK_ROUTE;
    const overview = pins !== undefined;
    const largeTiles = labelScale > 1;
    // Resident maps resize or unmount during tab/pilot switches. Leaflet 1.9's
    // CSS zoom completion timeout can outlive its map pane; use synchronous
    // zoom for these maps. Pan/fly-to motion and map styling are unchanged.
    const zoomAnimation = !localBasemap && !reduceMotion;
    const renderer = useMemo(() => localBasemap ? new ResidentCanvas() : undefined, [localBasemap]);
    const [localLayer, setLocalLayer] = useState<EnvironmentLayer | 'routes'>('routes');
    const layer = informationLayer ?? localLayer;
    const layerEdges = environment?.edges, layerRecords = environment?.records, layerTime = environment?.at;
    const segments = useMemo(() => conditionSegments ?? (layerEdges && layerRecords && layerTime && layer !== 'routes'
        ? environmentSegments(layerEdges, layerRecords, layerTime, layer) : []), [conditionSegments, layerEdges, layerRecords, layerTime, layer]);
    const coverage = environmentCoverage(segments);

    /* ----- Walk mode ----- */
    const startIcon = useMemo(() => makePin('start', startLabel, brand), [startLabel, brand]);
    const endLabel = residentText(language, 'Destination');
    const endIcon = useMemo(() => makePin('end', endLabel, brand), [brand, endLabel]);

    // Group problems reported at (almost) the same spot, and nudge a group aside if it sits on the start or destination pin
    const hazardGroups = useMemo(() => {
        if (overview) return [];
        const groups = new Map<string, { lat: number; lng: number; items: ReportMarker[] }>();
        reports.forEach((r) => {
            const lat = r.lat ?? r.latitude;
            const lng = r.lng ?? r.longitude;
            if (lat == null || lng == null) return;
            const key = `${Number(lat).toFixed(4)},${Number(lng).toFixed(4)}`;
            const g = groups.get(key);
            if (g) g.items.push(r);
            else groups.set(key, { lat, lng, items: [r] });
        });
        const NEAR_M = 40;
        const SHIFT_PX = 66;
        return [...groups.values()].map((g) => {
            const here = L.latLng(g.lat, g.lng);
            const nearStart = here.distanceTo(L.latLng(startCoords)) < NEAR_M;
            const nearEnd = hasDestination&&here.distanceTo(L.latLng(endCoords)) < NEAR_M;
            const dx = nearStart ? SHIFT_PX : nearEnd ? -SHIFT_PX : 0; // start: pin goes left, destination: pin goes right
            const label = g.items.length > 1 ? `${g.items.length} problems` : 'Problem';
            return { ...g, label, icon: makePin('hazard', label, brand, dx) };
        });
    }, [overview, reports, startCoords, endCoords, hasDestination, brand]);

    // Draw the chosen route last so it sits on top
    const ordered = useMemo(
        () => [...routes].sort((a, b) => Number(a.id === activeRouteId) - Number(b.id === activeRouteId)),
        [routes, activeRouteId],
    );

    /* ----- Overview mode ----- */
    const pinMarkers = useMemo(
        () =>
            (pins ?? []).map((pin) => {
                const state: 'normal' | 'hover' | 'selected' =
                    String(pin.id) === String(selectedPinId) ? 'selected'
                        : String(pin.id) === String(hoveredPinId) ? 'hover'
                            : 'normal';
                return { pin, state, icon: makeRankPin(pin.rank, pin.severity, state, brand) };
            }),
        [pins, selectedPinId, hoveredPinId, brand],
    );

    const selectedPin = overview ? (pins ?? []).find((p) => String(p.id) === String(selectedPinId)) : undefined;

    /* ----- What the camera should frame ----- */
    const activeRoute = routes.find((r) => r.id === activeRouteId) ?? routes[0];
    const routeCoords = activeRoute?.coordinates ?? [];
    const fitSignature = overview
        ? `o:${(pins ?? []).map((p) => `${p.id}@${p.lat},${p.lng}`).join('|')}`
        : `w:${activeRoute?.id}:${routeCoords.length}:${routeCoords[0]?.join(',')}:${routeCoords[routeCoords.length - 1]?.join(',')}:${startCoords.join(',')}:${hasDestination?endCoords.join(','):'no destination'}`;

    const fitPoints = useMemo<[number, number][]>(() => {
        if (overview) {
            const list = (pins ?? []).map((p) => [p.lat, p.lng] as [number, number]);
            return list.length > 0 ? list : [startCoords];
        }
        const list: [number, number][] = routeCoords.length > 1 ? [...routeCoords] : [];
        list.push(startCoords);if(hasDestination)list.push(endCoords);
        return list;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [fitSignature]);

    const focus = useMemo<[number, number] | null>(
        () => (focusLocation ?? (selectedPin ? [selectedPin.lat, selectedPin.lng] : null)),
        [selectedPin?.lat, selectedPin?.lng, focusLocation], // eslint-disable-line react-hooks/exhaustive-deps
    );

    const popupText: CSSProperties = { fontSize: 15, lineHeight: 1.4, fontFamily: 'system-ui,sans-serif' };
    const popupProps = { maxWidth: 260, autoPanPaddingTopLeft: [16, 16] as [number, number], autoPanPaddingBottomRight: [76, 16] as [number, number] };

    return (
        <div className="w-full h-full relative z-0">
            <MapContainer
                center={startCoords}
                zoom={16}
                scrollWheelZoom
                className="w-full h-full"
                zoomControl={false}
                maxZoom={localBasemap ? 21 : 19}
                zoomAnimation={zoomAnimation}
                fadeAnimation={!reduceMotion}
                renderer={renderer}
                preferCanvas={Boolean(localBasemap)}
            >
                {localBasemap && <Pane name="pilot-basemap" style={{ zIndex: mapAppearance==='street'?190:240 }}><LocalBasemap url={localBasemap} appearance={mapAppearance} showTerrain={showTerrain} terrain={terrain}
                    labelScale={labelScale} language={language} highContrast={highContrast} inspect={!onLocationSelect&&!overview} solar={layer==='shade'?solar:undefined} shadeAt={shadeAt}/></Pane>}
                <TileLayer
                    key={largeTiles ? 'large-labels' : 'regular-labels'}
                    attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>'
                    url={process.env.NEXT_PUBLIC_OSM_TILE_URL || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'}
                    tileSize={largeTiles ? 512 : 256}
                    zoomOffset={largeTiles ? -1 : 0}
                    minNativeZoom={largeTiles ? 1 : 0}
                    maxNativeZoom={largeTiles ? 20 : 19}
                    maxZoom={localBasemap?21:19}
                />
                <LocationPicker onSelect={onLocationSelect} />
                {segments.map(segment => {
                    const unknown = segment.value === null;
                    const strength = typeof segment.value === 'boolean' ? Number(segment.value) : segment.value ?? 0;
                    const color = unknown ? '#64748b' : layer === 'paths' ? '#475569' : layer === 'observations' ? '#5b55a1'
                        : segment.source === 'reported' || strength < .65 ? MAP_CAUTION : ROOF_COVER;
                    return <Polyline key={`environment:${layer}:${segment.id}`} positions={segment.geometry.map(([lng, lat]) => [lat, lng] as [number, number])}
                        pathOptions={{ color, weight: unknown ? 2 : 4, opacity: unknown ? .35 : .8,
                            dashArray: unknown ? '3 7' : segment.source === 'checked' ? undefined : '9 5' }}>
                        <Tooltip sticky><strong>{segment.name}</strong><p>{segment.detail}</p></Tooltip>
                        <Popup {...popupProps}><strong>{segment.name}</strong><p>{segment.detail}</p>
                            {layer === 'shade' && onShadeReport && <button type="button" className="tg-text-action" onClick={() => onShadeReport(segment.id)}>{residentText(language, 'Report shade here')}</button>}
                        </Popup>
                    </Polyline>;
                })}
                {selectedLocation && <Marker position={selectedLocation} icon={assetIcon('◎')}><Popup>{residentText(language, 'Incident location')}</Popup></Marker>}
                {focusLocation && <Marker position={focusLocation} icon={assetIcon('◎')}><Popup>{residentText(language, 'Selected map point')}</Popup></Marker>}
                {assets.map(asset => mapFacilitySymbol(asset) && <Marker key={`asset:${asset.id}`} position={[asset.lat, asset.lng]} icon={assetIcon(mapFacilitySymbol(asset))}
                    eventHandlers={{ add: ariaLabelOnAdd(asset.name) }}>
                    <Tooltip>{asset.name}</Tooltip>
                    <Popup><strong>{asset.name}</strong>{describeAsset ? describeAsset(asset).map(line => <p key={line}>{line}</p>) : <p>{asset.kind}</p>}</Popup>
                </Marker>)}

                <MapBehavior
                    points={fitPoints}
                    focus={focus}
                    reduceMotion={reduceMotion}
                    brand={brand}
                    fitLabel={fitLabel ?? (overview ? 'Show all' : residentText(language, routes?.length?'Whole route':'Recenter'))}
                    maxZoom={overview ? 17 : 18}
                    language={language}
                />
                {liveLocation && <CircleMarker center={liveLocation} radius={8} pathOptions={{ color: '#fff', weight: 3, fillColor: '#1d4ed8', fillOpacity: 1 }}><Tooltip>Your last usable GPS position</Tooltip></CircleMarker>}

                {/* ======== Overview mode (admin) ======== */}
                {overview && pinMarkers.map(({ pin, state, icon }) => (
                    <Marker
                        key={String(pin.id)}
                        position={[pin.lat, pin.lng]}
                        icon={icon}
                        zIndexOffset={state === 'selected' ? 1000 : state === 'hover' ? 500 : 0}
                        eventHandlers={{
                            click: () => onPinSelect?.(pin.id),
                            add: ariaLabelOnAdd(`${pin.rank}. ${pin.title}`),
                        }}
                    >
                        <Tooltip direction="top" offset={[0, -(state === 'selected' ? 22 : 16)]}>
                            <div style={popupText}>
                                <b>{pin.rank}. {pin.title}</b>
                                {pin.detail && <div>{pin.detail}</div>}
                            </div>
                        </Tooltip>
                    </Marker>
                ))}

                {/* ======== Walk mode (resident) ======== */}
                {!overview && (
                    <>
                        {/* Routes: white outline first, then the coloured line on top */}
                        {ordered.map((route) => {
                            const isActive = route.id === activeRouteId;
                            return (
                                <Polyline
                                    key={`${route.id}-casing`}
                                    positions={route.coordinates}
                                    pathOptions={{
                                        color: ROUTE_OUTLINE,
                                        weight: isActive ? 11 : 5,
                                        opacity: 0.95,
                                        lineCap: 'round',
                                        lineJoin: 'round',
                                    }}
                                />
                            );
                        })}
                        {ordered.map((route) => {
                            const isActive = route.id === activeRouteId;
                            return (
                                <Polyline
                                    key={route.id}
                                    positions={route.coordinates}
                                    pathOptions={{
                                        color: isActive ? brand : ROUTE_ALTERNATIVE,
                                        weight: isActive ? 7 : 3,
                                        opacity: isActive ? 1 : 0.8,
                                        dashArray: isActive ? undefined : '3 5',
                                        lineCap: 'round',
                                        lineJoin: 'round',
                                    }}
                                />
                            );
                        })}
                        {routeRoof.map((line, index) => <Polyline key={`roof:${index}`} positions={line} interactive={false}
                            pathOptions={{ color: ROOF_COVER, weight: 7, lineCap: 'round' }} />)}
                        {routeRoof.map((line, index) => <Polyline key={`roof-pattern:${index}`} positions={line} interactive={false}
                            pathOptions={{ color: ROUTE_OUTLINE, weight: 2, dashArray: '1 5', lineCap: 'round' }} />)}

                        {layer === 'shade' && routeShade?.filter(stretch => stretch.condition === 'sun' || stretch.condition === 'unknown' || stretch.condition === 'shade')
                            .map((stretch, index) => <Polyline key={`route-shade:${index}`}
                                positions={stretch.geometry.map(([lng, lat]) => [lat, lng])}
                                pathOptions={{ color: stretch.condition === 'sun' ? MAP_CAUTION : stretch.condition === 'unknown' ? '#64748b' : '#335ca3',
                                    weight: 5, dashArray: stretch.condition === 'unknown' ? '3 5' : undefined }}>
                                <Popup {...popupProps}><strong>{shadeLabel(stretch, language)}</strong>
                                    {stretch.edge_id !== undefined && onShadeReport && <button type="button" className="tg-text-action" onClick={() => {
                                        const [lng, lat] = stretch.geometry[Math.floor(stretch.geometry.length / 2)];
                                        onShadeReport(stretch.edge_id!, [lat, lng]);
                                    }}>{residentText(language, 'Report shade here')}</button>}</Popup>
                            </Polyline>)}

                        {/* Problems reported by residents (drawn under the start and destination pins) */}
                        {hazardGroups.map((g) => (
                            <Marker
                                key={`${g.lat},${g.lng}`}
                                position={[g.lat, g.lng]}
                                icon={g.icon}
                                zIndexOffset={0}
                                eventHandlers={{ add: ariaLabelOnAdd(g.label) }}
                            >
                                <Popup {...popupProps}>
                                    <div style={popupText}>
                                        {g.items.slice(0, 3).map((report, i) => (
                                            <div key={report.id ?? i} style={{ marginTop: i ? 8 : 0 }}>
                                                <p style={{ fontWeight: 800, margin: 0 }}>
                                                    {report.category || report.kind || 'Reported problem'}
                                                </p>
                                                <p style={{ margin: '2px 0 0' }}>
                                                    {report.description || 'A resident reported an issue here.'}
                                                </p>
                                            </div>
                                        ))}
                                        {g.items.length > 3 && (
                                            <p style={{ margin: '8px 0 0', fontWeight: 700 }}>and {g.items.length - 3} more</p>
                                        )}
                                    </div>
                                </Popup>
                            </Marker>
                        ))}

                        {hasDestination&&<Marker position={endCoords} icon={endIcon} zIndexOffset={900} eventHandlers={{ add: ariaLabelOnAdd(endLabel) }}>
                            <Popup {...popupProps}>
                                <div style={{ ...popupText, fontWeight: 800 }}>{endDetail ?? endLabel}</div>
                            </Popup>
                        </Marker>}

                        <Marker position={startCoords} icon={startIcon} zIndexOffset={1000} eventHandlers={{ add: ariaLabelOnAdd(startLabel) }}>
                            <Popup {...popupProps}>
                                <div style={{ ...popupText, fontWeight: 800 }}>
                                    {startLabel === 'You' ? 'You are here' : 'Where your walk starts'}
                                </div>
                            </Popup>
                        </Marker>
                    </>
                )}
            </MapContainer>
            {environment && showLayerControls && <section aria-label="Map information layers" className="absolute left-3 top-3 z-[1100] max-h-[calc(100%-5.25rem)] w-56 max-w-[calc(100%-5.25rem)] overflow-y-auto rounded-xl border-2 border-slate-300 bg-white/95 p-2 text-slate-900 shadow-sm">
                <label className="flex items-center gap-2 text-sm font-bold"><Layers size={18} className="shrink-0 text-emerald-800" aria-hidden />
                    <select aria-label="Map information" value={layer} onChange={e => {
                        const value = e.target.value as EnvironmentLayer | 'routes';
                        setLocalLayer(value); onInformationLayerChange?.(value);
                    }} className="min-h-11 min-w-0 flex-1 bg-transparent text-sm">
                        <option value="routes">Walking routes</option><option value="paths">Pedestrian network</option><option value="shade">Shade records</option><option value="cover">Covered paths</option><option value="lighting">Lighting records</option><option value="observations">Field observations</option>
                    </select>
                </label>
                {layer !== 'routes' && <div role="status" className="border-t border-slate-200 pt-2 text-xs leading-relaxed">
                    <p className="font-semibold">{coverage.known} / {coverage.total} {layer === 'observations' ? 'with current observations' : 'with information'}</p>
                    <p className="mt-1 text-slate-600">{layer === 'paths' ? 'Mapped paths; on-site conditions still need checking.' : 'At your selected departure. Dashed gray = unknown; open a line for its source.'}</p>
                </div>}
            </section>}
        </div>
    );
}
