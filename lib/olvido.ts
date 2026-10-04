/**
 * BORRAR Y CORREGIR DE VERDAD, EN TODOS LOS ALMACENES (documento maestro, sección 13; AUR11).
 *
 * Un dato de la persona vive en varios sitios: «lo que sé de ti» (lib/conocer-persona.ts), la respuesta del
 * perfil con la misma clave común («Dónde vives» ↔ «Vive en Tela», lib/perfil-persona.ts) y los derivados de
 * texto —los resúmenes de conversaciones de antes y el tramo en curso (lib/episodios.ts)—, además del system
 * congelado del turno (server/prompt-turno.ts, por la firma). Aquí se orquesta:
 *
 *   BORRAR (`suprimir`, `suprimirTodo`, y vaciar una respuesta en `guardarPerfilGobernado`):
 *     1. se arma la marca con todo lo que cubre (ids, claves comunes, campos del perfil, palabras);
 *     2. se escribe la marca ANTES de tocar nada (lib/supresiones.ts): desde ahí ninguna lectura lo recupera;
 *     3. se procesa cada almacén y se cierra en la marca con su recibo durable;
 *     4. el recibo dice qué quedó: `confirmado` (todo durable) o `pendiente` (algo sin recibo: la marca
 *        protege mientras tanto y `reanudarSupresiones` lo termina, también tras un reinicio).
 *
 *   CORREGIR (`corregir`, y contestar otra vez una pregunta): cambia el dato y sus USOS ACTIVOS: la respuesta
 *   del perfil que lo repite, los resúmenes que dicen lo viejo (una marca de corrección tapa el valor viejo,
 *   y un tramo de antes no lo vuelve a enseñar) y la firma del system congelado (sube `ediciones`).
 *
 *   COPIAS VIEJAS (`guardarPerfilGobernado`): lo que manda un teléfono que estuvo offline —la caché reenviada
 *   sin hora, un cambio hecho antes del borrado— no pisa la marca; el teléfono recibe `suprimidos` y la hora
 *   de cada marca (`supresiones`) para soltar su copia.
 */
import { CajonNoDisponible } from './cerebro-comun';
import { agregarDato, corregirDato, datosQueCubre, limitarDato, purgarConocer, type Alcance, type ClaveDato, type Dato, type Origen } from './conocer-persona';
import { purgarEpisodios } from './episodios';
import { actualizarPerfil, CAMPOS_ENCUESTA, guardarPerfil, leerPerfilSeguro, PerfilNoDisponible, type Cambios, type Perfil } from './perfil-persona';
import { ALMACENES, cerrarAlmacen, campoSuprimido, camposSuprimidos, marcarSupresion, terminosDe, tumbasDe, type Almacen, type Tumba } from './supresiones';

/**
 * LA CLAVE COMÚN de cada respuesta del perfil: la categoría y la clave de su copia en «lo que sé de ti». La
 * misma tabla que la app (mobile/src/primeravez/flujo.ts CLAVE_CONOCER; una prueba las compara).
 */
export const CAMPO_CLAVE = {
  trabajo: { categoria: 'trabajo', clave: 'oficio' },
  vive: { categoria: 'rutinas', clave: 'vive' },
  familia: { categoria: 'familia', clave: 'familia:encuesta' },
  gustos: { categoria: 'gustos', clave: 'pasatiempos' },
  comida: { categoria: 'gustos', clave: 'comida favorita' },
  musica: { categoria: 'gustos', clave: 'musica' },
  ayuda: { categoria: 'metas', clave: 'quiere de aura' },
} as const;
export type CampoConClave = keyof typeof CAMPO_CLAVE;

/** Cómo arma la app el dato de cada respuesta (flujo.ts datoConocerDe): para volver del dato a la respuesta. */
const PREFIJO: Record<CampoConClave, string> = {
  trabajo: 'Se dedica a: ',
  vive: 'Vive en ',
  familia: 'Su familia: ',
  gustos: 'Le gusta: ',
  comida: 'Comida favorita: ',
  musica: 'Música que le gusta: ',
  ayuda: 'Quiere que AURA le ayude a: ',
};

const plegarClave = (s: string | undefined) =>
  String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

