/**
 * LO PERSONAL DEL TURNO, COMO VISTA AUTORIZADA (P1/A1, auditoría del 4-oct; residuo cerrado el 5-oct).
 *
 * El turno de texto y el de voz (server.ts prepararTurno, también /api/voz/llm, que entra por ahí) arman
 * AQUÍ, y solo aquí, lo que saben de la persona: su perfil, lo que AURA aprendió de ella, lo que hablaron
 * antes, su memoria (la del miembro o la de la junta: lo que pidió recordar y su hilo) y la conversación que
 * va como mensajes. Todo pasa por la misma vista: lo que la persona marcó «No usarlo» (alcance `limitado` en
 * lib/conocer-persona.ts) no entra por NINGUNA copia —ni su respuesta del perfil (perfilDeUso), ni el bloque
 * de lo que sabe, ni el eco en los resúmenes de antes, en lo que quedó a medias, en sus hechos guardados o en
 * su hilo—. La ficha editable (GET /api/perfil, GET /api/cerebro/conocer, GET /api/memoria) no pasa por aquí:
 * limitar no es borrar, y reactivarlo («general») lo devuelve en el turno siguiente.
 *
 * Sale del estado durable del dato (precargarVista lo lee de disco/S3 antes de tocar el hilo) y, sin esperar
 * (la voz), de la caché: si lo limitado todavía no está en caché, no se arriesga nada (fallo cerrado).
 * Qué frase repite algo limitado lo decide UNA regla (lib/reservas.ts tocaReserva): por frase, línea, turno o
 * dato, nunca por palabra suelta; la frase sale entera («[dato reservado]»). La iniciativa usa la misma
 * (lib/perfil-persona.ts reservasDe → textoAutorizado).
 */
import { bloqueAbiertos } from '../lib/abiertos';
import { bloqueConocer, datosLimitadosEnCache, firmaConocer, precargarConocer, terminosReservados, vistaDeTerminos, type Dato, type VistaTexto } from '../lib/conocer-persona';
import { tocaReserva, type Reserva } from '../lib/reservas';
import { bloqueEpisodios } from '../lib/episodios';
import type { HiloMemoria } from '../lib/conversacion';
import type { MiembroId } from '../lib/junta';
import { promptMemoria } from '../lib/memoria';
import { promptMemoriaMiembro } from '../lib/memoria-miembro';
import { lineaPerfil, perfilDeUso, type Perfil, type PerfilDeUso } from '../lib/perfil-persona';
import type { NivelAura } from '../lib/perfiles/tipos';

/**
 * La vista autorizada de una persona en este turno. `texto` saca la frase que repite algo limitado («[dato
 * reservado]»); `turnos` pasa un hilo por ella (los turnos que quedan vacíos se van). `sabe` false: lo
 * limitado aún no está en caché, y entonces no deja pasar nada de lo suyo.
 */
export type VistaAutorizada = VistaTexto & {
  readonly dueno: string;
  readonly limitados: readonly Dato[] | null;
  /** Con qué se reconoce lo limitado (lib/reservas.ts); null si no se sabe. */
  readonly reservas: readonly Reserva[] | null;
  /**
   * Un hilo por la vista. `actual`: lo que acaba de decir; si es el último turno de la persona, va tal cual
   * (no es memoria: lo está diciendo ahora, y el turno lo reconoce para no repetirlo).
   */
  turnos<T extends { rol: string; texto: string }>(ts: readonly T[], actual?: string): T[];
};

/** Lee de disco/S3 lo que la persona limitó, para que la vista no tenga que fallar cerrado. Nunca lanza. */
export function precargarVista(dueno: string): Promise<void> {
  return dueno ? precargarConocer(dueno) : Promise.resolve();
}

/** `dueno`: de quién es la memoria del turno (el correo de la app o el de la junta). Sin dueño, nada limitado. Pura respecto a la red. */
export function vistaAutorizada(dueno: string): VistaAutorizada {
  const limitados = dueno ? datosLimitadosEnCache(dueno) : [];
  const reservas = limitados ? terminosReservados(limitados) : null;
  const base = vistaDeTerminos(reservas);
  return {
    dueno,
    limitados,
    reservas,
    sabe: base.sabe,
    texto: base.texto,
    turnos: (ts, actual) =>
      ts
        .map((t, i) => (actual !== undefined && i === ts.length - 1 && t.rol === 'user' && t.texto === actual ? t : { ...t, texto: base.texto(String(t.texto || '')) }))
        .filter((t) => String(t.texto || '').trim()),
  };
}

/**
 * La vista para lo que devuelven las herramientas que el modelo pide en el turno (sus misiones, su círculo, su tarea
 * en curso; revisión 11, MEDIO-2): la misma del turno, salvo lo que la persona nombra en lo que ACABA de decir. Si
 * dice «escríbele a Valentina» o «¿cómo va la mudanza a Puerto Sintetico?», lo trae ella ahora (como su mensaje, que
 * va tal cual en `turnos`), y el resultado de eso no se le tapa; lo demás que limitó sí. Sin saber qué limitó, nada.
 */
