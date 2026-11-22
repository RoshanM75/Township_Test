'use client';
import { useEffect,useState } from 'react';
import { loadPilotContext } from '@/lib/api';
import { PILOTS,type PilotId,type PilotContext } from '@/lib/pilots';
import { IS_PAGES_PREVIEW,sitePath } from '@/lib/site';

export default function PilotSources({area,context:provided}:{area:PilotId;context?:PilotContext|null}){
    const [loaded,setLoaded]=useState<PilotContext|null>(null),[error,setError]=useState('');
    useEffect(()=>{if(provided!==undefined)return;let cancelled=false;loadPilotContext(area).then(c=>{if(!cancelled)setLoaded(c);}).catch(()=>{if(!cancelled)setError('Source details are unavailable. Please refresh when connected.');});return()=>{cancelled=true;};},[area,provided]);
    const context=provided??loaded;
    return <details className="rounded-xl border-2 border-slate-300 bg-white p-3 text-slate-900">
        <summary className="min-h-8 cursor-pointer font-bold">About this map and its sources</summary>
        <div className="mt-3 space-y-4 text-sm"><p className="font-bold">{PILOTS[area].name}</p>
            {error&&<p role="status">{error}</p>}{!context&&!error&&<p role="status">Loading source coverage…</p>}
            {context&&<>
                <p>{context.coverage.paths} pedestrian segments · {context.coverage.crossings} mapped crossings · {context.coverage.destinations} places · {context.coverage.facilities} facilities.</p>
                <p>{context.coverage.entrances} mapped entrances · {context.coverage.approximate_approaches} approximate approaches. Actual availability, step-free access and connections need separate checks.</p>
                {context.coverage.components>1&&<p>{context.coverage.components} separate parts of the mapped path network. {context.coverage.unconnected_places} access or facility points have no nearby mapped path connection. Routes cannot bridge missing links.</p>}
                <ul className="space-y-3">{context.sources.map(source=><li className="rounded-lg border border-slate-200 p-3" key={source.id}><strong>{source.name}</strong><p>{source.status==='loaded'?'Source loaded':source.status==='partial'?'Partial coverage':source.status==='not_loaded'?'Optional source not loaded':'Source unavailable'} · {source.records} local records</p>
                    <p className="mt-1 text-xs">{source.note}</p><p className="mt-1 text-xs">Data date: {source.data_at||'not supplied'} · {source.license}</p><a href={source.url} className="inline-flex min-h-11 items-center font-bold underline" target="_blank" rel="noreferrer">Source and licence</a>
                    {source.archive_url && <a href={source.archive_url} className="ml-3 inline-flex min-h-11 items-center font-bold underline" target="_blank" rel="noreferrer">Archive</a>}</li>)}</ul>
                {context.walking_details && <p className="text-xs">Daylight shade uses representative times at 09:00, 12:00 and 16:00 Malaysia time on {context.walking_details.shade.model_date}. Select Roof cover for rain shelter.</p>}
                {context.transit.stops.length>0&&<p>{context.transit.stops.length} GTFS stops and {context.transit.routes.length} serving routes in this snapshot.</p>}
                {context.demand.stations.length>0&&<details><summary className="min-h-11 cursor-pointer font-bold">Station activity · {context.demand.data_at}</summary><ul>{context.demand.stations.map(s=><li key={s.name}>{s.name}: {s.entries.toLocaleString()} entries · {s.exits.toLocaleString()} exits</li>)}</ul><p className="mt-2 text-xs">{context.demand.note}</p></details>}
                {context.demographics.population!==null&&<details><summary className="min-h-11 cursor-pointer font-bold">District context · {context.demographics.year}</summary><p>{context.demographics.district}: approximately {Math.round(context.demographics.population).toLocaleString()} residents{context.demographics.older_share!==null?`; ${(context.demographics.older_share*100).toFixed(1)}% aged 65+`:''}.</p><p className="mt-2 text-xs">{context.demographics.note}</p></details>}
                {context.landmarks.length>0&&<details><summary className="min-h-11 cursor-pointer font-bold">Landmark background · Wikidata</summary><ul>{context.landmarks.slice(0,20).map(l=><li className="my-2" key={l.id}><a className="min-h-11 font-bold underline" href={l.url} target="_blank" rel="noreferrer">{l.name}</a><p className="text-xs">{l.description}</p></li>)}</ul></details>}
                {context.environment.scenes.length>0&&<details><summary className="min-h-11 cursor-pointer font-bold">Satellite and land-cover context</summary><p className="text-xs">{context.environment.note}</p><ul>{context.environment.scenes.slice(0,6).map(s=><li key={s.id} className="my-2"><a className="inline-flex min-h-11 items-center font-bold underline" href={s.url} target="_blank" rel="noreferrer">{s.collection}</a><p className="text-xs">{s.date}{s.cloud_percent===null?'':` · ${s.cloud_percent}% cloud`}</p></li>)}</ul></details>}
                {area!=='elmina'&&IS_PAGES_PREVIEW&&<details><summary className="min-h-11 cursor-pointer font-bold">Map data downloads · GeoJSON / QGIS</summary><p className="text-xs">These source layers support spatial review and field planning.</p><div className="flex flex-wrap gap-3">{['paths','places','transit','satellite'].map(layer=><a key={layer} className="inline-flex min-h-11 items-center font-bold underline" href={sitePath(`/pilot/${area}/gis/${layer}.geojson`)} download>{layer}</a>)}</div></details>}
            </>}
        </div>
    </details>;
}
