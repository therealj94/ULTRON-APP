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
/**
 * Muestras para aprender una cara. Antes 3 fotos seguidas (casi iguales: la misma pose y la misma luz);
 * ahora 5 elegidas entre las tomas de varias poses dichas en voz alta (`POSES`), las más distintas entre
 * sí que sigan siendo claramente la misma persona (`elegirMuestras`).
 */
export const MUESTRAS_APRENDER = 5;
/** Tope de muestras por persona (igual que el servidor, lib/caras-miembro.ts MAX_MUESTRAS). */
export const MAX_MUESTRAS = 12;

/** Lo que se le pide a la persona mientras aprende su cara: una toma (o dos) por pose. */
export const POSES: readonly { es: string; en: string }[] = [
  { es: 'Mírame de frente…', en: 'Look straight at me…' },
  { es: 'Gira un poquito la cabeza a tu izquierda…', en: 'Turn your head a little to your left…' },
  { es: 'Ahora un poquito a tu derecha…', en: 'Now a little to your right…' },
  { es: 'Sube un poco la barbilla…', en: 'Raise your chin a little…' },
  { es: 'Y otra vez de frente.', en: 'And straight at me again.' },
];

export type Relacion = 'yo' | 'conocido';
/** `parentesco`: lo que la dueña dijo al presentarla («mi esposa Ana» → «esposa»). */
export type CaraConocida = { id: string; nombre: string; relacion: Relacion; vectores: number[][]; parentesco?: string };
/** `indice`: a qué caja de ML Kit pertenece (cuando el motor analizó recortes de esas cajas). */
export type CaraVista = { caja: { x: number; y: number; w: number; h: number }; vector: number[]; puntaje: number; indice?: number };

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

/**
 * `margen`: cuánto le gana al segundo más parecido (de otra persona); 1 si no hay segundo.
 * `parentesco`: el de la persona guardada, si lo tiene.
 */
export type Reconocida = { id: string; nombre: string; relacion: Relacion; distancia: number; margen?: number; parentesco?: string; unica?: true };

/**
 * ¿De quién es este vector? La distancia a una persona es la menor a cualquiera de sus muestras.
 * null si nadie está bajo el umbral o si dos personas distintas quedan demasiado parejas (dudar es
 * mejor que llamar a alguien por otro nombre).
 */
/** La distancia a la persona guardada más parecida (Infinity sin nadie): para la miga de «no sé» (pistaNativa.ts). */
export function distanciaMasCercana(vector: number[], conocidas: CaraConocida[]): number {
  let d = Infinity;
  for (const c of conocidas) for (const v of c.vectores) if (vectorValido(v)) d = Math.min(d, distancia(vector, v));
  return d;
}

export function identificar(vector: number[], conocidas: CaraConocida[]): Reconocida | null {
  const filas = conocidas
    .map((c) => ({ c, d: Math.min(...c.vectores.filter(vectorValido).map((v) => distancia(vector, v))) }))
    .filter((f) => Number.isFinite(f.d))
    .sort((a, b) => a.d - b.d);
  const [primero, segundo] = filas;
  if (!primero || primero.d >= UMBRAL) return null;
  if (segundo && segundo.d - primero.d < MARGEN) return null;
  const r3 = (x: number) => Math.round(x * 1000) / 1000;
  return {
    id: primero.c.id,
    nombre: primero.c.nombre,
    relacion: primero.c.relacion,
    distancia: r3(primero.d),
    margen: segundo ? r3(segundo.d - primero.d) : 1,
    ...(primero.c.parentesco ? { parentesco: primero.c.parentesco } : {}),
    // Revisión 7 (M5): con menos de 2 personas guardadas el margen no dice nada (no hay segunda con quién comparar).
    ...(new Set(conocidas.map((c) => c.id)).size < 2 ? { unica: true as const } : {}),
  };
}

/* ── aprender: elegir muestras y aprender con el uso ────────────────────────────────────────── */

/** El vector más «central» de una lista (menor suma de distancias a los demás). */
function medoide(vs: number[][]): number {
  let mejor = 0;
  let suma = Infinity;
  vs.forEach((a, i) => {
    const t = vs.reduce((acc, b) => acc + distancia(a, b), 0);
    if (t < suma) {
      suma = t;
      mejor = i;
    }
  });
  return mejor;
}

