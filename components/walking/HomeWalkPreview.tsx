'use client';
import { useEffect, useMemo, useState } from 'react';
import ResidentMap from '@/components/map/ResidentMap';
import Link from 'next/link';
import { ArrowUpRight, MapPin, Clock3 } from 'lucide-react';
import { loadGraph, loadWalkingData, loadHazards, type GraphData } from '@/lib/api';
import { DESTINATIONS } from '@/lib/precinct';
import { DEFAULT_PILOT,PILOTS,type PilotId } from '@/lib/pilots';
import { DEFAULT_NEEDS, type WalkingData,type JourneyPlan } from '@/lib/walking';
import type { HazardReport } from '@/lib/routing';
import { usePlannerResult } from '@/lib/use-planner';

export default function HomeWalkPreview({area=DEFAULT_PILOT}:{area?:PilotId}) {
    const [data, setData] = useState<{ graph: GraphData; walking: WalkingData; hazards: HazardReport[] } | null>(null);
    const [error, setError] = useState(false);
    useEffect(() => {
        let cancelled=false;
        Promise.all([loadGraph(area), loadWalkingData(area), loadHazards(area)])
            .then(([graph, walking, hazards]) => {if(!cancelled)setData({ graph, walking, hazards: hazards.hazards });})
            .catch(() => {if(!cancelled)setError(true);});
        return()=>{cancelled=true;};
    }, [area]);
    const featured=(data?.graph.source.featured_ids??[]).map(id=>data?.walking.assets.find(a=>a.id===id)).filter(a=>a!==undefined);
    const place = area==='elmina'?data?.walking.assets.find(a => a.external_id === DESTINATIONS[0].id)
        :area==='pasar-seni'?(featured.find(a=>a.kind==='destination'&&a.category!=='transport')??featured[0]):featured[0];
    const origin=data?.graph.source.origin?.coordinates??PILOTS[area].centre;
    const snapshot=useMemo(()=>data?{nodes:data.graph.nodes,edges:data.graph.edges,walking:data.walking,hazards:data.hazards}:null,[data]);
    const search=usePlannerResult<JourneyPlan>(snapshot,place&&data?{type:'journey',input:{origin,destination:place,profile:'senior',needs:DEFAULT_NEEDS,departure_at:data.walking.as_of}}:null);
    const route=search.result?.routes.direct;
    const params=new URLSearchParams({area,...(place?{destId:place.external_id||place.id,startLat:String(origin[0]),startLng:String(origin[1])}:{})});
    return <section aria-label={`${PILOTS[area].short_name} walking preview`} className="relative isolate overflow-hidden rounded-[1.4rem] border border-[#dedbd5] bg-[#e8eee8] shadow-[0_8px_32px_rgba(39,35,43,.09)]">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#dedbd5] bg-[#fffefa] px-5 py-4">
            <div className="flex items-center gap-2 text-sm font-bold text-[#254c3c]"><MapPin size={18} className="shrink-0" aria-hidden />{area==='elmina'?'A walk around Elmina':area==='um-campus'?'Explore UM campus':'Explore Pasar Seni on foot'}</div>
            <span className="rounded-full border border-[#d5dfd5] bg-[#f3f6f1] px-3 py-1 text-xs font-semibold text-[#3f5a49]">Pedestrian network</span>
        </div>
        <div className="relative h-[22rem] sm:h-[27rem]">
            {data ? <ResidentMap area={area} startCoords={origin} endCoords={route ? [route.entrance.lat, route.entrance.lng] : place?[place.lat,place.lng]:undefined}
                routes={route ? [{ id: 'direct', name: 'Sample walk', route_type: 'direct', coordinates: route.coordinates }] : []}
                activeRouteId="direct" reduceMotion />
                : <div role="status" className="flex h-full items-center justify-center px-8 text-center text-sm text-[#3f5a49]">{error ? 'The map preview is unavailable. You can still open the walking planner.' : 'Loading the local pedestrian network…'}</div>}
        </div>
        <div className="relative border-t border-[#dedbd5] bg-[#fffefa] p-5">
            <div className="mb-3 flex flex-wrap items-center gap-2 text-xs font-semibold text-slate-600"><span className="rounded-full bg-[#edf5f1] px-2 py-1 text-emerald-900">{area==='elmina'?'Example walk':PILOTS[area].short_name}</span>Profile pace · conditions need checking</div>
            <h2 className="text-lg font-extrabold text-[#24392f]">{place?.name || (area==='elmina'?DESTINATIONS[0].name:PILOTS[area].name)}</h2>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                <span className="flex items-center gap-2 text-sm text-slate-700"><Clock3 size={17} aria-hidden />{route ? `${Math.ceil(route.total_min)} min · ${Math.round(route.length_m)} m` : search.pending?'Checking the mapped walk…':'Choose your pace and requirements'}</span>
                <Link href={`/resident?${params}`} className="inline-flex min-h-11 items-center gap-2 font-bold text-[#7f1d22] underline">{area==='elmina'?'Try this example':place?'Plan this walk':'Open walking planner'}<ArrowUpRight size={18} aria-hidden /></Link>
            </div>
        </div>
    </section>;
}
