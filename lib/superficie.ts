/**
 * QUÉ PUEDE COMPLETAR CADA SUPERFICIE (revisión del dueño, F02, P0: «La burbuja debe saber qué puede completar»).
 *
 * Un mismo turno puede venir de la mesa del teléfono, de la burbuja del asistente (encima de otra app, a veces con la app
 * cerrada), de Windows o de la web. Antes el servidor ofrecía las mismas manos a todas y la guarda de honestidad daba por
 * hecho un efecto por el TIPO de la acción que salía («recordatorio» → «quedó puesto»), aunque ninguna superficie lo
 * hubiera ejecutado. Ahora cada pedido dice su superficie y lo que esa superficie completa (`superficie` y `capacidades`
 * en el cuerpo del turno: mobile/src/lib/api.ts), y cada cosa que AU-RA puede hacer cae en UNA clase:
 *
 *  · consulta:             lee y contesta (la web, su correo, sus chats de WhatsApp). Su recibo es el del harness.
 *  · servidor:             la hace el servidor (mandar el correo aprobado, una misión, un documento). Recibo del harness
 *                          con el mismo requestId (idTurno) del turno: un reintento no la repite.
 *  · local:                la hace el aparato (un recordatorio, abrir otra app, el marcador). Solo cuenta como hecha
 *                          con el recibo AUTENTICADO del aparato con el id verificable de la acción (POST
 *                          /api/app/recibo); sin él, queda «en curso» o «fallida», nunca «hecha».
 *  · revision:             necesita que la persona vea y apruebe algo exacto (un borrador, un pago, cambiar de
 *                          avatar): en una superficie que no puede mostrarlo, se abre la app en ESA propuesta (dueño,
 *                          revisión, huella y requestId) en vez de ejecutarla.
 *  · no_soportada:         esta superficie no puede: se explica con el siguiente paso concreto, nunca dentro de un
 *                          mensaje de éxito.
 *
 * Puro: sin red ni almacén (tests/superficie-capacidades.test.ts).
 */

export const SUPERFICIES = ['mesa', 'burbuja', 'windows', 'web'] as const;
export type Superficie = (typeof SUPERFICIES)[number];
export type ClaseCapacidad = 'consulta' | 'servidor' | 'local' | 'revision' | 'no_soportada';

/**
 * Lo que un aparato puede declarar que completa (además de las manos de lib/manos-app.ts): `pantallas` (navegar la app:
 * abrir, atrás, tema, presencia, el chat de AU-RA) y `revision` (mostrar una propuesta para aprobarla: la ventana de
 * decisión). La burbuja no declara ninguna de las dos: ni navega la app de atrás ni muestra la ventana.
 */
export const CAPACIDADES_EXTRA = ['pantallas', 'revision'] as const;
export const MAX_CAPACIDADES = 40;

/** Las acciones que hace el aparato (local), y la capacidad que tiene que haber declarado. */
const LOCALES: Record<string, string> = {
  recordatorio: 'recordatorio',
  cancelar_recordatorio: 'recordatorio',
  llamame: 'llamame',
  llamar: 'llamar',
  marcar: 'marcar',
  leer: 'leer',
  buscar: 'buscar',
  idioma: 'idioma',
  perfil: 'perfil',
  abrir_app: 'abrir_apps',
  abrir_enlace: 'abrir_apps',
  detener_audio: 'controles',
  colgar: 'controles',
  tarea: 'controles',
  silencio: 'pantallas',
  atras: 'pantallas',
  abrir: 'pantallas',
  tema: 'pantallas',
  presencia: 'pantallas',
  abrir_chat: 'pantallas',
  cartera: 'cartera',
  computadora: 'pantallas',
  iniciativa: 'pantallas',
};
/** Lo que necesita que la persona VEA y apruebe algo exacto. */
const REVISION: Record<string, string> = {
  redactar: 'revision',
  enviar: 'enviar_exacto',
  descartar: 'revision',
  avatar: 'revision',
  pagar: 'pagar',
};
/** Las herramientas que solo leen (su recibo es el del harness, sin efecto). */
const CONSULTAS = new Set(['buscar_web', 'leer_pagina', 'estado_sistema', 'cartera_saldo', 'agenda', 'ordenar_mensajes']);

/** La superficie del turno: la que dice el cuerpo (validada); Windows por su origen; sin nada, la mesa (la app) o la web. */
export function superficieDelTurno(body: { superficie?: unknown; origen?: unknown } | null | undefined): Superficie {
  const o = String(body?.origen ?? '').toLowerCase();
  if (o === 'windows') return 'windows';
  const s = String(body?.superficie ?? '').toLowerCase();
  if (o === 'app') return s === 'burbuja' ? 'burbuja' : 'mesa';
  return s === 'burbuja' || s === 'mesa' ? (s as Superficie) : 'web';
}

