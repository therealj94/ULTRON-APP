/**
 * TUS CORREOS EN LOS CHATS (la lógica, sin React Native): la pestaña Correos, al lado de PULSE2CHAT y
 * WhatsApp. José (2-oct): «tengo que tener otra sección de los correos al par de WhatsApp y PULSE2CHAT,
 * poder ver, contestar, etc.».
 *
 * La pantalla (correo/PantallaCorreos.tsx) solo dibuja: cómo se dice quién lo manda y cuándo, cómo se
 * agrupan en conversaciones, qué lleva una respuesta (a quién, con copia a quién, el asunto, la cita y
 * el hilo) y qué se pregunta antes de mandar sale de aquí. Lo prueba correo/pruebas.
 *
 * El servidor (server/correo.ts): GET /api/correo/bandeja, GET /api/correo/mensaje, POST /api/correo/enviar.
 * Nada sale sin el toque de la persona en el aviso de confirmación (la app manda `confirmado: true`).
 */

export type Idioma = 'es' | 'en';

export type CuentaCorreo = { id: string; correo: string; proveedor: { nombre: string; auth?: 'clave' | 'microsoft' } };

/** Un correo de la bandeja (sin el texto). `ref`: «<cuenta>:<uid>», con eso se abre. */
export type ResumenCorreo = { ref: string; cuenta: string; de: string; deCorreo: string; asunto: string; fecha: string; noLeido: boolean };

export type AdjuntoCorreo = { nombre: string; tipo: string; bytes: number };

/** Un correo abierto, completo. */
export type MensajeCorreo = ResumenCorreo & {
  cuentaId: string;
  para: string;
  cc: string;
  paraCorreos: string[];
  ccCorreos: string[];
  texto: string;
  adjuntos: AdjuntoCorreo[];
  messageId: string;
  referencias: string[];
  responderA: string;
};

export type ErrorCuenta = { cuentaId: string; cuenta: string; error: string };
export type BandejaCorreo = { mensajes: ResumenCorreo[]; cuentas: CuentaCorreo[]; errores: ErrorCuenta[] };

/** Lo que se está escribiendo (una respuesta o uno nuevo). */
export type BorradorCorreo = {
  cuentaId: string;
  para: string;
  cc: string;
  asunto: string;
  texto: string;
  /** El correo original citado debajo (se puede quitar). */
  cita: string;
  enRespuestaA?: string;
  referencias?: string[];
  modo: 'nuevo' | 'responder' | 'todos';
};

/* ── lo que llega del servidor ────────────────────────────────────────────────────────────── */

const texto = (v: unknown) => (typeof v === 'string' ? v : '');
const lista = (v: unknown) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []) as string[];

/** La bandeja, con lo mínimo para dibujarla: nunca se cae un correo por un campo que falte. */
export function normalizarBandeja(j: unknown): BandejaCorreo {
  const o = (j && typeof j === 'object' ? j : {}) as Record<string, unknown>;
  const mensajes = (Array.isArray(o.mensajes) ? o.mensajes : [])
    .filter((m: any) => m && typeof m.ref === 'string' && m.ref)
    .map((m: any) => ({ ref: m.ref, cuenta: texto(m.cuenta), de: texto(m.de), deCorreo: texto(m.deCorreo), asunto: texto(m.asunto), fecha: texto(m.fecha), noLeido: !!m.noLeido }));
  const cuentas = (Array.isArray(o.cuentas) ? o.cuentas : [])
    .filter((c: any) => c && typeof c.id === 'string' && typeof c.correo === 'string')
    .map((c: any) => ({ id: c.id, correo: c.correo, proveedor: { nombre: texto(c.proveedor?.nombre), auth: c.proveedor?.auth === 'microsoft' ? ('microsoft' as const) : ('clave' as const) } }));
  const errores = (Array.isArray(o.errores) ? o.errores : []).filter((e: any) => e && typeof e.error === 'string').map((e: any) => ({ cuentaId: texto(e.cuentaId), cuenta: texto(e.cuenta), error: e.error }));
  return { mensajes, cuentas, errores };
}

