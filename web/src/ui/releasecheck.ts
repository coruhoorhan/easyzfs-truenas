// releasecheck.ts — aviso pasivo de releases nuevas en GitHub. Comprueba la
// última release UNA vez al día por navegador (caché en localStorage) con una
// GET anónima: nada de botón "comprobar actualizaciones" ni phone-home del
// servidor. Si hay versión más nueva, la shell muestra un ribbon superior
// (descartable por versión) y Ajustes un icono en la zona admin.
import { useEffect, useState } from 'react';

const REPO = 'gnacho/easyzfs';
export const RELEASES_URL = `https://github.com/${REPO}/releases`;
const CACHE_KEY = 'easyzfs-release-check';
const DISMISS_KEY = 'easyzfs-release-dismissed';
const DAY_MS = 24 * 60 * 60 * 1000;

export type ReleaseState =
  | { kind: 'unknown' }
  | { kind: 'uptodate' }
  | { kind: 'available'; version: string; url: string };

interface Cache { ts: number; tag: string; url: string }

// Comparación semver numérica ('v' opcional): 1.10.0 > 1.9.0.
export function compareSemver(a: string, b: string): number {
  const pa = a.replace(/^v/, '').split('.').map((x) => parseInt(x, 10) || 0);
  const pb = b.replace(/^v/, '').split('.').map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

function readCache(): Cache | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const c = JSON.parse(raw) as Cache;
    return typeof c?.ts === 'number' && typeof c?.tag === 'string' ? c : null;
  } catch { return null; }
}

async function fetchLatest(): Promise<Cache> {
  let res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`);
  let tag = '';
  let url = RELEASES_URL;
  if (res.ok) {
    const j = await res.json();
    tag = j.tag_name ?? '';
    url = j.html_url ?? url;
  } else if (res.status === 404) {
    // Sin release publicada: fallback al último tag
    res = await fetch(`https://api.github.com/repos/${REPO}/tags?per_page=1`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const tags = await res.json();
    tag = tags?.[0]?.name ?? '';
    url = `${RELEASES_URL}/tag/${tag}`;
  } else {
    throw new Error(`HTTP ${res.status}`); // 403 = rate-limit 60/h por IP
  }
  const c: Cache = { ts: Date.now(), tag, url };
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(c)); } catch { /* sin storage */ }
  return c;
}

function toState(c: Cache | null, currentVersion: string | undefined): ReleaseState {
  if (!c || !c.tag || !currentVersion) return { kind: 'unknown' };
  return compareSemver(c.tag, currentVersion) > 0
    ? { kind: 'available', version: c.tag.replace(/^v/, ''), url: c.url }
    : { kind: 'uptodate' };
}

// useReleaseCheck — estado de release respecto a currentVersion. Solo actúa
// con enabled=true (sesión real, no demo). Como mucho 1 fetch/día/navegador.
export function useReleaseCheck(currentVersion: string | undefined, enabled: boolean): ReleaseState {
  const [cache, setCache] = useState<Cache | null>(() => readCache());

  useEffect(() => {
    if (!enabled) return;
    const c = readCache();
    if (c && Date.now() - c.ts < DAY_MS) { setCache(c); return; }
    let alive = true;
    fetchLatest().then((n) => { if (alive) setCache(n); }).catch(() => {
      // Sin red/rate-limit: conserva la caché anterior (si la hay)
      if (alive) setCache(readCache());
    });
    return () => { alive = false; };
  }, [enabled]);

  return toState(cache, currentVersion);
}

// Dismissal del ribbon por versión (vuelve a salir si aparece otra más nueva).
export function getReleaseDismissed(): string {
  return localStorage.getItem(DISMISS_KEY) ?? '';
}
export function dismissRelease(version: string): void {
  try { localStorage.setItem(DISMISS_KEY, version); } catch { /* sin storage */ }
}
