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
};

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
  const base: TurnoOpts & { idTurno: string } = { ...opts, idTurno: nuevoIdTurno() };
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
            return { texto: r.reply, emocion: r.emocion, revision: pideRevision(r) };
          }
          if (l?.hasSpoken) return { texto: r.reply || '', emocion: r.emocion, revision: pideRevision(r) };
          d.alReconectar?.();
          // Sin texto: el JSON con el mismo idTurno (devuelve el turno que ya corrió, no corre otro).
        } catch (e) {
          if (cortado) return { texto: '', cortado: true };
          miga(`burbuja: el stream cayó (${String((e as Error)?.message || e).slice(0, 60)}); por JSON`);
          d.alReconectar?.();
        }
      }
      const r = await turno(base);
      if (cortado || r.vencida) return { texto: '', cortado: true };
      if (r.error || !r.reply) {
        const fallo = clasificarFallo(r);
        miga(`burbuja: el turno falló (${fallo}${r.error ? `, «${String(r.error).slice(0, 60)}»` : ''})`);
        return { texto: '', fallo };
      }
      await decir(r);
      miga(`burbuja: turno en ${Date.now() - t0} ms (${r.via || 'json'})`);
      return { texto: r.reply, emocion: r.emocion, revision: pideRevision(r) };
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
