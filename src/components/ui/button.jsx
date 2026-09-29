import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva } from 'class-variance-authority';

import { cn } from '@/lib/utils';

const buttonVariants = cva(
    "inline-flex cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-sm text-[0.95rem] font-bold transition outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0",
    {
        variants: {
            variant: {
                default:
                    'bg-primary text-primary-foreground shadow-[0_4px_15px_rgba(0,0,0,0.5)] hover:-translate-y-0.5 hover:bg-[#e4e4e7] hover:shadow-[0_6px_20px_rgba(0,0,0,0.6)]',
                outline:
                    'border-[1.5px] border-border bg-transparent text-foreground hover:-translate-y-0.5 hover:border-primary hover:bg-primary hover:text-primary-foreground',
                ghost: 'bg-transparent text-ink-secondary hover:bg-veil hover:text-foreground',
                link: 'text-foreground underline-offset-4 hover:underline',
            },
            size: {
                default: 'px-[22px] py-[10px]',
                lg: 'px-[30px] py-[14px] text-[1.05rem]',
                sm: 'px-4 py-2 text-[0.85rem]',
                icon: 'size-9',
            },
        },
        defaultVariants: {
            variant: 'default',
            size: 'default',
        },
    }
);

function Button({ className, variant, size, asChild = false, ...props }) {
    const Comp = asChild ? Slot : 'button';

    return (
        <Comp
            data-slot="button"
            className={cn(buttonVariants({ variant, size }), className)}
            {...props}
        />
    );
}

export { Button, buttonVariants };
