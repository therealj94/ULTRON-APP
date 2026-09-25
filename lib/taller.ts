/**
 * Taller de AU-RA: despacha tareas reales (sistema, PDF, canales, pendientes).
 * Si el canal no está configurado, el HECHO dice que falta la clave. No se finge el envío.
 */

import { canales, hacerPdf, leerPdf } from './canales';
import { catalogoCanales, fotoSistema, redesplegarMesa } from './sistema';
import { agregarTarea, marcarTarea, resumenTareas } from './tareas';
import { fotoBoveda, clave } from './boveda';
import { dictarSistema, notaDeVoz, pideNotaDeVoz } from './voz';
import { puedeCambiarSistema, type MiembroId } from './junta';
import type { Nivel } from './acceso';
import { autorizar, textoDeDecision, type Efecto } from './cognitivo/politica';
import { registrarEjecutor } from './cognitivo/aprobaciones';

export type TallerOut = { hechos: string[]; tools: string[]; decir?: string };

function publicBase() {
  return (process.env.PUBLIC_BASE || process.env.RENDER_EXTERNAL_URL || '').replace(/\/$/, '');
}

export function parsePedido(raw: string): {
  accion: 'sistema' | 'mantenimiento' | 'redeploy' | 'tarea' | 'listar' | 'hecho' | 'pdf' | 'enviar' | 'llamar' | 'boveda' | 'urgente' | 'voz' | null;
  canal: 'telegram' | 'whatsapp' | 'correo' | null;
  texto: string;
} {
  const q = String(raw || '').trim();
  const l = q.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const canal: 'telegram' | 'whatsapp' | 'correo' | null = /telegram|tg\b/.test(l)
    ? 'telegram'
    : /whats?app|\bwsp\b|\bwa\b/.test(l)
      ? 'whatsapp'
      : /correo|email|gmail|mail\b/.test(l)
        ? 'correo'
        : null;
  if (/\b(boveda|cajas de (la )?boveda|abri la boveda|abre la boveda)\b/.test(l)) return { accion: 'boveda', canal, texto: q };
  if (/\b(redeploy|redespleg|reinicia(r)? la mesa|nuevo deploy)\b/.test(l)) return { accion: 'redeploy', canal, texto: q };
  if (pideNotaDeVoz(q)) return { accion: 'voz', canal: canal || 'telegram', texto: q };
  if (/\b(mantenimiento|repara|arregla|diagnostico|diagnóstico)\b/.test(l)) return { accion: 'mantenimiento', canal, texto: q };
  if (/\b(como esta|cómo está|estado del sistema|los nodos|salud del sistema|que nodos)\b/.test(l) || /^(status|salud)\b/.test(l)) {
    return { accion: 'sistema', canal, texto: q };
  }
  // Envío gana a "llamada": el cuerpo de un PDF/Telegram puede listar canales pendientes.
  if (/\b(envia|envía|manda|mandale|mandame|mándame)\b/.test(l) || (canal && /\bpdf\b/.test(l))) {
    return { accion: 'enviar', canal, texto: q };
  }
  if (/\b(haz un pdf|genera(?:r)? (un )?pdf|pdf de)\b/.test(l)) return { accion: 'pdf', canal, texto: q };
  if (/\b(urgente|avisame|alerta junta)\b/.test(l) || (canal === 'telegram' && /\b(llama(?:me|nos)?|ll[aá]mame|llamanos)\b/.test(l))) {
    return { accion: 'urgente', canal: canal || 'telegram', texto: q };
  }
  if (/\b(llama(?:me)?|ll[aá]mame|haz una llamada|hacer una llamada|call me)\b/.test(l)) {
    return { accion: 'llamar', canal, texto: q };
  }
  if (/\b(pendientes|tareas|lista de tareas)\b/.test(l) && !/\b(anota|agrega|apunta|recuerda)\b/.test(l)) {
    return { accion: 'listar', canal, texto: q };
  }
  const mHecho = l.match(/\b(tarea|pendiente)\s+([a-z0-9]+)\s+(hecha|listo|cerrada)\b/);
  if (mHecho) return { accion: 'hecho', canal, texto: mHecho[2] };
  const mAdd = q.match(/\b(?:anota|apunta|agrega|recu[eé]rdame|recu[eé]dame|nueva tarea)(?:\s+(?:que|esto))?\s*[:\-]?\s*(.+)$/i);
  if (mAdd && mAdd[1].trim().length > 2) return { accion: 'tarea', canal, texto: mAdd[1].trim() };
  return { accion: null, canal, texto: q };
}

