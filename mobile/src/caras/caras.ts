/**
 * RECONOCER CARAS, CON PERMISO: lo puro (se prueba en Node).
 *
 * Cómo funciona (la foto nunca sale del teléfono):
 *  1. La cámara de la mesa ya toma una foto chica cuando se le pide («qué ves»). Con el
 *     reconocimiento activado por la persona, esa foto entra a una WebView escondida (MotorCaras) que
 *     corre face-api (TinyFaceDetector + 68 puntos + la red de reconocimiento, estilo ResNet de dlib:
 *     99,38 % en LFW según sus autores) con TensorFlow.js sobre WebGL. De cada cara sale un vector de
 *     128 números. La foto se descarta ahí mismo.
 *  2. Aquí se compara ese vector con los guardados de ESTA persona (distancia euclídea): por debajo de
 *     `UMBRAL` y con margen sobre el segundo más parecido, es alguien conocido.
 *  3. Lo que se guarda (servidor, lib/caras-miembro.ts) son esos números, nunca una foto, en un
 *     cajón por correo del dueño: nadie más los ve, ni la junta.
 *
 * Por qué así y no otro camino: no agrega módulos nativos (va por aire, sin APK nueva: la WebView y la
 * cámara ya están en la 4.7.0), y la foto no viaja. El costo: bajar ~7 MB de modelos la primera vez
 * (quedan en la caché de la WebView) y ~0,3-0,8 s por foto en un teléfono medio, solo cuando se pide.
 *
 * Consentimiento:
 *  · la persona activa el reconocimiento (Más → Caras) sabiendo qué se guarda;
 *  · «conóceme» guarda SU cara (la dueña de la cuenta la pide);
 *  · «te presento a Ana» pregunta EN VOZ ALTA «Ana, ¿te puedo recordar?»; solo un «sí» dentro de
 *    `ESPERA_CONSENTIMIENTO_MS` la guarda (con la frase dicha, para constancia). Un «no», silencio o
 *    cualquier otra cosa: no se guarda nada;
 *  · «olvida a Ana», «olvida mi cara», «olvida todas las caras» borran de verdad (en el servidor).
 */

export const LARGO_VECTOR = 128;
/** Por debajo de esto, es la misma persona (face-api sugiere 0,6; 0,5 es más estricto: menos confusiones). */
export const UMBRAL = 0.5;
/** El más parecido tiene que ganarle al segundo (de otra persona) por al menos esto. */
export const MARGEN = 0.06;
/** Lo que espera el «sí» de la persona presentada. */
export const ESPERA_CONSENTIMIENTO_MS = 30_000;
/** Fotos para aprender una cara (se promedian). */
export const MUESTRAS_APRENDER = 3;

export type Relacion = 'yo' | 'conocido';
export type CaraConocida = { id: string; nombre: string; relacion: Relacion; vectores: number[][] };
export type CaraVista = { caja: { x: number; y: number; w: number; h: number }; vector: number[]; puntaje: number };

export function vectorValido(v: unknown): v is number[] {
  return Array.isArray(v) && v.length === LARGO_VECTOR && v.every((x) => typeof x === 'number' && Number.isFinite(x) && Math.abs(x) <= 1);
}

export function distancia(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i];
    s += d * d;
  }
  return Math.sqrt(s);
}

export function promediar(vs: number[][]): number[] {
  const n = vs.length;
  const out = new Array(LARGO_VECTOR).fill(0);
  for (const v of vs) for (let i = 0; i < LARGO_VECTOR; i++) out[i] += v[i] / n;
  return out.map((x) => Math.round(x * 1e4) / 1e4);
}

export type Reconocida = { id: string; nombre: string; relacion: Relacion; distancia: number };

/**
 * ¿De quién es este vector? La distancia a una persona es la menor a cualquiera de sus muestras.
 * null si nadie está bajo el umbral o si dos personas distintas quedan demasiado parejas (dudar es
 * mejor que llamar a alguien por otro nombre).
 */
export function identificar(vector: number[], conocidas: CaraConocida[]): Reconocida | null {
  const filas = conocidas
    .map((c) => ({ c, d: Math.min(...c.vectores.filter(vectorValido).map((v) => distancia(vector, v))) }))
    .filter((f) => Number.isFinite(f.d))
    .sort((a, b) => a.d - b.d);
  const [primero, segundo] = filas;
  if (!primero || primero.d >= UMBRAL) return null;
  if (segundo && segundo.d - primero.d < MARGEN) return null;
  return { id: primero.c.id, nombre: primero.c.nombre, relacion: primero.c.relacion, distancia: Math.round(primero.d * 1000) / 1000 };
}

/** La cara más grande de la foto (la de quien está delante). */
export function masGrande(caras: CaraVista[]): CaraVista | null {
  return caras.reduce<CaraVista | null>((m, c) => (!m || c.caja.w * c.caja.h > m.caja.w * m.caja.h ? c : m), null);
}

/**
 * La cara de la persona presentada: la más grande que NO es la dueña. Con una sola cara que es la
 * dueña, null (no se guarda a la dueña con otro nombre).
 */
export function caraDelPresentado(caras: CaraVista[], conocidas: CaraConocida[]): CaraVista | null {
  const yo = conocidas.filter((c) => c.relacion === 'yo');
  const otras = caras.filter((c) => !yo.length || !identificar(c.vector, yo));
  return masGrande(otras);
}

/* ── por voz ─────────────────────────────────────────────────────────────────────────────── */