/** Más lejos que esto del centro de las tomas, no es la misma cara (otra persona que pasó, una mala detección). */
export const DISPERSION_MAX = 0.42;

/**
 * Las muestras que se guardan de las tomas de `POSES`: fuera las que no son la misma persona (lejos del
 * medoide), y de las demás, las `n` más DISTINTAS entre sí (la central primero y luego, una a una, la más
 * lejana a las ya elegidas). Tres fotos iguales enseñan una sola pose; cinco distintas, la cara.
 */
export function elegirMuestras(tomas: CaraVista[], n = MUESTRAS_APRENDER): CaraVista[] {
  const validas = tomas.filter((c) => c && vectorValido(c.vector));
  if (validas.length <= 1) return validas.slice(0, n);
  const centro = validas[medoide(validas.map((c) => c.vector))];
  const parecidas = validas.filter((c) => distancia(c.vector, centro.vector) <= DISPERSION_MAX);
  const elegidas: CaraVista[] = [centro];
  const resto = parecidas.filter((c) => c !== centro);
  while (elegidas.length < n && resto.length) {
    let k = 0;
    let lejos = -1;
    resto.forEach((c, i) => {
      const d = Math.min(...elegidas.map((e) => distancia(e.vector, c.vector)));
      if (d > lejos) {
        lejos = d;
        k = i;
      }
    });
    // Una toma idéntica a una ya elegida no enseña nada.
    if (lejos < 0.02) break;
    elegidas.push(resto.splice(k, 1)[0]);
  }
  return elegidas;
}

/**
 * Suma muestras con tope: si se pasa, sale la MÁS REDUNDANTE (de la pareja más parecida, la más vieja de
 * las dos). Así se queda con lo que enseña algo nuevo (otra luz, con lentes) y no con diez copias de la
 * misma toma. El servidor hace lo mismo (lib/caras-miembro.ts podarMuestras).
 */
export function sumarMuestras(vectores: number[][], nuevos: number[][], max = MAX_MUESTRAS): number[][] {
  const vs = [...vectores, ...nuevos].filter(vectorValido);
  while (vs.length > max) {
    let quitar = 0;
    let menor = Infinity;
    for (let i = 0; i < vs.length; i++)
      for (let j = i + 1; j < vs.length; j++) {
        const d = distancia(vs[i], vs[j]);
        if (d < menor) {
          menor = d;
          quitar = i;
        }
      }
    vs.splice(quitar, 1);
  }
  return vs;
}

/**
 * Aprender con el uso: cuando se reconoce a alguien con mucha seguridad, a veces se guarda esa toma como
 * muestra nueva (se adapta a la luz, a los lentes, al pelo). Solo si:
 *  · la distancia queda muy bajo el umbral (≤ `dMax`) y con margen amplio sobre el segundo;
 *  · la identidad ya estaba CONFIRMADA por votos (no un acierto suelto);
 *  · la toma enseña algo (no es casi igual a una muestra que ya hay: ≥ `dMin`);
 *  · la cara se ve grande (no una cara lejana y borrosa);
 *  · y sin abusar: una vez cada `cadaMs` por persona y `porSesion` por sesión.
 */
export const APRENDER = { dMax: 0.36, dMin: 0.1, margenMin: 0.15, tamMin: 0.12, cadaMs: 10 * 60_000, porSesion: 4 };

