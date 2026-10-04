/**
 * LO QUE LA PERSONA APROBÓ SALE UNA SOLA VEZ, Y SE DICE CÓMO QUEDÓ (AUR13; documento maestro: recorrido R2 de la
 * sección 5, secciones 8, 10 y 15).
 *
 * El correo y el WhatsApp que salen tras el «sí» (server/correo.ts, server/whatsapp.ts) pasan por aquí, sobre el
 * registro de operaciones de lib/durable.ts:
 *
 *  · operationId ESTABLE por borrador aprobado (`envio-<canal>-<intento>`): un reintento, otra réplica con la misma
 *    copia del borrador o un reinicio ven la misma operación y no la repiten.
 *  · Persistir antes de actuar: la operación queda `requested` y luego `dispatched` ANTES de tocar el SMTP o el
 *    puente. Sin almacén no se manda (así no se arriesga a salir dos veces).
 *  · La aprobación va ligada a lo aprobado: `huella` es el hash de los campos canónicos (cuenta remitente,
 *    destinatarios, asunto, texto…) y es el `argsHash` de la operación. La misma operación con otra huella (otro
 *    destinatario, otro contenido, otra cuenta) es `otro-pedido`: no se canjea, hace falta otra decisión.
 *  · Un timeout o una respuesta incierta deja `unknown` y se RECONCILIA (`reconciliar`): para el correo, buscar en
 *    Enviados el Message-ID que pone AURA (derivado de la operación); para WhatsApp, el id del mensaje que AURA le da
 *    al puente (también derivado). Si aparece, `succeeded`; si no, sigue incierto: «No he podido confirmar el envío».
 *  · Si después pide lo MISMO (mismo destino, cuenta y contenido: misma huella) y lo anterior sigue incierto, primero
 *    se reconcilia; si aún no consta, no sale solo: se pide otra decisión (`repeticion-incierta`). Si la persona la
 *    da sabiendo que podría llegar repetido, sale con otra operación (`repeticionAceptada`).
 *  · Estado de entrega honesto: `aceptado` (el proveedor lo tomó; no prueba que llegó ni que lo leyeron),
 *    `entregado` (solo si el proveedor lo confirma), `fallido`, `incierto`.
 *
 * También: `primeraVezEvento`, para deduplicar eventos y webhooks entrantes (Telegram, el relevo de PULSE2CHAT) por
 * fuente + dueño + id del evento, nunca por texto.
 *
 * Nada de aquí guarda el texto, las direcciones ni el chat: solo ids, hashes, estados y recibos.
 */
import crypto from 'node:crypto';
import { almacenDurable, avanzarOperacion, claveDe, crearUnaVez, hashArgumentos, leerDurable, leerOperacion, modificarDurable, registrarOperacion, type AlmacenDurable, type Operacion, type ReciboOperacion } from './durable';

export type CanalEnvio = 'correo' | 'whatsapp';
export type Entrega = 'aceptado' | 'entregado' | 'fallido' | 'incierto';

/** Lo que contesta el efecto (mandar por SMTP, por el puente). */
export type SalidaEnvio<R = unknown> =
  | { estado: 'succeeded'; entrega?: 'aceptado' | 'entregado'; referencia?: string; detalle?: string; datos?: R }
  | { estado: 'failed'; detalle: string; datos?: R }
  | { estado: 'unknown'; detalle: string; datos?: R };

/** Lo que encuentra la reconciliación de una operación (por su id). */
export type Reconciliacion = { encontrado: true; referencia?: string; detalle?: string } | { encontrado: false; detalle?: string };

export type ResultadoEnvio<R = unknown> = {
  estado: 'succeeded' | 'failed' | 'unknown';
  /** La entrega, si se intentó (sin intento —aprobación que no coincide, sin almacén— no hay entrega que contar). */
  entrega?: Entrega;
  /** El operationId: el de este borrador, o el anterior igual que se encontró enviado. */
  operacion: string;
  /** La operación ya existía (reintento, otra réplica, o el envío igual de antes): no se volvió a mandar. */
  repetido: boolean;
  /** El final se supo reconciliando (Enviados, el chat), no por la respuesta del envío. */
  reconciliado?: boolean;
  referencia?: string;
  detalle?: string;
  datos?: R;
  /** Por qué no se intentó. */
  motivo?: 'aprobacion-no-coincide' | 'almacen' | 'en-curso' | 'repeticion-incierta';
  /** `repeticion-incierta`: la operación igual de antes que sigue sin constar. */
  previa?: string;
};

