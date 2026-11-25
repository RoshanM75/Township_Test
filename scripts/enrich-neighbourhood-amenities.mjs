// Deterministic enrichment from the already archived OSM snapshots.
// No network access, invented amenities or new field verification.
import { readFile, writeFile } from 'node:fs/promises';
import { gunzipSync, gzipSync } from 'node:zlib';

async function json(path) {
    const bytes = await readFile(path);
    return JSON.parse(String(path).endsWith('.gz') ? gunzipSync(bytes) : bytes);
}
function tagsFor(raw) { return new Map(raw.elements.map(item => [`${item.type}/${item.id}`, item.tags ?? {}])); }
function amenityDetails(assets, tags, previous) {
    const result = { ...previous };
    for (const asset of assets) {
        if (asset.properties.connection_model === 'approximate_approach') continue;
        const value = tags.get(asset.source_ref.split('/').slice(-2).join('/'));
        if (!value) continue;
        const access = ['yes','public','permissive'].includes(value.access) ? 'public' : value.access==='customers' ? 'customers' : value.access==='destination' ? 'destination'
            : value.access==='permit' ? 'permission' : ['no','private'].includes(value.access) ? 'private' : undefined;
        const facts = Object.fromEntries(Object.entries({
            public_access:access, fee:['yes','no'].includes(value.fee)?value.fee==='yes':undefined, osm_amenity:value.amenity, osm_shop:value.shop,
            has_seat:['yes','no'].includes(value.seating)?value.seating==='yes':undefined, opening_hours:value.opening_hours,osm_level:value.level,
        }).filter(([,v])=>v!==undefined));
        if(Object.keys(facts).length)result[asset.id]={...result[asset.id],...facts};
    }
    return result;
}
for(const area of ['pasar-seni','um-campus']){
    const directory=new URL(`../data/${area}/`,import.meta.url);
    const bundle=await json(new URL('bundle.json',directory));
    const raw=await json(new URL(`source/${area}-osm.json.gz`,directory));
    const file=new URL('walking-details.json',directory), details=await json(file);
    details.context.walking_details.facilities=amenityDetails([...bundle.walking.assets,...details.entrances],tagsFor(raw),details.context.walking_details.facilities);
    await writeFile(file,JSON.stringify(details));
    console.log(area, Object.keys(details.context.walking_details.facilities).length,'mapped place/access detail records');
    if(area==='pasar-seni'){
        const expanded=await json(new URL('source/expanded-map-osm.json.gz',directory));
        const path=new URL('expansion.json.gz',directory),snapshot=await json(path);
        snapshot.facilities=amenityDetails(snapshot.assets,tagsFor(expanded),snapshot.facilities);
        await writeFile(path,gzipSync(JSON.stringify(snapshot),{level:9}));
        console.log('KL expansion',Object.keys(snapshot.facilities).length,'mapped detail records');
    }
}
