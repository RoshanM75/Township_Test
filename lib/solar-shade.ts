import type { LngLat } from './walking-geometry.ts';

export interface ShadeObject {
    ring: LngLat[];
    height: number;
    base: number;
    holes?: LngLat[][];
    source_ref?: string;
    source?: string;
    height_source?: string;
}

export interface ShadeDataset {
    centre: LngLat;
    objects: ShadeObject[];
    non_ground_ways?: string[];
    coverage?: 'partial';
}

export type SunCondition = 'sun' | 'shade' | 'covered' | 'night' | 'unknown';
export type ShadeSource = 'modelled' | 'checked' | 'mapped' | 'unknown';
export interface ShadeReading { condition: SunCondition; source: ShadeSource }
export type ShadeBounds = [west: number, south: number, east: number, north: number];

const radians = Math.PI / 180;
const cellSize = 80;
// Long shadows at very low sun angles are particularly sensitive to missing heights and terrain.
const minimumElevation = .12;
const coverageRadius = 180;

/** NOAA solar position approximation. Components are east, north and up. */
export function sunVector(date: string, hour: number, [lng, lat]: LngLat) {
    const yearStart = Date.parse(`${date.slice(0, 4)}-01-01`);
    const day = (Date.parse(date) - yearStart) / 86400000;
    const g = 2 * Math.PI / 365 * (day + (hour - 12) / 24);
    const equation = 229.18 * (.000075 + .001868 * Math.cos(g) - .032077 * Math.sin(g)
        - .014615 * Math.cos(2 * g) - .040849 * Math.sin(2 * g));
    const declination = .006918 - .399912 * Math.cos(g) + .070257 * Math.sin(g)
        - .006758 * Math.cos(2 * g) + .000907 * Math.sin(2 * g)
        - .002697 * Math.cos(3 * g) + .00148 * Math.sin(3 * g);
    const angle = ((hour * 60 + equation + 4 * lng - 480) / 4 - 180) * radians;
    const latitude = lat * radians;
    return [
        -Math.cos(declination) * Math.sin(angle),
        Math.cos(latitude) * Math.sin(declination) - Math.sin(latitude) * Math.cos(declination) * Math.cos(angle),
        Math.sin(latitude) * Math.sin(declination) + Math.cos(latitude) * Math.cos(declination) * Math.cos(angle),
    ] as const;
}

function vectorAt(instant: number, centre: LngLat) {
    const local = new Date(instant + 8 * 3600000);
    const hour = local.getUTCHours() + local.getUTCMinutes() / 60;
    return sunVector(local.toISOString().slice(0, 10), hour, centre);
}

function boundsOf(ring: LngLat[]): ShadeBounds {
    let west = Infinity, south = Infinity, east = -Infinity, north = -Infinity;
    for (const [x, y] of ring) {
        west = Math.min(west, x);
        south = Math.min(south, y);
        east = Math.max(east, x);
        north = Math.max(north, y);
    }
    return [west, south, east, north];
}

function overlaps(a: ShadeBounds, b: ShadeBounds) {
    return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
}

function inside([x, y]: LngLat, ring: LngLat[]) {
    let hit = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [a, b] = ring[i], [c, d] = ring[j];
        if ((b > y) !== (d > y) && x < (c - a) * (y - b) / (d - b) + a) hit = !hit;
    }
    return hit;
}

// Check the section of the ray above the base and below the top of an object.
function intersects(ring: LngLat[], a: LngLat, b: LngLat) {
    if (inside(a, ring) || inside(b, ring)) return true;
    const dx = b[0] - a[0], dy = b[1] - a[1];
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [x, y] = ring[j], sx = ring[i][0] - x, sy = ring[i][1] - y;
        const cross = dx * sy - dy * sx;
        if (Math.abs(cross) < 1e-9) continue;
        const ox = x - a[0], oy = y - a[1];
        const t = (ox * sy - oy * sx) / cross, u = (ox * dy - oy * dx) / cross;
        if (t >= 0 && t <= 1 && u >= 0 && u <= 1) return true;
    }
    return false;
}