export function debeAprender(r: Reconocida, o: { confirmada: boolean; tam: number; ahora: number; ultima?: number; enSesion: number }): boolean {
  if (!o.confirmada) return false;
  if (!(r.distancia <= APRENDER.dMax && r.distancia >= APRENDER.dMin)) return false;
  if ((r.margen ?? 0) < APRENDER.margenMin) return false;
  if (o.tam < APRENDER.tamMin) return false;
  if (o.enSesion >= APRENDER.porSesion) return false;
  return !o.ultima || o.ahora - o.ultima >= APRENDER.cadaMs;
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

/** Parentescos que se entienden al presentar (sin tildes → como se escribe). */
export const PARENTESCOS: Record<string, string> = {
  amigo: 'amigo', amiga: 'amiga', hermano: 'hermano', hermana: 'hermana', hijo: 'hijo', hija: 'hija',
  mama: 'mamá', papa: 'papá', madre: 'madre', padre: 'padre', esposa: 'esposa', esposo: 'esposo',
  mujer: 'esposa', marido: 'esposo', pareja: 'pareja', novia: 'novia', novio: 'novio', primo: 'primo',
  prima: 'prima', tio: 'tío', tia: 'tía', abuelo: 'abuelo', abuela: 'abuela', nieto: 'nieto', nieta: 'nieta',
  sobrino: 'sobrino', sobrina: 'sobrina', suegro: 'suegro', suegra: 'suegra', cunado: 'cuñado', cunada: 'cuñada',
  socio: 'socio', socia: 'socia', jefe: 'jefe', jefa: 'jefa', companero: 'compañero', companera: 'compañera',
  vecino: 'vecino', vecina: 'vecina',
};
const RE_PARENTESCO = Object.keys(PARENTESCOS).join('|');

/** El parentesco tal como se guarda («mama» → «mamá»), o undefined si no es uno conocido. */
export function parentescoValido(v: unknown): string | undefined {
  const k = sinTildes(String(v || '')).trim();
  return Object.prototype.hasOwnProperty.call(PARENTESCOS, k) ? PARENTESCOS[k] : undefined;
}

export type PedidoCaras =
  | { tipo: 'conoceme' }
  | { tipo: 'presentar'; nombre: string; parentesco?: string }
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
  m = new RegExp(`\\b(?:te presento a mi (${RE_PARENTESCO}),? |(?:te presento al? |quiero que conozcas a )(?:mi (${RE_PARENTESCO}),? )?)`).exec(t);
  const debil = m ? null : new RegExp(`\\b(?:conoce a |el es |ella es |este es |esta es )(?:mi (${RE_PARENTESCO}),? )?`).exec(t);
  const hallado = m || debil;
  if (hallado && !/\b(quien|que) es\b/.test(t)) {
    let parentesco: string | undefined = PARENTESCOS[hallado[1] || hallado[2] || ''];
    // «Te presento a Ana, mi esposa»: el parentesco va después del nombre, y el nombre termina ahí.
    const desde = hallado.index + hallado[0].length;
    let hasta = original.length;
    const despues = new RegExp(`[,\\s]+mi (${RE_PARENTESCO})\\b`).exec(t.slice(desde));
    if (despues) {
      parentesco = parentesco || PARENTESCOS[despues[1]];
      hasta = desde + despues.index;
    }
    const nombre = nombreDe(original.slice(0, hasta), desde);
    // «Este es…», «ella es…», «conoce a…» solo si lo que sigue suena a nombre (con mayúscula, como lo
    // escribe el reconocedor de voz): «este es un buen día» no es una presentación.
    if (nombre && (m || /^[A-ZÁÉÍÓÚÑ]/.test(nombre))) return { tipo: 'presentar', nombre, ...(parentesco ? { parentesco } : {}) };
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

/**
 * Para el cerebro: quién está delante, en una frase corta (va en la escena del turno). Con parentesco:
 * «Reconozco a Ana (tu esposa)». Con la cámara trasera lo dice: no son quien mira la pantalla.
 */
export function frasePresentes(r: Pick<Reconocida, 'nombre' | 'relacion' | 'parentesco'>[], desconocidas: number, en = false, trasera = false): string {
  const nombre = (x: Pick<Reconocida, 'nombre' | 'relacion' | 'parentesco'>) => {
    if (x.relacion === 'yo') return trasera ? x.nombre : en ? `${x.nombre} (the person talking to you)` : `${x.nombre} (quien te habla)`;
    if (x.parentesco) return en ? `${x.nombre} (your ${x.parentesco})` : `${x.nombre} (tu ${x.parentesco})`;
    return x.nombre;
  };
  const partes: string[] = [];
  if (r.length) partes.push(`${en ? 'I recognize' : 'Reconozco a'} ${r.map(nombre).join(', ')}`);
  if (desconocidas > 0) partes.push(en ? `${desconocidas} person(s) I don't know` : `${desconocidas} persona(s) que no conozco`);
  const f = partes.join('; ');
  if (!f || !trasera) return f;
  return en ? `With the back camera: ${f}` : `Con la cámara trasera: ${f.charAt(0).toLowerCase()}${f.slice(1)}`;
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
