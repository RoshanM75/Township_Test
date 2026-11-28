'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Crosshair } from 'lucide-react';
import {
    Map as LibreMap, AttributionControl, LngLatBounds, Marker, NavigationControl, Popup, ScaleControl,
    type GeoJSONSource, type StyleSpecification, type MapMouseEvent,
} from 'maplibre-gl';
import type { Feature, FeatureCollection, LineString, Polygon } from 'geojson';
import 'maplibre-gl/dist/maplibre-gl.css';
import { PILOTS, type PilotId } from '@/lib/pilots';
import { sitePath } from '@/lib/site';
import type { EnvironmentSegment } from '@/lib/environment';
import { DEFAULT_ORIGIN } from '@/lib/precinct';
import { residentText } from '@/lib/resident-language';
import { shadeLabel } from '@/lib/shade-display';
import type { InteractiveMapProps } from './InteractiveMap';
import { detailBaseLayers, detailBuildingLayers, detailLabelLayers, DETAIL_LABEL_LAYERS, INSPECT_BASE_LAYERS, labelSize } from './detailed-map-style';
import { featureDescription, type MapProperties } from '@/lib/map-detail';
import { attachTerrainLabels } from './terrain-labels';
import { MAP_CAUTION, ROOF_COVER, ROUTE_ALTERNATIVE, ROUTE_OUTLINE, WALK_ROUTE, WALK_ROUTE_HC, mapFacilitySymbol } from './walking-map-theme';

const empty: FeatureCollection = { type: 'FeatureCollection', features: [] };
const noRoof: [number, number][][] = [];
const lngLat = ([lat, lng]: [number, number]): [number, number] => [lng, lat];
const layerIds = ['walking-conditions', 'walking-routes', 'conditions-unknown'];

