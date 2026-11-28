import { readFile,writeFile,mkdir,rm } from 'node:fs/promises';
import { deflateSync,crc32 } from 'node:zlib';

export const TERRAIN_ATTRIBUTION='Copernicus DEM / Open-Meteo (CC BY 4.0)';
const minzoom=11,maxzoom=13,tileSize=256,contourInterval=20;
const clamp=(n,min,max)=>Math.max(min,Math.min(max,n));
const rad=Math.PI/180;
function mercY(lat){return (1-Math.asinh(Math.tan(lat*rad))/Math.PI)/2;}
function latitude(y){return Math.atan(Math.sinh(Math.PI*(1-2*y)))/rad;}
function longitude(x){return x*360-180;}
function mercX(lng){return (lng+180)/360;}

export function validateElevationGrid(grid){
    const {bounds,width,height,step_degrees:step,elevations_m:values}=grid;
    if(!Array.isArray(bounds)||bounds.length!==4||!bounds.every(Number.isFinite)||!Number.isInteger(width)||!Number.isInteger(height)||width<2||height<2||width*height>25000||!Number.isFinite(step)||step<=0||
        Math.abs(bounds[2]-bounds[0]-step*(width-1))>1e-6||Math.abs(bounds[3]-bounds[1]-step*(height-1))>1e-6||!Array.isArray(values)||values.length!==width*height||!values.every(v=>Number.isFinite(v)&&v>=-100&&v<1000))throw Error('Invalid pilot elevation grid');
    return grid;
}
export function sampleElevation(grid,lng,lat){
    const {bounds,width,height,step_degrees:step,elevations_m:values}=grid;
    // Padding within the outer DEM tiles repeats the nearest sampled edge.
    // The public manifest restricts the source to its actual sampled bounds.
    const x=clamp((lng-bounds[0])/step,0,width-1),y=clamp((bounds[3]-lat)/step,0,height-1);
    const i=Math.min(width-2,Math.floor(x)),j=Math.min(height-2,Math.floor(y));
    const fx=x-i,fy=y-j;
    return (values[j*width+i]*(1-fx)+values[j*width+i+1]*fx)*(1-fy)+
        (values[(j+1)*width+i]*(1-fx)+values[(j+1)*width+i+1]*fx)*fy;
}
function pngChunk(tag,data){
    const type=Buffer.from(tag),length=Buffer.alloc(4),checksum=Buffer.alloc(4);
    length.writeUInt32BE(data.length);checksum.writeUInt32BE(crc32(Buffer.concat([type,data]))>>>0);
    return Buffer.concat([length,type,data,checksum]);
}
export function encodePng(width,height,channels,pixel){
    const header=Buffer.alloc(13);header.writeUInt32BE(width);header.writeUInt32BE(height,4);header[8]=8;header[9]=channels===4?6:2;
    const pixels=Buffer.alloc(height*(width*channels+1));
    for(let y=0;y<height;y++)for(let x=0;x<width;x++){
        const offset=y*(width*channels+1)+1+x*channels;
        const values=pixel(x,y);for(let c=0;c<channels;c++)pixels[offset+c]=values[c];
    }
    return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),pngChunk('IHDR',header),pngChunk('IDAT',deflateSync(pixels,{level:9})),pngChunk('IEND',Buffer.alloc(0))]);
}
export function terrarium(height){
    const value=clamp(Math.round((height+32768)*256),0,16777215);
    return [value>>16,(value>>8)&255,value&255];
}
function reliefPixel(grid,lng,lat){
    const step=grid.step_degrees/2;
    const dx=(sampleElevation(grid,lng+step,lat)-sampleElevation(grid,lng-step,lat))/(2*step*111320*Math.cos(lat*rad));
    const dy=(sampleElevation(grid,lng,lat+step)-sampleElevation(grid,lng,lat-step))/(2*step*110574);
    const normal=Math.hypot(dx,dy,1);
    const light=(-dx*-.5-dy*.5+Math.SQRT1_2)/normal;
    const shade=(light-Math.SQRT1_2);
    return shade<0?[80,69,59,clamp(Math.round(-shade*250),0,67)]:[255,255,246,clamp(Math.round(shade*180),0,45)];
}
function stitchSegments(segments){
    const key=p=>p.map(x=>x.toFixed(7)).join(',');
    const adjacency=new Map();
    segments.forEach((segment,i)=>segment.forEach(p=>{const k=key(p);if(!adjacency.has(k))adjacency.set(k,[]);adjacency.get(k).push(i);}));
    const used=new Set(),lines=[];
    for(const [i,segment] of segments.entries()){
        if(used.has(i))continue;used.add(i);const line=segment.slice();
        for(const reverse of [false,true]){
            if(reverse)line.reverse();
            while(true){
                const k=key(line.at(-1)),next=(adjacency.get(k)??[]).find(idx=>!used.has(idx));
                if(next===undefined)break;used.add(next);
                const [a,b]=segments[next];line.push(key(a)===k?b:a);
            }
        }
        if(line.length>=2)lines.push(line);
    }
    return lines;
}
export function buildContours(grid,interval=contourInterval){
    const {bounds:[west,, ,north],width,height,step_degrees:step,elevations_m:values}=grid;
    const features=[];
    for(let elevation=Math.ceil(Math.min(...values)/interval)*interval;elevation<Math.max(...values);elevation+=interval){
        const segments=[];
        for(let row=0;row<height-1;row++)for(let col=0;col<width-1;col++){
            const samples=[[col,row],[col+1,row],[col+1,row+1],[col,row+1]].map(([x,y])=>({x:west+x*step,y:north-y*step,z:values[y*width+x]}));
            const edges=[];
            for(let i=0;i<4;i++){
                const a=samples[i],b=samples[(i+1)%4];
                if((a.z>=elevation)===(b.z>=elevation))continue;
                const f=(elevation-a.z)/(b.z-a.z);edges.push([a.x+(b.x-a.x)*f,a.y+(b.y-a.y)*f]);
            }
            if(edges.length===2)segments.push(edges);
            if(edges.length===4){
                const centre=samples.reduce((n,p)=>n+p.z,0)/4>=elevation;
                if(centre===(samples[0].z>=elevation))segments.push([edges[0],edges[1]],[edges[2],edges[3]]);
                else segments.push([edges[0],edges[3]],[edges[1],edges[2]]);
            }
        }
        for(const coordinates of stitchSegments(segments))features.push({type:'Feature',properties:{kind:'contour',elevation,major:elevation%(interval*2)===0,name:`${elevation} m`,mapName:`${elevation} m`},geometry:{type:'LineString',coordinates:coordinates.map(p=>p.map(v=>Number(v.toFixed(7))))}});
    }
    return features;
}

