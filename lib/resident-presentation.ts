import type { Mode } from './routing.ts';
import type { JourneyRoute } from './walking.ts';

export type PanelState = 'min'|'open'|'full';

/** The grip has one predictable tap action, and a three-position keyboard/drag
 * action. Dragging a long way down dismisses details immediately. */
export function panelTap(state:PanelState):PanelState {
    return state==='min'?'open':'min';
}
export function panelStep(state:PanelState,direction:'up'|'down'):PanelState {
    if(direction==='up') return state==='min'?'open':'full';
    return state==='full'?'open':'min';
}
export function panelDrag(state:PanelState,travel:number):PanelState|null {
    if(Math.abs(travel)<28) return null;
    return travel>110?'min':panelStep(state,travel>0?'down':'up');
}

/** This is presentation only. Do not discard a route mode or replace the
 * planner's result. Group repeated geometry/entrances/rest stops, while keeping
 * the recommended and explicitly chosen options visible. */
export function routeChoiceGroups(
    routes:Partial<Record<Mode,JourneyRoute>>,modes:Mode[],chosen:Mode,fastest:Mode,recommended?:Mode|null,
):{ lead:Mode[];more:Mode[] } {
    const ordered=[...new Set([...(recommended?[recommended]:[]),fastest,...modes])].filter(mode=>modes.includes(mode)&&routes[mode]);
    const lead:Mode[]=[],more:Mode[]=[];
    const keys=new Set<string>();
    for(const mode of ordered){
        const route=routes[mode]!;
        const key=JSON.stringify([route.coordinates,route.entrance.id,route.rest_stops.map(rest=>rest.id)]);
        if(keys.has(key)&&mode!==chosen)more.push(mode);
        else {lead.push(mode);keys.add(key);}
    }
    return {lead,more};
}
