import { projectPoint } from '../lib/walking-geometry.ts';
import { sourceId } from '../lib/data/osm.ts';

const MRT_PLAN = 'https://www.mymrt.com.my/wp-content/uploads/2024/11/S16-PASAR-SENI.pdf';

function yesNo(value) {
    return value === 'yes' ? true : value === 'no' ? false : undefined;
}

function width(tags) {
    const value = tags['maxwidth:physical'] ?? tags.width;
    if (!/^\d+(\.\d+)?\s*m?$/.test(value?.trim() ?? '')) return undefined;
    const metres = Number(value.replace(/m\s*$/, '').trim());
    return metres >= .1 && metres <= 30 ? metres : undefined;
}

function compact(entries) {
    return Object.fromEntries(Object.entries(entries).filter(([, value]) => value !== undefined));
}

function crossingTag(way, nodes, keys) {
    const from = tags => keys.map(key => yesNo(tags?.[key])).find(value => value !== undefined);
    const recorded = from(way);
    if (recorded !== undefined) return recorded;
    const sides = nodes.map(from);
    return sides.includes(false) ? false : sides.every(value => value === true) ? true : undefined;
}

export function mappedWayfinding(bundle, raw) {
    const osm = new Map(raw.elements.map(element => [`${element.type}/${element.id}`, element]));
    const paths = {}, facilities = {};
    const qids = new Map();
    for (const edge of bundle.graph.edges) {
        const way = osm.get(`way/${edge.osm_way_id}`)?.tags ?? {};
        const ends = [edge.from_node, edge.to_node].map(node => osm.get(`node/${node}`)?.tags);
        const values = compact({ clear_width_m: width(way),
            has_tactile: edge.is_crossing ? crossingTag(way, ends, ['tactile_paving']) : undefined,
            audible_signal: edge.is_crossing ? crossingTag(way, ends, ['traffic_signals:sound', 'crossing:signals:sound']) : undefined });
        if (Object.keys(values).length) paths[edge.id] = values;
    }
    for (const asset of bundle.walking.assets) {
        const tags = osm.get(asset.source_ref.split('/').slice(-2).join('/'))?.tags;
        if (!tags || asset.properties.connection_model === 'approximate_approach') continue;
        const mobility = yesNo(tags.wheelchair);
        const values = compact({
            clear_width_m: width(tags),
            step_free: asset.kind === 'entrance' && mobility === false ? false : undefined,
            accessible_toilet: asset.kind === 'toilet' ? yesNo(tags['toilets:wheelchair']) ?? mobility : undefined,
            water_available: asset.kind === 'water' ? yesNo(tags.drinking_water) ?? true : undefined,
            backrest: asset.kind === 'rest' ? yesNo(tags.backrest) : undefined,
            armrests: asset.kind === 'rest' ? yesNo(tags.armrest ?? tags.armrests) : undefined,
        });
        if (Object.keys(values).length) facilities[asset.id] = values;
        if (asset.kind !== 'entrance' && /^Q[1-9]\d*$/.test(tags.wikidata ?? '')) {
            qids.set(tags.wikidata, { id: tags.wikidata, name: asset.name, description: '',
                url: `https://www.wikidata.org/wiki/${tags.wikidata}`, coordinates: [asset.lat, asset.lng] });
        }
    }

    const entrances = [];
    if (bundle.area_id === 'pasar-seni') {
        // Entrance lettering is cross-referenced with MRT Corp's public plan.
        // Coordinates and path topology are from OSM. A shared node is required.
        const station = bundle.walking.assets.find(asset => asset.kind === 'transit' && asset.properties.station_ref === 'KG16');
        for (const id of [5044809567, 5044809566]) {
            const gate = osm.get(`node/${id}`);
            if (!station || gate?.tags?.railway !== 'subway_entrance') continue;
            const edge = bundle.graph.edges.filter(e => e.from_node === id || e.to_node === id)
                .filter(e => !e.level || e.level === gate.tags.level).sort((a, b) => Number(a.has_steps) - Number(b.has_steps))[0];
            const point = [gate.lon, gate.lat];
            const anchor = edge ? projectPoint(edge.geometry, point) : null;
            const key = `${station.external_id}:door:${id}`;
            entrances.push({
                id: String(sourceId(bundle.area_id, key)), external_id: key, parent_id: station.id, category: 'transport', kind: 'entrance',
                name: `Pasar Seni MRT · ${gate.tags['name:en'] ?? gate.tags.name}`, lat: gate.lat, lng: gate.lon, source: 'osm',
                source_ref: `https://www.openstreetmap.org/node/${id}`,
                properties: { connection_model: 'mapped_entrance', station_plan: MRT_PLAN,
                    ...(gate.tags.wheelchair ? { osm_wheelchair: gate.tags.wheelchair } : {}) },
                edge_id: edge?.id ?? null, edge_fraction: anchor?.fraction ?? null, connection_distance_m: anchor?.distance ?? null,
                anchor_lat: anchor?.point[1] ?? null, anchor_lng: anchor?.point[0] ?? null,
            });
        }
    }
    return { paths, facilities, entrances, qids: [...qids.values()] };
}
