import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Eraser, Loader2, Terminal as TerminalIcon } from 'lucide-react';

import { cn } from '@/lib/utils';
import { DEMO_COMMANDS, DEMO_COMMAND_LIST, DEMO_LOG_SEED } from '@/data/demoData.js';
import { useToast } from '@/hooks/useToast.jsx';

/* Console chrome copied from ExecTerminal.jsx. */
const TERM_BG = '#07070a';
const FONT_STACK =
    "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, 'Noto Sans Arabic', 'Segoe UI', Tahoma, monospace";

const iconBtn =
    'inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-ink-secondary transition hover:bg-white/10 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-35';

const chipCls =
    'inline-flex items-center gap-1.5 rounded-full border border-hairline bg-veil px-3 py-1 font-mono text-[0.74rem] font-semibold text-ink-secondary transition hover:border-hairline-hover hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40';

export default function DemoConsole({ server, metrics, onStatusAction, reduced }) {
    const toast = useToast();

    const [lines, setLines] = useState(() => DEMO_LOG_SEED);
    const [value, setValue] = useState('');
    const [history, setHistory] = useState([]);
    const [cursor, setCursor] = useState(-1);
    const [pending, setPending] = useState(null);
    const [pickerOpen, setPickerOpen] = useState(false);

    const scrollRef = useRef(null);
    const inputRef = useRef(null);
    const timerRef = useRef(null);
    const pickerRef = useRef(null);

    /* Timers are cleared on unmount AND whenever a new command starts, so a
     * scheduled simulated response can never fire into an unmounted tree. */
    useEffect(
        () => () => {
            if (timerRef.current) clearTimeout(timerRef.current);
        },
        []
    );

    /* Keep the newest line in view. */
    useEffect(() => {
        const el = scrollRef.current;
        if (!el) return;
        el.scrollTop = el.scrollHeight;
    }, [lines, pending]);

    /* Dismiss the command picker on outside click / Escape. */
    useEffect(() => {
        if (!pickerOpen) return undefined;
        const onDown = (e) => {
            if (pickerRef.current && !pickerRef.current.contains(e.target)) setPickerOpen(false);
        };
        const onKey = (e) => {
            if (e.key === 'Escape') setPickerOpen(false);
        };
        document.addEventListener('mousedown', onDown);
        document.addEventListener('keydown', onKey);
        return () => {
            document.removeEventListener('mousedown', onDown);
            document.removeEventListener('keydown', onKey);
        };
    }, [pickerOpen]);

    const run = useCallback(
        (raw) => {
            const cmd = String(raw ?? '').trim().toLowerCase();
            if (!cmd || pending) return;

            setValue('');
            setCursor(-1);
            setHistory((h) => [cmd, ...h].slice(0, 12));

            if (cmd === 'clear') {
                setLines([]);
                toast.info('Console cleared');
                return;
            }

            const entry = DEMO_COMMANDS[cmd];
            if (!entry) {
                setLines((l) => [
                    ...l,
                    { text: `${DEMO_PROMPT} ${cmd}`, lvl: null },
                    { text: `command not found: ${cmd} — try "help"`, lvl: 'error' },
                ]);
                return;
            }

            const out = typeof entry.lines === 'function' ? entry.lines({ server, m: metrics }) : [];

            /* Lifecycle commands flip the shared demo status so the Overview,
             * sidebar and header all stay in sync. Nothing is sent anywhere. */
            if (cmd === 'start' || cmd === 'stop' || cmd === 'restart') onStatusAction(cmd);

            const emit = () => {
                setPending(null);
                setLines((l) => [...l, { text: `${DEMO_PROMPT} ${cmd}`, lvl: null }, ...out]);
                inputRef.current?.focus();
            };

            if (entry.delay && !reduced) {
                setPending(cmd);
                timerRef.current = setTimeout(emit, entry.delay);
            } else {
                emit();
            }
        },
        [metrics, onStatusAction, pending, reduced, server, toast]
    );

    const onKeyDown = (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            run(value);
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            const next = Math.min(cursor + 1, history.length - 1);
            if (next >= 0) {
                setCursor(next);
                setValue(history[next]);
            }
        } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            const next = cursor - 1;
            setCursor(next);
            setValue(next >= 0 ? history[next] : '');
        }
    };

    const statusTone = useMemo(() => {
        if (pending) return { ring: 'border-amber-500/25 bg-amber-500/10', text: 'text-amber-300', dot: 'animate-beat bg-amber-500', label: 'Working…' };
        if (server.status === 'online') return { ring: 'border-emerald-500/25 bg-emerald-500/10', text: 'text-emerald-300', dot: 'animate-beat bg-emerald-500', label: 'Demo stream' };
        if (server.status === 'restarting') return { ring: 'border-amber-500/25 bg-amber-500/10', text: 'text-amber-300', dot: 'animate-beat bg-amber-500', label: 'Restarting…' };
        return { ring: 'border-hairline bg-veil', text: 'text-ink-secondary', dot: 'bg-zinc-500', label: 'Stopped' };
    }, [pending, server.status]);

    return (
        <section
            className="flex flex-col overflow-hidden rounded-xl border border-hairline shadow-[0_8px_40px_-12px_rgba(0,0,0,0.8)]"
            style={{ backgroundColor: TERM_BG }}
        >
            {/* ---- header bar ---- */}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-hairline bg-card px-4 py-2.5">
                <TerminalIcon className="size-4 shrink-0 text-ink-muted" aria-hidden="true" />
                <h3 className="text-[0.85rem] font-semibold">Console</h3>

                <span
                    className={cn(
                        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[0.72rem] font-semibold',
                        statusTone.ring,
                        statusTone.text
                    )}
                >
                    <span className={cn('size-1.5 rounded-full', statusTone.dot)} />
                    {statusTone.label}
                </span>

                <div className="ml-auto flex items-center gap-0.5">
                    <button
                        type="button"
                        title="Clear console"
                        aria-label="Clear console"
                        onClick={() => {
                            setLines([]);
                            toast.info('Console cleared');
                        }}
                        className={iconBtn}
                    >
                        <Eraser className="size-4" />
                    </button>
                </div>
            </div>

            {/* ---- simulated-output notice ---- */}
            <p className="flex items-center gap-2 border-b border-hairline bg-veil/25 px-4 py-2 text-[0.74rem] text-ink-secondary">
                <Loader2 className="size-3.5 shrink-0" aria-hidden="true" />
                <span>
                    Scripted demo output. No shell, Docker socket or remote server is involved — commands are
                    matched against a fixed list.
                </span>
            </p>

            {/* ---- log body ---- */}
            <div
                ref={scrollRef}
                className="troxe-log relative h-[min(46vh,420px)] min-h-[240px] overflow-y-auto px-4 py-3 text-[0.78rem] leading-[1.5] sm:text-[0.8rem]"
                style={{ fontFamily: FONT_STACK }}
                role="log"
                aria-live="polite"
                aria-label="Demo console output"
                onClick={() => inputRef.current?.focus()}
            >
                {!lines.length && (
                    <p className="text-ink-muted">Console cleared. Type `help` to see the available commands.</p>
                )}
                {lines.map((l, i) => (
                    <div key={i} dir="auto" className={cn('troxe-log-line', l.lvl && `lvl-${l.lvl}`)}>
                        {l.text}
                    </div>
                ))}
                {pending && (
                    <div dir="auto" className="troxe-log-line lvl-sys">
                        {DEMO_PROMPT} {pending}
                        <span className="ml-1 inline-block animate-blink">█</span>
                    </div>
                )}
            </div>

            {/* ---- input row ---- */}
            <div className="flex flex-wrap items-center gap-2 border-t border-hairline bg-card px-3 py-2.5">
                <div ref={pickerRef} className="relative">
                    <button
                        type="button"
                        aria-expanded={pickerOpen}
                        aria-haspopup="listbox"
                        onClick={() => setPickerOpen((v) => !v)}
                        className={cn(chipCls, 'pr-2')}
                    >
                        Demo commands
                        <ChevronDown className={cn('size-3.5 transition-transform', pickerOpen && 'rotate-180')} />
                    </button>

                    {pickerOpen && (
                        <div
                            role="listbox"
                            aria-label="Demo commands"
                            className="absolute bottom-full left-0 z-20 mb-2 max-h-64 w-56 overflow-y-auto rounded-xl border border-hairline bg-card py-1 shadow-2xl"
                        >
                            {DEMO_COMMAND_LIST.map((cmd) => (
                                <button
                                    key={cmd}
                                    type="button"
                                    role="option"
                                    aria-selected={value === cmd}
                                    onClick={() => {
                                        setValue(cmd);
                                        setPickerOpen(false);
                                        inputRef.current?.focus();
                                    }}
                                    className="flex w-full items-baseline gap-2 px-3 py-2 text-left transition hover:bg-veil"
                                >
                                    <code className="font-mono text-[0.8rem] font-bold text-foreground">{cmd}</code>
                                    <span className="truncate text-[0.72rem] text-ink-muted">
                                        {DEMO_COMMANDS[cmd].summary}
                                    </span>
                                </button>
                            ))}
                        </div>
                    )}
                </div>

                <label className="flex min-w-0 flex-1 items-center gap-2 rounded-xl border border-hairline bg-veil/40 px-3 py-1.5 focus-within:border-hairline-hover">
                    <span className="shrink-0 font-mono text-[0.76rem] text-ink-muted" style={{ fontFamily: FONT_STACK }}>
                        {DEMO_PROMPT}
                    </span>
                    <input
                        ref={inputRef}
                        value={value}
                        onChange={(e) => setValue(e.target.value)}
                        onKeyDown={onKeyDown}
                        disabled={!!pending}
                        spellCheck={false}
                        autoComplete="off"
                        aria-label="Demo console command"
                        placeholder={pending ? 'working…' : 'type a command, e.g. status'}
                        className="min-w-0 flex-1 bg-transparent py-1 font-mono text-[0.78rem] text-foreground placeholder:text-ink-muted focus:outline-none disabled:opacity-60"
                        style={{ fontFamily: FONT_STACK }}
                    />
                    <button
                        type="button"
                        onClick={() => run(value)}
                        disabled={!value.trim() || !!pending}
                        className="shrink-0 rounded-md border border-hairline px-2.5 py-1 text-[0.7rem] font-bold text-ink-secondary transition hover:border-hairline-hover hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
                    >
                        Run
                    </button>
                </label>
            </div>

            {/* ---- footer bar ---- */}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-hairline bg-card px-4 py-2 font-mono text-[0.7rem] text-ink-muted">
                <span>/data@{server.name}</span>
                <span>{lines.length.toLocaleString()} lines</span>
                <span className="ml-auto">↑↓ history · Enter run · clear clears</span>
            </div>
        </section>
    );
}

/** Prompt prefix, deliberately fake so nobody types a real command at it. */
const DEMO_PROMPT = 'demo@troxe:~$';