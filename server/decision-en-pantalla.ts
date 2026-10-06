/**
 * LA DECISIÓN QUE LA PERSONA TIENE A LA VISTA (José, 5-oct: «que me salga el pop up y me pregunte… y pueda decirlo
 * hablado»). La ventana de decisión de la mesa (mobile/src/trabajos/VentanaDecision.tsx) avisa qué borrador está
 * mostrando (POST /api/trabajos/:id/en-pantalla, server/trabajos.ts). Solo la ventana: que AU-RA mencione algo pendiente
 * no lo pone a la vista (revisión independiente, G2).
 *
 * Para qué sirve (server/decision-turno.ts): un «sí» o un «no» PURO dicho mientras se ve esa ventana es para ESA decisión
 * —su intento y su huella exactos—, aunque esperen otras (antes se preguntaba «¿cuál?») o aunque estuviera apartada para
 * el panel (antes el «sí» no hacía nada: «está en tu panel»). Nunca para otra: si lo que se ve ya no es lo que espera
 * (otra huella, otro intento, otra conversación), no cuenta y la regla única decide como siempre.
 *
 * En memoria y con caducidad corta: si la app deja de decirlo (se cerró la ventana, se fue la red), deja de valer.
 */

export type EnPantalla = {
  canal: 'correo' | 'whatsapp';
  /** La conversación del borrador (su ámbito): solo cuenta en un turno de esa conversación. */
  ambito: string;
  intento: string;
  huella: string;
  tareaId: string;
  decisionId: string;
  /**
   * Quién la puso a la vista: solo la ventana de la mesa. Revisión independiente (G2): que AU-RA mencione algo pendiente
   * ya no lo pone «a la vista» (un «sí» suelto después de una mención no manda nada).
   */
  via: 'pantalla';
  /** Cuándo se puso a la vista (lo que se compara con una pregunta más nueva). */
  t: number;
  /** La última vez que la ventana dijo que sigue a la vista (la caducidad). */
  vivo: number;
};

/** Cuánto vale sin que la app lo repita (la ventana lo renueva mientras está abierta). */
export const EN_PANTALLA_VIVE_MS = 4 * 60_000;

const VISTAS = new Map<string, EnPantalla>();
const llave = (dueno: string) => String(dueno || '').trim().toLowerCase();

/** La ventana (o AU-RA) pone esta decisión a la vista. Reemplaza a la de antes: es la pregunta más reciente. */
export function fijarEnPantalla(dueno: string, e: Omit<EnPantalla, 't' | 'vivo'>, ahora = Date.now()) {
  if (!llave(dueno) || !e.intento || !e.huella) return;
  // La misma decisión otra vez: no se vuelve «más nueva» (sigue siendo la de cuando apareció).
  const antes = VISTAS.get(llave(dueno));
  const t = antes && antes.intento === e.intento && antes.huella === e.huella && antes.ambito === e.ambito ? antes.t : ahora;
  VISTAS.set(llave(dueno), { ...e, t, vivo: ahora });
}

/**
 * La ventana sigue mostrando la misma: se renueva SOLO si sigue registrada esa (misma tarea y decisión), sin cambiar
 * cuándo se puso a la vista. Si mientras tanto AU-RA preguntó otra cosa (un borrador nuevo la soltó), no la revive: la
 * pregunta más reciente es la otra. true si se renovó.
 */
export function renovarEnPantalla(dueno: string, tareaId: string, decisionId: string, ahora = Date.now()): boolean {
  const e = VISTAS.get(llave(dueno));
  if (!e || e.tareaId !== tareaId || e.decisionId !== decisionId || ahora - e.vivo > EN_PANTALLA_VIVE_MS) return false;
  e.vivo = ahora;
  return true;
}

/** Lo que tiene a la vista en esta conversación, si sigue valiendo. */
export function enPantallaDe(dueno: string, ambito: string, ahora = Date.now()): EnPantalla | null {
  const e = VISTAS.get(llave(dueno));
  if (!e) return null;
  if (ahora - e.vivo > EN_PANTALLA_VIVE_MS) {
    VISTAS.delete(llave(dueno));
    return null;
  }
  return e.ambito === String(ambito || '') ? e : null;
}

/**
 * Se cerró la ventana (o se decidió): deja de estar a la vista. Con `tareaId`, solo si era esa; con `decisionId`, solo si
 * era ESA decisión (soltar la versión vieja de una tarea no suelta la nueva que la ventana acaba de mostrar).
 */
export function soltarEnPantalla(dueno: string, tareaId?: string, decisionId?: string) {
  const e = VISTAS.get(llave(dueno));
  if (!e) return;
  if (tareaId && e.tareaId !== tareaId) return;
  if (decisionId && e.decisionId !== decisionId) return;
  VISTAS.delete(llave(dueno));
}

/** Una pregunta nueva de AU-RA (un borrador recién armado) es más reciente que lo que se veía: lo de antes deja de valer. */
export function olvidarEnPantallaDeConversacion(dueno: string, ambito: string) {
  const e = VISTAS.get(llave(dueno));
  if (e && e.ambito === String(ambito || '')) VISTAS.delete(llave(dueno));
}

/* ------------------------------------------------------------------ el orden de los avisos de cada aparato */

/**
 * Revisión 7.5 (MENOR 2): cancelar una edición rápido en la ventana manda «oculta» y enseguida «visible» —dos peticiones
 * a la vez—. Si la «oculta» llegaba segunda, borraba el registro nuevo y el «sí» dicho mientras se veía ya no era para
 * esa. Cada aviso trae su número de orden (`seq`, creciente por aparato: mobile/src/lib/trabajos.ts); uno más viejo que
 * el último visto de ese aparato se ignora. Sin `seq` (una app de antes), como siempre.
 */
const SECUENCIAS = new Map<string, number>();
const MAX_SECUENCIAS = 5_000;
const llaveAparato = (dueno: string, aparato: unknown) => `${llave(dueno)}|${String(aparato ?? '').slice(0, 80)}`;
const secuenciaValida = (seq: unknown): seq is number => typeof seq === 'number' && Number.isFinite(seq);

/** ¿Es el aviso más nuevo de este aparato? Si lo es, queda anotado. Sin `seq`, siempre. */
export function tomarSecuenciaPantalla(dueno: string, aparato: unknown, seq: unknown): boolean {
  if (!secuenciaValida(seq)) return true;
  const k = llaveAparato(dueno, aparato);
  const antes = SECUENCIAS.get(k);
  if (antes !== undefined && seq <= antes) return false;
  SECUENCIAS.delete(k);
  SECUENCIAS.set(k, seq);
  // Tope de memoria: se van los aparatos que hace más que no avisan.
  while (SECUENCIAS.size > MAX_SECUENCIAS) SECUENCIAS.delete(SECUENCIAS.keys().next().value!);
  return true;
}

/** Tras esperar (leer la tarea), ¿sigue siendo el último aviso de este aparato? Otro más nuevo gana. Sin `seq`, sí. */
export function sigueSiendoUltimaSecuencia(dueno: string, aparato: unknown, seq: unknown): boolean {
  return !secuenciaValida(seq) || SECUENCIAS.get(llaveAparato(dueno, aparato)) === seq;
}

export function _olvidarEnPantalla() {
  VISTAS.clear();
  SECUENCIAS.clear();
}