/** Un envío igual de antes cuenta para «¿quedó incierto?» durante un día. */
const VIGENCIA_CONTENIDO_MS = 24 * 3600_000;

/** El operationId de un borrador aprobado: estable por borrador (su id de intento), no por texto. */
export function operacionDeBorrador(canal: CanalEnvio, intento: string): string {
  return `envio-${canal}-${String(intento || '').trim()}`;
}

/** La huella de lo aprobado: el hash de los campos canónicos (quien llama los normaliza: minúsculas, orden, recortes). */
export function huellaAprobacion(canal: CanalEnvio, campos: Record<string, unknown>): string {
  return hashArgumentos({ canal, ...campos });
}

const sha = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

/**
 * El Message-ID que AURA le pone al correo de una operación: `<aura.<hash>@<dominio del remitente>>`. Derivado de la
 * operación, así la reconciliación lo busca en Enviados sin haber guardado nada más.
 */
export function messageIdDeOperacion(operacion: string, desde: string): string {
  const dominio = String(desde || '').split('@')[1]?.toLowerCase().replace(/[^a-z0-9.-]/g, '') || 'aura.local';
  return `<aura.${sha(`correo:${operacion}`).slice(0, 32)}@${dominio}>`;
}

/** El id del mensaje de WhatsApp de una operación: con la forma de los de WhatsApp Web (3EB0 + 18 hex en mayúsculas). */
export function idMensajeWADeOperacion(operacion: string): string {
  return `3EB0${sha(`whatsapp:${operacion}`).slice(0, 18).toUpperCase()}`;
}

const claveContenido = (dueno: string, huella: string) => claveDe('envios/contenido', dueno, huella);

async function reconciliarSeguro(f: (op: string) => Promise<Reconciliacion>, op: string): Promise<Reconciliacion> {
  try {
    return await f(op);
  } catch (e: any) {
    return { encontrado: false, detalle: String(e?.message || e).slice(0, 120) };
  }
}

function reciboDe(canal: CanalEnvio, s: { estado: 'succeeded' | 'failed' | 'unknown'; entrega?: Entrega; referencia?: string; detalle?: string }): Omit<ReciboOperacion, 'observado'> {
  return {
    efecto: s.estado === 'succeeded' ? 'confirmed' : s.estado === 'failed' ? 'none' : 'possible',
    proveedor: canal === 'correo' ? 'smtp' : 'whatsapp',
    ...(s.referencia ? { referencia: s.referencia.slice(0, 200) } : {}),
    ...(s.detalle ? { detalle: s.detalle.slice(0, 160) } : {}),
    entrega: s.entrega ?? (s.estado === 'succeeded' ? 'aceptado' : s.estado === 'failed' ? 'fallido' : 'incierto'),
  };
}

/** Cierra por reconciliación una operación que estaba despachada o incierta. */
async function cerrarReconciliada(canal: CanalEnvio, dueno: string, op: string, rc: Extract<Reconciliacion, { encontrado: true }>, a: AlmacenDurable) {
  await avanzarOperacion({ dueno, requestId: op, a: 'succeeded', recibo: reciboDe(canal, { estado: 'succeeded', entrega: 'aceptado', referencia: rc.referencia, detalle: `reconciliado: ${rc.detalle || 'encontrado'}` }), almacen: a }).catch(() => undefined);
}

/** La operación ya existía: se cuenta su estado; si quedó a medias, se reconcilia. Nunca se repite. */
async function yaRegistrada<R>(canal: CanalEnvio, dueno: string, op: Operacion, reconciliar: (op: string) => Promise<Reconciliacion>, a: AlmacenDurable): Promise<ResultadoEnvio<R>> {
  const base = { operacion: op.requestId, repetido: true };
  if (op.estado === 'succeeded') return { ...base, estado: 'succeeded', entrega: op.recibo?.entrega === 'entregado' ? 'entregado' : 'aceptado', referencia: op.recibo?.referencia, detalle: op.recibo?.detalle };
  if (op.estado === 'failed') return { ...base, estado: 'failed', entrega: 'fallido', detalle: op.recibo?.detalle };
  // `requested`: otro proceso la registró y no la ha despachado (o se cayó antes): no hubo efecto todavía, y no se toca.
  if (op.estado === 'requested') return { ...base, estado: 'unknown', entrega: 'incierto', motivo: 'en-curso', detalle: 'otro proceso la está atendiendo' };
  const rc = await reconciliarSeguro(reconciliar, op.requestId);
  if (rc.encontrado) {
    await cerrarReconciliada(canal, dueno, op.requestId, rc, a);
    return { ...base, estado: 'succeeded', entrega: 'aceptado', reconciliado: true, referencia: rc.referencia, detalle: rc.detalle };
  }
  return { ...base, estado: 'unknown', entrega: 'incierto', detalle: op.recibo?.detalle || rc.detalle };
}

