import type { ExpressionSpecification, LayerSpecification, LineLayerSpecification, SymbolLayerSpecification } from 'maplibre-gl';
import { mapColors as C, roadWidths } from '@/lib/map-detail';

const kind=(value:string):ExpressionSpecification=>['==',['get','kind'],value];
const all=(...filters:ExpressionSpecification[]):ExpressionSpecification=>['all',...filters];
const named:ExpressionSpecification=['!=',['coalesce',['get','mapName'],''],''];
const get=(property:string):ExpressionSpecification=>['get',property];
const equals=(property:string,value:string):ExpressionSpecification=>['==',get(property),value];
const rounded={ 'line-cap':'round','line-join':'round' } as const;
const textLayout = {'text-font':['Noto Sans Regular'],'text-field':get('mapName'),'text-padding':5} satisfies NonNullable<SymbolLayerSpecification['layout']>;
const labelHalo={'text-halo-color':'#fffefa','text-halo-width':1.5} as const;
const labels=(kinds:string[]):ExpressionSpecification=>all(kind('label'),named,['in',get('labelKind'),['literal',kinds]]);
const visibleRoad:ExpressionSpecification=['!=',get('structure'),'tunnel'];
const heightColor:ExpressionSpecification=['case',equals('heightSource','approximate'),C.approximate,
    ['match',get('use'),'civic',C.civic,'commercial',C.commercial,'residential',C.residential,C.building]];
const pathColor:ExpressionSpecification=['case',['any',equals('structure','tunnel'),['get','restricted']],C.underground,
    equals('pathType','steps'),C.stairs,equals('pathType','crossing'),C.crossing,['get','covered'],C.covered,C.path];
const roadFill:ExpressionSpecification=['match',get('roadClass'),'arterial',C.arterial,['primary','secondary'],C.primary,C.road];
function scaledRoad(factor:number,casing=0):ExpressionSpecification{
    const stop=(scale:number):ExpressionSpecification=>['match',get('roadClass'),...Object.entries(roadWidths).flatMap(([id,value])=>[id,Math.max(.7,value*scale*factor)+casing]),6*scale*factor+casing] as ExpressionSpecification;
    return ['interpolate',['exponential',1.48],['zoom'],12,stop(.09),15,stop(.28),18,stop(1),21,stop(3.4)];
}
function roads(structure:'surface'|'bridge',id:string,service:boolean):LayerSpecification[]{
    const filter=all(kind('street'),equals('structure',structure),service?equals('roadClass','service'):['!=',get('roadClass'),'service']);
    return [
        {id:`${id}-casing`,type:'line',source:'area',minzoom:service?15:11.5,filter,layout:rounded,paint:{'line-color':['case',equals('road','major'),C.majorEdge,C.roadEdge],'line-width':scaledRoad(1,structure==='bridge'?2.4:1.5)}},
        {id,type:'line',source:'area',minzoom:service?15:11.5,filter,layout:rounded,paint:{'line-color':roadFill,'line-width':scaledRoad(1)}},
    ];
}
function rail(structure:'surface'|'bridge',id:string):LineLayerSpecification[]{
    const filter=all(kind('rail'),equals('structure',structure));
    return [
        {id,type:'line',source:'area',filter,paint:{'line-color':C.rail,'line-width':['interpolate',['linear'],['zoom'],12,1,18,3,21,6]}},
        {id:`${id}-sleepers`,type:'line',source:'area',minzoom:15.5,filter,paint:{'line-color':C.railInner,'line-width':['interpolate',['linear'],['zoom'],15,1,20,2.5],'line-dasharray':[2,2.5]}},
    ];
}

