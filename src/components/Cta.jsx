import { useNavigate } from 'react-router-dom';

import { Button } from './ui/button.jsx';

export default function Cta() {
    const navigate = useNavigate();

    return (
        <section id="cta" className="py-[60px]">
            <div className="container-page">
                <div className="relative flex items-center justify-between gap-10 overflow-hidden rounded-xl border border-hairline bg-card px-12 py-[60px] max-md:flex-col max-md:px-7 max-md:py-12 max-md:text-center">
                    <div className="pointer-events-none absolute -top-1/2 -right-[20%] size-[400px] rounded-full bg-[radial-gradient(circle,rgba(255,255,255,0.06)_0%,transparent_70%)]" />

                    <div className="relative z-[1]">
                        <h2 className="mb-2 text-[2rem] font-extrabold">Ready to Get Started?</h2>
                        <p className="text-[1rem] text-ink-secondary">
                            Join thousands of developers who trust Troxe Hosting. Start for free
                            now!
                        </p>
                    </div>

                    <div className="relative z-[1] flex shrink-0 flex-wrap items-center gap-3.5 max-md:w-full max-md:flex-col max-md:[&>button]:w-full">
                        <Button size="lg" type="button" onClick={() => navigate('/signup')}>
                            Create Free Account
                        </Button>
                        <Button
                            variant="outline"
                            size="lg"
                            type="button"
                            onClick={() => navigate('/contact')}
                        >
                            Talk to Support
                        </Button>
                    </div>
                </div>
            </div>
        </section>
    );
}
