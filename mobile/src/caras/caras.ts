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

/**
 * Las caras de UNA foto → quién es cada una: los nombres que el motor confirma y cuántas quedan sin nombre. Dos caras no
 * pueden ser la misma persona: si las dos se parecen a la misma guardada, se queda con el nombre la más parecida y la otra
 * cuenta como «sin nombre» (José, 6-oct: con su hija al lado, la escena no puede decir solo «Reconozco a José»).
 */
export function quienesEnFoto(caras: CaraVista[], conocidas: CaraConocida[]): { r: Reconocida[]; sinNombre: number } {
  const porId = new Map<string, Reconocida>();
  for (const c of caras) {
    const r = identificar(c.vector, conocidas);
    if (!r) continue;
    const ya = porId.get(r.id);
    if (!ya || r.distancia < ya.distancia) porId.set(r.id, r);
  }
  const r = [...porId.values()];
  return { r, sinNombre: Math.max(0, caras.length - r.length) };
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
 * dueña, null (no se guarda a la dueña con otro nombre). Con la dueña SIN guardar y más de una cara, null:
 * no hay cómo saber cuál es ella (revisión del 6-oct: elegía la más grande, que suele ser la dueña, y la
 * guardaba con el nombre de su hija). Con una sola cara y la dueña sin guardar, esa cara: quien ofrece aprender
 * (aprenderPorVoz.ts) antes confirma que es la persona nueva y que la dueña no está en cuadro.
 */
export function caraDelPresentado(caras: CaraVista[], conocidas: CaraConocida[]): CaraVista | null {
  const yo = conocidas.filter((c) => c.relacion === 'yo');
  if (!yo.length && caras.length > 1) return null;
  const otras = caras.filter((c) => !yo.length || !identificar(c.vector, yo));
  if (otras.length > 1) {
    const area = (c: CaraVista) => c.caja.w * c.caja.h;
    const [a, b] = [...otras].sort((x, y) => area(y) - area(x));
    // Dos caras que no son la dueña, de tamaño parecido: no se sabe cuál es la presentada; mejor ninguna que guardar la
    // cara equivocada con ese nombre (José, 6-oct: dos personas en la mesa).
    if (area(a) < AMBIGUO_PRESENTADA * area(b)) return null;
  }
  return masGrande(otras);
}
/** La presentada tiene que verse así de más grande que otra cara desconocida para elegirla sin dudar. */
export const AMBIGUO_PRESENTADA = 1.6;

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
  | { tipo: 'lista' }
  /** «Reconoce a Bea», «¿reconoces a mi hija?», «aprende la cara de Bea»: mirar si está y, si no la conozco, aprenderla. */
  | { tipo: 'reconocer'; nombre?: string; parentesco?: string }
  /** «Me acompaña mi hija», «está conmigo mi esposo Beto»: alguien llegó; si no lo conozco, lo digo y ofrezco aprenderlo. */
  | { tipo: 'acompanante'; parentesco?: string; nombre?: string };

const esParentesco = (palabra: string) => Object.prototype.hasOwnProperty.call(PARENTESCOS, sinTildes(palabra));

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
    // «Te presento a mi hija» (sin nombre): «hija» no es un nombre; la mesa pregunta cómo se llama (acompañante, abajo).
    // «Te presento a esa» / «… a esta persona»: un pronombre no es un nombre (revisión del 6-oct).
    if (nombre && esNombreDicho(nombre) && (m || /^[A-ZÁÉÍÓÚÑ]/.test(nombre))) return { tipo: 'presentar', nombre, ...(parentesco ? { parentesco } : {}) };
  }
  if (/\b(a quien(es)? conoces|que caras (conoces|tienes|guardaste)|a quien reconoces)\b/.test(t)) return { tipo: 'lista' };
  if (/\b(quien soy|me reconoces|sabes quien soy|quien esta (conmigo|aqui)|a quien ves)\b/.test(t)) return { tipo: 'quien' };
  // José, 6-oct: «Reconoce a [su hija]» llegaba al cerebro, que contestaba «no puedo identificar personas por su cara»
  // (falso: el motor de caras del teléfono reconoce a quien está guardado). Ahora lo atiende la mesa con el motor.
  // «¿Quién es ella?» al final de la frase (no «¿quién es el presidente?»).
  if (/\bquien es (ella|el|esta persona|este|esta|la otra persona|el otro|la otra)[\s?.!]*$/.test(t) || /\b((la|lo) reconoces|sabes quien es (ella|el)|reconoce(la|lo)|reconocer(la|lo))\b/.test(t)) return { tipo: 'quien' };
  m = new RegExp(`\\b(?:reconoce(?:s)?|reconocer|(?:aprende(?:te)?|recuerda|guarda|memoriza) la cara de)\\s+(?:(?:a|al)\\s+)?(?:mi (${RE_PARENTESCO})\\b,?\\s*)?`).exec(t);
  if (m) {
    const desde = m.index + m[0].length;
    let parentesco: string | undefined = m[1] ? PARENTESCOS[m[1]] : undefined;
    let hasta = original.length;
    const despues = new RegExp(`[,\\s]+mi (${RE_PARENTESCO})\\b`).exec(t.slice(desde));
    if (despues) {
      parentesco = parentesco || PARENTESCOS[despues[1]];
      hasta = desde + despues.index;
    }
    const nombre = nombreDe(original.slice(0, hasta), desde);
    // El nombre con mayúscula (como lo escribe el reconocedor de voz): «reconoce a la gente» no es un nombre.
    const conNombre = !!nombre && /^[A-ZÁÉÍÓÚÑ]/.test(nombre) && esNombreDicho(nombre);
    if (conNombre || parentesco) return { tipo: 'reconocer', ...(conNombre ? { nombre } : {}), ...(parentesco ? { parentesco } : {}) };
  }
  if (/\b(aprende(te)?|recuerda|guarda|memoriza) (su|esta) cara\b/.test(t)) return { tipo: 'reconocer' };
  const acomp =
    new RegExp(`\\b(?:me acompana(?:n)?|esta(?:n)? (?:aqui )?conmigo|vino conmigo|viene conmigo|vinieron conmigo|aqui esta|aqui tengo a|estoy con|te presento a)\\s+(?:a\\s+)?mi (${RE_PARENTESCO})\\b`).exec(t) ||
    new RegExp(`\\bmi (${RE_PARENTESCO}) (?:me acompana|esta (?:aqui )?conmigo|esta aqui|vino conmigo|viene conmigo)\\b`).exec(t);
  if (acomp) {
    const parentesco = PARENTESCOS[acomp[1]];
    // «Me acompaña mi hija Bea» / «… mi hija, que se llama Bea»: con el nombre dicho.
    const fin = acomp.index + acomp[0].length;
    const tras = /^[,\s]+(?:que se llama |se llama )?/.exec(t.slice(fin));
    const nombre = tras ? nombreDicho(original, fin + tras[0].length) : '';
    // Con «se llama» es un nombre seguro; si no, solo con mayúscula («… mi hija hoy» no es «Hoy»).
    const conNombre = !!nombre && (/llama/.test(tras?.[0] || '') || /^[A-ZÁÉÍÓÚÑ]/.test(original.slice(fin + (tras ? tras[0].length : 0)).trim()));
    return { tipo: 'acompanante', parentesco, ...(conNombre ? { nombre } : {}) };
  }
  return null;
}