/**
 * Manda UNA vez lo aprobado (ver el encabezado). `efecto` hace el envío y clasifica su resultado; si lanza, queda
 * incierto. `reconciliar(op)` busca el efecto de una operación por su id (la de ahora o una igual de antes).
 */
export async function enviarUnaVez<R = unknown>(o: {
  canal: CanalEnvio;
  dueno: string;
  operacion: string;
  huella: string;
  /** Con la huella de lo que sale (mismo destino, cuenta y contenido): mira si un envío igual de antes quedó incierto. */
  contenido?: string;
  /** La operación igual de antes cuyo riesgo de repetir ya aceptó la persona. */
  repeticionAceptada?: string;
  efecto: () => Promise<SalidaEnvio<R>>;
  reconciliar: (operacion: string) => Promise<Reconciliacion>;
  almacen?: AlmacenDurable;
}): Promise<ResultadoEnvio<R>> {
  const a = o.almacen || almacenDurable();
  const base = { operacion: o.operacion, repetido: false };

  // 1) ¿Lo mismo de antes quedó incierto? Se reconcilia antes de intentar de nuevo (nunca se reenvía a ciegas).
  //    Si el almacén no deja mirarlo, NO es «no había nada»: no se manda (revisión externa, 4-oct).
  if (o.contenido) {
    const l = await leerDurable<{ op: string; t: number }>(claveContenido(o.dueno, o.contenido), a).catch((e) => ({ ok: false as const, detalle: String(e?.message || e) }));
    if (l.ok === false) return { ...base, estado: 'failed', motivo: 'almacen', detalle: `no pude comprobar si un envío igual quedó pendiente: ${String(l.detalle).slice(0, 120)}` };
    const prev = l.valor && l.valor.op !== o.operacion && Date.now() - Number(l.valor.t || 0) < VIGENCIA_CONTENIDO_MS ? l.valor.op : '';
    if (prev) {
      const lp = await leerOperacion(o.dueno, prev, a).catch((e) => ({ ok: false as const, detalle: String(e?.message || e) }));
      if (lp.ok === false) return { ...base, estado: 'failed', motivo: 'almacen', detalle: `no pude comprobar cómo quedó el envío igual de antes: ${String(lp.detalle).slice(0, 120)}` };
      const p = lp.valor;
      // `requested` también: otro proceso lo registró y pudo estar a punto de mandarlo (o se cayó en medio).
      if (p && (p.estado === 'requested' || p.estado === 'dispatched' || p.estado === 'unknown')) {
        const rc = await reconciliarSeguro(o.reconciliar, prev);
        if (rc.encontrado) {
          await cerrarReconciliada(o.canal, o.dueno, prev, rc, a);
          return { operacion: prev, repetido: true, reconciliado: true, estado: 'succeeded', entrega: 'aceptado', referencia: rc.referencia, detalle: rc.detalle };
        }
        if (o.repeticionAceptada !== prev) return { ...base, estado: 'failed', motivo: 'repeticion-incierta', previa: prev, detalle: 'un envío igual de antes sigue sin confirmar' };
      }
    }
  }

  // 2) Registrar la intención (una vez por dueño + operación, ligada a la huella de lo aprobado).
  const reg = await registrarOperacion({ dueno: o.dueno, requestId: o.operacion, tipo: `envio.${o.canal}`, argsHash: o.huella, almacen: a });
  if (reg.ok === false) {
    if (reg.motivo === 'otro-pedido') return { ...base, estado: 'failed', motivo: 'aprobacion-no-coincide', detalle: 'esa aprobación era para otro envío (otro destinatario, contenido o cuenta)' };
    return { ...base, estado: 'failed', motivo: 'almacen', detalle: reg.detalle };
  }
  if (!reg.nueva) return yaRegistrada<R>(o.canal, o.dueno, reg.op, o.reconciliar, a);

  // 3) Lo que sale queda anotado por su contenido (para reconciliar si lo vuelve a pedir) y se despacha ANTES del efecto.
  //    Si no se pudo anotar, no se manda: un incierto de este envío no tendría con qué reconciliarse después y lo
  //    mismo, pedido otra vez, saldría a ciegas.
  if (o.contenido) {
    const anotado = await modificarDurable(claveContenido(o.dueno, o.contenido), () => ({ op: o.operacion, t: Date.now() }), a).catch((e) => ({ ok: false as const, conflicto: false, detalle: String(e?.message || e) }));
    if (anotado.ok === false) {
      await avanzarOperacion({ dueno: o.dueno, requestId: o.operacion, a: 'failed', recibo: { efecto: 'none', detalle: 'no se despachó: no pude anotarlo' }, almacen: a }).catch(() => undefined);
      return { ...base, estado: 'failed', motivo: 'almacen', detalle: anotado.detalle };
    }
  }
  const desp = await avanzarOperacion({ dueno: o.dueno, requestId: o.operacion, a: 'dispatched', almacen: a });
  if (desp.ok === false) {
    await avanzarOperacion({ dueno: o.dueno, requestId: o.operacion, a: 'failed', recibo: { efecto: 'none', detalle: `no se despachó: ${desp.motivo}` }, almacen: a }).catch(() => undefined);
    return { ...base, estado: 'failed', motivo: 'almacen', detalle: desp.detalle };
  }

  // 4) El efecto. Lo que lanza pudo haber salido: incierto.
  let salida: SalidaEnvio<R>;
  try {
    salida = await o.efecto();
  } catch (e: any) {
    salida = { estado: 'unknown', detalle: String(e?.message || e).slice(0, 160) };
  }
  // 5) Incierto: se mira enseguida (Gmail guarda en Enviados solo; el puente guarda lo que WhatsApp aceptó).
  let reconciliado = false;
  if (salida.estado === 'unknown') {
    const rc = await reconciliarSeguro(o.reconciliar, o.operacion);
    if (rc.encontrado) {
      salida = { estado: 'succeeded', entrega: 'aceptado', referencia: rc.referencia, detalle: `reconciliado: ${rc.detalle || 'encontrado'}`, datos: salida.datos };
      reconciliado = true;
    }
  }
  const entrega: Entrega = salida.estado === 'succeeded' ? salida.entrega || 'aceptado' : salida.estado === 'failed' ? 'fallido' : 'incierto';
  const referencia = salida.estado === 'succeeded' ? salida.referencia : undefined;
  // Si el cierre no se pudo guardar, la operación queda `dispatched`: quien la vea después la reconcilia, no la repite.
  await avanzarOperacion({ dueno: o.dueno, requestId: o.operacion, a: salida.estado, recibo: reciboDe(o.canal, { estado: salida.estado, entrega, referencia, detalle: salida.detalle }), almacen: a }).catch(() => undefined);
  return { ...base, estado: salida.estado, entrega, reconciliado, ...(referencia ? { referencia } : {}), ...(salida.detalle ? { detalle: salida.detalle } : {}), ...(salida.datos !== undefined ? { datos: salida.datos } : {}) };
}