/** La respuesta del perfil que corresponde a un dato con clave común, o null. */
export function campoDeClave(k: { categoria?: string; clave?: string }): CampoConClave | null {
  const clave = plegarClave(k.clave);
  if (!clave) return null;
  for (const [campo, c] of Object.entries(CAMPO_CLAVE)) if (c.categoria === k.categoria && c.clave === clave) return campo as CampoConClave;
  return null;
}

/** «Vive en Tocoa» → «Tocoa» (la respuesta del perfil); si no tiene la forma de la plantilla, el texto entero. */
export function respuestaDeDato(campo: CampoConClave, texto: string): string {
  const t = String(texto || '').trim();
  const pre = PREFIJO[campo];
  return plegarClave(t.slice(0, pre.length)) === plegarClave(pre) ? t.slice(pre.length).trim() || t : t;
}

const unicos = <T>(xs: T[], clave: (x: T) => string) => {
  const vistos = new Set<string>();
  return xs.filter((x) => {
    const k = clave(x);
    if (vistos.has(k)) return false;
    vistos.add(k);
    return true;
  });
};

export type Almacenes = { marca: boolean } & Record<Almacen, boolean>;
export type ReciboSupresion = { id: string; version: number; en: number; estado: 'confirmado' | 'pendiente'; almacenes: Almacenes };

/**
 * La parte «perfil» de un borrado: el perfil ya se lee sin lo suprimido (lib/perfil-persona.ts); se vuelve a
 * escribir así, limpio, para que lo guardado tampoco lo tenga. Sin perfil, no hay nada que borrar.
 */
async function purgarPerfil(correo: string, campos: string[]): Promise<boolean> {
  if (!campos.length) return true;
  const l = await leerPerfilSeguro(correo);
  if (!l.ok) throw new PerfilNoDisponible();
  if (!l.perfil) return true;
  return (await guardarPerfil(correo, { ...l.perfil, actualizado: Math.max(Date.now(), l.perfil.actualizado + 1) })).durable;
}

/** Procesa los almacenes pendientes de una marca; cierra cada uno con recibo durable. Nunca lanza. */
async function procesar(persona: string, tumba: Tumba): Promise<Record<Almacen, boolean>> {
  const r = { conocer: true, episodios: true, perfil: true } as Record<Almacen, boolean>;
  for (const a of tumba.pendientes) {
    let ok = false;
    try {
      if (a === 'conocer') ok = (await purgarConocer(persona)).durable;
      else if (a === 'episodios') ok = (await purgarEpisodios(persona)).durable;
      else ok = await purgarPerfil(persona, tumba.campos);
    } catch {
      ok = false;
    }
    r[a] = ok;
    if (ok) await cerrarAlmacen(persona, tumba.id, a);
  }
  return r;
}

/**
 * Termina los borrados que quedaron a medias (un almacén sin recibo, un reinicio). Devuelve cuántas marcas
 * procesó. Nunca lanza.
 */
export async function reanudarSupresiones(persona: string): Promise<number> {
  let tumbas: Tumba[];
  try {
    tumbas = await tumbasDe(persona);
  } catch {
    return 0;
  }
  const pendientes = tumbas.filter((t) => t.pendientes.length);
  for (const t of pendientes) await procesar(persona, t);
  return pendientes.length;
}

async function reciboDe(persona: string, tumba: Tumba, marca: boolean, almacenes: Record<Almacen, boolean>): Promise<{ durable: boolean; recibo: ReciboSupresion }> {
  const todo = marca && ALMACENES.every((a) => almacenes[a]);
  // Honesto también con lo de antes: si otra marca sigue a medias, todavía no está todo borrado.
  let otras = false;
  try {
    otras = (await tumbasDe(persona)).some((t) => t.id !== tumba.id && t.pendientes.length > 0);
  } catch {
    otras = true;
  }
  const estado = todo && !otras ? 'confirmado' : 'pendiente';
  return { durable: estado === 'confirmado', recibo: { id: tumba.id, version: tumba.version, en: tumba.en, estado, almacenes: { marca, ...almacenes } } };
}

