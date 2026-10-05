/**
 * EL ADAPTADOR DE CONTADORES DE LA INICIATIVA (P1/A2, auditoría del 4-oct).
 *
 * La iniciativa propone «tienes 3 correos sin leer» y, antes de mostrarlo o de avisar, lo REVALIDA
 * (lib/iniciativa.ts revalidarPropuesta). Hasta aquí las rutas y el reloj productivos no le pasaban ningún
 * contador: todo quedaba «sin observar» y se aceptaba. Este adaptador es el único que observa correo y
 * WhatsApp para la iniciativa, y server.ts lo da a la vez a las rutas y al reloj (server/iniciativa.ts
 * componerIniciativa).
 *
 * Cada fuente sale con UNO de cinco estados, nunca intercambiables:
 *   · vigente        — se leyó y hay `valor` sin leer (> 0);
 *   · empty          — se leyó y no hay nada;
 *   · unavailable    — no se pudo leer ahora (caída, tiempo agotado, una de sus cuentas falló: cobertura parcial);
 *   · disconnected   — la clave ya no entra en NINGUNA de sus cuentas, o su WhatsApp se desvinculó;
 *   · not_configured — no tiene esa fuente.
 * Un error nunca es `empty` ni un 0. Solo se miran las cuentas DE ESA PERSONA (sus cuentas de correo; el
 * WhatsApp solo si es su dueño, WHATSAPP_DUENOS): nunca otra cuenta como respaldo.
 */
import type { Observacion } from '../lib/iniciativa';
import type { Contadores, FuenteContadores } from './iniciativa';
import { listar, type Cobertura } from '../lib/correo/buzon';
import { leerCuentasSeguro, type CuentaCorreo } from '../lib/correo/cuentas';
import { chatsWA, esDuenoWhatsapp, estadoWA, whatsappDisponible, whatsappPermitido } from './whatsapp';

type CuentaMinima = { id: string; correo: string };

export type DepsContadores<C extends CuentaMinima = CuentaMinima> = {
  correo?: {
    /** Sus cuentas guardadas; `{ ok: false }` si no se pudieron leer (no es «no tiene»). */
    cuentas: (dueno: string) => Promise<{ ok: true; cuentas: C[] } | { ok: false }>;
    /** Cuántos sin leer hay en ESA cuenta de ESE dueño. Lanza si no pudo leer. */
    noLeidos: (dueno: string, cuenta: C) => Promise<number>;
  };
  whatsapp?: {
    /** ¿Puede tener su WhatsApp aquí? (whatsappPermitido). Si no, ni se mira. */
    permitido: (dueno: string) => boolean | Promise<boolean>;
    /** ¿Hay puente configurado? */
    disponible: () => boolean;
    /** El de ESA cuenta. `registrada: false`: nunca empezó a vincular (no es «se desconectó»). */
    estado: (dueno: string) => Promise<{ vinculado: boolean; conectado: boolean; registrada?: boolean }>;
    chats: (dueno: string) => Promise<{ noLeidos: number }[]>;
  };
  reloj?: () => number;
  /** Tope por consulta (una cuenta, el puente): pasado, la fuente queda `unavailable`. */
  timeoutMs?: number;
};

/** ¿El proveedor rechazó la clave? (la misma lectura que lib/correo/buzon.ts explicarFallo). */
export function esFalloDeAutorizacion(e: any): boolean {
  const crudo = String(e?.responseText || e?.response || e?.message || e || '');
  const todo = `${String(e?.code || '')} ${e?.serverResponseCode || ''} ${crudo}`;
  return !!e?.authenticationFailed || e?.code === 'EAUTH' || e?.responseCode === 535 || /AUTHENTICATIONFAILED|authentication failed|invalid credentials|incorrect (password|username)|login failed|\b535\b/i.test(todo);
}

function conTope<T>(p: Promise<T>, ms: number): Promise<T> {
  let t: NodeJS.Timeout | undefined;
  return Promise.race([
    p.finally(() => t && clearTimeout(t)),
    new Promise<T>((_, rechazar) => {
      t = setTimeout(() => rechazar(Object.assign(new Error('tiempo agotado'), { code: 'ETIMEDOUT' })), ms);
      t.unref?.();
    }),
  ]);
}

