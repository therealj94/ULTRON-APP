/**
 * AVISOS DE MENSAJES IMPORTANTES (auditoría del 7-oct, A-6: «hoy es un contador cada 30 minutos»). Cuando le llega un
 * WhatsApp (el puente avisa al instante: servicios/whatsapp-puente/aviso.go → POST /api/whatsapp/aviso) o un correo (la
 * vuelta de cada 30 minutos, la misma cadencia de la iniciativa), se decide si es IMPORTANTE y, si lo es, le llega un
 * aviso al teléfono (FCM, tipo `mensaje-externo`, lib/push.ts) con UNA línea de resumen y una respuesta sugerida. Al
 * tocarlo, la app abre ese chat con la sugerencia como borrador en la caja de texto: nada sale sin su toque.
 *
 * Qué es importante (triarMensaje), de lo más fuerte a lo más débil:
 *   · uno de sus VIP (lib/contactos-vip.ts, los que marcó ella) o alguien de su círculo (lib/circulo.ts);
 *   · lo que el triaje de siempre (lib/triaje.ts `clasificar`: reglas de urgencia, dinero, trabajo, publicidad, grupos, y
 *     Laya «mensaje» si está) llama «urgente», o «importante» con puntaje alto (una pregunta suelta no basta);
 *   · nunca publicidad ni lo que Laya ve como estafa (salvo que sea un VIP).
 *
 * Cuándo SALE el aviso (decidirEnvio; con sus avisos apagados en Ajustes, nunca):
 *   · horas quietas 22:00–07:00 de Honduras: nada, salvo un VIP con algo urgente;
 *   · un aviso por chat cada 10 minutos (una ráfaga no son diez avisos);
 *   · hasta 6 por hora en total (los urgentes tienen su propio tope, 12).
 *   · el mismo mensaje una sola vez (lib/envios.ts primeraVezEvento, también entre réplicas).
 *   · «llámame» (tanda F2, lib/iniciativa-dia.ts): un urgente de un VIP llega como LLAMADA de AU-RA si lo eligió en
 *     Ajustes → Iniciativa, fuera de sus horas quietas y si hoy no dijo «no me molestes»; si la llamada no sale, el aviso.
 *
 * Privacidad: solo se avisa a la persona dueña de ESA cuenta (el puente dice la cuenta; lib/duenos-cuenta-wa.ts dice qué
 * correos la usaron y aquí se vuelve a comprobar que la clave de cada correo es esa); solo si su sesión puede usar su
 * WhatsApp (server/whatsapp.ts whatsappPermitido, que también mira la suspensión). El aviso lleva una línea del mensaje
 * (visibilidad privada en la pantalla bloqueada, mobile/src/push/logica.ts) y nada se guarda.
 */
import crypto from 'node:crypto';
import { clasificar, sugerenciaPorPlantilla, type ConversacionTriaje, type Importancia } from './triaje';
import { vipDe, vipsDe, type ContactoVip } from './contactos-vip';
import { enQuietas, ZONA_POR_OMISION, type Quietas } from './zona-horaria';
import type { MiembroCirculo } from './circulo';
import type { DatosPush, ResultadoPush } from './push';

/* ------------------------------------------------------------------ qué es importante */

export type EventoMensaje = {
  canal: 'whatsapp' | 'correo';
  /** El id del mensaje (WhatsApp) o la ref del correo («<cuenta>:<uid>»). */
  id: string;
  /** El chat (jid) o la ref del correo: lo que abre la app al tocar el aviso. */
  chat: string;
  /** Quién lo mandó, como se le dice. */
  nombre: string;
  numero?: string;
  correoDe?: string;
  grupo: boolean;
  /** El nombre del grupo (si es de un grupo). */
  nombreChat?: string;
  hora: number;
  /** texto | imagen | audio | documento | … (WhatsApp). */
  tipo?: string;
  texto: string;
  asunto?: string;
  archivo?: string;
  duracion?: number;
};

export type TriajeMensaje = {
  avisar: boolean;
  urgente: boolean;
  vip: ContactoVip | null;
  importancia: Importancia;
  puntaje: number;
  /** Por qué es importante (para la persona y el registro). */
  motivo: string;
  /** El título del aviso («WhatsApp · Ana», «Urgente · Correo · Banco»). */
  titulo: string;
  /** UNA línea: quién y qué dijo. */
  resumen: string;
  /** Una respuesta corta sugerida (borrador; '' si no conviene sugerir, p. ej. una posible estafa). */
  sugerencia: string;
};

/** Lo que pide algo más que puntos para avisar a quien no es VIP ni del círculo. */
export const PUNTAJE_AVISO = 5.5;
const URGENTE = /\b(urgente|emergencia|ya mismo|ahorita mismo|lo antes posible|asap|hospital|accidente|ll[aá]mame|cont[eé]stame|me urge|es grave|ayuda por favor|auxilio)\b/i;

