import { useEffect, useRef, useState } from 'react';
import {
    ChevronRight,
    Download,
    FileText,
    Folder,
    Pencil,
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
    useDeleteFile,
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

const fmtSize = (b) => {
    if (!b) return '—';
    const u = ['B', 'KB', 'MB', 'GB'];
    let i = 0, v = b;
    while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
    return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${u[i]}`;
};

function join(segs) { return segs.join('/'); }

export default function ServerFiles({ server }) {
    const toast = useToast();
    const [dir, setDir] = useState([]);
    const [editing, setEditing] = useState(null); // rel path being edited
    const [draft, setDraft] = useState('');
    const [showNew, setShowNew] = useState(null); // 'file' | 'dir' | null
    const [newName, setNewName] = useState('');
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

    useEffect(() => {
        if (fileData) setDraft(fileData.content ?? '');
    }, [fileData]);

    const fail = (e) => toast.error(e.message);

    const openEntry = (entry) => {
        const rel = join([...dir, entry.name]);
        if (entry.type === 'dir') setDir([...dir, entry.name]);
        else if (entry.type === 'file') { setEditing(rel); setDraft(''); }
        else toast.info('Symlinks and special files can only be downloaded or deleted.');
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
        const rel = join([...dir, name]);
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
        if (f.size > 2 * 1024 * 1024) { toast.error('Uploads are capped at 2MB — use larger files via deploy instead.'); return; }
        try {
            const b64 = await blobToBase64(f);
            await writeFile.mutateAsync({ path: join([...dir, f.name]), contentBase64: b64 });
            toast.success(`Uploaded ${f.name}.`);
            refetch();
        } catch (err) { fail(err); }
    };

    const onDownload = async (entry) => {
        try {
            await downloadServerFile(server.id, join([...dir, entry.name]));
        } catch (e) { fail(e); }
    };

    const onRename = async (entry) => {
        const next = window.prompt('Rename to:', entry.name);
        if (!next || next === entry.name) return;
        if (/[/\\]/.test(next)) { toast.error('Name cannot contain slashes.'); return; }
        try {
            await rename.mutateAsync({ from: join([...dir, entry.name]), to: join([...dir, next.trim()]) });
            toast.success('Renamed.');
            refetch();
        } catch (e) { fail(e); }
    };

    const onDelete = async (entry) => {
        if (!window.confirm(`Delete "${entry.name}"${entry.type === 'dir' ? ' and everything inside it' : ''}?`)) return;
        try {
            await remove.mutateAsync(join([...dir, entry.name]));
            toast.success('Deleted.');
            if (editing === join([...dir, entry.name])) setEditing(null);
            refetch();
        } catch (e) { fail(e); }
    };

    const entries = [...(data?.entries ?? [])].sort((a, b) =>
        (a.type === 'dir' ? 0 : 1) - (b.type === 'dir' ? 0 : 1) || a.name.localeCompare(b.name));

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
                    <button type="button" onClick={() => uploadRef.current?.click()} className={actionBtn}>
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

            <div className="flex flex-col divide-y divide-hairline">
                {isLoading && <p className="px-5 py-8 text-center text-[0.88rem] text-ink-muted">Loading…</p>}
                {error && <p className="px-5 py-8 text-center text-[0.88rem] text-red-400">Failed to load: {error.message}</p>}
                {!isLoading && !error && entries.length === 0 && (
                    <p className="px-5 py-8 text-center text-[0.88rem] text-ink-muted">Empty folder.</p>
                )}
                {entries.map((entry) => (
                    <div key={entry.name} className="group flex items-center gap-3 px-5 py-3">
                        <button type="button" onClick={() => openEntry(entry)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                            {entry.type === 'dir' ? (
                                <Folder className="size-[18px] shrink-0 text-ink-muted" />
                            ) : (
                                <FileText className="size-[18px] shrink-0 text-ink-muted" />
                            )}
                            <span className="truncate font-mono text-[0.88rem] font-semibold">{entry.name}</span>
                            <span className="ml-auto shrink-0 font-mono text-[0.78rem] text-ink-muted">
                                {entry.type === 'dir' ? '' : fmtSize(entry.size)}
                            </span>
                            <span className="hidden shrink-0 font-mono text-[0.78rem] text-ink-muted sm:block">
                                {entry.mtime ? new Date(entry.mtime * 1000).toLocaleDateString() : '—'}
                            </span>
                        </button>
                        <span className="flex shrink-0 items-center gap-1 opacity-0 transition group-hover:opacity-100 focus-within:opacity-100">
                            {entry.type === 'file' && (
                                <button type="button" aria-label={`Edit ${entry.name}`} onClick={() => openEntry(entry)} className={actionBtn}>
                                    <Pencil className="size-3.5" />
                                </button>
                            )}
                            <button type="button" aria-label={`Download ${entry.name}`} onClick={() => onDownload(entry)} className={actionBtn}>
                                <Download className="size-3.5" />
                            </button>
                            <button type="button" aria-label={`Rename ${entry.name}`} onClick={() => onRename(entry)} className={cn(actionBtn, 'max-md:hidden')}>
                                Rename
                            </button>
                            <button
                                type="button"
                                aria-label={`Delete ${entry.name}`}
                                onClick={() => onDelete(entry)}
                                className={cn(actionBtn, 'hover:!border-red-500/50 hover:!text-red-400')}
                            >
                                <Trash2 className="size-3.5" />
                            </button>
                        </span>
                    </div>
                ))}
            </div>

            {editing && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => setEditing(null)}>
                    <div onClick={(e) => e.stopPropagation()} className="flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-hairline bg-card">
                        <div className="flex items-center gap-2 border-b border-hairline px-5 py-3">
                            <FileText className="size-4 text-ink-muted" />
                            <span className="truncate font-mono text-[0.85rem] font-bold">{editing}</span>
                            <button type="button" onClick={() => setEditing(null)} aria-label="Close editor" className="ml-auto rounded-md p-1.5 text-ink-secondary hover:bg-veil hover:text-foreground">
                                <X className="size-4" />
                            </button>
                        </div>
                        <div className="min-h-0 flex-1 overflow-auto p-5">
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
                                    className="h-[50vh] w-full resize-none rounded-lg border border-hairline bg-black/40 p-4 font-mono text-[0.82rem] leading-relaxed text-foreground focus:border-primary focus:outline-none"
                                />
                            )}
                        </div>
                        <div className="flex items-center gap-2 border-t border-hairline px-5 py-3">
                            <button
                                type="button"
                                onClick={saveEdit}
                                disabled={fileLoading || !!fileError || writeFile.isPending}
                                className="rounded-full bg-white px-6 py-2 text-[0.83rem] font-bold text-black transition hover:bg-gray-200 disabled:opacity-50"
                            >
                                {writeFile.isPending ? 'Saving…' : 'Save'}
                            </button>
                            <button
                                type="button"
                                onClick={() => onDownload({ name: editing.split('/').pop(), type: 'file' }).then(() => {})}
                                className="rounded-full border border-hairline px-5 py-2 text-[0.83rem] font-bold text-ink-secondary transition hover:text-foreground"
                            >
                                Download
                            </button>
                            <span className="ml-auto font-mono text-[0.72rem] text-ink-muted">512KB edit cap</span>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
