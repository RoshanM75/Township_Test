#!/usr/bin/env python3
"""Offline, reproducible imports from local, lawfully obtained open-data clips.
Requires system Python with GDAL/OGR and numpy. No cloud credentials required.
Outputs a compressed, source-dated sidecar; npm builds never download data.
"""
import argparse
import gzip
import hashlib
import json
import math
from pathlib import Path
from collections import defaultdict

import numpy as np
from osgeo import gdal, ogr, osr

gdal.UseExceptions()
ROOT = Path(__file__).resolve().parents[1]
BOUNDS = {'pasar-seni': (3.116, 101.665, 3.162, 101.720), 'um-campus': (3.109, 101.634, 3.136, 101.671), 'elmina': (3.16, 101.49, 3.20, 101.53)}


def digest(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for block in iter(lambda: f.read(1 << 20), b''):
            h.update(block)
    return h.hexdigest()


def spatial(epsg):
    srs = osr.SpatialReference()
    srs.ImportFromEPSG(epsg)
    srs.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
    return srs


WGS, UTM = spatial(4326), spatial(32647)
TO_METRES, TO_WGS = osr.CoordinateTransformation(WGS, UTM), osr.CoordinateTransformation(UTM, WGS)


def geometry(obj):
    geom = ogr.CreateGeometryFromJson(json.dumps(obj))
    if geom is None or geom.IsEmpty():
        return None
    if not geom.IsValid() and geom.GetDimension() == 2:
        geom = geom.MakeValid()
    geom.Transform(TO_METRES)
    return geom


def local_box(area):
    s, w, n, e = BOUNDS[area]
    return geometry({'type': 'Polygon', 'coordinates': [[[w,s],[e,s],[e,n],[w,n],[w,s]]]})


def cells(geom):
    a,b,c,d = geom.GetEnvelope()
    for x in range(math.floor(a / 80), math.floor(b / 80) + 1):
        for y in range(math.floor(c / 80), math.floor(d / 80) + 1):
            yield (x, y)


def as_json(geom):
    geom = geom.Clone()
    geom.Transform(TO_WGS)
    return json.loads(geom.ExportToJson())


def raster(dataset, box, resolution, algorithm='average'):
    w,e,s,n = box.GetEnvelope()
    result = gdal.Warp('', dataset, format='MEM', dstSRS=UTM.ExportToWkt(), outputBounds=(w,s,e,n),
                       xRes=resolution, yRes=resolution, targetAlignedPixels=True, resampleAlg=algorithm,
                       dstNodata=-9999, outputType=gdal.GDT_Float32)
    if not result or result.RasterCount != 1:
        raise ValueError('Supply one georeferenced source band, not a rendered image.')
    return result


def mask_for(geom, transform, width, height):
    ds = gdal.GetDriverByName('MEM').Create('', width, height, 1, gdal.GDT_Byte)
    ds.SetProjection(UTM.ExportToWkt()); ds.SetGeoTransform(transform)
    mem = ogr.GetDriverByName('Memory').CreateDataSource('mask')
    layer = mem.CreateLayer('mask', UTM, ogr.wkbUnknown)
    f = ogr.Feature(layer.GetLayerDefn()); f.SetGeometry(geom); layer.CreateFeature(f)
    gdal.RasterizeLayer(ds, [1], layer, burn_values=[1])
    return ds.ReadAsArray().astype(bool)


def footprint_height(ds, array, geom):
    x, r, _, y, _, dy = ds.GetGeoTransform(); w,e,s,n = geom.GetEnvelope()
    c0=max(0, math.floor((w-x)/r)); c1=min(ds.RasterXSize, math.ceil((e-x)/r))
    r0=max(0, math.floor((n-y)/dy)); r1=min(ds.RasterYSize, math.ceil((s-y)/dy))
    if c1 <= c0 or r1 <= r0:
        return None
    mask = mask_for(geom, (x+c0*r,r,0,y+r0*dy,0,dy), c1-c0,r1-r0)
    samples = array[r0:r1,c0:c1][mask]
    valid = samples[(samples >= 1) & (samples < 99.5)]
    # Avoid the height cap, low-confidence footprint overlap and tiny structures.
    if valid.size < 3 or valid.size < samples.size * .6 or np.any(samples >= 99.5):
        return None
    return round(float(np.median(valid)), 1)


def source(source_id, path, date, license_id):
    if not date or not __import__('re').fullmatch(r'\d{4}(-\d{2}(-\d{2})?)?', date):
        raise ValueError(f'{source_id}: provide the real release / observation date.')
    return {'id': source_id, 'data_at': date, 'license': license_id, 'sha256': digest(path)}


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('area', choices=BOUNDS)
    p.add_argument('--base-map', type=Path, help='Existing generated OSM area GeoJSON')
    p.add_argument('--overture', type=Path, help='Official building-theme bbox GeoJSON export in WGS84')
    p.add_argument('--overture-release')
    p.add_argument('--google-height', type=Path, help='One Google Open Buildings Temporal building-height GeoTIFF or mosaic VRT')
    p.add_argument('--google-year', choices=[str(y) for y in range(2016,2024)])
    p.add_argument('--canopy', type=Path, help='Meta/WRI CHMv2 local height GeoTIFF')
    p.add_argument('--canopy-observed', help='Tile observation date from its official companion metadata')
    p.add_argument('--canopy-resolution', type=float, default=5, choices=[5,10])
    p.add_argument('--output', type=Path)
    args = p.parse_args()
    if not any([args.overture, args.google_height, args.canopy]):
        p.error('Supply at least one local open dataset.')
    box=local_box(args.area)
    base=json.loads((args.base_map or ROOT/'public'/'map-area'/f'{args.area}.geojson').read_text())['features']
    out={'version':1,'area':args.area,'sources':[],'heights':[],'features':[]}
    buildings=[]; grid=defaultdict(set)
    for feature in base:
        props=feature['properties']
        if props.get('kind')!='building' or not props.get('osmRef'):
            continue
        geom=geometry(feature['geometry'])
        if not geom or geom.GetArea()<=0:
            continue
        i=len(buildings); buildings.append((feature,geom))
        for cell in cells(geom):grid[cell].add(i)
    updated=set()
    if args.overture:
        out['sources'].append(source('overture',args.overture,args.overture_release,'ODbL-1.0'))
        overture_features=json.loads(args.overture.read_text())['features']
        accepted_parents={}
        def part_feature(f):
            p=f.get('properties',{})
            return p.get('subtype')=='building_part' or p.get('type')=='building_part' or bool(p.get('building_id'))
        for f in overture_features:
            props=f.get('properties',{})
            ref=str(props.get('id') or f.get('id') or '')
            if not ref or part_feature(f):continue
            geom=geometry(f['geometry'])
            if not geom or geom.GetDimension()!=2 or not geom.Within(box) or geom.GetArea()<4:continue
            area=geom.GetArea(); matches=set().union(*(grid[c] for c in cells(geom)))
            raw=props.get('height'); floors=props.get('num_floors'); h=raw if isinstance(raw,(int,float)) and 1<=raw<=800 else floors*3 if isinstance(floors,(int,float)) and 1<=floors<=200 else None
            overlaps=[]
            for i in matches:
                feature,other=buildings[i]
                if not geom.Intersects(other):continue
                share=geom.Intersection(other).GetArea()
                if share/min(area,other.GetArea())>.15:overlaps.append((share/max(area,other.GetArea()),i))
            if overlaps:
                overlap,i=max(overlaps); original=buildings[i][0]['properties']; osm_ref=original.get('osmRef')
                if overlap>=.7 and h and osm_ref and original.get('heightSource')=='approximate' and osm_ref not in updated and not original.get('part') and original.get('use')!='canopy':
                    out['heights'].append({'osmRef':osm_ref,'source':'overture','height':h,'source_ref':ref});updated.add(osm_ref)
                continue
            if geom.GetGeometryName() not in ('POLYGON','MULTIPOLYGON'):continue
            base_height=props.get('min_height')
            base_height=base_height if isinstance(base_height,(int,float)) and 0<=base_height<(h or 6) else 0
            out['features'].append({'type':'Feature','geometry':as_json(geom),'properties':{'source':'overture','sourceRef':ref,'height':h or 6,'base':base_height,'heightSource':'height' if h else 'approximate'}})
            i=len(buildings);buildings.append((out['features'][-1],geom));accepted_parents[ref]=(out['features'][-1],geom)
            for cell in cells(geom):grid[cell].add(i)
        # Add source-linked parts only for newly imported parents. Never blanket
        # replace a current OSM outline or its explicitly mapped parts.
        for f in overture_features:
            if not part_feature(f):continue
            props=f.get('properties',{});parent=accepted_parents.get(str(props.get('building_id') or ''))
            ref=str(props.get('id') or f.get('id') or '')
            if not ref or not parent:continue
            g=geometry(f['geometry'])
            if not g or g.GetGeometryName() not in ('POLYGON','MULTIPOLYGON') or not g.Within(box) or g.GetArea()<=0 or g.Intersection(parent[1]).GetArea()/g.GetArea()<.85:continue
            raw=props.get('height');floors=props.get('num_floors');h=raw if isinstance(raw,(int,float)) and 1<=raw<=800 else floors*3 if isinstance(floors,(int,float)) and 1<=floors<=200 else None
            base_height=props.get('min_height');base_height=base_height if isinstance(base_height,(int,float)) and 0<=base_height<(h or 6) else 0
            out['features'].append({'type':'Feature','geometry':as_json(g),'properties':{'source':'overture','sourceRef':ref,'parentSourceRef':str(props['building_id']),'part':True,'height':h or 6,'base':base_height,'heightSource':'height' if h else 'approximate'}})
            parent[0]['properties']['volume']=False
    if args.google_height:
        out['sources'].append(source('google-buildings',args.google_height,args.google_year,'CC-BY-4.0'))
        ds=raster(gdal.Open(str(args.google_height)),box,4); values=ds.ReadAsArray()
        for feature,geom in buildings:
            props=feature['properties']; ref=props.get('osmRef')
            if props.get('heightSource')!='approximate' or ref in updated or props.get('use')=='canopy' or props.get('base',0)>0 or props.get('part'):continue
            height=footprint_height(ds,values,geom)
            if height is None:continue
            if ref:
                out['heights'].append({'osmRef':ref,'source':'google-buildings','height':height,'source_ref':args.google_year});updated.add(ref)
            # Do not overwrite separate imported source lineage for new Overture footprints.
    if args.canopy:
        out['sources'].append(source('meta-wri-canopy',args.canopy,args.canopy_observed,'CC-BY-4.0'))
        ds=raster(gdal.Open(str(args.canopy)),box,args.canopy_resolution); values=ds.ReadAsArray()
        # Restrict to a 35 m corridor around mapped walking paths, including mapped covered paths.
        paths=ogr.Geometry(ogr.wkbMultiLineString)
        for f in base:
            if f['properties'].get('kind')=='path' and f['geometry']['type']=='LineString':
                g=geometry(f['geometry'])
                if g:paths.AddGeometry(g)
        if paths.IsEmpty():raise ValueError('No mapped pedestrian corridor found.')
        # Rasterize each buffered way, not a massive dissolved network polygon.
        mem=ogr.GetDriverByName('Memory').CreateDataSource('corridors'); layer=mem.CreateLayer('paths',UTM,ogr.wkbPolygon)
        for g in paths:
            buffered=g.Buffer(35,4)
            if buffered.IsEmpty():continue
            f=ogr.Feature(layer.GetLayerDefn());f.SetGeometry(buffered);layer.CreateFeature(f)
        mask=gdal.GetDriverByName('MEM').Create('',ds.RasterXSize,ds.RasterYSize,1,gdal.GDT_Byte)
        mask.SetGeoTransform(ds.GetGeoTransform());mask.SetProjection(ds.GetProjection());gdal.RasterizeLayer(mask,[1],layer,burn_values=[1])
        good=(mask.ReadAsArray()>0)&(values>=3)&(values<=80)
        bands=np.where(good,np.rint(values/2)*2,0).astype(np.int16)
        quant=gdal.GetDriverByName('MEM').Create('',ds.RasterXSize,ds.RasterYSize,1,gdal.GDT_Int16);quant.SetGeoTransform(ds.GetGeoTransform());quant.SetProjection(ds.GetProjection());quant.GetRasterBand(1).WriteArray(bands)
        mask.GetRasterBand(1).WriteArray(good.astype(np.uint8))
        polygonized=mem.CreateLayer('canopy',UTM,ogr.wkbPolygon);polygonized.CreateField(ogr.FieldDefn('height',ogr.OFTInteger))
        gdal.Polygonize(quant.GetRasterBand(1),mask.GetRasterBand(1),polygonized,0,[],callback=None)
        for i,f in enumerate(polygonized):
            geom=f.GetGeometryRef().SimplifyPreserveTopology(args.canopy_resolution*.25).Intersection(box)
            if geom.IsEmpty() or geom.GetGeometryName() not in ('POLYGON','MULTIPOLYGON'):continue
            h=f.GetField('height')
            if h<3 or h>80:continue
            # Top-of-canopy approximation only: unknown trunk/crown base, no solid vegetation wall.
            out['features'].append({'type':'Feature','geometry':as_json(geom),'properties':{'source':'meta-wri-canopy','sourceRef':f'{args.canopy_observed}:{i}','height':h,'base':h,'heightSource':'satellite','dimensionSource':f'estimated {args.canopy_resolution:g} m canopy surface'}})
    output=args.output or ROOT/'data'/args.area/'source'/'pedestrian-external.json.gz';output.parent.mkdir(parents=True,exist_ok=True)
    output.write_bytes(gzip.compress(json.dumps(out,separators=(',',':')).encode(),mtime=0))
    print(f'{output}: {len(out["heights"])} footprint heights, {len(out["features"])} geometry records. Rebuild area maps.')


if __name__=='__main__':main()