const plegar = (s: string) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** El principio de un texto en una línea, cortado en una palabra. */
export function unaLinea(texto: string, max = 110): string {
  const t = String(texto || '').replace(/\s+/g, ' ').trim();
  return t.length <= max ? t : `${t.slice(0, max - 1).replace(/\s+\S*$/, '')}…`;
}

/** Lo que dice un mensaje sin texto (una nota de voz, una foto…). */
function queMando(ev: EventoMensaje): string {
  const t = String(ev.tipo || 'texto');
  if (t === 'audio') return `te mandó una nota de voz${ev.duracion ? ` (${ev.duracion} s)` : ''}`;
  if (t === 'imagen') return 'te mandó una foto';
  if (t === 'video') return 'te mandó un video';
  if (t === 'documento') return `te mandó un documento${ev.archivo ? ` («${unaLinea(ev.archivo, 60)}»)` : ''}`;
  if (t === 'ubicacion') return 'te mandó una ubicación';
  if (t === 'contacto') return 'te mandó un contacto';
  return 'te escribió';
}

/**
 * ¿Es importante? Determinista (lo mismo entra, lo mismo sale): las reglas del triaje de siempre, la lista VIP, el
 * círculo y lo que diga Laya (si contestó).
 */
export function triarMensaje(ev: EventoMensaje, o: { vips?: readonly ContactoVip[]; circulo?: MiembroCirculo[]; laya?: Record<string, number> | null; ahora?: number } = {}): TriajeMensaje {
  const ahora = o.ahora ?? Date.now();
  const texto = String(ev.texto || '');
  const conv: ConversacionTriaje = {
    canal: ev.canal,
    id: ev.chat,
    nombre: ev.grupo ? ev.nombreChat || ev.nombre : ev.nombre,
    grupo: ev.grupo,
    noLeidos: 1,
    hora: ev.hora || ahora,
    ultimo: texto || `[${ev.tipo || 'mensaje'}]`,
    ultimoMio: false,
    ...(ev.numero ? { numero: ev.numero } : {}),
    ...(ev.correoDe ? { deCorreo: ev.correoDe } : {}),
    ...(ev.asunto ? { asunto: ev.asunto } : {}),
    mensajes: [{ mio: false, texto: texto || `[${ev.tipo || 'mensaje'}]`, hora: ev.hora || ahora, de: ev.nombre }],
  };
  const c = clasificar(conv, { circulo: o.circulo, laya: o.laya ?? null, ahora });
  const vip = vipDe(o.vips || [], { nombre: ev.nombre, numero: ev.numero, correo: ev.correoDe });
  const delCirculo = !!c.circulo;
  const estafa = c.intenciones.includes('estafa');
  const publicidad = c.intenciones.includes('publicidad');
  const senalUrgente = URGENTE.test(plegar(`${ev.asunto || ''} ${texto}`)) || (o.laya?.urgente ?? 0) > 0.6 || (o.laya?.crisis ?? 0) > 0.6;
  const importantePorReglas = c.importancia === 'urgente' || (c.importancia === 'importante' && c.puntaje >= PUNTAJE_AVISO);
  // «Urgente» lo dice el mensaje (o Laya), no quién lo manda: un «ya llegué» de su esposa es importante, no urgente.
  const urgente = senalUrgente && (!!vip || delCirculo || importantePorReglas);
  const avisar = !!vip || ((delCirculo || importantePorReglas) && !estafa && !publicidad);
  const motivos = [vip ? 'es de tus VIP' : '', ...c.motivos].filter(Boolean);
  const quien = ev.grupo ? `${ev.nombre} en «${ev.nombreChat || 'un grupo'}»` : ev.nombre || ev.numero || ev.correoDe || 'Alguien';
  const dicho = ev.canal === 'correo' ? `«${unaLinea(ev.asunto || '(sin asunto)', 70)}»${texto ? ` — ${unaLinea(texto, 70)}` : ''}` : texto ? `«${unaLinea(texto)}»` : queMando(ev);
  const resumen = `${quien}: ${dicho}`;
  const canal = ev.canal === 'whatsapp' ? 'WhatsApp' : 'Correo';
  const titulo = `${urgente ? 'Urgente · ' : ''}${canal} · ${unaLinea(ev.grupo ? ev.nombreChat || ev.nombre : ev.nombre || ev.numero || ev.correoDe || '', 40)}`;
  return {
    avisar,
    urgente,
    vip,
    importancia: c.importancia,
    puntaje: c.puntaje,
    motivo: motivos.slice(0, 3).join(', ') || (avisar ? 'parece importante' : 'no parece importante'),
    titulo,
    resumen,
    sugerencia: estafa ? '' : sugerenciaPorPlantilla(c),
  };
}

