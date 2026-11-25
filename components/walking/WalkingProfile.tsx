'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import {
    Accessibility, Armchair, Bookmark, Check, ChevronRight, CloudRain, Footprints, Gauge,
    Lightbulb, LockKeyhole, Route, Settings2, ShieldCheck, SlidersHorizontal, Sun, TrafficCone,
    UserRound, Volume2, ClipboardList, Baby, PersonStanding, type LucideIcon,
} from 'lucide-react';
import { PROFILES, requiresStepFreeProfile, type Profile } from '@/lib/routing';
import { type WalkingNeeds, type ComfortPreference } from '@/lib/walking';
import { normaliseWalkingSettings, type DeviceWalkingProfile, type WalkingSettings } from '@/lib/walking-profile';
import { residentText, type ResidentLabel, type ResidentLanguage } from '@/lib/resident-language';
import WalkingRequirements from './WalkingRequirements';
import ProfileActivity from './ProfileActivity';
import type { CompletedWalk } from '@/lib/walk-library';
import type { FrequentPlace } from '@/lib/profile-activity';

type DisplayChoices = { language: ResidentLanguage; scale: 'normal' | 'large' | 'xlarge'; speak: boolean };
type Translate = (label: ResidentLabel) => string;

const MOBILITY: Array<{ id: Profile; label: ResidentLabel; hint: ResidentLabel; Icon: LucideIcon }> = [
    { id: 'everyday', label: 'Independent walking', hint: 'Use your own pace, on your own feet.', Icon: Footprints },
    { id: 'cane_walker', label: 'Walking aid', hint: 'For a cane, walking frame or similar aid.', Icon: PersonStanding },
    { id: 'wheelchair', label: 'Wheelchair', hint: 'Step-free access is required for this choice.', Icon: Accessibility },
    { id: 'stroller', label: 'With a stroller', hint: 'Step-free access is required for this choice.', Icon: Baby },
    { id: 'senior', label: 'Gentler walking', hint: 'Allow extra time and fewer steps.', Icon: Footprints },
];
const COMFORT: Array<{ id: ComfortPreference; label: ResidentLabel; Icon: LucideIcon }> = [
    { id: 'shade', label: 'More shade', Icon: Sun },
    { id: 'shelter', label: 'Rain shelter', Icon: CloudRain },
    { id: 'lighting', label: 'Better night lighting', Icon: Lightbulb },
    { id: 'controlled_crossings', label: 'Controlled crossings preferred', Icon: TrafficCone },
];
const QUESTIONS: ResidentLabel[] = [
    'How do you usually get around?', 'What pace feels comfortable?', 'What does your route need?',
    'How often do you need a rest?', 'What makes your walk more comfortable?', 'Make the app comfortable to use',
];

function profileName(profile: Profile, t: Translate) {
    return t(MOBILITY.find(choice => choice.id === profile)!.label);
}

function restLabel(needs: WalkingNeeds, t: Translate) {
    return needs.require_rests ? `${t('Verified rest every')} ${needs.rest_interval_min} min`
        : needs.comfort?.includes('seating') ? t('Seats whenever available') : t('No fixed rest interval');
}

function paceLabel(settings: WalkingSettings, t: Translate) {
    const speed = settings.needs.speed_mps;
    return speed === null ? t('Profile estimate') : speed === .6 ? t('Take your time')
        : speed === 1 ? t('Steady pace') : speed === 1.3 ? t('Brisk pace') : t('Personal pace');
}

function accessLabels(settings: WalkingSettings, t: Translate) {
    const { profile, needs } = settings;
    const slope = Math.min(needs.max_slope_pct, profile === 'wheelchair' ? 8.33 : 20);
    return [
        ...(needs.step_free || requiresStepFreeProfile(profile) ? [t('Step-free access')] : []),
        ...(slope < 20 ? [`${t('Maximum slope (%)')}: ${slope}%`] : []),
        ...(needs.avoid_uneven_surfaces ? [t('Smooth paths')] : profile === 'wheelchair' ? [t('Avoid broken surfaces')] : []),
        ...(needs.min_clear_width_m !== null ? [`${t('Minimum clear path width')}: ${needs.min_clear_width_m} m`] : []),
        ...(needs.avoid_uncontrolled_crossings ? [t('Use controlled or marked crossings')] : []),
        ...(needs.require_tactile_crossings ? [t('Require tactile paving at crossings')] : []),
        ...(needs.require_audible_crossings ? [t('Require audible pedestrian signals at crossings')] : []),
        ...(needs.verified_only ? [t('Require current checks for critical conditions')] : []),
    ];
}

