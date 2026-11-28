import { mkdir, writeFile } from 'node:fs/promises';
import { extracts,loadWalkingWorld,representativeShade } from './walking-world-source.mjs';
import { buildTerrain } from './map-terrain.mjs';
import { loadPagesPilot } from './pilot-export.mjs';
import { fileURLToPath } from 'node:url';

const output = new URL('../public/map-area/', import.meta.url);
await mkdir(output, { recursive: true });
for (const area of Object.keys(extracts)) {
    const {elements,features,world,imported,dataDate,solar}=await loadWalkingWorld(area);
    const terrain = await buildTerrain(area, output);
    if (terrain) features.push(...terrain.contours);
    await writeFile(new URL(`${area}.geojson`, output), JSON.stringify({ type: 'FeatureCollection', features }));
    const counts = features.reduce((counts, feature) => ({...counts,[feature.properties.kind]:(counts[feature.properties.kind]??0)+1}),{});
    console.log(`${area}: ${features.length} map features (${counts.building??0} buildings/parts, ${counts.path??0} paths, ${counts.label??0} place labels).`);
    await writeFile(new URL(`${area}-shade.json`, output), JSON.stringify(solar));
    const heightCounts = features.filter(f=>f.properties.kind==='building').reduce((counts,f)=>{const source=f.properties.heightSource;counts[source]=(counts[source]??0)+1;return counts;},{});
    const gaps=world.gaps.reduce((counts,f)=>{const kind=f.properties.kind;counts[kind]=(counts[kind]??0)+1;return counts;},{});
    const summary={version:1,area,geometry:world.counts,heightCounts,shade:{buildings:solar.buildings,crowns:solar.crowns},gaps,sources:[
        {id:'osm',name:'OpenStreetMap contributors',url:'https://www.openstreetmap.org/copyright',license:'ODbL-1.0',records:elements.size,data_at:dataDate,note:'Core capture date; supplemental archives have separate dates listed in the repository data provenance.'},...imported]};
    // Representative slots and the interactive shadow display use the same
    // qualified geometry. Fractions are lower bounds on modelled shade, not
    // evidence of full sun in the unmodelled remainder.
    const pilot=area==='elmina'?null:await loadPagesPilot(fileURLToPath(new URL(`../data/${area}/bundle.json`,import.meta.url)),area);
    const shadeByEdge=pilot?representativeShade(pilot.graph.edges,solar,world.ways,dataDate):{};
    const edgeRefs=new Map(),assetRefs=new Map();
    for(const edge of pilot?.graph.edges??[]){const ref=`way/${edge.osm_way_id}`;if(!edgeRefs.has(ref))edgeRefs.set(ref,[]);edgeRefs.get(ref).push(edge.id);}
    for(const asset of pilot?.walking.assets??[]){const ref=asset.source_ref.replace(/^https:\/\/www\.openstreetmap\.org\//,'');if(!assetRefs.has(ref))assetRefs.set(ref,[]);assetRefs.get(ref).push(asset.id);}
    for(const f of world.gaps){const p=f.properties;p.edge_ids=(edgeRefs.get(p.ref)??[]).join(';');p.asset_ids=(assetRefs.get(p.ref)??[]).join(';');}
    await writeFile(new URL(`${area}-world.json`,output),JSON.stringify({...summary,ways:world.ways,...(pilot&&dataDate?{shadeByEdge,shadeDatasetId:pilot.graph.source.dataset_id,shadeModelDate:dataDate}:{})}));
    await writeFile(new URL(`${area}-survey-gaps.geojson`,output),JSON.stringify({type:'FeatureCollection',features:world.gaps}));
    const csv=value=>'"'+String(value??'').replaceAll('"','""')+'"';
    await writeFile(new URL(`${area}-survey-gaps.csv`,output),['reference,kind,missing,edge_ids,asset_ids,source_archive,source_date',...world.gaps.map(f=>['ref','kind','missing','edge_ids','asset_ids','source_archive','source_date'].map(key=>csv(f.properties[key])).join(','))].join('\n')+'\n');
    console.log(`${area}: ${JSON.stringify(world.counts)}; ${solar.objects.length} source-qualified solar shapes, ${world.gaps.length} survey targets.`);
}
