import { planCommunityJourney, planJourney, planReturnWalk, reachablePlaces } from './journeys.ts';
import { findFacilities, type FacilityKind } from './walk-tools.ts';
import type { PathNode, PathEdge, HazardReport, Mode } from './routing.ts';
import type { WalkingData, PlanningInput } from './walking.ts';
import type { CommunityRoute } from './community-routes.ts';
import { solarModel, type ShadeDataset } from './solar-shade.ts';

export interface PlanningSnapshot {
    nodes: PathNode[];
    edges: PathEdge[];
    walking: WalkingData;
    hazards: HazardReport[];
    shade?: ShadeDataset;
}

export interface SearchCommand {
    type: 'journey' | 'return' | 'discover' | 'facilities' | 'community';
    input: PlanningInput | Omit<PlanningInput, 'destination' | 'entrance_id'>;
    feels_like?: number | null;
    kind?: FacilityKind;
    ids?: string[];
    community?: CommunityRoute;
    modes?: Mode[];
}

export interface DepartureOption {
    departure: string;
    minutes: number;
    sunSeconds: number;
    unknownSeconds: number;
}

export type PlanningCommand = SearchCommand | {
    type: 'departures';
    plan: SearchCommand;
    times: Array<{ departure: string; feels_like?: number | null }>;
    mode: Mode;
};

export function dispatchPlan(snapshot: PlanningSnapshot, command: PlanningCommand) {
    const { nodes, edges, walking, hazards, shade } = snapshot;
    const model = shade && solarModel(shade);
    switch (command.type) {
        case 'journey':
            if (!('destination' in command.input)) throw Error('Choose a destination.');
            return planJourney(nodes, edges, walking, command.input, hazards, command.feels_like, command.modes, model);
        case 'community':
            if (!command.community) throw Error('Choose a community route.');
            return planCommunityJourney(nodes, edges, walking, command.input, command.community, hazards, model);
        case 'return':
            return planReturnWalk(nodes, edges, walking, command.input, hazards, command.feels_like, model, command.modes);
        case 'discover':
            return reachablePlaces(nodes, edges, walking, command.input, hazards, command.ids);
        case 'facilities':
            if (!command.kind) throw Error('Choose a facility type.');
            return findFacilities(nodes, edges, walking, command.input, command.kind, hazards, command.ids);
        case 'departures': {
            if (!model) return [];
            return command.times.flatMap(({ departure, feels_like }): DepartureOption[] => {
                const { plan, mode } = command;
                const input = { ...plan.input, departure_at: departure };
                const result = plan.type === 'community' && plan.community
                    ? planCommunityJourney(nodes, edges, walking, input, plan.community, hazards, model)
                    : plan.type === 'return' ? planReturnWalk(nodes, edges, walking, input, hazards, feels_like, model, [mode])
                    : 'destination' in input ? planJourney(nodes, edges, walking, input, hazards, feels_like, [mode], model) : null;
                const route = result?.routes[mode];
                const exposure = route?.sun_exposure;
                return route && exposure && exposure.daylight_s > 0 ? [{ departure, minutes: route.total_min,
                    sunSeconds: exposure.sun_s, unknownSeconds: exposure.unknown_s }] : [];
            });
        }
    }
}
