import Navbar from '../components/Navbar.jsx';
import Footer from '../components/Footer.jsx';
import Cta from '../components/Cta.jsx';
import SectionHeader from '../components/SectionHeader.jsx';
import { PricingCard } from '../components/Pricing.jsx';
import { PLANS } from '@/data/plans.jsx';

export default function PricingPage() {
    return (
        <div className="min-h-screen bg-background text-foreground">
            <Navbar />
            <main className="container-page pt-36 pb-16">
                <SectionHeader
                    tag="Pricing"
                    title={
                        <>
                            Plans for <span className="gradient-text">Everyone</span>
                        </>
                    }
                    subtitle="Start free with no card, or take a paid server from $1/month. Billed per server and its resources — no commitments or contracts. Every paid plan includes automatic backups and 24/7 support."
                />

                <div className="grid grid-cols-3 items-start gap-6 max-lg:grid-cols-2 max-md:grid-cols-1">
                    {PLANS.map((plan) => (
                        <PricingCard key={plan.name} plan={plan} />
                    ))}
                </div>

                <p className="mx-auto mt-10 max-w-[640px] text-center text-[0.9rem] leading-[1.7] text-ink-muted">
                    All prices in USD, per server per month. Cancel any time — servers stay online
                    until the end of the paid period, and every purchase is covered by the 30-day
                    money-back guarantee.
                </p>
            </main>
            <Cta />
            <Footer />
        </div>
    );
}
