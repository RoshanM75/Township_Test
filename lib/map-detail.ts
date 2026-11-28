import type { Feature, Geometry } from 'geojson';
import type { ResidentLanguage } from './resident-language.ts';
import { residentText } from './resident-language.ts';

export type MapAppearance = 'detailed' | 'street';
export interface TerrainDetail {
    bounds: [number,number,number,number];
    minzoom:number; maxzoom:number; tileSize:number;
    attribution:string; source_url:string; source_resolution_m:number;
    sample_spacing_m:number; contour_interval_m:number; min_m:number; max_m:number; sample_count:number;
}
export interface MapProperties {
    kind:string; name?:string; mapName?:string; osmRef?:string;
    use?:string; height?:number; base?:number; heightSource?:string; baseSource?:string;
    part?:boolean; volume?:boolean; levels?:number; roofShape?:string;
    road?:string; roadClass?:string; pathType?:string; structure?:string; restricted?:boolean; covered?:boolean;
    level?:string; surface?:string; landcover?:string; sport?:string; railway?:string; waterway?:string; barrier?:string;
    labelKind?:string; priority?:number; minZoom?:number; elevation?:number; major?:boolean;
}
export type DetailFeature = Feature<Geometry,MapProperties>;

/** Both renderers use this visual vocabulary. These colours convey cartography,
 * not verification or a guarantee that a footpath is accessible. */
export const mapColors={
    ground:'#f2eee4', landuse:'#e9e4dc', institutional:'#e9e5ed', commercialLand:'#eee5dd', construction:'#eadfcf',
    green:'#ccdfc4', wood:'#b7d1ac', grass:'#dfebd2', pitch:'#c6dbbd', water:'#a8d0de', waterEdge:'#7fb2c4',
    plaza:'#e7ddca', parking:'#e0e2df', deck:'#dedbd3', contour:'#a5967e',
    building:'#d4c9bd', buildingOutline:'#bbb1a8', civic:'#c4d0d5', commercial:'#d6c2b0', residential:'#e4d8c9',
    approximate:'#d9d5cd', canopy:'#abc7bd',
    road:'#fffefa', roadEdge:'#d0c7b9', arterial:'#f2cd8d', primary:'#f9dda6', majorEdge:'#cca974',
    rail:'#737c88', railInner:'#f4f2ed', path:'#8d7f6c', covered:'#527c74', stairs:'#776d88', crossing:'#8d7962',
    underground:'#96969e', boundary:'#a29e92', label:'#48443f', station:'#275f79', place:'#4e4356', health:'#875368', food:'#865d31', shop:'#7d5148',
} as const;

export function polygonColour(p:MapProperties){
    switch(p.kind){
        case 'green':return p.landcover==='wood'?mapColors.wood:p.landcover==='grass'?mapColors.grass:mapColors.green;
        case 'landuse':return p.landcover==='institutional'?mapColors.institutional:['commercial','retail'].includes(p.landcover??'')?mapColors.commercialLand:p.landcover==='construction'?mapColors.construction:mapColors.landuse;
        case 'water':return mapColors.water;
        case 'pitch':return mapColors.pitch;
        case 'plaza':return mapColors.plaza;
        case 'parking':return mapColors.parking;
        case 'deck':return mapColors.deck;
        case 'building':return p.use==='canopy'?mapColors.canopy:p.heightSource==='approximate'?mapColors.approximate:p.use==='civic'?mapColors.civic:p.use==='commercial'?mapColors.commercial:p.use==='residential'?mapColors.residential:mapColors.building;
        default:return mapColors.ground;
    }
}
export const roadWidths:Record<string,number>={arterial:18,primary:15,secondary:12,collector:10,local:7.5,service:4.5};
export function roadWidth(p:MapProperties,zoom:number){
    const width=roadWidths[p.roadClass??(p.road==='major'?'collector':'local')]??6;
    // Cartographic widths, not measured pavement widths.
    return Math.max(zoom<14?0.7:1, width*2**((zoom-18)*.61));
}
export function roadColour(p:MapProperties){return p.roadClass==='arterial'?mapColors.arterial:['primary','secondary'].includes(p.roadClass??'')?mapColors.primary:mapColors.road;}
export function pathColour(p:MapProperties){return p.structure==='tunnel'||p.restricted?mapColors.underground:p.pathType==='steps'?mapColors.stairs:p.pathType==='crossing'?mapColors.crossing:p.covered?mapColors.covered:mapColors.path;}
export function labelColour(p:MapProperties){
    if(p.labelKind==='station'||p.labelKind==='stop')return mapColors.station;
    if(p.labelKind==='green'||p.labelKind==='pitch')return '#416447';
    if(p.labelKind==='water')return '#38687e';
    if(p.labelKind==='health')return mapColors.health;
    if(p.labelKind==='food')return mapColors.food;
    if(p.labelKind==='shop')return mapColors.shop;
    return mapColors.place;
}
export function featureDescription(p:MapProperties,language:ResidentLanguage):{title:string;lines:string[]}{
    const t=(label:Parameters<typeof residentText>[1])=>residentText(language,label);
    const title=p.name||t(p.kind==='building'?(p.use==='canopy'?'Mapped roof or canopy':p.part?'Mapped building section':'Mapped building'):p.kind==='path'?(p.pathType==='steps'?'Mapped steps':p.pathType==='crossing'?'Mapped crossing':p.covered?'Mapped covered path':'Mapped footpath'):p.kind==='street'?'Mapped street':p.kind==='contour'?'Estimated elevation':p.kind==='rail'?'Mapped railway':'Mapped place');
    const lines:string[]=[];
    if(p.kind==='building'){
        if(p.heightSource==='height')lines.push(`${t('Recorded height')} ${p.height} m`);
        else if(p.heightSource==='levels')lines.push(`${t('Estimated height')} ${p.height} m${p.levels?` · ${p.levels} ${t('mapped floors')}`:''}`);
        else lines.push(t('Height unknown; simplified 3D shape.'));
        if(p.roofShape)lines.push(`${t('Mapped roof shape')}: ${p.roofShape}`);
        if(p.volume===false)lines.push(t('Building outline; mapped sections shown separately.'));
    }
    if(p.kind==='path'){
        if(p.pathType==='steps')lines.push(t('Mapped steps'));
        if(p.pathType==='crossing')lines.push(t('Mapped crossing'));
        if(p.covered)lines.push(t('Mapped roof cover'));
        if(p.restricted)lines.push(t('Restricted access; map context only.'));
        if(p.surface)lines.push(`${t('Surface')}: ${p.surface.replaceAll('_',' ')}`);
        if(p.level)lines.push(`${t('Mapped level')}: ${p.level}`);
    }
    if(p.structure==='bridge')lines.push(t('Bridge or elevated connection'));
    if(p.structure==='tunnel')lines.push(t('Underground connection'));
    if(p.kind==='contour')lines.push(`${p.elevation} m · ${t('Approximate terrain, not a footpath slope measurement.')}`);
    else lines.push(t('OpenStreetMap · access needs field checking.'));
    return {title,lines};
}
