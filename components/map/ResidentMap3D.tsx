'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Crosshair } from 'lucide-react';
import {
    Map as LibreMap, AttributionControl, LngLatBounds, Marker, NavigationControl, Popup,
    type GeoJSONSource, type StyleSpecification, type MapMouseEvent, type SymbolLayerSpecification,
} from 'maplibre-gl';
import type { Feature, FeatureCollection, LineString } from 'geojson';
import 'maplibre-gl/dist/maplibre-gl.css';
import { PILOTS, type PilotId } from '@/lib/pilots';
import { sitePath } from '@/lib/site';
import type { EnvironmentSegment } from '@/lib/environment';
import { DEFAULT_ORIGIN } from '@/lib/precinct';
import { residentText } from '@/lib/resident-language';
import type { InteractiveMapProps } from './InteractiveMap';
import { MAP_CAUTION, ROOF_COVER, ROUTE_ALTERNATIVE, ROUTE_OUTLINE, WALK_ROUTE, WALK_ROUTE_HC, mapFacilitySymbol } from './walking-map-theme';

const empty: FeatureCollection = { type: 'FeatureCollection', features: [] };
const noRoof: [number, number][][] = [];
const lngLat = ([lat, lng]: [number, number]): [number, number] => [lng, lat];
const layerIds = ['walking-conditions', 'walking-routes', 'place-labels', 'building-labels', 'street-labels'];
const labelText = {
    'text-font': ['Noto Sans Regular'],
    'text-field': ['get', 'name'],
    'text-padding': 4,
} satisfies NonNullable<SymbolLayerSpecification['layout']>;
const labelHalo = { 'text-halo-color': '#fffefa', 'text-halo-width': 1.25 } as const;

