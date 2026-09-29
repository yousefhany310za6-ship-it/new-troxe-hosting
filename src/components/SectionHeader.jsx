/** Shared "tag + title + subtitle" block used by the content sections. */
export default function SectionHeader({ tag, title, subtitle }) {
    return (
        <div className="mb-14 text-center">
            <span className="mb-5 inline-block rounded-full border border-hairline bg-veil px-[14px] py-[5px] text-[0.72rem] font-semibold tracking-[1.4px] text-ink-muted uppercase">
                {tag}
            </span>
            <h2 className="mb-4 text-[2.25rem] font-bold leading-[1.2] tracking-[-0.02em] text-foreground max-md:text-[1.8rem]">
                {title}
            </h2>
            {subtitle && (
                <p className="mx-auto max-w-[540px] text-[1rem] text-ink-secondary">{subtitle}</p>
            )}
        </div>
    );
}
