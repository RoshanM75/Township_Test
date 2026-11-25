'use client';

import { useEffect, useMemo, useState } from 'react';
import { loadGraph, loadWalkingData, loadHazards, loadReports, loadPilotContext, loadCommunityRoutes } from './api';
import { withMappedDetails } from './pilot-walking-details';
import type { PilotId } from './pilots';
import { IS_PAGES_PREVIEW } from './site';
import type { WalkPack } from './walk-library';
import type { RoutineFeed } from './usual-routes';

/** Only public area data is fetched. Saved starts, destinations and profiles
 * stay in the browser. Other areas are polled while viewing the saved routes. */
export function useRoutineFeeds(packs: WalkPack[], currentArea: PilotId, enabled: boolean, revision = 0) {
    const areaKey = [...new Set(packs.filter(pack=>pack.routine?.enabled && (pack.area_id??'elmina')!==currentArea)
        .map(pack=>pack.area_id??'elmina'))].sort().join(',');
    const areas = useMemo(()=>areaKey ? areaKey.split(',') as PilotId[] : [],[areaKey]);
    const [feeds,setFeeds]=useState<Partial<Record<PilotId,RoutineFeed>>>({});
    useEffect(()=>{
        if (!enabled || !areas.length) return;
        let closed=false, running=false;
        const cache=new Map<PilotId, Pick<RoutineFeed,'edges'> & { dataset?:string }>();
        async function refresh(){
            if (closed || running || document.hidden) return;
            running=true;
            await Promise.allSettled(areas.map(async area=>{
                try {
                    const [walking,context,hazards,reports,community] = await Promise.all([loadWalkingData(area),loadPilotContext(area),loadHazards(area),loadReports('all',area),IS_PAGES_PREVIEW ? Promise.resolve({routes:[]}) : loadCommunityRoutes(area)]);
                    let graph=cache.get(area);
                    if (!graph || graph.dataset!==walking.dataset_id) {
                        const fetched=await loadGraph(area);
                        graph={edges:withMappedDetails(fetched.edges,walking,context).edges,dataset:walking.dataset_id};cache.set(area,graph);
                    }
                    const mapped=withMappedDetails([],walking,context).walking;
                    if (!closed) setFeeds(previous=>({...previous,[area]:{walking:mapped,edges:graph.edges,hazards: hazards.hazards,reports:reports.reports,
                        community:community.routes,fetched_at:new Date().toISOString(),snapshot:IS_PAGES_PREVIEW}}));
                } catch {
                    if (!closed) setFeeds(previous=>previous[area]?{...previous,[area]:{...previous[area]!,unavailable:true}}:previous);
                }
            }));
            running=false;
        }
        void refresh();
        const timer=IS_PAGES_PREVIEW?undefined:setInterval(refresh,60000);
        const visible=()=>{if(!document.hidden)void refresh();};
        document.addEventListener('visibilitychange',visible);
        return()=>{closed=true;clearInterval(timer);document.removeEventListener('visibilitychange',visible);};
    },[areas,enabled,revision]);
    return feeds;
}
