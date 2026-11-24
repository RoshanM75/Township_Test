import { mkdir,readFile,writeFile,access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { KL_CORE_BOUNDS, PILOTS } from '../lib/pilots.ts';
import { download,fileDigest,importSourceFile,gtfsFiles,csvFile,geofabrikToOverpass } from './data-download.mjs';
import { createPilotSnapshot,gisLayers } from './pilot-snapshot.mjs';
import { validatePilotSnapshot } from './pilot-export.mjs';

const args=process.argv.slice(2),arg=(key)=>{const i=args.indexOf(key);return i<0?null:args[i+1];};
const root=resolve(new URL('..',import.meta.url).pathname),raw=resolve(root,arg('--raw-dir')||'.local/sources/pasar-seni'),out=resolve(root,arg('--out')||'data/pasar-seni');
await mkdir(raw,{recursive:true});
const [south,west,north,east]=KL_CORE_BOUNDS;
const sources=[];
async function acquire(id,name,url,file,{supplied=null,license='See source terms',essential=false,maxBytes=30000000,method='GET',body}={}){
    const path=resolve(raw,file);let metadata;
    try {
        if(supplied){const digest=resolve(supplied)===path?{sha256:await fileDigest(path)}:await importSourceFile(resolve(supplied),path);metadata={fetched_at:new Date().toISOString(),...digest};await writeFile(path+'.source.json',JSON.stringify(metadata));}
        else if(args.includes('--reuse')){await access(path);metadata=JSON.parse(await readFile(path+'.source.json','utf8'));}
        else if(args.includes('--offline')){
            if(essential)throw Error(`${name} requires a supplied source file in offline mode.`);
            sources.push({id,name,url,license,status:'not_loaded',fetched_at:null,data_at:null,records:0,note:'Not supplied for this offline import.'});
            return null;
        }
        else metadata=await download(url,path,{maxBytes,method,body,timeout:180});
        sources.push({id,name,url,license,status:'loaded',fetched_at:metadata.fetched_at,data_at:null,records:0,note:supplied?'Imported from a supplied source file.':args.includes('--reuse')?'Using the explicitly selected cached source.':'Downloaded from the source.',sha256:metadata.sha256,...(metadata.archive_sha256?{archive_sha256:metadata.archive_sha256}:{})});
        console.log(`${id}: source file ready`);return path;
    }catch(error){
        sources.push({id,name,url,license,status:'unavailable',fetched_at:null,data_at:null,records:0,note:error.message});
        console.log(`${id}: unavailable${essential?' (required)':''}`);
        if(essential)throw error;return null;
    }
}
async function parseOptional(id,path,parse){
    if(!path)return null;
    try{return await parse(path);}catch(error){const source=sources.find(s=>s.id===id);source.status='unavailable';source.note=`The source could not be parsed: ${error.message}`;return null;}
}
try {
    let osmPath;
    const pbf=arg('--geofabrik-pbf');
    if(pbf||args.includes('--fetch-geofabrik')){
        const path=pbf?resolve(pbf):await acquire('geofabrik','Geofabrik Malaysia/Singapore/Brunei','https://download.geofabrik.de/asia/malaysia-singapore-brunei-latest.osm.pbf','region.osm.pbf',{license:'ODbL',essential:true,maxBytes:1000000000});
        osmPath=resolve(raw,'osm.json');await geofabrikToOverpass(path,KL_CORE_BOUNDS,osmPath);
        if(pbf)sources.push({id:'geofabrik',name:'Geofabrik regional extract',url:'https://download.geofabrik.de/asia/malaysia-singapore-brunei.html',license:'ODbL',status:'loaded',fetched_at:new Date().toISOString(),data_at:arg('--osm-date'),records:0,sha256:await fileDigest(path),note:'Supplied PBF clipped with osmium; preserve the original extract timestamp.'});
    }else{
        const box=`${south},${west},${north},${east}`;
        const query=`[out:json][timeout:90];(way[highway~"^(footway|path|pedestrian|steps|crossing|cycleway|service|track)$"](${box});nwr[amenity~"^(bench|toilets|drinking_water|shelter|clinic|hospital|pharmacy|doctors|dentist|community_centre|library|marketplace|restaurant|cafe|fast_food|food_court|place_of_worship)$"](${box});nwr[shop](${box});nwr[tourism](${box});nwr[historic](${box});nwr[leisure~"^(park|garden)$"](${box});nwr[place~"^(square|quarter|neighbourhood)$"](${box});node[entrance](${box});nwr[railway~"^(station|halt|subway_entrance)$"](${box});nwr[public_transport=station](${box});way[building](${box});relation[public_transport=stop_area](${box}););out body geom;`;
        const url='https://overpass-api.de/api/interpreter?'+new URLSearchParams({data:query});
        osmPath=await acquire('osm','OpenStreetMap / Overpass',url,'osm.json',{supplied:arg('--osm-file'),license:'ODbL',essential:true,maxBytes:60000000});
        sources.push({id:'geofabrik',name:'Geofabrik alternative OSM import',url:'https://download.geofabrik.de/asia/malaysia-singapore-brunei.html',license:'ODbL',status:'not_loaded',fetched_at:null,data_at:null,records:0,note:'Alternative source for the same OSM network. Use --geofabrik-pbf with osmium; the two OSM sources are not duplicate independent evidence.'});
    }
    const osm=JSON.parse(await readFile(osmPath,'utf8'));
    const graphPath=resolve(raw,'graph.json');execFileSync(process.execPath,['scripts/osm-to-graph.mjs','--in',osmPath,'--out-json',graphPath],{cwd:root,stdio:'inherit'});
    const graph=JSON.parse(await readFile(graphPath,'utf8'));if(!graph.edges.length)throw Error('No real pedestrian network was found. Existing pilot data was not replaced.');
    const inputs={sources,gtfs:{},population:[],ridership:[],wikidata:{},satellite:{},osm_date:arg('--osm-date')};
    const staticFeeds=[['rail','rapid-rail-kl'],['bus','rapid-bus-kl'],['feeder','rapid-bus-mrtfeeder']];
    let lastStatic=0;
    for(const [key,category]of staticFeeds){
        const supplied=arg(`--gtfs-${key}-file`);
        if(!supplied&&!args.includes('--reuse')&&!args.includes('--offline')&&lastStatic){const delay=16000-(Date.now()-lastStatic);if(delay>0)await new Promise(r=>setTimeout(r,delay));}
        const path=await acquire(`gtfs-${key}`,`Malaysia GTFS · ${category}`,`https://api.data.gov.my/gtfs-static/prasarana?category=${category}`,`${category}.zip`,{supplied,license:'CC BY 4.0',maxBytes:60000000});lastStatic=Date.now();
        if(path){try{inputs.gtfs[category]=await gtfsFiles(path,KL_CORE_BOUNDS);}catch(error){sources.at(-1).status='unavailable';sources.at(-1).note=`The feed could not be parsed: ${error.message}`;}}
    }
    const population=await acquire('dosm','DOSM district population','https://storage.dosm.gov.my/population/population_district.csv','population.csv',{supplied:arg('--population-file'),license:'Malaysia open data terms / dataset licence'});
    inputs.population=await parseOptional('dosm',population,async path=>{
        const rows=[];for await(const row of csvFile(path))if(row.district===PILOTS['pasar-seni'].district&&row.sex==='both'&&row.ethnicity==='overall')rows.push(row);
        return rows;
    })??[];
    const year=arg('--ridership-year')||String(new Date().getUTCFullYear());if(!/^20\d{2}$/.test(year))throw Error('Choose a valid ridership year.');
    const demand=await acquire('ridership','Rapid Rail daily station journeys',`https://storage.data.gov.my/transportation/rail/rapidrail_${year}_daily.csv`,'ridership.csv',{supplied:arg('--ridership-file'),license:'Malaysia open data terms / dataset licence',maxBytes:500000000});
    if(demand){const parsed=await parseOptional('ridership',demand,async()=>{
        // Retain only local station rows while streaming the national annual file.
        const names=new Set(['pasarseni','masjidjamek','merdeka',...Object.values(inputs.gtfs).flatMap(f=>(f['stops.txt']??[]).map(s=>s.stop_name.toLowerCase().replace(/[^a-z0-9]/g,'')))]);
        for await(const r of csvFile(demand)){if(names.has((r.origin||'').toLowerCase().replace(/[^a-z0-9]/g,''))||names.has((r.destination||'').toLowerCase().replace(/[^a-z0-9]/g,'')))inputs.ridership.push(r);}
        return true;
    });if(parsed===null)inputs.ridership=[];}
    const query=`SELECT DISTINCT ?item ?itemLabel ?itemDescription ?location WHERE { SERVICE wikibase:box { ?item wdt:P625 ?location . bd:serviceParam wikibase:cornerSouthWest "Point(${west} ${south})"^^geo:wktLiteral ; wikibase:cornerNorthEast "Point(${east} ${north})"^^geo:wktLiteral . } SERVICE wikibase:label { bd:serviceParam wikibase:language "en,ms" . } } LIMIT 300`;
    const wikidata=await acquire('wikidata','Wikidata landmark context','https://query.wikidata.org/sparql?'+new URLSearchParams({query,format:'json'}),'wikidata.json',{supplied:arg('--wikidata-file'),license:'CC0'});
    inputs.wikidata=await parseOptional('wikidata',wikidata,async path=>JSON.parse(await readFile(path,'utf8')))??{};
    const satellite=await acquire('satellite','Sentinel-2 / ESA WorldCover scene catalogue','https://planetarycomputer.microsoft.com/api/stac/v1/search','satellite.json',{supplied:arg('--satellite-file'),license:'Dataset-specific licences; see catalogue',method:'POST',body:{bbox:[west,south,east,north],collections:['sentinel-2-l2a','esa-worldcover'],limit:20,sortby:[{field:'datetime',direction:'desc'}]}});
    inputs.satellite=await parseOptional('satellite',satellite,async path=>JSON.parse(await readFile(path,'utf8')))??{};
    const bundle=createPilotSnapshot(graph,osm,inputs);
    if(!bundle.context.featured_ids.length)throw Error('No mapped destination is connected to the main walking component. Review the source in GIS before publishing.');
    for(const s of sources){
        if(s.id==='osm'||s.id==='geofabrik'&&s.status==='loaded'){s.records=bundle.graph.edges.length;s.data_at=bundle.graph.source.snapshot_at;}
        if(s.id.startsWith('gtfs-')&&s.status==='loaded'){const key=staticFeeds.find(([k])=>s.id===`gtfs-${k}`)?.[1];s.records=bundle.context.transit.stops.filter(t=>t.agency===key).length;if(!s.records){s.status='partial';s.note='The feed was parsed but no stops were found in the pilot boundary.';}}
        if(s.id==='ridership'&&s.status==='loaded'){s.records=bundle.context.demand.stations.length;s.data_at=bundle.context.demand.data_at;if(!s.records){s.status='partial';s.note='No station identifiers matched this pilot. Demand is unavailable until the identifier crosswalk is reviewed.';}}
        if(s.id==='dosm'&&s.status==='loaded'){s.records=bundle.context.demographics.population===null?0:1;s.data_at=bundle.context.demographics.year;if(!s.records){s.status='partial';s.note='No matching district total was found. District context is unavailable.';}}
        if(s.id==='wikidata'&&s.status==='loaded')s.records=bundle.context.landmarks.length;
        if(s.id==='satellite'&&s.status==='loaded'){s.records=bundle.context.environment.scenes.length;s.status='partial';s.note='Scene metadata and footprints only. No vegetation percentage, thermal map or street-level shade measurement has been computed.';}
    }
    validatePilotSnapshot(bundle);
    await mkdir(out,{recursive:true});await writeFile(resolve(out,'bundle.json'),JSON.stringify(bundle)+'\n');
    await writeFile(resolve(out,'sources.json'),JSON.stringify(sources,null,2)+'\n');
    const gis=arg('--out')?resolve(out,'gis'):resolve(root,'.local/gis/pasar-seni');await mkdir(gis,{recursive:true});for(const [name,layer]of Object.entries(gisLayers(bundle)))await writeFile(resolve(gis,`${name}.geojson`),JSON.stringify(layer));
    console.log(`Pasar Seni snapshot ready: ${bundle.graph.edges.length} paths, ${bundle.context.coverage.destinations} destinations, ${bundle.context.coverage.facilities} facilities. No field checks were created.`);
}catch(error){console.error(`Pilot refresh stopped: ${error.message}`);process.exitCode=1;}
