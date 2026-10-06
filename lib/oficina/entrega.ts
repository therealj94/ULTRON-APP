/**
 * ARCHIVOS DE OFICINA: DEL PEDIDO AL RECIBO (FILE-01 + FILE-02). Une las piezas:
 *
 *   especificación validada (spec.ts) → por cada archivo: generar (generar.ts) → temporal → RELEER el temporal y
 *   validar estructura + contenido (validar.ts; render opcional) → confirmar los bytes → anotar «generado» en el lote
 *   durable → publicar su ficha (almacen.ts: crear una vez) → anotar «disponible» → recibo.
 *
 * Garantías (cada una con su prueba en tests/oficina-*.test.ts):
 *  · «Ya quedó» solo con evidencia de CADA archivo: nombre, tipo real por dentro, tamaño, sha256, qué se comprobó y su
 *    enlace de descarga. Lo que pidió la persona se compara, requisito por requisito, con lo entregado usando los
 *    mismos validadores que la computadora (lib/entregables.ts): pidió tres y salieron dos → parcial, y se dice cuál falta.
 *  · El recibo distingue generado, validado y puesto a disposición. «Abierto por la persona» no se sabe: queda null,
 *    nunca se inventa una recepción.
 *  · Idempotente por dueño + requestId (el del turno): un reintento, una reanudación tras una interrupción o tras un
 *    crash entre generar y entregar NUNCA entrega dos veces ni pisa lo entregado; retoma donde quedó (un archivo
 *    «generado» y no publicado se vuelve a comprobar desde sus bytes y se publica una sola vez).
 *  · Un temporal dañado (disco, corte) se detecta al releerlo y se regenera una vez; si vuelve a fallar, ese archivo
 *    queda «fallido» con el porqué y los demás siguen.
 *  · Un lease por lote: dos procesos con el mismo pedido no generan a la vez.
 *  · La tarea durable del panel (lib/tareas-durables.ts) nace ANTES de generar, con un criterio por cosa pedida, y
 *    termina `completed` solo si cada criterio tiene su archivo como evidencia; si no, `partial` o `failed`.
 */
import { almacenDurable, claveDe, hashArgumentos, huellaDueno, modificarDurable, PROCESO_DURABLE, soltarLease, tomarLease, type AlmacenDurable } from '../durable';
import { compararEntrega, enLista, requisitosDeEntrega, VALIDADOR_MIN, type ArchivoNodo, type ItemEntrega, type PedidoEntrega } from '../entregables';
import { cambiarTarea, crearTarea, type Cambio, type Criterio, type Evidencia, type RegistroTarea } from '../tareas-durables';
import { almacenArchivos, claveArchivo, ESPACIO_LOTES, idArchivo, publicarManifiesto, retencionMs, type AlmacenArchivos, type ManifiestoArchivo } from './almacen';
import { generarArchivo } from './generar';
import { CLASE, MIME, TOPES, validarPedido, type ArchivoPedido, type ErrorEspec, type TipoArchivo } from './spec';
import { sha256, validarArchivo, type Comprobacion, type Render, type Validacion } from './validar';

/* ------------------------------------------------------------------ el lote durable */

type EstadoEnLote = 'pendiente' | 'generado' | 'disponible' | 'fallido';
type ResumenValidacion = { estructural: boolean; semantico: boolean; defectos: string[]; comprobaciones: Comprobacion[]; render?: Render; paginas?: number; tipoReal: string };
type ArchivoEnLote = {
  nombre: string;
  tipo: TipoArchivo;
  id: string;
  estado: EstadoEnLote;
  intentos: number;
  sha256?: string;
  bytes?: number;
  detalle?: string;
  validacion?: ResumenValidacion;
  t: number;
};
type Lote = { v: 1; requestId: string; argsHash: string; creado: number; actualizado: number; tareaId?: string; archivos: ArchivoEnLote[] };

const claveLote = (dueno: string, requestId: string) => claveDe(ESPACIO_LOTES, dueno, requestId);
const claveLeaseLote = (dueno: string, requestId: string) => claveDe('documentos/leases', dueno, requestId);

/* ------------------------------------------------------------------ el recibo */

