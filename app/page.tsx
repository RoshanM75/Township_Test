import Link from 'next/link';
import { Footprints, ArrowRight, ArrowUpRight, ChevronDown, Sun, Accessibility, ClipboardCheck, MapPin, Route, ListChecks, Coffee, TrainFront, ShieldCheck, Wrench, BookOpen } from 'lucide-react';
import PreviewNotice from '@/components/walking/PreviewNotice';
import { IS_PAGES_PREVIEW } from '@/lib/site';
import HomeWalkPreview from '@/components/walking/HomeWalkPreview';
import { DEFAULT_PILOT,isPilotAvailable } from '@/lib/pilots';
import { DESTINATIONS } from '@/lib/precinct';
import './home.css';

const areaCards=[
    { id:'pasar-seni', title:'Central Kuala Lumpur', tag:'City neighbourhoods', description:'Pasar Seni, Brickfields, Bangsar, Pudu, Bukit Bintang and the gardens.', Icon:TrainFront },
    { id:'um-campus', title:'Universiti Malaya', tag:'Campus life', description:'Walk between classes, libraries, colleges and everyday campus facilities.', Icon:BookOpen },
    { id:'elmina', title:'Elmina', tag:'Township example', description:'Explore a neighbourhood walking network with the mapped bridges example.', Icon:Route },
] as const;

