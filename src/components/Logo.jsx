import { Link } from 'react-router-dom';

import { cn } from '@/lib/utils';

export function Logo({ className }) {
    return (
        <Link to="/" className={cn('flex shrink-0 items-center gap-2.5', className)}>
            <div className="flex size-[38px] items-center justify-center overflow-hidden rounded-sm bg-black p-1 font-mono text-xl font-black text-foreground">
                <img src="./favicon.png" alt="" className="size-full object-contain" />
            </div>
            <span className="text-xl font-extrabold text-foreground">
                Troxe <span className="font-semibold text-ink-muted">Host</span>
            </span>
        </Link>
    );
}

export default Logo;
