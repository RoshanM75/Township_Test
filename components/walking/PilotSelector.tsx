'use client';
import { PILOTS,isPilotAvailable,type PilotId } from '@/lib/pilots';
import { residentText, type ResidentLanguage } from '@/lib/resident-language';
export default function PilotSelector({area,onChange,language='en'}:{area:PilotId;onChange:(id:PilotId)=>void;language?: ResidentLanguage}){
    return <label className="tg-area-select tg-pilot-select"><span className="sr-only">{residentText(language, 'Walking area')}</span><select value={area} onChange={e=>onChange(e.target.value as PilotId)}>
        {Object.values(PILOTS).map(pilot => (
            <option key={pilot.id} value={pilot.id} disabled={!isPilotAvailable(pilot.id)}>
                {pilot.short_name}{isPilotAvailable(pilot.id) ? '' : ' · ' + residentText(language, 'Data pending')}
            </option>
        ))}
    </select></label>;
}
