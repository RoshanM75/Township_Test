'use client';
import { useEffect, useState } from 'react';
import type { PilotId } from '@/lib/pilots';
import { sitePath } from '@/lib/site';
import type { TerrainDetail } from '@/lib/map-detail';

const cache = new Map<PilotId,TerrainDetail>();
export function useMapTerrain(area?:PilotId){
    const [result,setResult]=useState<{area:PilotId;detail:TerrainDetail|null}|null>(()=>area&&cache.has(area)?{area,detail:cache.get(area)!}:null);
    useEffect(()=>{
        if(!area)return;
        if(cache.has(area))return;
        const controller=new AbortController();let active=true;
        fetch(sitePath(`/map-area/${area}-terrain.json`),{signal:controller.signal}).then(response=>{
            if(!response.ok)throw Error('Elevation source unavailable');return response.json() as Promise<TerrainDetail>;
        }).then(detail=>{
            if(!Array.isArray(detail.bounds)||detail.bounds.length!==4||!detail.bounds.every(Number.isFinite)||!Number.isFinite(detail.sample_spacing_m))throw Error('Invalid terrain metadata');
            cache.set(area,detail);if(active)setResult({area,detail});
        }).catch(()=>{if(active)setResult({area,detail:null});});
        return()=>{active=false;controller.abort();};
    },[area]);
    const cached=area?cache.get(area):undefined;
    return {detail:cached??(result?.area===area?result?.detail??null:null),loading:Boolean(area&&!cached&&result?.area!==area)};
}