function extraerCuerpo(q: string) {
  return q
    .replace(/^(env[ií]a|manda|m[aá]ndame|mandale|haz un pdf|genera(r)? (un )?pdf|pdf de|por telegram|por whatsapp|por correo|ll[aá]mame[,:]?|avisame urgente|avísame urgente|urgente)\s*/i, '')
    .replace(/\b(por|a|al|en)\s+(telegram|whatsapp|wsp|correo|email|gmail)\b/gi, '')
    .replace(/\b(un )?pdf\b/gi, '')
    .trim();
}

/**
 * LAS ACCIONES CON EFECTO DEL TALLER — cada una es una función con argumentos explícitos.
 *
 * Existen separadas del despacho por el motor de reglas: una acción que una regla manda a revisión
 * queda congelada en la cola con sus argumentos, y cuando la junta la aprueba el SERVIDOR la ejecuta
 * llamando a esta misma función con esos mismos argumentos (lib/cognitivo/aprobaciones.ts). Si la
 * acción viviera enredada en el `if` del despacho, no habría nada que ejecutar después.
 */
type ResultadoAccion = { ok: boolean; texto: string };

export const ACCIONES_TALLER: Record<string, { efecto: Efecto; correr: (a: Record<string, unknown>) => Promise<ResultadoAccion> }> = {
  voz_estado: {
    efecto: 'externo',
    async correr() {
      const foto = await fotoSistema();
      const dicho = dictarSistema(foto);
      if (!clave('telegram_token') || !clave('telegram_chat')) return { ok: false, texto: 'Falta TELEGRAM_BOT_TOKEN o TELEGRAM_CHAT_ID. No envié nada.' };
      const voz = await notaDeVoz(dicho);
      if (!voz) {
        const r = await canales.telegram({ texto: dicho });
        return { ok: r.ok, texto: r.ok ? `${dicho} Mandé el estado por texto. Sin audio.` : r.detalle };
      }
      const r = await canales.telegramVoz({ buf: voz, caption: 'AU-RA · estado del sistema' });
      return { ok: r.ok, texto: r.ok ? dicho : r.detalle };
    },
  },
  urgente: {
    efecto: 'externo',
    async correr(a) {
      const dicho = String(a.texto || 'AU-RA te necesita. Es urgente.');
      const voz = await notaDeVoz(dicho);
      const r = await canales.telegramUrgente(dicho, voz);
      return { ok: r.ok, texto: `${r.detalle}${voz ? '' : ' Sin audio: avisé por texto que suena.'}` };
    },
  },
  llamada: {
    efecto: 'externo',
    async correr(a) {
      const dicho = String(a.texto || 'Hola, te llama AU-RA.');
      const r = await canales.llamada(dicho);
      if (r.ok) return { ok: true, texto: r.detalle };
      const voz = await notaDeVoz(dicho);
      const tg = await canales.telegramUrgente(dicho, voz);
      return { ok: tg.ok, texto: `${r.detalle} ${tg.ok ? 'Te avisé por Telegram.' : tg.detalle}` };
    },
  },
  redeploy: {
    efecto: 'sistema',
    async correr() {
      const r = await redesplegarMesa();
      return { ok: r.ok, texto: r.detalle };
    },
  },
  tarea_anotar: {
    efecto: 'escritura',
    async correr(a) {
      const t = agregarTarea(String(a.texto || ''), a.usuario ? String(a.usuario) : undefined);
      return { ok: true, texto: `TAREA ANOTADA [${t.id}]: ${t.texto}` };
    },
  },
  tarea_cerrar: {
    efecto: 'escritura',
    async correr(a) {
      const t = marcarTarea(String(a.id || ''), true);
      return t ? { ok: true, texto: `TAREA CERRADA [${t.id}]: ${t.texto}` } : { ok: false, texto: `No encontré la tarea ${a.id}.` };
    },
  },
  enviar: {
    efecto: 'externo',
    async correr(a) {
      const canal = String(a.canal || '');
      const cuerpo = String(a.texto || '');
      const conPdf = !!a.pdf;
      let pdf: { id: string; buf: Buffer; filename: string } | undefined;
      if (conPdf) {
        const made = hacerPdf('AU-RA', cuerpo);
        const buf = leerPdf(made.id);
        if (buf) pdf = { id: made.id, buf, filename: made.id };
      }
      if (canal === 'telegram') {
        const r = await canales.telegram({ texto: cuerpo, pdf });
        return { ok: r.ok, texto: `TELEGRAM: ${r.detalle}` };
      }
      if (canal === 'whatsapp') {
        const base = publicBase();
        const media = pdf && base ? `${base}/api/taller/archivo/${pdf.id}` : undefined;
        const r = await canales.whatsapp(cuerpo, media);
        return { ok: r.ok, texto: `WHATSAPP: ${r.detalle}${pdf && !media ? ' (sin PDF: falta PUBLIC_BASE)' : ''}` };
      }
      if (canal === 'correo') {
        const r = await canales.correo({ asunto: conPdf ? 'PDF de AU-RA' : cuerpo.slice(0, 80), texto: cuerpo, pdf: pdf ? { filename: pdf.filename, buf: pdf.buf } : undefined });
        return { ok: r.ok, texto: `CORREO: ${r.detalle}` };
      }
      return { ok: false, texto: 'No supe el canal. Di telegram, WhatsApp o correo.' };
    },
  },
};

