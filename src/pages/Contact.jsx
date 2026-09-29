import { useState } from 'react';

import Navbar from '../components/Navbar.jsx';
import Footer from '../components/Footer.jsx';
import Cta from '../components/Cta.jsx';
import SectionHeader from '../components/SectionHeader.jsx';
import { useReveal } from '../hooks/useSiteEffects.js';
import { cn } from '@/lib/utils';
import { IconDiscordSm, IconTelegramSm, IconSupport } from '../components/icons.jsx';

const CHANNELS = [
    {
        Icon: IconDiscordSm,
        title: 'Discord server',
        text: 'Fastest reply — usually under 15 minutes.',
        action: 'Join the server',
    },
    {
        Icon: IconTelegramSm,
        title: 'Telegram',
        text: 'Ping us any time, bots included.',
        action: 'Message us',
    },
    {
        Icon: IconSupport,
        title: 'Email support',
        text: 'For billing and account questions.',
        action: 'support@troxe.host',
    },
];

const inputClass =
    'w-full rounded-xl border border-hairline bg-white/10 px-5 py-3.5 text-[0.95rem] text-foreground placeholder-ink-muted transition focus:border-primary focus:ring-2 focus:ring-ring/40 focus:outline-none';

export default function Contact() {
    const [ref, visible] = useReveal();
    const [form, setForm] = useState({ name: '', email: '', subject: '', message: '' });
    const [error, setError] = useState('');
    const [sent, setSent] = useState(false);

    const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

    const handleSubmit = (e) => {
        e.preventDefault();
        if (!form.name.trim() || !form.email || !form.subject.trim() || !form.message.trim()) {
            setError('Please fill in all fields.');
            setSent(false);
            return;
        }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) {
            setError('Please enter a valid email address.');
            setSent(false);
            return;
        }
        setError('');
        setSent(true);
        setForm({ name: '', email: '', subject: '', message: '' });
    };

    return (
        <div className="min-h-screen bg-background text-foreground">
            <Navbar />
            <main className="container-page pt-36 pb-16">
                <SectionHeader
                    tag="Contact us"
                    title={
                        <>
                            Talk to a <span className="gradient-text">human</span>
                        </>
                    }
                    subtitle="Questions, billing, or just want to say hi — we reply fast, in English and Arabic."
                />

                <div className="grid grid-cols-3 gap-6 max-lg:grid-cols-1">
                    {CHANNELS.map(({ Icon, title, text, action }) => (
                        <div
                            key={title}
                            className="group rounded-lg border border-hairline bg-card p-7 transition hover:-translate-y-[3px] hover:border-hairline-hover hover:bg-surface-hover"
                        >
                            <div className="mb-[18px] flex size-12 items-center justify-center rounded-md border border-hairline bg-veil text-foreground transition group-hover:bg-primary group-hover:text-primary-foreground">
                                <Icon />
                            </div>
                            <h3 className="mb-2 text-[1.1rem] font-bold">{title}</h3>
                            <p className="mb-3 text-[0.9rem] leading-[1.7] text-ink-secondary">{text}</p>
                            <span className="text-[0.9rem] font-semibold text-foreground underline-offset-4 group-hover:underline">
                                {action}
                            </span>
                        </div>
                    ))}
                </div>

                <div
                    ref={ref}
                    className={cn(
                        'relative mt-6 overflow-hidden rounded-xl border border-hairline bg-card p-10 max-md:p-7 reveal',
                        visible && 'reveal-visible'
                    )}
                >
                    <div className="pointer-events-none absolute -top-1/2 -right-[20%] size-[400px] rounded-full bg-[radial-gradient(circle,rgba(255,255,255,0.06)_0%,transparent_70%)]" />
                    <div className="relative z-[1] mx-auto max-w-[640px]">
                        <h3 className="mb-2 text-center text-[1.4rem] font-bold">Send a message</h3>
                        <p className="mb-8 text-center text-[0.9rem] text-ink-secondary">
                            Average first reply: under 2 hours.
                        </p>
                        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
                            <div className="grid grid-cols-2 gap-4 max-md:grid-cols-1">
                                <input
                                    placeholder="Your name"
                                    value={form.name}
                                    onChange={set('name')}
                                    className={inputClass}
                                />
                                <input
                                    placeholder="Email"
                                    type="email"
                                    value={form.email}
                                    onChange={set('email')}
                                    className={inputClass}
                                />
                            </div>
                            <input
                                placeholder="Subject"
                                value={form.subject}
                                onChange={set('subject')}
                                className={inputClass}
                            />
                            <textarea
                                placeholder="How can we help?"
                                rows={5}
                                value={form.message}
                                onChange={set('message')}
                                className={cn(inputClass, 'resize-y')}
                            />
                            {error && <p className="text-sm text-red-400">{error}</p>}
                            {sent && !error && (
                                <p className="text-sm text-emerald-400">
                                    Message sent! We will get back to you soon. (Demo)
                                </p>
                            )}
                            <button
                                type="submit"
                                className="rounded-full bg-white px-5 py-3.5 text-[0.95rem] font-bold text-black shadow transition hover:bg-gray-200"
                            >
                                Send message
                            </button>
                        </form>
                    </div>
                </div>
            </main>
            <Cta />
            <Footer />
        </div>
    );
}
