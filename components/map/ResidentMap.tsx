'use client';

import dynamic from 'next/dynamic';
import { useCallback, useMemo, useState } from 'react';
import { Box, ChevronDown, Layers, Map as MapIcon, MapPin } from 'lucide-react';
import { sitePath } from '@/lib/site';
import type { PilotId, PilotNeighbourhood } from '@/lib/pilots';
import { environmentCoverage, environmentSegments, type EnvironmentLayer } from '@/lib/environment';
import type { InteractiveMapProps } from './InteractiveMap';
import './resident-map.css';

const Map2D = dynamic(() => import('./InteractiveMap'), { ssr: false });
const Map3D = dynamic(() => import('./ResidentMap3D'), { ssr: false });

export type MapMode = '2d' | '3d';

export default function ResidentMap({
    area, mapMode, onMapModeChange, informationLayer = 'routes', onInformationLayerChange,
    neighbourhoods, onNeighbourhoodChange, ...mapProps
}: InteractiveMapProps & { area: PilotId; mapMode?: MapMode; onMapModeChange?: (mode: MapMode) => void;
    neighbourhoods?: PilotNeighbourhood[]; onNeighbourhoodChange?: (point?: [number, number]) => void }) {
    const [localMode, setLocalMode] = useState<MapMode>('3d');
    const [failed, setFailed] = useState(false);
    const fallback = useCallback(() => setFailed(true), []);
    const mode = failed ? '2d' : mapMode ?? localMode;
    const MapModeIcon = mode === '3d' ? Box : MapIcon;
    const { edges, records, at } = mapProps.environment ?? {};
    const segments = useMemo(() => informationLayer !== 'routes' && edges && records && at
        ? environmentSegments(edges, records, at, informationLayer) : [],
    [informationLayer, edges, records, at]);
    const coverage = environmentCoverage(segments);
    const neighbourhood = neighbourhoods?.find(item => item.coordinates === mapProps.focusLocation);

    function changeMode(next: MapMode) {
        setFailed(false);
        setLocalMode(next);
        onMapModeChange?.(next);
    }

    return (
        <div data-map-mode={mode} className="resident-map absolute inset-0 bg-[#e8ede6]" aria-label="Walking map">
            {mode === '2d'
                ? <Map2D {...mapProps} informationLayer={informationLayer} showLayerControls={false}
                    localBasemap={sitePath(`/map-area/${area}.geojson`)} />
                : <Map3D {...mapProps} area={area} segments={segments} informationLayer={informationLayer} onUnavailable={fallback} />}
            <div className="tg-map-controls">
                <label className="tg-map-choice tg-map-view">
                    <MapModeIcon size={17} aria-hidden />
                    <span className="sr-only">Map view</span>
                    <select value={mode} onChange={event => changeMode(event.target.value as MapMode)}>
                        <option value="3d">3D map</option>
                        <option value="2d">2D map</option>
                    </select>
                    <ChevronDown size={14} aria-hidden />
                </label>
                {mapProps.environment && (
                    <label className="tg-map-choice tg-map-information">
                        <Layers size={17} aria-hidden />
                        <span className="sr-only">Map information</span>
                        <select value={informationLayer} onChange={event => onInformationLayerChange?.(event.target.value as EnvironmentLayer | 'routes')}>
                            <option value="routes">Routes</option>
                            <option value="paths">Footpaths</option>
                            <option value="cover">Roof cover</option>
                            <option value="shade">Shade estimates and checks</option>
                            <option value="lighting">Lighting</option>
                            <option value="observations">Field checks</option>
                        </select>
                        <ChevronDown size={14} aria-hidden />
                    </label>
                )}
                {!!neighbourhoods?.length && (
                    <label className="tg-map-choice tg-map-neighbourhood">
                        <MapPin size={17} aria-hidden />
                        <span className="sr-only">Map neighbourhood</span>
                        <select value={neighbourhood?.id ?? ''} onChange={event => {
                            onNeighbourhoodChange?.(neighbourhoods.find(item => item.id === event.target.value)?.coordinates);
                        }}>
                            <option value="">Map neighbourhoods</option>
                            {neighbourhoods.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
                        </select>
                        <ChevronDown size={14} aria-hidden />
                    </label>
                )}
                {neighbourhood && !neighbourhood.connected_to_core && <p role="status" className="tg-map-status">
                    {neighbourhood.start ? 'Local walks available. The connection to Pasar Seni needs mapping.'
                        : 'Places and streets are mapped here. Walking connections need more detail.'}
                </p>}
                {failed && <p role="status" className="tg-map-status">3D is unavailable on this device.</p>}
                {informationLayer !== 'routes' && <p role="status" className="tg-map-status">
                    {informationLayer === 'paths' ? `${coverage.total} mapped paths`
                        : `${coverage.known} of ${coverage.total} paths with data${coverage.modelled ? ` · ${coverage.modelled} estimated` : ''} · dashed gray means unknown`}
                </p>}
            </div>
        </div>
    );
}
