import Navbar from '../components/Navbar.jsx';
import Footer from '../components/Footer.jsx';
import Cta from '../components/landing/Cta.jsx';
import Plans from '../components/landing/Plans.jsx';

/**
 * Pricing page. It renders the SAME component the landing page uses, and that
 * component reads the public plan API — so there is exactly one source of
 * truth for prices and resources (the admin's plan list), never a copy.
 */
export default function PricingPage() {
    return (
        <div className="min-h-screen overflow-x-hidden bg-[color:var(--surface-0)] text-foreground">
            <Navbar />
            <main className="pt-36 pb-4">
                <header className="container-page text-center">
                    <p className="mb-3 font-mono text-[0.72rem] font-bold tracking-[0.22em] text-[color:var(--lime)] uppercase">
                        Pricing
                    </p>
                    <h1 className="mx-auto max-w-[720px] text-[1.9rem] leading-[1.14] font-extrabold tracking-[-0.035em] text-foreground min-[400px]:text-[2.15rem] sm:text-[2.6rem] lg:text-[2.9rem]">
                        Pay for the resources you actually use
                    </h1>
                    <p className="mx-auto mt-5 max-w-[620px] text-[1rem] leading-[1.75] text-ink-secondary">
                        Every plan is per server, per month: CPU, RAM, storage, how many servers you can run and how
                        many backup slots you get. The list below is read from the platform, so it is always the current
                        one.
                    </p>
                </header>
                <Plans hideHeader />
            </main>
            <Cta />
            <Footer />
        </div>
    );
}