/** Las palabras de las respuestas del perfil en esos campos (para tapar su eco en los resúmenes). */
function terminosDelPerfil(p: Perfil | null, campos: string[]): string[][] {
  if (!p) return [];
  const r: string[][] = [];
  for (const c of campos) {
    const v = c === 'cumple' ? '' : (p.encuesta as Record<string, string | undefined>)[c.replace(/^encuesta\./, '')];
    const ts = v ? terminosDe(v) : [];
    if (ts.length) r.push(ts);
  }
  return r;
}

/**
 * Olvida por id y por clave común: el dato, todas sus copias con esa clave, la respuesta del perfil que le
 * corresponde y su eco en los resúmenes. Lanza CajonNoDisponible / PerfilNoDisponible si no se pudo leer lo
 * necesario para armar la marca (entonces no se borró nada).
 */
export async function suprimir(persona: string, o: { ids?: string[]; claves?: ClaveDato[] }): Promise<{ borrados: number; durable: boolean; recibo: ReciboSupresion }> {
  await reanudarSupresiones(persona);
  const cubiertos = await datosQueCubre(persona, o);
  const claves = unicos(
    [...(o.claves || []).map((k) => ({ categoria: String(k.categoria), clave: plegarClave(k.clave) })), ...cubiertos.filter((d) => d.clave).map((d) => ({ categoria: d.categoria, clave: d.clave! }))],
    (k) => `${k.categoria}|${k.clave}`
  );
  const campos = unicos(
    claves.map((k) => campoDeClave(k)).filter((c): c is CampoConClave => !!c).map((c) => `encuesta.${c}`),
    (c) => c
  );
  const perfil = campos.length ? await leerPerfilSeguro(persona) : null;
  if (perfil && !perfil.ok) throw new PerfilNoDisponible();
  const terminos = [...cubiertos.map((d) => terminosDe(d.dato, d.clave)), ...terminosDelPerfil(perfil?.ok ? perfil.perfil : null, campos)].filter((t) => t.length);
  const ids = unicos([...(o.ids || []).map(String), ...cubiertos.map((d) => d.id)], (x) => x);
  const { tumba, durable: marca } = await marcarSupresion(persona, { tipo: 'olvido', ids, claves, terminos, campos, pendientes: [...ALMACENES] });
  const almacenes = await procesar(persona, tumba);
  return { borrados: cubiertos.length, ...(await reciboDe(persona, tumba, marca, almacenes)) };
}

/** «Borrar todo lo que te conté»: todo lo aprendido, las respuestas de la encuesta y su eco en los resúmenes. */
export async function suprimirTodo(persona: string): Promise<{ borrados: number; durable: boolean; recibo: ReciboSupresion }> {
  await reanudarSupresiones(persona);
  const cubiertos = await datosQueCubre(persona, { todo: true });
  const perfil = await leerPerfilSeguro(persona);
  if (!perfil.ok) throw new PerfilNoDisponible();
  const campos = CAMPOS_ENCUESTA.filter((k) => perfil.perfil?.encuesta[k]).map((k) => `encuesta.${k}`);
  const terminos = [...cubiertos.map((d) => terminosDe(d.dato, d.clave)), ...terminosDelPerfil(perfil.perfil, campos)].filter((t) => t.length);
  const { tumba, durable: marca } = await marcarSupresion(persona, { tipo: 'todo', terminos, campos, pendientes: [...ALMACENES] });
  const almacenes = await procesar(persona, tumba);
  return { borrados: cubiertos.length, ...(await reciboDe(persona, tumba, marca, almacenes)) };
}

/**
 * Los usos activos de un dato que cambió de `anterior` a `dato.dato`: la respuesta del perfil que lo repite
 * (si la tiene) y los resúmenes que dicen lo viejo (una marca de corrección con las palabras viejas: también
 * frena que un tramo de antes lo vuelva a enseñar). true si todo quedó durable. Nunca lanza.
 */
