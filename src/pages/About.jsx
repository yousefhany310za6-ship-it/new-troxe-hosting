import Navbar from '../components/Navbar.jsx';
import Footer from '../components/Footer.jsx';
import Cta from '../components/Cta.jsx';
import SectionHeader from '../components/SectionHeader.jsx';
import { useReveal } from '../hooks/useSiteEffects.js';
import { cn } from '@/lib/utils';
import { IconZap, IconShield, IconUsers, IconRefresh } from '../components/icons.jsx';

const STATS = [
    { value: '99.9%', label: 'Uptime guarantee' },
    { value: '40K+', label: 'Developers hosted' },
    { value: '1M+', label: 'Deploys served' },
    { value: '24/7', label: 'Human support' },
];

const VALUES = [
    {
        Icon: IconZap,
        title: 'Speed first',
        text: 'Every decision starts with latency. If it makes deploys slower, we do not ship it.',
    },
    {
        Icon: IconShield,
        title: 'Security by default',
        text: 'DDoS protection, encryption and isolation are on for everyone — not a paid add-on.',
    },
    {
        Icon: IconUsers,
        title: 'Developers, not tickets',
        text: 'Real engineers answer support in minutes, in English and Arabic, around the clock.',
    },
    {
        Icon: IconRefresh,
        title: 'Boring reliability',
        text: 'Auto-restarts, backups and monitoring run quietly so your apps just stay online.',
    },
];

function RevealCard({ className, children }) {
    const [ref, visible] = useReveal();
    return (
        <div ref={ref} className={cn('reveal', visible && 'reveal-visible', className)}>
            {children}
        </div>
    );
}

export default function About() {
    return (
        <div className="min-h-screen bg-background text-foreground">
            <Navbar />
            <main className="container-page pt-36 pb-16">
                <SectionHeader
                    tag="About Troxe"
                    title={
                        <>
                            Hosting that <span className="gradient-text">gets out of the way</span>
                        </>
                    }
                    subtitle="We started Troxe Hosting with one belief: deploying a bot or an app should take seconds, not weekends."
                />

                <div className="grid grid-cols-4 gap-6 max-lg:grid-cols-2 max-md:grid-cols-1">
                    {STATS.map((stat) => (
                        <RevealCard
                            key={stat.label}
                            className="rounded-lg border border-hairline bg-card p-7 text-center"
                        >
                            <div className="font-mono text-[2rem] font-bold text-foreground">
                                {stat.value}
                            </div>
                            <div className="mt-1 text-[0.9rem] text-ink-secondary">{stat.label}</div>
                        </RevealCard>
                    ))}
                </div>

                <RevealCard className="relative mt-6 overflow-hidden rounded-xl border border-hairline bg-card p-10 max-md:p-7">
                    <div className="pointer-events-none absolute -top-1/2 -right-[20%] size-[400px] rounded-full bg-[radial-gradient(circle,rgba(255,255,255,0.06)_0%,transparent_70%)]" />
                    <div className="relative z-[1] max-w-[720px]">
                        <h3 className="mb-3 text-[1.4rem] font-bold">Our story</h3>
                        <div className="flex flex-col gap-4 text-[0.95rem] leading-[1.8] text-ink-secondary">
                            <p>
                                Troxe Hosting began as a side project to keep a few Discord bots
                                online without babysitting a VPS. Friends asked to host theirs too,
                                then their friends — and the weekend project turned into a platform
                                serving thousands of developers.
                            </p>
                            <p>
                                Today we host Discord and Telegram bots, Node.js, Bun, Python, PHP
                                and static sites, backed by built-in MySQL, PostgreSQL, MongoDB and
                                Redis. The goal never changed: press deploy, and get back to
                                building.
                            </p>
                        </div>
                    </div>
                </RevealCard>

                <div className="mt-16">
                    <SectionHeader
                        tag="What we stand for"
                        title={
                            <>
                                Values behind <span className="gradient-text">every deploy</span>
                            </>
                        }
                    />
                    <div className="grid grid-cols-2 gap-6 max-md:grid-cols-1">
                        {VALUES.map(({ Icon, title, text }) => (
                            <RevealCard
                                key={title}
                                className="group rounded-lg border border-hairline bg-card p-7 transition hover:-translate-y-[3px] hover:border-hairline-hover hover:bg-surface-hover"
                            >
                                <div className="mb-[18px] flex size-12 items-center justify-center rounded-md border border-hairline bg-veil text-foreground transition group-hover:bg-primary group-hover:text-primary-foreground">
                                    <Icon />
                                </div>
                                <h3 className="mb-2 text-[1.1rem] font-bold">{title}</h3>
                                <p className="text-[0.9rem] leading-[1.7] text-ink-secondary">{text}</p>
                            </RevealCard>
                        ))}
                    </div>
                </div>
            </main>
            <Cta />
            <Footer />
        </div>
    );
}
