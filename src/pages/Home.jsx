import Navbar from '../components/Navbar.jsx';
import Hero from '../components/Hero.jsx';
import TrustMarquee from '../components/TrustMarquee.jsx';
import Services from '../components/Services.jsx';
import HowItWorks from '../components/HowItWorks.jsx';
import DeployShowcase from '../components/DeployShowcase.jsx';
import Features from '../components/Features.jsx';
import Pricing from '../components/Pricing.jsx';
import Faq from '../components/Faq.jsx';
import Cta from '../components/Cta.jsx';
import Footer from '../components/Footer.jsx';
import ScrollProgress from '../components/effects/ScrollProgress.jsx';
import { useSmoothScroll } from '../hooks/useSiteEffects.js';

export default function Home() {
    useSmoothScroll();

    return (
        <>
            <ScrollProgress />
            <Navbar />
            <Hero />
            <TrustMarquee />
            <Services />
            <HowItWorks />
            <DeployShowcase />
            <Features />
            <Pricing />
            <Faq />
            <Cta />
            <Footer />
        </>
    );
}