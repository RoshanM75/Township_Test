'use client';
import { useEffect, useMemo, useState } from 'react';
import { useMap } from 'react-leaflet';
import L from 'leaflet';
import type { DetailFeature, MapAppearance, MapProperties, TerrainDetail } from '@/lib/map-detail';
import { featureDescription, labelColour, mapColors as C, pathColour, polygonColour, roadColour, roadWidth } from '@/lib/map-detail';
import { PILOTS, isPilot, type PilotId } from '@/lib/pilots';
import { residentText, type ResidentLanguage } from '@/lib/resident-language';
import { sitePath } from '@/lib/site';
import type { SolarModel } from '@/lib/solar-shade';

type Point=[number,number];
type Rect=[number,number,number,number];
type Prepared={props:MapProperties;paths:Point[][];bounds:Rect;polygon:boolean;point:boolean};
type Options={appearance:MapAppearance;showTerrain:boolean;terrain:TerrainDetail|null;labelScale:number;language:ResidentLanguage;highContrast:boolean;inspect:boolean;solar?:SolarModel;shadeAt?:string};
const order=['landuse','green','pitch','water','plaza','parking','deck','contour','watercourse','street','rail','path','boundary','building','tree','label'];
const areaKinds=new Set(['landuse','green','pitch','water','plaza','parking','deck']);
const pointWorld=([lng,lat]:number[]):Point=>[(lng+180)/360*256,(1-Math.asinh(Math.tan(lat*Math.PI/180))/Math.PI)*128];
const intersects=(a:Rect,b:Rect)=>a[0]<=b[2]&&a[2]>=b[0]&&a[1]<=b[3]&&a[3]>=b[1];
const rect=(paths:Point[][]):Rect=>paths.flat().reduce<Rect>(([w,s,e,n],[x,y])=>[Math.min(w,x),Math.min(s,y),Math.max(e,x),Math.max(n,y)],[Infinity,Infinity,-Infinity,-Infinity]);
function prepare(features:DetailFeature[]):Prepared[]{
    return features.flatMap(feature=>{
        const g=feature.geometry,p=feature.properties;
        if(!g||!p)return [];
        const polygon=g.type==='Polygon'||g.type==='MultiPolygon';
        const paths=g.type==='Point'?[[pointWorld(g.coordinates)]]:g.type==='LineString'?[g.coordinates.map(pointWorld)]:g.type==='MultiLineString'||g.type==='Polygon'?g.coordinates.map(line=>line.map(pointWorld)):g.type==='MultiPolygon'?g.coordinates.flatMap(poly=>poly.map(line=>line.map(pointWorld))):[];
        if(!paths.length)return [];
        return [{props:p,paths,bounds:rect(paths),polygon,point:g.type==='Point'}];
    }).sort((a,b)=>order.indexOf(a.props.kind)-order.indexOf(b.props.kind));
}
function insidePolygon(point:Point,paths:Point[][]){
    let hit=false;
    for(const ring of paths)for(let i=0,j=ring.length-1;i<ring.length;j=i++){
        const [a,b]=ring[i],[c,d]=ring[j];
        if((b>point[1])!==(d>point[1])&&point[0]<(c-a)*(point[1]-b)/(d-b)+a)hit=!hit;
    }
    return hit;
}
function lineDistance(point:Point,line:Point[]){
    let result=Infinity;
    for(let i=1;i<line.length;i++){
        const a=line[i-1],b=line[i],dx=b[0]-a[0],dy=b[1]-a[1];
        const t=Math.max(0,Math.min(1,((point[0]-a[0])*dx+(point[1]-a[1])*dy)/(dx*dx+dy*dy||1)));
        result=Math.min(result,Math.hypot(point[0]-a[0]-t*dx,point[1]-a[1]-t*dy));
    }
    return result;
}

/** A single canvas for the local cartography. Only visible geometry and
 * non-colliding labels are drawn; routes/reports remain normal Leaflet layers
 * above it. This avoids thousands of DOM markers or per-feature canvases. */