function mapStyle(area: PilotId): StyleSpecification {
    return {
        version: 8,
        glyphs: sitePath('/map-fonts/{fontstack}/{range}.pbf'),
        light: { anchor: 'map', color: '#fffaf3', intensity: .47, position: [1.4, 220, 50] },
        sources: {
            area: { type: 'geojson', data: sitePath(`/map-area/${area}.geojson`),
                attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>' },
            conditions: { type: 'geojson', data: empty },
            routes: { type: 'geojson', data: empty },
            roof: { type: 'geojson', data: empty },
            'cast-shadows': { type: 'geojson', data: empty },
            'route-shade': { type: 'geojson', data: empty },
        },
        layers: [
            ...detailBaseLayers().map(layer=>layer.minzoom===undefined?layer:{...layer,minzoom:Math.max(0,layer.minzoom-1)}),
            { id: 'ground-shadows', type: 'fill', source: 'cast-shadows', minzoom: 15.5,
                paint: { 'fill-color': '#3f4a64', 'fill-opacity': .25, 'fill-antialias': false } },
            ...detailBuildingLayers().map(layer=>({...layer,minzoom:(layer.minzoom??1)-1})),
            { id: 'conditions-unknown', type: 'line', source: 'conditions', filter: ['!', ['get', 'known']], paint: {
                'line-color': '#64748b', 'line-width': 2, 'line-opacity': 0.48, 'line-dasharray': [1, 2.5],
            } },
            { id: 'walking-conditions', type: 'line', source: 'conditions', filter: ['get', 'known'],
                layout: { 'line-cap': 'round', 'line-join': 'round' },
                paint: { 'line-width': 3.5, 'line-opacity': 0.87, 'line-color': ['get', 'colour'] } },
            { id: 'route-outline', type: 'line', source: 'routes', layout: {
                'line-cap': 'round', 'line-join': 'round', 'line-sort-key': ['get', 'order'],
            }, paint: { 'line-color': ROUTE_OUTLINE, 'line-width': ['case', ['get', 'active'], 11, 5] } },
            { id: 'other-walking-routes', type: 'line', source: 'routes', filter: ['!', ['get', 'active']],
                paint: { 'line-color': ROUTE_ALTERNATIVE, 'line-width': 3, 'line-dasharray': [2, 2.5] } },
            { id: 'walking-routes', type: 'line', source: 'routes', filter: ['get', 'active'], layout: {
                'line-cap': 'round', 'line-join': 'round', 'line-sort-key': ['get', 'order'],
            }, paint: { 'line-color': ['get', 'colour'], 'line-width': 7 } },
            { id: 'route-roof', type: 'line', source: 'roof', layout: { 'line-cap': 'round', 'line-join': 'round' },
                paint: { 'line-color': ROOF_COVER, 'line-width': 7 } },
            { id: 'route-roof-pattern', type: 'line', source: 'roof', layout: { 'line-cap': 'round' },
                paint: { 'line-color': ROUTE_OUTLINE, 'line-width': 2, 'line-dasharray': [0.5, 2.5] } },
            { id: 'route-shade-known', type: 'line', source: 'route-shade', filter: ['!=', ['get', 'condition'], 'unknown'],
                layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': ['get', 'colour'], 'line-width': 5 } },
            { id: 'route-shade-unknown', type: 'line', source: 'route-shade', filter: ['==', ['get', 'condition'], 'unknown'],
                paint: { 'line-color': '#64748b', 'line-width': 5, 'line-dasharray': [1, 1.5] } },
            ...detailLabelLayers().map(layer=>({...layer,minzoom:(layer.minzoom??1)-1})),
        ],
    };
}

function popupContent(title: string, detail?: string, action?: { label: string; run: () => void }) {
    const panel = document.createElement('div');
    const heading = document.createElement('strong');
    heading.textContent = title;
    panel.append(heading);
    if (detail) {
        const description = document.createElement('p');
        description.textContent = detail;
        panel.append(description);
    }
    if (action) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'tg-text-action';
        button.textContent = action.label;
        button.addEventListener('click', action.run);
        panel.append(button);
    }
    return panel;
}

function pin(map: LibreMap, position: [number, number], kind: string, symbol: string, label: string, detail?: string) {
    const element = document.createElement('button');
    element.type = 'button';
    element.className = `tg-map-pin tg-map-pin-${kind}`;
    element.setAttribute('aria-label', label);
    element.textContent = symbol;
    const popup = new Popup({ offset: 17, maxWidth: '245px' }).setDOMContent(popupContent(label, detail));
    return new Marker({ element, opacityWhenCovered: '1' }).setLngLat(lngLat(position)).setPopup(popup).addTo(map);
}

type Props = InteractiveMapProps & { area: PilotId; segments: EnvironmentSegment[]; onUnavailable: () => void };

export default function ResidentMap3D({
    area, segments, onUnavailable, startCoords = DEFAULT_ORIGIN, endCoords, endDetail, startLabel = 'Start', routes, fitLabel,
    activeRouteId, reports, assets, liveLocation, focusLocation, reduceMotion, highContrast,
    selectedLocation, onLocationSelect, informationLayer, routeRoof = noRoof, labelScale = 1, language = 'en',
    solar, shadeAt, routeShade, describeAsset, onShadeReport, terrainDetail, showTerrain = true, showTerrainMesh = false,
}: Props) {
    const container = useRef<HTMLDivElement>(null);
    const mapRef = useRef<LibreMap | null>(null);
    const deferredCamera = useRef<(() => void) | null>(null);
    const [loaded, setLoaded] = useState(false);
    const [mapReady,setMapReady]=useState(false);

    useEffect(() => {
        if (!container.current) return;
        let map: LibreMap;
        try {
            map = new LibreMap({
                container: container.current, style: mapStyle(area),
                center: lngLat(PILOTS[area].centre), zoom: 16.8, pitch: 40, bearing: 0,
                maxPitch: 65, maxZoom: 21, attributionControl: false,
            });
        } catch {
            onUnavailable();
            return;
        }
        mapRef.current = map;
        map.addControl(new NavigationControl({ visualizePitch: true }), 'top-right');
        map.addControl(new AttributionControl({ compact: true }), 'bottom-left');
        map.addControl(new ScaleControl({maxWidth:90,unit:'metric'}),'bottom-right');
        map.once('style.load', () => setLoaded(true));
        // A style can load before the large local GeoJSON is tiled. Do not
        // leave users looking at a blank base without an explanation.
        map.once('idle',()=>{if(mapRef.current===map)setMapReady(true);});
        map.once('webglcontextlost', onUnavailable);
        const el = container.current;
        const observer = new ResizeObserver(() => {
            if (mapRef.current === map && el.isConnected && el.clientWidth && el.clientHeight) {
                map.resize();
                deferredCamera.current?.();
            }
        });
        observer.observe(el);
        return () => {
            observer.disconnect();
            map.remove();
            mapRef.current = null;
        };
    }, [area, onUnavailable]);

    const active = routes?.find(route => route.id === activeRouteId) ?? routes?.[0];
    const activeCoordinates = active?.coordinates;
    const [startLat, startLng] = startCoords;
    const endLat = endCoords?.[0], endLng = endCoords?.[1];
    const fit = useMemo(() => {
        const points = activeCoordinates ?? [];
        const bounds = new LngLatBounds(lngLat([startLat, startLng]), lngLat([startLat, startLng]));
        for (const point of points) bounds.extend(lngLat(point));
        if (endLat !== undefined && endLng !== undefined) bounds.extend(lngLat([endLat, endLng]));
        return bounds;
    }, [activeCoordinates, startLat, startLng, endLat, endLng]);
    const focusLat = focusLocation?.[0], focusLng = focusLocation?.[1];

    useEffect(() => {
        const map = mapRef.current;
        if (!loaded || !map) return;
        for(const id of DETAIL_LABEL_LAYERS)map.setLayoutProperty(id,'text-size',labelSize(id,labelScale));
        for(const layer of detailLabelLayers())if(layer.type==='symbol')map.setPaintProperty(layer.id,'text-color',highContrast?'#232222':layer.paint?.['text-color']);
        for (const [selector, label] of [['zoom-in', 'Zoom in'], ['zoom-out', 'Zoom out']] as const) {
            const button = container.current?.querySelector(`.maplibregl-ctrl-${selector}`);
            button?.setAttribute('aria-label', residentText(language, label));
            button?.setAttribute('title', residentText(language, label));
        }
    }, [loaded, labelScale, language,highContrast]);

    useEffect(()=>{
        const map=mapRef.current;if(!loaded||!map)return;
        const activeTerrain=showTerrain&&terrainDetail;
        if(activeTerrain&&!map.getSource('terrain-grid')){
            map.addSource('terrain-grid',{type:'raster-dem',encoding:'terrarium',tiles:[sitePath(`/map-area/${area}-terrain/{z}/{x}/{y}.png`)],
                bounds:terrainDetail.bounds,minzoom:terrainDetail.minzoom,maxzoom:terrainDetail.maxzoom,tileSize:terrainDetail.tileSize,
                attribution:'<a href="https://open-meteo.com/en/docs/elevation-api">Copernicus DEM / Open-Meteo</a>'});
            map.addLayer({id:'ground-relief',type:'hillshade',source:'terrain-grid',paint:{'hillshade-exaggeration':.24,
                'hillshade-shadow-color':'#8c8073','hillshade-highlight-color':'#fff9e9','hillshade-accent-color':'#998b77'}},'terrain-contours');
        }
        if(activeTerrain&&showTerrainMesh){if(!map.getTerrain())map.setTerrain({source:'terrain-grid',exaggeration:1});}
        else if(map.getTerrain())map.setTerrain(null);
        for(const id of ['terrain-contours','contour-labels','ground-relief'])if(map.getLayer(id))map.setLayoutProperty(id,'visibility',activeTerrain?'visible':'none');
    },[loaded,area,terrainDetail,showTerrain,showTerrainMesh]);

    useEffect(()=>{
        const map=mapRef.current;if(!loaded||!map)return;
        // At very close zoom, the terrain depth buffer can hide MapLibre’s
        // ground labels. Project a collision-filtered label overlay instead.
        const mesh=showTerrain&&showTerrainMesh&&Boolean(terrainDetail);
        for(const id of DETAIL_LABEL_LAYERS)map.setLayoutProperty(id,'visibility',mesh||id==='contour-labels'&&!showTerrain?'none':'visible');
        if(mesh)return attachTerrainLabels(map,labelScale,highContrast);
    },[loaded,showTerrain,showTerrainMesh,terrainDetail,labelScale,highContrast]);

    useEffect(() => {
        const map = mapRef.current;
        if (!loaded || !map) return;
        const applyCamera = () => {
            const el = map.getContainer();
            if (mapRef.current !== map) return;
            if (!el.isConnected || !el.clientWidth || !el.clientHeight) {
                deferredCamera.current = applyCamera;
                return;
            }
            deferredCamera.current = null;
            const duration = reduceMotion ? 0 : 330;
            if (focusLat !== undefined && focusLng !== undefined) {
                map.easeTo({ center: lngLat([focusLat, focusLng]), zoom: Math.max(17, map.getZoom()), duration });
            } else {
                map.fitBounds(fit, { padding: { top: 54, left: 35, right: 45, bottom: 65 }, maxZoom: 17.35,
                    duration, pitch: map.getPitch(), bearing: map.getBearing() });
            }
        };
        applyCamera();
        return () => { if (deferredCamera.current === applyCamera) deferredCamera.current = null; };
    }, [loaded, fit, focusLat, focusLng, reduceMotion]);

    useEffect(() => {
        const map = mapRef.current;
        if (!loaded || !map) return;
        const features = (routes ?? []).filter(route => route.coordinates.length > 1).map<Feature<LineString>>(route => {
            const selected = route.id === active?.id;
            const colour = selected ? highContrast ? WALK_ROUTE_HC : WALK_ROUTE : ROUTE_ALTERNATIVE;
            return { type: 'Feature', geometry: { type: 'LineString', coordinates: route.coordinates.map(lngLat) },
                properties: { active: selected, colour, order: Number(selected), name: route.name } };
        });
        (map.getSource('routes') as GeoJSONSource).setData({ type: 'FeatureCollection', features });
    }, [loaded, routes, active?.id, highContrast]);

    useEffect(() => {
        const map = mapRef.current;
        if (!loaded || !map) return;
        const features = routeRoof.map<Feature<LineString>>(line => ({
            type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: line.map(lngLat) },
        }));
        (map.getSource('roof') as GeoJSONSource).setData({ type: 'FeatureCollection', features });
    }, [loaded, routeRoof]);

    useEffect(() => {
        const map = mapRef.current;
        if (!loaded || !map) return;
        const source = map.getSource('cast-shadows') as GeoJSONSource;
        if (informationLayer !== 'shade' || !solar || !shadeAt) { source.setData(empty); return; }
        const at = Date.parse(shadeAt);
        const update = () => {
            const bounds = map.getBounds();
            const rings = map.getZoom() >= 15.5 ? solar.shadowRings(at,
                [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()]) : [];
            source.setData({ type: 'FeatureCollection', features: rings.map<Feature<Polygon>>(ring => ({
                type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [ring] },
            })) });
        };
        update();
        map.on('moveend', update);
        return () => { map.off('moveend', update); };
    }, [loaded, informationLayer, solar, shadeAt]);

    useEffect(() => {
        const map = mapRef.current;
        if (!loaded || !map) return;
        const stretches = informationLayer === 'shade' ? routeShade ?? [] : [];
        const features = stretches.filter(stretch => ['sun', 'shade', 'unknown'].includes(stretch.condition)).map<Feature<LineString>>(stretch => ({
            type: 'Feature', geometry: { type: 'LineString', coordinates: stretch.geometry },
            properties: { condition: stretch.condition, edge: stretch.edge_id, name: shadeLabel(stretch, language),
                colour: stretch.condition === 'sun' ? MAP_CAUTION : '#335ca3' },
        }));
        (map.getSource('route-shade') as GeoJSONSource).setData({ type: 'FeatureCollection', features });
    }, [loaded, routeShade, informationLayer, language]);

    useEffect(() => {
        const map = mapRef.current;
        if (!loaded || !map) return;
        const features = segments.map<Feature<LineString>>(segment => {
            const colour = informationLayer === 'paths' ? '#475569' : informationLayer === 'observations' ? '#5b55a1'
                : segment.source !== 'reported' && Number(segment.value) >= 0.65 ? ROOF_COVER : MAP_CAUTION;
            return { type: 'Feature', geometry: { type: 'LineString', coordinates: segment.geometry },
                properties: { known: segment.value !== null, colour, name: segment.name, detail: segment.detail, edge: segment.id } };
        });
        (map.getSource('conditions') as GeoJSONSource).setData({ type: 'FeatureCollection', features });
    }, [loaded, segments, informationLayer]);

    useEffect(() => {
        const map = mapRef.current;
        if (!loaded || !map) return;
        const markers: Marker[] = [];
        for (const asset of (assets ?? []).slice(0, 40)) {
            const symbol = mapFacilitySymbol(asset);
            if (symbol) markers.push(pin(map, [asset.lat, asset.lng], 'asset', symbol, asset.name, describeAsset?.(asset).join(' · ')));
        }
        for (const report of reports ?? []) {
            const lat = report.lat ?? report.latitude, lng = report.lng ?? report.longitude;
            if (lat !== undefined && lng !== undefined) markers.push(pin(map, [lat, lng], 'hazard', '!', report.category || 'Reported hazard', report.description ?? undefined));
        }
        if (endLat !== undefined && endLng !== undefined) markers.push(pin(map, [endLat, endLng], 'destination', '●', endDetail ?? residentText(language, 'Destination')));
        markers.push(pin(map, [startLat, startLng], 'origin', '●', startLabel));
        if (selectedLocation) markers.push(pin(map, selectedLocation, 'hazard', '+', 'Selected hazard location'));
        if (focusLat !== undefined && focusLng !== undefined) markers.push(pin(map, [focusLat, focusLng], 'asset', '◎', residentText(language, 'Selected map point')));
        if (liveLocation) markers.push(pin(map, liveLocation, 'live', '●', 'Last recorded GPS position'));
        return () => { for (const marker of markers) marker.remove(); };
    }, [loaded, assets, reports, startLat, startLng, startLabel, endLat, endLng, endDetail, selectedLocation, liveLocation, focusLat, focusLng, language, describeAsset]);

    useEffect(() => {
        const map = mapRef.current;
        if (!loaded || !map) return;
        const popup = new Popup({ maxWidth: '245px' });
        const onClick = (event: MapMouseEvent) => {
            if (onLocationSelect) {
                onLocationSelect(event.lngLat.lat, event.lngLat.lng);
                return;
            }
            const inspected = informationLayer === 'shade' ? map.queryRenderedFeatures(event.point, {
                layers: ['route-shade-known', 'route-shade-unknown', 'walking-conditions', 'conditions-unknown'],
            })[0] : undefined;
            const routeFeature=inspected??map.queryRenderedFeatures(event.point,{layers:layerIds})[0];
            const base=routeFeature?undefined:map.queryRenderedFeatures(event.point,{layers:INSPECT_BASE_LAYERS})[0];
            const feature=routeFeature??base;
            if(!feature)return;
            if(base){
                const {title,lines}=featureDescription(base.properties as MapProperties,language);
                popup.setLngLat(event.lngLat).setDOMContent(popupContent(title,lines.join(' · '))).addTo(map);
                return;
            }
            if(!feature.properties.name)return;
            const edge = inspected?.properties.edge;
            const action = onShadeReport && Number.isSafeInteger(edge) ? {
                label: residentText(language, 'Report shade here'),
                run: () => { popup.remove(); onShadeReport(edge, [event.lngLat.lat, event.lngLat.lng]); },
            } : undefined;
            popup.setLngLat(event.lngLat).setDOMContent(popupContent(feature.properties.name, feature.properties.detail, action)).addTo(map);
        };
        map.on('click', onClick);
        map.getCanvas().style.cursor = onLocationSelect ? 'crosshair' : '';
        return () => { map.off('click', onClick); popup.remove(); };
    }, [loaded, onLocationSelect, informationLayer, language, onShadeReport]);

    return (
        <>
            <div ref={container} style={{ position: 'absolute', inset: 0 }} data-map-canvas data-map-ready={mapReady}/>
            {!mapReady&&<div className="tg-map-loading" role="status"><span className="tg-map-spinner" aria-hidden/>{residentText(language,'Loading detailed map…')}</div>}
            {loaded && <button type="button" className="tg-map-fit" onClick={() => mapRef.current?.fitBounds(fit, {
                padding: { top: 54, left: 35, right: 45, bottom: 65 }, maxZoom: 17.35,
                duration: reduceMotion ? 0 : 330,
            })} aria-label={fitLabel??residentText(language,'Recenter')}><Crosshair size={17} aria-hidden /><span>{fitLabel??residentText(language,'Recenter')}</span></button>}
        </>
    );
}