export function normalizarMensaje(j: unknown): MensajeCorreo | null {
  const m = (j && typeof j === 'object' ? j : null) as Record<string, any> | null;
  if (!m || typeof m.ref !== 'string' || !m.ref) return null;
  return {
    ref: m.ref,
    cuenta: texto(m.cuenta),
    cuentaId: texto(m.cuentaId) || cuentaDeRef(m.ref),
    de: texto(m.de),
    deCorreo: texto(m.deCorreo),
    asunto: texto(m.asunto),
    fecha: texto(m.fecha),
    noLeido: false,
    para: texto(m.para),
    cc: texto(m.cc),
    paraCorreos: lista(m.paraCorreos),
    ccCorreos: lista(m.ccCorreos),
    texto: texto(m.texto),
    adjuntos: (Array.isArray(m.adjuntos) ? m.adjuntos : []).filter(Boolean).map((a: any) => ({ nombre: texto(a.nombre) || 'adjunto', tipo: texto(a.tipo), bytes: Number(a.bytes) > 0 ? Number(a.bytes) : 0 })),
    messageId: texto(m.messageId),
    referencias: lista(m.referencias),
    responderA: texto(m.responderA) || texto(m.deCorreo),
  };
}

/** «a1b2c3:42» → «a1b2c3» (la cuenta del correo). */
export function cuentaDeRef(ref: string): string {
  return String(ref || '').split(':')[0] || '';
}

/* ── quién lo manda ───────────────────────────────────────────────────────────────────────── */

/**
 * El nombre de quien lo manda, como se lee en una bandeja: sin comillas ni la dirección pegada; si no
 * tiene nombre, la parte de antes de la @ («beto.paz@x.hn» → «beto.paz»). Nunca vacío.
 */
