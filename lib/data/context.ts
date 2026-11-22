import type { PilotContext, PilotId, TransitCalendar, TransitPattern, TransitStop } from '../pilots.ts';
import { PILOTS, pointInPilot } from '../pilots.ts';

export function transitContext(files: Record<string,Record<string,string>[]>, agency: string, area: PilotId) {
    const qualify = (id: string) => `${agency}:${id}`;
    const stops = files['stops.txt'] ?? [];
    const routes = new Map((files['routes.txt'] ?? []).map(r => [r.route_id, r]));
    const trips = new Map((files['trips.txt'] ?? []).map(t => [t.trip_id, t]));
    const origins = new Map((files.trip_origins ?? []).map(r => [r.trip_id, parseTime(r.time)]));
    const frequencies = new Map<string, TransitPattern['windows']>();
    for (const row of files['frequencies.txt'] ?? []) {
        if (!frequencies.has(row.trip_id)) frequencies.set(row.trip_id, []);
        const start = parseTime(row.start_time), end = parseTime(row.end_time), gap = Number(row.headway_secs);
        if (start !== null && end !== null && end > start && gap > 0 && Number.isSafeInteger(gap)) {
            frequencies.get(row.trip_id)!.push([start, end, gap]);
        }
    }
    const weekdays = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const calendars: Record<string, TransitCalendar> = {};
    for (const row of files['calendar.txt'] ?? []) {
        if (!/^\d{8}$/.test(row.start_date) || !/^\d{8}$/.test(row.end_date) || row.end_date < row.start_date) continue;
        calendars[qualify(row.service_id)] = { from: row.start_date, to: row.end_date,
            weekdays: weekdays.map(day => row[day] === '1'), exceptions: {} };
    }
    for (const row of files['calendar_dates.txt'] ?? []) {
        if (!/^\d{8}$/.test(row.date) || !['1', '2'].includes(row.exception_type)) continue;
        const rule = calendars[qualify(row.service_id)] ??= { from: '', to: '', weekdays: [], exceptions: {} };
        rule.exceptions[row.date] = row.exception_type === '1';
    }
    const chosen = new Map<string, TransitStop>();
    for (const s of stops) {
        const point: [number, number] = [Number(s.stop_lat), Number(s.stop_lon)];
        if (!s.stop_id || !s.stop_name || !s.stop_lat?.trim() || !s.stop_lon?.trim() || !pointInPilot(point, area)) continue;
        chosen.set(s.stop_id, { id: qualify(s.stop_id), name: s.stop_name, lat: point[0], lng: point[1], agency,
            parent_station: s.parent_station || '', location_type: s.location_type || '0', routes: [],
            ...(s.stop_code || agency === 'rapid-rail-kl' ? { code: s.stop_code || s.stop_id } : {}),
            ...(s.wheelchair_boarding === '1' ? { boarding: 'yes' } : s.wheelchair_boarding === '2' ? { boarding: 'no' } : {}) });
    }
    const byStop = new Map<string, Map<string, TransitPattern>>();
    for (const time of files['stop_times.txt'] ?? []) {
        const stop = chosen.get(time.stop_id), trip = trips.get(time.trip_id);
        if (!stop || !trip || !routes.has(trip.route_id)) continue;
        const route = qualify(trip.route_id);
        if (!stop.routes.includes(route)) stop.routes.push(route);
        const departure = parseTime(time.departure_time || time.arrival_time);
        const service = qualify(trip.service_id);
        if (departure === null || !calendars[service] || time.pickup_type === '1') continue;
        const headsign = time.stop_headsign || trip.trip_headsign || '';
        const key = JSON.stringify([route, service, headsign]);
        if (!byStop.has(stop.id)) byStop.set(stop.id, new Map());
        const byPattern = byStop.get(stop.id)!;
        const pattern = byPattern.get(key) ?? { route_id: route, service_id: service, headsign, times: [], windows: [] };
        const windows = frequencies.get(time.trip_id);
        if (windows) {
            const origin = origins.get(time.trip_id);
            if (origin !== undefined && origin !== null && origin <= departure) {
                const offset = departure - origin;
                for (const [start, end, gap] of windows) pattern.windows.push([start + offset, end + offset, gap]);
            }
        } else pattern.times.push(departure);
        byPattern.set(key, pattern);
    }
    for (const stop of chosen.values()) {
        const patterns = byStop.get(stop.id);
        if (!patterns) continue;
        stop.patterns = [...patterns.values()].filter(p => p.times.length || p.windows.length).map(p => ({
            ...p, times: [...new Set(p.times)].sort((a, b) => a - b),
            windows: [...new Map(p.windows.map(window => [window.join(':'), window])).values()],
        }));
    }
    const local = [...chosen.values()];
    const used = new Set(local.flatMap(stop => stop.routes));
    const services = new Set(local.flatMap(stop => stop.patterns?.map(pattern => pattern.service_id) ?? []));
    return {
        stops: local,
        routes: [...routes.values()].filter(r => used.has(qualify(r.route_id))).map(r => ({
            id: qualify(r.route_id), name: [r.route_short_name, r.route_long_name].filter(Boolean).join(' · ') || r.route_id, agency,
        })),
        service_dates: [...new Set(Object.values(calendars).filter(c => c.from).map(c => `${c.from}–${c.to}`))],
        calendars: Object.fromEntries(Object.entries(calendars).filter(([id]) => services.has(id))),
    };
}