export default function Home() {
    const plannerHref=`/resident?area=${DEFAULT_PILOT}`;
    const coverageHref=`/verification?area=${DEFAULT_PILOT}`;
    return <div className="tg-home">
        <header className="tg-home-header">
            <div className="tg-home-wrap tg-home-nav">
                <Link href="/" className="tg-wordmark"><span><Footprints size={24} strokeWidth={1.8} aria-hidden/></span>TownshipGo</Link>
                <nav aria-label="Main navigation">
                    <Link href={plannerHref} className="tg-home-nav-primary">Walking planner<ArrowUpRight size={16} aria-hidden/></Link>
                    <Link href={coverageHref}>Path information</Link>
                    <Link href={`/dashboard?area=${DEFAULT_PILOT}`}>Operator workspace</Link>
                </nav>
            </div>
        </header>
        <main className="tg-home-wrap">
            <div className="tg-home-hero">
                <section className="tg-home-intro">
                    <p className="tg-home-eyebrow"><span/><MapPin size={15} aria-hidden/> People-first walking · Malaysia</p>
                    <h1>Know more.<br/>Walk your <em>way.</em></h1>
                    <p className="tg-home-lead">Everyday walks are about more than distance. Find places you can actually reach, plan around shade and access needs, and help improve the paths in your neighbourhood.</p>
                    <div className="tg-home-actions">
                        <Link href={plannerHref} className="tg-home-button tg-home-primary">Plan a walk <ArrowRight size={20} aria-hidden/></Link>
                        <a href="#walking-areas" className="tg-home-button">Choose your area<ChevronDown size={19} aria-hidden/></a>
                    </div>
                    <div className="tg-home-pill-row">
                        <span><ShieldCheck size={16} aria-hidden/>Clear condition checks</span>
                        <span><Accessibility size={16} aria-hidden/>Your walking needs</span>
                        <span><Sun size={16} aria-hidden/>Shade and weather</span>
                    </div>
                </section>
                <HomeWalkPreview />
            </div>

            <section id="walking-areas" className="tg-home-section" aria-labelledby="walking-areas-title">
                <div className="tg-home-section-title"><div><p className="tg-home-kicker">Choose a starting area</p><h2 id="walking-areas-title">Your neighbourhood, on foot.</h2></div><p>Explore the mapped pilot areas at your own pace.</p></div>
                <div className="tg-home-areas">
                    {areaCards.map(({id,title,tag,description,Icon})=>{
                        const available=isPilotAvailable(id);
                        return <article key={id} className="tg-home-area" data-area={id}>
                            <div className="tg-home-area-top"><span className="tg-home-area-icon"><Icon size={24} strokeWidth={1.8} aria-hidden/></span><span className="tg-home-area-tag">{available?tag:'Data pending'}</span></div>
                            <h3>{title}</h3><p>{description}</p>
                            {available?<Link href={`/resident?area=${id}`}>Open walking map<ArrowUpRight size={18} aria-hidden/></Link>:<p className="tg-home-muted">This pilot opens when its map data is available.</p>}
                            {id==='elmina'&&available&&<div className="tg-home-example-links">{DESTINATIONS.map(place=><Link key={place.id} href={`/resident?${new URLSearchParams({area:id,destId:place.id})}`}>{place.name}</Link>)}</div>}
                        </article>;
                    })}
                </div>
            </section>

            <section className="tg-home-section" aria-labelledby="features-title">
                <div className="tg-home-section-title"><div><p className="tg-home-kicker">Designed for everyday life</p><h2 id="features-title">More than directions.</h2></div><p>Make an informed choice before setting out.</p></div>
                <div className="tg-home-bento">
                    <article className="tg-home-feature tg-home-feature-lead"><span className="tg-home-feature-ico"><ClipboardCheck size={28} aria-hidden/></span>
                        <div><h3>Know what has been checked.</h3><p>Mapped information, community reports and current field observations are clearly separated. Review the conditions that matter to your walk.</p></div>
                        <div className="tg-home-evidence"><span><ShieldCheck size={17} aria-hidden/>Field-checked</span><span><MapPin size={17} aria-hidden/>Mapped</span><span><Sun size={17} aria-hidden/>Estimated</span></div>
                        <Link href={plannerHref}>Explore journey readiness<ArrowRight size={18} aria-hidden/></Link>
                    </article>
                    <article className="tg-home-feature"><span className="tg-home-feature-ico"><ListChecks size={24} aria-hidden/></span><h3>Make time for your errands.</h3><p>Plan multiple stops and a return journey within your available time.</p></article>
                    <article className="tg-home-feature"><span className="tg-home-feature-ico"><Coffee size={24} aria-hidden/></span><h3>Discover reachable places.</h3><p>Find a nearby seat, café, toilet or sheltered waiting area by its walking connection.</p></article>
                    <article className="tg-home-feature"><span className="tg-home-feature-ico"><Accessibility size={24} aria-hidden/></span><h3>Walk at your own pace.</h3><p>Keep your access and rest preferences in your private, device-saved profile.</p></article>
                    <article className="tg-home-feature"><span className="tg-home-feature-ico"><Wrench size={24} aria-hidden/></span><h3>Help improve local paths.</h3><p>Report barriers or share public route guides for a review. Operators can compare potential repairs.</p></article>
                </div>
            </section>

            <div className="tg-home-section tg-home-operator">
                <span className="tg-home-area-icon"><Wrench size={26} aria-hidden/></span>
                <div><p className="tg-home-kicker">For neighbourhood operators</p><h2>From feedback to better footpaths.</h2><p>Review the maintenance queue and model which improvements would reconnect everyday places.</p></div>
                <Link href={`/dashboard?area=${DEFAULT_PILOT}`} className="tg-home-button">Operator workspace<ArrowUpRight size={18} aria-hidden/></Link>
            </div>
            <PreviewNotice/>
            <footer className="tg-home-footer"><div><Link href="/" className="tg-wordmark"><span><Footprints size={21} aria-hidden/></span>TownshipGo</Link><p>© OpenStreetMap contributors · {IS_PAGES_PREVIEW?'Dated source snapshots':'Local pedestrian network'}.<br/>Estimates support planning; on-site checks still matter.</p></div><div><Link href={coverageHref}>Map sources and path records</Link><Link href={`/dashboard?area=${DEFAULT_PILOT}`}>Maintenance dashboard</Link></div></footer>
        </main>
    </div>;
}