async function corregirUsos(persona: string, dato: Pick<Dato, 'dato' | 'clave' | 'categoria'>, anterior: string, o: { conPerfil?: boolean } = {}): Promise<boolean> {
  if (!anterior || anterior === dato.dato) return true;
  let ok = true;
  const nuevas = new Set(terminosDe(dato.dato, dato.clave));
  const viejas = terminosDe(anterior, dato.clave).filter((w) => !nuevas.has(w));
  const campo = o.conPerfil === false ? null : campoDeClave(dato);
  if (campo) {
    try {
      const l = await leerPerfilSeguro(persona);
      if (!l.ok) throw new PerfilNoDisponible();
      const respuesta = respuestaDeDato(campo, dato.dato);
      if (l.perfil?.encuesta[campo] && l.perfil.encuesta[campo] !== respuesta) ok = (await actualizarPerfil(persona, { encuesta: { [campo]: respuesta } })).durable && ok;
    } catch {
      ok = false;
    }
  }
  if (viejas.length) {
    try {
      const { tumba, durable } = await marcarSupresion(persona, { tipo: 'correccion', terminos: [viejas], pendientes: ['episodios'] });
      const r = await procesar(persona, tumba);
      ok = ok && durable && r.episodios;
    } catch {
      ok = false;
    }
  }
  return ok;
}

/** Corrige un dato (lo escribe la persona) y sus usos activos. Null si no existe. */
export async function corregir(persona: string, id: string, texto: string): Promise<{ dato: Dato | null; durable: boolean }> {
  const r = await corregirDato(persona, id, texto);
  if (!r.dato) return { dato: null, durable: false };
  const usos = await corregirUsos(persona, r.dato, r.anterior || '');
  return { dato: r.dato, durable: r.durable && usos };
}

/** Limita (o vuelve a permitir) que AURA use un dato. Null si no existe. */
export function limitar(persona: string, id: string, alcance: Alcance): Promise<{ dato: Dato | null; durable: boolean }> {
  return limitarDato(persona, id, alcance);
}

/**
 * Un dato que la persona contó a mano (la primera vez, Ajustes). Si reemplaza otro con la misma clave, es una
 * corrección: se corrigen sus usos. Lanza DatoSuprimido si es una copia de antes de un borrado.
 */
export async function anotarDatoManual(persona: string, d: { categoria: string; dato: string; clave?: string; origen?: Origen; dicho?: number }): Promise<{ dato: Dato; durable: boolean }> {
  const r = await agregarDato(persona, d.categoria, d.dato, d.clave, { origen: d.origen, dicho: d.dicho });
  const usos = r.anterior ? await corregirUsos(persona, r.dato, r.anterior) : true;
  return { dato: r.dato, durable: r.durable && usos };
}

/** Para el teléfono (GET/PUT /api/perfil): cada campo del perfil con la hora de su marca. Nunca lanza. */
export async function supresionesPerfil(correo: string): Promise<Record<string, number>> {
  try {
    return camposSuprimidos(await tumbasDe(correo));
  } catch {
    return {};
  }
}

/** `hechoEn` del cuerpo del PUT, sano: campo del perfil → hora (del teléfono) en que se cambió. */
export function hechoEnValido(raw: unknown): Record<string, number> {
  const r: Record<string, number> = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return r;
  const validos = new Set([...CAMPOS_ENCUESTA.map((k) => `encuesta.${k}`), 'cumple']);
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) if (validos.has(k) && Number(v) > 0) r[k] = Number(v);
  return r;
}

/**
 * El PUT del perfil con las marcas de por medio:
 *   · un valor que una marca cubre y que llega sin hora o con una hora de antes de la marca (la caché de un
 *     teléfono que estuvo offline, un cambio hecho antes del borrado) NO se escribe: va en `suprimidos`;
 *   · vaciar una respuesta que tenía valor es BORRARLA: marca antes de escribir, y también se van su copia en
 *     «lo que sé de ti» (misma clave) y su eco en los resúmenes;
 *   · cambiar una respuesta es CORREGIRLA: su copia en «lo que sé de ti» y los resúmenes también.
 * Lanza PerfilNoDisponible si no se pudo leer lo guardado (o las marcas).
 */
