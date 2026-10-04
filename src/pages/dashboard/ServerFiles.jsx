import { useEffect, useRef, useState } from 'react';
import {
    Archive,
    ArrowLeft,
    Check,
    ChevronRight,
    Download,
    FileText,
    Folder,
    FolderPlus,
    FilePlus,
    Home,
    MoreHorizontal,
    Pencil,
    Plus,
    Trash2,
    Upload,
    X,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import { fileIcon } from '@/lib/fileIcons.js';
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

// Modern controls: soft pills, normal-case labels.
const btnSecondary =
    'inline-flex min-h-10 items-center gap-1.5 rounded-full border border-hairline bg-white/[0.06] px-4 py-2 text-[0.8rem] font-semibold text-ink-secondary shadow-sm transition hover:border-hairline-hover hover:bg-white/[0.1] hover:text-foreground hover:shadow disabled:cursor-not-allowed disabled:opacity-40';
const btnPrimary =
    'inline-flex min-h-10 items-center gap-1.5 rounded-full bg-white px-4 py-2 text-[0.8rem] font-bold text-black shadow-md transition hover:bg-gray-200 hover:shadow-lg disabled:cursor-not-allowed disabled:opacity-50';
const btnIcon =
    'inline-flex min-h-9 min-w-9 items-center justify-center rounded-xl p-2 text-ink-secondary transition hover:bg-white/10 hover:text-foreground hover:shadow disabled:opacity-40';
const inputClass =
    'w-full rounded-md border border-hairline bg-black/40 px-3.5 py-2.5 text-[0.88rem] text-foreground placeholder-ink-muted transition focus:border-primary focus:ring-2 focus:ring-ring/40 focus:outline-none';
const menuItem =
    'flex w-full items-center gap-2 px-4 py-2 text-left text-[0.83rem] font-semibold text-ink-secondary transition hover:bg-veil hover:text-foreground disabled:opacity-40';

const EDIT_MAX = 512 * 1024;
const UPLOAD_MAX = 2 * 1024 * 1024;
const ARCHIVE_RE = /\.(zip|tar\.gz|tgz|tar)$/i;
const MEDIA_RE = /\.(png|jpe?g|gif|webp|ico|bmp|mp4|webm|mov|mp3|wav|ogg|pdf|woff2?|ttf|eot|exe|dll|so|bin|dat|db|sqlite|mpkg|dmg|iso)$/i;

const fmtSize = (b) => {
    if (!b && b !== 0) return '—';
    if (b === 0) return '0 B';
    const u = ['B', 'KB', 'MB', 'GB'];
    let i = 0, v = b;
    while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
    return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${u[i]}`;
};

const fmtDate = (mtime) => {
    if (!mtime) return '—';
    const d = new Date(mtime * 1000);
    const now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    if (sameDay) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' });
};

function join(segs) { return segs.filter((s) => s !== '').join('/'); }

/** A file the editor is allowed to open (text-ish, within the edit cap). */
function openable(entry) {
    if (!entry || entry.type !== 'file') return false;
    if (ARCHIVE_RE.test(entry.name) || MEDIA_RE.test(entry.name)) return false;
    if (entry.size > EDIT_MAX) return false;
    return true;
}

function notOpenableReason(entry) {
    if (entry.type !== 'file') return 'Only regular files can be opened — download it instead.';
    if (ARCHIVE_RE.test(entry.name)) return 'Archives cannot be edited — extract or download it instead.';
    if (entry.size > EDIT_MAX) return 'File exceeds the 512KB edit cap — download it instead.';
    return 'This file type cannot be edited — download it instead.';
}

function RowMenu({ entry, isDir, isArchiveFile, onAction, disabled }) {
    const [open, setOpen] = useState(false);
    const [pos, setPos] = useState({ top: 0, left: 0 });
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
    const toggle = (e) => {
        // the row itself navigates on click (folders) — never let the
        // menu trigger bubble up to it.
        e?.stopPropagation?.();
        if (open) { setOpen(false); return; }
        const r = btnRef.current?.getBoundingClientRect();
        if (!r) return;
        const menuH = items.length * 38 + 8;
        const up = r.bottom + menuH > window.innerHeight - 8;
        setPos({
            top: up ? Math.max(8, r.top - menuH) : r.bottom + 4,
            left: Math.max(8, Math.min(r.right - 192, window.innerWidth - 200)),
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
                className={cn(btnIcon, 'lg:hidden')}
            >
                <MoreHorizontal className="size-5" />
            </button>
            {open && (
                <>
                    <div className="fixed inset-0 z-[60] lg:hidden" onClick={() => setOpen(false)} />
                    <div
                        role="menu"
                        style={{ top: pos.top, left: pos.left }}
                        className="fixed z-[61] w-52 overflow-hidden rounded-lg border border-hairline bg-card py-1 shadow-2xl"
                    >
                        {items.map(([key, label]) => (
                            <button
                                key={key}
                                type="button"
                                role="menuitem"
                                onClick={() => { setOpen(false); onAction(key, entry); }}
                                className={cn(menuItem, 'min-h-11', key === 'delete' && 'text-red-400 hover:!text-red-300')}
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

/**
 * Bottom-sheet on mobile, centered dialog on desktop. Replaces every
 * window.prompt/confirm in the file manager (native dialogs are cramped
 * and inconsistent on mobile browsers).
 */
function Sheet({ title, subtitle, onClose, onSubmit, submitLabel, danger, children, submitDisabled }) {
    useEffect(() => {
        const onKey = (e) => { if (e.key === 'Escape') onClose(); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onClose ]);

    return (
        <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/70 p-0 sm:items-center sm:p-4" onClick={onClose}>
            <form
                onSubmit={(e) => { e.preventDefault(); onSubmit(); }}
                onClick={(e) => e.stopPropagation()}
                className="w-full rounded-t-2xl border border-hairline bg-card p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:max-w-md sm:rounded-xl sm:p-6"
            >
                <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-white/20 sm:hidden" />
                <h2 className="text-[1.05rem] font-bold">{title}</h2>
                {subtitle && <p className="mt-1 break-words font-mono text-[0.78rem] text-ink-secondary">{subtitle}</p>}
                <div className="mt-4">{children}</div>
                <div className="mt-5 flex gap-2">
                    <button
                        type="button"
                        onClick={onClose}
                        className="min-h-11 flex-1 rounded-md border border-hairline px-5 py-2.5 text-sm font-bold text-ink-secondary transition hover:text-foreground"
                    >
                        Cancel
                    </button>
                    <button
                        type="submit"
                        disabled={submitDisabled}
                        className={cn(
                            'min-h-11 flex-1 rounded-md px-5 py-2.5 text-sm font-bold transition disabled:opacity-50',
                            danger
                                ? 'bg-red-500 text-white hover:bg-red-400'
                                : 'bg-white text-black hover:bg-gray-200',
                        )}
                    >
                        {submitLabel}
                    </button>
                </div>
            </form>
        </div>
    );
}

export default function ServerFiles({ server }) {
    const toast = useToast();
    const [dir, setDir] = useState([]);
    const [editing, setEditing] = useState(null); // rel path being edited
    const [draft, setDraft] = useState('');
    const [selected, setSelected] = useState([]); // entry names for bulk archive
    const [newMenu, setNewMenu] = useState(false);
    const [sheet, setSheet] = useState(null); // { type, entry?, value }
    const [transfer, setTransfer] = useState(null); // { kind, name, ratio|null, abort }
    const uploadRef = useRef(null);
    const newBtnRef = useRef(null);
    const [newPos, setNewPos] = useState({ top: 0, left: 0 });

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

    useEffect(() => {
        if (!newMenu) return;
        const close = () => setNewMenu(false);
        window.addEventListener('resize', close);
        window.addEventListener('scroll', close, true);
        return () => {
            window.removeEventListener('resize', close);
            window.removeEventListener('scroll', close, true);
        };
    }, [newMenu]);

    const fail = (e) => toast.error(e.message);
    const busy = writeFile.isPending || remove.isPending || rename.isPending || archive.isPending || extract.isPending || mkdir.isPending;

    const toggleSelect = (name) =>
        setSelected((s) => (s.includes(name) ? s.filter((n) => n !== name) : [...s, name]));

    const relOf = (name) => join([...dir, name]);
    const sheetVal = (sheet?.value ?? '').trim();

    const openEntry = (entry) => {
        const rel = relOf(entry.name);
        if (entry.type === 'dir') { setDir([...dir, entry.name]); return; }
        if (!openable(entry)) { toast.info(notOpenableReason(entry)); return; }
        setEditing(rel);
        setDraft('');
    };

    const closeEditor = () => {
        if (fileData && draft !== (fileData.content ?? '')) {
            setSheet({ type: 'discard' });
            return;
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

    // ---- sheet confirmations ----

    const submitSheet = async () => {
        if (!sheet) return;
        const v = sheetVal;
        try {
            switch (sheet.type) {
                case 'new-file':
                case 'new-dir': {
                    if (!v) { toast.error('Enter a name.'); return; }
                    if (/[/\\]/.test(v)) { toast.error('Name cannot contain slashes.'); return; }
                    const rel = relOf(v);
                    if (sheet.type === 'new-dir') await mkdir.mutateAsync(rel);
                    else await writeFile.mutateAsync({ path: rel, content: '' });
                    toast.success(`${sheet.type === 'new-dir' ? 'Folder' : 'File'} created.`);
                    if (sheet.type === 'new-file') { setEditing(rel); setDraft(''); }
                    refetch();
                    break;
                }
                case 'rename': {
                    if (!v || v === sheet.entry.name) return;
                    if (/[/\\]/.test(v)) { toast.error('Name cannot contain slashes — use Move to relocate.'); return; }
                    await rename.mutateAsync({ from: relOf(sheet.entry.name), to: relOf(v) });
                    toast.success('Renamed.');
                    refetch();
                    break;
                }
                case 'move': {
                    if (!v || v === relOf(sheet.entry.name)) return;
                    await rename.mutateAsync({ from: relOf(sheet.entry.name), to: v.replace(/^\/+/, '') });
                    toast.success('Moved.');
                    refetch();
                    break;
                }
                case 'archive-one': {
                    if (!/\.tar\.gz$/.test(v) && !/\.tgz$/.test(v)) { toast.error('Name must end in .tar.gz or .tgz.'); return; }
                    await archive.mutateAsync({ sources: [relOf(sheet.entry.name)], dest: relOf(v) });
                    toast.success(`Archived to ${v}.`);
                    refetch();
                    break;
                }
                case 'archive-many': {
                    if (!/\.tar\.gz$/.test(v) && !/\.tgz$/.test(v)) { toast.error('Name must end in .tar.gz or .tgz.'); return; }
                    await archive.mutateAsync({ sources: sheet.names.map((n) => relOf(n)), dest: relOf(v) });
                    toast.success(`Archived to ${v}.`);
                    setSelected([]);
                    refetch();
                    break;
                }
                case 'extract': {
                    // empty = extract in place (same folder as the archive)
                    const payload = { file: relOf(sheet.entry.name) };
                    if (v) payload.dest = join([...dir, v]);
                    await extract.mutateAsync(payload);
                    toast.success('Extracted here.');
                    refetch();
                    break;
                }
                case 'delete': {
                    await remove.mutateAsync(relOf(sheet.entry.name));
                    toast.success('Deleted.');
                    if (editing === relOf(sheet.entry.name)) setEditing(null);
                    refetch();
                    break;
                }
                case 'discard': {
                    setEditing(null);
                    break;
                }
                default:
                    break;
            }
        } catch (e) { fail(e); return; }
        setSheet(null);
    };

    const sheetTitle = () => {
        switch (sheet?.type) {
            case 'new-file': return 'Create file';
            case 'new-dir': return 'Create directory';
            case 'rename': return 'Rename';
            case 'move': return 'Move';
            case 'archive-one': return 'Create archive';
            case 'archive-many': return `Create archive (${sheet.names.length} items)`;
            case 'extract': return 'Extract archive';
            case 'delete': return 'Delete';
            case 'discard': return 'Discard changes?';
            default: return '';
        }
    };

    const sheetSubtitle = () => {
        switch (sheet?.type) {
            case 'rename':
            case 'move':
            case 'delete':
                return relOf(sheet.entry.name);
            case 'archive-one':
            case 'extract':
                return relOf(sheet.entry.name);
            case 'discard':
                return editing;
            default:
                return dirPath ? `in ${dirPath}` : 'in / (root)';
        }
    };

    // ---- row actions ----

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

    const onMenu = (key, entry) => {
        if (key === 'open') openEntry(entry);
        else if (key === 'download') onDownload(entry);
        else if (key === 'rename') setSheet({ type: 'rename', entry, value: entry.name });
        else if (key === 'move') setSheet({ type: 'move', entry, value: relOf(entry.name) });
        else if (key === 'archive') {
            setSheet({ type: 'archive-one', entry, value: `${entry.name}.tar.gz` });
        }
        else if (key === 'extract') {
            // default: same folder — type a name only for a subfolder
            setSheet({ type: 'extract', entry, value: '' });
        }
        else if (key === 'delete') setSheet({ type: 'delete', entry, value: '' });
    };

    const toggleNew = () => {
        if (newMenu) { setNewMenu(false); return; }
        const r = newBtnRef.current?.getBoundingClientRect();
        if (r) {
            setNewPos({
                top: Math.max(8, r.top - (3 * 38 + 8)),
                left: Math.max(8, Math.min(r.right - 192, window.innerWidth - 200)),
            });
        }
        setNewMenu(true);
    };

    const entries = [...(data?.entries ?? [])].sort((a, b) =>
        (a.type === 'dir' ? 0 : 1) - (b.type === 'dir' ? 0 : 1) || a.name.localeCompare(b.name));
    const allChecked = entries.length > 0 && entries.every((e) => selected.includes(e.name));

    // ---- full-page editor takeover (Pterodactyl-style code view) ----
    if (editing) {
        const dirty = !!fileData && draft !== (fileData.content ?? '');
        const icon = fileIcon(editing.split('/').pop(), 'file');
        return (
            <div className="flex min-h-[70vh] flex-col overflow-hidden rounded-lg border border-hairline bg-[#0d1117]">
                <div className="flex items-center gap-2 border-b border-hairline bg-black/30 px-4 py-2.5 sm:px-5">
                    <button type="button" onClick={closeEditor} aria-label="Back to files" className="inline-flex min-h-11 shrink-0 items-center gap-1 text-[0.85rem] font-semibold text-ink-secondary transition hover:text-foreground sm:min-h-0">
                        <ArrowLeft className="size-4" />
                    </button>
                    {icon ? (
                        <img src={icon} alt="" aria-hidden="true" className="size-5 shrink-0" draggable={false} />
                    ) : null}
                    <span className="min-w-0 flex-1 truncate font-mono text-[0.85rem] font-semibold">{editing}</span>
                    {dirty
                        ? <span className="shrink-0 rounded bg-amber-500/15 px-2 py-0.5 text-[0.68rem] font-bold uppercase tracking-wide text-amber-400">unsaved</span>
                        : <span className="hidden shrink-0 items-center gap-1 text-[0.7rem] text-ink-muted sm:inline-flex"><Check className="size-3.5" /> saved</span>}
                    <div className="ml-auto flex shrink-0 items-center gap-2">
                        <button type="button" onClick={() => onDownload({ name: editing })} className={btnSecondary}>
                            <Download className="size-3.5" /> <span className="hidden sm:inline">Download</span>
                        </button>
                        <button
                            type="button"
                            onClick={saveEdit}
                            disabled={fileLoading || !!fileError || writeFile.isPending}
                            className="inline-flex min-h-11 items-center gap-1.5 rounded-md bg-white px-5 py-2 text-[0.78rem] font-bold uppercase tracking-wide text-black transition hover:bg-gray-200 disabled:opacity-50 sm:min-h-9"
                        >
                            {writeFile.isPending ? 'Saving…' : 'Save'}
                        </button>
                    </div>
                </div>
                <div className="flex min-h-0 flex-1 flex-col">
                    {fileLoading && <p className="p-5 text-[0.85rem] text-ink-muted">Loading…</p>}
                    {fileError && (
                        <p className="p-5 text-[0.85rem] text-red-400">
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
                            autoCapitalize="off"
                            autoCorrect="off"
                            placeholder="Empty file — start typing…"
                            className="min-h-[55vh] w-full flex-1 resize-y bg-transparent p-4 font-mono text-base leading-relaxed text-gray-200 focus:outline-none sm:p-5 sm:text-[0.85rem]"
                        />
                    )}
                </div>
                <div className="flex items-center gap-3 border-t border-hairline bg-black/30 px-4 py-2 sm:px-5">
                    <span className="font-mono text-[0.7rem] text-ink-muted">{draft.split('\n').length} lines · {new Blob([draft]).size} bytes</span>
                    <span className="ml-auto font-mono text-[0.7rem] text-ink-muted">512KB edit cap</span>
                </div>
                {sheet?.type === 'discard' && (
                    <Sheet title={sheetTitle()} subtitle={sheetSubtitle()} onClose={() => setSheet(null)} onSubmit={submitSheet} submitLabel="Discard" danger>
                        <p className="text-[0.88rem] text-ink-secondary">Unsaved changes to this file will be lost.</p>
                    </Sheet>
                )}
            </div>
        );
    }

    return (
        <div className="overflow-hidden rounded-2xl border border-hairline bg-gradient-to-b from-white/[0.04] to-transparent bg-card shadow-xl">
            {/* toolbar: breadcrumb + actions */}
            <div className="flex items-center gap-2 border-b border-hairline/70 px-3 py-2.5 sm:px-5 sm:py-3">
                <nav aria-label="Breadcrumb" className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto whitespace-nowrap py-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                    <button type="button" onClick={() => setDir([])} aria-label="Root directory" className="flex min-h-11 shrink-0 items-center gap-1.5 rounded-md px-2 font-mono text-[0.85rem] font-bold transition hover:bg-veil sm:min-h-9">
                        <Home className="size-4 text-ink-secondary" />
                    </button>
                    {dir.map((seg, i) => (
                        <span key={i} className="flex shrink-0 items-center gap-1">
                            <ChevronRight className="size-3.5 text-ink-muted" />
                            <button
                                type="button"
                                onClick={() => setDir(dir.slice(0, i + 1))}
                                className="max-w-32 truncate rounded-md px-1.5 py-1 font-mono text-[0.85rem] text-ink-secondary transition hover:bg-veil hover:text-foreground"
                            >
                                {seg}
                            </button>
                        </span>
                    ))}
                </nav>
                <div className="ml-auto flex shrink-0 items-center gap-1.5">
                    <input ref={uploadRef} type="file" className="hidden" onChange={onUpload} />
                    {/* mobile: single + menu */}
                    <div className="relative sm:hidden">
                        <button
                            ref={newBtnRef}
                            type="button"
                            aria-label="Create or upload"
                            aria-haspopup="menu"
                            aria-expanded={newMenu}
                            onClick={toggleNew}
                            className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md bg-white text-black transition hover:bg-gray-200"
                        >
                            <Plus className="size-5" />
                        </button>
                        {newMenu && (
                            <>
                                <div className="fixed inset-0 z-[60]" onClick={() => setNewMenu(false)} />
                                <div
                                    role="menu"
                                    style={{ top: newPos.top, left: newPos.left }}
                                    className="fixed z-[61] w-48 overflow-hidden rounded-lg border border-hairline bg-card py-1 shadow-2xl"
                                >
                                    <button type="button" role="menuitem" onClick={() => { setNewMenu(false); uploadRef.current?.click(); }} className={cn(menuItem, 'min-h-11')}>
                                        <Upload className="size-4" /> Upload file
                                    </button>
                                    <button type="button" role="menuitem" onClick={() => { setNewMenu(false); setSheet({ type: 'new-file', value: '' }); }} className={cn(menuItem, 'min-h-11')}>
                                        <FilePlus className="size-4" /> New file
                                    </button>
                                    <button type="button" role="menuitem" onClick={() => { setNewMenu(false); setSheet({ type: 'new-dir', value: '' }); }} className={cn(menuItem, 'min-h-11')}>
                                        <FolderPlus className="size-4" /> New directory
                                    </button>
                                </div>
                            </>
                        )}
                    </div>
                    {/* desktop: modern pill buttons */}
                    <div className="hidden items-center gap-2 sm:flex">
                        <button type="button" onClick={() => uploadRef.current?.click()} disabled={!!transfer} className={btnPrimary}>
                            <Upload className="size-4" /> Upload
                        </button>
                        <button type="button" onClick={() => setSheet({ type: 'new-file', value: '' })} className={btnSecondary}>
                            <FilePlus className="size-4" /> New file
                        </button>
                        <button type="button" onClick={() => setSheet({ type: 'new-dir', value: '' })} className={btnSecondary}>
                            <FolderPlus className="size-4" /> New folder
                        </button>
                    </div>
                </div>
            </div>

            {transfer && (
                <div className="flex items-center gap-3 border-b border-hairline bg-veil/60 px-4 py-3">
                    <span className="min-w-0 flex-1 truncate font-mono text-[0.78rem] text-ink-secondary">
                        {transfer.kind === 'upload' ? 'Uploading' : 'Downloading'} {transfer.name}
                    </span>
                    <div className="h-2 w-24 shrink-0 overflow-hidden rounded-full bg-white/10 sm:w-40">
                        <div
                            className="h-full rounded-full bg-white transition-[width]"
                            style={{ width: transfer.ratio === null ? '100%' : `${Math.round(transfer.ratio * 100)}%` }}
                        />
                    </div>
                    <span className="w-11 shrink-0 text-right font-mono text-[0.75rem] text-ink-secondary">
                        {transfer.ratio === null ? '…' : `${Math.round(transfer.ratio * 100)}%`}
                    </span>
                    <button type="button" onClick={transfer.abort} className="shrink-0 rounded-md border border-red-500/40 px-3 py-1 font-mono text-[0.72rem] font-bold text-red-400">
                        Stop
                    </button>
                </div>
            )}

            {/* cards */}
            <div className="flex flex-col gap-2 p-3 sm:p-4">
                {isLoading && <p className="px-4 py-10 text-center text-[0.88rem] text-ink-muted">Loading…</p>}
                {error && <p className="px-4 py-10 text-center text-[0.88rem] text-red-400">Failed to load: {error.message}</p>}
                {!isLoading && !error && entries.length === 0 && (
                    <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-hairline px-4 py-12 text-center">
                        <Folder className="size-9 text-ink-muted" />
                        <p className="text-[0.92rem] font-semibold">This directory is empty</p>
                        <p className="max-w-60 text-[0.82rem] text-ink-secondary">Upload files or create a new one to get started.</p>
                    </div>
                )}
                {entries.map((entry) => {
                    const isDir = entry.type === 'dir';
                    const isArch = entry.type === 'file' && ARCHIVE_RE.test(entry.name);
                    const icon = !isDir ? fileIcon(entry.name, entry.type) : null;
                    const checked = selected.includes(entry.name);
                    return (
                        <div
                            key={entry.name}
                            onClick={isDir ? () => openEntry(entry) : undefined}
                            className={cn(
                                'group flex min-h-[4rem] items-center gap-3 rounded-2xl border px-3 py-2.5 shadow-sm transition duration-150 sm:px-4',
                                checked
                                    ? 'border-blue-400/50 bg-blue-500/10 shadow-md'
                                    : 'border-hairline/70 bg-white/[0.03] hover:border-hairline-hover hover:bg-white/[0.06] hover:shadow-lg',
                                isDir && 'cursor-pointer',
                            )}
                        >
                            <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => toggleSelect(entry.name)}
                                onClick={(e) => e.stopPropagation()}
                                aria-label={`Select ${entry.name}`}
                                className="size-5 shrink-0 cursor-pointer rounded-md accent-white"
                            />
                            <button
                                type="button"
                                onClick={() => openEntry(entry)}
                                className="flex min-w-0 flex-1 items-center gap-3 text-left"
                                aria-label={isDir ? `Open folder ${entry.name}` : `Open file ${entry.name}`}
                            >
                                <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-white/10 to-white/[0.02] shadow-inner">
                                    {isDir ? (
                                        <Folder className="size-6 text-sky-300/90" />
                                    ) : icon ? (
                                        <img src={icon} alt="" aria-hidden="true" className="size-6" draggable={false} />
                                    ) : (
                                        <FileText className="size-5 text-ink-muted" />
                                    )}
                                </span>
                                <span className="min-w-0 flex-1">
                                    <span className="block truncate text-[0.92rem] font-semibold text-gray-100">{entry.name}</span>
                                    <span className="mt-1 flex items-center gap-2 font-mono text-[0.7rem] text-ink-muted">
                                        <span className="rounded-full bg-white/[0.06] px-2 py-0.5">
                                            {isDir ? 'Folder' : fmtSize(entry.size)}
                                        </span>
                                        <span className="sm:hidden">{fmtDate(entry.mtime)}</span>
                                    </span>
                                </span>
                            </button>
                            <span className="hidden w-28 shrink-0 text-right font-mono text-[0.75rem] text-ink-muted md:block">
                                {fmtDate(entry.mtime)}
                            </span>
                            <span className="hidden w-20 shrink-0 text-right font-mono text-[0.75rem] text-ink-muted sm:block">
                                {isDir ? '—' : fmtSize(entry.size)}
                            </span>
                            {/* desktop hover actions */}
                            <span className="hidden shrink-0 items-center gap-1 rounded-full border border-hairline/60 bg-black/30 p-1 opacity-0 shadow-sm transition group-hover:opacity-100 focus-within:opacity-100 lg:flex">
                                {entry.type === 'file' && !isArch && (
                                    <button type="button" title="Edit" aria-label={`Edit ${entry.name}`} onClick={() => openEntry(entry)} className={btnIcon}>
                                        <Pencil className="size-4" />
                                    </button>
                                )}
                                {entry.type === 'file' && isArch && (
                                    <button type="button" title="Extract" aria-label={`Extract ${entry.name}`} onClick={() => onMenu('extract', entry)} className={btnIcon}>
                                        <Archive className="size-4" />
                                    </button>
                                )}
                                <button type="button" title="Download" aria-label={`Download ${entry.name}`} onClick={() => onDownload(entry)} className={btnIcon}>
                                    <Download className="size-4" />
                                </button>
                                <button
                                    type="button"
                                    title="Delete"
                                    aria-label={`Delete ${entry.name}`}
                                    onClick={() => onMenu('delete', entry)}
                                    className={cn(btnIcon, 'hover:!text-red-400')}
                                >
                                    <Trash2 className="size-4" />
                                </button>
                            </span>
                            {/* mobile / overflow menu */}
                            <span className="lg:hidden">
                                <RowMenu
                                    entry={entry}
                                    isDir={isDir}
                                    isArchiveFile={isArch}
                                    disabled={busy || !!transfer}
                                    onAction={onMenu}
                                />
                            </span>
                        </div>
                    );
                })}
            </div>

            {/* bulk selection bar */}
            {(selected.length > 0 || entries.length > 0) && !isLoading && !error && (
                <div className="mx-3 mb-3 flex flex-wrap items-center gap-2 rounded-full border border-hairline bg-black/40 px-4 py-2.5 shadow-lg backdrop-blur sm:mx-4 sm:mb-4">
                    <input
                        type="checkbox"
                        checked={allChecked}
                        onChange={() => setSelected(allChecked ? [] : entries.map((e) => e.name))}
                        aria-label="Select all"
                        className="size-5 shrink-0 cursor-pointer accent-white"
                    />
                    {selected.length > 0 ? (
                        <>
                            <span className="font-mono text-[0.75rem] text-ink-secondary">{selected.length} selected</span>
                            <button type="button" onClick={() => setSheet({ type: 'archive-many', names: [...selected], value: `${selected.length === 1 ? selected[0] : (dir[dir.length - 1] ?? server.name)}.tar.gz` })} disabled={archive.isPending} className={btnSecondary}>
                                <Archive className="size-3.5" /> Archive
                            </button>
                            <button type="button" onClick={() => setSelected([])} className="font-mono text-[0.75rem] text-ink-secondary hover:text-foreground">
                                Clear
                            </button>
                        </>
                    ) : (
                        <span className="font-mono text-[0.72rem] text-ink-muted">
                            {entries.length} item{entries.length === 1 ? '' : 's'}
                        </span>
                    )}
                </div>
            )}

            {/* unified sheet */}
            {sheet && sheet.type !== 'discard' && (
                <Sheet
                    title={sheetTitle()}
                    subtitle={sheetSubtitle()}
                    onClose={() => setSheet(null)}
                    onSubmit={submitSheet}
                    submitLabel={
                        sheet.type === 'delete' ? 'Delete' :
                        sheet.type === 'extract' ? 'Extract' :
                        sheet.type.startsWith('archive') ? 'Compress' :
                        sheet.type.startsWith('new') ? 'Create' : 'Save'
                    }
                    danger={sheet.type === 'delete'}
                >
                    {sheet.type === 'delete' ? (
                        <p className="text-[0.88rem] text-ink-secondary">
                            {sheet.entry.type === 'dir'
                                ? 'This directory and everything inside it will be permanently removed.'
                                : 'This file will be permanently removed.'} This cannot be undone.
                        </p>
                    ) : sheet.type === 'move' ? (
                        <>
                            <input
                                autoFocus
                                value={sheet.value}
                                onChange={(e) => setSheet((s) => ({ ...s, value: e.target.value }))}
                                placeholder="path/inside/storage"
                                className={cn(inputClass, 'font-mono')}
                            />
                            <p className="mt-2 font-mono text-[0.72rem] text-ink-muted">Full path inside storage — folders are created as needed.</p>
                        </>
                    ) : sheet.type === 'extract' ? (
                        <>
                            <input
                                autoFocus
                                value={sheet.value}
                                onChange={(e) => setSheet((s) => ({ ...s, value: e.target.value }))}
                                placeholder="Current folder (leave empty)"
                                className={cn(inputClass, 'font-mono')}
                            />
                            <p className="mt-2 font-mono text-[0.72rem] text-ink-muted">Empty = extract here. Or type a subfolder name.</p>
                        </>
                    ) : (
                        <input
                            autoFocus
                            value={sheet.value}
                            onChange={(e) => setSheet((s) => ({ ...s, value: e.target.value }))}
                            placeholder={sheet.type === 'new-dir' ? 'folder-name' : sheet.type === 'new-file' ? 'file-name.js' : 'name'}
                            className={cn(inputClass, 'font-mono')}
                        />
                    )}
                </Sheet>
            )}
        </div>
    );
}