export function vistaDeHerramientas(vista: VistaAutorizada, actual: string): VistaTexto {
  const rs = vista.reservas;
  if (!vista.sabe || !rs?.length || !String(actual || '').trim()) return vista;
  const quedan = rs.filter((r) => !tocaReserva(actual, [r]));
  return quedan.length === rs.length ? vista : vistaDeTerminos(quedan);
}

/** De quién es la memoria del turno y cuánto hilo lleva (server.ts prepararTurno). */
export type MemoriaDelTurno = {
  nivel: NivelAura;
  /** La persona del padrón (junta, verificada). */
  quienMem: MiembroId | null;
  /** El correo de la memoria del miembro (vacío sin sesión). */
  correoMem: string;
  nombre?: string;
  /** El hilo va como mensajes: la memoria no repite el corto. */
  hiloEnMensajes: boolean;
};

/** La memoria del turno (lo completo y la firma) por la vista. */
function memoriaPorLaVista(m: MemoriaDelTurno, vista: VistaTexto): { completa: string; firma: string } {
  const hilo: HiloMemoria = m.hiloEnMensajes ? 'mediano' : 'todo';
  if (m.nivel === 'miembro') {
    // Sin sesión no hay memoria guardada: solo con quién habla.
    if (!m.correoMem) {
      const s = promptMemoria(null, { nivel: 'miembro', nombre: m.nombre });
      return { completa: s, firma: s };
    }
    return { completa: promptMemoriaMiembro(m.correoMem, m.nombre, hilo, vista), firma: promptMemoriaMiembro(m.correoMem, m.nombre, 'firma', vista) };
  }
  return {
    completa: promptMemoria(m.quienMem, { nivel: m.nivel, nombre: m.nombre, hilo, vista }),
    firma: promptMemoria(m.quienMem, { nivel: m.nivel, nombre: m.nombre, hilo: 'firma', vista }),
  };
}

export type BloquesPersonales = {
  bloquePerfil: string;
  conocer: string;
  conocerFirma?: string;
  bloqueCerebro: string;
  /** La memoria del turno, ya por la vista (server/prompt-turno.ts PiezasTurno.memoria). Solo si se pidió. */
  memoria?: { completa: string; firma: string };
};

/**
 * `dueno`: de quién es la memoria del turno (el correo de la app o el de la junta). `perfil`: el que dio
 * leerPerfil / perfilEnCache (ya autorizado); se vuelve a pasar por la vista con lo limitado en caché, por si
 * llegó de otro lado (el apodo del turno lo copia). `consulta`: lo que dijo ahora (para los resúmenes que vienen
 * al caso). `vista`: la del turno (la misma con la que se filtró el hilo); sin ella, se arma aquí.
 * `memoria`: de quién es la memoria del turno; con ella sale también `memoria`. Pura respecto a la red: solo caché.
 */
export function bloquesPersonales(o: {
  dueno: string;
  perfil: Perfil | PerfilDeUso | null;
  compacto: boolean;
  nombre?: string;
  consulta: string;
  conPregunta?: boolean;
  vista?: VistaAutorizada;
  memoria?: MemoriaDelTurno;
}): BloquesPersonales {
  const dueno = o.dueno;
  const vista = o.vista && o.vista.dueno === dueno ? o.vista : vistaAutorizada(dueno);
  // null (lo limitado aún no está en caché): perfilDeUso falla cerrado, sin la encuesta ni el cumpleaños.
  const perfil = perfilDeUso(o.perfil, vista.limitados);
  // Lo que quedó a medias, una vez por sesión (salvo que pregunte por sus pendientes: José, 7-oct).
  const cerebro = dueno ? [bloqueAbiertos(dueno, o.compacto, Date.now(), { mensaje: o.consulta }), bloqueEpisodios(dueno, o.consulta, o.compacto)].filter(Boolean).join('\n\n') : '';
  return {
    bloquePerfil: lineaPerfil(perfil),
    // Lo que sabe de ella, por la misma regla: ni lo limitado ni un dato general que lo repite.
    conocer: dueno ? bloqueConocer(dueno, o.compacto, { nombre: o.nombre, conPregunta: o.conPregunta, reservas: vista.reservas }) : '',
    conocerFirma: dueno ? firmaConocer(dueno) : undefined,
    // Los resúmenes de antes y lo que quedó a medias, sin las frases que repiten lo limitado; sin saber qué
    // está limitado, no entran (como bloqueEpisodios sin las marcas de supresión).
    bloqueCerebro: cerebro ? vista.texto(cerebro) : '',
    // Lo que pidió recordar y su hilo (miembro o junta), por la misma vista (revisión del 5-oct, GRAVE-3).
    ...(o.memoria ? { memoria: memoriaPorLaVista(o.memoria, vista) } : {}),
  };
}