export function compactWalkingSummary(settings: WalkingSettings, language: ResidentLanguage) {
    const t: Translate = label => residentText(language, label);
    const access = accessLabels(settings, t);
    return [profileName(settings.profile, t), access.length ? access[0] : '',
        settings.needs.require_rests || settings.needs.comfort?.includes('seating') ? restLabel(settings.needs, t) : '',
        ...COMFORT.filter(c => settings.needs.comfort?.includes(c.id)).slice(0, 1).map(c => t(c.label))].filter(Boolean).join(' · ');
}

function Choice({ label, hint, checked, onChange, name, Icon, disabled = false }: {
    label: string; hint?: string; checked: boolean; onChange: () => void; name?: string; Icon?: LucideIcon; disabled?: boolean;
}) {
    return <label className="tg-profile-choice" data-selected={checked}>
        {Icon && <span className="tg-profile-choice-icon"><Icon size={21} aria-hidden /></span>}
        <span className="tg-profile-choice-copy"><strong>{label}</strong>{hint && <small>{hint}</small>}</span>
        <input type={name ? 'radio' : 'checkbox'} name={name} checked={checked} onChange={onChange} disabled={disabled} />
    </label>;
}

interface ChoiceProps {
    value: WalkingSettings;
    onChange: (value: WalkingSettings) => void;
    t: Translate;
}

function MobilityChoices({ value, onChange, t, includeGentler = true }: ChoiceProps & { includeGentler?: boolean }) {
    const id = useId();
    return <fieldset aria-label={t('Walking mode')} className="tg-profile-options">
        {MOBILITY.filter(m => includeGentler || m.id !== 'senior').map(({ id: profile, label, hint, Icon }) =>
            <Choice key={profile} name={id} label={t(label)} hint={t(hint)} Icon={Icon} checked={value.profile === profile}
                onChange={() => onChange(normaliseWalkingSettings(profile, { ...value.needs, speed_mps: profile === value.profile ? value.needs.speed_mps : null }))} />)}
    </fieldset>;
}

function PaceChoices({ value, onChange, t }: ChoiceProps) {
    const id = useId();
    const selected = value.needs.speed_mps;
    const options: Array<{ speed: number | null; label: ResidentLabel }> = [
        { speed: .6, label: 'Take your time' }, { speed: 1, label: 'Steady pace' },
        { speed: 1.3, label: 'Brisk pace' }, { speed: null, label: 'Use a profile estimate' },
    ];
    if (selected !== null && !options.some(p => p.speed === selected)) options.push({ speed: selected, label: 'Personal pace' });
    return <fieldset aria-label={t('Walking pace')} className="tg-profile-options">
        {options.map(({ speed, label }) => <Choice key={speed ?? 'default'} name={id} label={t(label)}
            hint={`${Math.round(100 / (speed ?? PROFILES[value.profile].speed_mps) / 60 * 10) / 10} min / 100 m · ${speed ?? PROFILES[value.profile].speed_mps} m/s`} checked={selected === speed}
            onChange={() => onChange({ ...value, needs: { ...value.needs, speed_mps: speed } })} />)}
    </fieldset>;
}

function AccessChoices({ value, onChange, t }: ChoiceProps) {
    const { needs, profile } = value;
    const set = (patch: Partial<WalkingNeeds>) => onChange(normaliseWalkingSettings(profile, { ...needs, ...patch }));
    const locked = requiresStepFreeProfile(profile);
    return <fieldset aria-label={t('Required conditions')} className="tg-profile-options">
        <Choice label={t('Step-free access')} hint={t(locked ? 'Step-free access is required for this choice.' : 'Avoid recorded stairs and missing ramps.')}
            Icon={Accessibility} checked={needs.step_free || locked} disabled={locked} onChange={() => set({ step_free: !needs.step_free })} />
        <Choice label={t('Gentle slopes')} hint={needs.max_slope_pct < 20 ? `${t('Maximum slope (%)')}: ${needs.max_slope_pct}%` : t('Limit recorded slopes to 8%.')}
            checked={needs.max_slope_pct < 20} onChange={() => set({ max_slope_pct: needs.max_slope_pct < 20 ? 20 : 8 })} />
        <Choice label={t('Smooth paths')} hint={t('Exclude recorded uneven or broken surfaces.')}
            checked={needs.avoid_uneven_surfaces} onChange={() => set({ avoid_uneven_surfaces: !needs.avoid_uneven_surfaces })} />
        <Choice label={t('Wider paths')} hint={needs.min_clear_width_m !== null ? `${t('Minimum clear path width')}: ${needs.min_clear_width_m} m` : t('Require recorded clear width of at least 1 metre.')}
            checked={needs.min_clear_width_m !== null} onChange={() => set({ min_clear_width_m: needs.min_clear_width_m === null ? 1 : null })} />
        <p className="tg-small">{t('Some access details are still unchecked. Required conditions are not automatically relaxed.')}</p>
    </fieldset>;
}

