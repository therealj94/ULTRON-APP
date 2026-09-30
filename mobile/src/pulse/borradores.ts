/**
 * LOS BORRADORES DEL CHAT y lo que AURA puede pedir sobre ellos por el bus del contrato.
 *
 *   «Escríbele a Beto que llego tarde»  → `redactar`: queda el borrador en el chat con Beto (resaltado
 *                                          en dorado, para que se vea que lo escribió AURA) y se pide
 *                                          abrir ese hilo. No se envía nada.
 *   «Envíalo»                           → `enviar`: sale el borrador del chat abierto (o el de `para`)
 *                                          con el cifrado de siempre; avisa `enviado` y `hecho`.
 *   «Bórralo»                           → `descartar`.
 *
 * Los manejadores se registran UNA vez al importar este archivo (lo importa PulseProvider). No hay
 * React aquí salvo el gancho para leer un borrador.
 */
import { useSyncExternalStore } from 'react';
import { emitir, escuchar, type AccionApp } from '../nucleo/contrato';
import * as RELEVO from './relevo';
import * as CHATS from './chats';

export type Borrador = { texto: string; deVoz: boolean; en: number };
export type Contacto = { correo: string; nombre: string };

let borradores: Record<string, Borrador> = {};
let abierto: Contacto | null = null;
/** El último que redactó AURA: a quién va «envíalo» si no hay un chat abierto. */
let ultimoRedactado: string | null = null;
const oyentes = new Set<() => void>();

function avisar() {
  for (const f of [...oyentes]) f();
}
function suscribir(f: () => void) {
  oyentes.add(f);
  return () => {
    oyentes.delete(f);
  };
}

/** El borrador del chat con esa persona (null si no hay), vivo. */
export function useBorrador(correo: string): Borrador | null {
  const c = String(correo).toLowerCase();
  return useSyncExternalStore(
    suscribir,
    () => borradores[c] || null,
    () => borradores[c] || null
  );
}

export const borradorDe = (correo: string): Borrador | null => borradores[String(correo).toLowerCase()] || null;

/** Lo que escribe la persona a mano: deja de ser «de voz» (se apaga el brillo dorado). */
export function escribirBorrador(correo: string, texto: string) {
  const c = String(correo).toLowerCase();
  const antes = borradores[c];
  if (!texto) {
    if (!antes) return;
    const { [c]: _fuera, ...resto } = borradores;
    borradores = resto;
  } else {
    if (antes && antes.texto === texto && !antes.deVoz) return;
    borradores = { ...borradores, [c]: { texto, deVoz: false, en: Date.now() } };
  }
  avisar();
}

function ponerDeVoz(correo: string, texto: string) {
  borradores = { ...borradores, [correo]: { texto, deVoz: true, en: Date.now() } };
  ultimoRedactado = correo;
  avisar();
}

function quitar(correo: string) {
  if (!borradores[correo]) return;
  const { [correo]: _fuera, ...resto } = borradores;
  borradores = resto;
  if (ultimoRedactado === correo) ultimoRedactado = null;
  avisar();
}

/** La conversación que se está viendo (la fija PantallaConversacion al abrirse y la suelta al cerrarse). */
export function fijarChatAbierto(c: Contacto | null) {
  abierto = c ? { correo: c.correo.toLowerCase(), nombre: c.nombre } : null;
  avisar();
}
export const chatAbierto = (): Contacto | null => abierto;

/** El borrador del chat abierto, para el contexto que se le manda al cerebro. */
export function borradorActual(): string | undefined {
  return abierto ? borradores[abierto.correo]?.texto : undefined;
}

/** Busca a quién; si la lista todavía no se trajo (recién abierta la app), la trae una vez. */
async function quienEs(con: string): Promise<Contacto | null> {
  let c = RELEVO.resolverContacto(con);
  if (!c && RELEVO.quien()) {
    await CHATS.refrescarLista().catch(() => undefined);
    c = RELEVO.resolverContacto(con);
  }
  return c;
}

/**
 * Envía el borrador del chat con `correo` (o el abierto, o el último que redactó AURA). Lo usa la
 * voz; el botón Enviar de la pantalla va directo por `CHATS.enviarTexto`.
 */
export async function enviarBorrador(correo?: string): Promise<{ ok: boolean; detalle: string; id?: string }> {
  const c = (correo || abierto?.correo || ultimoRedactado || '').toLowerCase();
  if (!c) return { ok: false, detalle: 'No hay ningún chat abierto ni borrador pendiente.' };
  const b = borradores[c];
  if (!b?.texto.trim()) return { ok: false, detalle: 'No hay borrador para enviar en ese chat.' };
  const r = await CHATS.enviarTexto(c, b.texto);
  if (!r.ok) {
    return {
      ok: false,
      detalle:
        r.code === 403
          ? 'Hace falta que esa persona te acepte para escribirle.'
          : r.motivo === 'sin-cuenta'
            ? 'El chat no está conectado.'
            : 'No se pudo enviar. Revisa la conexión.',
    };
  }
  quitar(c);
  return { ok: true, detalle: r.e2e ? 'Enviado, cifrado de punta a punta.' : 'Enviado sin cifrar: esa persona todavía no abrió el chat en ningún aparato.', id: r.id };
}

/* ── lo que llega por el bus ──────────────────────────────────────────────────────────────── */

async function manejar(a: AccionApp) {
  if (a.tipo === 'redactar') {
    if (!RELEVO.quien()) {
      emitir('hecho', { accion: a, ok: false, detalle: 'El chat no está conectado.' });
      return;
    }
    const c = await quienEs(a.para);
    if (!c) {
      emitir('hecho', { accion: a, ok: false, detalle: `No encuentro a «${a.para}» entre tus contactos.` });
      return;
    }
    ponerDeVoz(c.correo, String(a.texto || ''));
    emitir('accion', { tipo: 'abrir_chat', con: c.correo });
    emitir('hecho', { accion: a, ok: true, detalle: `Borrador para ${c.nombre}.` });
    return;
  }
  if (a.tipo === 'enviar') {
    let correo: string | undefined;
    if (a.para) {
      const c = await quienEs(a.para);
      if (!c) {
        emitir('hecho', { accion: a, ok: false, detalle: `No encuentro a «${a.para}» entre tus contactos.` });
        return;
      }
      correo = c.correo;
    }
    const r = await enviarBorrador(correo);
    emitir('hecho', { accion: a, ok: r.ok, detalle: r.detalle });
    return;
  }
  if (a.tipo === 'descartar') {
    const c = abierto?.correo && borradores[abierto.correo] ? abierto.correo : ultimoRedactado;
    if (!c || !borradores[c]) {
      emitir('hecho', { accion: a, ok: false, detalle: 'No hay borrador que borrar.' });
      return;
    }
    quitar(c);
    emitir('hecho', { accion: a, ok: true, detalle: 'Borrador descartado.' });
  }
}

// Una sola vez aunque el módulo se evalúe de nuevo (recarga en caliente): la marca vive en el global.
const g = globalThis as { __auraBorradores?: () => void };
g.__auraBorradores?.();
g.__auraBorradores = escuchar('accion', (a) => {
  if (a.tipo === 'redactar' || a.tipo === 'enviar' || a.tipo === 'descartar') void manejar(a);
});

/** Al salir de la cuenta, los borradores se van con ella. */
RELEVO.alSalir(() => {
  borradores = {};
  ultimoRedactado = null;
  abierto = null;
  avisar();
});
