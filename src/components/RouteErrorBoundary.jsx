import { Component } from 'react';

/**
 * Catches render crashes — most importantly failed lazy route chunks
 * (a phone on a flaky network, or a stale cached chunk after a deploy).
 * Without this, one failed `import()` unmounts the entire app into a blank
 * page and the only recovery is blind refreshing.
 */
export default class RouteErrorBoundary extends Component {
    constructor(props) {
        super(props);
        this.state = { failed: false };
    }

    static getDerivedStateFromError() {
        return { failed: true };
    }

    componentDidCatch() {
        // Intentionally quiet: nothing actionable to log client-side, and the
        // fallback UI below tells the user exactly what to do.
    }

    render() {
        if (this.state.failed) {
            return (
                <div className="flex min-h-screen flex-col items-center justify-center gap-5 bg-background px-6 text-center">
                    <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-2xl bg-black p-1.5">
                        <img src="./favicon.png" alt="Troxe Hosting" className="h-full w-full object-contain" />
                    </div>
                    <div>
                        <h1 className="mb-2 text-xl font-bold text-foreground">This page didn&apos;t load</h1>
                        <p className="mx-auto max-w-md text-[0.9rem] text-ink-secondary">
                            The page files couldn&apos;t be downloaded — usually a weak connection or an app update
                            in progress. Your session is safe.
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={() => window.location.reload()}
                        className="rounded-full bg-white px-6 py-3 text-sm font-bold text-black transition hover:bg-gray-200"
                    >
                        Try again
                    </button>
                </div>
            );
        }
        return this.props.children;
    }
}
