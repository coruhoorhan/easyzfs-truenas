// Diálogo de recorte cuadrado para la foto de perfil.
// Carga la imagen (corrige orientación EXIF), la muestra en un visor
// cuadrado con pan (arrastrar) y zoom (rueda/botones/slider) y exporta un
// recorte 1:1 de 512×512 en WebP (fallback JPEG si el navegador no soporta
// WebP). El resultado se sube tal cual a PUT /api/me/avatar.
import { useCallback, useEffect, useRef, useState } from 'react';
import { ModalBox } from './Modal';
import { IconPlus, IconMinus } from './icons';
import { t } from '../ui/i18n';

// Tamaño lógico del visor (px) — debe coincidir con .crop-vp en index.css.
const VP = 280;
// Lado del cuadrado exportado.
const OUT = 512;

type ImgSource = ImageBitmap | HTMLImageElement;

interface Props {
  file: File;
  onClose(): void;
  /** Se llama con el blob recortado; el padre lo sube y refresca la sesión. */
  onCrop(blob: Blob): Promise<void> | void;
}

function naturalSize(img: ImgSource): { w: number; h: number } {
  if (img instanceof HTMLImageElement) return { w: img.naturalWidth, h: img.naturalHeight };
  return { w: img.width, h: img.height };
}

export function AvatarCropDialog({ file, onClose, onCrop }: Props) {
  const [img, setImg] = useState<ImgSource | null>(null);
  // URL para pintar cuando la fuente es un ImageBitmap (sin src propio).
  const [previewUrl, setPreviewUrl] = useState('');
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Arrastre con puntero (ratón y táctil).
  const dragRef = useRef<{ active: boolean; sx: number; sy: number; px: number; py: number }>(
    { active: false, sx: 0, sy: 0, px: 0, py: 0 });

  // Carga de la imagen con corrección EXIF. createImageBitmap con
  // imageOrientation:'from-image' rota según EXIF (Chrome/FF/Safari 15+);
  // si no está disponible cae a <img> + objectURL (los navegadores modernos
  // también aplican EXIF al pintar).
  useEffect(() => {
    let cancelado = false;
    let url = '';
    (async () => {
      try {
        let src: ImgSource;
        if ('createImageBitmap' in window) {
          try {
            src = await createImageBitmap(file, { imageOrientation: 'from-image' });
          } catch {
            src = await loadViaImg(file);
          }
        } else {
          src = await loadViaImg(file);
        }
        if (cancelado) return;
        if (src instanceof ImageBitmap) {
          url = URL.createObjectURL(file);
          setPreviewUrl(url);
        }
        setImg(src);
        setZoom(1);
        setPan(centerPan(src, 1));
      } catch {
        setErr(t('crop_err'));
      }
    })();
    return () => {
      cancelado = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [file]); // eslint-disable-line react-hooks/exhaustive-deps

  // Posición centrada para un zoom dado (la imagen siempre cubre el visor).
  function centerPan(src: ImgSource, z: number) {
    const { w, h } = naturalSize(src);
    const s = (VP / Math.min(w, h)) * z;
    return { x: (VP - w * s) / 2, y: (VP - h * s) / 2 };
  }

  function clamp(p: { x: number; y: number }, src: ImgSource, z: number) {
    const { w, h } = naturalSize(src);
    const s = (VP / Math.min(w, h)) * z;
    return {
      x: Math.min(0, Math.max(VP - w * s, p.x)),
      y: Math.min(0, Math.max(VP - h * s, p.y)),
    };
  }

  // Cambio de zoom conservando el centro del visor.
  const applyZoom = useCallback((next: number) => {
    setZoom((z0) => {
      const nz = Math.min(4, Math.max(1, next));
      setPan((p0) => {
        if (!img) return p0;
        const { w, h } = naturalSize(img);
        const side0 = (VP / Math.min(w, h)) * z0;
        // Punto de la imagen que está en el centro del visor antes del zoom.
        const cx = (VP / 2 - p0.x) / side0;
        const cy = (VP / 2 - p0.y) / side0;
        const s = (VP / Math.min(w, h)) * nz;
        return clamp({ x: VP / 2 - cx * s, y: VP / 2 - cy * s }, img, nz);
      });
      return nz;
    });
  }, [img]);

  function onWheel(e: React.WheelEvent) {
    e.preventDefault();
    applyZoom(zoom * (e.deltaY < 0 ? 1.12 : 1 / 1.12));
  }

  function onPointerDown(e: React.PointerEvent) {
    (e.target as Element).setPointerCapture(e.pointerId);
    dragRef.current = { active: true, sx: e.clientX, sy: e.clientY, px: pan.x, py: pan.y };
  }
  function onPointerMove(e: React.PointerEvent) {
    const d = dragRef.current;
    if (!d.active || !img) return;
    setPan(clamp({ x: d.px + (e.clientX - d.sx), y: d.py + (e.clientY - d.sy) }, img, zoom));
  }
  function onPointerUp() { dragRef.current.active = false; }

  // Export: el rectángulo visible en coordenadas de imagen → canvas 512².
  async function exportCrop(): Promise<Blob> {
    if (!img) throw new Error('no image');
    const { w, h } = naturalSize(img);
    const s = (VP / Math.min(w, h)) * zoom;
    const sx = -pan.x / s, sy = -pan.y / s, side = VP / s;
    const canvas = document.createElement('canvas');
    canvas.width = OUT; canvas.height = OUT;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no canvas');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, sx, sy, side, side, 0, 0, OUT, OUT);
    return new Promise((resolve, reject) => {
      const done = (blob: Blob | null) =>
        blob ? resolve(blob) : reject(new Error('encode failed'));
      canvas.toBlob((b) => {
        if (b && b.size > 0) done(b);
        else canvas.toBlob(done, 'image/jpeg', 0.85); // fallback sin WebP
      }, 'image/webp', 0.85);
    });
  }

  async function save() {
    setBusy(true); setErr(null);
    try {
      const blob = await exportCrop();
      if (blob.size > 512 * 1024) { setErr(t('crop_too_big')); return; }
      await onCrop(blob);
      onClose();
    } catch {
      setErr(t('crop_err'));
    } finally {
      setBusy(false);
    }
  }

  const iw = img ? naturalSize(img).w : 0;
  const ih = img ? naturalSize(img).h : 0;
  const scale = img ? (VP / Math.min(iw, ih)) * zoom : 1;
  const src = img instanceof HTMLImageElement ? img.src : previewUrl;

  return (
    <ModalBox label={t('crop_title')} onClose={onClose}>
      <div className="crop-wrap">
        <div className="crop-vp" onWheel={onWheel}
          onPointerDown={onPointerDown} onPointerMove={onPointerMove}
          onPointerUp={onPointerUp} onPointerCancel={onPointerUp}>
          {img && src && (
            <img src={src} alt="" draggable={false} className="crop-img"
              style={{
                width: iw * scale, height: ih * scale,
                transform: `translate(${pan.x}px, ${pan.y}px)`,
              }} />
          )}
          <div className="crop-grid" aria-hidden="true" />
        </div>
        <div className="crop-controls">
          <button type="button" className="iconbtn" onClick={() => applyZoom(zoom / 1.25)}
            aria-label={t('crop_zoom_out')} title={t('crop_zoom_out')}><IconMinus /></button>
          <input type="range" min={1} max={4} step={0.01} value={zoom}
            onChange={(e) => applyZoom(Number(e.target.value))}
            aria-label={t('crop_zoom')} />
          <button type="button" className="iconbtn" onClick={() => applyZoom(zoom * 1.25)}
            aria-label={t('crop_zoom_in')} title={t('crop_zoom_in')}><IconPlus /></button>
        </div>
        <p className="crop-hint">{t('crop_hint')}</p>
        {err && <p className="form-err" role="alert">{err}</p>}
        <div className="m-actions">
          <button type="button" className="btn" onClick={onClose}>{t('cancel')}</button>
          <button type="button" className="btn primary" onClick={save}
            disabled={busy || !img}>{busy ? t('saving') : t('crop_save')}</button>
        </div>
      </div>
    </ModalBox>
  );
}

async function loadViaImg(file: File): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  const el = new Image();
  el.src = url;
  await el.decode();
  return el;
}
