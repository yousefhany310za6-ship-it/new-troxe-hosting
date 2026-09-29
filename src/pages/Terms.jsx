import Navbar from '../components/Navbar.jsx';
import Footer from '../components/Footer.jsx';
import SectionHeader from '../components/SectionHeader.jsx';

const SECTIONS = [
    {
        title: '1. The service',
        body: [
            'Troxe Hosting provides bot and application hosting, including runtimes for Discord, Telegram, Node.js, Bun, Python, PHP and static sites, plus managed MySQL, PostgreSQL, MongoDB and Redis databases.',
            'We aim for 99.9% monthly uptime. Scheduled maintenance is announced in advance and does not count toward downtime.',
        ],
    },
    {
        title: '2. Your account',
        body: [
            'You are responsible for keeping your login credentials secret and for everything that happens under your account.',
            'You must be at least 13 years old to use the service. Accounts found to be abusive, fraudulent or shared in violation of plan limits may be suspended.',
        ],
    },
    {
        title: '3. Fair use',
        body: [
            'Do not use the platform for spam, phishing, malware, crypto mining, DDoS attacks, or anything illegal in your jurisdiction.',
            'Resource limits (CPU, RAM, storage, bandwidth) depend on your plan. Sustained abuse that degrades the network for others may lead to throttling or suspension after a warning.',
        ],
    },
    {
        title: '4. Payments and refunds',
        body: [
            'Paid plans are billed in advance and renew automatically until cancelled. You can cancel any time; the service stays active until the end of the paid period.',
            'Refunds are handled case by case within 7 days of purchase. Contact support and we will make it right.',
        ],
    },
    {
        title: '5. Liability',
        body: [
            'The service is provided "as is". To the maximum extent allowed by law, Troxe Hosting is not liable for indirect damages or loss of data or profits.',
            'Keep your own backups of anything critical — automation helps, but ultimate responsibility for your data is yours.',
        ],
    },
    {
        title: '6. Changes',
        body: [
            'We may update these terms as the product evolves. Material changes are announced at least 14 days in advance; continued use after that means acceptance.',
        ],
    },
];

export default function Terms() {
    return (
        <div className="min-h-screen bg-background text-foreground">
            <Navbar />
            <main className="container-page pt-36 pb-16">
                <SectionHeader
                    tag="Legal"
                    title={
                        <>
                            Terms of <span className="gradient-text">Service</span>
                        </>
                    }
                    subtitle="Last updated: September 2026"
                />

                <div className="mx-auto flex max-w-[800px] flex-col gap-6">
                    {SECTIONS.map((section) => (
                        <article
                            key={section.title}
                            className="rounded-lg border border-hairline bg-card p-7 max-[480px]:p-6"
                        >
                            <h3 className="mb-3 text-[1.1rem] font-bold">{section.title}</h3>
                            <div className="flex flex-col gap-3">
                                {section.body.map((paragraph, i) => (
                                    <p
                                        key={i}
                                        className="text-[0.92rem] leading-[1.75] text-ink-secondary"
                                    >
                                        {paragraph}
                                    </p>
                                ))}
                            </div>
                        </article>
                    ))}
                </div>
            </main>
            <Footer />
        </div>
    );
}
