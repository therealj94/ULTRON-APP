/**
 * El puente entre la página del Centro y AURA (el .exe, C#), por WebView2.
 *
 *   página → AURA: puente.pedir('metodo', args) → promesa con lo que devuelve (o el error, con su texto).
 *   AURA → página: puente.al('evento', fn) → avisos que llegan solos (estado, chat, música, llamadas…).
 *
 * TODO lo que sale a la red pasa por AURA (C#): la sesión de AU-RA, los tokens de Spotify y Google, las
 * claves de PULSE2CHAT viven allá, cifrados con DPAPI; la página no ve ninguno y no tiene CORS que pelear.
 *
 * Fuera de WebView2 (abrir centro/public/index.html en un navegador, o las pruebas), el puente responde
 * con datos de muestra: así la página se diseña y se prueba sin el .exe. Ver PUENTE.md.
 */

import { muestraWhatsApp } from './whatsapp/muestra';

type Respuesta = { id: number; ok: boolean; valor?: unknown; error?: string };
type Evento = { evento: string; datos: unknown };

const webview = (globalThis as any).chrome?.webview as
  | { postMessage(m: unknown): void; addEventListener(t: 'message', f: (e: { data: unknown }) => void): void }
  | undefined;

export const enAura = !!webview;

let siguiente = 1;
const pendientes = new Map<number, { ok: (v: any) => void; mal: (e: Error) => void }>();
const oyentes = new Map<string, Set<(d: any) => void>>();

function recibir(m: unknown) {
  const r = m as Partial<Respuesta & Evento>;
  if (typeof r?.id === 'number' && pendientes.has(r.id)) {
    const p = pendientes.get(r.id)!;
    pendientes.delete(r.id);
    if (r.ok) p.ok(r.valor);
    else p.mal(Object.assign(new Error(r.error || 'AURA no pudo hacerlo'), { desdeAura: true }));
    return;
  }
  if (typeof r?.evento === 'string') for (const f of oyentes.get(r.evento) ?? []) try { f(r.datos); } catch (e) { console.error(e); }
}
webview?.addEventListener('message', (e) => recibir(e.data));

/** Llama a AURA. `ms`: cuánto esperar como mucho (por omisión 60 s; el inicio de sesión espera más). */
export function pedir<T = any>(metodo: string, args?: unknown, ms = 60_000): Promise<T> {
  if (!webview) return muestra(metodo, args) as Promise<T>;
  const id = siguiente++;
  return new Promise<T>((ok, mal) => {
    const t = setTimeout(() => { pendientes.delete(id); mal(new Error('AURA no contestó a tiempo')); }, ms);
    pendientes.set(id, { ok: (v) => { clearTimeout(t); ok(v); }, mal: (e) => { clearTimeout(t); mal(e); } });
    webview.postMessage({ id, metodo, args: args ?? null });
  });
}

/** Escucha un evento de AURA; devuelve cómo dejar de escucharlo. */
export function al<T = any>(evento: string, f: (d: T) => void): () => void {
  if (!oyentes.has(evento)) oyentes.set(evento, new Set());
  oyentes.get(evento)!.add(f);
  return () => oyentes.get(evento)?.delete(f);
}

/** Solo para pruebas y el modo muestra: dispara un evento como si viniera de AURA. */
export function _emitir(evento: string, datos: unknown) { recibir({ evento, datos }); }

// ───────────── modo muestra (sin el .exe) ─────────────

const estadoMuestra = {
  version: 'muestra',
  sesion: null as null | { nombre: string; correo: string; rol: string; nivel: string },
  avatar: 'aura', idioma: 'es', primeraVez: true,
  conexiones: { spotify: null, google: null, microsoft: null } as Record<string, string | null>,
  cartera: { direccion: '' },
};

async function muestra(metodo: string, args: any): Promise<unknown> {
  await new Promise((r) => setTimeout(r, 250));
  switch (metodo) {
    case 'estado': return structuredClone(estadoMuestra);
    case 'entrar.genesis':
    case 'entrar.clave':
      estadoMuestra.sesion = { nombre: 'José', correo: 'jose@ordenglobal.org', rol: 'Junta Directiva · Orden Global', nivel: 'junta' };
      return { miembro: estadoMuestra.sesion };
    case 'salir': estadoMuestra.sesion = null; return true;
    case 'app.cerrar': return true;
    case 'ajustes.leer': return { avatar: 'aura', idioma: 'es', escucha: 'palabra', responderConVoz: true, interrumpir: true, avisosDeApps: true };
    case 'ajustes.guardar': Object.assign(estadoMuestra, args ?? {}); return true;
    case 'primeraVez.terminar': estadoMuestra.primeraVez = false; return true;
    case 'cartera.saldos':
      return { direccion: '0x12ab…9f3c', total: 1843.2, moneda: 'USD', saldos: [
        { simbolo: 'ORIGEN', cantidad: 1520.4, usd: 1321.6 }, { simbolo: 'AUKA', cantidad: 0.12, usd: 492.1 }, { simbolo: 'AGKA', cantidad: 1, usd: 29.5 }] };
    case 'spotify.estado': return { conectado: false, sonando: null };
    default:
      // El WhatsApp personal: datos inventados para ver el panel sin el .exe (whatsapp/muestra.ts).
      if (metodo.startsWith('whatsapp.')) return muestraWhatsApp(metodo, args);
      return null;
  }
}