const sinTildes = (t: string) => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
/** Un nombre dicho («Ana», «Don Juan Pérez»): hasta 3 palabras, con mayúscula como se dijo. */
function nombreDe(original: string, desde: number): string {
  const resto = original
    .slice(desde)
    .replace(/[.,;:!?¿¡"«»]/g, ' ')
    .trim()
    .split(/\s+/)
    .filter((w) => !/^(que|y|para|porque|por|mi|mis)$/i.test(w))
    .slice(0, 3)
    .join(' ');
  return resto.replace(/^(a|al|la|el)\s+/i, '').slice(0, 60).trim();
}

export type PedidoCaras =
  | { tipo: 'conoceme' }
  | { tipo: 'presentar'; nombre: string }
  | { tipo: 'olvidar'; nombre: string }
  | { tipo: 'olvidar_mia' }
  | { tipo: 'olvidar_todas' }
  | { tipo: 'quien' }
  | { tipo: 'lista' };

export function pedidoDeCaras(texto: string): PedidoCaras | null {
  const original = String(texto || '').trim();
  const t = sinTildes(original);
  if (/\b(olvida|borra) (todas las caras|a todos|todas las personas)\b/.test(t)) return { tipo: 'olvidar_todas' };
  if (/\b(olvida|borra) mi cara\b|\bolvidate de mi cara\b/.test(t)) return { tipo: 'olvidar_mia' };
  let m = /\b(olvida|borra|olvidate de) (la cara de |a )/.exec(t);
  if (m) {
    const nombre = nombreDe(original, m.index + m[0].length);
    if (nombre) return { tipo: 'olvidar', nombre };
  }
  if (/\b(conoceme|aprende(te)? mi cara|recuerda mi cara|guarda mi cara|reconoceme)\b/.test(t)) return { tipo: 'conoceme' };
  m = /\b(te presento a mi (?:amigo|amiga|hermano|hermana|hijo|hija|mama|papa|esposa|esposo|novia|novio|primo|prima|tio|tia|abuelo|abuela) |te presento al? |quiero que conozcas a )/.exec(t);
  const debil = m ? null : /\b(conoce a |el es |ella es |este es |esta es )/.exec(t);
  const hallado = m || debil;
  if (hallado && !/\b(quien|que) es\b/.test(t)) {
    const nombre = nombreDe(original, hallado.index + hallado[0].length);
    // «Este es…», «ella es…», «conoce a…» solo si lo que sigue suena a nombre (con mayúscula, como lo
    // escribe el reconocedor de voz): «este es un buen día» no es una presentación.
    if (nombre && (m || /^[A-ZÁÉÍÓÚÑ]/.test(nombre))) return { tipo: 'presentar', nombre };
  }
  if (/\b(a quien(es)? conoces|que caras (conoces|tienes|guardaste)|a quien reconoces)\b/.test(t)) return { tipo: 'lista' };
  if (/\b(quien soy|me reconoces|sabes quien soy|quien esta (conmigo|aqui)|a quien ves)\b/.test(t)) return { tipo: 'quien' };
  return null;
}

/** La respuesta a «¿te puedo recordar?». null: no dijo ni sí ni no (se toma como no). */
export function esConsentimiento(texto: string): 'si' | 'no' | null {
  const t = sinTildes(String(texto || '')).trim();
  if (/^(no|nop|mejor no|no gracias|prefiero que no|no quiero)\b/.test(t) || /\bno me (recuerdes|guardes)\b/.test(t)) return 'no';
  if (/^(si|sip|claro|por supuesto|dale|va|ok|okay|de acuerdo|esta bien|acepto|puedes|yes|sure)\b/.test(t) || /\b(si,? (puedes|claro)|puedes recordarme|recuerdame)\b/.test(t)) return 'si';
  return null;
}

/**
 * La presentación en curso: quién, hasta cuándo se espera su «sí». Un pedido nuevo reemplaza al
 * anterior; vencida, no vale.
 */
export class Presentacion {
  private p: { nombre: string; hasta: number } | null = null;
  constructor(private reloj: () => number = Date.now) {}
  empezar(nombre: string) {
    this.p = { nombre, hasta: this.reloj() + ESPERA_CONSENTIMIENTO_MS };
  }
  /** La presentación que espera respuesta ahora (null si no hay o venció). */
  pendiente(): string | null {
    if (!this.p) return null;
    if (this.reloj() > this.p.hasta) {
      this.p = null;
      return null;
    }
    return this.p.nombre;
  }
  terminar() {
    this.p = null;
  }
}

/** Para el cerebro: quién está delante, en una frase corta (va en la escena del turno). */
export function frasePresentes(r: Reconocida[], desconocidas: number, en = false): string {
  const nombres = r.map((x) => (x.relacion === 'yo' ? (en ? `${x.nombre} (the person talking to you)` : `${x.nombre} (quien te habla)`) : x.nombre));
  const partes: string[] = [];
  if (nombres.length) partes.push(`${en ? 'I recognize' : 'Reconozco a'} ${nombres.join(', ')}`);
  if (desconocidas > 0) partes.push(en ? `${desconocidas} person(s) I don't know` : `${desconocidas} persona(s) que no conozco`);
  return partes.join('; ');
}

/* ── ¿activó el reconocimiento? (por persona, en los ajustes del teléfono) ────────────────── */

const correoNormal = (c: string) => String(c || '').trim().toLowerCase();

export function carasActivas(mapa: Record<string, number> | undefined, correo: string): boolean {
  return !!mapa?.[correoNormal(correo)];
}

export function conCarasActivas(mapa: Record<string, number> | undefined, correo: string, activas: boolean, ahora = Date.now()): Record<string, number> {
  const c = correoNormal(correo);
  const n = { ...(mapa || {}) };
  if (!c) return n;
  if (activas) n[c] = ahora;
  else delete n[c];
  return n;
}
