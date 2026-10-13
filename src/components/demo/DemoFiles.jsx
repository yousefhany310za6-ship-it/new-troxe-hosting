import { useMemo, useState } from 'react';
import {
    ChevronRight,
    ChevronUp,
    FileText,
    Folder,
    FolderTree as FolderTreeIcon,
    HardDrive,
    Home,
    LayoutList,
    Search,
    X,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import { fileIcon } from '@/lib/fileIcons.js';
import { useToast } from '@/hooks/useToast.jsx';
import { DEMO_FILES } from '@/data/demoData.js';

/* Row/badge colours copied from ServerFiles.jsx `KIND_TILE`. */
const KIND_TILE = {
    dir: 'text-sky-300 bg-sky-400/10',
    code: 'text-blue-300 bg-blue-400/10',
    text: 'text-ink-secondary bg-white/[0.06]',
};

/** Which badge a demo file gets — mirrors the real manager's grouping. */
function kindOf(name) {
    if (/\.(js|jsx|mjs|cjs|ts|json|html|css)$/i.test(name)) return 'code';
    return 'text';
}

/** "Today 14:02" / "Yesterday" / "Oct 9" — same shape as ServerFiles.jsx. */
function fmtModified(iso, now) {
    if (!iso) return '—';
    const d = new Date(iso);
    const midnight = (t) => new Date(t.getFullYear(), t.getMonth(), t.getDate()).getTime();
    const days = Math.round((midnight(now) - midnight(d)) / 86400000);

    if (days === 0) {
        return `Today ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    }
    if (days === 1) return 'Yesterday';

    const sameYear = d.getFullYear() === now.getFullYear();
    return d.toLocaleDateString([], {
        month: 'short',
        day: 'numeric',
        ...(sameYear ? {} : { year: 'numeric' }),
    });
}

function fmtSize(bytes) {
    if (bytes == null) return '—';
    if (bytes < 1024) return `${Math.round(bytes)} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** '/' | 'src' | 'src/commands' -> readable segments. */
const segments = (dir) => (dir ? dir.split('/') : []);

export default function DemoFiles({ now }) {
    const toast = useToast();

    /* `files` is a local copy so anything the visitor creates below only
     * exists in this React tree — it is never uploaded anywhere. */
    const [files, setFiles] = useState(DEMO_FILES);
    const [dir, setDir] = useState('');
    const [query, setQuery] = useState('');
    const [openFile, setOpenFile] = useState(null);
    const [creating, setCreating] = useState(false);
    const [newName, setNewName] = useState('');

    const entries = files[dir] ?? [];

    const groups = useMemo(() => {
        const q = query.trim().toLowerCase();
        const matched = q ? entries.filter((e) => e.name.toLowerCase().includes(q)) : entries;
        const dirs = matched.filter((e) => e.type === 'dir').sort((a, b) => a.name.localeCompare(b.name));
        const leafs = matched.filter((e) => e.type !== 'dir').sort((a, b) => a.name.localeCompare(b.name));
        return [
            { label: 'Folders', Icon: Folder, items: dirs },
            { label: 'Files', Icon: FileText, items: leafs },
        ].filter((g) => g.items.length);
    }, [entries, query]);

    const goUp = () => {
        const parts = segments(dir);
        parts.pop();
        setDir(parts.join('/'));
        setOpenFile(null);
    };

    const enter = (name) => {
        setDir(dir ? `${dir}/${name}` : name);
        setOpenFile(null);
        setQuery('');
    };

    const createFile = () => {
        const name = newName.trim();
        if (!name) return;

        const exists = entries.some((e) => e.name === name);
        if (exists) {
            toast.error(`${name} already exists in this folder`);
            return;
        }

        setFiles((all) => ({
            ...all,
            [dir]: [
                ...(all[dir] ?? []),
                {
                    name,
                    type: 'file',
                    size: 0.3 * 1024,
                    modifiedAt: new Date().toISOString(),
                    lang: 'JavaScript',
                    body: `// ${name}\n// Created inside the Troxe interactive demo.\n// This file lives in the browser tab only — nothing was uploaded.\n\nexport default function handler() {\n  return 'hello from the demo';\n}\n`,
                },
            ],
        }));

        setNewName('');
        setCreating(false);
        toast.success(`${name} created in the demo`);
    };

    const openFileEntry = (entry) => {
        if (entry.type === 'dir') {
            enter(entry.name);
            return;
        }
        setOpenFile({ ...entry, path: dir ? `${dir}/${entry.name}` : entry.name });
    };

    // Mirrors ServerFiles.jsx:887/896 exactly — `min-h-[70vh]` on the section plus
    // no `self-start` on the rail, so the divider runs the full height instead of
    // stopping mid-panel and leaving a black gap. (A `{/* */}` child can't be the
    // first node inside `return (` — esbuild reads it as an empty JS expression.)
    return (
        <section className="relative flex min-h-[70vh] overflow-hidden rounded-2xl border border-hairline bg-card">
            <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-x-0 top-0 z-10 h-px bg-gradient-to-r from-transparent via-white/30 to-transparent"
            />

            {/* ---- folder tree (desktop only, as in production) ---- */}
            <aside className="hidden w-60 shrink-0 flex-col border-r border-hairline bg-veil/25 lg:flex">
                <div className="flex items-center gap-2 border-b border-hairline px-3.5 py-3">
                    <FolderTreeIcon size={15} className="shrink-0 text-ink-muted" aria-hidden="true" />
                    <p className="text-[0.82rem] font-bold tracking-wide">Folders</p>
                </div>
                <nav className="flex flex-col gap-1 py-1.5">
                    <button
                        type="button"
                        onClick={() => {
                            setDir('');
                            setOpenFile(null);
                        }}
                        className={cn(
                            'flex items-center gap-2 rounded-lg px-2 py-1.5 text-[0.82rem] font-medium transition',
                            dir === ''
                                ? 'bg-white/[0.09] text-foreground'
                                : 'text-ink-secondary hover:bg-white/[0.05] hover:text-foreground'
                        )}
                    >
                        <HardDrive size={14} className="shrink-0 text-ink-muted" aria-hidden="true" />
                        <span className="truncate">Storage root</span>
                    </button>

                    {segments(dir).map((seg, i, arr) => {
                        const target = arr.slice(0, i + 1).join('/');
                        const active = target === dir;
                        return (
                            <button
                                key={seg}
                                type="button"
                                onClick={() => {
                                    setDir(target);
                                    setOpenFile(null);
                                }}
                                className={cn(
                                    'flex items-center gap-2 rounded-lg py-1.5 text-left text-[0.82rem] font-medium transition',
                                    active
                                        ? 'bg-white/[0.09] text-foreground'
                                        : 'text-ink-secondary hover:bg-white/[0.05] hover:text-foreground'
                                )}
                                style={{ paddingLeft: `${i * 10 + 8}px` }}
                            >
                                <Folder size={14} className="shrink-0" aria-hidden="true" />
                                <span className="truncate">{seg}</span>
                            </button>
                        );
                    })}
                </nav>
                <div className="border-t border-hairline px-3 py-2.5">
                    <p className="text-[0.68rem] leading-relaxed text-ink-muted">
                        Read-only copy of a sample project. Nothing here is connected to a real container.
                    </p>
                </div>
            </aside>

            {/* ---- main pane ---- */}
            <div className="flex min-w-0 flex-1 self-stretch flex-col">
                {/* toolbar */}
                <div className="flex flex-col gap-2.5 border-b border-hairline px-3 py-2.5 sm:px-4">
                    <div className="flex items-center gap-1.5">
                        <nav
                            aria-label="Breadcrumb"
                            className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto rounded-xl bg-veil/40 px-2 py-1 whitespace-nowrap [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                        >
                            <button
                                type="button"
                                onClick={() => {
                                    setDir('');
                                    setOpenFile(null);
                                }}
                                className="flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 font-mono text-[0.82rem] font-bold transition hover:bg-veil"
                            >
                                <Home size={14} className="text-ink-secondary" aria-hidden="true" />
                                <span className="hidden sm:inline">root</span>
                            </button>
                            {dir && (
                                <button
                                    type="button"
                                    onClick={goUp}
                                    aria-label="Up one folder"
                                    className="flex shrink-0 items-center rounded-md p-1.5 text-ink-secondary transition hover:bg-veil hover:text-foreground"
                                >
                                    <ChevronUp size={14} />
                                </button>
                            )}
                            {segments(dir).map((seg, i, arr) => (
                                <span key={seg} className="flex shrink-0 items-center gap-0.5">
                                    <ChevronRight size={13} className="text-ink-muted" aria-hidden="true" />
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setDir(arr.slice(0, i + 1).join('/'));
                                            setOpenFile(null);
                                        }}
                                        className={cn(
                                            'max-w-32 truncate rounded-md px-1.5 py-1 font-mono text-[0.82rem] transition hover:bg-veil',
                                            i === arr.length - 1 ? 'font-bold text-foreground' : 'text-ink-secondary'
                                        )}
                                    >
                                        {seg}
                                    </button>
                                </span>
                            ))}
                        </nav>

                        <span className="hidden shrink-0 rounded-full border border-amber-500/25 bg-amber-500/10 px-2.5 py-1 text-[0.68rem] font-semibold text-amber-300 sm:inline-block">
                            Demo filesystem
                        </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                        <div className="relative min-w-[150px] flex-1">
                            <Search
                                size={14}
                                className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-muted"
                                aria-hidden="true"
                            />
                            <input
                                value={query}
                                onChange={(e) => setQuery(e.target.value)}
                                placeholder="Search files"
                                aria-label="Search demo files"
                                className="input-field pl-9"
                            />
                            {query && (
                                <button
                                    type="button"
                                    onClick={() => setQuery('')}
                                    aria-label="Clear search"
                                    className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-1 text-ink-muted hover:text-foreground"
                                >
                                    <X size={14} />
                                </button>
                            )}
                        </div>

                        <button
                            type="button"
                            onClick={() => setCreating(true)}
                            title="Creates a file in this browser tab only"
                            className="inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-hairline bg-white/[0.06] px-4 py-2 text-[0.8rem] font-semibold text-ink-secondary transition hover:border-hairline-hover hover:bg-white/[0.1] hover:text-foreground"
                        >
                            <FileText size={15} aria-hidden="true" />
                            New file
                        </button>
                    </div>
                </div>

                {/* ---- content ---- */}
                <div className="flex-1">
                    {creating && (
                        <div className="flex flex-wrap items-center gap-2 border-b border-hairline bg-veil/25 px-4 py-3">
                            <label htmlFor="demo-new-file" className="text-[0.8rem] font-semibold text-ink-secondary">
                                New file in <code className="font-mono text-foreground">/{dir || 'root'}</code>
                            </label>
                            <input
                                id="demo-new-file"
                                value={newName}
                                onChange={(e) => setNewName(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter') createFile();
                                    if (e.key === 'Escape') {
                                        setCreating(false);
                                        setNewName('');
                                    }
                                }}
                                placeholder="hello.js"
                                autoFocus
                                spellCheck={false}
                                className="input-field w-auto min-w-[140px] flex-1 font-mono"
                            />
                            <button
                                type="button"
                                onClick={createFile}
                                className="inline-flex min-h-10 items-center rounded-xl bg-white px-4 py-2 text-[0.8rem] font-bold text-black transition hover:bg-gray-200"
                            >
                                Create
                            </button>
                            <button
                                type="button"
                                onClick={() => {
                                    setCreating(false);
                                    setNewName('');
                                }}
                                className="inline-flex min-h-10 items-center rounded-xl border border-hairline px-4 py-2 text-[0.8rem] font-semibold text-ink-secondary transition hover:text-foreground"
                            >
                                Cancel
                            </button>
                        </div>
                    )}

                    {openFile ? (
                        <div className="flex h-full flex-col bg-[#0a0a0d]">
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-2 border-b border-hairline bg-card px-3 py-2.5 sm:px-4">
                                <button
                                    type="button"
                                    onClick={() => setOpenFile(null)}
                                    aria-label="Back to file list"
                                    className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg text-ink-secondary transition hover:bg-white/10 hover:text-foreground"
                                >
                                    <ChevronUp size={18} className="-rotate-90" />
                                </button>
                                <span className="min-w-0 flex-1 basis-40 leading-tight">
                                    <span className="block truncate font-mono text-[0.85rem] font-semibold">
                                        {openFile.path}
                                    </span>
                                    <span className="block truncate font-mono text-[0.68rem] text-ink-muted">
                                        {fmtSize(openFile.size)} · preview only
                                    </span>
                                </span>
                                {openFile.lang && (
                                    <span className="hidden shrink-0 rounded-full border border-hairline bg-veil px-2.5 py-0.5 text-[0.68rem] font-semibold text-ink-secondary md:inline-block">
                                        {openFile.lang}
                                    </span>
                                )}
                            </div>
                            <pre className="max-h-[420px] overflow-auto px-4 py-3 font-mono text-[0.76rem] leading-[1.6] whitespace-pre-wrap text-ink-secondary">
                                {openFile.body ?? '// This demo file has no preview content.'}
                            </pre>
                        </div>
                    ) : groups.length ? (
                        <div className="flex flex-col p-3 sm:p-4">
                            {groups.map((group) => (
                                <div key={group.label} className="mb-4 last:mb-0">
                                    <div className="mb-1.5 flex items-center gap-2 px-1">
                                        <group.Icon size={13} className="text-ink-muted" aria-hidden="true" />
                                        <p className="text-[0.7rem] font-bold tracking-[0.14em] text-ink-muted uppercase">
                                            {group.label}
                                        </p>
                                        <span className="font-mono text-[0.68rem] text-ink-muted tabular-nums">
                                            {group.items.length}
                                        </span>
                                    </div>

                                    <div className="overflow-hidden rounded-xl border border-hairline">
                                        <div className="hidden items-center gap-3 border-b border-hairline bg-veil/30 px-3 py-1.5 sm:flex">
                                            <span className="w-[18px] shrink-0" />
                                            <span className="flex-1 text-[0.66rem] font-bold tracking-wide text-ink-muted uppercase">
                                                Name
                                            </span>
                                            <span className="w-20 shrink-0 text-right text-[0.66rem] font-bold tracking-wide text-ink-muted uppercase">
                                                Size
                                            </span>
                                            <span className="hidden w-32 shrink-0 text-right text-[0.66rem] font-bold tracking-wide text-ink-muted uppercase sm:block">
                                                Modified
                                            </span>
                                        </div>

                                        {group.items.map((entry) => {
                                            const isDir = entry.type === 'dir';
                                            const icon = fileIcon(entry.name, entry.type);
                                            return (
                                                <button
                                                    key={entry.name}
                                                    type="button"
                                                    onClick={() => openFileEntry(entry)}
                                                    className="group flex w-full items-center gap-3 border-b border-hairline/60 px-3 py-2 text-left transition duration-150 select-none last:border-b-0 hover:bg-white/[0.05] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/40"
                                                >
                                                    <span className="w-[18px] shrink-0" />
                                                    <span
                                                        className={cn(
                                                            'flex size-9 shrink-0 items-center justify-center rounded-lg',
                                                            isDir ? KIND_TILE.dir : KIND_TILE[kindOf(entry.name)]
                                                        )}
                                                    >
                                                        {isDir ? (
                                                            <Folder size={18} />
                                                        ) : icon ? (
                                                            <img src={icon} alt="" aria-hidden="true" className="size-5" draggable={false} />
                                                        ) : (
                                                            <FileText size={17} />
                                                        )}
                                                    </span>

                                                    <span className="min-w-0 flex-1">
                                                        <span className="block truncate text-[0.88rem] font-medium">
                                                            {entry.name}
                                                        </span>
                                                        <span className="mt-0.5 block truncate font-mono text-[0.66rem] text-ink-muted sm:hidden">
                                                            {isDir ? 'Folder' : `${fmtSize(entry.size)} · ${fmtModified(entry.modifiedAt, now)}`}
                                                        </span>
                                                    </span>

                                                    <span className="w-20 shrink-0 text-right font-mono text-[0.74rem] text-ink-secondary tabular-nums">
                                                        {isDir ? <span className="text-ink-muted">—</span> : fmtSize(entry.size)}
                                                    </span>
                                                    <span className="hidden w-32 shrink-0 text-right font-mono text-[0.7rem] text-ink-muted sm:block">
                                                        {fmtModified(entry.modifiedAt, now)}
                                                    </span>
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className="flex flex-col items-center gap-3 px-4 py-12 text-center">
                            {query ? (
                                <Search size={28} className="text-ink-muted" aria-hidden="true" />
                            ) : (
                                <Folder size={34} className="text-ink-muted" aria-hidden="true" />
                            )}
                            <p className="text-[0.95rem] font-semibold">
                                {query ? 'No files match that search' : 'This folder is empty'}
                            </p>
                            <p className="max-w-xs text-[0.84rem] text-ink-secondary">
                                {query
                                    ? 'Try a different name, or clear the search to see everything in this folder.'
                                    : 'Demo folders are pre-populated, but you can create a file to try the flow.'}
                            </p>
                            {query && (
                                <button
                                    type="button"
                                    onClick={() => setQuery('')}
                                    className="inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-hairline bg-white/[0.06] px-4 py-2 text-[0.8rem] font-semibold text-ink-secondary transition hover:text-foreground"
                                >
                                    Clear search
                                </button>
                            )}
                        </div>
                    )}
                </div>

                {/* ---- bottom dock ---- */}
                <div className="flex flex-wrap items-center gap-2 border-t border-hairline bg-veil/25 px-4 py-2.5">
                    <LayoutList size={14} className="shrink-0 text-ink-muted" aria-hidden="true" />
                    <p className="min-w-0 flex-1 truncate text-[0.74rem] text-ink-secondary">
                        {entries.length} entries in <code className="font-mono">/{dir || 'root'}</code> · preview only,
                        no uploads in the demo
                    </p>
                </div>
            </div>
        </section>
    );
}