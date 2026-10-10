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

let decisionesMuestra = 0;
/** Objetivos y tareas inventados para ver «Trabajos» sin el .exe (los mismos campos que arma NotchWindow.Objetivos.cs). */
function muestraTrabajos() {
  const ahora = Date.now();
  return {
    objetivos: [
      { id: 'ob_muestra0001', titulo: 'Cerrar la venta con Maple', meta: 'Propuesta firmada antes del viernes', estado: 'esperando-decision', estadoTexto: 'Espera tu decisión',
        espera: 'Tu decisión: ¿Mando la propuesta a Karla o la revisas tú primero?', pausado: false, terminal: false, revision: 7, siguientePaso: 'Enviar la propuesta', actualizado: ahora - 600_000, nuevo: true,
        decision: { id: 'dob_muestra01', pregunta: '¿Mando la propuesta a Karla o la revisas tú primero?', opciones: [
          { id: 'mandar', etiqueta: 'Mándala', consecuencia: 'Sale hoy desde tu correo' }, { id: 'revisar', etiqueta: 'La reviso yo', consecuencia: 'Te la dejo en borradores' }] } as null | { id: string; pregunta: string; opciones: { id: string; etiqueta: string; consecuencia: string }[] },
        criterios: [{ texto: 'Propuesta enviada', cumplido: false }, { texto: 'Respuesta de Maple', cumplido: false }],
        documentos: [{ nombre: 'Propuesta Maple.docx', version: 2 }],
        eventos: [{ revision: 7, t: ahora - 600_000, texto: 'Preparé el borrador de la propuesta' }, { revision: 5, t: ahora - 7_200_000, texto: 'Leí el último correo de Karla' }] },
      { id: 'ob_muestra0002', titulo: 'Renovar la concesión El Porvenir', meta: '', estado: 'esperando-recurso', estadoTexto: 'Esperando', espera: 'Un recurso: la constancia del INHGEOMIN',
        pausado: false, terminal: false, revision: 3, siguientePaso: 'Pedir la constancia', actualizado: ahora - 86_400_000, nuevo: false, decision: null, criterios: [], documentos: [], eventos: [] },
    ],
    tareas: [
      { id: 't1', titulo: 'Buscar el contrato de 2024', estado: 'running', estadoTexto: 'Trabajando', espera: 'Revisando tus correos de marzo', terminal: false, actualizado: new Date(ahora - 60_000).toISOString(), progreso: { hechos: 3, total: 8, unidad: 'carpetas' } as null | { hechos: number; total: number; unidad: string }, objetivo: 'Cerrar la venta con Maple' as string | null },
      { id: 't2', titulo: 'Resumen de la junta', estado: 'completed', estadoTexto: 'Hecha', espera: '', terminal: true, actualizado: new Date(ahora - 3_600_000).toISOString(), progreso: null, objetivo: null },
    ],
    aviso: null, abrir: null,
  };
}

async function muestra(metodo: string, args: any): Promise<unknown> {
  await new Promise((r) => setTimeout(r, 250));
  switch (metodo) {
    case 'estado': return structuredClone(estadoMuestra);
    case 'entrar.genesis':
    case 'entrar.clave':
      estadoMuestra.sesion = { nombre: 'José', correo: 'jose.h@ordenglobal.org', rol: 'Junta Directiva · Orden Global', nivel: 'junta' };
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
    case 'trabajos.lista': return muestraTrabajos();
    case 'objetivos.abrir': return { objetivo: muestraTrabajos().objetivos.find((o) => o.id === args?.id) ?? muestraTrabajos().objetivos[0], nuevos: ['Preparé el borrador de la propuesta'] };
    case 'objetivos.decidir': {
      // En la muestra, la segunda vez «otro aparato» ya decidió: se ve el 409 como lo ve la persona.
      decisionesMuestra++;
      const despues = { ...muestraTrabajos().objetivos[0], decision: null, revision: 8, estado: 'en-curso', estadoTexto: 'En curso', espera: 'Enviar la propuesta' };
      return decisionesMuestra > 1
        ? { ok: false, conflicto: { codigo: 'ya-decidida', mensaje: 'Cambió desde otro aparato', detalle: 'Esa decisión ya se tomó con otra opción (quizá desde otro aparato).' }, objetivo: despues }
        : { ok: true, conflicto: null, objetivo: despues };
    }
    case 'objetivos.control': return { ok: true, conflicto: null, objetivo: { ...muestraTrabajos().objetivos[0], pausado: args?.accion === 'pausar', estadoTexto: args?.accion === 'pausar' ? 'En pausa' : 'Espera tu decisión' } };
    default:
      // El WhatsApp personal: datos inventados para ver el panel sin el .exe (whatsapp/muestra.ts).
      if (metodo.startsWith('whatsapp.')) return muestraWhatsApp(metodo, args);
      return null;
  }
}
