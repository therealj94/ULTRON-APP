/**
 * UN TURNO DE LA BURBUJA: el mismo camino que un turno de la mesa, sin la mesa.
 *
 * No es un cerebro ni una voz nuevos: es el mismo `/api/turno` en streaming (lib/api.ts `turnoStream`, con el MISMO
 * idTurno en el respaldo JSON para que el servidor no corra la frase dos veces), la misma cuenta y el mismo hilo, y la
 * misma voz de AURA por frases mientras llega el texto (lib/tts.ts `StreamSpeaker`, la de la mesa). Con foto, el JSON
 * de siempre con la imagen (como «¿qué ves?» en la mesa). Lo que la mesa hace además (relleno, sonidos de trabajo,
 * caras, voces, turno especulativo, acciones en pantalla) no va aquí: la burbuja es una pregunta rápida encima de otra
 * app, y una acción de pantalla («abre Ajustes») movería la app de atrás sin que se vea.
 *
 * Mientras AURA habla, el micrófono se pausa (pauseMicForTts), igual que en la mesa: no se oye a sí misma.
 *
 * F02 (revisión del dueño, «la burbuja debe saber qué puede completar»): el turno dice que viene de la burbuja
 * (`superficie: 'burbuja'`, con sus capacidades: telefono/capacidades.ts) y el servidor solo le ofrece lo que ella completa
 * (abrir otras apps, el reloj, el SMS, el calendario del teléfono); lo demás lo explica con el siguiente paso («tócale Abrir
 * en AURA»). Las acciones del teléfono que trae el `done` se hacen AQUÍ (telefono/ejecutor.ts) y cada una manda su recibo
 * con su id (telefono/recibos.ts); si falla, se dice por qué. Abrir otra app deja atrás la burbuja (se termina sola).
 * El respaldo JSON primero pregunta por el turno (lib/respaldoTurno.ts): nunca se repite a ciegas uno que ya hizo cosas.
 */
import { turno, turnoStream, nuevoIdTurno, type ChatResult, type TurnoOpts } from '../lib/api';
import { clasificarFallo, type ClaseFallo } from '../lib/falloTurno';
import { pauseMicForTts } from '../lib/speech';
import { speak, stopSpeaking, StreamSpeaker } from '../lib/tts';
import { quitarExpresiones } from '../lib/expresiones';
import { miga } from '../lib/reporte';
import type { Emocion } from '../lib/emocion';
import { pideRevision } from './sesionBurbuja';

export type ResultadoBurbuja = {
  texto: string;
  fallo?: ClaseFallo;
  cortado?: boolean;
  /** La emoción del turno (la del servidor). */
  emocion?: Emocion;
  /**
   * El turno pidió hacer algo en la app (acciones) o creó tareas: la burbuja NO lo hace encima de otra app (se movería
   * sin verse); queda «esperando revisión» y se revisa en AURA.
   */
  revision?: boolean;
  /** Una acción del teléfono abrió otra app (la burbuja queda atrás y se termina sola). */
  abrioApp?: boolean;
  /**
   * El turno trajo un «llámame» nuevo: la llamada suena en la APP (burbuja/llamameBurbuja.ts). La burbuja la pasa al buzón,
   * abre la app y se cierra; con la app abierta detrás, quien llegue primero (este turno o su canal) la atiende una vez.
   */
  llamame?: boolean;
};

/** La acción de un elemento de la lista del turno (`{ id, accion }` o la acción sola). */
function accionDe(x: unknown): unknown {
  return x && typeof x === 'object' && 'accion' in x ? (x as { accion: unknown }).accion : x;
}

/**
 * ¿Pide revisión en la app? Las acciones del teléfono no: la burbuja las hace aquí con su recibo. El «llámame» tampoco: la
 * burbuja se lo pasa a la app (burbuja/llamameBurbuja.ts).
 */
