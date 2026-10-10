import { Link } from 'react-router-dom';
import { ArrowRight, MessageSquare } from 'lucide-react';

import { Button } from '../ui/button.jsx';

/**
 * Closing call to action. Both buttons go to real routes; the secondary one
 * opens a support ticket for signed-in users and the contact page otherwise.
 */
export default function Cta() {
    return (
        <section id="cta" className="relative overflow-hidden border-t border-hairline bg-[color:var(--surface-0)] py-20">
            <div aria-hidden="true" className="pointer-events-none absolute inset-0">
                <div className="grid-pattern absolute inset-0 opacity-60" />
                <div className="absolute bottom-[-220px] left-1/2 h-[420px] w-[720px] -translate-x-1/2 rounded-full bg-[color:var(--lime)] opacity-[0.07] blur-[120px]" />
            </div>

            <div className="container-page relative">
                <div className="mx-auto max-w-[620px] text-center">
                    <h2 className="text-[1.7rem] leading-[1.18] font-extrabold tracking-[-0.03em] text-foreground min-[400px]:text-[1.95rem] sm:text-[2.3rem] lg:text-[2.5rem]">
                        Put your project on a server that stays up
                    </h2>
                    <p className="mx-auto mt-4 max-w-[520px] text-[0.98rem] leading-[1.7] text-ink-secondary">
                        Create an account, deploy your first server in a couple of minutes, and watch it from one
                        dashboard. Free to start.
                    </p>
                    <div className="mt-9 flex flex-wrap items-center justify-center gap-3 max-[480px]:flex-col max-[480px]:items-stretch">
                        <Button asChild size="lg" className="accent-cta border-0 hover:bg-[color:var(--lime-strong)]">
                            <Link to="/signup">
                                Create your account
                                <ArrowRight className="size-4" aria-hidden="true" />
                            </Link>
                        </Button>
                        <Button asChild variant="outline" size="lg">
                            <Link to="/contact">
                                <MessageSquare className="size-4" aria-hidden="true" />
                                Talk to us
                            </Link>
                        </Button>
                    </div>
                    <p className="mt-6 text-[0.8rem] text-ink-muted">
                        No card for the free plan · Cancel a paid plan from the dashboard
                    </p>
                </div>
            </div>
        </section>
    );
}
