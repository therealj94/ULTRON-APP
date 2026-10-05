/**
 * UNA LÍNEA POR TURNO QUE FALLA O TARDA (José, 5-oct: la mesa dijo «No alcanzo al cerebro remoto» y en
 * los logs de Render no había nada que dijera por qué). Las dos rutas de la mesa del teléfono
 * (/api/turno/stream y su respaldo /api/turno) dejan aquí, al cerrar la respuesta, una sola línea si el
 * turno falló o pasó de TURNO_LENTO_MS:
 *
 *   [turno] FALLA ruta=json status=502 codigo=- ms=1834 via=- estado=- id=…-4f2a origen=app hablado=1 error="…"
 *
 * Nunca el texto de la persona ni la respuesta: solo la ruta, el estado HTTP, el código y el mensaje de
 * error del SERVIDOR (cortos y saneados), los ms, por dónde contestó y el idTurno (aleatorio, por frase:
 * es el mismo que la app pone en su miga, así se juntan las dos puntas sin contar nada de nadie).
 * Un 401/429 de los guardias de la ruta también cuenta: el medidor va antes que ellos.
 */
import type express from 'express';
import { sanearTexto } from '../lib/diag-saneador';
import { idTurnoValido } from './turno-unico';

/** Desde cuánto un turno sano se anota como lento (la app cambia de camino a los 20 s). */
export const TURNO_LENTO_MS = Math.max(1000, Number(process.env.TURNO_LENTO_MS) || 20_000);

export type MedidaTurno = {
  ruta: 'json' | 'stream';
  status: number;
  ms: number;
  /** El `code`/`codigo` del cuerpo de error o del evento `error` del stream (en-curso, caido, demasiados_turnos…). */
  codigo?: string;
  /** El mensaje de error del servidor (nunca lo que dijo la persona). */
  error?: string;
  via?: string;
  /** completo · truncado · error (el `estado` del `done`). */
  estado?: string;
  /** El stream se cerró sin `done` ni `error` porque la conexión se cortó (el teléfono se fue). */
  cortado?: boolean;
  repetido?: boolean;
  idTurno?: unknown;
  origen?: string | null;
  hablado?: boolean;
};

/** ¿Falló? Un estado HTTP de error, un `error` del stream, un `done` sin completar o una conexión cortada. */
export function turnoFallo(m: MedidaTurno): boolean {
  return m.status >= 400 || !!m.codigo || !!m.error || m.estado === 'error' || !!m.cortado;
}

/** La línea del log, o null si el turno fue bien y a tiempo (no se anota nada). */
export function lineaTurno(m: MedidaTurno, lentoMs = TURNO_LENTO_MS): string | null {
  const falla = turnoFallo(m);
  if (!falla && m.ms < lentoMs) return null;
  const corto = (v: unknown, max: number) => sanearTexto(v, max).replace(/[\s"]+/g, ' ').trim() || '-';
  const id = idTurnoValido(m.idTurno);
  const partes = [
    `[turno] ${falla ? 'FALLA' : 'LENTO'}`,
    `ruta=${m.ruta}`,
    `status=${m.status}`,
    `codigo=${corto(m.codigo, 30)}`,
    `ms=${Math.max(0, Math.round(m.ms))}`,
    `via=${corto(m.via, 40)}`,
    `estado=${corto(m.estado, 12)}`,
    // Lo último del id basta para juntarlo con la miga de la app.
    `id=${id ? id.slice(-12) : '-'}`,
    `origen=${m.origen || 'web'}`,
    ...(m.hablado ? ['hablado=1'] : []),
    ...(m.repetido ? ['repetido=1'] : []),
    ...(m.cortado ? ['cortado=1'] : []),
  ];
  if (m.error) partes.push(`error="${corto(m.error, 100)}"`);
  return partes.join(' ');
}

/** De dónde viene, sin copiar al log lo que mande el cliente: la app, Windows o (cualquier otra cosa) la web. */
function origenCorto(v: unknown): string | null {
  const o = String(v || '').trim().toLowerCase();
  return o === 'app' || o === 'windows' ? o : null;
}

/** Lo que la ruta del stream va contando del turno (se lee al cerrar la respuesta). */
export type NotasTurno = { codigo?: string; error?: string; via?: string; estado?: string; repetido?: boolean; hecho?: boolean };

/** El stream anota sus eventos aquí (res.locals.notasTurno): `error` y `done` son los que dicen cómo terminó. */
export function anotarEventoTurno(notas: NotasTurno | undefined, evento: string, datos: any) {
  if (!notas) return;
  if (evento === 'error') {
    notas.codigo = String(datos?.codigo || datos?.code || 'error');
    notas.error = String(datos?.error || '');
    notas.hecho = true;
  } else if (evento === 'done') {
    notas.via = datos?.via ? String(datos.via) : undefined;
    notas.estado = datos?.estado ? String(datos.estado) : datos?.parcial === true ? 'error' : undefined;
    notas.repetido = datos?.repetido === true;
    notas.hecho = true;
  }
}

/**
 * El medidor: va PRIMERO en la ruta (antes de la sesión y los cupos) y anota una línea al cerrar si el
 * turno falló o tardó. En /api/turno lee el cuerpo JSON que se manda; en el stream, lo que la ruta anotó
 * de sus eventos (`anotarEventoTurno`).
 */
export function medirTurno(ruta: 'json' | 'stream', log: (linea: string) => void = (l) => console.warn(l)) {
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const t0 = Date.now();
    const notas: NotasTurno = {};
    res.locals.notasTurno = notas;
    let cuerpo: any = null;
    const json = res.json.bind(res);
    res.json = ((b: any) => {
      cuerpo = b;
      return json(b);
    }) as typeof res.json;
    let listo = false;
    const cerrar = () => {
      if (listo) return;
      listo = true;
      const status = res.statusCode || 200;
      const deCuerpo = cuerpo && typeof cuerpo === 'object' ? cuerpo : {};
      const fallaHttp = status >= 400;
      const m: MedidaTurno = {
        ruta,
        status,
        ms: Date.now() - t0,
        codigo: fallaHttp ? String(deCuerpo.code || deCuerpo.codigo || '') || undefined : notas.codigo,
        error: fallaHttp ? String(deCuerpo.error || '') || undefined : notas.error,
        via: deCuerpo.via || notas.via,
        estado: deCuerpo.estado || notas.estado,
        repetido: deCuerpo.repetido === true || notas.repetido,
        // El stream se cerró sin `done` ni `error`: la conexión se cortó por el camino.
        cortado: ruta === 'stream' && !fallaHttp && !notas.hecho,
        idTurno: req.body?.idTurno,
        origen: origenCorto(req.headers['x-aura-origen']),
        hablado: req.body?.hablado === true,
      };
      const linea = lineaTurno(m);
      if (linea) log(linea);
    };
    res.on('finish', cerrar);
    res.on('close', cerrar);
    next();
  };
}