function revisionDe(r: ChatResult): boolean {
  const acciones = Array.isArray(r.acciones) ? r.acciones.filter((x) => !esAccionTelefono(accionDe(x)) && !esLlamame(x)) : r.acciones;
  return pideRevision({ acciones, tareas: r.tareas });
}
import { consultarTurnoGuardado } from '../lib/api';
import { planRespaldo } from '../lib/respaldoTurno';
import { esAccionTelefono } from '../telefono/apps';
import { ejecutarAccionTelefono, type AccionTelefonoApp } from '../telefono/ejecutor';
import { depsEjecutor } from '../telefono/nativo';
import { mandarRecibo } from '../telefono/recibos';
import { instalarEnvioRecibos } from '../telefono/useTelefono';
import { accionNueva } from '../compa/acciones';
import { esLlamame, llamameDelTurno } from './llamameBurbuja';


/**
 * Las acciones del teléfono que trajo el turno (`[{ id, accion }]`), hechas aquí con su recibo. Las que la mesa de atrás ya
 * hizo (llegaron por su canal con el mismo id) no se repiten (accionNueva). Devuelve lo que falló (para decirlo) y si se
 * abrió otra app.
 */
export async function hacerAccionesDelTelefono(lista: unknown): Promise<{ fallos: string[]; abrioApp: boolean }> {
  const out = { fallos: [] as string[], abrioApp: false };
  if (!Array.isArray(lista)) return out;
  instalarEnvioRecibos();
  for (const x of lista) {
    const accion = x && typeof x === 'object' && 'accion' in x ? (x as { accion: unknown }).accion : x;
    const id = x && typeof x === 'object' && 'id' in x ? String((x as { id?: unknown }).id || '') : '';
    if (!esAccionTelefono(accion) || !accionNueva(id, accion)) continue;
    const a = accion as AccionTelefonoApp;
    const r = await ejecutarAccionTelefono(a, depsEjecutor());
    void mandarRecibo(a, r.ok, r.detalle, id || null);
    if (!r.ok && r.detalle) out.fallos.push(r.detalle);
    if (r.ok && (a.tipo === 'abrir_app' || a.tipo === 'abrir_enlace' || a.tipo === 'navegar' || a.tipo === 'sms' || a.tipo === 'evento_calendario')) out.abrioApp = true;
  }
  return out;
}

export type DepsTurnoBurbuja = {
  /** La frase que empieza a sonar (o la respuesta entera, si no hubo voz): se enseña bajo el orbe. */
  alFrase: (texto: string) => void;
  /** Empezó / terminó de sonar la voz de AURA. */
  alHablar: (hablando: boolean) => void;
  /** La emoción del turno, en cuanto llega (el evento del stream o el JSON). */
  alEmocion?: (e: Emocion) => void;
  /** El stream cayó y se recupera por JSON con el mismo idTurno: «recuperando conexión». */
  alReconectar?: () => void;
  /** El primer texto útil del cerebro (para las marcas de tiempo). */
  alPrimerContenido?: () => void;
};