export const INSPECT_BASE_LAYERS=['district-labels','place-labels','local-landmark-labels','building-labels','business-labels','path-labels','street-labels','minor-street-labels','contour-labels','building-volumes','canopy-volumes','building-footprints','covered-paths','crossings','steps-paths','reference-paths','restricted-paths','streets','minor-streets','bridges','bridge-service','underground-streets','railways','bridge-railways','underground-railways'];
export const DETAIL_LABEL_LAYERS=['district-labels','place-labels','local-landmark-labels','building-labels','business-labels','path-labels','street-labels','minor-street-labels','contour-labels'] as const;
export function labelSize(layer:typeof DETAIL_LABEL_LAYERS[number],scale:number):ExpressionSpecification|number{
    if(layer==='district-labels')return 14*scale;
    if(layer==='place-labels'||layer==='local-landmark-labels')return ['interpolate',['linear'],['zoom'],14,11.5*scale,18,13.5*scale];
    if(layer==='street-labels')return ['interpolate',['linear'],['zoom'],14,10.5*scale,19,12.5*scale];
    if(layer==='business-labels'||layer==='path-labels'||layer==='contour-labels')return 10.5*scale;
    return 11.5*scale;
}
function pointLabel(id:typeof DETAIL_LABEL_LAYERS[number],kinds:string[],zoom:number,colour:string|ExpressionSpecification,dot=false):SymbolLayerSpecification{
    return {id,type:'symbol',source:'area',minzoom:zoom,filter:labels(kinds),layout:{...textLayout,
        ...(dot?{'text-field':['concat','• ',get('mapName')]} as const:{}),'text-size':labelSize(id,1),'text-max-width':12,
        'text-pitch-alignment':'viewport','text-rotation-alignment':'viewport','text-variable-anchor':['center','bottom','top','left','right'],'text-radial-offset':.35,
        'symbol-sort-key':['get','priority']},paint:{...labelHalo,'text-color':colour}};
}
export function detailLabelLayers():LayerSpecification[]{
    const lineLabel=(id:typeof DETAIL_LABEL_LAYERS[number],filter:ExpressionSpecification,minzoom:number,colour:string):SymbolLayerSpecification=>({
        id,type:'symbol',source:'area',minzoom,filter:all(filter,named),layout:{...textLayout,'symbol-placement':'line','symbol-spacing':230,'text-max-angle':35,
            'text-size':labelSize(id,1),'text-pitch-alignment':'viewport'},paint:{...labelHalo,'text-color':colour}});
    return [
        pointLabel('district-labels',['district'],12.8,'#60554b'),
        pointLabel('place-labels',['station','green','water','pitch','landmark'],14.8,['match',get('labelKind'),'station',C.station,['green','pitch'],'#416447','water','#38687e',C.place]),
        pointLabel('local-landmark-labels',['health'],16.3,C.health,true),
        lineLabel('street-labels',all(kind('street'),equals('road','major'),visibleRoad),14.3,C.label),
        lineLabel('minor-street-labels',all(kind('street'),equals('road','local'),visibleRoad),16.4,C.label),
        pointLabel('building-labels',['building'],16.8,C.place),
        pointLabel('business-labels',['food','shop','facility','stop'],17.5,['match',get('labelKind'),'food',C.food,'shop',C.shop,'stop',C.station,C.place],true),
        lineLabel('path-labels',kind('path'),18.3,C.path),
        {...lineLabel('contour-labels',all(kind('contour'),['get','major']),14.7,'#887863'),layout:{...textLayout,'symbol-placement':'line','symbol-spacing':300,'text-size':10.5,'visibility':'none'}},
    ];
}