class DetailCanvas extends L.Layer {
    private map:L.Map|null=null;
    private canvas:HTMLCanvasElement|null=null;
    private image:HTMLImageElement|null=null;
    private imageUrl='';
    private frame=0;
    private labels:{bounds:Rect;props:MapProperties}[]=[];
    private visible:Prepared[]=[];
    constructor(private features:Prepared[],private area:PilotId|undefined,private detailOptions:Options){super({pane:'pilot-basemap'});}

    onAdd(map:L.Map){
        this.map=map;this.canvas=L.DomUtil.create('canvas','tg-local-map-canvas',this.getPane()) as HTMLCanvasElement;
        this.canvas.setAttribute('aria-hidden','true');this.canvas.style.position='absolute';this.canvas.style.pointerEvents='none';
        map.on('move zoom resize viewreset',this.schedule,this);map.on('click',this.inspect,this);
        this.setOptions(this.detailOptions);this.schedule();return this;
    }
    onRemove(map:L.Map){
        map.off('move zoom resize viewreset',this.schedule,this);map.off('click',this.inspect,this);
        cancelAnimationFrame(this.frame);this.frame=0;this.image=null;this.imageUrl='';
        this.canvas?.remove();this.canvas=null;this.map=null;return this;
    }
    setOptions(options:Options){
        this.detailOptions=options;
        const url=options.terrain&&this.area?sitePath(`/map-area/${this.area}-terrain/relief.png`):'';
        if(url!==this.imageUrl){
            this.image=null;this.imageUrl=url;
            if(url){const image=new Image();image.onload=()=>{if(this.imageUrl===url){this.image=image;this.schedule();}};image.src=url;}
        }
        this.schedule();
    }
    private schedule=()=>{
        if(!this.canvas||this.frame)return;
        this.frame=requestAnimationFrame(()=>{this.frame=0;this.draw();});
    };
    private draw(){
        const map=this.map,canvas=this.canvas;if(!map||!canvas||!map.getContainer().isConnected)return;
        const size=map.getSize();if(!size.x||!size.y)return;
        const ctx=canvas.getContext('2d');if(!ctx)return;
        const ratio=Math.min(2,window.devicePixelRatio||1);
        if(canvas.width!==Math.round(size.x*ratio)||canvas.height!==Math.round(size.y*ratio)){
            canvas.width=Math.round(size.x*ratio);canvas.height=Math.round(size.y*ratio);canvas.style.width=`${size.x}px`;canvas.style.height=`${size.y}px`;
        }
        const zoom=map.getZoom(),scale=2**zoom,offset=map.containerPointToLayerPoint([0,0]),origin=map.getPixelOrigin().add(offset);
        const screen=([x,y]:Point):Point=>[x*scale-origin.x,y*scale-origin.y];
        const world:Rect=[(origin.x-70)/scale,(origin.y-70)/scale,(origin.x+size.x+70)/scale,(origin.y+size.y+70)/scale];
        this.visible=this.features.filter(f=>intersects(f.bounds,world));
        this.labels=[];L.DomUtil.setPosition(canvas,offset);ctx.setTransform(ratio,0,0,ratio,0,0);ctx.clearRect(0,0,size.x,size.y);
        ctx.save();
        if(this.area){
            const [s,w,n,e]=PILOTS[this.area].bounds;const a=screen(pointWorld([w,n])),b=screen(pointWorld([e,s]));
            ctx.beginPath();ctx.rect(a[0],a[1],b[0]-a[0],b[1]-a[1]);ctx.clip();
        }
        const high=this.detailOptions.highContrast;
        ctx.fillStyle=high?'#f9f8f3':C.ground;ctx.fillRect(0,0,size.x,size.y);
        const trace=(f:Prepared)=>{
            ctx.beginPath();for(const path of f.paths){for(const [i,p] of path.entries()){const [x,y]=screen(p);if(i)ctx.lineTo(x,y);else ctx.moveTo(x,y);}if(f.polygon)ctx.closePath();}
        };
        const stroke=(f:Prepared,colour:string,width:number,dash:number[]=[],opacity=1)=>{
            trace(f);ctx.strokeStyle=colour;ctx.lineWidth=width;ctx.lineCap='round';ctx.lineJoin='round';ctx.setLineDash(dash);ctx.globalAlpha=opacity;ctx.stroke();ctx.globalAlpha=1;ctx.setLineDash([]);
        };
        const fill=(f:Prepared)=>{trace(f);ctx.fillStyle=polygonColour(f.props);ctx.fill('evenodd');};
        // Draw the large land-use fills first, then smaller green spaces and
        // water, so broad district polygons cannot cover a garden or lake.
        const base=this.visible.filter(f=>f.polygon&&areaKinds.has(f.props.kind));
        for(const f of base){fill(f);if(['water','pitch','plaza'].includes(f.props.kind))stroke(f,f.props.kind==='water'?C.waterEdge:'#bac1b1',.75);}
        const terrain=this.detailOptions.terrain;
        if(this.detailOptions.showTerrain&&terrain&&this.image&&zoom>=12){
            const [w,s,e,n]=terrain.bounds,a=screen(pointWorld([w,n])),b=screen(pointWorld([e,s]));
            ctx.globalAlpha=.95;ctx.drawImage(this.image,a[0],a[1],b[0]-a[0],b[1]-a[1]);ctx.globalAlpha=1;
        }
        const lineFeatures=this.visible.filter(f=>!f.polygon&&!f.point);
        if(this.detailOptions.showTerrain&&zoom>=13.5)for(const f of lineFeatures.filter(f=>f.props.kind==='contour'))stroke(f,C.contour,f.props.major?.85:.6,[],high?.6:.42);
        for(const f of lineFeatures.filter(f=>f.props.kind==='watercourse'))stroke(f,C.waterEdge,f.props.waterway==='river'?Math.max(2,roadWidth({kind:'street',roadClass:'local'},zoom)*.75):Math.max(1,roadWidth({kind:'street',roadClass:'service'},zoom)*.4));
        const streets=lineFeatures.filter(f=>f.props.kind==='street'&&(zoom>=15||f.props.roadClass!=='service')&&(zoom>=12.5||f.props.road==='major'));
        const rails=lineFeatures.filter(f=>f.props.kind==='rail');
        // Separate bridge decks from surface roads, and never turn an
        // underground alignment into a visible surface carriageway.
        for(const structure of ['tunnel','surface','bridge']){
            const ways=streets.filter(f=>(f.props.structure??'surface')===structure);
            if(structure==='tunnel')for(const f of ways)stroke(f,C.underground,Math.max(1,roadWidth(f.props,zoom)*.45),[4,4],.45);
            else{
                for(const f of ways)stroke(f,f.props.road==='major'?C.majorEdge:C.roadEdge,roadWidth(f.props,zoom)+(structure==='bridge'?2.4:1.5));
                for(const f of ways)stroke(f,roadColour(f.props),roadWidth(f.props,zoom));
            }
            for(const f of rails.filter(f=>(f.props.structure??'surface')===structure)){
                const width=Math.max(1.1,roadWidth({kind:'street',roadClass:'service'},zoom)*.58);
                stroke(f,structure==='tunnel'?C.underground:C.rail,width,structure==='tunnel'?[4,4]:[],structure==='tunnel'?.55:.9);
                if(structure!=='tunnel'&&zoom>=15)stroke(f,C.railInner,width*.6,[3,5]);
            }
        }
        if(zoom>=14.8)for(const f of lineFeatures.filter(f=>f.props.kind==='path')){
            const width=zoom>=18?Math.min(3.3,1.7+(.65*(zoom-17))):1.35;
            if(f.props.covered&&f.props.structure!=='tunnel'&&!f.props.restricted)stroke(f,'#d9e8e0',width+2.5);
            const dash=f.props.structure==='tunnel'||f.props.restricted?[1.5,3.5]:f.props.pathType==='steps'?[1.5,2.3]:f.props.pathType==='crossing'?[3,2]:f.props.covered?[]:[3.5,2.8];
            stroke(f,pathColour(f.props),width,dash,f.props.restricted?.5:.9);
        }
        if(zoom>=17)for(const f of lineFeatures.filter(f=>f.props.kind==='boundary'))stroke(f,C.boundary,.8,[2,2],.8);
        const {solar,shadeAt}=this.detailOptions;
        if(solar&&shadeAt&&zoom>=15.5){
            const bounds=map.getBounds();
            const rings=solar.shadowRings(Date.parse(shadeAt),[bounds.getWest(),bounds.getSouth(),bounds.getEast(),bounds.getNorth()]);
            ctx.save();ctx.fillStyle='#3f4a64';ctx.globalAlpha=.22;ctx.beginPath();
            for(const ring of rings){for(const [i,p] of ring.entries()){const [x,y]=screen(pointWorld(p));if(i)ctx.lineTo(x,y);else ctx.moveTo(x,y);}ctx.closePath();}
            ctx.fill();ctx.restore();
        }
        if(zoom>=14.7){
            const buildings=this.visible.filter(f=>f.props.kind==='building').sort((a,b)=>Number(Boolean(a.props.part))-Number(Boolean(b.props.part)));
            if(zoom>=16.6){
                // Architectural relief is a subtle cartographic offset, not
                // the dynamic sun-shadow calculation used for route planning.
                ctx.save();ctx.translate(1.35,2);ctx.fillStyle='#61544822';
                for(const f of buildings){if(f.props.use!=='canopy'){trace(f);ctx.fill('evenodd');}}
                ctx.restore();
            }
            for(const f of buildings){
                trace(f);ctx.fillStyle=polygonColour(f.props);ctx.fill('evenodd');
                if(zoom>=16){ctx.strokeStyle=f.props.use==='canopy'?'#819f93':C.buildingOutline;ctx.lineWidth=f.props.part?.65:.9;ctx.stroke();}
            }
        }
        // Outline mapped roofs/bridged pedestrian connections over building
        // footprints so a covered corridor is still visible on the flat map.
        if(zoom>=16.5)for(const f of lineFeatures.filter(f=>f.props.kind==='path'&&(f.props.covered||f.props.structure==='bridge'))){
            stroke(f,'#fffefa',3.35,[],.75);stroke(f,pathColour(f.props),1.6,f.props.restricted?[2,3]:[5,2],.9);
        }
        if(zoom>=17)for(const f of this.visible.filter(f=>f.props.kind==='tree')){const [x,y]=screen(f.paths[0][0]);ctx.beginPath();ctx.arc(x,y,3,0,2*Math.PI);ctx.fillStyle='#86a982';ctx.fill();}

        const labelScale=Math.min(1.75,this.detailOptions.labelScale);
        const collisions:Rect[]=[];
        const reserve=(bounds:Rect)=>{
            if(bounds[0]<5||bounds[1]<5||bounds[2]>size.x-5||bounds[3]>size.y-5||collisions.some(b=>intersects(b,bounds)))return false;
            collisions.push(bounds);return true;
        };
        const drawText=(p:MapProperties,x:number,y:number,fontSize:number,angle=0,colour:string=C.label,strong=false,dot=false)=>{
            const name=p.name;if(!name)return;
            ctx.font=`${strong?'650':'520'} ${fontSize}px system-ui,sans-serif`;
            const maxWidth=(strong?145:118)*labelScale;
            const words=name.split(' '),lines:string[]=[];let line='';
            for(const word of words){if(line&&ctx.measureText(`${line} ${word}`).width>maxWidth){lines.push(line);line=word;}else line=line?`${line} ${word}`:word;}
            if(line)lines.push(line);if(lines.length>2)return;
            const width=Math.max(...lines.map(l=>ctx.measureText(l).width),8),height=fontSize*1.18*lines.length;
            if(width>maxWidth*1.6)return;
            const hw=(Math.abs(Math.cos(angle))*width+Math.abs(Math.sin(angle))*height)/2+5+(dot?5:0);
            const hh=(Math.abs(Math.sin(angle))*width+Math.abs(Math.cos(angle))*height)/2+4;
            const bounds:Rect=[x-hw,y-hh,x+hw,y+hh];if(!reserve(bounds))return;
            ctx.save();ctx.translate(x,y);ctx.rotate(angle);ctx.textAlign='center';ctx.textBaseline='middle';ctx.strokeStyle='#fffefa';ctx.lineJoin='round';ctx.lineWidth=3.1;ctx.fillStyle=high?'#232222':colour;
            if(dot){ctx.beginPath();ctx.arc(-width/2-5,0,2.4,0,Math.PI*2);ctx.stroke();ctx.fill();}
            for(const [i,l] of lines.entries()){const dy=(i-(lines.length-1)/2)*fontSize*1.18;ctx.strokeText(l,0,dy);ctx.fillText(l,0,dy);}
            ctx.restore();this.labels.push({bounds,props:p});
        };
        const places=this.visible.filter(f=>f.props.kind==='label'&&zoom>=(f.props.minZoom??17)).sort((a,b)=>(a.props.priority??9)-(b.props.priority??9));
        const place=(f:Prepared)=>{const p=f.props,[x,y]=screen(f.paths[0][0]);const strong=(p.priority??9)<4;
            drawText(p,x,y,(p.labelKind==='district'?14:strong?12.1:10.7)*labelScale,0,labelColour(p),strong,['health','food','shop','station','stop','facility'].includes(p.labelKind??''));};
        // Major destinations and transit labels, then street names, then the
        // progressively detailed small shops/building names at close zoom.
        places.filter(f=>(f.props.priority??9)<4).forEach(place);
        const names=new Set<string>();
        for(const f of lineFeatures.filter(f=>f.props.name&&((f.props.kind==='street'&&zoom>=14.2&&(f.props.road==='major'||zoom>=16.2))||(f.props.kind==='path'&&zoom>=18.5)||(f.props.kind==='contour'&&f.props.major&&zoom>=14.5&&this.detailOptions.showTerrain))).sort((a,b)=>roadWidth(b.props,18)-roadWidth(a.props,18))){
            const name=f.props.name!;if(names.has(name))continue;
            let best:{x:number;y:number;angle:number;length:number}|null=null;
            for(const path of f.paths)for(let i=1;i<path.length;i++){
                const a=screen(path[i-1]),b=screen(path[i]),dx=b[0]-a[0],dy=b[1]-a[1],length=Math.hypot(dx,dy),x=(a[0]+b[0])/2,y=(a[1]+b[1])/2;
                let angle=Math.atan2(dy,dx);if(angle>Math.PI/2)angle-=Math.PI;if(angle<-Math.PI/2)angle+=Math.PI;
                if(length<(name.length*5+10)*labelScale||x<30||x>size.x-30||y<20||y>size.y-20||Math.abs(angle)>1.3)continue;
                if(!best||length>best.length)best={x,y,angle,length};
            }
            if(best){drawText(f.props,best.x,best.y,(f.props.kind==='contour'?10:11)*labelScale,best.angle,f.props.kind==='contour'?'#766b5c':C.label);names.add(name);}
        }
        places.filter(f=>(f.props.priority??9)>=4).forEach(place);
        ctx.restore();
    }
    private inspect(event:L.LeafletMouseEvent){
        const map=this.map;
        if(!map||!this.detailOptions.inspect||this.detailOptions.appearance==='street'||event.sourceTarget!==map)return;
        const screen:Point=[event.containerPoint.x,event.containerPoint.y];
        const hit=this.labels.find(({bounds})=>screen[0]>=bounds[0]&&screen[0]<=bounds[2]&&screen[1]>=bounds[1]&&screen[1]<=bounds[3]);
        const point=pointWorld([event.latlng.lng,event.latlng.lat]),tolerance=5/2**map.getZoom();
        let props=hit?.props;
        if(!props&&map.getZoom()>=16.5){
            const candidates=this.visible.filter(f=>intersects(f.bounds,[point[0]-tolerance,point[1]-tolerance,point[0]+tolerance,point[1]+tolerance]));
            const line=candidates.find(f=>f.props.kind==='path'&&f.paths.some(path=>lineDistance(point,path)<=tolerance));
            props=line?.props??[...candidates].reverse().find(f=>f.polygon&&f.props.kind==='building'&&insidePolygon(point,f.paths))?.props;
        }
        if(!props)return;
        const {title,lines}=featureDescription(props,this.detailOptions.language),panel=document.createElement('div'),heading=document.createElement('strong');
        heading.textContent=title;panel.append(heading);
        for(const line of lines){const p=document.createElement('p');p.textContent=line;panel.append(p);}
        // Reserve space for Layers, the zoom buttons and the bottom controls.
        // Otherwise the detail card's close button can land underneath them.
        const size=map.getSize();
        L.popup({className:'tg-detail-popup',maxWidth:Math.max(130,Math.min(240,size.x-145)),
            maxHeight:Math.max(72,size.y-170),autoPanPaddingTopLeft:[12,72],autoPanPaddingBottomRight:[66,80]})
            .setLatLng(event.latlng).setContent(panel).openOn(map);
    }
}

