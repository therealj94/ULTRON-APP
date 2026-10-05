/**
 * LA DECISIÓN QUE LA PERSONA TIENE A LA VISTA (José, 5-oct: «que me salga el pop up y me pregunte… y pueda decirlo
 * hablado»). La ventana de decisión de la mesa (mobile/src/trabajos/VentanaDecision.tsx) avisa qué borrador está
 * mostrando (POST /api/trabajos/:id/en-pantalla, server/trabajos.ts); AU-RA también la fija cuando ella misma pregunta por
 * algo que quedó pendiente. Es «la pregunta más reciente».
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
  /** Quién la puso a la vista: la ventana de la mesa, o AU-RA al preguntar por lo pendiente. */
  via: 'pantalla' | 'mencion';
  /**
   * A quién va (para `mencion`): esa pregunta vale solo si AU-RA de verdad la hizo, es decir, si su respuesta anterior
   * nombra a esa persona (server/decision-turno.ts). Si el modelo no la mencionó, un «sí» no la manda.
   */
  para?: string;
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

/** Se cerró la ventana (o se decidió): deja de estar a la vista. Con `tareaId`, solo si era esa. */
export function soltarEnPantalla(dueno: string, tareaId?: string) {
  const e = VISTAS.get(llave(dueno));
  if (!e) return;
  if (tareaId && e.tareaId !== tareaId) return;
  VISTAS.delete(llave(dueno));
}

/** Una pregunta nueva de AU-RA (un borrador recién armado) es más reciente que lo que se veía: lo de antes deja de valer. */
export function olvidarEnPantallaDeConversacion(dueno: string, ambito: string) {
  const e = VISTAS.get(llave(dueno));
  if (e && e.ambito === String(ambito || '')) VISTAS.delete(llave(dueno));
}

export function _olvidarEnPantalla() {
  VISTAS.clear();
}
