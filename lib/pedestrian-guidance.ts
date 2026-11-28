import type { JourneyStep } from './walking.ts';
import type { PathEdge } from './routing.ts';
import type { PackCheck } from './walk-library.ts';
import type { ResidentLanguage } from './resident-language.ts';

export function pedestrianCue(step:JourneyStep|undefined,edge:PathEdge|undefined,checks:PackCheck[],at:string,language:ResidentLanguage='en'){
    const say=(en:string,ms:string)=>language==='ms'?ms:en;
    const facts=new Map<string,{value:unknown;current:boolean}>();
    if(edge)for(const record of checks.filter(r=>r.target_id===String(edge.id)&&r.target_type===(edge.is_crossing?'crossing':'path')&&r.observed_at<=at).sort((a,b)=>b.observed_at.localeCompare(a.observed_at)||b.created_at.localeCompare(a.created_at))){
        for(const [key,value] of Object.entries(record.attributes))if(!facts.has(key))facts.set(key,{value,current:record.status==='verified'&&!!record.valid_until&&record.valid_until>at});
    }
    const confirmed=(key:string)=>facts.get(key)?.current&&facts.get(key)?.value===true;
    const w=edge?.world;
    const name=step?.name&&!/^Footpath \d+$/i.test(step.name)?step.name:null;
    const heading=edge?.is_crossing?say('Approaching a mapped crossing','Menghampiri lintasan dipetakan'):
        edge?.has_steps||w?.connector==='stairs'?say('Mapped stairs','Tangga dipetakan'):
        w?.connector==='ramp'?say('Mapped ramp','Tanjakan dipetakan'):
        w?.connector==='lift'?say('Lift connection','Sambungan lif'):
        w?.structure==='bridge'?say('Elevated pedestrian connection','Laluan pejalan kaki bertingkat'):
        w?.structure==='tunnel'?say('Underground pedestrian connection','Laluan pejalan kaki bawah tanah'):
        step?.kind==='rest'?say('Planned rest stop','Hentian rehat terancang'):step?.kind==='connection'?say('Check the access connection','Semak sambungan akses'):
        step?.kind==='turn'?say('Turn back along the planned route','Pusing balik mengikut laluan terancang'):
        say('Follow the mapped route','Ikut laluan dipetakan');
    const detail:string[]=[];
    if(name&&name!==heading)detail.push(name);
    if(step?.distance_m)detail.push(`${Math.round(step.distance_m)} ${say('metres','meter')}`);
    if(w?.levels.length)detail.push(`${say('Mapped level','Aras dipetakan')}: ${w.levels.join(' / ')}`);
    if(w?.connector||w?.structure==='indoor')detail.push(confirmed('level_connection_checked')?say('Level connection checked. Confirm your position.','Sambungan aras disemak. Sahkan kedudukan anda.'):say('Level connection needs checking; GPS cannot confirm floors.','Sambungan aras perlu disemak; GPS tidak dapat mengesahkan tingkat.'));
    if(edge?.has_steps&&w?.stepCount)detail.push(`${say('Mapped step count','Bilangan tangga dipetakan')}: ${w.stepCount}`);
    if(edge){
        detail.push(confirmed('tactile_continuous')?say('Continuous tactile guidance checked','Panduan sentuhan berterusan disemak'):
            facts.get('tactile_continuous')?.current&&facts.get('tactile_continuous')?.value===false?say('Tactile guidance is not continuous','Panduan sentuhan tidak berterusan'):
            w?.tactile===true||edge.has_tactile===true?say('Tactile paving mapped; continuity unknown','Laluan sentuhan dipetakan; kesinambungan tidak diketahui'):say('Tactile guidance unknown','Panduan sentuhan tidak diketahui'));
        if(edge.is_crossing){
            detail.push(confirmed('audible_signal')?say('Audible signal was checked; listen for the current signal','Isyarat bunyi telah disemak; dengar isyarat semasa'):say('Working audible signal not confirmed','Isyarat bunyi berfungsi belum disahkan'));
            detail.push(say('Check the actual crossing and traffic. This is not a signal to cross.','Semak lintasan dan trafik sebenar. Ini bukan isyarat untuk melintas.'));
        }
    }
    return {heading,detail:detail.join('. '),attention:!!(edge?.is_crossing||edge?.has_steps||w?.connector||w?.structure==='indoor'||step?.kind==='connection')};
}
