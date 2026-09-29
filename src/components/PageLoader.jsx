/** Branded loading screen shown while a lazy page chunk loads. */
export default function PageLoader() {
    return (
        <div className="flex min-h-screen flex-col items-center justify-center gap-5 bg-background">
            <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-2xl bg-black p-1.5">
                <img src="./favicon.png" alt="Troxe Hosting" className="h-full w-full object-contain" />
            </div>
            <div
                aria-hidden="true"
                className="size-8 animate-spin rounded-full border-2 border-hairline border-t-white"
            />
            <p className="font-mono text-[0.8rem] tracking-[1.5px] text-ink-muted uppercase">
                Loading
            </p>
        </div>
    );
}
