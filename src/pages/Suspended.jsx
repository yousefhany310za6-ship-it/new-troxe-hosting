import { Link } from 'react-router-dom';
import { Ban, Mail } from 'lucide-react';

import Navbar from '../components/Navbar.jsx';
import Footer from '../components/Footer.jsx';

/**
 * Account Suspended: shown after a suspended login attempt, an OAuth
 * `suspended` callback, or a mid-session suspension (global 403 handler
 * signs the session out and lands here). No account data is displayed.
 */
export default function Suspended() {
  return (
    <div className="relative min-h-screen overflow-hidden bg-background text-foreground">
      <Navbar />
      <main className="container-page relative z-10 pt-28 pb-16">
        <div className="mx-auto flex w-full max-w-lg flex-col items-center rounded-3xl border border-red-500/25 bg-card p-10 text-center shadow-2xl sm:p-12">
          <span className="flex size-16 items-center justify-center rounded-2xl border border-red-500/30 bg-red-500/10 text-red-300">
            <Ban className="size-8" />
          </span>
          <h1 className="mt-5 text-[1.5rem] font-extrabold">Account Suspended</h1>
          <p className="mt-2 text-[0.9rem] leading-relaxed text-ink-secondary">
            Your account has been suspended by the administration. If you believe this is a mistake, please contact
            support.
          </p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-2.5">
            <Link
              to="/contact"
              className="inline-flex items-center gap-2 rounded-full bg-white px-5 py-2.5 text-[0.85rem] font-bold text-black transition hover:bg-gray-200"
            >
              <Mail className="size-4" /> Contact Support
            </Link>
            <Link
              to="/"
              className="inline-flex items-center gap-2 rounded-full border border-hairline bg-veil px-5 py-2.5 text-[0.85rem] font-semibold text-ink-secondary transition hover:text-foreground"
            >
              Back to home
            </Link>
          </div>
        </div>
      </main>
      <div className="relative z-10">
        <Footer className="bg-transparent" />
      </div>
    </div>
  );
}