/* ------------------------------------------------------------------ cuándo sale (horas quietas y tope) */

export const QUIETAS_ALERTAS: Quietas = { desde: '22:00', hasta: '07:00' };
export const TOPES_ALERTAS = { porHora: 6, urgentesPorHora: 12, porChatMs: 10 * 60_000, urgenteVipPorChatMs: 2 * 60_000 };

const ENVIADAS = new Map<string, { t: number; urgente: boolean }[]>();
const POR_CHAT = new Map<string, number>();

export type Decision = { enviar: true } | { enviar: false; porque: 'quietas' | 'chat' | 'hora' };

/**
 * ¿Sale el aviso ahora? Horas quietas (22:00–07:00 de Honduras) salvo un VIP con algo urgente; uno por chat cada 10
 * minutos (2 para un VIP urgente); 6 por hora (12 si son urgentes). Si sale, lo cuenta.
 */
export function decidirEnvio(correo: string, chat: string, t: { urgente: boolean; vip: boolean }, ahora = Date.now(), zona = ZONA_POR_OMISION): Decision {
  const quien = String(correo || '').trim().toLowerCase();
  const urgenteVip = t.urgente && t.vip;
  if (enQuietas(ahora, zona, QUIETAS_ALERTAS) && !urgenteVip) return { enviar: false, porque: 'quietas' };
  const kChat = `${quien}|${String(chat || '').toLowerCase()}`;
  const ultimo = POR_CHAT.get(kChat) || 0;
  if (ahora - ultimo < (urgenteVip ? TOPES_ALERTAS.urgenteVipPorChatMs : TOPES_ALERTAS.porChatMs)) return { enviar: false, porque: 'chat' };
  const hora = (ENVIADAS.get(quien) || []).filter((x) => ahora - x.t < 3_600_000);
  const tope = t.urgente ? TOPES_ALERTAS.urgentesPorHora : TOPES_ALERTAS.porHora;
  const contados = t.urgente ? hora.length : hora.filter((x) => !x.urgente).length;
  if (contados >= tope) {
    ENVIADAS.set(quien, hora);
    return { enviar: false, porque: 'hora' };
  }
  hora.push({ t: ahora, urgente: t.urgente });
  ENVIADAS.set(quien, hora);
  POR_CHAT.set(kChat, ahora);
  if (POR_CHAT.size > 20_000) for (const k of [...POR_CHAT.keys()].slice(0, 5000)) POR_CHAT.delete(k);
  return { enviar: true };
}

/* ------------------------------------------------------------------ el aviso */

/** Lo que va en el aviso (solo texto, lo arma lib/push.ts). El id sale del mensaje: el mismo mensaje, el mismo aviso. */
export function datosDelAviso(ev: EventoMensaje, t: TriajeMensaje): DatosPush {
  const id = `mx${crypto.createHash('sha256').update(`${ev.canal}|${ev.chat}|${ev.id}`).digest('hex').slice(0, 24)}`;
  return {
    tipo: 'mensaje-externo',
    id,
    canal: ev.canal,
    titulo: t.titulo,
    texto: t.resumen,
    sugerencia: t.sugerencia,
    chat: ev.chat,
    nombre: ev.grupo ? ev.nombreChat || ev.nombre : ev.nombre,
    motivo: t.motivo,
    urgente: t.urgente ? '1' : '',
    abrir: ev.canal === 'whatsapp' ? 'whatsapp' : 'correos',
  };
}

/** Lo que hace falta de afuera (las pruebas ponen otros). */
export type DepsAlertas = {
  vips: (correo: string) => Promise<ContactoVip[]>;
  circulo: (correo: string) => Promise<MiembroCirculo[]>;
  laya: (texto: string) => Promise<Record<string, number> | null>;
  push: (correo: string, datos: DatosPush) => Promise<Pick<ResultadoPush, 'enviados' | 'entrega'>>;
  /** El mismo mensaje una sola vez (por fuente, persona e id). */
  primeraVez: (fuente: string, correo: string, id: string) => Promise<boolean>;
  /** Apagó sus avisos en Ajustes (lib/avisos.ts): nada empuja. */
  apagado: (correo: string) => Promise<boolean>;
  /**
   * Eligió «llámame» para un urgente de un VIP (lib/iniciativa-dia.ts quiereLlamadaVip: con la iniciativa encendida, fuera
   * de sus horas quietas y si hoy no dijo «no me molestes»). Ante la duda, no.
   */
  quiereLlamada: (correo: string, ahora: number) => Promise<boolean>;
  /** La llamada de AU-RA de siempre (lib/push.ts llamarPorPush). */
  llamar: (correo: string, o: { motivo: string; id: string }) => Promise<Pick<ResultadoPush, 'enviados' | 'entrega'>>;
  ahora: () => number;
};

