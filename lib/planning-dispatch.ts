import { planCommunityJourney, planJourney, planReturnWalk, reachablePlaces } from './journeys.ts';
import { findFacilities, type FacilityKind } from './walk-tools.ts';
import type { PathNode, PathEdge, HazardReport, Mode } from './routing.ts';
import { WALK_BUDGETS, type JourneyPlan, type WalkingData, type PlanningInput } from './walking.ts';
import type { CommunityRoute } from './community-routes.ts';
import { compareMaintenanceImpact, type ImpactRequest } from './maintenance-impact.ts';
import { planErrands, type ErrandRequest } from './errand-planner.ts';
import type { WalkingWeather } from './comfort.ts';
import { solarModel, type ShadeDataset } from './solar-shade.ts';

export interface PlanningSnapshot {
    nodes: PathNode[];
    edges: PathEdge[];
    walking: WalkingData;
    hazards: HazardReport[];
    shade?: ShadeDataset;
    weather?: WalkingWeather|null;
}

export interface SearchCommand {
    type: 'journey' | 'return' | 'discover' | 'facilities' | 'community' | 'errands';
    input: PlanningInput | Omit<PlanningInput, 'destination' | 'entrance_id'>;
    feels_like?: number | null;
    kind?: FacilityKind;
    ids?: string[];
    community?: CommunityRoute;
    modes?: Mode[];
    suggestBudget?: boolean;
    errands?: ErrandRequest;
}

export interface DepartureOption {
    departure: string;
    minutes: number;
    sunSeconds: number;
    unknownSeconds: number;
}

export type PlanningCommand = SearchCommand | { type: 'impact'; request: ImpactRequest } | {
    type: 'departures';
    plan: SearchCommand;
    times: Array<{ departure: string; feels_like?: number | null }>;
    mode: Mode;
};

export function dispatchPlan(snapshot: PlanningSnapshot, command: PlanningCommand) {
    const { nodes, edges, walking, hazards, shade, weather } = snapshot;
    if(command.type!=='impact'&&command.type!=='departures'&&weather)command={...command,input:{...command.input,weather}};
    const model = shade && solarModel(shade);
    switch (command.type) {
        case 'journey': {
            if (!('destination' in command.input)) throw Error('Choose a destination.');
            const input = command.input;
            const result = planJourney(nodes, edges, walking, input, hazards, command.feels_like, command.modes, model);
            const maximumBudget = WALK_BUDGETS.at(-1)!;
            if (!command.suggestBudget || result.issue?.kind !== 'needs' || input.needs.budget_min >= maximumBudget) return result;
            const { routes } = planJourney(nodes, edges, walking, { ...input, needs: { ...input.needs, budget_min: maximumBudget } },
                hazards, command.feels_like, ['direct']);
            const minutes = Math.ceil(routes.direct?.total_min ?? Infinity);
            const budget = WALK_BUDGETS.find(option => option >= minutes && option > input.needs.budget_min);
            if (!budget || minutes <= input.needs.budget_min) return result;
            return {
                ...result, issue: { kind: 'budget', estimated_min: minutes, suggested_min: budget },
                reasons: [`A matching route takes about ${minutes} min. Your trip budget is ${input.needs.budget_min} min.`],
            } satisfies JourneyPlan;
        }
        case 'impact': return compareMaintenanceImpact(nodes,edges,walking,hazards,command.request,shade);
        case 'errands':
            if (!command.errands) throw Error('Choose your errands.');
            return planErrands(nodes, edges, walking, command.input, command.errands, hazards, command.feels_like,model);
        case 'community':
            if (!command.community) throw Error('Choose a community route.');
            return planCommunityJourney(nodes, edges, walking, command.input, command.community, hazards, model);
        case 'return':
            return planReturnWalk(nodes, edges, walking, command.input, hazards, command.feels_like, model, command.modes);
        case 'discover':
            return reachablePlaces(nodes, edges, walking, command.input, hazards, command.ids,command.modes,model);
        case 'facilities':
            if (!command.kind) throw Error('Choose a facility type.');
            return findFacilities(nodes, edges, walking, command.input, command.kind, hazards, command.ids);
        case 'departures': {
            if (!model) return [];
            return command.times.flatMap(({ departure, feels_like }): DepartureOption[] => {
                const { plan, mode } = command;
                const input = { ...plan.input, departure_at: departure, weather };
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