function parseTime(value: string | undefined) {
    const match = /^(\d{1,2}):([0-5]\d):([0-5]\d)$/.exec(value ?? '');
    return match && Number(match[1]) < 48 ? Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) : null;
}

export function railDemand(rows: Record<string,string>[], stopNames: string[]) {
    const normalise=(v:string)=>v.normalize('NFKD').replace(/[^a-z0-9]/gi,'').toLowerCase();
    const wanted=new Set([...stopNames,'Pasar Seni','Masjid Jamek','Merdeka'].map(normalise));
    const dates=rows.map(r=>r.date).filter(d=>/^\d{4}-\d{2}-\d{2}$/.test(d));const date=dates.sort().at(-1)??null;
    const stations=new Map<string,{name:string;entries:number;exits:number;totalEntries?:number;totalExits?:number}>();
    for(const r of rows){const count=Number(r.ridership);if(r.date!==date||!Number.isFinite(count)||count<0||!r.ridership?.trim())continue;
        for(const [field,measure] of [['origin','entries'],['destination','exits']] as const){const name=r[field];if(!name||!wanted.has(normalise(name)))continue;
            if(!stations.has(name))stations.set(name,{name,entries:0,exits:0});
            const station=stations.get(name)!;
            const other=r[field==='origin'?'destination':'origin']??'';
            if(/^(?:A0\s*:|all stations$)/i.test(other)){
                if(measure==='entries')station.totalEntries=count;
                else station.totalExits=count;
            }else station[measure]+=count;
        }
    }
    return {data_at:date,stations:[...stations.values()].map(s=>({ name:s.name, entries:s.totalEntries??s.entries, exits:s.totalExits??s.exits })),
        note:'Counts give station tap-in and tap-out journeys for the stated day. Street footfall and access conditions require separate observations.'};
}

export function districtPopulation(rows: Record<string,string>[], area: PilotId): PilotContext['demographics'] {
    const district=PILOTS[area].district;
    const chosen=rows.filter(r=>r.district===district&&r.sex==='both'&&r.ethnicity==='overall');
    const year=chosen.map(r=>r.date?.slice(0,4)).filter(y=>/^\d{4}$/.test(y??'')).sort().at(-1)??null;
    const current=chosen.filter(r=>r.date.startsWith(year||'unavailable'));
    const total=current.find(r=>r.age==='overall');const population=total?.population?.trim()?Math.round(Number(total.population)*1000):null;
    const older=current.filter(r=>r.age!=='overall'&&parseInt(r.age,10)>=65&&r.population.trim());
    const sum=older.reduce((n,r)=>n+Math.round(Number(r.population)*1000),0);
    const olderPopulation=older.length&&Number.isFinite(sum)?sum:null;
    return {district,year,population:Number.isFinite(population)&&population!==null&&population>=0?population:null,older_population:olderPopulation!==null&&olderPopulation>=0?olderPopulation:null,
        older_share:population&&olderPopulation!==null?olderPopulation/population:null,
        note:'DOSM figures are district-level estimates, in thousands in the source. They are not neighbourhood counts or evidence about an individual walker.'};
}

export function wikidataLandmarks(value: unknown, area: PilotId): PilotContext['landmarks'] {
    const result=(value??{}) as {results?:{bindings?:Array<Record<string,{value:string}>>}};
    return (result.results?.bindings??[]).flatMap(r=>{
        const id=r.item?.value?.match(/\/(Q[1-9]\d*)$/)?.[1];
        const point=/^Point\((-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)\)$/.exec(r.location?.value||'');
        if(!id||!point||!pointInPilot([Number(point[2]),Number(point[1])],area)||!r.itemLabel?.value)return [];
        return [{id,name:r.itemLabel.value,description:r.itemDescription?.value||'',url:`https://www.wikidata.org/wiki/${id}`,coordinates:[Number(point[2]),Number(point[1])] as [number,number]}];
    });
}

export function satelliteScenes(value: unknown,area:PilotId='pasar-seni'): PilotContext['environment']['scenes'] {
    const data=(value??{}) as {features?:Array<{id:string;collection:string;bbox:number[];properties:Record<string,unknown>}>};
    const [south,west,north,east]=PILOTS[area].bounds;
    return (data.features??[]).filter(f=>typeof f.id==='string'&&Array.isArray(f.bbox)&&f.bbox.length===4&&f.bbox.every(Number.isFinite)
        &&f.bbox[0]<=east&&f.bbox[2]>=west&&f.bbox[1]<=north&&f.bbox[3]>=south
        &&['sentinel-2-l2a','esa-worldcover'].includes(f.collection)&&typeof (f.properties?.datetime||f.properties?.['start_datetime'])==='string')
        .map(f=>({id:f.id,date:String(f.properties.datetime||f.properties.start_datetime),cloud_percent:typeof f.properties['eo:cloud_cover']==='number'?f.properties['eo:cloud_cover']:null,
            collection:f.collection,bbox:f.bbox,url:`https://planetarycomputer.microsoft.com/dataset/${f.collection}`}));
}