export type ReciboArchivo = {
  nombre: string;
  tipo: TipoArchivo;
  mime: string;
  estado: 'disponible' | 'fallido' | 'pendiente';
  /** Se generaron sus bytes (y quedaron guardados). */
  generado: boolean;
  /** Pasó la estructura Y la relectura de su contenido. */
  validado: boolean;
  /** Su ficha existe: se puede bajar con la sesión de su dueño. */
  disponible: boolean;
  /** Si la persona lo abrió: no se sabe desde aquí. Nunca se inventa. */
  abierto: null;
  id?: string;
  enlace?: string;
  bytes?: number;
  sha256?: string;
  tipoReal?: string;
  paginas?: number;
  comprobaciones?: Comprobacion[];
  defectos?: string[];
  render?: Render;
  intentos: number;
  /** Ya estaba entregado de antes (reintento): no se volvió a entregar. */
  repetido?: boolean;
  /** Estaba generado y sin entregar (se cortó en medio): se comprobó de nuevo y se entregó ahora, una vez. */
  reanudado?: boolean;
  detalle: string;
};

export type ReciboLote = {
  estado: 'completo' | 'parcial' | 'fallido';
  requestId: string;
  archivos: ReciboArchivo[];
  /** Lo que pidió la persona, requisito por requisito (lib/entregables.ts). */
  pedidos: ItemEntrega[];
  hechos: string[];
  faltan: string[];
  errores: ErrorEspec[];
  tareaId?: string;
  vence?: string;
  interrumpido?: boolean;
  /** Para el modelo: qué puede decir y qué no. */
  texto: string;
};

export type GanchosEntrega = {
  /** El temporal se escribió (pruebas: dañarlo). `ruta` solo en almacenes con disco. */
  temporalEscrito?: (o: { nombre: string; token: string; ruta: string | null; intento: number; archivos: AlmacenArchivos }) => void | Promise<void>;
  /** Ya está «generado» en el lote y aún no se publicó (pruebas: un crash aquí). Si lanza, se propaga. */
  trasGenerar?: (nombre: string) => void | Promise<void>;
  /** Antes de cada archivo (pruebas: interrumpir a mitad). */
  antesDeArchivo?: (nombre: string, indice: number) => void | Promise<void>;
};

export type OpcionesEntrega = {
  dueno: string;
  requestId: string;
  /** Lo que mandó el modelo (la herramienta): `{archivos: [{tipo, nombre, spec}]}`. */
  entrada: unknown;
  /** Lo que pidió la persona, tal cual: de ahí salen los requisitos (cuántos, cómo se llaman, de qué tipo). */
  instruccion?: string;
  senal?: AbortSignal;
  renderizar?: boolean;
  /** El enlace de descarga de un archivo (relativo al servidor; lo abre la app con su sesión). */
  enlace?: (id: string) => string;
  /** Crear y cerrar la tarea durable del panel (por defecto sí). */
  conTarea?: boolean;
  /** La tarea se creó o cambió (server/trabajos.ts la enlaza desde la respuesta del turno). */
  alTarea?: (reg: RegistroTarea) => void;
  almacen?: AlmacenDurable;
  archivos?: AlmacenArchivos;
  /** Quién es este proceso (lease). Por defecto PROCESO_DURABLE. */
  proceso?: string;
  ahora?: () => number;
  ganchos?: GanchosEntrega;
};

const ENLACE = (id: string) => `/api/documentos/${id}`;
const LEASE_MS = 120_000;
const kb = (b: number) => (b < 1024 ? `${b} bytes` : `${Math.round(b / 102.4) / 10} KB`);

function resumir(v: Validacion): ResumenValidacion {
  return {
    estructural: v.estructural.ok,
    semantico: v.semantico.ok,
    defectos: v.estructural.defectos,
    comprobaciones: v.semantico.comprobaciones,
    ...(v.render ? { render: v.render } : {}),
    ...(v.paginas !== undefined ? { paginas: v.paginas } : {}),
    tipoReal: v.tipoReal,
  };
}

/** Por qué no pasó, corto y para la persona. */
function porQueNo(v: ResumenValidacion): string {
  if (!v.estructural) return `está dañado o no es lo que dice ser (${v.defectos.slice(0, 2).join('; ')})`;
  const malas = v.comprobaciones.filter((c) => !c.ok).map((c) => `${c.que}${c.detalle ? `: ${c.detalle}` : ''}`);
  return `al releerlo no está todo lo pedido (${malas.slice(0, 2).join('; ')})`;
}