function RestChoices({ value, onChange, t }: ChoiceProps) {
    const id = useId();
    const { needs } = value;
    const selected = needs.require_rests ? needs.rest_interval_min : needs.comfort?.includes('seating') ? 'prefer' : 'none';
    const intervals = [...new Set([5, 10, 15, ...(needs.require_rests ? [needs.rest_interval_min] : [])])].sort((a,b) => a-b);
    const select = (choice: string | number) => {
        const comfort = (needs.comfort ?? []).filter(p => p !== 'seating');
        onChange({ ...value, needs: { ...needs, require_rests: typeof choice === 'number',
            rest_interval_min: typeof choice === 'number' ? choice : needs.rest_interval_min,
            comfort: choice === 'prefer' ? [...comfort, 'seating'] : comfort } });
    };
    return <fieldset aria-label={t('Rest')} className="tg-profile-options">
        <Choice name={id} label={t('No fixed rest interval')} checked={selected === 'none'} onChange={() => select('none')} />
        <Choice name={id} label={t('Seats whenever available')} hint={t('Prefer routes near mapped seats.')} checked={selected === 'prefer'} onChange={() => select('prefer')} Icon={Armchair} />
        {intervals.map(n => <Choice key={n} name={id} label={`${t('Verified rest every')} ${n} min`}
            checked={selected === n} onChange={() => select(n)} />)}
        <p className="tg-small">{t('Choose a verified rest interval only if it is needed. Some areas have few verified seats.')}</p>
    </fieldset>;
}

function ComfortChoices({ value, onChange, t }: ChoiceProps) {
    const selected = value.needs.comfort ?? [];
    return <fieldset aria-label={t('Comfort preferences')} className="tg-profile-options">
        {COMFORT.map(({ id, label, Icon }) => <Choice key={id} label={t(label)} Icon={Icon} checked={selected.includes(id)}
            onChange={() => onChange({ ...value, needs: { ...value.needs, comfort: selected.includes(id) ? selected.filter(p => p !== id) : [...selected, id] } })} />)}
        <p className="tg-small">{t('These preferences rank matching routes. They do not guarantee shade, shelter, lighting or access.')}</p>
    </fieldset>;
}

function DisplayOptions({ value, onChange, canSpeak, t }: { value: DisplayChoices; onChange: (value: DisplayChoices) => void; canSpeak: boolean; t: Translate }) {
    const id = useId();
    return <div className="tg-profile-options">
        <label className="tg-label">{t('App language')}
            <select className="tg-input" value={value.language} onChange={e => onChange({ ...value, language: e.target.value === 'ms' ? 'ms' : 'en' })}>
                <option value="en" lang="en">English</option><option value="ms" lang="ms">Bahasa Melayu</option>
            </select>
        </label>
        <fieldset className="tg-profile-options"><legend className="tg-label">{t('Text size')}</legend>
            {([['normal','Normal'],['large','Large'],['xlarge','Extra large']] as const).map(([scale, label]) =>
                <Choice key={scale} name={id} label={t(label)} checked={scale === value.scale}
                    onChange={() => onChange({ ...value, scale })} />)}
        </fieldset>
        <div className="tg-profile-text-preview" data-preview-scale={value.scale}>
            <span className="tg-label">{t('Preview text')}</span><strong>{t('Your route is ready to review.')}</strong>
        </div>
        <Choice label={t('Spoken directions and updates')} hint={t(canSpeak ? 'Hear route updates when GPS guidance is enabled.' : 'Voice is unavailable in this browser.')}
            Icon={Volume2} checked={value.speak} disabled={!canSpeak} onChange={() => onChange({ ...value, speak: !value.speak })} />
    </div>;
}