export function remitente(m: Pick<ResumenCorreo, 'de' | 'deCorreo'>, idioma: Idioma = 'es'): string {
  const correo = String(m.deCorreo || '').trim();
  let n = String(m.de || '')
    .replace(/<[^>]*>/g, '')
    .replace(/^["'\s]+|["'\s]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (n.toLowerCase() === correo.toLowerCase()) n = '';
  if (n) return n;
  if (correo) return correo.split('@')[0] || correo;
  return idioma === 'en' ? 'Unknown sender' : 'Sin remitente';
}

/** Las iniciales del círculo («Beto Paz» → «BP»; «beto@x.hn» → «B»). */
export function inicialesCorreo(nombre: string): string {
  const s = String(nombre || '').replace(/@.*$/, '').trim();
  const palabras = s.split(/[\s._-]+/).filter((w) => /\p{L}|\p{N}/u.test(w));
  const primera = (w: string) => (Array.from(w).find((ch) => /\p{L}|\p{N}/u.test(ch)) || '').toUpperCase();
  if (!palabras.length) return '';
  return palabras.length > 1 ? primera(palabras[0]) + primera(palabras[palabras.length - 1]) : primera(palabras[0]);
}

const COLORES = ['#4F7FD9', '#C2570C', '#0E8F6F', '#7B3FE4', '#B4296B', '#1F7AEC', '#9A6A00', '#2E7D32', '#C0392B', '#00866E'];
export function colorCorreo(clave: string): string {
  let h = 0;
  const s = String(clave || '').toLowerCase();
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return COLORES[Math.abs(h) % COLORES.length];
}

/* ── fechas ───────────────────────────────────────────────────────────────────────────────── */

const dos = (n: number) => String(n).padStart(2, '0');
const inicioDia = (ms: number) => {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};
const MESES_CORTOS = { es: ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sept', 'oct', 'nov', 'dic'], en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] };
const MESES = { es: ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'], en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'] };
const DIAS_CORTOS = { es: ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'], en: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] };
const DIAS = { es: ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'], en: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] };

const msDe = (iso: string) => {
  const t = Date.parse(String(iso || ''));
  return Number.isFinite(t) ? t : 0;
};

/** La fecha de la bandeja: hoy «14:05», «Ayer», esta semana «lun», este año «2 oct», si no «02/10/25». */
export function fechaCorreo(iso: string, ahora = Date.now(), idioma: Idioma = 'es'): string {
  const ms = msDe(iso);
  if (!ms) return '';
  const d = new Date(ms);
  const dias = Math.round((inicioDia(ahora) - inicioDia(ms)) / 86_400_000);
  if (dias <= 0) return `${dos(d.getHours())}:${dos(d.getMinutes())}`;
  if (dias === 1) return idioma === 'en' ? 'Yesterday' : 'Ayer';
  if (dias < 7) return DIAS_CORTOS[idioma][d.getDay()];
  if (d.getFullYear() === new Date(ahora).getFullYear()) return idioma === 'en' ? `${MESES_CORTOS.en[d.getMonth()]} ${d.getDate()}` : `${d.getDate()} ${MESES_CORTOS.es[d.getMonth()]}`;
  const aa = dos(d.getFullYear() % 100);
  return idioma === 'en' ? `${dos(d.getMonth() + 1)}/${dos(d.getDate())}/${aa}` : `${dos(d.getDate())}/${dos(d.getMonth() + 1)}/${aa}`;
}

/** La fecha entera del correo abierto: «jueves 2 de octubre de 2026, 14:05». */
export function fechaLarga(iso: string, idioma: Idioma = 'es'): string {
  const ms = msDe(iso);
  if (!ms) return '';
  const d = new Date(ms);
  const hora = `${dos(d.getHours())}:${dos(d.getMinutes())}`;
  if (idioma === 'en') return `${DIAS.en[d.getDay()]}, ${MESES.en[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}, ${hora}`;
  return `${DIAS.es[d.getDay()]} ${d.getDate()} de ${MESES.es[d.getMonth()]} de ${d.getFullYear()}, ${hora}`;
}

/* ── conversaciones (hilos) ───────────────────────────────────────────────────────────────── */

/** El asunto sin «Re:», «RV:», «Fwd:»… del principio (las veces que vengan), para juntar una conversación. */
export function asuntoNormal(asunto: string): string {
  let s = String(asunto || '').replace(/\s+/g, ' ').trim();
  for (let antes = ''; antes !== s; ) {
    antes = s;
    s = s.replace(/^\s*(re|rv|res|fw|fwd|aw|tr|reenv|enc)\s*(\[\d+\]|\(\d+\))?\s*:\s*/i, '').replace(/^\s*\[\d+\]\s*/, '');
  }
  return s.toLowerCase();
}

/** El asunto que se ve: «(sin asunto)» si no trae. */
export function asuntoVisible(asunto: string, idioma: Idioma = 'es'): string {
  const s = String(asunto || '').replace(/\s+/g, ' ').trim();
  return s && s !== '(sin asunto)' ? s : idioma === 'en' ? '(no subject)' : '(sin asunto)';
}

export type HiloCorreo = {
  clave: string;
  /** El más nuevo (el que se ve en la fila y el que se abre). */
  ultimo: ResumenCorreo;
  /** Del más nuevo al más viejo. */
  mensajes: ResumenCorreo[];
  noLeidos: number;
  /** Quiénes escribieron, sin repetir, del más nuevo al más viejo. */
  participantes: string[];
};

/**
 * Junta la bandeja en conversaciones: misma cuenta y mismo asunto (sin los «Re:»). Un correo sin asunto
 * va solo. Las conversaciones van de la más nueva a la más vieja.
 */
export function hilos(mensajes: ResumenCorreo[], idioma: Idioma = 'es'): HiloCorreo[] {
  const orden = [...mensajes].sort((a, b) => msDe(b.fecha) - msDe(a.fecha));
  const porClave = new Map<string, HiloCorreo>();
  const salida: HiloCorreo[] = [];
  for (const m of orden) {
    const asunto = asuntoNormal(m.asunto);
    const clave = asunto && asunto !== '(sin asunto)' ? `${cuentaDeRef(m.ref)}|${asunto}` : `solo|${m.ref}`;
    let h = porClave.get(clave);
    if (!h) {
      h = { clave, ultimo: m, mensajes: [], noLeidos: 0, participantes: [] };
      porClave.set(clave, h);
      salida.push(h);
    }
    h.mensajes.push(m);
    if (m.noLeido) h.noLeidos++;
    const quien = remitente(m, idioma);
    if (!h.participantes.includes(quien)) h.participantes.push(quien);
  }
  return salida;
}

/** ¿La conversación coincide con lo que busca? Por quién, su dirección o el asunto. */
export function coincideHilo(h: HiloCorreo, q: string): boolean {
  const t = String(q || '').trim().toLowerCase();
  if (!t) return true;
  return h.mensajes.some((m) => [m.de, m.deCorreo, m.asunto].some((x) => String(x || '').toLowerCase().includes(t)));
}

export function noLeidosTotal(mensajes: ResumenCorreo[]): number {
  return mensajes.reduce((n, m) => n + (m.noLeido ? 1 : 0), 0);
}

/** Marca leído en la lista el que se acaba de abrir (el servidor ya lo marcó en el buzón). */
export function marcarLeido(mensajes: ResumenCorreo[], ref: string): ResumenCorreo[] {
  return mensajes.map((m) => (m.ref === ref && m.noLeido ? { ...m, noLeido: false } : m));
}

/* ── el texto del correo ──────────────────────────────────────────────────────────────────── */

const CABECERA_CITA = /^(El .{3,120} escribió:|On .{3,120} wrote:|-{2,}\s*(Mensaje original|Original Message|Forwarded message|Mensaje reenviado)\s*-*|_{5,}|De: .+|From: .+)$/i;

/**
 * Separa lo que el correo dice de lo que trae citado abajo («El lunes, Ana escribió:», «> …», «From: …»):
 * lo citado se esconde detrás de «Mostrar lo citado», como en cualquier programa de correo.
 */
export function separarCitas(t: string): { cuerpo: string; citado: string } {
  const lineas = String(t || '').replace(/\r\n?/g, '\n').split('\n');
  const corte = lineas.findIndex((l, i) => {
    const x = l.trim();
    if (CABECERA_CITA.test(x)) return true;
    // Un bloque de «>» que sigue hasta el final (no una línea suelta con «>» a mitad del texto).
    return /^>/.test(x) && lineas.slice(i).every((y) => !y.trim() || /^>/.test(y.trim()) || CABECERA_CITA.test(y.trim()));
  });
  // Sin cita, o todo es cita (un reenvío sin nada escrito): se muestra entero.
  if (corte <= 0) return { cuerpo: limpiarTexto(lineas.join('\n')), citado: '' };
  return { cuerpo: limpiarTexto(lineas.slice(0, corte).join('\n')), citado: lineas.slice(corte).join('\n').trim() };
}

/** Sin espacios de más: a lo más una línea en blanco seguida, sin blancos al final de cada línea. */
export function limpiarTexto(t: string): string {
  return String(t || '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t ]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** «820 KB», «1,4 MB» (en inglés con punto). */
export function tamanoArchivo(bytes: number, idioma: Idioma = 'es'): string {
  const b = Math.max(0, Number(bytes) || 0);
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${Math.max(1, Math.round(b / 1024))} KB`;
  const mb = (b / (1024 * 1024)).toFixed(1);
  return `${idioma === 'en' ? mb : mb.replace('.', ',')} MB`;
}

export type ClaseAdjunto = 'pdf' | 'imagen' | 'hoja' | 'documento' | 'presentacion' | 'comprimido' | 'audio' | 'video' | 'otro';

/** Qué clase de archivo es (para su color y su etiqueta) y la extensión en mayúsculas. */
export function claseAdjunto(a: Pick<AdjuntoCorreo, 'nombre' | 'tipo'>): { clase: ClaseAdjunto; ext: string } {
  const ext = (/\.([a-z0-9]{1,6})$/i.exec(a.nombre || '')?.[1] || '').toUpperCase();
  const t = String(a.tipo || '').toLowerCase();
  const e = ext.toLowerCase();
  const clase: ClaseAdjunto =
    e === 'pdf' || t === 'application/pdf'
      ? 'pdf'
      : t.startsWith('image/') || ['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic'].includes(e)
        ? 'imagen'
        : ['xls', 'xlsx', 'csv', 'ods'].includes(e) || /spreadsheet|excel|csv/.test(t)
          ? 'hoja'
          : ['doc', 'docx', 'odt', 'rtf', 'txt'].includes(e) || /word|text\/plain/.test(t)
            ? 'documento'
            : ['ppt', 'pptx', 'odp', 'key'].includes(e) || /presentation|powerpoint/.test(t)
              ? 'presentacion'
              : ['zip', 'rar', '7z', 'gz', 'tar'].includes(e) || /zip|x-rar-compressed|vnd\.rar|x-7z/.test(t)
                ? 'comprimido'
                : t.startsWith('audio/')
                  ? 'audio'
                  : t.startsWith('video/')
                    ? 'video'
                    : 'otro';
  return { clase, ext };
}

/* ── direcciones ──────────────────────────────────────────────────────────────────────────── */

const CORREO_OK = /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[^\s@<>(),;:"]{2,}$/;

/** Lo que escribió en «Para» o «Cc» → las direcciones buenas (sin repetir) y las que no sirven. */
export function leerDestinos(t: string): { ok: string[]; malas: string[] } {
  const ok: string[] = [];
  const malas: string[] = [];
  for (const parte of String(t || '').split(/[,;\n]+/)) {
    const x = parte.trim();
    if (!x) continue;
    const dir = (/<([^<>]+)>\s*$/.exec(x)?.[1] || x).trim().toLowerCase();
    if (CORREO_OK.test(dir)) {
      if (!ok.includes(dir)) ok.push(dir);
    } else malas.push(x);
  }
  return { ok, malas };
}

/* ── responder, responder a todos, redactar ───────────────────────────────────────────────── */

/** «Re: Factura» (sin repetir el «Re:» si ya lo tiene). */
export function asuntoRespuesta(asunto: string): string {
  const s = String(asunto || '').replace(/\s+/g, ' ').trim();
  if (!s || s === '(sin asunto)') return 'Re:';
  return /^(re|res)\s*:/i.test(s) ? s : `Re: ${s}`;
}

/** El original citado debajo de la respuesta: «El jueves 2 de octubre…, Beto <beto@x.hn> escribió:» y cada línea con «> ». */
export function citar(m: Pick<MensajeCorreo, 'de' | 'deCorreo' | 'fecha' | 'texto'>, idioma: Idioma = 'es'): string {
  const quien = `${remitente(m, idioma)}${m.deCorreo ? ` <${m.deCorreo}>` : ''}`;
  const cuando = fechaLarga(m.fecha, idioma);
  const cabeza = idioma === 'en' ? `On ${cuando || 'a previous date'}, ${quien} wrote:` : `El ${cuando || 'mensaje anterior'}, ${quien} escribió:`;
  const cuerpo = limpiarTexto(m.texto)
    .split('\n')
    .map((l) => (l ? `> ${l}` : '>'))
    .join('\n');
  return `${cabeza}\n${cuerpo}`;
}

/**
 * Una respuesta: a quien lo mandó (su «Responder a» si lo puso) y, con «a todos», con copia a los
 * demás de «Para» y «Cc» menos tú mismo y sin repetir. En el mismo hilo (In-Reply-To y References).
 */
export function armarRespuesta(m: MensajeCorreo, modo: 'responder' | 'todos', miCorreo: string, idioma: Idioma = 'es'): BorradorCorreo {
  const yo = String(miCorreo || m.cuenta || '').trim().toLowerCase();
  const a = String(m.responderA || m.deCorreo || '').trim().toLowerCase();
  // Si el que lo mandó eres tú (un correo tuyo en la bandeja), la respuesta va a los de «Para».
  const para = a && a !== yo ? [a] : m.paraCorreos.map((x) => x.toLowerCase()).filter((x) => x !== yo).slice(0, 1);
  const cc =
    modo === 'todos'
      ? [...m.paraCorreos, ...m.ccCorreos]
          .map((x) => String(x || '').trim().toLowerCase())
          .filter((x, i, todos) => x && x !== yo && !para.includes(x) && todos.indexOf(x) === i)
      : [];
  return {
    cuentaId: m.cuentaId,
    para: para.join(', '),
    cc: cc.join(', '),
    asunto: asuntoRespuesta(m.asunto),
    texto: '',
    cita: citar(m, idioma),
    enRespuestaA: m.messageId || undefined,
    referencias: m.messageId ? [...m.referencias.filter((r) => r !== m.messageId), m.messageId].slice(-30) : m.referencias.slice(-30),
    modo,
  };
}

export function borradorNuevo(cuentaId: string): BorradorCorreo {
  return { cuentaId, para: '', cc: '', asunto: '', texto: '', cita: '', modo: 'nuevo' };
}

/** El texto que sale: lo que escribió y, si dejó la cita, el original debajo. */
export function textoFinal(b: Pick<BorradorCorreo, 'texto' | 'cita'>, conCita: boolean): string {
  const t = String(b.texto || '').replace(/\s+$/, '');
  return conCita && b.cita ? `${t}\n\n${b.cita}` : t;
}

/** ¿Se puede mandar? Null si sí; si no, qué falta (dicho para la persona). */
export function problemaBorrador(b: Pick<BorradorCorreo, 'cuentaId' | 'para' | 'cc' | 'texto'>, idioma: Idioma = 'es'): string | null {
  const en = idioma === 'en';
  if (!b.cuentaId) return en ? 'Choose which account sends it.' : 'Elige desde qué cuenta sale.';
  const para = leerDestinos(b.para);
  const cc = leerDestinos(b.cc);
  if (para.malas.length || cc.malas.length) return en ? `“${[...para.malas, ...cc.malas][0]}” isn’t an email address.` : `«${[...para.malas, ...cc.malas][0]}» no es una dirección de correo.`;
  if (!para.ok.length) return en ? 'Who is it for? Write at least one address.' : '¿Para quién es? Escribe al menos una dirección.';
  if (para.ok.length + cc.ok.filter((x) => !para.ok.includes(x)).length > 20) return en ? 'Too many addresses (20 at most).' : 'Son demasiadas direcciones (máximo 20).';
  if (!String(b.texto || '').trim()) return en ? 'The email is empty. Write something.' : 'El correo va vacío. Escribe algo.';
  return null;
}

/** Lo que dice el aviso antes de mandar: desde dónde, a quién, con copia a quién y el asunto. */
export function avisoConfirmacion(b: Pick<BorradorCorreo, 'para' | 'cc' | 'asunto' | 'texto'>, desde: string, idioma: Idioma = 'es'): { titulo: string; cuerpo: string } {
  const en = idioma === 'en';
  const para = leerDestinos(b.para).ok;
  const cc = leerDestinos(b.cc).ok.filter((x) => !para.includes(x));
  const previa = String(b.texto || '').replace(/\s+/g, ' ').trim();
  const corta = previa.length > 140 ? `${previa.slice(0, 137)}…` : previa;
  const lineas = [
    `${en ? 'From' : 'Desde'}: ${desde}`,
    `${en ? 'To' : 'Para'}: ${para.join(', ')}`,
    cc.length ? `${en ? 'Cc' : 'Con copia'}: ${cc.join(', ')}` : '',
    `${en ? 'Subject' : 'Asunto'}: ${asuntoVisible(b.asunto, idioma)}`,
    corta ? `\n«${corta}»` : '',
  ].filter(Boolean);
  return { titulo: en ? 'Send this email?' : '¿Mandar este correo?', cuerpo: lineas.join('\n') };
}

/** El aviso de después de mandar: a quién llegó y a quién no. */
export function avisoEnviado(r: { aceptados?: string[]; rechazados?: string[] }, idioma: Idioma = 'es'): string {
  const en = idioma === 'en';
  const ok = (r.aceptados || []).join(', ');
  const no = (r.rechazados || []).join(', ');
  const base = en ? `Sent to ${ok}.` : `Enviado a ${ok}.`;
  return no ? `${base} ${en ? `It didn’t reach ${no}.` : `No le llegó a ${no}.`}` : base;
}

/* ── qué se ve y los errores ──────────────────────────────────────────────────────────────── */

export type VistaCorreos = 'cargando' | 'sin_cuentas' | 'lista' | 'error';

export function vistaCorreos(o: { bandeja: BandejaCorreo | null; error: string }): VistaCorreos {
  if (!o.bandeja) return o.error ? 'error' : 'cargando';
  if (!o.bandeja.cuentas.length) return 'sin_cuentas';
  return 'lista';
}

/** El error dicho para la persona (sin «HTTP 502» suelto). */
export function mensajeErrorCorreo(status: number, error: string | undefined, idioma: Idioma = 'es'): string {
  const en = idioma === 'en';
  const e = String(error || '').trim();
  if (status === 401) return en ? 'Your session expired. Sign in again.' : 'Tu sesión venció. Vuelve a entrar.';
  if (status === 428) return en ? 'It needs your confirmation: nothing was sent.' : 'Falta tu confirmación: no se mandó nada.';
  if (status === 429) return en ? 'Too many tries in a row. Wait a minute.' : 'Demasiados intentos seguidos. Espera un minuto.';
  if (!status) return en ? 'No connection. Check your internet and try again.' : 'Sin conexión. Revisa tu internet y prueba otra vez.';
  if (e && !/^HTTP \d+$/.test(e)) return e.slice(0, 220);
  if (status >= 500) return en ? 'The mail server didn’t answer. Try again in a moment.' : 'El servidor de correo no contestó. Prueba otra vez en un momento.';
  return en ? 'Something went wrong. Try again.' : 'Algo falló. Prueba otra vez.';
}