/** Los requisitos de lo pedido: de las palabras de la persona; si no nombró archivos ni tipos, de lo que se va a hacer. */
function requisitos(instruccion: string, nombres: string[]): { texto: string; pedido: PedidoEntrega } {
  const dicho = String(instruccion || '').trim();
  if (dicho) {
    const p = requisitosDeEntrega(dicho);
    if (p.items.length) return { texto: dicho, pedido: p };
  }
  const texto = `Crea ${enLista(nombres)}`;
  return { texto, pedido: requisitosDeEntrega(texto) };
}

/**
 * Hace los archivos del pedido y devuelve su recibo. Lanza solo si lo hace un gancho de prueba (un crash simulado); un
 * fallo de generación, de validación o del almacén queda en el recibo, archivo por archivo.
 */
export async function crearDocumentos(o: OpcionesEntrega): Promise<ReciboLote> {
  const ahora = o.ahora || Date.now;
  const alm = o.almacen || almacenDurable();
  const arch = o.archivos || almacenArchivos();
  const enlace = o.enlace || ENLACE;
  const { archivos: pedidos, errores } = validarPedido(o.entrada);
  const nombresDichos = [...pedidos.map((a) => a.nombre), ...errores.filter((e) => e.nombre !== '(pedido)').map((e) => e.nombre)];
  const req = requisitos(o.instruccion || '', nombresDichos.length ? nombresDichos : ['los documentos']);
  const base = { requestId: o.requestId, errores } as const;

  if (!pedidos.length) {
    return cerrar({ ...base, archivos: [], req, lote: null, tareaId: undefined, interrumpido: false, o, alm });
  }

  // Un mismo requestId con OTRO contenido no es el mismo pedido: no hereda lo entregado ni lo pisa.
  const argsHash = hashArgumentos(pedidos);
  const lease = await tomarLease(claveLeaseLote(o.dueno, o.requestId), o.proceso || PROCESO_DURABLE, LEASE_MS, { almacen: alm, ahora });
  if (lease.ok === false) {
    const texto = 'ocupado' in lease ? 'Esos documentos ya los estoy haciendo en otro proceso: no los empiezo otra vez.' : `No pude dejar registrado el pedido (${lease.detalle.slice(0, 80)}): no hice nada.`;
    return { estado: 'fallido', requestId: o.requestId, archivos: [], pedidos: [], hechos: [], faltan: nombresDichos, errores, texto: `DOCUMENTOS NO HECHOS: ${texto} No digas que quedaron.` };
  }

  const nuevo: Lote = {
    v: 1,
    requestId: o.requestId,
    argsHash,
    creado: ahora(),
    actualizado: ahora(),
    archivos: pedidos.map((a) => ({ nombre: a.nombre, tipo: a.tipo, id: idArchivo(o.dueno, o.requestId, a.nombre), estado: 'pendiente', intentos: 0, t: ahora() })),
  };
  let otroPedido = false;
  const ini = await modificarDurable<Lote>(
    claveLote(o.dueno, o.requestId),
    (actual) => {
      otroPedido = false;
      if (!actual) return nuevo;
      if (actual.argsHash !== argsHash) otroPedido = true;
      return undefined;
    },
    alm
  );
  if (ini.ok === false || otroPedido) {
    await soltarLease(lease.lease).catch(() => undefined);
    const texto = otroPedido ? 'ese pedido ya existe con otro contenido; no lo mezclo' : `no pude dejar registrado el pedido (${(ini as { detalle?: string }).detalle?.slice(0, 80) || 'almacén'})`;
    return { estado: 'fallido', requestId: o.requestId, archivos: [], pedidos: [], hechos: [], faltan: nombresDichos, errores, texto: `DOCUMENTOS NO HECHOS: ${texto}. No hice nada: no digas que quedaron.` };
  }
  let lote = (ini.valor as Lote) || nuevo;

  const guardarArchivo = async (nombre: string, cambio: Partial<ArchivoEnLote>) => {
    const r = await modificarDurable<Lote>(
      claveLote(o.dueno, o.requestId),
      (l) => (l ? { ...l, actualizado: ahora(), archivos: l.archivos.map((x) => (x.nombre === nombre ? { ...x, ...cambio, t: ahora() } : x)) } : undefined),
      alm
    );
    if (r.ok && r.valor) lote = r.valor as Lote;
    return r.ok;
  };

  // La tarea del panel, ANTES de generar (persistir antes de actuar). Si el almacén no la crea, se sigue y se dice.
  let tareaId = lote.tareaId;
  if (o.conTarea !== false) {
    const t = await crearTarea(
      o.dueno,
      {
        requestId: `documentos-${o.requestId}`.slice(0, 120),
        titulo: `Documentos: ${enLista(pedidos.map((a) => a.nombre))}`.slice(0, 100),
        objetivo: (o.instruccion || `Crear ${enLista(pedidos.map((a) => a.nombre))}`).slice(0, 400),
        estado: 'running',
        entorno: { kind: 'servidor', id: 'documentos', displayName: 'Documentos de AU-RA' },
        pasoActual: 'Genero y compruebo cada archivo',
        criterios: req.pedido.items.map((r) => ({ id: r.id, texto: `${r.etiqueta}: generado, comprobado y para bajar` })),
        origen: { kind: 'chat' },
        condicionParada: 'Termina cuando cada archivo pedido está comprobado y para bajar, o dice cuál falta y por qué.',
      },
      { almacen: alm, ahora: ahora() }
    ).catch(() => null);
    if (t && t.ok) {
      tareaId = t.tarea.id;
      o.alTarea?.(t.tarea);
      if (lote.tareaId !== tareaId) {
        const tid = tareaId;
        await modificarDurable<Lote>(claveLote(o.dueno, o.requestId), (l) => (l ? { ...l, tareaId: tid } : undefined), alm).catch(() => undefined);
      }
    }
  }

  const recibos: ReciboArchivo[] = [];
  let interrumpido = false;
  for (const [i, a] of pedidos.entries()) {
    const st = lote.archivos.find((x) => x.nombre === a.nombre)!;
    const r0: Omit<ReciboArchivo, 'estado' | 'detalle'> = { nombre: a.nombre, tipo: a.tipo, mime: MIME[a.tipo], generado: false, validado: false, disponible: false, abierto: null, intentos: st.intentos };
    if (st.estado === 'disponible') {
      recibos.push(conValidacion({ ...r0, estado: 'disponible', generado: true, validado: true, disponible: true, id: st.id, enlace: enlace(st.id), bytes: st.bytes, sha256: st.sha256, repetido: true, detalle: 'ya estaba entregado: no lo volví a hacer' }, st.validacion));
      continue;
    }
    if (o.senal?.aborted) {
      interrumpido = true;
      recibos.push({ ...r0, estado: st.estado === 'fallido' ? 'fallido' : 'pendiente', detalle: st.estado === 'generado' ? 'quedó generado pero no alcancé a entregarlo (se interrumpió)' : 'no lo empecé: se interrumpió' });
      continue;
    }
    await o.ganchos?.antesDeArchivo?.(a.nombre, i);
    if (o.senal?.aborted) {
      interrumpido = true;
      recibos.push({ ...r0, estado: 'pendiente', detalle: 'no lo empecé: se interrumpió' });
      continue;
    }

    let reanudado = false;
    let resumen: ResumenValidacion | undefined;
    let sha = st.sha256;
    let bytes = st.bytes;
    if (st.estado === 'generado' && st.sha256) {
      // Se cortó entre generar y entregar: los bytes guardados se vuelven a comprobar (huella y contenido) y se entregan.
      const datos = await arch.leer(claveArchivo(o.dueno, st.id)).catch(() => null);
      if (datos && sha256(datos) === st.sha256) {
        const v = await validarArchivo(a, datos, { renderizar: o.renderizar });
        if (v.estructural.ok && v.semantico.ok) {
          reanudado = true;
          resumen = resumir(v);
        }
      }
    }
    if (!reanudado) {
      const g = await generarYGuardar(a, st, o, arch);
      if (g.ok === false) {
        await guardarArchivo(a.nombre, { estado: 'fallido', intentos: g.intentos, detalle: g.detalle, ...(g.validacion ? { validacion: g.validacion } : {}) });
        recibos.push(conValidacion({ ...r0, estado: 'fallido', generado: false, intentos: g.intentos, detalle: g.detalle }, g.validacion));
        continue;
      }
      sha = g.sha256;
      bytes = g.bytes;
      resumen = g.validacion;
      await guardarArchivo(a.nombre, { estado: 'generado', intentos: g.intentos, sha256: sha, bytes, validacion: resumen });
    }
    await o.ganchos?.trasGenerar?.(a.nombre);

    // Ponerlo a disposición: su ficha, una sola vez.
    const m: ManifiestoArchivo = {
      v: 1,
      id: st.id,
      dueno: huellaDueno(o.dueno),
      nombre: a.nombre,
      tipo: a.tipo,
      mime: MIME[a.tipo],
      bytes: bytes!,
      sha256: sha!,
      creado: ahora(),
      vence: ahora() + retencionMs(),
      lote: o.requestId,
      validacion: { estructural: true, semantico: true, ...(resumen?.render ? { render: resumen.render.estado } : {}) },
    };
    const pub = await publicarManifiesto(m, o.dueno, alm);
    if (pub.ok === false) {
      // Generado y comprobado, pero no quedó para bajar: así se dice (el siguiente intento lo entrega desde sus bytes).
      recibos.push(conValidacion({ ...r0, estado: 'fallido', generado: true, validado: true, bytes, sha256: sha, intentos: lote.archivos.find((x) => x.nombre === a.nombre)?.intentos ?? 1, detalle: `lo generé y lo comprobé, pero no pude dejarlo para bajar (${pub.detalle.slice(0, 80)})` }, resumen));
      continue;
    }
    await guardarArchivo(a.nombre, { estado: 'disponible' });
    const intentos = lote.archivos.find((x) => x.nombre === a.nombre)?.intentos ?? 1;
    recibos.push(
      conValidacion(
        {
          ...r0,
          estado: 'disponible',
          generado: true,
          validado: true,
          disponible: true,
          id: st.id,
          enlace: enlace(st.id),
          bytes,
          sha256: sha,
          intentos,
          ...(reanudado ? { reanudado: true } : {}),
          ...(pub.nueva ? {} : { repetido: true }),
          detalle: reanudado ? 'estaba generado y sin entregar: lo comprobé otra vez y lo entregué' : intentos > 1 ? `el primer intento salió dañado; el ${intentos}.º salió bien` : 'generado, comprobado y para bajar',
        },
        resumen
      )
    );
  }
  // Lo que no alcanzó (un archivo malo en la especificación) también va en el recibo, con su porqué.
  for (const e of errores) {
    if (e.nombre === '(pedido)') continue;
    const tipo = (/\.(docx|xlsx|pdf)$/i.exec(e.nombre)?.[1]?.toLowerCase() || 'pdf') as TipoArchivo;
    recibos.push({ nombre: e.nombre, tipo, mime: MIME[tipo], estado: 'fallido', generado: false, validado: false, disponible: false, abierto: null, intentos: 0, detalle: `no lo hice: la especificación no sirve (${e.errores.slice(0, 3).join('; ')})` });
  }

  const salida = await cerrar({ ...base, archivos: recibos, req, lote, tareaId, interrumpido, o, alm });
  // Solo al terminar en orden se suelta el lease; si algo lanzó (un crash), vence solo y otro proceso puede retomar.
  await soltarLease(lease.lease).catch(() => undefined);
  return salida;
}

