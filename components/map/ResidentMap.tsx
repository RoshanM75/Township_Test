'use client';

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box, Layers, Map as MapIcon, MapPin } from 'lucide-react';
import { sitePath } from '@/lib/site';
import type { PilotId, PilotNeighbourhood } from '@/lib/pilots';
import type { MapAppearance } from '@/lib/map-detail';
import { useMapTerrain } from './useMapTerrain';
import { environmentCoverage, environmentSegments, type EnvironmentLayer } from '@/lib/environment';
import type { InteractiveMapProps } from './InteractiveMap';
import { malaysiaTimeLabel, residentText, type ResidentLabel } from '@/lib/resident-language';
import './resident-map.css';

const Map2D = dynamic(() => import('./InteractiveMap'), { ssr: false });
const Map3D = dynamic(() => import('./ResidentMap3D'), { ssr: false });

export type MapMode = '2d' | '3d';

export default function ResidentMap({
    area, mapMode, onMapModeChange, informationLayer = 'routes', onInformationLayerChange,
    neighbourhoods, onNeighbourhoodChange, onNearby, language = 'en', ...mapProps
}: InteractiveMapProps & { area: PilotId; mapMode?: MapMode; onMapModeChange?: (mode: MapMode) => void;
    neighbourhoods?: PilotNeighbourhood[]; onNeighbourhoodChange?: (point?: [number, number]) => void; onNearby?: () => void }) {
    const t = (label: ResidentLabel) => residentText(language, label);
    const menu = useRef<HTMLDetailsElement>(null);
    const [localMode, setLocalMode] = useState<MapMode>('3d');
    const [failed, setFailed] = useState(false);
    const [appearance,setAppearance]=useState<MapAppearance>('detailed');
    const [showTerrain,setShowTerrain]=useState(true);
    const [showTerrainMesh,setShowTerrainMesh]=useState(false);
    const {detail:terrain,loading:terrainLoading}=useMapTerrain(area);
    const terrainVisible=showTerrain&&Boolean(terrain);
    const fallback = useCallback(() => setFailed(true), []);
    const mode = failed ? '2d' : mapMode ?? localMode;
    useEffect(()=>{
        const close=(event:PointerEvent)=>{if(menu.current?.open&&!menu.current.contains(event.target as Node))menu.current.open=false;};
        const escape=(event:KeyboardEvent)=>{if(event.key==='Escape'&&menu.current?.open){menu.current.open=false;menu.current.querySelector('summary')?.focus();}};
        document.addEventListener('pointerdown',close);document.addEventListener('keydown',escape);
        return()=>{document.removeEventListener('pointerdown',close);document.removeEventListener('keydown',escape);};
    },[]);
    const { edges, records, at } = mapProps.environment ?? {};
    const segments = useMemo(() => informationLayer !== 'routes' && edges && records && at
        ? environmentSegments(edges, records, at, informationLayer, mapProps.solar) : [],
    [informationLayer, edges, records, at, mapProps.solar]);
    const coverage = environmentCoverage(segments);
    const neighbourhood = neighbourhoods?.find(item => item.coordinates === mapProps.focusLocation);

    function changeMode(next: MapMode) {
        setFailed(false);
        setLocalMode(next);
        onMapModeChange?.(next);
    }

    return (
        <div data-map-mode={mode} className="resident-map absolute inset-0" aria-label={t('Walking map')}>
            {mode === '2d'
                ? <Map2D key={area} {...mapProps} language={language} informationLayer={informationLayer} showLayerControls={false} conditionSegments={segments}
                    localBasemap={sitePath(`/map-area/${area}.geojson`)} mapAppearance={appearance} showTerrain={terrainVisible} terrainDetail={terrain} />
                : <Map3D key={area} {...mapProps} language={language} area={area} segments={segments} informationLayer={informationLayer} onUnavailable={fallback} terrainDetail={terrain} showTerrain={terrainVisible} showTerrainMesh={showTerrainMesh} />}
            <div className="tg-map-controls">
                <div className="tg-map-mode-switch" role="group" aria-label={t('Map view')}>
                    <button type="button" aria-pressed={mode==='2d'} onClick={()=>changeMode('2d')} title={t('2D map')}><MapIcon size={16} aria-hidden/>2D</button>
                    <button type="button" aria-pressed={mode==='3d'} onClick={()=>changeMode('3d')} title={t('3D map')}><Box size={16} aria-hidden/>3D</button>
                </div>
                <details className="tg-map-settings" ref={menu}>
                    <summary className="tg-map-choice" aria-label={t('Map options')} data-active={informationLayer!=='routes'||(mode==='2d'&&appearance==='street')}><Layers size={18} aria-hidden /><span>{t('Layers')}</span></summary>
                    <div className="tg-map-settings-panel">
                        {mode==='2d'&&<label>{t('Map appearance')}
                            <select value={appearance} onChange={event=>{setAppearance(event.target.value as MapAppearance);if(menu.current)menu.current.open=false;}}>
                                <option value="detailed">{t('Detailed streets')}</option><option value="street">{t('Original street map')}</option>
                            </select>
                        </label>}
                        {(mode==='3d'||appearance==='detailed')&&<div className="tg-map-terrain-setting">
                            <label><input type="checkbox" checked={terrainVisible} disabled={!terrain} onChange={event=>setShowTerrain(event.target.checked)}/><span>{t('Terrain relief')}</span></label>
                            {mode==='3d'&&terrainVisible&&<label><input type="checkbox" checked={showTerrainMesh} onChange={event=>setShowTerrainMesh(event.target.checked)}/><span>{t('3D ground terrain')}</span></label>}
                            {mode==='3d'&&showTerrainMesh&&terrainVisible&&<p>{t('View hills and valleys in perspective.')}</p>}
                            <p>{terrain?`${t('Terrain model')} · ~${terrain.sample_spacing_m} m ${t('sample spacing')} · ${t('20 m contours')}`:t(terrainLoading?'Loading detailed map…':'Terrain data unavailable')}</p>
                            {terrain&&<a className="tg-map-data-source" href={terrain.source_url} target="_blank" rel="noreferrer">Copernicus DEM / Open-Meteo · CC BY 4.0</a>}
                        </div>}

                        {mapProps.environment && <label>
                            {t('Map information')}
                            <select value={informationLayer} onChange={event => {
                                onInformationLayerChange?.(event.target.value as EnvironmentLayer | 'routes');
                                if(menu.current)menu.current.open=false;
                            }}>
                                {([['routes', 'Routes'], ['paths', 'Footpaths'], ['cover', 'Roof cover'], ['shade', 'Shade estimates and checks'],
                                    ['lighting', 'Lighting'], ['observations', 'Field checks']] as const).map(([id, label]) =>
                                    <option value={id} key={id}>{t(label)}</option>)}
                            </select>
                        </label>}
                        {!!neighbourhoods?.length && <label>{t('Map neighbourhood')}
                            <select value={neighbourhood?.id ?? ''} onChange={event => {
                                onNeighbourhoodChange?.(neighbourhoods.find(item => item.id === event.target.value)?.coordinates);
                                if (menu.current) menu.current.open = false;
                            }}>
                                <option value="">{t('Map neighbourhoods')}</option>
                                {neighbourhoods.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
                            </select>
                        </label>}
                        {(mode==='3d'||appearance==='detailed')&&<details className="tg-map-detail-key">
                            <summary>{t('Map detail')}</summary>
                            <p><i data-kind="steps" aria-hidden/>{t('Mapped steps')}</p>
                            <p><i data-kind="roof" aria-hidden/>{t('Mapped roof cover')}</p>
                            <p><i data-kind="unknown" aria-hidden/>{t('Height unknown; simplified 3D shape.')}</p>
                            {terrainVisible&&<p>{t('Approximate terrain, not a footpath slope measurement.')}</p>}
                        </details>}
                    </div>
                </details>
                {onNearby && <button type="button" className="tg-map-choice tg-map-nearby" aria-label={t('Nearby')} onClick={onNearby}><MapPin size={18} aria-hidden /><span>{t('Nearby')}</span></button>}
                {neighbourhood && !neighbourhood.connected_to_core && <p role="status" className="tg-map-status">
                    {neighbourhood.start ? 'Local walks available. The connection to Pasar Seni needs mapping.'
                        : 'Places and streets are mapped here. Walking connections need more detail.'}
                </p>}
                {failed && <p role="status" className="tg-map-status">{t('3D is unavailable on this device.')}</p>}
                {informationLayer === 'shade' && at && <p role="status" className="tg-map-status">{malaysiaTimeLabel(at, language)} MYT</p>}
                {informationLayer !== 'routes' && informationLayer !== 'shade' && <p role="status" className="tg-map-status">
                    {informationLayer === 'paths' ? `${coverage.total} mapped paths`
                        : `${coverage.known} of ${coverage.total} paths with data${coverage.modelled ? ` · ${coverage.modelled} estimated` : ''} · dashed gray means unknown`}
                </p>}
            </div>
            <div className="tg-map-keys">
                {informationLayer === 'shade' && <div className="tg-map-roof-key tg-map-shade-key">
                    <span><i data-shade="sun" aria-hidden />{t('Estimated direct sun')}</span>
                    <span><i data-shade="shade" aria-hidden />{t('Estimated shade')}</span>
                    <span><i data-shade="unknown" aria-hidden />{t('Unknown')}</span>
                </div>}
                {!!mapProps.routeRoof?.length && <p className="tg-map-roof-key"><span aria-hidden />{t('Mapped roof cover')}</p>}
            </div>
        </div>
    );
}