export function crearContadores<C extends CuentaMinima = CuentaMinima>(d: DepsContadores<C>): FuenteContadores & ((correo: string) => Promise<Contadores>) {
  const tope = d.timeoutMs ?? 8000;
  const reloj = () => (d.reloj ? d.reloj() : Date.now());

  async function correo(dueno: string, visto: number): Promise<Observacion> {
    if (!d.correo) return { estado: 'not_configured', visto };
    let leidas: { ok: true; cuentas: C[] } | { ok: false };
    try {
      leidas = await conTope(d.correo.cuentas(dueno), tope);
    } catch {
      return { estado: 'unavailable', visto };
    }
    if (!leidas.ok) return { estado: 'unavailable', visto };
    if (!leidas.cuentas.length) return { estado: 'not_configured', visto };
    const r = await Promise.all(
      leidas.cuentas.map(async (c) => {
        try {
          const n = await conTope(d.correo!.noLeidos(dueno, c), tope);
          return Number.isFinite(n) && n >= 0 ? { n: Math.floor(n) } : { fallo: 'otro' as const };
        } catch (e) {
          return { fallo: esFalloDeAutorizacion(e) ? ('clave' as const) : ('otro' as const) };
        }
      })
    );
    if (r.every((x) => 'fallo' in x && x.fallo === 'clave')) return { estado: 'disconnected', visto };
    // Una cuenta que no se pudo leer: no se sabe el total (no se afirma la mitad como si fuera todo).
    if (r.some((x) => 'fallo' in x)) return { estado: 'unavailable', visto };
    const total = r.reduce((s, x) => s + ('n' in x ? x.n : 0), 0);
    return total > 0 ? { estado: 'vigente', valor: total, version: total, visto } : { estado: 'empty', visto };
  }

  async function whatsapp(dueno: string, visto: number): Promise<Observacion> {
    const w = d.whatsapp;
    // Solo el WhatsApp de su dueño: a nadie más se le mira (ni como respaldo).
    if (!w || !w.disponible() || !(await w.permitido(dueno))) return { estado: 'not_configured', visto };
    try {
      const e = await conTope(w.estado(dueno), tope);
      // Quien nunca agregó su WhatsApp no tiene nada «desconectado» que avisarle.
      if (!e?.vinculado) return { estado: e?.registrada === false && !esDuenoWhatsapp(dueno) ? 'not_configured' : 'disconnected', visto };
      if (!e.conectado) return { estado: 'unavailable', visto };
      const chats = await conTope(w.chats(dueno), tope);
      const n = chats.filter((c) => Number(c?.noLeidos) > 0).length;
      return n > 0 ? { estado: 'vigente', valor: n, version: n, visto } : { estado: 'empty', visto };
    } catch {
      return { estado: 'unavailable', visto };
    }
  }

  /** La forma vieja (para quien todavía lee `correoSinLeer`): vigente → n, empty → 0, sin poder leer → null. */
  const viejo = (o: Observacion): number | null | undefined => (o.estado === 'vigente' ? o.valor : o.estado === 'empty' ? 0 : o.estado === 'not_configured' ? undefined : null);

  return async (correoCrudo: string): Promise<Contadores> => {
    const dueno = String(correoCrudo || '').trim().toLowerCase();
    const visto = reloj();
    if (!dueno.includes('@')) return { observaciones: { correo: { estado: 'not_configured', visto }, whatsapp: { estado: 'not_configured', visto } } };
    const [c, w] = await Promise.all([correo(dueno, visto), whatsapp(dueno, visto)]);
    const desconectadas = (
      [
        ['correo', c],
        ['whatsapp', w],
      ] as const
    )
      .filter(([, o]) => o.estado === 'disconnected')
      .map(([f]) => f);
    const out: Contadores = { observaciones: { correo: c, whatsapp: w } };
    const vc = viejo(c);
    const vw = viejo(w);
    if (vc !== undefined) out.correoSinLeer = vc;
    if (vw !== undefined) out.whatsappSinLeer = vw;
    if (desconectadas.length) out.desconectadas = desconectadas;
    return out;
  };
}

/**
 * El adaptador PRODUCTIVO: sus cuentas de correo (lib/correo: cuántos sin leer en la bandeja de entrada, de
 * solo lectura) y SU WhatsApp si puede tenerlo aquí (server/whatsapp.ts; cada cuenta el suyo).
 */
export function contadoresProductivos(): FuenteContadores {
  return crearContadores<CuentaCorreo>({
    correo: {
      cuentas: (dueno) => leerCuentasSeguro(dueno),
      noLeidos: async (dueno, cuenta) => {
        const cobertura: Cobertura = {};
        await listar(dueno, cuenta, { soloNoLeidos: true, n: 1, cobertura });
        if (typeof cobertura.total !== 'number') throw new Error('el buzón no dijo cuántos hay');
        return cobertura.total;
      },
    },
    whatsapp: { permitido: whatsappPermitido, disponible: whatsappDisponible, estado: (dueno) => estadoWA(dueno), chats: (dueno) => chatsWA(dueno, '', 60) },
  });
}
