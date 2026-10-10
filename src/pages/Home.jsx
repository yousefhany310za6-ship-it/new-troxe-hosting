import Navbar from '../components/Navbar.jsx';
import Hero from '../components/Hero.jsx';
import Services from '../components/Services.jsx';
import Features from '../components/Features.jsx';
import Pricing from '../components/Pricing.jsx';
import Faq from '../components/Faq.jsx';
import Cta from '../components/Cta.jsx';
import Footer from '../components/Footer.jsx';
import { useSmoothScroll } from '../hooks/useSiteEffects.js';

export default function Home() {
    useSmoothScroll();

    return (
        <>
            <Navbar />
            <Hero />
            <Services />
            <Features />
            <Pricing />
            <Faq />
            <Cta />
            <Footer />
        </>
    );
}