export function turnoBurbuja(opts: Omit<TurnoOpts, 'idTurno'>, d: DepsTurnoBurbuja): { promise: Promise<ResultadoBurbuja>; cancelar: () => void } {
  const base: TurnoOpts & { idTurno: string } = { ...opts, superficie: 'burbuja', idTurno: nuevoIdTurno() };
  let cortado = false;
  let abortar: (() => void) | null = null;
  let locutor: StreamSpeaker | null = null;
  const t0 = Date.now();
  let contenido = false;
  const primerContenido = () => {
    if (contenido) return;
    contenido = true;
    d.alPrimerContenido?.();
  };
  let emocionDicha: Emocion | null = null;
  const emocion = (e: Emocion | undefined | null) => {
    if (!e || cortado || e === emocionDicha) return;
    emocionDicha = e;
    d.alEmocion?.(e);
  };

  const hablando = (on: boolean) => {
    pauseMicForTts(on);
    d.alHablar(on);
  };

  /** Dice el texto entero (respaldo JSON, o el stream no llegó a sonar). */
  const decir = async (r: ChatResult) => {
    const texto = r.voz || r.reply;
    primerContenido();
    emocion(r.emocion);
    d.alFrase(quitarExpresiones(r.reply || texto).trim());
    // speak() se resuelve cuando terminó de sonar (o la cortaron): no se espera a su onEnd, que no llega si la cortan.
    await speak(texto, { emocion: r.emocion, onAudioStart: () => hablando(true) }).catch(() => false);
  };

  /** Lo del teléfono que trajo el turno: se hace con su recibo; lo que falló se dice (la compañera no está aquí). */
  const despues = async (r: ChatResult): Promise<{ abrioApp?: boolean; llamame?: boolean }> => {
    if (cortado) return {};
    // «Llámame»: suena en la app (la burbuja la abre y se cierra). Va antes que lo demás: lo del teléfono no espera a esto.
    const llamame = llamameDelTurno(r.acciones, (id, accion) => accionNueva(id, accion));
    const h = await hacerAccionesDelTelefono(r.acciones);
    if (h.fallos.length && !cortado) {
      const dicho = h.fallos.join(' ');
      d.alFrase(dicho);
      await speak(dicho, { onAudioStart: () => hablando(true) }).catch(() => false);
    }
    return { ...(h.abrioApp ? { abrioApp: true } : {}), ...(llamame ? { llamame: true } : {}) };
  };

  const correr = async (): Promise<ResultadoBurbuja> => {
    try {
      if (!base.image) {
        try {
          const st = turnoStream(base, {
            onEmocion: (e) => {
              locutor?.setEmocion(e);
              emocion(e);
            },
            onDelta: (piece) => {
              if (cortado) return;
              if (piece.trim()) primerContenido();
              if (!locutor) locutor = new StreamSpeaker({ onAudioStart: () => hablando(true), onSentence: (s) => d.alFrase(quitarExpresiones(s).trim()) });
              locutor.push(piece);
            },
            onReplace: (texto) => {
              if (cortado) return;
              if (!locutor) locutor = new StreamSpeaker({ onAudioStart: () => hablando(true), onSentence: (s) => d.alFrase(quitarExpresiones(s).trim()) });
              locutor.reemplazar(texto, 'Corrijo:');
            },
          });
          abortar = st.abort;
          const r = await st.promise;
          abortar = null;
          if (cortado) return { texto: '', cortado: true };
          const l = locutor as StreamSpeaker | null;
          if (r.reply && !r.error) {
            if (l) {
              l.end();
              await l.done;
              if (!l.hasSpoken) await decir(r);
            } else await decir(r);
            miga(`burbuja: turno en ${Date.now() - t0} ms (${r.via || 'stream'})`);
            return { texto: r.reply, emocion: r.emocion, revision: revisionDe(r), ...(await despues(r)) };
          }
          if (l?.hasSpoken) return { texto: r.reply || '', emocion: r.emocion, revision: revisionDe(r), ...(await despues(r)) };
          d.alReconectar?.();
          // Sin texto: el JSON con el mismo idTurno (devuelve el turno que ya corrió, no corre otro).
        } catch (e) {
          if (cortado) return { texto: '', cortado: true };
          miga(`burbuja: el stream cayó (${String((e as Error)?.message || e).slice(0, 60)}); por JSON`);
          d.alReconectar?.();
        }
      }
      // El respaldo conserva la identidad del turno: primero se pregunta por ese idTurno (lib/respaldoTurno.ts).
      const plan = base.image ? 'pedir' : planRespaldo(await consultarTurnoGuardado(base.idTurno));
      if (plan === 'repetir') miga('burbuja: el turno ya estaba en el servidor; solo se repite su respuesta');
      const r = await turno(plan === 'repetir' ? { ...base, soloRepetir: true } : base);
      if (cortado || r.vencida) return { texto: '', cortado: true };
      if (r.error || !r.reply) {
        const fallo = clasificarFallo(r);
        miga(`burbuja: el turno falló (${fallo}${r.error ? `, «${String(r.error).slice(0, 60)}»` : ''})`);
        return { texto: '', fallo };
      }
      await decir(r);
      miga(`burbuja: turno en ${Date.now() - t0} ms (${r.via || 'json'})`);
      return { texto: r.reply, emocion: r.emocion, revision: revisionDe(r), ...(await despues(r)) };
    } finally {
      if (!cortado) hablando(false);
    }
  };

  return {
    promise: correr(),
    cancelar: () => {
      if (cortado) return;
      cortado = true;
      abortar?.();
      (locutor as StreamSpeaker | null)?.cancel();
      void stopSpeaking();
      hablando(false);
    },
  };
}