const mapCache=new Map<string,DetailFeature[]>();
export default function LocalBasemap({url,appearance,showTerrain,terrain,labelScale,language,highContrast,inspect,solar,shadeAt}:Options&{url:string}){
    const map=useMap();
    const [source,setSource]=useState<{url:string;features:DetailFeature[];failed:boolean}|null>(null);
    const options=useMemo(()=>({appearance,showTerrain,terrain,labelScale,language,highContrast,inspect,solar,shadeAt}),[appearance,showTerrain,terrain,labelScale,language,highContrast,inspect,solar,shadeAt]);
    const area=useMemo(()=>{const id=url.match(/\/map-area\/([^/]+)\.geojson$/)?.[1];return isPilot(id)?id:undefined;},[url]);
    useEffect(()=>{
        if(mapCache.has(url))return;
        const controller=new AbortController();let active=true;
        fetch(url,{signal:controller.signal}).then(response=>{if(!response.ok)throw Error('Map source unavailable');return response.json();}).then(data=>{
            if(!Array.isArray(data.features))throw Error('Invalid map data');mapCache.set(url,data.features);if(active)setSource({url,features:data.features,failed:false});
        }).catch(()=>{if(active)setSource({url,features:[],failed:true});});
        return()=>{active=false;controller.abort();};
    },[url]);
    const loadedFeatures=mapCache.get(url)??(source?.url===url&&!source.failed?source.features:null);
    const prepared=useMemo(()=>loadedFeatures?prepare(loadedFeatures):null,[loadedFeatures]);
    // Keep the prepared geometry when only display options change.
    const layer=useMemo(()=>prepared?new DetailCanvas(prepared,area,options):null,[prepared,area]); // eslint-disable-line react-hooks/exhaustive-deps
    useEffect(()=>{if(!layer)return;map.addLayer(layer);return()=>{map.removeLayer(layer);};},[layer,map]);
    useEffect(()=>{layer?.setOptions(options);const pane=map.getPane('pilot-basemap');if(pane)pane.style.zIndex=appearance==='street'?'190':'240';},[layer,options,map,appearance]);
    useEffect(()=>{map.attributionControl?.setPrefix(false);},[map]);
    useEffect(()=>{
        if(!terrain||!showTerrain||appearance!=='detailed')return;
        const control=map.attributionControl;
        const attribution='<a href="https://open-meteo.com/en/docs/elevation-api" title="Copernicus DEM / Open-Meteo — CC BY 4.0">Copernicus DEM / Open-Meteo</a>';
        control?.addAttribution(attribution);return()=>{control?.removeAttribution(attribution);};
    },[map,terrain,showTerrain,appearance]);
    return source?.url===url&&source.failed?<div className="tg-map-loading" role="status">{residentText(language,'Detailed map unavailable; street map shown.')}</div>:null;
}
