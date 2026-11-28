"""Optional GDAL integration test. All geometry/raster values here are fixtures."""
import gzip
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
import numpy as np
from osgeo import gdal, osr

ROOT=Path(__file__).resolve().parents[1]

def footprint(x,y,ref,source='approximate'):
    d=.00015
    return {'type':'Feature','properties':{'kind':'building','osmRef':ref,'heightSource':source,'height':6,'base':0},'geometry':{'type':'Polygon','coordinates':[[[x-d,y-d],[x+d,y-d],[x+d,y+d],[x-d,y+d],[x-d,y-d]]]}}

def raster(path,value):
    ds=gdal.GetDriverByName('GTiff').Create(str(path),80,80,1,gdal.GDT_Float32)
    sr=osr.SpatialReference();sr.ImportFromEPSG(4326);ds.SetProjection(sr.ExportToWkt())
    ds.SetGeoTransform((101.693,0.00005,0,3.144,0,-0.00005));ds.GetRasterBand(1).SetNoDataValue(-9999)
    a=np.full((80,80),value,dtype=np.float32);ds.GetRasterBand(1).WriteArray(a);ds.FlushCache();ds=None

class ImportFixture(unittest.TestCase):
    def test_three_sources(self):
        with tempfile.TemporaryDirectory() as d:
            d=Path(d);base=d/'map.geojson';overture=d/'buildings.geojson';height=d/'height.tif';canopy=d/'canopy.tif';out=d/'world.json.gz'
            first=footprint(101.695,3.142,'way/11');second=footprint(101.6955,3.143,'way/12','height')
            base.write_text(json.dumps({'type':'FeatureCollection','features':[first,second,{'type':'Feature','properties':{'kind':'path'},'geometry':{'type':'LineString','coordinates':[[101.694,3.142],[101.696,3.142]]}}]}))
            third=footprint(101.696,3.143,'fixture-3');third['properties']={'id':'fixture-3','height':18}
            part=footprint(101.696,3.143,'fixture-part');part['properties']={'id':'fixture-part','building_id':'fixture-3','type':'building_part','height':12,'min_height':2}
            overture.write_text(json.dumps({'type':'FeatureCollection','features':[third,part]}));raster(height,12);raster(canopy,8)
            run=subprocess.run([sys.executable,str(ROOT/'scripts/import-pedestrian-data.py'),'pasar-seni','--base-map',str(base),'--overture',str(overture),'--overture-release','2026-10-01','--google-height',str(height),'--google-year','2023','--canopy',str(canopy),'--canopy-observed','2025-01-01','--output',str(out)],capture_output=True,text=True,timeout=90)
            self.assertEqual(run.returncode,0,run.stderr)
            result=json.loads(gzip.decompress(out.read_bytes()));self.assertEqual(len(result['sources']),3)
            self.assertEqual(len(result['heights']),1);self.assertEqual(result['heights'][0]['osmRef'],'way/11');self.assertAlmostEqual(result['heights'][0]['height'],12)
            self.assertTrue(any(f['properties']['source']=='overture' for f in result['features']))
            self.assertTrue(any(f['properties'].get('part') is True for f in result['features']))
            self.assertTrue(any(f['properties'].get('volume') is False for f in result['features']))
            self.assertTrue(any(f['properties']['source']=='meta-wri-canopy' and f['properties']['height']==8 for f in result['features']))
            self.assertTrue(all(len(v['sha256'])==64 for v in result['sources']))

if __name__=='__main__':unittest.main()