/* ------------------------------------------------------------------ eventos entrantes */

/**
 * ¿Es la primera vez que llega este evento? (un webhook que el emisor reintenta, un relevo que repite). Por fuente
 * (`telegram`, `relevo`) + dueño + id del evento; nunca por texto ni entre personas. Sin id, o si el almacén no
 * contesta, se deja pasar: perder un mensaje es peor que verlo dos veces.
 */
export async function primeraVezEvento(fuente: string, dueno: string, id: string, almacen?: AlmacenDurable): Promise<boolean> {
  return (await vezDelEvento(fuente, dueno, id, almacen)) !== 'repetido';
}

/**
 * Lo mismo, sin confundir «no sé» con «primera vez»: `incierto` cuando no hay id o el almacén no contestó. Quien
 * lo procesa igual (perder un mensaje es peor) lo hace SIN efectos: contestar sí, mandar o encargar no, porque
 * pudo ser la reentrega de uno que ya los hizo (server.ts, el webhook de Telegram).
 */
export async function vezDelEvento(fuente: string, dueno: string, id: string, almacen?: AlmacenDurable): Promise<'primera' | 'repetido' | 'incierto'> {
  const ev = String(id ?? '').trim();
  const f = String(fuente || '').toLowerCase().replace(/[^a-z0-9-]/g, '');
  if (!ev || !f || !String(dueno || '').trim()) return 'incierto';
  try {
    const r = await crearUnaVez(claveDe(`eventos/${f}`, dueno, ev.slice(0, 200)), { t: Date.now() }, almacen || almacenDurable());
    return r.ok ? (r.creado ? 'primera' : 'repetido') : 'incierto';
  } catch {
    return 'incierto';
  }
}
