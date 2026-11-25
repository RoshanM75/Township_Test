import { placeSearchText, type WalkingAsset } from './walking.ts';

export const PLACE_GOALS = [
    ['all','Anything nearby'],['pharmacy','Pharmacy'],['healthcare','Clinics & healthcare'],['food','Lunch & markets'],
    ['groceries','Groceries'],['shopping','Local shops'],['parcel','Parcel & post'],['community','Libraries & community places'],
    ['park','Parks'],['transport','Transit stops'],['toilet','Toilets'],['water','Drinking water'],['rest','Seats & rest areas'],['shelter','Covered waiting areas'],
] as const;
export type PlaceGoal=typeof PLACE_GOALS[number][0];
export const isPlaceGoal=(value:unknown):value is PlaceGoal=>PLACE_GOALS.some(([key])=>key===value);

export function matchesGoal(asset:WalkingAsset,goal:string) {
    if(goal==='all') return true;
    const properties=asset.properties, text=placeSearchText(asset);
    if(goal==='pharmacy')return properties.osm_amenity==='pharmacy'||properties.osm_shop==='chemist'||/pharmacy|farmasi|chemist/.test(text);
    if(goal==='groceries')return ['supermarket','convenience','greengrocer','grocery'].includes(String(properties.osm_shop))||/grocery|grocer|supermarket|pasar raya/.test(text);
    if(goal==='parcel')return ['post_office','parcel_locker'].includes(String(properties.osm_amenity))||/post office|parcel|pos malaysia|pos laju/.test(text);
    if(['toilet','water','rest','shelter'].includes(goal))return asset.kind===goal;
    return asset.category===goal;
}