export function WalkingProfileSetup({ initial, display, canSpeak, firstTime, onSave, onDismiss }: {
    initial: WalkingSettings; display: DisplayChoices; canSpeak: boolean; firstTime: boolean;
    onSave: (settings: WalkingSettings, display: DisplayChoices) => void; onDismiss: () => void;
}) {
    const [settings, setSettings] = useState(initial);
    const [options, setOptions] = useState(display);
    const [step, setStep] = useState(0);
    const title = useRef<HTMLHeadingElement>(null);
    const t: Translate = label => residentText(options.language, label);
    useEffect(() => {
        const frame = requestAnimationFrame(() => {
            title.current?.closest('dialog')?.scrollTo({ top: 0 });
            title.current?.focus({ preventScroll: true });
        });
        return () => cancelAnimationFrame(frame);
    }, [step]);
    const props = { value: settings, onChange: setSettings, t };
    return <div className="tg-profile-survey" lang={options.language}>
        <div className="tg-profile-kicker">
            <span>{t('About 2 minutes · Optional')}</span>
            <button type="button" className="tg-text-action tg-profile-skip" onClick={onDismiss}>{t(firstTime ? 'Skip for now' : 'Cancel')}</button>
        </div>
        <div className="tg-profile-progress-row">
            <div className="tg-profile-progress" role="progressbar" aria-label={t('Setup progress')} aria-valuemin={1} aria-valuemax={QUESTIONS.length} aria-valuenow={step + 1}>
                {QUESTIONS.map((_, index) => <span key={index} data-progress={index <= step} />)}
            </div>
            <strong>{step + 1} / {QUESTIONS.length}</strong>
        </div>
        <h2 ref={title} tabIndex={-1} className="tg-profile-question">{t(QUESTIONS[step])}</h2>
        {step === 0 && <>
            <p className="tg-small">{t('Your choices help us find routes that suit you. You can change them any time.')}</p>
            <label className="tg-profile-language">{t('App language')} <select value={options.language} onChange={e => setOptions({ ...options, language: e.target.value === 'ms' ? 'ms' : 'en' })}>
                <option lang="en" value="en">English</option><option lang="ms" value="ms">Bahasa Melayu</option>
            </select></label>
            <MobilityChoices {...props} includeGentler={initial.profile === 'senior'} />
        </>}
        {step === 1 && <><p className="tg-small">{t('You can change this after a walk. Estimates include crossing waits and planned rests.')}</p><PaceChoices {...props} /></>}
        {step === 2 && <><p className="tg-small">{t('Select the conditions you need, not just what you prefer.')}</p><AccessChoices {...props} /><WalkingRequirements needs={settings.needs} profile={settings.profile} language={options.language} onChange={needs => setSettings({ ...settings, needs })} /></>}
        {step === 3 && <RestChoices {...props} />}
        {step === 4 && <ComfortChoices {...props} />}
        {step === 5 && <DisplayOptions value={options} onChange={setOptions} canSpeak={canSpeak} t={t} />}
        <footer className="tg-profile-actions">
            <div className="tg-profile-buttons">
                {step > 0 && <button type="button" className="tg-btn" onClick={() => setStep(n => n - 1)}>{t('Back')}</button>}
                <button type="button" className="tg-btn tg-btn-primary" onClick={() => step < QUESTIONS.length - 1 ? setStep(n => n + 1)
                    : onSave(normaliseWalkingSettings(settings.profile, settings.needs), options)}>
                    {t(step < QUESTIONS.length - 1 ? 'Continue' : 'Save profile')}{step < QUESTIONS.length - 1 ? <ChevronRight size={18} aria-hidden /> : <Check size={18} aria-hidden />}
                </button>
            </div>
            <span className="tg-small tg-profile-private"><LockKeyhole size={14} aria-hidden />{t('On this device')}</span>
        </footer>
    </div>;
}