export async function guardarPerfilGobernado(
  correo: string,
  cambios: Cambios,
  o: { apodo?: string; hechoEn?: Record<string, number> } = {}
): Promise<{ perfil: Perfil; durable: boolean; suprimidos: string[]; supresiones: Record<string, number> }> {
  let tumbas: Tumba[];
  try {
    tumbas = await tumbasDe(correo);
  } catch {
    throw new PerfilNoDisponible();
  }
  const leido = await leerPerfilSeguro(correo);
  if (!leido.ok) throw new PerfilNoDisponible();
  const previo = leido.perfil;
  const hechoEn = o.hechoEn || {};
  const c: Cambios = { ...cambios, ...(cambios.encuesta ? { encuesta: { ...cambios.encuesta } } : {}) };
  const suprimidos: string[] = [];
  const vaciados: string[] = [];
  const corregidos: Array<{ campo: CampoConClave; antes: string; ahora: string }> = [];
  for (const [k, v] of Object.entries(c.encuesta || {})) {
    const campo = `encuesta.${k}`;
    const antes = (previo?.encuesta as Record<string, string | undefined> | undefined)?.[k] || '';
    if (v && v !== antes && campoSuprimido(tumbas, campo, hechoEn[campo])) {
      delete (c.encuesta as Record<string, string>)[k];
      suprimidos.push(campo);
    } else if (!v && antes) vaciados.push(campo);
    else if (v && antes && v !== antes && k in CAMPO_CLAVE) corregidos.push({ campo: k as CampoConClave, antes, ahora: v });
  }
  if (c.cumple !== undefined) {
    if (c.cumple && c.cumple !== previo?.cumple && campoSuprimido(tumbas, 'cumple', hechoEn.cumple)) {
      delete c.cumple;
      suprimidos.push('cumple');
    } else if (!c.cumple && previo?.cumple) vaciados.push('cumple');
  }

  if (!vaciados.length) {
    const { perfil, durable } = await actualizarPerfil(correo, c, { apodo: o.apodo });
    let usos = true;
    for (const x of corregidos) usos = (await corregirCopia(correo, x)) && usos;
    return { perfil, durable: durable && usos, suprimidos, supresiones: camposSuprimidos(tumbas) };
  }

  // Borrar respuestas: la marca primero (con sus copias por clave común y sus palabras), después cada almacén.
  const claves = vaciados
    .map((cp) => cp.replace(/^encuesta\./, ''))
    .filter((k): k is CampoConClave => k in CAMPO_CLAVE)
    .map((k) => ({ ...CAMPO_CLAVE[k] }));
  let copias: Dato[] = [];
  try {
    copias = claves.length ? await datosQueCubre(correo, { claves }) : [];
  } catch (e) {
    if (e instanceof CajonNoDisponible) throw new PerfilNoDisponible();
    throw e;
  }
  const terminos = [...terminosDelPerfil(previo, vaciados), ...copias.map((d) => terminosDe(d.dato, d.clave))].filter((t) => t.length);
  const { tumba, durable: marca } = await marcarSupresion(correo, { tipo: 'olvido', claves, campos: vaciados, terminos, ids: copias.map((d) => d.id), pendientes: [...ALMACENES] });
  const { perfil, durable } = await actualizarPerfil(correo, c, { apodo: o.apodo });
  if (durable) await cerrarAlmacen(correo, tumba.id, 'perfil');
  const resto = await procesar(correo, { ...tumba, pendientes: tumba.pendientes.filter((a) => a !== 'perfil') });
  let usos = true;
  for (const x of corregidos) usos = (await corregirCopia(correo, x)) && usos;
  const todas = await tumbasDe(correo).catch(() => tumbas);
  return { perfil, durable: marca && durable && resto.conocer && resto.episodios && usos, suprimidos, supresiones: camposSuprimidos(todas) };
}

/** Una respuesta del perfil cambió: su copia en «lo que sé de ti» (si la hay) y los resúmenes. Nunca lanza. */
async function corregirCopia(correo: string, x: { campo: CampoConClave; antes: string; ahora: string }): Promise<boolean> {
  const k = CAMPO_CLAVE[x.campo];
  try {
    const [copia] = await datosQueCubre(correo, { claves: [{ ...k }] });
    const texto = `${PREFIJO[x.campo]}${x.ahora}`.slice(0, 240);
    if (copia && copia.dato !== texto) {
      const r = await agregarDato(correo, k.categoria, texto, k.clave, { origen: 'ajustes' });
      return r.durable && (await corregirUsos(correo, r.dato, r.anterior || copia.dato, { conPerfil: false }));
    }
    return await corregirUsos(correo, { dato: texto, clave: k.clave, categoria: k.categoria }, `${PREFIJO[x.campo]}${x.antes}`, { conPerfil: false });
  } catch {
    return false;
  }
}