export function detailBaseLayers():LayerSpecification[]{
    const publicPath=all(kind('path'),['!',get('restricted')],['!=',get('structure'),'tunnel']);
    const pathWidth:ExpressionSpecification=['interpolate',['linear'],['zoom'],15,1.15,18,2.1,21,4.4];
    return [
        {id:'ground',type:'background',paint:{'background-color':C.ground}},
        {id:'land-use',type:'fill',source:'area',filter:kind('landuse'),paint:{'fill-color':['match',get('landcover'),'institutional',C.institutional,['commercial','retail'],C.commercialLand,'construction',C.construction,C.landuse]}},
        {id:'green-spaces',type:'fill',source:'area',filter:kind('green'),paint:{'fill-color':['match',get('landcover'),'wood',C.wood,'grass',C.grass,C.green]}},
        {id:'sports-pitches',type:'fill',source:'area',filter:kind('pitch'),paint:{'fill-color':C.pitch,'fill-outline-color':'#aac5a4'}},
        {id:'water-areas',type:'fill',source:'area',filter:kind('water'),paint:{'fill-color':C.water,'fill-outline-color':C.waterEdge}},
        {id:'public-spaces',type:'fill',source:'area',filter:['in',get('kind'),['literal',['plaza','parking','deck']]],paint:{'fill-color':['match',get('kind'),'plaza',C.plaza,'deck',C.deck,C.parking],'fill-outline-color':'#ccc5b7'}},
        {id:'terrain-contours',type:'line',source:'area',minzoom:13.5,filter:kind('contour'),layout:{visibility:'none'},paint:{'line-color':C.contour,'line-width':['case',get('major'),.85,.6],'line-opacity':.42}},
        {id:'watercourses',type:'line',source:'area',filter:kind('watercourse'),paint:{'line-color':C.waterEdge,'line-width':['interpolate',['linear'],['zoom'],13,1.1,18,['case',equals('waterway','river'),5,2.1],21,8]}},
        {id:'underground-streets',type:'line',source:'area',filter:all(kind('street'),equals('structure','tunnel')),paint:{'line-color':C.underground,'line-width':scaledRoad(.45),'line-opacity':.42,'line-dasharray':[2,2]}},
        {id:'underground-railways',type:'line',source:'area',filter:all(kind('rail'),equals('structure','tunnel')),paint:{'line-color':C.underground,'line-width':1.6,'line-opacity':.6,'line-dasharray':[2,2]}},
        ...roads('surface','minor-streets',true),...roads('surface','streets',false),...rail('surface','railways'),
        ...roads('bridge','bridge-service',true),...roads('bridge','bridges',false),...rail('bridge','bridge-railways'),
        {id:'boundary-lines',type:'line',source:'area',minzoom:17,filter:kind('boundary'),paint:{'line-color':C.boundary,'line-width':.8,'line-dasharray':[2,2]}},
        {id:'restricted-paths',type:'line',source:'area',minzoom:15.2,filter:all(kind('path'),['any',get('restricted'),equals('structure','tunnel')]),paint:{'line-color':C.underground,'line-width':pathWidth,'line-opacity':.55,'line-dasharray':[1,2.5]}},
        {id:'reference-paths',type:'line',source:'area',minzoom:14.8,filter:all(publicPath,['!',get('covered')],['!',['in',get('pathType'),['literal',['steps','crossing']]]]),paint:{'line-color':C.path,'line-width':pathWidth,'line-dasharray':[2,1.6],'line-opacity':.85}},
        {id:'crossings',type:'line',source:'area',minzoom:15.5,filter:all(publicPath,equals('pathType','crossing')),paint:{'line-color':C.crossing,'line-width':pathWidth,'line-dasharray':[1.3,1.4]}},
        {id:'steps-paths',type:'line',source:'area',minzoom:15.5,filter:all(publicPath,equals('pathType','steps')),paint:{'line-color':C.stairs,'line-width':pathWidth,'line-dasharray':[.8,1.3]}},
        {id:'cover-path-casing',type:'line',source:'area',minzoom:15.5,filter:all(publicPath,get('covered')),layout:rounded,paint:{'line-color':'#d9e8e0','line-width':['interpolate',['linear'],['zoom'],15,3.5,19,5.5]}},
        {id:'covered-paths',type:'line',source:'area',minzoom:15.5,filter:all(publicPath,get('covered')),layout:rounded,paint:{'line-color':pathColor,'line-width':pathWidth}},
        {id:'building-footprints',type:'fill',source:'area',minzoom:14.5,filter:kind('building'),paint:{'fill-color':['case',equals('use','canopy'),C.canopy,heightColor],'fill-outline-color':C.buildingOutline}},
    ];
}
export function detailBuildingLayers():LayerSpecification[]{
    return [
        {id:'building-volumes',type:'fill-extrusion',source:'area',minzoom:15,filter:all(kind('building'),['!=',get('volume'),false],['!=',get('use'),'canopy']),paint:{
            'fill-extrusion-color':heightColor,'fill-extrusion-height':get('height'),'fill-extrusion-base':get('base'),'fill-extrusion-opacity':.94,'fill-extrusion-vertical-gradient':true}},
        {id:'canopy-volumes',type:'fill-extrusion',source:'area',minzoom:16,filter:all(kind('building'),equals('use','canopy'),['!=',get('volume'),false]),paint:{
            'fill-extrusion-color':C.canopy,'fill-extrusion-height':get('height'),'fill-extrusion-base':get('base'),'fill-extrusion-opacity':.8,'fill-extrusion-vertical-gradient':true}},
        {id:'mapped-trees',type:'circle',source:'area',minzoom:17,filter:kind('tree'),paint:{'circle-radius':3,'circle-color':'#86a982','circle-stroke-color':'#769770','circle-stroke-width':1}},
    ];
}
