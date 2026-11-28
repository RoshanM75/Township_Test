import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { PILOTS } from '../lib/pilots.ts';
import { buildPedestrianModel, sharedShadeDataset } from './pedestrian-model.mjs';
import { applyExternal, readExternal } from './pedestrian-external.mjs';
import { buildCartography } from './map-cartography.mjs';
import { solarModel } from '../lib/solar-shade.ts';
import { pointAt } from '../lib/walking-geometry.ts';
import { applySurvey } from './pedestrian-external.mjs';

export const extracts = {
    'pasar-seni': ['data/pasar-seni/source/pasar-seni-osm.json.gz', 'data/pasar-seni/source/map-context.json.gz'],
    'um-campus': ['data/um-campus/source/um-campus-osm.json.gz', 'data/um-campus/source/map-context.json.gz'],
    elmina: ['precinct.json', 'data/elmina/source/elmina-map-osm.json.gz'],
};
async function readMapSource(source) {
    try {
        const file = await readFile(new URL(`../${source}`, import.meta.url));
        return JSON.parse(source.endsWith('.gz') ? gunzipSync(file) : file);
    } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        return null;
    }
}

export async function loadWalkingWorld(area, suppliedSurvey = undefined) {
    const sources=extracts[area];
    const elements = new Map();
    let dataDate=null;
    for (const source of sources) {
        const map = await readMapSource(source);
        dataDate??=map?.osm3s?.timestamp_osm_base?.slice(0,10)??null;
        for (const element of map?.elements ?? []) elements.set(`${element.type}:${element.id}`, {...element,sourceArchive:source,sourceDate:map.osm3s?.timestamp_osm_base?.slice(0,10)});
    }
    const additionalPolygons = [];
    const additionalStreets = [];
    if (area === 'pasar-seni') {
        const extension = await readMapSource('data/pasar-seni/source/expanded-map-osm.json.gz');
        const streets = await readMapSource('data/pasar-seni/source/expanded-map-streets.geojson.gz');
        for (const element of extension?.elements ?? []) {
            const key = `${element.type}:${element.id}`;
            if (!elements.has(key)) elements.set(key, {...element,sourceArchive:'data/pasar-seni/source/expanded-map-osm.json.gz'});
        }
        additionalStreets.push(...streets?.features ?? []);
        const buildings = await readMapSource('data/pasar-seni/source/bukit-bintang-buildings.geojson.gz');
        for (const feature of buildings?.features ?? []) {
            const [type, id] = feature.id.split('/');
            const existing = elements.get(`${type}:${id}`);
            if (existing?.geometry?.length >= 4 && existing.tags?.building) {
                // Preserve the newer outline and use archived height tags where the current outline has none.
                if (!existing.tags.height && !existing.tags['building:levels']) {
                    const { height, 'building:levels': levels } = feature.properties;
                    if (height || levels) existing.tags = { height, 'building:levels': levels, ...existing.tags };
                }
                continue;
            }
            // Relations with usable geometry are rendered by the multipolygon importer.
            const hasRelationShape = existing?.type === 'relation' && existing.members?.some(member => member.geometry?.length);
            const polygons = feature.geometry.type === 'Polygon' ? [feature.geometry.coordinates] : feature.geometry.coordinates;
            for (const [index, polygon] of polygons.entries()) {
                const element = { type: 'way', id: `${feature.id}:${index}`, sourceArchive:'data/pasar-seni/source/bukit-bintang-buildings.geojson.gz', sourceDate:'2026-08-08', tags: feature.properties,
                    geometry: polygon[0].map(([lon, lat]) => ({ lon, lat })) };
                if (!element.tags?.building) continue;
                if (!hasRelationShape) additionalPolygons.push({ element, geometry: { type: 'Polygon', coordinates: polygon } });
            }
        }
    }
    const features = buildCartography([...elements.values()], additionalPolygons, additionalStreets);
    const imported = applyExternal(features, area, await readExternal(area));
    const survey=suppliedSurvey??await readMapSource(`data/${area}/source/pedestrian-survey.geojson`);
    if(survey)imported.push(applySurvey(features,area,survey));
    const world = buildPedestrianModel([...elements.values()], features, area);
    features.push(...world.features);
    const [lat,lng]=PILOTS[area].centre;
    return {elements,features,world,imported,dataDate,solar:sharedShadeDataset(features,[lng,lat],world.ways)};
}

export function representativeShade(edges,solar,ways,date){
    const paths={};if(!date)return paths;
    const model=solarModel(solar);
    for(const [slot,hour] of [['morning',9],['midday',12],['afternoon',16]]){
        const at=Date.parse(`${date}T${String(hour).padStart(2,'0')}:00:00+08:00`);
        for(const edge of edges){
            if(edge.covered||ways[edge.osm_way_id]?.covered||!model.isGroundWay(edge.osm_way_id))continue;
            const count=Math.min(12,Math.max(1,Math.ceil(edge.length_m/10)));
            let shaded=0;for(let i=0;i<count;i++)if(model.atPoint(pointAt(edge.geometry,(i+.5)/count),at).condition==='shade')shaded++;
            if(shaded)(paths[edge.id]??={})[`shade_${slot}`]=Math.round(shaded/count*100)/100;
        }
    }
    return paths;
}
