import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Minus, Plus } from 'lucide-react';
import { Modal } from '@/components/ui/modal.jsx';

const FRAME = 320; // preview frame (px, css pixels, square)
const OUT = 512; // exported crop edge

/**
 * Avatar crop dialog: drag to pan, slider to zoom, circular mask preview.
 * Exports a 512×512 PNG blob via canvas — the backend re-validates content,
 * so client-side cropping is pure UX, not a trust boundary.
 */
export function AvatarCropModal({ open, file, onClose, onSave, busy }) {
  const canvasRef = useRef(null);
  const imgRef = useRef(null);
  const [img, setImg] = useState(null);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const dragRef = useRef(null);
  const [error, setError] = useState(null);

  // load the picked file into an Image
  useEffect(() => {
    if (!open || !file) return;
    setError(null);
    const url = URL.createObjectURL(file);
    const el = new Image();
    el.onload = () => setImg(el);
    el.onerror = () => setError('Could not read this image.');
    el.src = url;
    return () => URL.revokeObjectURL(url);
  }, [open, file]);

  // reset state per file
  useEffect(() => {
    if (img) { setZoom(1); setOffset({ x: 0, y: 0 }); }
  }, [img]);

  // base scale so the image covers the frame at zoom=1
  const base = img ? Math.max(FRAME / img.naturalWidth, FRAME / img.naturalHeight) : 1;
  const scale = base * zoom;
  const dispW = img ? img.naturalWidth * scale : 0;
  const dispH = img ? img.naturalHeight * scale : 0;

  // keep the image covering the whole frame
  const clamp = useCallback(
    (o) => ({
      x: Math.min(0, Math.max(FRAME - dispW, o.x)),
      y: Math.min(0, Math.max(FRAME - dispH, o.y)),
    }),
    [dispW, dispH],
  );

  useEffect(() => { setOffset((o) => clamp(o)); }, [clamp]);

  const draw = useCallback(() => {
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx || !img) return;
    ctx.clearRect(0, 0, FRAME, FRAME);
    ctx.save();
    ctx.beginPath();
    ctx.arc(FRAME / 2, FRAME / 2, FRAME / 2, 0, Math.PI * 2);
    ctx.clip();
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, offset.x, offset.y, dispW, dispH);
    ctx.restore();
  }, [img, offset, dispW, dispH]);

  useEffect(() => { draw(); }, [draw]);

  const onPointerDown = (e) => {
    e.preventDefault();
    dragRef.current = { sx: e.clientX, sy: e.clientY, ox: offset.x, oy: offset.y };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e) => {
    const d = dragRef.current;
    if (!d) return;
    setOffset(clamp({ x: d.ox + (e.clientX - d.sx), y: d.oy + (e.clientY - d.sy) }));
  };
  const onPointerUp = () => { dragRef.current = null; };

  const save = () => {
    if (!img) return;
    const out = document.createElement('canvas');
    out.width = OUT;
    out.height = OUT;
    const ctx = out.getContext('2d');
    // map frame → source pixels
    const sx = -offset.x / scale;
    const sy = -offset.y / scale;
    const sSize = FRAME / scale;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, sx, sy, sSize, sSize, 0, 0, OUT, OUT);
    out.toBlob((blob) => { if (blob) onSave(blob); }, 'image/png');
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Adjust your photo"
      description="Drag to position, then save. The final avatar is a square."
      busy={busy}
      footer={
        <>
          <button type="button" onClick={onClose} disabled={busy} className="btn-ghost-modal">Cancel</button>
          <button type="button" onClick={save} disabled={busy || !img} className="btn-primary-modal">
            {busy && <Loader2 size={15} className="animate-spin" />}
            Save photo
          </button>
        </>
      }
    >
      <div className="flex flex-col items-center gap-4">
        {error && <p className="text-[0.85rem] text-red-400">{error}</p>}
        <div
          className="relative touch-none select-none overflow-hidden rounded-full border border-hairline bg-black/50"
          style={{ width: FRAME, height: FRAME, maxWidth: '100%' }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <canvas ref={canvasRef} width={FRAME} height={FRAME} className="block size-full cursor-grab active:cursor-grabbing" />
          {!img && !error && <div className="absolute inset-0 animate-pulse bg-veil" />}
        </div>
        <div className="flex w-full items-center gap-3">
          <Minus size={15} className="shrink-0 text-ink-muted" />
          <input
            type="range"
            min={1}
            max={3}
            step={0.01}
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
            aria-label="Zoom"
            className="w-full accent-white"
          />
          <Plus size={15} className="shrink-0 text-ink-muted" />
        </div>
        <p className="text-center text-[0.78rem] text-ink-muted">JPEG, PNG or WebP — up to 5 MB.</p>
      </div>
    </Modal>
  );
}