// Lo aprobado en la cola lo ejecuta el servidor con estas mismas funciones.
for (const [nombre, a] of Object.entries(ACCIONES_TALLER)) registrarEjecutor(`taller.${nombre}`, (args) => a.correr(args));

export type ContextoTaller = {
  usuario?: string;
  quien?: MiembroId | null;
  /** Nivel en AU-RA según el padrón, ya verificado. */
  nivel?: Nivel | null;
  prueba?: 'sesion' | 'telegram' | 'nombre' | null;
  canal?: 'mesa' | 'telegram';
  riesgo?: number | null;
};

/**
 * Pasa la acción por las reglas y, si la dejan, la corre. Si no, devuelve el texto de la decisión
 * (bloqueada, o en espera de aprobación con su número de solicitud).
 */
async function conPermiso(nombre: keyof typeof ACCIONES_TALLER, args: Record<string, unknown>, ctx: ContextoTaller): Promise<ResultadoAccion & { decision?: string }> {
  const accion = ACCIONES_TALLER[nombre];
  const d = await autorizar({
    herramienta: `taller.${nombre}`,
    efecto: accion.efecto,
    plataforma: 'ultron',
    args,
    quien: ctx.quien ?? null,
    nivel: ctx.nivel ?? null,
    prueba: ctx.prueba ?? null,
    canal: ctx.canal,
    riesgo: ctx.riesgo ?? null,
    // Todo lo que el taller manda va a los canales propios configurados (el grupo, el correo y el
    // WhatsApp de la junta). No hay forma de darle un destinatario arbitrario desde el chat.
    destino: accion.efecto === 'externo' ? 'junta' : null,
  });
  if (d.veredicto !== 'permitir') return { ok: false, texto: textoDeDecision({ herramienta: nombre }, d), decision: d.veredicto };
  return accion.correr(args);
}

