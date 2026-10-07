import { useEffect, useMemo, useRef, useState } from 'react';
import {
    Archive,
    ArrowDownUp,
    Check,
    ChevronRight,
    FilePlus,
    FileText,
    Folder,
    FolderPlus,
    Grid2X2,
    Home,
    LayoutList,
    List,
    Pencil,
    Plus,
    RefreshCw,
    RotateCcw,
    Search,
    Trash2,
    Upload,
    X,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import { fileIcon } from '@/lib/fileIcons.js';
import { useToast } from '@/hooks/useToast.jsx';
import {
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
import { Sheet } from '@/components/ui/sheet.jsx';
import { Select } from '@/components/ui/select.jsx';
import { Skeleton } from '@/components/ui/field.jsx';

// Modern controls: soft pills, normal-case labels.
const btnSecondary =
    'inline-flex min-h-10 items-center gap-1.5 rounded-full border border-hairline bg-white/[0.06] px-4 py-2 text-[0.8rem] font-semibold text-ink-secondary transition hover:border-hairline-hover hover:bg-white/[0.1] hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40';
const btnPrimary =
    'inline-flex min-h-10 items-center gap-1.5 rounded-full bg-white px-4 py-2 text-[0.8rem] font-bold text-black transition hover:bg-gray-200 disabled:cursor-not-allowed disabled:opacity-50';
const btnIcon =
    'inline-flex min-h-9 min-w-9 items-center justify-center rounded-xl p-2 text-ink-secondary transition hover:bg-white/10 hover:text-foreground hover:shadow disabled:opacity-40';
const inputClass =
    'w-full rounded-md border border-hairline bg-black/40 px-3.5 py-2.5 text-[0.88rem] text-foreground placeholder-ink-muted transition focus:border-primary focus:ring-2 focus:ring-ring/40 focus:outline-none';
const menuItem =
    'flex w-full items-center gap-2 px-4 py-2 text-left text-[0.83rem] font-semibold text-ink-secondary transition hover:bg-veil hover:text-foreground disabled:opacity-40';

const EDIT_MAX = 512 * 1024;
const UPLOAD_MAX = 1024 * 1024 * 1024; // 1 GB (streamed raw to the API)
const ARCHIVE_RE = /\.(zip|tar\.gz|tgz|tar)$/i;
const MEDIA_RE = /\.(png|jpe?g|gif|webp|ico|bmp|mp4|webm|mov|mp3|wav|ogg|pdf|woff2?|ttf|eot|exe|dll|so|bin|dat|db|sqlite|mpkg|dmg|iso)$/i;
const DIR_FIRST = (a, b) => (a.type === 'dir' ? 0 : 1) - (b.type === 'dir' ? 0 : 1);

const SORTS = [
    { value: 'name', label: 'Name' },
    { value: 'size', label: 'Size' },
    { value: 'modified', label: 'Modified' },
];

const fmtSize = (b) => {
    if (!b && b !== 0) return '—';
    if (b === 0) return '0 B';
    const u = ['B', 'KB', 'MB', 'GB'];
    let i = 0; let v = b;
    while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
    return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${u[i]}`;
};

const fmtDate = (mtime) => {
    if (!mtime) return '—';
    const d = new Date(mtime * 1000);
    const now = new Date();
    if (d.toDateString() === now.toDateString()) return 'Today ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const y = new Date(now); y.setDate(now.getDate() - 1);
    if (d.toDateString() === y.toDateString()) return 'Yesterday';
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
    if (ARCHIVE_RE.test(entry.name)) return 'Archives cannot be edited — extract or download instead.';
    if (entry.size > EDIT_MAX) return 'File exceeds the 512KB edit cap — download it instead.';
    return 'This file type cannot be edited — download it instead.';
}

/** Kebab menu — the single entry point for every row action. */
function RowMenu({ items, onSelect, disabled, align = 'right', trigger, label = 'Actions' }) {
    const [open, setOpen] = useState(false);
    const [pos, setPos] = useState({ top: 0, left: 0 });
    const btnRef = useRef(null);

    useEffect(() => {
        if (!open) return;
        const close = () => setOpen(false);
        document.addEventListener('mousedown', (e) => { if (!btnRef.current?.parentElement?.contains(e.target)) close(); });
        window.addEventListener('resize', close);
        window.addEventListener('scroll', close, true);
        return () => {
            document.removeEventListener('mousedown', close);
            window.removeEventListener('resize', close);
            window.removeEventListener('scroll', close, true);
        };
    }, [open]);

    const toggle = (e) => {
        e?.stopPropagation?.();
        if (open) { setOpen(false); return; }
        const r = btnRef.current?.getBoundingClientRect();
        if (!r) return;
        const menuH = items.length * 38 + 8;
        const up = r.bottom + menuH > window.innerHeight - 8;
        setPos({
            top: up ? Math.max(8, r.top - menuH) : r.bottom + 4,
            left: align === 'right'
                ? Math.max(8, Math.min(r.right - 208, window.innerWidth - 216))
                : Math.max(8, Math.min(r.left, window.innerWidth - 216)),
        });
        setOpen(true);
    };

    return (
        <>
            <button
                ref={btnRef}
                type="button"
                aria-label={label}
                aria-haspopup="menu"
                aria-expanded={open}
                disabled={disabled}
                onClick={toggle}
                className={btnIcon}
            >
                {trigger ?? <List size={18} />}
            </button>
            {open && (
                <>
                    <div className="fixed inset-0 z-[60]" onClick={() => setOpen(false)} />
                    <div role="menu" style={{ top: pos.top, left: pos.left }} className="fixed z-[61] w-52 overflow-hidden rounded-lg border border-hairline bg-card py-1 shadow-2xl">
                        {items.map(([key, labelText, Icon, danger]) => (
                            <button
                                key={key}
                                type="button"
                                role="menuitem"
                                disabled={disabled}
                                onClick={(e) => { e.stopPropagation(); setOpen(false); onSelect?.(key); }}
                                className={cn(menuItem, danger && 'text-red-400 hover:!text-red-300')}
                            >
                                {Icon && <Icon size={15} />}
                                {labelText}
                            </button>
                        ))}
                    </div>
                </>
            )}
        </>
    );
}

export default function ServerFiles({ server }) {
    const [dir, setDir] = useState([]);
    const dirPath = join(dir);
    const { data, isLoading, error, refetch, isFetching } = useServerFiles(server.id, dirPath);
    const [editing, setEditing] = useState(null);
    const { data: fileData, isLoading: fileLoading, error: fileError } = useFileContent(server.id, editing);
    const [draft, setDraft] = useState('');
    const [sheet, setSheet] = useState(null);
    const [selected, setSelected] = useState([]);
    const [query, setQuery] = useState('');
    const [sortBy, setSortBy] = useState('name');
    const [sortDir, setSortDir] = useState('asc');
    const [view, setView] = useState(() => (typeof window !== 'undefined' && window.innerWidth < 640 ? 'grid' : 'list'));
    const [dragActive, setDragActive] = useState(false);
    const [queue, setQueue] = useState([]);
    const [download, setDownload] = useState(null);

    const uploadRef = useRef(null);
    const toast = useToast();
    const dragDepth = useRef(0);

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
    const sheetVal = (sheet?.value ?? '').trim();

    // ---- filtering / sorting -------------------------------------------------
    const entries = useMemo(() => {
        const list = [...(data?.entries ?? [])];
        const q = query.trim().toLowerCase();
        const filtered = q ? list.filter((e) => e.name.toLowerCase().includes(q)) : list;
        filtered.sort((a, b) => {
            const d = DIR_FIRST(a, b);
            if (d !== 0) return d;
            let cmp = 0;
            if (sortBy === 'size') cmp = (a.size ?? 0) - (b.size ?? 0);
            else if (sortBy === 'modified') cmp = (a.mtime ?? 0) - (b.mtime ?? 0);
            else cmp = a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
            return sortDir === 'asc' ? cmp : -cmp;
        });
        return filtered;
    }, [data, query, sortBy, sortDir]);

    const dirStats = useMemo(() => {
        const list = data?.entries ?? [];
        return {
            count: list.length,
            bytes: list.reduce((acc, e) => acc + (e.type === 'file' ? e.size ?? 0 : 0), 0),
        };
    }, [data]);

    const allChecked = entries.length > 0 && entries.every((e) => selected.includes(e.name));

    // ---- navigation / editor ---------------------------------------------------
    const openEntry = (entry) => {
        const rel = relOf(entry.name);
        if (entry.type === 'dir') { setDir([...dir, entry.name]); setQuery(''); return; }
        if (!openable(entry)) { toast.info(notOpenableReason(entry)); return; }
        setEditing(rel);
        setDraft('');
    };

    const closeEditor = () => {
        if (fileData && draft !== (fileData.content ?? '')) { setSheet({ type: 'discard' }); return; }
        setEditing(null);
    };

    const saveEdit = async () => {
        try {
            await writeFile.mutateAsync({ path: editing, content: draft });
            toast.success('File saved.');
            refetch();
        } catch (e) { fail(e); }
    };

    // ---- uploads (queue, multi-file, retry, cancel) ------------------------------
    // The authoritative list lives in a ref so the sequential pump never reads
    // stale state.
    const queueRef = useRef([]);
    const pumping = useRef(false);

    const setItems = (items) => { queueRef.current = items; setQueue(items); };
    const patchItem = (id, patch) =>
        setItems(queueRef.current.map((it) => (it.id === id ? { ...it, ...patch } : it)));

    const pump = async () => {
        if (pumping.current) return;
        pumping.current = true;
        try {
            for (;;) {
                const next = queueRef.current.find((it) => it.status === 'pending');
                if (!next) break;
                const ctrl = new AbortController();
                patchItem(next.id, { status: 'uploading', ratio: 0, error: null, abort: () => ctrl.abort() });
                try {
                    await uploadServerFile(server.id, relOf(next.name), next.file, {
                        signal: ctrl.signal,
                        onProgress: (r) => patchItem(next.id, { ratio: r }),
                    });
                    patchItem(next.id, { status: 'done', ratio: 1 });
                    toast.success(`Uploaded ${next.name}.`);
                } catch (err) {
                    if (ctrl.signal.aborted || err?.code === 'ABORTED') patchItem(next.id, { status: 'cancelled' });
                    else patchItem(next.id, { status: 'failed', error: err?.message || 'Upload failed' });
                }
            }
            // let finished rows linger briefly so the bar is readable, then drop them
            if (queueRef.current.some((it) => it.status === 'done')) {
                setTimeout(() => {
                    const rest = queueRef.current.filter((it) => it.status !== 'done');
                    if (rest.length !== queueRef.current.length) setItems(rest);
                }, 2500);
            }
        } finally {
            pumping.current = false;
            refetch();
        }
    };

    const enqueue = (files) => {
        const accepted = [];
        for (const f of files) {
            if (f.size > UPLOAD_MAX) { toast.error(`${f.name} is larger than the 1 GB upload cap.`); continue; }
            accepted.push({
                id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                file: f,
                name: f.name,
                size: f.size,
                ratio: 0,
                status: 'pending',
                error: null,
                abort: null,
            });
        }
        if (!accepted.length) return;
        setItems([...queueRef.current, ...accepted]);
        pump();
    };

    const retryUpload = (id) => {
        patchItem(id, { status: 'pending', error: null, ratio: 0 });
        pump();
    };

    const onPick = (e) => {
        const files = Array.from(e.target.files || []);
        e.target.value = '';
        enqueue(files);
    };

    // ---- downloads -------------------------------------------------------------
    const onDownload = async (entry) => {
        const name = entry.name.includes('/') ? entry.name : relOf(entry.name);
        setDownload({ name: name.split('/').pop(), ratio: 0, abort: null });
        const ctrl = new AbortController();
        setDownload({ name: name.split('/').pop(), ratio: 0, abort: () => ctrl.abort() });
        try {
            await downloadServerFile(server.id, name, {
                signal: ctrl.signal,
                onProgress: (r) => setDownload((d) => (d ? { ...d, ratio: r } : d)),
            });
        } catch (e) {
            if (e?.code === 'ABORTED') toast.info('Download cancelled.');
            else fail(e);
        } finally {
            setDownload(null);
        }
    };

    // ---- row actions ------------------------------------------------------------
    const rowMenuItems = (entry, isDir, isArch) => {
        const items = [];
        if (isDir) items.push(['open', 'Open', Folder, false]);
        else if (openable(entry)) items.push(['open', 'Open', Pencil, false]);
        if (isArch) items.push(['extract', 'Extract here', Archive, false]);
        items.push(['download', isDir ? 'Download (.tar.gz)' : 'Download', FileText, false]);
        items.push(['rename', 'Rename', Pencil, false]);
        items.push(['move', 'Move', FolderPlus, false]);
        items.push(['archive', 'Compress (.tar.gz)', Archive, false]);
        items.push(['delete', 'Delete', Trash2, true]);
        return items;
    };

    const onMenu = (key, entry) => {
        if (key === 'open') openEntry(entry);
        else if (key === 'download') onDownload(entry);
        else if (key === 'rename') setSheet({ type: 'rename', entry, value: entry.name });
        else if (key === 'move') setSheet({ type: 'move', entry, value: relOf(entry.name) });
        else if (key === 'archive') setSheet({ type: 'archive-one', entry, value: `${entry.name}.tar.gz` });
        else if (key === 'extract') setSheet({ type: 'extract', entry, value: '' });
        else if (key === 'delete') setSheet({ type: 'delete', entry, value: '' });
    };

    // ---- sheet actions ------------------------------------------------------------
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
                case 'move-many': {
                    if (!v) { toast.error('Enter a destination path.'); return; }
                    for (const n of sheet.names) {
                        await rename.mutateAsync({ from: relOf(n), to: join([v.replace(/^\/+/, ''), n]) });
                    }
                    toast.success(`Moved ${sheet.names.length} item(s).`);
                    setSelected([]);
                    refetch();
                    break;
                }
                case 'delete-many': {
                    for (const n of sheet.names) await remove.mutateAsync(relOf(n));
                    toast.success(`Deleted ${sheet.names.length} item(s).`);
                    setSelected([]);
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
            case 'move-many': return `Move ${sheet.names.length} item(s)`;
            case 'delete-many': return `Delete ${sheet.names.length} item(s)`;
            case 'archive-one':
            case 'archive-many': return 'Create archive';
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
            case 'archive-one':
            case 'extract':
                return relOf(sheet.entry.name);
            case 'move-many':
            case 'delete-many':
            case 'archive-many':
                return `${sheet.names.length} item(s) in ${dirPath || '/ (root)'}`;
            case 'discard':
                return editing;
            default:
                return dirPath ? `in ${dirPath}` : 'in / (root)';
        }
    };

    // ---- drag & drop -------------------------------------------------------------
    const onDrop = (e) => {
        e.preventDefault();
        dragDepth.current = 0;
        setDragActive(false);
        const files = Array.from(e.dataTransfer?.files || []).filter((f) => f.size > 0);
        if (files.length) enqueue(files);
    };

    // ---- full-page editor takeover ------------------------------------------------
    if (editing) {
        const dirty = !!fileData && draft !== (fileData.content ?? '');
        const icon = fileIcon(editing.split('/').pop(), 'file');
        return (
            <div className="flex min-h-[70vh] flex-col overflow-hidden rounded-lg border border-hairline bg-[#0d1117]">
                <div className="flex items-center gap-2 border-b border-hairline bg-black/30 px-4 py-2.5 sm:px-5">
                    <button type="button" onClick={closeEditor} aria-label="Back to files" className="inline-flex min-h-11 shrink-0 items-center gap-1 text-[0.85rem] font-semibold text-ink-secondary transition hover:text-foreground sm:min-h-0">
                        <Pencil size={16} />
                    </button>
                    {icon ? <img src={icon} alt="" aria-hidden="true" className="size-5 shrink-0" draggable={false} /> : null}
                    <span className="min-w-0 flex-1 truncate font-mono text-[0.85rem] font-semibold">{editing}</span>
                    {dirty
                        ? <span className="shrink-0 rounded bg-amber-500/15 px-2 py-0.5 text-[0.68rem] font-bold uppercase tracking-wide text-amber-400">unsaved</span>
                        : <span className="hidden shrink-0 items-center gap-1 text-[0.7rem] text-ink-muted sm:inline-flex"><Check size={14} /> saved</span>}
                    <div className="ml-auto flex shrink-0 items-center gap-2">
                        <button type="button" onClick={saveEdit} disabled={fileLoading || !!fileError || writeFile.isPending} className={btnPrimary}>
                            {writeFile.isPending ? 'Saving…' : 'Save'}
                        </button>
                    </div>
                </div>
                <div className="flex min-h-0 flex-1 flex-col">
                    {fileLoading && (
                        <div className="flex flex-col gap-2 p-4">
                            <Skeleton className="h-3 w-2/3" />
                            <Skeleton className="h-3 w-5/6" />
                            <Skeleton className="h-3 w-1/2" />
                        </div>
                    )}
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

    const hasEntries = (data?.entries ?? []).length > 0;
    const filterActive = !!query.trim();

    return (
        <div
            className="relative overflow-hidden rounded-2xl border border-hairline bg-card"
            onDragEnter={(e) => { e.preventDefault(); dragDepth.current += 1; setDragActive(true); }}
            onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }}
            onDragLeave={() => { dragDepth.current = Math.max(0, dragDepth.current - 1); if (!dragDepth.current) setDragActive(false); }}
            onDrop={onDrop}
        >
            {/* ============================ header ============================ */}
            <div className="flex flex-col gap-3 border-b border-hairline px-4 py-3.5 sm:px-5">
                <div className="flex items-center gap-2">
                    <nav aria-label="Breadcrumb" className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto whitespace-nowrap [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                        <button type="button" onClick={() => { setDir([]); setQuery(''); }} aria-label="Root directory" className="flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1.5 font-mono text-[0.85rem] font-bold transition hover:bg-veil">
                            <Home size={15} className="text-ink-secondary" />
                            <span className="hidden sm:inline">root</span>
                        </button>
                        {dir.map((seg, i) => (
                            <span key={i} className="flex shrink-0 items-center gap-1">
                                <ChevronRight size={14} className="text-ink-muted" />
                                <button
                                    type="button"
                                    onClick={() => { setDir(dir.slice(0, i + 1)); setQuery(''); }}
                                    className="max-w-32 truncate rounded-md px-1.5 py-1 font-mono text-[0.85rem] text-ink-secondary transition hover:bg-veil hover:text-foreground"
                                >
                                    {seg}
                                </button>
                            </span>
                        ))}
                    </nav>
                    <div className="flex shrink-0 items-center gap-1.5">
                        <input ref={uploadRef} type="file" multiple className="hidden" onChange={onPick} />
                        <button type="button" onClick={() => uploadRef.current?.click()} disabled={busy || queue.some((q) => q.status === 'uploading')} className={btnPrimary}>
                            <Upload size={16} /> <span className="hidden sm:inline">Upload</span>
                        </button>
                        <button type="button" onClick={() => setSheet({ type: 'new-dir', value: '' })} disabled={busy} className={btnSecondary}>
                            <FolderPlus size={16} /> <span className="hidden sm:inline">New folder</span>
                        </button>
                        <RowMenu
                            label="More file actions"
                            disabled={busy}
                            trigger={<Grid2X2 size={17} />}
                            onSelect={(key) => {
                                if (key === 'new-file') setSheet({ type: 'new-file', value: '' });
                                else if (key === 'refresh') refetch();
                            }}
                            items={[
                                ['new-file', 'New file', FilePlus, false],
                                ['refresh', 'Refresh', RefreshCw, false],
                            ]}
                        />
                    </div>
                </div>

                {/* search + sort + view */}
                <div className="flex flex-wrap items-center gap-2">
                    <div className="relative min-w-[180px] flex-1">
                        <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted" />
                        <input
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            placeholder={filterActive ? 'No matches' : 'Search in this folder…'}
                            aria-label="Search files in this folder"
                            className="input-field pl-9"
                        />
                        {query && (
                            <button type="button" onClick={() => setQuery('')} aria-label="Clear search" className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-ink-muted hover:text-ink">
                                <X size={14} />
                            </button>
                        )}
                    </div>
                    <Select
                        ariaLabel="Sort files by"
                        value={sortBy}
                        onChange={setSortBy}
                        options={SORTS}
                        className="w-[130px]"
                    />
                    <button
                        type="button"
                        onClick={() => setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))}
                        aria-label={`Sort ${sortDir === 'asc' ? 'descending' : 'ascending'}`}
                        className={btnIcon}
                    >
                        <ArrowDownUp size={16} className={cn('transition', sortDir === 'asc' && 'rotate-180')} />
                    </button>
                    <div className="flex items-center gap-1 rounded-full border border-hairline p-0.5">
                        <button
                            type="button"
                            onClick={() => setView('list')}
                            aria-label="List view"
                            aria-pressed={view === 'list'}
                            className={cn('rounded-full p-1.5 transition', view === 'list' ? 'bg-veil text-ink' : 'text-ink-muted hover:text-ink')}
                        >
                            <LayoutList size={16} />
                        </button>
                        <button
                            type="button"
                            onClick={() => setView('grid')}
                            aria-label="Grid view"
                            aria-pressed={view === 'grid'}
                            className={cn('rounded-full p-1.5 transition', view === 'grid' ? 'bg-veil text-ink' : 'text-ink-muted hover:text-ink')}
                        >
                            <Grid2X2 size={16} />
                        </button>
                    </div>
                </div>
            </div>

            {/* ============================ transfers ============================ */}
            {(queue.length > 0 || download) && (
                <div className="flex flex-col gap-2 border-b border-hairline bg-veil/40 px-4 py-3">
                    <p className="text-[0.75rem] font-bold uppercase tracking-wide text-ink-muted">
                        {queue.length ? `Uploading ${queue.length} file${queue.length === 1 ? '' : 's'}…` : `Downloading ${download?.name}…`}
                    </p>
                    {queue.map((it) => (
                        <div key={it.id} className="flex flex-col gap-1.5">
                            <div className="flex items-center gap-3">
                                <span className="min-w-0 flex-1 truncate font-mono text-[0.78rem] text-ink-secondary">{it.name}</span>
                                <span className="shrink-0 font-mono text-[0.72rem] text-ink-muted">
                                    {fmtSize(it.size)} · {it.status === 'failed' ? 'failed' : `${Math.round((it.ratio ?? 0) * 100)}%`}
                                </span>
                                {it.status === 'failed' && (
                                    <button type="button" onClick={() => retryUpload(it.id)} className="shrink-0 rounded-md border border-hairline px-2 py-0.5 font-mono text-[0.7rem] font-bold text-ink-secondary hover:text-ink">Retry</button>
                                )}
                                <button type="button" onClick={() => { it.abort?.(); patchItem(it.id, { status: 'cancelled' }); }} aria-label={`Cancel ${it.name}`} className="shrink-0 rounded-md p-1 text-ink-muted hover:text-red-400">
                                    <X size={14} />
                                </button>
                            </div>
                            <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                                <div
                                    className={cn('h-full rounded-full transition-[width]', it.status === 'failed' ? 'bg-red-500' : 'bg-white')}
                                    style={{ width: `${Math.round((it.ratio ?? 0) * 100)}%` }}
                                />
                            </div>
                            {it.error && <p className="text-[0.72rem] text-red-400">{it.error}</p>}
                        </div>
                    ))}
                    {download && (
                        <div className="flex flex-col gap-1.5">
                            <div className="flex items-center gap-3">
                                <span className="min-w-0 flex-1 truncate font-mono text-[0.78rem] text-ink-secondary">{download.name}</span>
                                <span className="shrink-0 font-mono text-[0.72rem] text-ink-muted">{Math.round((download.ratio ?? 0) * 100)}%</span>
                                <button type="button" onClick={() => download.abort?.()} className="shrink-0 rounded-md border border-red-500/40 px-2 py-0.5 font-mono text-[0.7rem] font-bold text-red-400">Stop</button>
                            </div>
                            <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                                <div className="h-full rounded-full bg-white transition-[width]" style={{ width: `${Math.round((download.ratio ?? 0) * 100)}%` }} />
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* ============================ content ============================ */}
            <div className="p-3 sm:p-4">
                {isLoading && (
                    <div className="flex flex-col gap-2" aria-busy="true">
                        {Array.from({ length: 6 }).map((_, i) => (
                            <div key={i} className="flex items-center gap-3 rounded-xl border border-hairline/60 p-3">
                                <Skeleton className="size-11 rounded-xl" />
                                <div className="flex flex-1 flex-col gap-2">
                                    <Skeleton className="h-3 w-2/5" />
                                    <Skeleton className="h-2.5 w-1/6" />
                                </div>
                            </div>
                        ))}
                    </div>
                )}

                {!isLoading && error && (
                    <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-red-500/40 px-4 py-12 text-center">
                        <p className="text-[0.95rem] font-semibold text-red-400">Unable to load files</p>
                        <p className="max-w-sm text-[0.82rem] text-ink-secondary">{error.message}</p>
                        <button type="button" onClick={() => refetch()} className={btnPrimary}>
                            <RotateCcw size={15} /> Retry
                        </button>
                    </div>
                )}

                {!isLoading && !error && !hasEntries && (
                    <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-hairline px-4 py-14 text-center">
                        <Folder size={34} className="text-ink-muted" />
                        <p className="text-[0.95rem] font-semibold">No files here</p>
                        <p className="max-w-xs text-[0.84rem] text-ink-secondary">Upload files or create a new folder to get started.</p>
                        <div className="mt-1 flex flex-wrap items-center justify-center gap-2">
                            <button type="button" onClick={() => uploadRef.current?.click()} className={btnPrimary}>
                                <Upload size={15} /> Upload files
                            </button>
                            <button type="button" onClick={() => setSheet({ type: 'new-dir', value: '' })} className={btnSecondary}>
                                <FolderPlus size={15} /> New folder
                            </button>
                        </div>
                    </div>
                )}

                {!isLoading && !error && hasEntries && filterActive && entries.length === 0 && (
                    <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-hairline px-4 py-12 text-center">
                        <Search size={28} className="text-ink-muted" />
                        <p className="text-[0.92rem] font-semibold">No matches for “{query.trim()}”</p>
                        <button type="button" onClick={() => setQuery('')} className={btnSecondary}>Clear search</button>
                    </div>
                )}

                {!isLoading && !error && entries.length > 0 && (
                    view === 'grid' ? (
                        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
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
                                            'group relative flex flex-col gap-2 rounded-xl border p-3 transition',
                                            checked ? 'border-blue-400/50 bg-blue-500/10' : 'border-hairline/70 bg-white/[0.03] hover:border-hairline-hover hover:bg-white/[0.06]',
                                            isDir && 'cursor-pointer',
                                        )}
                                    >
                                        <div className="flex items-start justify-between gap-2">
                                            <input
                                                type="checkbox"
                                                checked={checked}
                                                onChange={() => toggleSelect(entry.name)}
                                                onClick={(e) => e.stopPropagation()}
                                                aria-label={`Select ${entry.name}`}
                                                className="size-4 shrink-0 cursor-pointer accent-white"
                                            />
                                            <span onClick={(e) => e.stopPropagation()}>
                                                <RowMenu
                                                    label={`Actions for ${entry.name}`}
                                                    items={rowMenuItems(entry, isDir, isArch)}
                                                    onSelect={(k) => onMenu(k, entry)}
                                                    disabled={busy}
                                                />
                                            </span>
                                        </div>
                                        <button type="button" onClick={() => openEntry(entry)} className="flex min-w-0 flex-1 flex-col items-center gap-2 text-center">
                                            <span className="flex size-14 items-center justify-center rounded-xl bg-gradient-to-br from-white/10 to-white/[0.02]">
                                                {isDir ? <Folder size={26} className="text-sky-300/90" /> : icon ? <img src={icon} alt="" aria-hidden="true" className="size-7" draggable={false} /> : <FileText size={22} className="text-ink-muted" />}
                                            </span>
                                            <span className="w-full truncate text-[0.82rem] font-semibold">{entry.name}</span>
                                            <span className="font-mono text-[0.7rem] text-ink-muted">{isDir ? 'Folder' : fmtSize(entry.size)}</span>
                                        </button>
                                    </div>
                                );
                            })}
                        </div>
                    ) : (
                        <div className="flex flex-col gap-1.5">
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
                                            'group flex items-center gap-3 rounded-xl border px-3 py-2.5 transition',
                                            checked ? 'border-blue-400/50 bg-blue-500/10' : 'border-hairline/70 bg-white/[0.03] hover:border-hairline-hover hover:bg-white/[0.06]',
                                            isDir && 'cursor-pointer',
                                        )}
                                    >
                                        <input
                                            type="checkbox"
                                            checked={checked}
                                            onChange={() => toggleSelect(entry.name)}
                                            onClick={(e) => e.stopPropagation()}
                                            aria-label={`Select ${entry.name}`}
                                            className="size-5 shrink-0 cursor-pointer accent-white"
                                        />
                                        <button type="button" onClick={() => openEntry(entry)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                                            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-white/10 to-white/[0.02]">
                                                {isDir ? <Folder size={20} className="text-sky-300/90" /> : icon ? <img src={icon} alt="" aria-hidden="true" className="size-5" draggable={false} /> : <FileText size={18} className="text-ink-muted" />}
                                            </span>
                                            <span className="min-w-0 flex-1">
                                                <span className="block truncate text-[0.9rem] font-semibold">{entry.name}</span>
                                                <span className="mt-0.5 block font-mono text-[0.7rem] text-ink-muted sm:hidden">
                                                    {isDir ? 'Folder' : fmtSize(entry.size)} · {fmtDate(entry.mtime)}
                                                </span>
                                            </span>
                                        </button>
                                        <span className="hidden w-24 shrink-0 text-right font-mono text-[0.75rem] text-ink-muted md:block">{fmtDate(entry.mtime)}</span>
                                        <span className="hidden w-20 shrink-0 text-right font-mono text-[0.75rem] text-ink-muted sm:block">{isDir ? '—' : fmtSize(entry.size)}</span>
                                        <span onClick={(e) => e.stopPropagation()}>
                                            <RowMenu
                                                label={`Actions for ${entry.name}`}
                                                items={rowMenuItems(entry, isDir, isArch)}
                                                onSelect={(k) => onMenu(k, entry)}
                                                disabled={busy || !!download}
                                            />
                                        </span>
                                    </div>
                                );
                            })}
                        </div>
                    )
                )}
            </div>

            {/* ============================ footer / bulk bar ============================ */}
            {!isLoading && !error && hasEntries && (
                <div className="flex flex-wrap items-center gap-2 border-t border-hairline px-4 py-2.5">
                    <input
                        type="checkbox"
                        checked={allChecked}
                        onChange={() => setSelected(allChecked ? [] : entries.map((e) => e.name))}
                        aria-label="Select all in this folder"
                        className="size-5 shrink-0 cursor-pointer accent-white"
                    />
                    {selected.length > 0 ? (
                        <>
                            <span className="font-mono text-[0.75rem] text-ink-secondary">{selected.length} selected</span>
                            <button type="button" onClick={() => setSheet({ type: 'archive-many', names: [...selected], value: `${selected.length === 1 ? selected[0] : (dir[dir.length - 1] ?? server.name)}.tar.gz` })} disabled={busy} className={btnSecondary}>
                                <Archive size={15} /> Archive
                            </button>
                            <button type="button" onClick={() => setSheet({ type: 'move-many', names: [...selected], value: dirPath })} disabled={busy} className={btnSecondary}>
                                <FolderPlus size={15} /> Move
                            </button>
                            <button type="button" onClick={() => setSheet({ type: 'delete-many', names: [...selected], value: '' })} disabled={busy} className={btnSecondary}>
                                <Trash2 size={15} /> Delete
                            </button>
                            <button type="button" onClick={() => setSelected([])} className="font-mono text-[0.75rem] text-ink-secondary hover:text-foreground">Clear</button>
                        </>
                    ) : (
                        <span className="font-mono text-[0.72rem] text-ink-muted">
                            {dirStats.count} item{dirStats.count === 1 ? '' : 's'} · {fmtSize(dirStats.bytes)} in this folder
                        </span>
                    )}
                    <button
                        type="button"
                        onClick={() => refetch()}
                        disabled={isFetching}
                        aria-label="Refresh file list"
                        className="btnIcon ml-auto"
                    >
                        <RefreshCw size={16} className={cn(isFetching && 'animate-spin')} />
                    </button>
                </div>
            )}

            {/* ============================ drop overlay ============================ */}
            {dragActive && (
                <div className="pointer-events-none absolute inset-0 z-30 flex flex-col items-center justify-center gap-2 bg-black/70 backdrop-blur-sm">
                    <Upload size={30} className="text-white" />
                    <p className="text-[0.95rem] font-bold">Drop to upload</p>
                    <p className="font-mono text-[0.75rem] text-ink-secondary">into {dirPath || '/ (root)'}</p>
                </div>
            )}

            {/* ============================ sheets ============================ */}
            {sheet && sheet.type !== 'discard' && (
                <Sheet
                    title={sheetTitle()}
                    subtitle={sheetSubtitle()}
                    onClose={() => setSheet(null)}
                    onSubmit={submitSheet}
                    submitLabel={
                        sheet.type.startsWith('delete') ? 'Delete' :
                        sheet.type === 'extract' ? 'Extract' :
                        sheet.type.startsWith('archive') ? 'Compress' :
                        sheet.type.startsWith('new') ? 'Create' : 'Save'
                    }
                    danger={sheet.type.startsWith('delete')}
                >
                    {sheet.type.startsWith('delete') ? (
                        <p className="text-[0.88rem] text-ink-secondary">
                            {sheet.names?.length
                                ? `${sheet.names.length} item(s) will be permanently removed. Folders are deleted with everything inside. This cannot be undone.`
                                : sheet.entry.type === 'dir'
                                    ? 'This directory and everything inside it will be permanently removed.'
                                    : 'This file will be permanently removed.'}{' '}
                            This cannot be undone.
                        </p>
                    ) : sheet.type === 'move' || sheet.type === 'move-many' ? (
                        <>
                            <input
                                autoFocus
                                value={sheet.value}
                                onChange={(e) => setSheet((s) => ({ ...s, value: e.target.value }))}
                                placeholder="path/inside/storage"
                                className={cn(inputClass, 'font-mono')}
                            />
                            <p className="mt-2 font-mono text-[0.72rem] text-ink-muted">Destination path inside storage — folders are created as needed.</p>
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