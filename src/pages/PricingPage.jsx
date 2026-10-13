import { useSearchParams } from 'react-router-dom';

import Navbar from '../components/Navbar.jsx';
import Footer from '../components/Footer.jsx';
import Cta from '../components/Cta.jsx';
import SectionHeader from '../components/SectionHeader.jsx';
import PricingPicker from '../components/PricingPicker.jsx';
import { PRICING_CATEGORIES } from '@/data/pricing.jsx';

/**
 * /pricing — one category at a time.
 *
 * `?cat=bots` seeds the picker so the landing teaser and any external link can
 * deep-link a family. The value is read once on mount; the picker owns the
 * state from then on, so changing the category does not spam history entries.
 */
export default function PricingPage() {
    const [params] = useSearchParams();
    const requested = params.get('cat');
    const initial = PRICING_CATEGORIES.some((c) => c.id === requested) ? requested : 'bots';

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
                    subtitle="Three families of hosting, each priced on the resources it actually uses. Switch between them below — every paid plan includes automatic backups and 24/7 support."
                />

                <PricingPicker initialCategory={initial} />

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