const DEPS_REALES: DepsAlertas = {
  vips: async (c) => {
    const r = await vipsDe(c);
    return r.ok ? r.contactos : [];
  },
  circulo: async (c) => (await import('./circulo')).circuloDe(c).catch(() => []),
  laya: async (texto) => {
    const { consultarModelo } = await import('./laya');
    const r = await consultarModelo('mensaje', texto, { esperaMs: 1500, preguntas: ['urgente', 'spam', 'estafa', 'mueve_valor', 'crisis'] }).catch(() => null);
    return r?.resultado?.p || null;
  },
  push: async (c, d) => (await import('./push')).enviarPush(c, d),
  primeraVez: async (f, c, id) => (await import('./envios')).primeraVezEvento(f, c, id),
  apagado: async (c) => (await (await import('./avisos')).preferenciasDe(c)).apagado === true,
  quiereLlamada: async (c, ahora) => (await import('./iniciativa-dia')).quiereLlamadaVip(c, ahora),
  llamar: async (c, o) => (await import('./push')).llamarPorPush(c, o),
  ahora: () => Date.now(),
};
let depsAlertas: DepsAlertas = DEPS_REALES;
/** Solo pruebas: otras dependencias (`null` vuelve a las de verdad). */
export function _alertasDePrueba(d: Partial<DepsAlertas> | null) {
  depsAlertas = d ? { ...DEPS_REALES, ...d } : DEPS_REALES;
}

export type ResultadoAlerta = { correo: string; avisado: boolean; porque: string; triaje?: TriajeMensaje };

/**
 * Un mensaje nuevo para una persona: triaje, decisión y aviso. Nunca lanza. `fuente`: para no avisar dos veces el mismo
 * (`wa-alerta`, `correo-alerta`).
 */
export async function alertarSiImporta(correo: string, ev: EventoMensaje, fuente: string): Promise<ResultadoAlerta> {
  const d = depsAlertas;
  try {
    if (await d.apagado(correo).catch(() => false)) return { correo, avisado: false, porque: 'avisos apagados' };
    const [vips, circulo] = await Promise.all([d.vips(correo).catch(() => []), d.circulo(correo).catch(() => [])]);
    const textoLaya = [ev.asunto, ev.texto].filter(Boolean).join('. ');
    // Laya solo si el texto dice algo (y sin esperar más de 1,5 s); sin Laya, las reglas de siempre.
    const laya = textoLaya.length >= 8 ? await d.laya(textoLaya).catch(() => null) : null;
    const t = triarMensaje(ev, { vips, circulo, laya, ahora: d.ahora() });
    if (!t.avisar) return { correo, avisado: false, porque: `no importante (${t.importancia}, ${t.puntaje})`, triaje: t };
    // El mismo mensaje una sola vez (el puente reintenta; dos réplicas pueden recibir el mismo correo).
    if (!(await d.primeraVez(fuente, correo, `${ev.canal}:${ev.id}`).catch(() => false))) return { correo, avisado: false, porque: 'repetido', triaje: t };
    const dec = decidirEnvio(correo, `${ev.canal}:${ev.chat}`, { urgente: t.urgente, vip: !!t.vip }, d.ahora());
    if (dec.enviar === false) return { correo, avisado: false, porque: dec.porque, triaje: t };
    const datos = datosDelAviso(ev, t);
    // «Llámame» (tanda F2): un urgente de un VIP, si lo eligió y no son sus horas quietas. Si la llamada no sale, el aviso.
    if (t.urgente && t.vip && (await d.quiereLlamada(correo, d.ahora()).catch(() => false))) {
      const l = await d.llamar(correo, { motivo: unaLinea(`${t.titulo}. ${t.resumen}`, 280), id: String(datos.id) }).catch(() => ({ enviados: 0, entrega: 'fallido' as const }));
      if (l.enviados > 0) return { correo, avisado: true, porque: `llamada ${l.entrega}`, triaje: t };
    }
    const r = await d.push(correo, datos);
    // Firebase solo dice que lo ACEPTÓ (AUR13): «aceptado», nunca «lo vio».
    return { correo, avisado: r.enviados > 0, porque: r.entrega, triaje: t };
  } catch (e: any) {
    return { correo, avisado: false, porque: `error: ${String(e?.message || e).slice(0, 80)}` };
  }
}

/** Pruebas: olvida los topes. */
export function _olvidarAlertas() {
  ENVIADAS.clear();
  POR_CHAT.clear();
}