/* ── aprender una cara que no conozco, por voz (José, 6-oct) ───────────────────────────────── */

/**
 * Lo que espera el nombre después de «veo a alguien que todavía no conozco, ¿cómo se llama?». Lo contesta la dueña (la
 * mesa lo pasa por «¿quién habla?»); después la persona misma tiene que decir «sí» (Presentacion): sin eso no se guarda.
 */
export const ESPERA_NOMBRE_MS = 45_000;

/**
 * `soloNueva`: la dueña no tiene su cara guardada y a la vista hay UNA cara sin nombre, que puede ser la suya (revisión
 * del 6-oct: «me acompaña mi hija» con la hija fuera de cuadro guardaba a la dueña como su hija). No se presenta a nadie
 * hasta que la dueña confirme que esa cara es la persona nueva; `nombre`: el que dijo, esperando ese «sí».
 */
export type OfertaPendiente = { parentesco?: string; soloNueva?: boolean; nombre?: string };

export class OfertaAprender {
  private o: (OfertaPendiente & { hasta: number }) | null = null;
  constructor(private reloj: () => number = Date.now) {}
  empezar(parentesco?: string, extra: { soloNueva?: boolean; nombre?: string } = {}) {
    this.o = {
      ...(parentesco ? { parentesco } : {}),
      ...(extra.soloNueva ? { soloNueva: true } : {}),
      ...(extra.nombre ? { nombre: extra.nombre } : {}),
      hasta: this.reloj() + ESPERA_NOMBRE_MS,
    };
  }
  /** La oferta que espera respuesta (null si no hay o venció). */
  pendiente(): OfertaPendiente | null {
    if (!this.o) return null;
    if (this.reloj() > this.o.hasta) {
      this.o = null;
      return null;
    }
    const { hasta: _hasta, ...resto } = this.o;
    return resto;
  }
  terminar() {
    this.o = null;
  }
}