function mapStyle(area: PilotId): StyleSpecification {
    return {
        version: 8,
        glyphs: sitePath('/map-fonts/{fontstack}/{range}.pbf'),
        light: { anchor: 'map', color: '#fffaf0', intensity: 0.45, position: [1.8, 230, 42] },
        sources: {
            area: { type: 'geojson', data: sitePath(`/map-area/${area}.geojson`),
                attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>' },
            conditions: { type: 'geojson', data: empty },
            routes: { type: 'geojson', data: empty },
            roof: { type: 'geojson', data: empty },
        },
        layers: [
            { id: 'ground', type: 'background', paint: { 'background-color': '#f4f0e7' } },
            { id: 'open-spaces', type: 'fill', source: 'area', filter: ['in', ['get', 'kind'], ['literal', ['green', 'water']]],
                paint: { 'fill-color': ['match', ['get', 'kind'], 'water', '#b4d8ed', '#cfdfbc'] } },
            { id: 'watercourses', type: 'line', source: 'area', filter: ['==', ['get', 'kind'], 'watercourse'],
                paint: { 'line-color': '#99c6df', 'line-width': ['interpolate', ['linear'], ['zoom'], 13, 2, 18, 5] } },
            { id: 'streets-outline', type: 'line', source: 'area', filter: ['==', ['get', 'kind'], 'street'],
                layout: { 'line-cap': 'round', 'line-join': 'round' },
                paint: { 'line-color': ['case', ['==', ['get', 'road'], 'major'], '#d7bc91', '#dcd6c8'],
                    'line-width': ['interpolate', ['linear'], ['zoom'], 13, 3, 18, ['case', ['==', ['get', 'road'], 'major'], 16, 9]] } },
            { id: 'streets', type: 'line', source: 'area', filter: ['==', ['get', 'kind'], 'street'],
                layout: { 'line-cap': 'round', 'line-join': 'round' },
                paint: { 'line-color': ['case', ['==', ['get', 'road'], 'major'], '#fae2b5', '#fffdfa'],
                    'line-width': ['interpolate', ['linear'], ['zoom'], 13, 1.5, 18, ['case', ['==', ['get', 'road'], 'major'], 13, 6.5]] } },
            { id: 'railways', type: 'line', source: 'area', filter: ['==', ['get', 'kind'], 'rail'],
                paint: { 'line-color': '#797d87', 'line-width': 2, 'line-dasharray': [2, 1.5] } },
            { id: 'reference-paths', type: 'line', source: 'area', minzoom: 15, filter: ['==', ['get', 'kind'], 'path'],
                paint: { 'line-color': '#928273', 'line-width': 1.2, 'line-opacity': 0.57, 'line-dasharray': [2, 2] } },
            { id: 'building-footprints', type: 'fill', source: 'area', filter: ['==', ['get', 'kind'], 'building'],
                paint: { 'fill-color': '#ded5ca', 'fill-outline-color': '#bdb1a6' } },
            { id: 'building-volumes', type: 'fill-extrusion', source: 'area', filter: ['==', ['get', 'kind'], 'building'], minzoom: 15, paint: {
                'fill-extrusion-color': ['match', ['get', 'use'], 'civic', '#cbd4d5', 'commercial', '#d7cabd', '#d9d0c6'],
                'fill-extrusion-height': ['get', 'height'], 'fill-extrusion-base': ['get', 'base'], 'fill-extrusion-opacity': 0.88,
            } },
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
            { id: 'street-labels', type: 'symbol', source: 'area', minzoom: 14.5,
                filter: ['all', ['==', ['get', 'kind'], 'street'], ['has', 'name']],
                layout: { ...labelText, 'symbol-placement': 'line', 'symbol-spacing': 250, 'text-max-angle': 35,
                    'text-size': ['interpolate', ['linear'], ['zoom'], 15, 10, 18, 12] },
                paint: { ...labelHalo, 'text-color': '#534d48' } },
            { id: 'building-labels', type: 'symbol', source: 'area', minzoom: 17.2,
                filter: ['all', ['==', ['get', 'kind'], 'label'], ['==', ['get', 'labelKind'], 'building']],
                layout: { ...labelText, 'text-size': 11, 'text-max-width': 11, 'text-offset': [0, .1] },
                paint: { ...labelHalo, 'text-color': '#474352' } },
            { id: 'place-labels', type: 'symbol', source: 'area', minzoom: 14.5,
                filter: ['all', ['==', ['get', 'kind'], 'label'], ['!=', ['get', 'labelKind'], 'building']],
                layout: { ...labelText, 'text-size': ['interpolate', ['linear'], ['zoom'], 15, 11, 18, 13],
                    'text-max-width': 11, 'text-variable-anchor': ['center', 'top', 'bottom'], 'text-radial-offset': .35,
                    'symbol-sort-key': ['case', ['==', ['get', 'labelKind'], 'station'], 0, 1] },
                paint: { ...labelHalo, 'text-color': ['match', ['get', 'labelKind'], 'station', '#1e5c78', 'green', '#466343', 'water', '#275c79', '#443650'] } },

        ],
    };
}

function popupContent(title: string, detail?: string) {
    const panel = document.createElement('div');
    const heading = document.createElement('strong');
    heading.textContent = title;
    panel.append(heading);
    if (detail) {
        const description = document.createElement('p');
        description.textContent = detail;
        panel.append(description);
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
    return new Marker({ element }).setLngLat(lngLat(position)).setPopup(popup).addTo(map);
}

type Props = InteractiveMapProps & { area: PilotId; segments: EnvironmentSegment[]; onUnavailable: () => void };

export default function ResidentMap3D({
    area, segments, onUnavailable, startCoords = DEFAULT_ORIGIN, endCoords, endDetail, startLabel = 'Start', routes,
    activeRouteId, reports, assets, liveLocation, focusLocation, reduceMotion, highContrast,
    selectedLocation, onLocationSelect, informationLayer, routeRoof = noRoof, labelScale = 1, language = 'en',
}: Props) {
    const container = useRef<HTMLDivElement>(null);
    const mapRef = useRef<LibreMap | null>(null);
    const [loaded, setLoaded] = useState(false);

    useEffect(() => {
        if (!container.current) return;
        let map: LibreMap;
        try {
            map = new LibreMap({
                container: container.current, style: mapStyle(area),
                center: lngLat(PILOTS[area].centre), zoom: 17, pitch: 23, bearing: 0,
                maxPitch: 70, maxZoom: 20, attributionControl: false,
            });
        } catch {
            onUnavailable();
            return;
        }
        mapRef.current = map;
        map.addControl(new NavigationControl({ visualizePitch: true }), 'top-right');
        map.addControl(new AttributionControl({ compact: false }), 'bottom-left');
        map.once('style.load', () => setLoaded(true));
        map.once('webglcontextlost', onUnavailable);
        const observer = new ResizeObserver(() => map.resize());
        observer.observe(container.current);
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
        map.setLayoutProperty('street-labels', 'text-size', ['interpolate', ['linear'], ['zoom'], 15, 11 * labelScale, 18, 13 * labelScale]);
        map.setLayoutProperty('building-labels', 'text-size', 12 * labelScale);
        map.setLayoutProperty('place-labels', 'text-size', ['interpolate', ['linear'], ['zoom'], 15, 12 * labelScale, 18, 15 * labelScale]);
        for (const [selector, label] of [['zoom-in', 'Zoom in'], ['zoom-out', 'Zoom out']] as const) {
            const button = container.current?.querySelector(`.maplibregl-ctrl-${selector}`);
            button?.setAttribute('aria-label', residentText(language, label));
            button?.setAttribute('title', residentText(language, label));
        }
    }, [loaded, labelScale, language]);

    useEffect(() => {
        const map = mapRef.current;
        if (!loaded || !map) return;
        const duration = reduceMotion ? 0 : 330;
        if (focusLat !== undefined && focusLng !== undefined) {
            map.easeTo({ center: lngLat([focusLat, focusLng]), zoom: Math.max(17, map.getZoom()), duration });
        } else {
            map.fitBounds(fit, { padding: { top: 54, left: 35, right: 45, bottom: 65 }, maxZoom: 17.8,
                duration, pitch: map.getPitch(), bearing: map.getBearing() });
        }
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
        const features = segments.map<Feature<LineString>>(segment => {
            const colour = informationLayer === 'paths' ? '#475569' : informationLayer === 'observations' ? '#5b55a1'
                : segment.source !== 'reported' && Number(segment.value) >= 0.65 ? ROOF_COVER : MAP_CAUTION;
            return { type: 'Feature', geometry: { type: 'LineString', coordinates: segment.geometry },
                properties: { known: segment.value !== null, colour, name: segment.name, detail: segment.detail } };
        });
        (map.getSource('conditions') as GeoJSONSource).setData({ type: 'FeatureCollection', features });
    }, [loaded, segments, informationLayer]);

    useEffect(() => {
        const map = mapRef.current;
        if (!loaded || !map) return;
        const markers: Marker[] = [];
        for (const asset of (assets ?? []).slice(0, 40)) {
            const symbol = mapFacilitySymbol(asset);
            if (symbol) markers.push(pin(map, [asset.lat, asset.lng], 'asset', symbol, asset.name));
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
    }, [loaded, assets, reports, startLat, startLng, startLabel, endLat, endLng, endDetail, selectedLocation, liveLocation, focusLat, focusLng, language]);

    useEffect(() => {
        const map = mapRef.current;
        if (!loaded || !map) return;
        const popup = new Popup({ maxWidth: '245px' });
        const onClick = (event: MapMouseEvent) => {
            if (onLocationSelect) {
                onLocationSelect(event.lngLat.lat, event.lngLat.lng);
                return;
            }
            const feature = map.queryRenderedFeatures(event.point, { layers: [...layerIds, 'conditions-unknown'] })[0];
            if (feature?.properties.name) popup.setLngLat(event.lngLat).setDOMContent(popupContent(feature.properties.name, feature.properties.detail)).addTo(map);
        };
        map.on('click', onClick);
        map.getCanvas().style.cursor = onLocationSelect ? 'crosshair' : '';
        return () => { map.off('click', onClick); popup.remove(); };
    }, [loaded, onLocationSelect]);

    return (
        <>
            <div ref={container} style={{ position: 'absolute', inset: 0 }} data-map-canvas />
            {loaded && <button type="button" className="tg-map-fit" onClick={() => mapRef.current?.fitBounds(fit, {
                padding: { top: 54, left: 35, right: 45, bottom: 65 }, maxZoom: 17.8,
                duration: reduceMotion ? 0 : 330,
            })}><Crosshair size={17} aria-hidden /> {residentText(language, 'Recenter')}</button>}
        </>
    );
}
