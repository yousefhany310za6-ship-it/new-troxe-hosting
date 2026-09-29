import { Link } from 'react-router-dom';

import Navbar from '../components/Navbar.jsx';
import Footer from '../components/Footer.jsx';
import Cta from '../components/Cta.jsx';
import SectionHeader from '../components/SectionHeader.jsx';
import { Button } from '../components/ui/button.jsx';
import { FaqAccordion } from '../components/Faq.jsx';
import { QUESTIONS } from '@/data/faqs.js';

export default function FaqPage() {
    return (
        <div className="min-h-screen bg-background text-foreground">
            <Navbar />
            <main className="container-page pt-36 pb-16">
                <SectionHeader
                    tag="FAQ"
                    title={
                        <>
                            Got <span className="gradient-text">Questions?</span>
                        </>
                    }
                    subtitle="Everything you need to know about hosting with Troxe. Still stuck? Our team replies in minutes."
                />

                <FaqAccordion items={QUESTIONS} />

                <div className="mt-10 text-center">
                    <Button variant="outline" size="lg" asChild>
                        <Link to="/contact">Still have questions? Talk to us</Link>
                    </Button>
                </div>
            </main>
            <Cta />
            <Footer />
        </div>
    );
}
