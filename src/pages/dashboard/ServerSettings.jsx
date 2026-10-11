import { useEffect, useState } from 'react';
import { Save, Server as ServerIcon } from 'lucide-react';

import { apiPatch } from '@/lib/api.js';
import RuntimeSwitcher from '@/components/dashboard/RuntimeSwitcher.jsx';
import { cn } from '@/lib/utils';

const inputClass =
    'w-full rounded-xl border border-hairline bg-white/10 px-4 py-2.5 text-[0.88rem] text-foreground placeholder-ink-muted transition focus:border-primary focus:ring-2 focus:ring-ring/40 focus:outline-none';

const labelClass = 'mb-1.5 block text-[0.85rem] font-semibold text-foreground';
const hintClass = 'mt-1.5 text-[0.75rem] text-ink-muted';

/**
 * General server settings: identity + entry point. Startup command and
 * environment variables live on their own tab (ServerStartup), so this page is
 * only about "what is this server and what file runs it".
 */
export default function ServerSettings({ server, onSaved, onTab }) {
    const [name, setName] = useState('');
    const [mainFile, setMainFile] = useState('');
    const [autoRestart, setAutoRestart] = useState(true);
    const [busy, setBusy] = useState(false);
    const [msg, setMsg] = useState(null);

    useEffect(() => {
        if (!server) return;
        setName(server.name ?? '');
        setMainFile(server.mainFile ?? '');
        setAutoRestart(server.autoRestart ?? true);
    }, [server?.id, server?.name, server?.mainFile, server?.autoRestart]);

    const dirty =
        !!server &&
        (name.trim() !== (server.name ?? '') ||
            mainFile.trim() !== (server.mainFile ?? '') ||
            autoRestart !== (server.autoRestart ?? true));

    const save = async (e) => {
        e.preventDefault();
        if (!name.trim()) return setMsg({ text: 'Server name is required.', ok: false });
        if (!mainFile.trim()) return setMsg({ text: 'Main file is required — it is the file the platform runs.', ok: false });
        setBusy(true);
        setMsg(null);
        try {
            await apiPatch(`/servers/${server.id}`, {
                name: name.trim(),
                mainFile: mainFile.trim(),
                autoRestart,
            });
            setMsg({ text: 'Settings saved. Restart the server to apply the new entry point.', ok: true });
            onSaved?.();
        } catch (err) {
            setMsg({ text: err.message, ok: false });
        } finally {
            setBusy(false);
        }
    };

    if (!server) return null;

    return (
        <form onSubmit={save} className="flex flex-col gap-5 rounded-2xl border border-hairline bg-card p-5 sm:p-6">
            <header className="flex items-center gap-2.5">
                <ServerIcon className="size-4 text-ink-muted" aria-hidden="true" />
                <h2 className="text-[0.95rem] font-semibold">Server settings</h2>
            </header>

            <div className="grid gap-5 sm:grid-cols-2">
                <label className="block">
                    <span className={labelClass}>Server name</span>
                    <input value={name} onChange={(e) => setName(e.target.value)} className={inputClass} maxLength={32} />
                    <span className={hintClass}>3–32 characters: lowercase letters, digits and dashes.</span>
                </label>

                <label className="block">
                    <span className={labelClass}>Main file</span>
                    <input
                        value={mainFile}
                        onChange={(e) => setMainFile(e.target.value)}
                        className={cn(inputClass, 'font-mono')}
                        placeholder="index.js"
                        maxLength={160}
                        dir="ltr"
                    />
                    <span className={hintClass}>
                        The entry point relative to the server root, e.g. <code className="font-mono">index.js</code> or{' '}
                        <code className="font-mono">src/main.py</code>. It is applied through the startup command, so it stays
                        in sync with <code className="font-mono">MAIN_FILE</code>.
                    </span>
                </label>
            </div>

            <label className="flex cursor-pointer items-center gap-2.5 text-[0.88rem] font-semibold">
                <input
                    type="checkbox"
                    checked={autoRestart}
                    onChange={(e) => setAutoRestart(e.target.checked)}
                    className="size-4 accent-white"
                />
                Restart automatically if the process exits
            </label>

            <RuntimeSwitcher server={server} onChanged={onSaved} />

            <div className="flex flex-wrap items-center gap-3 border-t border-hairline pt-4">
                <button
                    type="submit"
                    disabled={busy || !dirty}
                    className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-[0.84rem] font-bold text-black transition hover:bg-white/90 disabled:opacity-40"
                >
                    <Save className="size-4" aria-hidden="true" />
                    {busy ? 'Saving…' : 'Save settings'}
                </button>
                <button
                    type="button"
                    onClick={() => onTab?.('startup')}
                    className="text-[0.82rem] font-bold text-ink-secondary underline decoration-dotted transition hover:text-foreground"
                >
                    Go to Startup settings
                </button>
                {msg && (
                    <span className={cn('text-[0.8rem]', msg.ok ? 'text-emerald-300' : 'text-red-300')} role="status">
                        {msg.text}
                    </span>
                )}
            </div>
        </form>
    );
}
