import type { Map as LibreMap } from 'maplibre-gl';
import { labelColour, mapColors, type MapProperties } from '@/lib/map-detail';

type Candidate={props:MapProperties;x:number;y:number;angle:number;priority:number;size:number};
type Box=[number,number,number,number];
const overlaps=(a:Box,b:Box)=>a[0]<=b[2]&&a[2]>=b[0]&&a[1]<=b[3]&&a[3]>=b[1];

/** A screen-space label layer for the optional real terrain mesh. This keeps
 * labels readable at large zooms without changing or duplicating map geometry.
 * Native MapLibre labels are used in the normal building/relief view. */
export function attachTerrainLabels(map:LibreMap,labelScale:number,highContrast?:boolean){
    const canvas=document.createElement('canvas');canvas.className='tg-terrain-label-canvas';canvas.setAttribute('aria-hidden','true');
    map.getCanvasContainer().append(canvas);
    let frame=0,features:ReturnType<LibreMap['querySourceFeatures']>=[],active=true;
    const project=(point:number[])=>map.project([point[0],point[1]]);
    const draw=()=>{
        frame=0;if(!active)return;
        const size=map.getCanvas(),width=size.clientWidth,height=size.clientHeight;if(width===0||height===0)return;
        const ctx=canvas.getContext('2d');if(!ctx)return;
        const ratio=Math.min(2,window.devicePixelRatio||1);
        if(canvas.width!==Math.round(width*ratio)||canvas.height!==Math.round(height*ratio)){
            canvas.width=Math.round(width*ratio);canvas.height=Math.round(height*ratio);canvas.style.width=`${width}px`;canvas.style.height=`${height}px`;
        }
        ctx.setTransform(ratio,0,0,ratio,0,0);ctx.clearRect(0,0,width,height);
        const zoom=map.getZoom()+1,candidates:Candidate[]=[],seen=new Set<string>();
        const onscreen=(p:{x:number;y:number})=>p.x>6&&p.x<width-6&&p.y>8&&p.y<height-8;
        for(const feature of features){
            const p=feature.properties as MapProperties,g=feature.geometry;if(!p.name)continue;
            if(p.kind==='label'&&g.type==='Point'&&zoom>=(p.minZoom??17)){
                const key=p.osmRef??`${p.name}:${g.coordinates.join(',')}`;if(seen.has(key))continue;seen.add(key);
                const point=project(g.coordinates);if(!onscreen(point))continue;
                candidates.push({props:p,x:point.x,y:point.y,angle:0,priority:p.priority??9,size:(p.priority??9)<4?12:10.8});
                continue;
            }
            if(g.type!=='LineString'&&g.type!=='MultiLineString')continue;
            if(!((p.kind==='street'&&p.structure!=='tunnel'&&zoom>=(p.road==='major'?14.3:16.5))||(p.kind==='path'&&zoom>=18.5)||(p.kind==='contour'&&p.major&&zoom>=14.8)))continue;
            let best:Candidate|null=null,length=0;
            for(const line of g.type==='LineString'?[g.coordinates]:g.coordinates){
                let prev=project(line[0]);for(const coord of line.slice(1)){
                    const next=project(coord),dx=next.x-prev.x,dy=next.y-prev.y,dist=Math.hypot(dx,dy),at={x:(next.x+prev.x)/2,y:(next.y+prev.y)/2};prev=next;
                    let angle=Math.atan2(dy,dx);if(angle>Math.PI/2)angle-=Math.PI;if(angle<-Math.PI/2)angle+=Math.PI;
                    if(dist<Math.max(length,p.name.length*5*labelScale)||Math.abs(angle)>1.2||!onscreen(at))continue;
                    best={props:p,...at,angle,priority:p.kind==='street'?3.5:p.kind==='path'?8:9,size:p.kind==='contour'?10:11};length=dist;
                }
            }
            if(best)candidates.push(best);
        }
        const boxes:Box[]=[],named=new Set<string>();
        for(const item of candidates.sort((a,b)=>a.priority-b.priority)){
            const name=item.props.name!,key=item.props.kind==='label'?`${name}:${Math.round(item.x/90)}:${Math.round(item.y/90)}`:name;
            if(named.has(key))continue;
            const size=item.size*labelScale,strong=item.priority<3.5;ctx.font=`${strong?650:520} ${size}px system-ui,sans-serif`;
            const words=name.split(' '),lines:string[]=[];let line='';for(const word of words){if(line&&ctx.measureText(`${line} ${word}`).width>136*labelScale){lines.push(line);line=word;}else line=line?`${line} ${word}`:word;}if(line)lines.push(line);
            if(lines.length>2)continue;
            const w=Math.max(...lines.map(l=>ctx.measureText(l).width)),h=size*1.16*lines.length;
            const hw=(Math.abs(Math.cos(item.angle))*w+Math.abs(Math.sin(item.angle))*h)/2+5,hh=(Math.abs(Math.sin(item.angle))*w+Math.abs(Math.cos(item.angle))*h)/2+4;
            const box:Box=[item.x-hw,item.y-hh,item.x+hw,item.y+hh];
            if(box[0]<5||box[1]<5||box[2]>width-5||box[3]>height-5||boxes.some(existing=>overlaps(existing,box)))continue;
            boxes.push(box);named.add(key);ctx.save();ctx.translate(item.x,item.y);ctx.rotate(item.angle);ctx.textAlign='center';ctx.textBaseline='middle';ctx.lineJoin='round';ctx.lineWidth=3.2;ctx.strokeStyle='#fffefa';ctx.fillStyle=highContrast?'#171717':item.props.kind==='label'?labelColour(item.props):mapColors.label;
            lines.forEach((l,i)=>{const y=(i-(lines.length-1)/2)*size*1.16;ctx.strokeText(l,0,y);ctx.fillText(l,0,y);});ctx.restore();
        }
        canvas.dataset.labelCount=String(boxes.length);
    };
    const schedule=()=>{if(active&&!frame)frame=requestAnimationFrame(draw);};
    const refresh=()=>{if(!active||!map.getSource('area'))return;features=map.querySourceFeatures('area',{filter:['in',['get','kind'],['literal',['label','street','path','contour']]]});schedule();};
    map.on('idle',refresh);map.on('moveend',refresh);map.on('move',schedule);map.on('resize',schedule);refresh();
    return()=>{active=false;cancelAnimationFrame(frame);map.off('idle',refresh);map.off('moveend',refresh);map.off('move',schedule);map.off('resize',schedule);canvas.remove();};
}
