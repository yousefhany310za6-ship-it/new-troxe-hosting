import { forwardRef, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { cn } from '@/lib/utils.js';

/**
 * Labeled form field with inline error + hint. Wraps any control via children
 * or renders a plain input when `inputProps` is passed.
 */
export function Field({ label, hint, error, children, htmlFor, className }) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      {label && (
        <label htmlFor={htmlFor} className="text-[0.82rem] font-medium text-ink-secondary">
          {label}
        </label>
      )}
      {children}
      {error ? (
        <p className="text-[0.78rem] text-red-400" role="alert">{error}</p>
      ) : hint ? (
        <p className="text-[0.78rem] text-ink-muted">{hint}</p>
      ) : null}
    </div>
  );
}

export const Input = forwardRef(function Input({ invalid, className, ...props }, ref) {
  return (
    <input
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cn('input-field', className)}
      {...props}
    />
  );
});

/** Password input with visibility toggle. */
export const PasswordInput = forwardRef(function PasswordInput({ invalid, className, ...props }, ref) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <input
        ref={ref}
        type={show ? 'text' : 'password'}
        aria-invalid={invalid || undefined}
        className={cn('input-field pr-10', className)}
        {...props}
      />
      <button
        type="button"
        tabIndex={-1}
        onClick={() => setShow((s) => !s)}
        aria-label={show ? 'Hide password' : 'Show password'}
        className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-ink-muted transition-colors hover:text-ink"
      >
        {show ? <EyeOff size={16} /> : <Eye size={16} />}
      </button>
    </div>
  );
});

/** Thin skeleton bar for loading states. */
export function Skeleton({ className }) {
  return <div className={cn('animate-pulse rounded-md bg-veil', className)} />;
}