function conValidacion(r: Omit<ReciboArchivo, 'comprobaciones'>, v?: ResumenValidacion): ReciboArchivo {
  if (!v) return r;
  return { ...r, tipoReal: v.tipoReal, comprobaciones: v.comprobaciones, ...(v.defectos.length ? { defectos: v.defectos } : {}), ...(v.render ? { render: v.render } : {}), ...(v.paginas !== undefined ? { paginas: v.paginas } : {}) };
}

/**
 * Generar → temporal → releer el temporal → validar → confirmar. Hasta dos intentos (un temporal dañado se regenera
 * una vez). Lo que no pasa nunca se confirma: el temporal se descarta.
 */
async function generarYGuardar(
  a: ArchivoPedido,
  st: ArchivoEnLote,
  o: OpcionesEntrega,
  arch: AlmacenArchivos
): Promise<{ ok: true; sha256: string; bytes: number; intentos: number; validacion: ResumenValidacion } | { ok: false; detalle: string; intentos: number; validacion?: ResumenValidacion }> {
  let ultimo: { detalle: string; validacion?: ResumenValidacion } = { detalle: 'no se pudo generar' };
  let intentos = st.intentos;
  for (let k = 0; k < 2; k++) {
    intentos++;
    let datos: Buffer;
    try {
      datos = await generarArchivo(a);
    } catch (e: any) {
      ultimo = { detalle: `no se pudo generar (${String(e?.message || e).slice(0, 100)})` };
      continue;
    }
    if (datos.length > TOPES.bytes) return { ok: false, intentos, detalle: `saldría de ${kb(datos.length)}: más que el máximo (${kb(TOPES.bytes)}); no lo entrego` };
    let token: string;
    try {
      token = await arch.escribirTemporal(datos);
    } catch (e: any) {
      ultimo = { detalle: `no pude escribirlo (${String(e?.message || e).slice(0, 80)})` };
      continue;
    }
    await o.ganchos?.temporalEscrito?.({ nombre: a.nombre, token, ruta: arch.rutaTemporal?.(token) ?? null, intento: intentos, archivos: arch });
    // Lo que se valida es lo que quedó escrito, no lo que se tenía en memoria.
    const releido = await arch.leerTemporal(token);
    if (!releido) {
      ultimo = { detalle: 'el temporal desapareció antes de comprobarlo' };
      continue;
    }
    const v = resumir(await validarArchivo(a, releido, { renderizar: o.renderizar }));
    if (!v.estructural || !v.semantico) {
      await arch.descartarTemporal(token).catch(() => undefined);
      ultimo = { detalle: porQueNo(v), validacion: v };
      continue;
    }
    try {
      await arch.confirmar(token, claveArchivo(o.dueno, st.id), MIME[a.tipo]);
    } catch (e: any) {
      await arch.descartarTemporal(token).catch(() => undefined);
      ultimo = { detalle: `lo comprobé pero no pude guardarlo (${String(e?.message || e).slice(0, 80)})`, validacion: v };
      continue;
    }
    return { ok: true, sha256: sha256(releido), bytes: releido.length, intentos, validacion: v };
  }
  return { ok: false, intentos, ...ultimo };
}

