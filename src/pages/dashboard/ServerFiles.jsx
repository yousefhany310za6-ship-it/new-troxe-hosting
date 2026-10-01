import { useEffect, useRef, useState } from 'react';
import {
    Archive,
    ArrowLeft,
    Check,
    ChevronRight,
    Download,
    FileArchive,
    FileText,
    Folder,
    MoreHorizontal,
    Plus,
    Trash2,
    Upload,
    X,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/useToast.jsx';
import {
    blobToBase64,
    downloadServerFile,
    uploadServerFile,
    useArchiveFiles,
    useDeleteFile,
    useExtractFiles,
    useFileContent,
    useMkdir,
    useRenameFile,
    useServerFiles,
    useWriteFile,
} from '@/hooks/useQueries.jsx';

const actionBtn =
    'inline-flex items-center gap-1.5 rounded-md border border-hairline bg-veil px-3 py-1.5 text-[0.8rem] font-semibold text-ink-secondary transition hover:border-hairline-hover hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40';
const inputClass =
    'w-full rounded-xl border border-hairline bg-white/10 px-4 py-2.5 text-[0.88rem] text-foreground placeholder-ink-muted transition focus:border-primary focus:ring-2 focus:ring-ring/40 focus:outline-none';
const menuItem =
    'flex w-full items-center gap-2 px-4 py-2 text-left text-[0.83rem] font-semibold text-ink-secondary transition hover:bg-veil hover:text-foreground disabled:opacity-40';

const EDIT_MAX = 512 * 1024;
const UPLOAD_MAX = 2 * 1024 * 1024;
const ARCHIVE_RE = /\.(zip|tar\.gz|tgz|tar)$/i;
const MEDIA_RE = /\.(png|jpe?g|gif|webp|ico|bmp|mp4|webm|mov|mp3|wav|ogg|pdf|woff2?|ttf|eot|exe|dll|so|bin|dat|db|sqlite|mpkg|dmg|iso)$/i;

const fmtSize = (b) => {
    if (!b) return '—';
    const u = ['B', 'KB', 'MB', 'GB'];
    let i = 0, v = b;
    while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
    return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${u[i]}`;
};

function join(segs) { return segs.filter((s) => s !== '').join('/'); }

/** A file the editor is allowed to open (text-ish, within the edit cap). */
function openable(entry) {
    if (!entry || entry.type !== 'file') return false;
    if (ARCHIVE_RE.test(entry.name) || MEDIA_RE.test(entry.name)) return false;
    if (entry.size > EDIT_MAX) return false;
    return true;
}

function RowMenu({ entry, isDir, isArchiveFile, onAction, disabled }) {
    const [open, setOpen] = useState(false);
    const [pos, setPos] = useState({ top: 0, left: 0, up: false });
    const btnRef = useRef(null);
    const items = [];
    if (isDir) items.push(['open', 'Open']);
    else if (openable(entry)) items.push(['open', 'Open']);
    if (isArchiveFile) items.push(['extract', 'Extract here']);
    items.push(['download', isDir ? 'Download (.tar.gz)' : 'Download']);
    items.push(['rename', 'Rename']);
    items.push(['move', 'Move']);
    items.push(['archive', 'Archive (.tar.gz)']);
    items.push(['delete', 'Delete']);

    // fixed positioning from the button rect: immune to overflow-hidden
    // ancestors and row stacking on mobile; flips upward near the bottom.
    const toggle = () => {
        if (open) { setOpen(false); return; }
        const r = btnRef.current?.getBoundingClientRect();
        if (!r) return;
        const menuH = items.length * 38 + 8;
        const up = r.bottom + menuH > window.innerHeight - 8;
        setPos({
            top: up ? Math.max(8, r.top - menuH) : r.bottom + 4,
            left: Math.max(8, Math.min(r.right - 192, window.innerWidth - 200)),
            up,
        });
        setOpen(true);
    };

    useEffect(() => {
        if (!open) return;
        const close = () => setOpen(false);
        window.addEventListener('resize', close);
        window.addEventListener('scroll', close, true);
        return () => {
            window.removeEventListener('resize', close);
            window.removeEventListener('scroll', close, true);
        };
    }, [open ]);

    return (
        <div className="shrink-0">
            <button
                ref={btnRef}
                type="button"
                aria-label={`Actions for ${entry.name}`}
                aria-haspopup="menu"
                aria-expanded={open}
                onClick={toggle}
                disabled={disabled}
                className={cn(actionBtn, 'px-2')}
            >
                <MoreHorizontal className="size-4" />
            </button>
            {open && (
                <>
                    <div className="fixed inset-0 z-[60]" onClick={() => setOpen(false)} />
                    <div
                        role="menu"
                        style={{ top: pos.top, left: pos.left }}
                        className="fixed z-[61] w-48 overflow-hidden rounded-xl border border-hairline bg-card py-1 shadow-2xl"
                    >
                        {items.map(([key, label]) => (
                            <button
                                key={key}
                                type="button"
                                role="menuitem"
                                onClick={() => { setOpen(false); onAction(key, entry); }}
                                className={cn(menuItem, key === 'delete' && 'text-red-400 hover:!text-red-300')}
                            >
                                {label}
                            </button>
                        ))}
                    </div>
                </>
            )}
        </div>
    );
}

export default function ServerFiles({ server }) {
    const toast = useToast();
    const [dir, setDir] = useState([]);
    const [editing, setEditing] = useState(null); // rel path being edited
    const [draft, setDraft] = useState('');
    const [showNew, setShowNew] = useState(null); // 'file' | 'dir' | null
    const [newName, setNewName] = useState('');
    const [selected, setSelected] = useState([]); // entry names for bulk archive
    const [transfer, setTransfer] = useState(null); // { kind, name, ratio|null, abort }
    const uploadRef = useRef(null);

    const dirPath = join(dir);
    const { data, isLoading, error, refetch } = useServerFiles(server.id, dirPath);
    const { data: fileData, isLoading: fileLoading, error: fileError } = useFileContent(
        server.id, editing, editing !== null,
    );
    const writeFile = useWriteFile(server.id);
    const mkdir = useMkdir(server.id);
    const remove = useDeleteFile(server.id);
    const rename = useRenameFile(server.id);
    const archive = useArchiveFiles(server.id);
    const extract = useExtractFiles(server.id);

    useEffect(() => {
        if (fileData) setDraft(fileData.content ?? '');
    }, [fileData]);

    useEffect(() => { setSelected([]); }, [dirPath]);

    const fail = (e) => toast.error(e.message);
    const busy = writeFile.isPending || remove.isPending || rename.isPending || archive.isPending || extract.isPending || mkdir.isPending;

    const toggleSelect = (name) =>
        setSelected((s) => (s.includes(name) ? s.filter((n) => n !== name) : [...s, name]));

    const relOf = (name) => join([...dir, name]);

    const openEntry = (entry) => {
        const rel = relOf(entry.name);
        if (entry.type === 'dir') { setDir([...dir, entry.name]); return; }
        if (!openable(entry)) {
            if (entry.type !== 'file') toast.info('Only regular files can be opened — download it instead.');
            else if (ARCHIVE_RE.test(entry.name)) toast.info('Archives cannot be edited — extract or download it instead.');
            else if (entry.size > EDIT_MAX) toast.info('File exceeds the 512KB edit cap — download it instead.');
            else toast.info('This file type cannot be edited — download it instead.');
            return;
        }
        setEditing(rel);
        setDraft('');
    };

    const closeEditor = () => {
        if (fileData && draft !== (fileData.content ?? '')) {
            if (!window.confirm('Discard unsaved changes?')) return;
        }
        setEditing(null);
    };

    const saveEdit = async () => {
        try {
            await writeFile.mutateAsync({ path: editing, content: draft });
            toast.success('File saved.');
            refetch();
        } catch (e) { fail(e); }
    };

    const createNew = async (e) => {
        e.preventDefault();
        const name = newName.trim().replace(/[/\\]/g, '');
        if (!name) { toast.error('Enter a name.'); return; }
        const rel = relOf(name);
        try {
            if (showNew === 'dir') await mkdir.mutateAsync(rel);
            else await writeFile.mutateAsync({ path: rel, content: '' });
            toast.success(`${showNew === 'dir' ? 'Folder' : 'File'} created.`);
            setShowNew(null);
            setNewName('');
            refetch();
        } catch (err) { fail(err); }
    };

    const onUpload = async (e) => {
        const f = e.target.files?.[0];
        e.target.value = '';
        if (!f) return;
        if (f.size > UPLOAD_MAX) { toast.error('Uploads are capped at 2MB.'); return; }
        const ctrl = new AbortController();
        setTransfer({ kind: 'upload', name: f.name, ratio: 0, abort: () => ctrl.abort() });
        try {
            const b64 = await blobToBase64(f);
            await uploadServerFile(server.id, relOf(f.name), b64, {
                signal: ctrl.signal,
                onProgress: (r) => setTransfer((t) => (t ? { ...t, ratio: r } : t)),
            });
            toast.success(`Uploaded ${f.name}.`);
            refetch();
        } catch (err) {
            if (err?.code === 'ABORTED') toast.info('Upload cancelled.');
            else fail(err);
        } finally {
            setTransfer(null);
        }
    };

    const onDownload = async (entry) => {
        const rel = entry.name.includes('/') ? entry.name : relOf(entry.name);
        const ctrl = new AbortController();
        setTransfer({ kind: 'download', name: entry.name.split('/').pop(), ratio: 0, abort: () => ctrl.abort() });
        try {
            await downloadServerFile(server.id, rel, {
                signal: ctrl.signal,
                onProgress: (r) => setTransfer((t) => (t ? { ...t, ratio: r } : t)),
            });
        } catch (e) {
            if (e?.code === 'ABORTED') toast.info('Download cancelled.');
            else fail(e);
        } finally {
            setTransfer(null);
        }
    };

    const onRename = async (entry) => {
        const next = window.prompt('Rename to:', entry.name);
        if (!next || next === entry.name) return;
        if (/[/\\]/.test(next)) { toast.error('Name cannot contain slashes — use Move to relocate.'); return; }
        try {
            await rename.mutateAsync({ from: relOf(entry.name), to: relOf(next.trim()) });
            toast.success('Renamed.');
            refetch();
        } catch (e) { fail(e); }
    };

    const onMove = async (entry) => {
        const next = window.prompt('Move to (path inside storage):', relOf(entry.name));
        if (!next || next === relOf(entry.name)) return;
        try {
            await rename.mutateAsync({ from: relOf(entry.name), to: next.trim().replace(/^\/+/, '') });
            toast.success('Moved.');
            refetch();
        } catch (e) { fail(e); }
    };

    const onArchiveOne = async (entry) => {
        const def = `${entry.name}.tar.gz`;
        const name = window.prompt('Archive name:', def);
        if (!name) return;
        if (!/\.tar\.gz$/.test(name) && !/\.tgz$/.test(name)) { toast.error('Name must end in .tar.gz or .tgz.'); return; }
        try {
            await archive.mutateAsync({
                sources: [relOf(entry.name)],
                dest: relOf(name.replace(/[/\\]/g, '')),
            });
            toast.success(`Archived to ${name}.`);
            refetch();
        } catch (e) { fail(e); }
    };

    const compressSelected = async () => {
        const def = selected.length === 1 ? `${selected[0]}.tar.gz` : `${dir.length ? dir[dir.length - 1] : server.name}.tar.gz`;
        const name = window.prompt('Archive name:', def);
        if (!name) return;
        if (!/\.tar\.gz$/.test(name) && !/\.tgz$/.test(name)) { toast.error('Name must end in .tar.gz or .tgz.'); return; }
        try {
            await archive.mutateAsync({
                sources: selected.map((n) => relOf(n)),
                dest: relOf(name.replace(/[/\\]/g, '')),
            });
            toast.success(`Archived to ${name}.`);
            setSelected([]);
            refetch();
        } catch (e) { fail(e); }
    };

    const extractHere = async (entry) => {
        const rel = relOf(entry.name);
        const dest = window.prompt('Extract into folder:', entry.name.replace(/\.(zip|tar\.gz|tgz|tar)$/, ''));
        if (dest === null) return;
        try {
            await extract.mutateAsync({
                file: rel,
                dest: join([...dir, (dest.trim() || '.').replace(/[/\\]/g, '') || '.']),
            });
            toast.success('Extracted.');
            refetch();
        } catch (e) { fail(e); }
    };

    const onDelete = async (entry) => {
        if (!window.confirm(`Delete "${entry.name}"${entry.type === 'dir' ? ' and everything inside it' : ''}?`)) return;
        try {
            await remove.mutateAsync(relOf(entry.name));
            toast.success('Deleted.');
            if (editing === relOf(entry.name)) setEditing(null);
            refetch();
        } catch (e) { fail(e); }
    };

    const onMenu = (key, entry) => {
        const isDir = entry.type === 'dir';
        const isArch = entry.type === 'file' && ARCHIVE_RE.test(entry.name);
        if (key === 'open') openEntry(entry);
        else if (key === 'extract') extractHere(entry);
        else if (key === 'download') onDownload(entry);
        else if (key === 'rename') onRename(entry);
        else if (key === 'move') onMove(entry);
        else if (key === 'archive') {
            if (isDir || !isArch) onArchiveOne(entry);
            else compressSelectedSingle(entry);
        }
        else if (key === 'delete') onDelete(entry);
    };

    const compressSelectedSingle = async (entry) => {
        try {
            await archive.mutateAsync({
                sources: [relOf(entry.name)],
                dest: relOf(`${entry.name}.tar.gz`),
            });
            toast.success('Archived.');
            refetch();
        } catch (e) { fail(e); }
    };

    const entries = [...(data?.entries ?? [])].sort((a, b) =>
        (a.type === 'dir' ? 0 : 1) - (b.type === 'dir' ? 0 : 1) || a.name.localeCompare(b.name));

    // ---- full-page editor takeover ----
    if (editing) {
        const dirty = !!fileData && draft !== (fileData.content ?? '');
        return (
            <div className="flex min-h-[70vh] flex-col overflow-hidden rounded-xl border border-hairline bg-card">
                <div className="flex flex-wrap items-center gap-2 border-b border-hairline px-5 py-3">
                    <button type="button" onClick={closeEditor} className="inline-flex items-center gap-1.5 text-[0.85rem] font-semibold text-ink-secondary transition hover:text-foreground">
                        <ArrowLeft className="size-4" /> Files
                    </button>
                    <span className="truncate font-mono text-[0.85rem] font-bold">{editing}</span>
                    {dirty && <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[0.68rem] font-bold text-amber-400">unsaved</span>}
                    <div className="ml-auto flex items-center gap-2">
                        <button
                            type="button"
                            onClick={() => onDownload({ name: editing })}
                            className={actionBtn}
                        >
                            <Download className="size-3.5" /> Download
                        </button>
                        <button
                            type="button"
                            onClick={saveEdit}
                            disabled={fileLoading || !!fileError || writeFile.isPending}
                            className="inline-flex items-center gap-2 rounded-full bg-white px-6 py-2 text-[0.83rem] font-bold text-black transition hover:bg-gray-200 disabled:opacity-50"
                        >
                            <Check className="size-3.5" /> {writeFile.isPending ? 'Saving…' : 'Save'}
                        </button>
                    </div>
                </div>
                <div className="flex min-h-0 flex-1 flex-col p-5">
                    {fileLoading && <p className="text-[0.85rem] text-ink-muted">Loading…</p>}
                    {fileError && (
                        <p className="text-[0.85rem] text-red-400">
                            {fileError.code === 'FILE_BINARY'
                                ? 'Binary file — preview unavailable. Download it instead.'
                                : `Failed to load: ${fileError.message}`}
                        </p>
                    )}
                    {!fileLoading && !fileError && fileData && (
                        <textarea
                            value={draft}
                            onChange={(e) => setDraft(e.target.value)}
                            spellCheck={false}
                            placeholder="Empty file — start typing…"
                            className="min-h-[55vh] w-full flex-1 resize-y rounded-lg border border-hairline bg-black/40 p-4 font-mono text-[0.85rem] leading-relaxed text-foreground focus:border-primary focus:outline-none"
                        />
                    )}
                    <p className="mt-2 font-mono text-[0.72rem] text-ink-muted">512KB edit cap · Ctrl+S saves{dirty ? ' · unsaved changes' : ''}</p>
                </div>
            </div>
        );
    }

    return (
        <div className="overflow-hidden rounded-xl border border-hairline bg-card">
            <div className="flex flex-wrap items-center gap-2 border-b border-hairline px-5 py-3">
                <button type="button" onClick={() => setDir([])} className="font-mono text-[0.85rem] font-bold hover:underline hover:underline-offset-4">
                    {server.name}
                </button>
                {dir.map((seg, i) => (
                    <span key={i} className="flex items-center gap-2">
                        <ChevronRight className="size-3.5 text-ink-muted" />
                        <button
                            type="button"
                            onClick={() => setDir(dir.slice(0, i + 1))}
                            className="font-mono text-[0.85rem] text-ink-secondary hover:text-foreground hover:underline hover:underline-offset-4"
                        >
                            {seg}
                        </button>
                    </span>
                ))}
                <div className="ml-auto flex items-center gap-2">
                    <input ref={uploadRef} type="file" className="hidden" onChange={onUpload} />
                    <button type="button" onClick={() => uploadRef.current?.click()} disabled={!!transfer} className={actionBtn}>
                        <Upload className="size-3.5" /> Upload
                    </button>
                    <button type="button" onClick={() => { setShowNew(showNew === 'dir' ? null : 'dir'); setNewName(''); }} className={actionBtn}>
                        <Folder className="size-3.5" /> New folder
                    </button>
                    <button type="button" onClick={() => { setShowNew(showNew === 'file' ? null : 'file'); setNewName(''); }} className={actionBtn}>
                        <Plus className="size-3.5" /> New file
                    </button>
                </div>
            </div>

            {transfer && (
                <div className="flex items-center gap-3 border-b border-hairline bg-veil/60 px-5 py-2.5">
                    <span className="font-mono text-[0.78rem] text-ink-secondary">
                        {transfer.kind === 'upload' ? 'Uploading' : 'Downloading'} {transfer.name}
                    </span>
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
                        <div
                            className="h-full rounded-full bg-white transition-[width]"
                            style={{ width: transfer.ratio === null ? '100%' : `${Math.round(transfer.ratio * 100)}%` }}
                        />
                    </div>
                    <span className="w-12 text-right font-mono text-[0.75rem] text-ink-secondary">
                        {transfer.ratio === null ? '…' : `${Math.round(transfer.ratio * 100)}%`}
                    </span>
                    <button type="button" onClick={transfer.abort} className="font-mono text-[0.75rem] font-bold text-red-400 hover:text-red-300">
                        Cancel
                    </button>
                </div>
            )}

            {showNew && (
                <form onSubmit={createNew} className="flex items-center gap-2 border-b border-hairline px-5 py-3">
                    <input
                        autoFocus
                        value={newName}
                        onChange={(e) => setNewName(e.target.value)}
                        placeholder={showNew === 'dir' ? 'folder-name' : 'file-name.js'}
                        className={cn(inputClass, 'font-mono')}
                    />
                    <button type="submit" className="shrink-0 rounded-full bg-white px-5 py-2 text-[0.83rem] font-bold text-black transition hover:bg-gray-200">
                        Create
                    </button>
                    <button type="button" onClick={() => setShowNew(null)} aria-label="Cancel" className={actionBtn}>
                        <X className="size-3.5" />
                    </button>
                </form>
            )}

            {selected.length > 0 && (
                <div className="flex items-center gap-3 border-b border-hairline bg-veil/60 px-5 py-2.5">
                    <span className="font-mono text-[0.78rem] text-ink-secondary">{selected.length} selected</span>
                    <button type="button" onClick={compressSelected} disabled={archive.isPending} className={actionBtn}>
                        <Archive className="size-3.5" /> Compress to .tar.gz
                    </button>
                    <button type="button" onClick={() => setSelected([])} className="font-mono text-[0.78rem] text-ink-secondary hover:text-foreground">
                        Clear
                    </button>
                </div>
            )}

            <div className="flex flex-col divide-y divide-hairline">
                {isLoading && <p className="px-5 py-8 text-center text-[0.88rem] text-ink-muted">Loading…</p>}
                {error && <p className="px-5 py-8 text-center text-[0.88rem] text-red-400">Failed to load: {error.message}</p>}
                {!isLoading && !error && entries.length === 0 && (
                    <p className="px-5 py-8 text-center text-[0.88rem] text-ink-muted">Empty folder.</p>
                )}
                {entries.map((entry) => {
                    const isDir = entry.type === 'dir';
                    const isArch = entry.type === 'file' && ARCHIVE_RE.test(entry.name);
                    return (
                        <div key={entry.name} className="group flex items-center gap-3 px-5 py-3">
                            <input
                                type="checkbox"
                                checked={selected.includes(entry.name)}
                                onChange={() => toggleSelect(entry.name)}
                                aria-label={`Select ${entry.name}`}
                                className="size-4 shrink-0 accent-white"
                            />
                            <button type="button" onClick={() => openEntry(entry)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                                {isDir ? (
                                    <Folder className="size-[18px] shrink-0 text-ink-muted" />
                                ) : isArch ? (
                                    <FileArchive className="size-[18px] shrink-0 text-ink-muted" />
                                ) : (
                                    <FileText className="size-[18px] shrink-0 text-ink-muted" />
                                )}
                                <span className="truncate font-mono text-[0.88rem] font-semibold">{entry.name}</span>
                                <span className="ml-auto shrink-0 font-mono text-[0.78rem] text-ink-muted">
                                    {isDir ? '' : fmtSize(entry.size)}
                                </span>
                                <span className="hidden shrink-0 font-mono text-[0.78rem] text-ink-muted sm:block">
                                    {entry.mtime ? new Date(entry.mtime * 1000).toLocaleDateString() : '—'}
                                </span>
                            </button>
                            <RowMenu
                                entry={entry}
                                isDir={isDir}
                                isArchiveFile={isArch}
                                disabled={busy || !!transfer}
                                onAction={onMenu}
                            />
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