/** Las capacidades que declara el cuerpo del turno (cadenas cortas, sin repetir, con tope); undefined si no vino. */
export function capacidadesDelTurno(body: { capacidades?: unknown } | null | undefined): string[] | undefined {
  const v = body?.capacidades;
  if (!Array.isArray(v)) return undefined;
  const out: string[] = [];
  for (const x of v) if (typeof x === 'string' && /^[a-z_]{2,40}$/.test(x) && !out.includes(x)) out.push(x);
  return out.slice(0, MAX_CAPACIDADES);
}

/**
 * La clase de una acción en esta superficie con estas capacidades. `undefined` en `capacidades` (una app de antes que no
 * las anuncia) = lo de siempre en la mesa: todo lo local que su contexto declare; en la burbuja, nada local.
 */
export function claseDeAccion(tipo: string, superficie: Superficie, capacidades?: readonly string[]): ClaseCapacidad {
  const t = String(tipo || '');
  const tiene = (c: string) => (capacidades ? capacidades.includes(c) : superficie === 'mesa');
  if (superficie === 'windows' || superficie === 'web') return LOCALES[t] || REVISION[t] ? 'no_soportada' : 'servidor';
  // Lo que se aprueba viendo algo exacto es SIEMPRE revisión; si esta superficie lo puede mostrar lo dice completaAqui.
  if (REVISION[t]) return 'revision';
  if (LOCALES[t]) return tiene(LOCALES[t]) ? 'local' : 'no_soportada';
  return 'servidor';
}

/** La clase de una herramienta del cerebro (consulta o servidor; las de la app, por la acción que piden). */
export function claseDeHerramienta(nombre: string): ClaseCapacidad | null {
  if (CONSULTAS.has(nombre)) return 'consulta';
  return null;
}

/** ¿Esta superficie puede COMPLETAR la acción aquí mismo (sin abrir la app)? */
export function completaAqui(tipo: string, superficie: Superficie, capacidades?: readonly string[]): boolean {
  const c = claseDeAccion(tipo, superficie, capacidades);
  if (c === 'local' || c === 'servidor' || c === 'consulta') return true;
  // La revisión se completa aquí solo donde se puede mostrar (la mesa con su ventana).
  return c === 'revision' && superficie === 'mesa' && (!capacidades || capacidades.includes('revision'));
}

/** Lo que se dice de lo que esta superficie no puede hacer: el siguiente paso concreto (nunca dentro de un éxito). */
export function pasoSiguienteNoSoportada(superficie: Superficie, idioma: 'es' | 'en' = 'es'): string {
  const en = idioma === 'en';
  if (superficie === 'burbuja') return en ? "I can't do that from the bubble: tap «Open in AURA» and I'll do it there." : 'Eso no lo puedo hacer desde la burbuja: tócale «Abrir en AURA» y ahí lo hago.';
  if (superficie === 'windows') return en ? "That one is done on your phone: ask me in the AU-RA app." : 'Eso se hace en tu teléfono: pídemelo en la app de AU-RA.';
  if (superficie === 'web') return en ? 'That one is done on your phone: ask me in the AU-RA app.' : 'Eso se hace en tu teléfono: pídemelo en la app de AU-RA.';
  return en ? "I can't do that on this phone yet: update the app and ask me again." : 'Eso todavía no lo puedo hacer en este teléfono: actualiza la app y pídemelo otra vez.';
}

/** Lo que se dice cuando algo espera revisión y la superficie no puede mostrarlo: se abre en la app. */
export function pasoSiguienteRevision(idioma: 'es' | 'en' = 'es'): string {
  return idioma === 'en' ? "It's ready for you to review in the app: tap «Open in AURA» to see it and approve it." : 'Quedó listo para que lo revises en la app: tócale «Abrir en AURA» para verlo y aprobarlo.';
}

/**
 * Las manos del turno según la superficie: en la burbuja, solo las locales que ELLA declaró (con `capacidades`); en la mesa,
 * las del contexto (más las que declare el turno). Windows y la web, ninguna.
 */
export function manosDeSuperficie(superficie: Superficie, delContexto: readonly string[], capacidades?: readonly string[]): string[] {
  if (superficie === 'windows' || superficie === 'web') return [];
  if (superficie === 'burbuja') return [...new Set(capacidades || [])].filter((c) => !(CAPACIDADES_EXTRA as readonly string[]).includes(c));
  return [...new Set([...delContexto, ...(capacidades || []).filter((c) => !(CAPACIDADES_EXTRA as readonly string[]).includes(c))])];
}

/**
 * Las opciones de la decisión del turno según la superficie: en la burbuja NO hay ventana de decisión a la vista, así que un
 * «sí» no se ata a nada que la persona haya visto ahí (ni el campo `decisionVista` ni el registro de la ventana de ese
 * aparato, que es el de la mesa de atrás): se trata como hablado y sin atadura, y nada sale con ese «sí».
 */
export function decisionDeSuperficie<T extends { hablado?: boolean; decisionVista?: unknown; aparato?: unknown }>(superficie: Superficie, o: T): T {
  if (superficie !== 'burbuja') return o;
  return { ...o, hablado: true, decisionVista: undefined, aparato: undefined };
}