export function WalkingProfileEditor({ initial, language, trip, hasOverride, onSave, onUseTrip, onResetTrip, onClose }: {
    initial: WalkingSettings; language: ResidentLanguage; trip: boolean; hasOverride: boolean;
    onSave: (settings: WalkingSettings) => void; onUseTrip: (settings: WalkingSettings) => void; onResetTrip: () => void; onClose: () => void;
}) {
    const [settings, setSettings] = useState(initial);
    const t: Translate = label => residentText(language, label);
    const props = { value: settings, onChange: setSettings, t };
    function result() { return normaliseWalkingSettings(settings.profile, settings.needs); }
    return <div className="tg-profile-editor tg-stack">
        <p className="tg-small">{t(trip ? 'Your changes here do not overwrite your saved profile unless you choose to save them.' : 'Your choices help us find routes that suit you. You can change them any time.')}</p>
        <div className="tg-editor-groups">
            <details className="tg-editor-group"><summary><span>{t('Walking mode')}</span><small>{profileName(settings.profile, t)}</small></summary>
                <MobilityChoices {...props} /></details>
            <details className="tg-editor-group"><summary><span>{t('Walking pace')}</span><small>{paceLabel(settings, t)}</small></summary>
                <PaceChoices {...props} /></details>
            <details className="tg-editor-group"><summary><span>{t('Required conditions')}</span><small>{accessLabels(settings, t).join(' · ') || t('No extra access requirements')}</small></summary>
                <AccessChoices {...props} /></details>
            <details className="tg-editor-group"><summary><span>{t('Rest')}</span><small>{restLabel(settings.needs, t)}</small></summary>
                <RestChoices {...props} /></details>
            <details className="tg-editor-group"><summary><span>{t('Comfort preferences')}</span><small>{COMFORT.filter(c => settings.needs.comfort?.includes(c.id)).map(c => t(c.label)).join(' · ') || t('Balanced route choices')}</small></summary>
                <ComfortChoices {...props} /></details>
        </div>
        <WalkingRequirements needs={settings.needs} profile={settings.profile} language={language} onChange={needs => setSettings({ ...settings, needs })} />
        <footer className="tg-profile-actions tg-profile-editor-actions">
            {trip && <button type="button" className="tg-btn tg-btn-primary" onClick={() => onUseTrip(result())}>{t('Use for this journey')}</button>}
            <button type="button" className={`tg-btn ${trip ? 'tg-btn-outline' : 'tg-btn-primary'}`} onClick={() => onSave(result())}>{t('Save as my default')}</button>
            {trip && hasOverride && <button type="button" className="tg-btn" onClick={onResetTrip}>{t('Use my saved profile')}</button>}
            <button type="button" className="tg-text-action" onClick={onClose}>{t('Cancel')}</button>
        </footer>
    </div>;
}

function ProfileCard({ title, Icon, children, type }: { title: string; Icon: LucideIcon; children: ReactNode; type: string }) {
    return <section className={`tg-profile-card tg-profile-card-${type}`}>
        <div className="tg-profile-card-title"><Icon size={21} aria-hidden /><h3>{title}</h3></div>
        {children}
    </section>;
}

