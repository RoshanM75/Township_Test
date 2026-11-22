import { mkdir,writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gisLayers } from './pilot-snapshot.mjs';
import { loadPagesPilot } from './pilot-export.mjs';

const bundle=await loadPagesPilot(fileURLToPath(new URL('../data/pasar-seni/bundle.json',import.meta.url)));
if(!bundle)throw Error('Load the Pasar Seni source bundle before exporting GIS data.');
const out=resolve(process.argv[2]||'.local/gis/pasar-seni');await mkdir(out,{recursive:true});
const layers=gisLayers(bundle);
for(const [name,layer]of Object.entries(layers))await writeFile(resolve(out,`${name}.geojson`),JSON.stringify(layer));
const escape=s=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
await writeFile(resolve(out,'pasar-seni.qgs'),`<!DOCTYPE qgis PUBLIC 'http://mrcc.com/qgis.dtd' 'SYSTEM'><qgis version="3.40" projectname="Pasar Seni source coverage"><title>Pasar Seni pedestrian source review</title><projectCrs><spatialrefsys><proj4>+proj=utm +zone=47 +datum=WGS84 +units=m +no_defs</proj4><authid>EPSG:32647</authid><description>WGS 84 / UTM zone 47N</description><geographicflag>false</geographicflag></spatialrefsys></projectCrs><layer-tree-group name="" checked="Qt::Checked" expanded="1">${Object.keys(layers).map(name=>`<layer-tree-layer id="${name}" name="${name}" checked="Qt::Checked" expanded="1" source="./${name}.geojson" providerKey="ogr"/>`).join('')}</layer-tree-group><projectlayers>${Object.keys(layers).map(name=>`<maplayer type="vector" geometry="${name==='paths'?'Line':name==='satellite'?'Polygon':'Point'}"><id>${name}</id><layername>${escape(name)}</layername><datasource>./${name}.geojson</datasource><provider encoding="UTF-8">ogr</provider><srs><spatialrefsys><proj4>+proj=longlat +datum=WGS84 +no_defs</proj4><authid>EPSG:4326</authid><geographicflag>true</geographicflag></spatialrefsys></srs></maplayer>`).join('')}</projectlayers></qgis>`);
console.log(`GIS layers and a QGIS project exported to ${out}. Layer coordinates are WGS84; the project uses metre-based UTM 47N for local analysis.`);
