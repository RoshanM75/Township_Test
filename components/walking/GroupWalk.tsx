'use client';

import { useState } from 'react';
import { Plus, UsersRound } from 'lucide-react';
import type { WalkingSettings } from '@/lib/walking-profile';
import { normaliseWalkingSettings } from '@/lib/walking-profile';
import { groupWalkingSettings } from '@/lib/group-walking';
import { PROFILES, type Profile } from '@/lib/routing';
import { DEFAULT_NEEDS } from '@/lib/walking';
import WalkingRequirements from './WalkingRequirements';
import { compactWalkingSummary } from './WalkingProfile';
import type { ResidentLanguage } from '@/lib/resident-language';

const profiles: Record<Profile,string> = {everyday:'Everyday walker', senior:'Slower pace', cane_walker:'Walking with a mobility aid',wheelchair:'Wheelchair',stroller:'Stroller'};
const companion = ():WalkingSettings => normaliseWalkingSettings('everyday',{...DEFAULT_NEEDS,max_slope_pct:20,budget_min:120});
export default function GroupWalk({ base, initial, language, onApply, onReset }: {
    base:WalkingSettings; initial?:WalkingSettings[]; language:ResidentLanguage; onApply:(members:WalkingSettings[], settings:WalkingSettings)=>void; onReset:()=>void;
}) {
    const [members,setMembers]=useState<WalkingSettings[]>(initial?.length ? initial : [companion()]);
    const combined=groupWalkingSettings([base,...members]);
    const update=(index:number,value:WalkingSettings)=>setMembers(before=>before.map((member,i)=>i===index?value:member));
    return <div className="tg-stack">
        <p className="tg-small">Plan for everyone together. The route uses the slowest pace and keeps every required access condition. No personal details about companions are collected.</p>
        <div className="tg-note"><strong>Your walking settings</strong><p className="tg-small">{compactWalkingSummary(base,language)}</p></div>
        {members.map((member,i)=><section className="tg-reliability-item tg-stack" key={i}>
            <div className="tg-reliability-line"><h3 className="font-bold">Companion {i+1}</h3>{members.length>1&&<button type="button" className="tg-text-action" onClick={()=>setMembers(before=>before.filter((_,j)=>i!==j))}>Remove</button>}</div>
            <label className="tg-label">Walking style<select className="tg-input" value={member.profile} onChange={e=>{
                const profile=e.target.value as Profile;
                update(i,normaliseWalkingSettings(profile,{...member.needs, speed_mps:null}));
            }}>{Object.keys(PROFILES).map(profile=><option key={profile} value={profile}>{profiles[profile as Profile]}</option>)}</select></label>
            <WalkingRequirements profile={member.profile} needs={member.needs} language={language} onChange={needs=>update(i,normaliseWalkingSettings(member.profile,needs))}/>
        </section>)}
        {members.length<3&&<button className="tg-btn" type="button" onClick={()=>setMembers(before=>[...before,companion()])}><Plus size={18} aria-hidden/>Add companion</button>}
        <div className="tg-note"><strong>{members.length+1} walking together</strong><p className="tg-small">{compactWalkingSummary(combined,language)} · {combined.needs.speed_mps?.toFixed(2)} m/s group pace</p></div>
        <button type="button" className="tg-btn tg-btn-primary" onClick={()=>onApply(members,combined)}><UsersRound size={19} aria-hidden/>Plan for the group</button>
        <button type="button" className="tg-btn" onClick={onReset}>Use my own profile</button>
    </div>;
}