export async function despacharTaller(message: string, opts?: ContextoTaller): Promise<TallerOut> {
  const p = parsePedido(message);
  if (!p.accion) return { hechos: [], tools: [] };
  const tools: string[] = [];
  const hechos: string[] = [];
  const out = (decir?: string): TallerOut => ({ hechos, tools, decir });
  const ctx: ContextoTaller = opts || {};
  const consulta = !puedeCambiarSistema(opts?.quien);

  if (consulta && (p.accion === 'redeploy' || p.accion === 'mantenimiento')) {
    tools.push(p.accion);
    hechos.push(
      'ACCESO: consulta. Carlos y Mayra no cambian el sistema. No redespliego, no hago mantenimiento ni corro el ejecutor. José o Medardo sí pueden. El resto del taller (estado, PDF, fotos, voz, web, oro, pendientes, memoria propia) sí.'
    );
    return out('Eso cambia el sistema. Tu acceso es consulta: no lo hago. Pedile a José o a Medardo.');
  }

  if (p.accion === 'sistema' || p.accion === 'mantenimiento') {
    tools.push(p.accion === 'mantenimiento' ? 'mantenimiento' : 'sistema');
    const foto = await fotoSistema();
    hechos.push(foto.resumen);
    hechos.push('Nodos: ' + foto.nodos.map((n) => `${n.id}=${n.vivo ? 'vivo' : 'caído'} (${n.detalle})`).join('; '));
    if (p.accion === 'mantenimiento') {
      hechos.push('MANTENIMIENTO: re-probé los nodos. No SSH al cerebro Qwen (prohibido). Si un nodo está caído, dilo y pide clave o redespliegue de la mesa. No afirmo que lo arreglé si sigue caído.');
    }
    const caidos = foto.nodos.filter((n) => !n.vivo).map((n) => n.id);
    const faltan = foto.canales.filter((c) => !c.listo).map((c) => c.nombre);
    const decir = caidos.length
      ? `${caidos.join(', ')} no responde. ${p.accion === 'mantenimiento' ? 'Re-probé. No toqué el nodo Qwen.' : 'El resto, sí.'}`
      : `Nodos en pie. Sin clave: ${faltan.join(', ') || 'ningún canal'}.`;
    return out(decir);
  }

  if (p.accion === 'boveda') {
    tools.push('boveda');
    const f = fotoBoveda();
    hechos.push(f.resumen);
    const decir = f.faltan.length
      ? `Bóveda: ${f.listos.join(', ') || 'nada listo'}. Falta: ${f.faltan.join('; ')}.`
      : 'Bóveda completa. Todas las cajas con clave.';
    return out(decir);
  }

  if (p.accion === 'voz') {
    tools.push('voz');
    const r = await conPermiso('voz_estado', {}, ctx);
    hechos.push(`VOZ TELEGRAM: ${r.texto}`);
    return out(r.texto);
  }

  if (p.accion === 'urgente') {
    tools.push('urgente');
    const r = await conPermiso('urgente', { texto: extraerCuerpo(p.texto) || 'AU-RA te necesita. Es urgente.' }, ctx);
    hechos.push(`URGENTE TELEGRAM: ${r.texto}`);
    hechos.push('El bot de Telegram no hace llamada de teléfono. Llamada real = Twilio (caja llamada).');
    return out(r.texto);
  }

  if (p.accion === 'redeploy') {
    tools.push('redeploy');
    const r = await conPermiso('redeploy', {}, ctx);
    hechos.push(`REDEPLOY MESA: ${r.texto}`);
    return out(r.texto);
  }

  if (p.accion === 'listar') {
    tools.push('tareas');
    const r = resumenTareas();
    hechos.push(r);
    const abiertas = r.startsWith('TAREAS ABIERTAS') ? r.replace(/^TAREAS ABIERTAS[^:]*:\n?/, '').replace(/\n/g, '; ') : r;
    return out(abiertas.slice(0, 280));
  }

  if (p.accion === 'tarea') {
    tools.push('tareas');
    const r = await conPermiso('tarea_anotar', { texto: p.texto, usuario: opts?.usuario || null }, ctx);
    hechos.push(r.ok ? `${r.texto}. ${resumenTareas()}` : r.texto);
    return out(r.ok ? `Anotado: ${p.texto}` : r.texto);
  }

  if (p.accion === 'hecho') {
    tools.push('tareas');
    const r = await conPermiso('tarea_cerrar', { id: p.texto }, ctx);
    hechos.push(r.texto);
    return out(r.ok ? r.texto.replace(/^TAREA CERRADA \[[^\]]+\]: /, 'Cerrada: ') : r.decision ? r.texto : 'No encontré esa tarea.');
  }

  if (p.accion === 'llamar') {
    tools.push('llamada');
    const r = await conPermiso('llamada', { texto: extraerCuerpo(p.texto) || 'Hola, te llama AU-RA.' }, ctx);
    hechos.push(`LLAMADA: ${r.texto}`);
    return out(r.texto);
  }

  const quierePdf = /\bpdf\b/i.test(message) || p.accion === 'pdf';
  const cuerpo = extraerCuerpo(p.texto) || `Nota de AU-RA · ${new Date().toISOString()}`;

  if (p.accion === 'enviar' || (p.accion === 'pdf' && p.canal)) {
    const canal = p.canal;
    if (!canal) {
      hechos.push('ENVÍO: no supe el canal. Di telegram, whatsapp o correo.');
      tools.push('enviar');
      return out('No supe el canal. Di telegram, WhatsApp o correo.');
    }
    if (quierePdf) tools.push('pdf');
    tools.push(canal);
    const r = await conPermiso('enviar', { canal, texto: cuerpo, pdf: quierePdf }, ctx);
    hechos.push(r.texto);
    return out(r.texto.replace(/^(TELEGRAM|WHATSAPP|CORREO): /, ''));
  }

  if (quierePdf) {
    // Un PDF que se queda aquí no sale del sistema: no pasa por las reglas de envío.
    tools.push('pdf');
    const made = hacerPdf('AU-RA', cuerpo);
    hechos.push(`PDF generado (${made.bytes} bytes, id ${made.id}).`);
    return out(`PDF listo, ${made.id}. Dime si lo mando por Telegram, WhatsApp o correo.`);
  }
  return out();
}

export function hechosCatalogo(): string {
  const c = catalogoCanales();
  const listos = c.filter((x) => x.listo).map((x) => x.nombre);
  const no = c.filter((x) => !x.listo).map((x) => `${x.nombre}: falta ${x.falta}`);
  return `TALLER: listos [${listos.join(', ')}]. Sin clave (no los ofrezcas como hechos): ${no.join('; ') || 'ninguno'}.`;
}
