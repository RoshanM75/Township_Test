import { planCommunityJourney,planJourney,planReturnWalk,reachablePlaces } from './journeys.ts';
import { findFacilities,type FacilityKind } from './walk-tools.ts';
import type { PathNode,PathEdge,HazardReport } from './routing.ts';
import type { WalkingData,PlanningInput } from './walking.ts';
import type { CommunityRoute } from './community-routes.ts';

export interface PlanningSnapshot {nodes:PathNode[];edges:PathEdge[];walking:WalkingData;hazards:HazardReport[]}
export interface PlanningCommand {type:'journey'|'return'|'discover'|'facilities'|'community';input:PlanningInput|Omit<PlanningInput,'destination'|'entrance_id'>;feels_like?:number|null;kind?:FacilityKind;ids?:string[];community?:CommunityRoute}
export function dispatchPlan(snapshot:PlanningSnapshot,command:PlanningCommand){
    const {nodes,edges,walking,hazards}=snapshot;
    switch(command.type){
        case 'journey': if(!('destination' in command.input))throw Error('Choose a destination.');return planJourney(nodes,edges,walking,command.input,hazards,command.feels_like);
        case 'community': if (!command.community) throw Error('Choose a community route.'); return planCommunityJourney(nodes,edges,walking,command.input,command.community,hazards);
        case 'return': return planReturnWalk(nodes,edges,walking,command.input,hazards,command.feels_like);
        case 'discover': return reachablePlaces(nodes,edges,walking,command.input,hazards,command.ids);
        case 'facilities': if(!command.kind)throw Error('Choose a facility type.');return findFacilities(nodes,edges,walking,command.input,command.kind,hazards,command.ids);
    }
}
