/**
 * Taller de ULTRON: despacha tareas reales (sistema, PDF, canales, pendientes).
 * Si el canal no está configurado, el HECHO dice que falta la clave. No se finge el envío.
 */

import { canales, hacerPdf, leerPdf } from './canales';
import { catalogoCanales, fotoSistema, redesplegarMesa } from './sistema';
import { agregarTarea, marcarTarea, resumenTareas } from './tareas';

export type TallerOut = { hechos: string[]; tools: string[]; decir?: string };

function publicBase() {
  return (process.env.PUBLIC_BASE || process.env.RENDER_EXTERNAL_URL || '').replace(/\/$/, '');
}

export function parsePedido(raw: string): {
  accion: 'sistema' | 'mantenimiento' | 'redeploy' | 'tarea' | 'listar' | 'hecho' | 'pdf' | 'enviar' | 'llamar' | null;
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
  if (/\b(redeploy|redespleg|reinicia(r)? la mesa|nuevo deploy)\b/.test(l)) return { accion: 'redeploy', canal, texto: q };
  if (/\b(mantenimiento|repara|arregla|diagnostico|diagnóstico)\b/.test(l)) return { accion: 'mantenimiento', canal, texto: q };
  if (/\b(como esta|cómo está|estado del sistema|los nodos|salud del sistema|que nodos)\b/.test(l) || /^(status|salud)\b/.test(l)) {
    return { accion: 'sistema', canal, texto: q };
  }
  // Envío gana a "llamada": el cuerpo de un PDF/Telegram puede listar canales pendientes.
  if (/\b(envia|envía|manda|mandale|mandame|mándame)\b/.test(l) || (canal && /\bpdf\b/.test(l))) {
    return { accion: 'enviar', canal, texto: q };
  }
  if (/\b(haz un pdf|genera(?:r)? (un )?pdf|pdf de)\b/.test(l)) return { accion: 'pdf', canal, texto: q };
  if (/\b(llama(?:me)?|ll[aá]mame|haz una llamada|hacer una llamada|call me)\b/.test(l)) {
    return { accion: 'llamar', canal, texto: q };
  }
  if (/\b(pendientes|tareas|lista de tareas)\b/.test(l) && !/\b(anota|agrega|apunta|recuerda)\b/.test(l)) {
    return { accion: 'listar', canal, texto: q };
  }
  const mHecho = l.match(/\b(tarea|pendiente)\s+([a-z0-9]+)\s+(hecha|listo|cerrada)\b/);
  if (mHecho) return { accion: 'hecho', canal, texto: mHecho[2] };
  const mAdd = q.match(/\b(?:anota|apunta|agrega|recu[eé]dame|nueva tarea)(?:\s+(?:que|esto))?\s*[:\-]?\s*(.+)$/i);
  if (mAdd && mAdd[1].trim().length > 2) return { accion: 'tarea', canal, texto: mAdd[1].trim() };
  return { accion: null, canal, texto: q };
}

function extraerCuerpo(q: string) {
  return q
    .replace(/^(env[ií]a|manda|m[aá]ndame|mandale|haz un pdf|genera(r)? (un )?pdf|pdf de|por telegram|por whatsapp|por correo|ll[aá]mame[,:]?)\s*/i, '')
    .replace(/\b(por|a|al|en)\s+(telegram|whatsapp|wsp|correo|email|gmail)\b/gi, '')
    .replace(/\b(un )?pdf\b/gi, '')
    .trim();
}

export async function despacharTaller(message: string, opts?: { usuario?: string }): Promise<TallerOut> {
  const p = parsePedido(message);
  if (!p.accion) return { hechos: [], tools: [] };
  const tools: string[] = [];
  const hechos: string[] = [];
  const out = (decir?: string): TallerOut => ({ hechos, tools, decir });

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

  if (p.accion === 'redeploy') {
    tools.push('redeploy');
    const r = await redesplegarMesa();
    hechos.push(`REDEPLOY MESA: ${r.detalle}`);
    return out(r.detalle);
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
    const t = agregarTarea(p.texto, opts?.usuario);
    hechos.push(`TAREA ANOTADA [${t.id}]: ${t.texto}. ${resumenTareas()}`);
    return out(`Anotado: ${t.texto}`);
  }

  if (p.accion === 'hecho') {
    tools.push('tareas');
    const t = marcarTarea(p.texto, true);
    hechos.push(t ? `TAREA CERRADA [${t.id}]: ${t.texto}` : `No encontré la tarea ${p.texto}.`);
    return out(t ? `Cerrada: ${t.texto}` : `No encontré esa tarea.`);
  }

  if (p.accion === 'llamar') {
    tools.push('llamada');
    const dicho = extraerCuerpo(p.texto) || 'Hola, te llama ULTRON.';
    const r = await canales.llamada(dicho);
    hechos.push(`LLAMADA: ${r.detalle}`);
    return out(r.detalle);
  }

  const quierePdf = /\bpdf\b/i.test(message) || p.accion === 'pdf';
  const cuerpo = extraerCuerpo(p.texto) || `Nota de ULTRON · ${new Date().toISOString()}`;
  let pdf: { id: string; buf: Buffer; filename: string } | undefined;
  if (quierePdf || p.accion === 'pdf') {
    tools.push('pdf');
    const made = hacerPdf('ULTRON', cuerpo);
    const buf = leerPdf(made.id);
    if (buf) pdf = { id: made.id, buf, filename: made.id };
    hechos.push(`PDF generado (${made.bytes} bytes, id ${made.id}).`);
  }

  if (p.accion === 'enviar' || (p.accion === 'pdf' && p.canal)) {
    const canal = p.canal;
    if (!canal) {
      hechos.push('ENVÍO: no supe el canal. Di telegram, whatsapp o correo.');
      tools.push('enviar');
      return out('No supe el canal. Di telegram, WhatsApp o correo.');
    }
    tools.push(canal);
    if (canal === 'telegram') {
      const r = await canales.telegram({ texto: cuerpo, pdf });
      hechos.push(`TELEGRAM: ${r.detalle}`);
      return out(r.detalle);
    }
    if (canal === 'whatsapp') {
      const base = publicBase();
      const media = pdf && base ? `${base}/api/taller/archivo/${pdf.id}` : undefined;
      if (pdf && !media) hechos.push('WHATSAPP: el PDF existe pero falta PUBLIC_BASE para adjuntarlo. Envío solo texto.');
      const r = await canales.whatsapp(cuerpo, media);
      hechos.push(`WHATSAPP: ${r.detalle}`);
      return out(r.detalle);
    }
    const r = await canales.correo({
      asunto: quierePdf ? 'PDF de ULTRON' : cuerpo.slice(0, 80),
      texto: cuerpo,
      pdf: pdf ? { filename: pdf.filename, buf: pdf.buf } : undefined,
    });
    hechos.push(`CORREO: ${r.detalle}`);
    return out(r.detalle);
  }

  if (pdf) return out(`PDF listo, ${pdf.id}. Dime si lo mando por Telegram, WhatsApp o correo.`);
  return out();
}

export function hechosCatalogo(): string {
  const c = catalogoCanales();
  const listos = c.filter((x) => x.listo).map((x) => x.nombre);
  const no = c.filter((x) => !x.listo).map((x) => `${x.nombre}: falta ${x.falta}`);
  return `TALLER: listos [${listos.join(', ')}]. Sin clave (no los ofrezcas como hechos): ${no.join('; ') || 'ninguno'}.`;
}
