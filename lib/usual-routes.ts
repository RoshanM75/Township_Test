import type { WalkPack } from './walk-library.ts';
import type { PathEdge, HazardReport } from './routing.ts';
import type { WalkingData, VerificationRecord } from './walking.ts';
import type { MaintenanceDefect } from './types.ts';
import type { CommunityRoute } from './community-routes.ts';
import { journeyTargets, reportsOnJourney } from './journey-readiness.ts';
import { evidenceFor } from './verification.ts';
import { observedEdge, CONDITION_LABELS, assetFacts } from './route-conditions.ts';

export interface RouteMonitor {
    label: string;
    enabled: boolean;
}
export interface RoutineFeed {
    walking: WalkingData;
    edges: PathEdge[];
    hazards: HazardReport[];
    reports: MaintenanceDefect[];
    local_reports?:MaintenanceDefect[];
    community: CommunityRoute[];
    fetched_at: string;
    snapshot: boolean;
    unavailable?: boolean;
}
export interface RoutineChange { key: string; title: string; detail: string; level: 'attention' | 'update' | 'review' }
export interface RoutineStatus { changes: RoutineChange[]; status: 'not-checked' | 'snapshot' | 'unavailable' | 'review' | 'current'; checked_at: string | null }

export function inspectRoutine(pack: WalkPack, feed: RoutineFeed | undefined, now: string): RoutineStatus {
    if (!feed) return { changes: [], status: 'not-checked', checked_at: null };
    const changes = new Map<string,RoutineChange>();
    const add = (key: string, title: string, detail: string, level: RoutineChange['level']) => changes.set(key,{key,title,detail,level});
    const route = pack.route, assets = journeyTargets(route), edgeIds = new Set(route.edge_ids);
    if (route.start_asset_id) assets.add(route.start_asset_id);
    if (pack.dataset_id && pack.dataset_id !== feed.walking.dataset_id) {
        add('dataset', 'Walking map changed', 'Replan using the new network; old segment IDs may no longer match.', 'attention');
    } else {
        const currentEdges = new Map(feed.edges.map(edge => [edge.id,edge]));
        const savedEdges = new Map(pack.edges.map(edge => [edge.id,edge]));
        const currentAssets = new Map(feed.walking.assets.map(asset=>[asset.id,asset]));
        for (const id of edgeIds) {
            const raw = currentEdges.get(id);
            if (!raw) { add('missing:'+id,'Mapped path changed',savedEdges.get(id)?.name || 'Saved segment is no longer mapped','attention'); continue; }
            const old = savedEdges.get(id);
            if (old) {
                const previous = observedEdge(old, pack.checks as VerificationRecord[], pack.saved_at);
                const current = observedEdge(raw, feed.walking.verifications, now);
                for (const field of ['covered','has_steps','has_kerb_ramp','surface_rating','slope_pct','lit_ratio'] as const) {
                    if (previous[field] !== current[field]) add(`edge:${id}:${field}`, `${CONDITION_LABELS[field]} changed`, raw.name || 'Saved path segment', 'review');
                }
            }
        }
        for (const asset of [route.destination,route.entrance,...route.rest_stops,...(route.errand_stops ?? []).flatMap(stop=>[stop.destination,stop.entrance])]) {
            const current=currentAssets.get(asset.id);
            if (!current && !asset.id.startsWith('return:') && !asset.id.startsWith('community-end:') && !asset.id.startsWith('errand:'))
                add('asset:'+asset.id,'Access point needs review',asset.name,'attention');
            if(current){
                const old=assetFacts(asset,{...feed.walking,verifications:pack.checks as VerificationRecord[]},pack.saved_at).values;
                const next=assetFacts(current,feed.walking,now).values;
                for(const field of ['available','step_free','path_connection','lift_available','opening_hours','sheltered','public_access','fee']){
                    if(old[field]!==next[field])add('asset:'+asset.id+':'+field,'Access condition changed',asset.name+' · '+(CONDITION_LABELS[field]??field),'review');
                }
            }
        }
        if(route.start_asset_id && !currentAssets.has(route.start_asset_id))
            add('start','Starting access point changed','Choose a current mapped starting point.','attention');
        for (const report of reportsOnJourney(route,feed.reports)) {
            if (report.dismissed_at || report.kind==='check_requested') continue;
            const fixed = report.status==='fixed';
            const date = fixed ? report.fixed_at : report.checked_at ?? report.created_at;
            if (fixed && (!date || date < pack.saved_at)) continue;
            add(`report:${report.id}`, fixed ? 'Repair recorded' : report.checked_at ? 'Checked condition change' : report.created_at && report.created_at<pack.saved_at?'Unresolved community report':'New community report',
                `${report.location_name ?? 'Saved route'} · ${String(report.kind ?? report.category).replaceAll('_',' ')}`,
                fixed ? 'update' : 'attention');
        }
        for(const report of reportsOnJourney(route,feed.local_reports??[])){
            add('local:'+report.id,report.kind==='check_requested'?'Your field-check request':'Your device report',
                (report.location_name??'Saved route')+' · Saved privately; not reviewed or sent', 'review');
        }
        // Compare independently checked fields even when a change did not come through a repair ticket.
        const targets = new Set(feed.walking.verifications.filter(r => assets.has(r.target_id) && ['entrance','facility'].includes(r.target_type)
            || ['path','crossing'].includes(r.target_type) && edgeIds.has(Number(r.target_id))).map(r=>`${r.target_type}:${r.target_id}`));
        for (const check of pack.checks) targets.add(`${check.target_type}:${check.target_id}`);
        const nameOf = (type:string,id:string)=>['path','crossing'].includes(type) ? currentEdges.get(Number(id))?.name ?? 'Saved path segment' : currentAssets.get(id)?.name ?? 'Saved access point';
        for (const key of targets) {
            const split=key.indexOf(':'), type=key.slice(0,split) as VerificationRecord['target_type'], id=key.slice(split+1);
            const before=evidenceFor(pack.checks as VerificationRecord[],type,id,pack.saved_at);
            const after=evidenceFor(feed.walking.verifications,type,id,now);
            for (const [field, fact] of Object.entries(after)) {
                const oldFact=before[field];
                if (fact.status==='stale' && (oldFact?.status==='verified' || Date.parse(fact.observed_at)>=Date.parse(pack.saved_at)))
                    add(`field:${key}:${field}`,'Field review overdue',`${nameOf(type,id)} · ${CONDITION_LABELS[field] ?? field}`,'review');
                else if (fact.observed_at >= pack.saved_at && (!oldFact || oldFact.value!==fact.value || oldFact.status!==fact.status))
                    add(`field:${key}:${field}`,'Condition evidence updated',`${nameOf(type,id)} · ${CONDITION_LABELS[field] ?? field}${fact.value === false ? ' · recorded unavailable' : ''}`,'review');
            }
        }
        for (const hazard of feed.hazards.filter(h => h.status !== 'fixed' && h.kind !== 'check_requested' && (h.asset_id ? assets.has(h.asset_id) : h.edge_id !== null && edgeIds.has(h.edge_id)))) {
            // Some feeds have no corresponding public case row.
            if (feed.reports.some(r=>String(r.hazard_report_id)===String(hazard.id))) continue;
            add('hazard:'+hazard.id,hazard.status==='verified'?'Checked route issue':'Reported route issue',String(hazard.kind).replaceAll('_',' '),'attention');
        }
        if (route.community_id) {
            const guide=feed.community.find(g=>g.id===route.community_id);
            if (!guide || guide.status!=='verified' || !guide.valid_until || Date.parse(guide.valid_until)<=Date.parse(now))
                add('guide','Local route guide needs a new check','Its published verification is unavailable or expired.','attention');
        }
    }
    const sorted=[...changes.values()].sort((a,b)=>({attention:0,review:1,update:2}[a.level]-{attention:0,review:1,update:2}[b.level]));
    const stale = Date.parse(now)-Date.parse(feed.fetched_at)>120000;
    return { changes:sorted,checked_at:feed.fetched_at,
        status: feed.unavailable || stale && !feed.snapshot ? 'unavailable' : sorted.length ? 'review' : feed.snapshot ? 'snapshot' : 'current' };
}