/** The ray must touch solid material, not the inside of a mapped courtyard. */
function intersectsSolid(ring: LngLat[], holes: LngLat[][], a: LngLat, b: LngLat) {
    if (!holes.length) return intersects(ring, a, b);
    const solid = (p: LngLat) => inside(p, ring) && !holes.some(h => inside(p, h));
    if (solid(a) || solid(b)) return true;
    const dx=b[0]-a[0],dy=b[1]-a[1],times=[0,1];
    for(const boundary of [ring,...holes])for(let i=0,j=boundary.length-1;i<boundary.length;j=i++){
        const [x,y]=boundary[j],sx=boundary[i][0]-x,sy=boundary[i][1]-y,cross=dx*sy-dy*sx;
        if(Math.abs(cross)<1e-9)continue;
        const t=((x-a[0])*sy-(y-a[1])*sx)/cross,u=((x-a[0])*dy-(y-a[1])*dx)/cross;
        if(t>0&&t<1&&u>=0&&u<=1)times.push(t);
    }
    times.sort((x,y)=>x-y);
    return times.slice(1).some((t,i)=>{const m=(t+times[i])/2;return solid([a[0]+dx*m,a[1]+dy*m]);});
}

// Decompose a polygon with holes into non-overlapping scanline bands for the
// rendered shadow top. This preserves open courtyards without a mesh library.
function solidTop(ring: LngLat[], holes: LngLat[][]): LngLat[][] {
    if(!holes.length)return [ring];
    const rings=[ring,...holes], ys=[...new Set(rings.flat().map(p=>p[1]))].sort((a,b)=>a-b);
    const edges=rings.flatMap(r=>r.map((p,i)=>[p,r[(i+1)%r.length]] as const)).filter(([a,b])=>a[1]!==b[1]);
    const at=([a,b]:readonly [LngLat,LngLat], y:number)=>a[0]+(b[0]-a[0])*(y-a[1])/(b[1]-a[1]);
    const result:LngLat[][]=[];
    for(let i=1;i<ys.length;i++){
        const low=ys[i-1],high=ys[i],mid=(low+high)/2;
        const active=edges.filter(([a,b])=>mid>Math.min(a[1],b[1])&&mid<Math.max(a[1],b[1])).sort((a,b)=>at(a,mid)-at(b,mid));
        for(let j=1;j<active.length;j+=2){const l=active[j-1],r=active[j];result.push([[at(l,low),low],[at(r,low),low],[at(r,high),high],[at(l,high),high]]);}
    }
    return result;
}

const models = new WeakMap<ShadeDataset, ReturnType<typeof buildModel>>();
export function solarModel(dataset: ShadeDataset) {
    const existing = models.get(dataset);
    if (existing) return existing;
    const model = buildModel(dataset);
    models.set(dataset, model);
    return model;
}
export type SolarModel = ReturnType<typeof solarModel>;

