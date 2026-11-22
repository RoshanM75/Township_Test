import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir,writeFile,rename,rm,stat } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { createReadStream,createWriteStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { createGunzip } from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { csvRows } from '../lib/data/csv.ts';

const execute=promisify(execFile);
export async function download(url,path,{maxBytes=30000000,timeout=90,method='GET',body}={}){
    const parsed=new URL(url);if(parsed.protocol!=='https:')throw Error('Data downloads require HTTPS.');
    await mkdir(dirname(path),{recursive:true});const temporary=path+'.partial';
    try{
        const args=['--fail','--location','--silent','--show-error','--proto','=https','--proto-redir','=https','--max-time',String(timeout),'--max-filesize',String(maxBytes),
            '--user-agent','TownshipGo-data-import/0.1 (https://github.com/RoshanM75/Township_Test)','--output',temporary];
        if(method==='POST'){args.push('--request','POST','--header','Content-Type: application/json','--data-binary',JSON.stringify(body));}
        args.push(url);
        await execute('curl',args,{maxBuffer:1024*1024});
        if((await stat(temporary)).size>maxBytes)throw Error('Source exceeds the configured download limit.');
        await rename(temporary,path);
        const digest=await fileDigest(path);
        const metadata={url:parsed.origin+parsed.pathname+parsed.search,fetched_at:new Date().toISOString(),sha256:digest,bytes:(await stat(path)).size};
        await writeFile(path+'.source.json',JSON.stringify(metadata,null,2)+'\n');return metadata;
    }catch(error){await rm(temporary,{force:true});throw new Error(`Could not fetch ${parsed.hostname}${parsed.pathname}: ${String(error.stderr||error.message).trim().slice(0,400)}`);}
}

export async function fileDigest(path){const hash=createHash('sha256');for await(const chunk of createReadStream(path))hash.update(chunk);return hash.digest('hex');}

/** Original downloads can be stored losslessly compressed for repeatable offline imports. */
export async function importSourceFile(source,destination){
    const compressed=source.endsWith('.gz'),temporary=destination+'.partial';
    await mkdir(dirname(destination),{recursive:true});
    try{
        if(compressed)await pipeline(createReadStream(source),createGunzip(),createWriteStream(temporary));
        else await pipeline(createReadStream(source),createWriteStream(temporary));
        await rename(temporary,destination);
        return {sha256:await fileDigest(destination),...(compressed?{archive_sha256:await fileDigest(source)}:{})};
    }catch(error){await rm(temporary,{force:true});throw error;}
}

export async function* csvFile(path){
    const lines=createInterface({input:createReadStream(path,{encoding:'utf8'}),crlfDelay:Infinity});
    let buffer='',quoted=false,headers=null;
    for await(const line of lines){
        buffer+=(buffer?'\n':'')+line;for(const c of line)if(c==='"')quoted=!quoted;
        if(quoted)continue;const [row]=csvRows(buffer);buffer='';if(!row)continue;
        if(!headers){headers=row;if(new Set(headers).size!==headers.length)throw Error('Duplicate CSV header.');continue;}
        if(row.length!==headers.length)throw Error('Unexpected CSV row width.');
        yield Object.fromEntries(headers.map((h,i)=>[h,row[i]]));
    }
    if(quoted)throw Error('Unterminated quoted CSV field.');
}

export async function gtfsFiles(zipPath,bounds=null){
    const {stdout}=await execute('python',['-c',`import zipfile,json,sys,csv,io
allowed={'stops.txt','routes.txt','trips.txt','stop_times.txt','calendar.txt','calendar_dates.txt','feed_info.txt','agency.txt','frequencies.txt'}
bounds=json.loads(sys.argv[2]);result={}
with zipfile.ZipFile(sys.argv[1]) as z:
 total=sum(i.file_size for i in z.infolist())
 if total>250000000: raise ValueError('GTFS archive is too large')
 for name in z.namelist():
  if name not in allowed or name=='stop_times.txt': continue
  result[name]=list(csv.DictReader(io.StringIO(z.read(name).decode('utf-8-sig'))))
 if not {'stops.txt','routes.txt','trips.txt'}.issubset(result) or 'stop_times.txt' not in z.namelist(): raise ValueError('GTFS core files are missing')
 if bounds:
  s,w,n,e=bounds
  result['stops.txt']=[r for r in result['stops.txt'] if r.get('stop_lat') and r.get('stop_lon') and s<=float(r['stop_lat'])<=n and w<=float(r['stop_lon'])<=e]
 ids={r['stop_id'] for r in result['stops.txt']}
 origins={}
 frequency_trips={r['trip_id'] for r in result.get('frequencies.txt',[])}
 result['stop_times.txt']=[]
 with z.open('stop_times.txt') as f:
  for r in csv.DictReader(io.TextIOWrapper(f,encoding='utf-8-sig')):
   if r['stop_id'] in ids: result['stop_times.txt'].append(r)
   if r['trip_id'] in frequency_trips and r.get('stop_sequence','').isdigit():
    seq=int(r['stop_sequence'])
    if r['trip_id'] not in origins or seq<origins[r['trip_id']][0]:
     origins[r['trip_id']]=(seq,r.get('departure_time') or r.get('arrival_time'))
 result['trip_origins']=[{'trip_id':trip,'time':date[1]} for trip,date in origins.items()]
 print(json.dumps(result))`,zipPath,JSON.stringify(bounds)],{maxBuffer:200000000});
    return JSON.parse(stdout);
}

export async function geofabrikToOverpass(pbfPath,bounds,outPath){
    const clipped=pbfPath+'.pilot.osm.pbf';const xml=pbfPath+'.pilot.osm';
    const [s,w,n,e]=bounds;
    await execute('osmium',['extract','--bbox',`${w},${s},${e},${n}`,'--strategy','complete_ways','--overwrite','--output',clipped,pbfPath]);
    await execute('osmium',['cat','--overwrite','--output-format','osm','--output',xml,clipped]);
    await execute('python',['-c',`import xml.etree.ElementTree as E,json,sys
root=E.parse(sys.argv[1]).getroot();nodes={};elements=[]
for el in root.findall('node'):
 node={'type':'node','id':int(el.attrib['id']),'lat':float(el.attrib['lat']),'lon':float(el.attrib['lon']),'tags':{t.attrib['k']:t.attrib['v'] for t in el.findall('tag')}}
 nodes[node['id']]=node;elements.append(node)
for el in root.findall('way'):
 refs=[int(n.attrib['ref']) for n in el.findall('nd')]
 if not all(i in nodes for i in refs): continue
 elements.append({'type':'way','id':int(el.attrib['id']),'nodes':refs,'geometry':[{'lat':nodes[i]['lat'],'lon':nodes[i]['lon']} for i in refs],'tags':{t.attrib['k']:t.attrib['v'] for t in el.findall('tag')}})
json.dump({'version':0.6,'generator':'Geofabrik PBF via osmium','elements':elements},open(sys.argv[2],'w'))`,xml,outPath],{maxBuffer:1000000});
}