/** El recibo final: requisitos comparados, la tarea cerrada (o bloqueada si se interrumpió) y el texto para el modelo. */
async function cerrar(x: {
  requestId: string;
  errores: ErrorEspec[];
  archivos: ReciboArchivo[];
  req: { texto: string; pedido: PedidoEntrega };
  lote: Lote | null;
  tareaId: string | undefined;
  interrumpido: boolean;
  o: OpcionesEntrega;
  alm: AlmacenDurable;
}): Promise<ReciboLote> {
  const disponibles = x.archivos.filter((a) => a.disponible && a.sha256);
  // Lo entregado, como lo vería el validador de la computadora: existe, es de esta misión, su tipo por dentro y entero.
  const nodo: ArchivoNodo[] = disponibles.map((a) => ({
    ruta: `/documentos/${a.nombre}`,
    existe: true,
    bytes: a.bytes!,
    sha256: a.sha256!,
    reciente: true,
    mencionado: true,
    tipo: a.tipoReal || a.tipo,
    integro: true,
    // Lo atestigua la validación del servidor (estructura + relectura del contenido), más exigente que la del nodo.
    integro_v: VALIDADOR_MIN,
  }));
  const comp = compararEntrega(x.req.texto, nodo, x.req.pedido);
  const pedidos = comp.items;
  const hechos = disponibles.map((a) => `${a.nombre} (${CLASE[a.tipo]}, ${kb(a.bytes!)}${a.paginas ? `, ${a.paginas} pág.` : ''}, sha256 ${a.sha256!.slice(0, 12)}…)`);
  const faltan = [
    ...pedidos.filter((p) => p.estado !== 'verified').map((p) => p.detalle),
    ...x.archivos.filter((a) => !a.disponible && !pedidos.some((p) => p.estado !== 'verified' && p.detalle.includes(a.nombre))).map((a) => `${a.nombre}: ${a.detalle}`),
    ...x.errores.filter((e) => e.nombre === '(pedido)').flatMap((e) => e.errores),
  ];
  const todoPedido = pedidos.length > 0 && pedidos.every((p) => p.estado === 'verified');
  const estado: ReciboLote['estado'] = disponibles.length === 0 ? 'fallido' : todoPedido && x.archivos.every((a) => a.disponible) ? 'completo' : 'parcial';
  const vence = disponibles.length ? new Date(Date.now() + retencionMs()).toISOString() : undefined;

  // La tarea: completed solo con la evidencia de cada criterio; si se interrumpió, queda abierta (bloqueada) para retomar.
  if (x.tareaId && x.o.conTarea !== false) {
    const evidencias: Evidencia[] = disponibles.map((a) => ({ id: `ev-${a.id}`, tipo: 'archivo', etiqueta: `${a.nombre} · ${kb(a.bytes!)} · sha256 ${a.sha256!.slice(0, 12)}…`, ref: a.id }));
    const porRuta = new Map(disponibles.map((a) => [`/documentos/${a.nombre}`, a.id]));
    const criterios: Criterio[] = pedidos.map((p) => {
      const id = p.archivo ? porRuta.get(p.archivo.ruta) : undefined;
      return { id: p.id, texto: `${p.etiqueta}: generado, comprobado y para bajar`, obligatorio: true, estado: p.estado, evidencias: p.estado === 'verified' && id ? [`ev-${id}`] : [] };
    });
    const resultado = { id: `${x.tareaId}:resultado`, resumen: estado === 'completo' ? `Listos y comprobados: ${enLista(disponibles.map((a) => a.nombre))}.` : `Hechos: ${disponibles.length ? enLista(disponibles.map((a) => a.nombre)) : 'ninguno'}. No quedó: ${faltan.slice(0, 3).join('; ')}`.slice(0, 300), evidencias, parcial: faltan.slice(0, 8), pendiente: x.interrumpido ? x.archivos.filter((a) => a.estado === 'pendiente').map((a) => a.nombre) : [], t: Date.now() };
    const cambio: Cambio = x.interrumpido
      ? { estado: 'blocked', criterios, resultado, pasoActual: `Se interrumpió: faltan ${enLista(x.archivos.filter((a) => a.estado === 'pendiente').map((a) => a.nombre))}. Pídemelo otra vez y sigo donde quedé.` }
      : { estado: estado === 'completo' ? 'completed' : estado === 'parcial' ? 'partial' : 'failed', criterios, resultado, pasoActual: null };
    let r = await cambiarTarea(x.o.dueno, x.tareaId, () => cambio, { almacen: x.alm }).catch(() => null);
    // Sin la evidencia de cada criterio no hay «completed»: queda parcial (nunca al revés).
    if (r && r.ok === false && r.motivo === 'sin-evidencia') r = await cambiarTarea(x.o.dueno, x.tareaId, () => ({ ...cambio, estado: 'partial' }), { almacen: x.alm }).catch(() => null);
    if (r && r.ok) x.o.alTarea?.(r.tarea);
  }

  const lineaArchivo = (a: ReciboArchivo) =>
    `${a.nombre}: ${CLASE[a.tipo]} de ${kb(a.bytes!)}${a.paginas ? ` (${a.paginas} pág.)` : ''}, comprobado por dentro (${(a.comprobaciones || []).filter((c) => c.ok).length} comprobaciones)${a.render?.estado === 'hecho' ? `, ${a.render.detalle}` : ''}; se baja tocando su nombre en la tarjeta de la tarea (panel de Tareas)`;
  let texto: string;
  if (estado === 'completo') {
    texto = `DOCUMENTOS LISTOS Y COMPROBADOS (uno por uno): ${disponibles.map(lineaArchivo).join(' · ')}. Quedan en su panel de Tareas y en su cuenta ${Math.round(retencionMs() / 86_400_000)} días. Puedes decir que quedaron listos. No digas que se los mandaste por correo ni que ya los abrió: eso no lo sabes.`;
  } else if (estado === 'parcial') {
    texto = `DOCUMENTOS A MEDIAS. Hechos y comprobados: ${disponibles.length ? disponibles.map(lineaArchivo).join(' · ') : 'ninguno'}. Lo que no quedó: ${faltan.join('; ')}.${x.interrumpido ? ' Se interrumpió: si lo pide otra vez, sigo donde quedé sin repetir lo hecho.' : ''} Di exactamente qué quedó y qué falta; NO digas «ya quedó» ni «listo».`;
  } else {
    texto = `NO PUDE HACER LOS DOCUMENTOS: ${faltan.join('; ') || 'no vino nada que hacer'}. No digas que quedaron; di qué falló${x.errores.length ? ' y pide lo que falta para la especificación' : ''}.`;
  }
  return {
    estado,
    requestId: x.requestId,
    archivos: x.archivos,
    pedidos,
    hechos,
    faltan,
    errores: x.errores,
    ...(x.tareaId ? { tareaId: x.tareaId } : {}),
    ...(vence ? { vence } : {}),
    ...(x.interrumpido ? { interrumpido: true } : {}),
    texto,
  };
}
