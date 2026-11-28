import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync, inflateSync } from 'node:zlib';
import { buildCartography, buildingDimensions, relationGeometry, shapeFeature } from '../scripts/map-cartography.mjs';
import { buildContours, validateElevationGrid, sampleElevation, terrarium, encodePng } from '../scripts/map-terrain.mjs';
import { PILOTS } from '../lib/pilots.ts';
import { featureDescription } from '../lib/map-detail.ts';

const way=(id,line,tags={})=>({type:'way',id,tags,geometry:line.map(([lon,lat])=>({lon,lat}))});
const ring=(w,s,e,n)=>[[w,s],[e,s],[e,n],[w,n],[w,s]];
const source=file=>JSON.parse(gunzipSync(readFileSync(new URL(`../${file}`,import.meta.url))))

test('multipolygon member stitching preserves real courtyards and refuses unclosed rings',()=>{
    const outer=ring(0,0,4,4),inner=ring(1,1,3,3);
    const a=way(1,outer.slice(0,3)),b=way(2,outer.slice(2).reverse()),c=way(3,inner);
    const relation={type:'relation',id:10,tags:{type:'multipolygon',building:'yes'},members:[{type:'way',ref:1,role:'outer'},{type:'way',ref:2,role:'outer'},{type:'way',ref:3,role:'inner'}]};
    const geometry=relationGeometry(relation,new Map([[1,a],[2,b],[3,c]]));
    assert.equal(geometry.type,'Polygon');assert.equal(geometry.coordinates.length,2);
    assert.deepEqual(geometry.coordinates[0][0],geometry.coordinates[0].at(-1));
    assert.equal(relationGeometry({...relation,members:relation.members.slice(0,1)},new Map([[1,a]])),null);
});

test('building dimensions keep recorded metres, floor-derived estimates and placeholders distinct',()=>{
    const height=buildingDimensions({building:'office',height:'108 m','building:levels':'30'});
    assert.equal(height.height,108);assert.equal(height.heightSource,'height');
    const levels=buildingDimensions({'building:part':'yes','building:levels':'5','building:min_level':'2','roof:height':'2'});
    assert.equal(levels.height,17);assert.equal(levels.base,6);assert.equal(levels.heightSource,'levels');
    const roof=buildingDimensions({building:'roof'});assert.equal(roof.use,'canopy');assert.ok(roof.height-roof.base<1);
    assert.equal(buildingDimensions({building:'yes',height:'unknown'}).heightSource,'approximate');
    assert.match(featureDescription({kind:'building',...roof},'en').lines.join(' '),/Height unknown/);
});

test('mapped building parts take precedence over the outer extrusion but preserve the footprint',()=>{
    const features=buildCartography([way(1,ring(0,0,4,4),{building:'office',name:'Building',height:'40'}),way(2,ring(1,1,3,3),{'building:part':'yes',height:'20'}),way(3,ring(5,5,6,6),{building:'yes'})]);
    const shapes=features.filter(f=>f.properties.kind==='building');
    assert.equal(shapes.length,3);
    assert.equal(shapes.find(f=>f.properties.osmRef==='way/1').properties.volume,false);
    assert.equal(shapes.find(f=>f.properties.osmRef==='way/2').properties.height,20);
    assert.equal(shapes.find(f=>f.properties.osmRef==='way/3').properties.volume,true);
});

test('map context differentiates pedestrian structures without turning them into routes or checks',()=>{
    const line={type:'LineString',coordinates:[[101,3],[101.001,3.001]]};
    const shape=tags=>shapeFeature({type:'way',id:1,tags},line).properties;
    assert.equal(shape({highway:'footway',tunnel:'building_passage'}).covered,true);
    assert.equal(shape({highway:'steps',bridge:'yes'}).pathType,'steps');
    assert.equal(shape({highway:'steps',bridge:'yes'}).structure,'bridge');
    assert.equal(shape({highway:'footway',foot:'private'}).restricted,true);
    assert.equal(shape({highway:'footway',footway:'crossing'}).pathType,'crossing');
    assert.equal(shape({highway:'service',tunnel:'yes'}).structure,'tunnel');
    assert.equal(shape({highway:'primary_link'}).roadClass,'primary');
    assert.match(featureDescription({kind:'path',restricted:true,covered:true},'en').lines.join(' '),/map context only/);
});

test('real KL archive includes mapped high-rise parts, named local places and covered path detail',()=>{
    const archive=source('data/pasar-seni/source/expanded-map-osm.json.gz');
    const features=buildCartography(archive.elements);
    const parts=features.filter(f=>f.properties.kind==='building'&&f.properties.part);
    assert.ok(parts.length>=400);
    assert.ok(parts.some(f=>f.properties.height===452&&f.properties.heightSource==='height'));
    assert.ok(features.some(f=>f.properties.kind==='label'&&f.properties.labelKind==='shop'));
    assert.ok(features.some(f=>f.properties.kind==='path'&&f.properties.covered));
    assert.ok(features.some(f=>f.properties.structure==='bridge'));
    assert.ok(features.some(f=>f.properties.kind==='water'&&f.geometry.type!=='LineString'));
});

test('bilinear elevation, contours and RGB encoding preserve sample heights',()=>{
    const grid=validateElevationGrid({bounds:[0,0,1,1],width:2,height:2,step_degrees:1,elevations_m:[0,40,0,40]});
    assert.equal(sampleElevation(grid,.5,.5),20);assert.equal(sampleElevation(grid,1,0),40);
    const contour=buildContours(grid).find(f=>f.properties.elevation===20);
    assert.ok(contour);assert.ok(contour.geometry.coordinates.every(p=>p[0]===.5));
    assert.deepEqual(terrarium(40.5),[128,40,128]);
    const png=encodePng(1,1,3,()=>terrarium(40.5));
    assert.deepEqual([...png.subarray(0,8)],[137,80,78,71,13,10,26,10]);
    // Read the first scanline in the single IDAT chunk.
    const idatLength=png.readUInt32BE(33);assert.deepEqual([...inflateSync(png.subarray(41,41+idatLength))],[0,128,40,128]);
    assert.throws(()=>validateElevationGrid({...grid,elevations_m:[1,2,3]}),/Invalid pilot/);
});

for(const [area,pilot] of Object.entries(PILOTS))test(`${area} real elevation archive covers the pilot and has documented source resolution`,()=>{
    const grid=validateElevationGrid(JSON.parse(readFileSync(new URL(`../data/${area}/source/elevation-grid.json`,import.meta.url),'utf8')));
    const [s,w,n,e]=pilot.bounds;
    assert.ok(grid.bounds[0]<=w&&grid.bounds[1]<=s&&grid.bounds[2]>=e&&grid.bounds[3]>=n);
    assert.equal(grid.source_resolution_m,90);assert.equal(grid.license,'CC BY 4.0');
    assert.ok(new Set(grid.elevations_m).size>20);assert.ok(buildContours(grid).length>5);
});