function buildModel({ centre, objects, non_ground_ways, coverage }: ShadeDataset) {
    const nonGroundWays = new Set(non_ground_ways);
    const lonScale = 111320 * Math.cos(centre[1] * radians);
    const latScale = 110574;
    const project = ([lng, lat]: LngLat): LngLat => [(lng - centre[0]) * lonScale, (lat - centre[1]) * latScale];
    const unproject = ([x, y]: LngLat): LngLat => [x / lonScale + centre[0], y / latScale + centre[1]];
    const shapes = objects.map(object => {
        const ring = object.ring.map(project);
        const holes=object.holes?.map(h=>h.map(project))??[];
        return { ...object, ring, holes, tops:solidTop(ring,holes), bounds: boundsOf(ring) };
    });
    type Shape = (typeof shapes)[number];
    const bucket = (v: number) => Math.floor(v / cellSize);
    const key = (x: number, y: number) => `${x}:${y}`;
    const cells = new Map<string, Shape[]>();
    const nearby = new Set<string>();
    let maxHeight = 0;
    for (const object of shapes) {
        const [w, s, e, n] = object.bounds;
        maxHeight = Math.max(maxHeight, object.height);
        for (let x = bucket(w); x <= bucket(e); x++) for (let y = bucket(s); y <= bucket(n); y++) {
            const id = key(x, y);
            const list = cells.get(id);
            if (list) list.push(object);
            else cells.set(id, [object]);
        }
        for (let x = bucket(w - coverageRadius); x <= bucket(e + coverageRadius); x++) {
            for (let y = bucket(s - coverageRadius); y <= bucket(n + coverageRadius); y++) nearby.add(key(x, y));
        }
    }
    const positions = new Map<number, ReturnType<typeof vectorAt>>();
    function position(at: number) {
        const minute = Math.floor(at / 60000);
        const cached = positions.get(minute);
        if (cached) return cached;
        if (positions.size >= 512) positions.clear();
        const sun = vectorAt(minute * 60000, centre);
        positions.set(minute, sun);
        return sun;
    }
    function atPoint(coordinate: LngLat, at: number, elevation = 0): ShadeReading {
        if (!Number.isFinite(at) || !Number.isFinite(elevation)) return { condition: 'unknown', source: 'unknown' };
        const [east, north, up] = position(at);
        if (up <= 0) return { condition: 'night', source: 'modelled' };
        if (up < minimumElevation || !maxHeight) return { condition: 'unknown', source: 'unknown' };
        const [x, y] = project(coordinate);
        const dx = east / up, dy = north / up;
        const rayPoint = (height: number): LngLat => [x + (height-elevation) * dx, y + (height-elevation) * dy];
        let col = bucket(x), row = bucket(y);
        const localData = nearby.has(key(col, row));
        // Traverse only the cells intersected by the ray towards the sun.
        const stepX = Math.sign(dx), stepY = Math.sign(dy);
        const deltaX = dx === 0 ? Infinity : cellSize / Math.abs(dx);
        const deltaY = dy === 0 ? Infinity : cellSize / Math.abs(dy);
        let nextX = dx === 0 ? Infinity : ((col + Number(dx > 0)) * cellSize - x) / dx;
        let nextY = dy === 0 ? Infinity : ((row + Number(dy > 0)) * cellSize - y) / dy;
        const seen = new Set<Shape>();
        for (;;) {
            for (const object of cells.get(key(col, row)) ?? []) {
                if (seen.has(object)) continue;
                seen.add(object);
                if(object.height<elevation)continue;
                const start = rayPoint(Math.max(object.base,elevation)), end = rayPoint(object.height);
                if (overlaps(boundsOf([start, end]), object.bounds) && intersectsSolid(object.ring, object.holes, start, end)) {
                    return { condition: 'shade', source: 'modelled' };
                }
            }
            if (Math.min(nextX, nextY) > Math.max(0,maxHeight-elevation)) break;
            if (nextX < nextY) { col += stepX; nextX += deltaX; }
            else { row += stepY; nextY += deltaY; }
        }
        return localData && coverage!=='partial' ? { condition: 'sun', source: 'modelled' } : { condition: 'unknown', source: 'unknown' };
    }
    function shadowRings(at: number, bounds: ShadeBounds): LngLat[][] {
        if (!Number.isFinite(at)) return [];
        const [east, north, up] = position(at);
        if (up < minimumElevation) return [];
        const [w, s] = project([bounds[0], bounds[1]]), [e, n] = project([bounds[2], bounds[3]]);
        const dx = -east / up, dy = -north / up;
        const rings: LngLat[][] = [];
        for (const { ring, holes, tops, height, base, bounds: [left, bottom, right, top] } of shapes) {
            if (!overlaps([left + Math.min(base * dx, height * dx), bottom + Math.min(base * dy, height * dy),
                right + Math.max(base * dx, height * dx), top + Math.max(base * dy, height * dy)], [w, s, e, n])) continue;
            const atHeight = (shape:LngLat[],h:number) => shape.map(([x,y])=>unproject([x+h*dx,y+h*dy]));
            for(const top of tops){const upper=atHeight(top,height);rings.push([...upper,upper[0]]);}
            if(base===height)continue;
            for(const boundary of [ring,...holes]){
                const lower=atHeight(boundary,base),upper=atHeight(boundary,height);
                for(let i=0;i<boundary.length;i++){const next=(i+1)%boundary.length;rings.push([lower[i],lower[next],upper[next],upper[i],lower[i]]);}
            }
        }
        return rings;
    }
    return { atPoint, shadowRings, isGroundWay: (id: string | number | undefined) => !nonGroundWays.has(String(id)) };
}