export async function buildTerrain(area,output){
    const source=new URL(`../data/${area}/source/elevation-grid.json`,import.meta.url);
    const manifest=new URL(`${area}-terrain.json`,output),folder=new URL(`${area}-terrain/`,output);
    let data;
    try{data=validateElevationGrid(JSON.parse(await readFile(source,'utf8')));}catch(error){
        if(error.code!=='ENOENT')throw error;
        await rm(manifest,{force:true});await rm(folder,{force:true,recursive:true});return null;
    }
    const [w,s,e,n]=data.bounds;
    await mkdir(folder,{recursive:true});
    for(let z=minzoom;z<=maxzoom;z++){
        const scale=2**z;
        for(let x=Math.floor(mercX(w)*scale);x<=Math.floor(mercX(e)*scale);x++){
            const target=new URL(`${z}/${x}/`,folder);await mkdir(target,{recursive:true});
            for(let y=Math.floor(mercY(n)*scale);y<=Math.floor(mercY(s)*scale);y++){
                const lngs=Array.from({length:tileSize},(_,px)=>longitude((x+(px+.5)/tileSize)/scale));
                const lats=Array.from({length:tileSize},(_,py)=>latitude((y+(py+.5)/tileSize)/scale));
                await writeFile(new URL(`${y}.png`,target),encodePng(tileSize,tileSize,3,(px,py)=>terrarium(sampleElevation(data,lngs[px],lats[py]))));
            }
        }
    }
    // Web Mercator image fits the same geographic bounds in Leaflet. Its
    // 384-pixel raster is a visual interpolation, not higher resolution data.
    const size=384,y0=mercY(n),y1=mercY(s);
    const relief=encodePng(size,size,4,(x,y)=>reliefPixel(data,w+(e-w)*(x+.5)/size,latitude(y0+(y1-y0)*(y+.5)/size)));
    await writeFile(new URL('relief.png',folder),relief);
    const {source_url,data_source,attribution,license,license_url,fetched_at,source_resolution_m,step_degrees,elevations_m:values}=data;
    const detail={bounds:data.bounds,minzoom,maxzoom,tileSize,source_url,data_source,attribution,license,license_url,fetched_at,source_resolution_m,
        sample_spacing_m:Math.round(step_degrees*111320),contour_interval_m:contourInterval,min_m:Math.min(...values),max_m:Math.max(...values),sample_count:values.length};
    await writeFile(manifest,JSON.stringify(detail));
    return {contours:buildContours(data),detail};
}
