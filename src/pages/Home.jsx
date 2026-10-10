import Navbar from '../components/Navbar.jsx';
import Hero from '../components/landing/Hero.jsx';
import Bento from '../components/landing/Bento.jsx';
import Runtimes from '../components/landing/Runtimes.jsx';
import Why from '../components/landing/Why.jsx';
import Plans from '../components/landing/Plans.jsx';
import Status from '../components/landing/Status.jsx';
import Steps from '../components/landing/Steps.jsx';
import FaqSection from '../components/landing/FaqSection.jsx';
import Cta from '../components/landing/Cta.jsx';
import Footer from '../components/Footer.jsx';
import { useSmoothScroll } from '../hooks/useSiteEffects.js';

/**
 * Landing page. The order is the story: what it is → what you can do → what
 * runs on it → why it → what it costs → is it up → how to start → questions →
 * call to action. Every section is a real part of the product; nothing here
 * claims a feature that does not exist, and all prices/status come from the
 * live API.
 */
export default function Home() {
    useSmoothScroll();

    return (
        <div className="min-h-screen bg-[color:var(--surface-0)] text-foreground">
            <Navbar />
            <main>
                <Hero />
                <Bento />
                <Runtimes />
                <Why />
                <Plans />
                <Status />
                <Steps />
                <FaqSection />
                <Cta />
            </main>
            <Footer />
        </div>
    );
}