export function WalkingProfilePanel({ profile, language, onEdit, onSetup, onDisplay, onSaved, onReports, onCommunity, onPrivacy, communityReady, savedCount, history, activityNow, showActivity, showFrequentPlaces, onPlanFrequentPlace }: {
    profile: DeviceWalkingProfile; language: ResidentLanguage; onEdit: () => void; onSetup: () => void; onDisplay: () => void;
    onSaved: () => void; onReports: () => void; onCommunity: () => void; onPrivacy: () => void; communityReady: boolean; savedCount: number;
    history: readonly CompletedWalk[]; activityNow: number; showActivity: boolean; showFrequentPlaces: boolean; onPlanFrequentPlace: (place: FrequentPlace) => void;
}) {
    const t: Translate = label => residentText(language, label);
    const { settings, status } = profile;
    const { needs } = settings;
    const access = accessLabels(settings, t);
    const comfort = [...COMFORT.filter(p => needs.comfort?.includes(p.id)), ...(needs.comfort?.includes('seating')
        ? [{ id: 'seating', label: 'Mapped seats preferred' as const, Icon: Armchair }] : [])];
    const rows: { label: ResidentLabel; Icon: LucideIcon; action: () => void; hint?: string; disabled?: boolean }[] = [
        { label: 'Edit walking profile', Icon: SlidersHorizontal, action: onEdit },
        { label: status === 'complete' ? 'Review setup' : 'Finish setup', Icon: UserRound, action: onSetup },
        { label: 'Text, language and voice', Icon: Settings2, action: onDisplay },
        { label: 'Saved walks and history', Icon: Bookmark, action: onSaved, hint: savedCount ? String(savedCount) : undefined },
        { label: 'My reports', Icon: ClipboardList, action: onReports },
        { label: 'Local shortcuts', Icon: Route, action: onCommunity, disabled: !communityReady },
        { label: 'Privacy and reset', Icon: LockKeyhole, action: onPrivacy },
    ];
    return <article className="tg-profile-screen">
        <header className="tg-profile-heading">
            <div className="tg-profile-avatar"><UserRound size={29} aria-hidden /></div>
            <div><span className="tg-label">{t('Profile')}</span><h1>{t('My walking profile')}</h1><p>{t('Made for the way you walk.')}</p></div>
        </header>
        <p className="tg-profile-private tg-small"><LockKeyhole size={14} aria-hidden />{t('On this device')}</p>
        <nav className="tg-profile-section-links" aria-label={t('Profile sections')}>
            <a href="#profile-activity"><Footprints size={18} aria-hidden />{t('Activity')}</a>
            <a href="#profile-settings"><Settings2 size={18} aria-hidden />{t('Profile settings')}</a>
        </nav>
        {status !== 'complete' && <aside className="tg-profile-setup-cta">
            <strong>{t('Set up your walking profile')}</strong><p className="tg-small">{t('Complete the short setup to personalise future walks.')}</p>
            <button type="button" className="tg-btn tg-btn-primary" onClick={onSetup}>{t('Finish setup')}<ChevronRight size={19} aria-hidden /></button>
        </aside>}
        <div className="tg-profile-grid">
            <ProfileCard title={t('Access needs')} Icon={ShieldCheck} type="access">
                <strong className="tg-profile-value">{profileName(settings.profile, t)}</strong>
                <div className="tg-profile-chips">{access.length ? access.map(label => <span key={label}>{label}</span>) : <span>{t('No extra access requirements')}</span>}</div>
            </ProfileCard>
            <ProfileCard title={t('Pace')} Icon={Gauge} type="pace">
                <strong className="tg-profile-value">{paceLabel(settings, t)}</strong><span className="tg-small">{Math.round(100 / (needs.speed_mps ?? PROFILES[settings.profile].speed_mps) / 60 * 10) / 10} min / 100 m</span>
            </ProfileCard>
            <ProfileCard title={t('Rest')} Icon={Armchair} type="rest">
                <strong className="tg-profile-value">{restLabel(needs, t)}</strong>
                {needs.require_rests && <span className="tg-small">{needs.rest_duration_min} min · {t('Time at each rest')}</span>}
                {needs.require_rests && (needs.rest_backrest || needs.rest_armrests || needs.rest_shelter) && <span className="tg-small">
                    {[needs.rest_backrest && t('Seat needs a backrest'), needs.rest_armrests && t('Seat needs armrests'), needs.rest_shelter && t('Rest facilities need shelter')].filter(Boolean).join(' · ')}
                </span>}
            </ProfileCard>
            <ProfileCard title={t('Comfort preferences')} Icon={Sun} type="comfort">
                {comfort.length ? <div className="tg-profile-chips">{comfort.map(({ id,label,Icon }) => <span key={id}><Icon size={17} aria-hidden />{t(label)}</span>)}</div> : <strong className="tg-profile-value">{t('Balanced route choices')}</strong>}
            </ProfileCard>
        </div>
        <ProfileActivity history={history} now={activityNow} language={language} showActivity={showActivity}
            showFrequentPlaces={showFrequentPlaces} onSaved={onSaved} onPrivacy={onPrivacy} onPlan={onPlanFrequentPlace} />
        <h2 className="tg-h2" id="profile-settings" tabIndex={-1}>{t('Profile settings')}</h2>
        <div className="tg-profile-rows">{rows.map(({ label, Icon, action, hint, disabled }) =>
            <button key={label} type="button" onClick={action} disabled={disabled}><Icon size={21} aria-hidden /><span>{t(label)}</span>{hint && <small>{hint}</small>}<ChevronRight size={18} aria-hidden /></button>)}</div>
        <p className="tg-small">{t('Route preferences are saved on this device. No account is required.')}</p>
    </article>;
}
