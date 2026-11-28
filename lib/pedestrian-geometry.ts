import type { LngLat } from './walking-geometry.ts';
const scaleAt=(lat:number)=>[111320*Math.cos(lat*Math.PI/180),110574];
export function offsetMetres(point:LngLat,east:number,north:number):LngLat{
    const [kx,ky]=scaleAt(point[1]);return [point[0]+east/kx,point[1]+north/ky];
}
function directions(a:LngLat,b:LngLat):LngLat{
    const [kx,ky]=scaleAt(a[1]),dx=(b[0]-a[0])*kx,dy=(b[1]-a[1])*ky,d=Math.hypot(dx,dy);return d>0?[dx/d,dy/d]:[0,0];
}
/** Small procedural corridor, in WGS84. Width/elevation provenance is kept
 * separately: a schematic ribbon is never a measured sidewalk boundary. */
export function corridorRing(line:LngLat[],width:number):LngLat[]|null{
    const points=line.filter((p,i)=>!i||p[0]!==line[i-1][0]||p[1]!==line[i-1][1]);
    if(points.length<2||!(width>0))return null;
    const sides=points.map((p,i)=>{
        const a=directions(points[Math.max(0,i-1)],p),b=directions(p,points[Math.min(points.length-1,i+1)]);
        const nx=-a[1]-b[1],ny=a[0]+b[0],length=Math.hypot(nx,ny)||1,half=width/2;
        return [offsetMetres(p,nx/length*half,ny/length*half),offsetMetres(p,-nx/length*half,-ny/length*half)] as const;
    });
    const ring=[...sides.map(p=>p[0]),...sides.map(p=>p[1]).reverse()];return [...ring,ring[0]];
}
export function crownRing(point:LngLat,diameter:number):LngLat[]{
    const ring=Array.from({length:12},(_,i)=>offsetMetres(point,diameter/2*Math.cos(i*Math.PI/6),diameter/2*Math.sin(i*Math.PI/6)));return [...ring,ring[0]];
}