/**
 * Palabras que no son un nombre aunque se digan solas (revisión del 6-oct: la espera del nombre tomaba «qué hora es» →
 * «Hora», «esa» → «Esa», «la niña» → «Niña», «ahorita no» → «Ahorita», «olvida a Bea» → «Olvida»). Pronombres,
 * artículos, personas sin nombre («niña», «mamá»…), adverbios, saludos, muletillas, verbos y órdenes; los parentescos,
 * aparte (PARENTESCOS). Ante la duda, no es un nombre.
 */
const NO_NOMBRES = new Set(
  [
    // pronombres, demostrativos, artículos, preposiciones y conjunciones
    'yo tu te ti el ella ellos ellas usted ustedes nosotros nosotras vos me se le lo la les los nos mi mis tus su sus esto este esta estos estas eso ese esa esos esas aquel aquella aquello aquellos aquellas alguien nadie nada todo toda todos todas otro otra otros otras uno una unos unas un al del de a en con sin sobre entre hasta desde por para y e o u ni pero sino que porque como cuando donde quien quienes cual cuales cuanto cuanta si no tambien tampoco',
    // personas sin nombre
    'nina nino ninas ninos nena nene bebe bebita bebito chica chico chicas chicos muchacha muchacho chamaca chamaco cipota cipote persona personas gente senor senora senorita senores mami papi mamita papito hombre mujer joven jovencita amiguita amiguito familia invitado invitada visita',
    // adverbios, tiempo y lugar
    'hoy ayer manana ahora ahorita luego despues antes ya aqui alli ahi aca alla bien mal muy mas menos casi siempre nunca jamas todavia aun tarde temprano rapido pronto quiza quizas tal vez igual asi entonces solo nomas apenas mismo misma',
    // saludos, cortesía, muletillas y respuestas
    'hola adios chao chau bye hello hi hey buenas buenos buena bueno noches dias tardes gracias porfa favor perdon disculpa disculpe claro vale ok okay listo dale va sale perfecto exacto cierto verdad seguro sip nop yes nope sure thanks please ah eh oh uh mmm hmm aja ey oye pues osea',
    // verbos y órdenes
    'apaga apagar enciende encender prende prender para parar calla callar callate silencio stop alto espera esperar sigue seguir olvida olvidar olvidate borra borrar mira mirar mirame oir escucha escuchame ven vete deja dejar dejalo pon poner quita quitar abre abrir cierra cerrar busca buscar llama llamar llamame cuelga colgar manda mandar envia enviar lee leer dime di dame haz hacer ayuda ayudame muestra muestrame canta cantar cuenta contar repite cancela cancelar sube baja voltea cambia despierta duerme descansa tengo tiene tienes es son soy eres esta estan estoy hay fue era ser estar quiero quieres puedo puedes sabes se creo pienso vamos voy vas',
    // cosas de la mesa
    'hora dia fecha tiempo clima camara foto cara caras voz nombre',
  ]
    .join(' ')
    .split(' ')
);
/** Títulos que solo valen delante de un nombre («Don Pedro»), no solos. */
const TITULOS = new Set('don dona doctor doctora dr dra profe profesor profesora ingeniero ingeniera licenciado licenciada'.split(' '));
const PALABRA_NOMBRE = /^[A-Za-zÁÉÍÓÚÑÜáéíóúñü][A-Za-zÁÉÍÓÚÑÜáéíóúñü'-]{1,24}$/;

/** ¿Esta palabra puede ser (parte de) un nombre propio? */
export function pareceNombre(w: string): boolean {
  const k = sinTildes(w);
  if (!PALABRA_NOMBRE.test(w) || NO_NOMBRES.has(k) || TITULOS.has(k) || esParentesco(w)) return false;
  // «Cállate», «dímelo», «olvídalo»: una orden con el pronombre pegado (lleva tilde), no un nombre.
  if (/[áéíóú]/i.test(w) && k.length >= 5 && /(te|me|lo|nos)$/.test(k)) return false;
  return true;
}

/** ¿Lo dicho tras «te presento a…» es un nombre? (la primera palabra, o un título y un nombre: «Don Pedro»). */
function esNombreDicho(nombre: string): boolean {
  const [a, b] = nombre.split(/\s+/);
  if (!a) return false;
  if (TITULOS.has(sinTildes(a))) return !!b && pareceNombre(b);
  return pareceNombre(a);
}

/** Hasta 3 palabras de nombre desde `desde` (sin artículos, «mi», parentescos ni muletillas delante). '' si no hay. */
function nombreDicho(original: string, desde: number): string {
  const palabras = original
    .slice(desde)
    .replace(/[.,;:!?¿¡"«»]/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const out: string[] = [];
  for (const w of palabras) {
    const k = sinTildes(w);
    if (!out.length && (/^(a|al|la|el|mi|es|se|llama|que|pues)$/.test(k) || esParentesco(w))) continue;
    if (!pareceNombre(w)) break;
    out.push(w.charAt(0).toUpperCase() + w.slice(1));
    if (out.length === 3) break;
  }
  return out.join(' ').slice(0, 60);
}

/** Las palabras de un nombre al principio de `palabras`: 1–2 con forma de nombre (o un título y uno o dos). [] si no. */
function nombreAlInicio(palabras: string[]): string[] {
  const out: string[] = [];
  let i = 0;
  let max = 2;
  if (palabras[0] && TITULOS.has(sinTildes(palabras[0]))) {
    if (!palabras[1] || !pareceNombre(palabras[1])) return [];
    out.push(palabras[i++]);
    max = 3;
  }
  while (i < palabras.length && out.length < max && pareceNombre(palabras[i])) out.push(palabras[i++]);
  return out;
}
const conMayuscula = (ws: string[]) =>
  ws
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
    .slice(0, 60);

export type RespuestaNombre = { tipo: 'nombre'; nombre: string; parentesco?: string } | { tipo: 'no' } | { tipo: 'si' };

/** Muletillas que pueden ir delante de la respuesta («sí, se llama Bea», «pues Bea»). */
const RE_MULETILLA = /^(?:(?:pues|bueno|si|claro|ah|eh|mira|oye|ok|okay|dale|va|ya) )+/;
/** «Se llama…», «su nombre es…», «llámala…» (con «ella», «él» o «mi hija» delante). */
const RE_SE_LLAMA = new RegExp(`^(?:(?:ella|el) |mi (${RE_PARENTESCO}) )?(?:se llama|su nombre es|llamala|llamalo) `);
/** «Es Bea», «es mi hija Bea», «ella es Bea»: «es» al inicio. */
const RE_ES = /^(?:(?:ella|el|esta|este|esa|ese) )?es /;
/** Sin signos y con un solo espacio entre palabras (las dos formas, la dicha y la sin tildes, quedan palabra por palabra). */
const limpia = (t: string) =>
  t
    .replace(/[.,;:!?¿¡"«»]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** ¿La respuesta trae el nombre con su marca («se llama Bea», «es Bea»)? A esa no la interrumpe una orden. */
export function nombreConMarca(texto: string): boolean {
  const resto = `${sinTildes(limpia(String(texto || '')))} `.replace(RE_MULETILLA, '');
  return RE_SE_LLAMA.test(resto) || RE_ES.test(resto);
}

/**
 * La respuesta de la dueña a «¿cómo se llama?», ESTRICTA (revisión del 6-oct): solo «se llama Bea» / «su nombre es
 * Bea», «es Bea» / «es mi hija Bea» al inicio, o un nombre propio solo (1–2 palabras con forma de nombre: «Bea», «Bea
 * María», «Bea, mi hija»). «No», «ahorita no», «mejor no»: no se aprende. Un «sí» sin nombre: hay que volver a
 * preguntar. null: no contestó eso (una orden, una pregunta, otra frase: la oferta se suelta y la frase sigue su camino).
 * Ante la duda, no es un nombre.
 */
export function nombreDeRespuesta(texto: string): RespuestaNombre | null {
  const o = limpia(String(texto || ''));
  const t = sinTildes(o);
  if (!t) return null;
  const pal = o.split(' ');
  const k = t.split(' ');
  const mul = RE_MULETILLA.exec(`${t} `);
  const desde = mul ? mul[0].trim().split(' ').length : 0;
  const resto = `${k.slice(desde).join(' ')} `;
  /** El nombre desde la palabra `i` («mi hija» delante se salta) y las palabras que quedan después. */
  const desdePalabra = (i: number) => {
    let parentesco: string | undefined;
    if (k[i] === 'mi' && k[i + 1] && esParentesco(k[i + 1])) {
      parentesco = PARENTESCOS[k[i + 1]];
      i += 2;
    }
    const n = nombreAlInicio(pal.slice(i));
    return { n, parentesco, tras: k.slice(i + n.length) };
  };
  const parentescoTras = (tras: string[]) => (tras[0] === 'mi' && tras[1] && esParentesco(tras[1]) ? PARENTESCOS[tras[1]] : undefined);
  const marca = RE_SE_LLAMA.exec(resto) || RE_ES.exec(resto);
  if (marca) {
    const r = desdePalabra(desde + marca[0].trim().split(' ').length);
    const parentesco = (marca[1] ? PARENTESCOS[marca[1]] : undefined) || r.parentesco || parentescoTras(r.tras);
    // Lo que siga al nombre no importa, salvo un «no» («se llama… no, mejor no»).
    if (r.n.length && !r.tras.includes('no')) return { tipo: 'nombre', nombre: conMayuscula(r.n), ...(parentesco ? { parentesco } : {}) };
  }
  // «No», «ahorita no», «mejor no», «no, gracias»: una frase corta con un «no».
  if (k.length - desde <= 5 && k.slice(desde).includes('no')) return { tipo: 'no' };
  if (/^(dejalo|olvidalo|luego|despues|en otro momento|otro dia|ninguno|ninguna) /.test(resto)) return { tipo: 'no' };
  if (!marca && desde < k.length) {
    // El nombre solo: la frase entera es el nombre (1–2 palabras), o el nombre y «mi hija» detrás.
    const r = desdePalabra(desde);
    const parentesco = r.parentesco || parentescoTras(r.tras);
    if (r.n.length && (!r.tras.length || (parentesco && r.tras.length === 2))) return { tipo: 'nombre', nombre: conMayuscula(r.n), ...(parentesco ? { parentesco } : {}) };
  }
  if (/^(si|sip|claro|dale|va|ok|okay|de acuerdo|esta bien|por favor|yes|sure)( |$)/.test(t) && k.length <= 4) return { tipo: 'si' };
  return null;
}

/** ¿La frase de la mesa ofrece aprender una cara? (la dice la mesa o el cerebro: «¿cómo se llama? … la recuerdo»). */
export function ofreceAprender(texto: string): boolean {
  const t = sinTildes(String(texto || ''));
  return /\bcomo se llama\b|\bwhat'?s (their|his|her) name\b/.test(t) && /\b(la|lo|te|le) recuerdo\b|\baprendo su cara\b|\bremember\b|\blearn (their|his|her) face\b/.test(t);
}

/** Lo que dice la mesa al ver a alguien que no conoce: la verdad y la oferta de aprenderlo (con su «sí» después). */
export function fraseOfertaAprender(parentesco?: string, en = false): string {
  if (en) return "I see someone I don't know yet. What's their name? If you want, I'll learn their face and remember it.";
  return `Veo a alguien que todavía no conozco. ¿Cómo se llama${parentesco ? ` tu ${parentesco}` : ''}? Si quieres, aprendo su cara y la recuerdo.`;
}

/**
 * Caras sin nombre a la vista y la dueña SIN su cara guardada (revisión del 6-oct): una de esas caras puede ser la suya.
 * Con dos o más, no hay cómo saber cuál es la nueva: no se ofrece nada (`espera` false). Con una, se pide que confirme que
 * esa cara es la persona nueva, sin ella en cuadro (`espera` true: OfertaAprender con `soloNueva`); con el nombre ya dicho,
 * solo el «sí».
 */
export function ofertaSinDuena(sinNombre: number, p: { parentesco?: string; nombre?: string } = {}, en = false): { texto: string; espera: boolean } {
  const quien = p.nombre || (p.parentesco ? (en ? `your ${p.parentesco}` : `tu ${p.parentesco}`) : en ? 'the new person' : 'la persona nueva');
  if (sinNombre >= 2)
    return {
      texto: en
        ? `I see faces I don't know, but I don't know you yet either, so I can't tell which one is ${quien}. First say “get to know me”, or have only ${quien} in front of the camera.`
        : `Veo caras que no conozco, pero a ti todavía no te conozco, así que no sé cuál es ${p.nombre ? `la de ${p.nombre}` : quien}. Primero dime «conóceme», o que quede solo ${quien} frente a la cámara.`,
      espera: false,
    };
  const base = en ? "I see a face I don't know, but I don't know you yet either: it could be yours." : 'Veo una cara que no conozco, pero a ti todavía no te conozco: puede ser la tuya.';
  if (p.nombre)
    return {
      texto: en ? `${base} Is the only face in front of the camera ${p.nombre}'s, without you? Say “yes”.` : `${base} ¿La única cara frente a la cámara es la de ${p.nombre}, sin ti? Dime «sí».`,
      espera: true,
    };
  return {
    texto: en
      ? `${base} If the one alone in front of the camera is ${quien}, without you, say “yes” and their name; if it's you, say “get to know me”.`
      : `${base} Si la que está sola frente a la cámara es ${quien}, sin ti, dime «sí» y su nombre; si eres tú, di «conóceme».`,
    espera: true,
  };
}

type Quien = Pick<Reconocida, 'nombre' | 'relacion' | 'parentesco'>;

/**
 * «¿Quién está conmigo?», «¿quién es ella?»: los nombres que el motor de caras confirmó y, si hay alguien sin nombre, la
 * verdad («alguien que todavía no conozco») con la oferta de aprenderlo. `ofrecer`: la mesa queda esperando el nombre.
 */
export function respuestaQuien(p: { r: Quien[]; sinNombre: number }, en = false): { texto: string; ofrecer: boolean } {
  const sin = Math.max(0, p.sinNombre || 0);
  if (!p.r.length && !sin) return { texto: en ? 'I don’t see anyone in front of the camera.' : 'No veo a nadie frente a la cámara.', ofrecer: false };
  if (!p.r.length) return { texto: fraseOfertaAprender(undefined, en), ofrecer: true };
  const quien = (x: Quien) =>
    x.relacion === 'yo' ? (en ? `${x.nombre}: that’s you` : `${x.nombre}: eres tú`) : x.parentesco ? (en ? `${x.nombre}, your ${x.parentesco}` : `${x.nombre}, tu ${x.parentesco}`) : x.nombre;
  const base = `${en ? 'I see' : 'Veo a'} ${p.r.map(quien).join(', ')}`;
  if (!sin) return { texto: `${base}.`, ofrecer: false };
  const oferta = en ? " What's their name? If you want, I'll learn their face and remember it." : ' ¿Cómo se llama? Si quieres, aprendo su cara y la recuerdo.';
  return { texto: `${base}, ${en ? 'and someone I don’t know yet.' : 'y a alguien que todavía no conozco.'}${oferta}`, ofrecer: true };
}

/**
 * La respuesta a «¿te puedo recordar?». null: no dijo ni sí ni no (se toma como no). Un «sí» con un «pero», un «no» o un
 * «espera» detrás no es un «sí» («sí, pero no», «sí… no sé», «sí, espera»: revisión del 6-oct); «recuérdame» solo como
 * respuesta entera («recuérdame lo del banco» es otra cosa).
 */
export function esConsentimiento(texto: string): 'si' | 'no' | null {
  const t = sinTildes(limpia(String(texto || '')));
  if (/^(no|nop|nel|mejor no|no gracias|prefiero que no|no quiero)\b/.test(t) || /\bno me (recuerdes|guardes)\b/.test(t) || /\b(claro|por supuesto) que no\b/.test(t)) return 'no';
  if (/\b(no|pero|aunque|espera|mejor|luego|despues|todavia|nunca|jamas|otro dia|manana)\b/.test(t) || t.split(' ').length > 8) return null;
  if (/^(si|sip|claro|por supuesto|dale|va|ok|okay|de acuerdo|esta bien|acepto|puedes|yes|sure)\b/.test(t)) return 'si';
  if (/^(si )?(puedes recordarme|recuerdame)( por favor| porfa)?$/.test(t)) return 'si';
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
