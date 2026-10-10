/**
 * NUNCA DECIR QUE SE HIZO ALGO QUE NO SE HIZO — la guarda de AU-RA (lib/honestidad.ts), con los recibos de Dr Electrum.
 *
 * La de AU-RA sabe de WhatsApp, correos, recordatorios y llamadas: sus recibos salen del puente, del SMTP y del
 * teléfono. Electrum no tiene nada de eso; lo que él HACE es otra cosa, y también puede afirmarlo sin haberlo hecho:
 *
 *   «Te generé el informe»            → solo si `informe_pdf` (o el mapa geológico) dejó el PDF en este turno;
 *   «Lo puse en el mapa»              → solo si salió una orden para el mapa (volar, capa, candidatas, la garantía);
 *   «Guardé el expediente / la ficha» → solo si una herramienta que escribe (entidad_*) terminó bien;
 *   «Te mandé la alerta»              → nunca en un turno: ninguna de sus herramientas programa ni manda avisos.
 *
 * Lo demás (enviado, agendado, llamé, «ya quedó») lo detecta la guarda de AU-RA (`afirmacionesDeHecho`), sin lo negado,
 * lo citado, lo referido ni las preguntas. Lo que no tiene recibo se cambia por la verdad, en su lugar y con la voz del
 * doctor. Como la de AU-RA, es CONSERVADORA: «ya quedó» después de una consulta del catastro no se toca (cualquier
 * herramienta que terminó bien lo respalda), y lo que la frase misma sitúa antes («hace rato», «ayer») tampoco.
 * Determinista, sin red ni modelo.
 */
import { afirmacionesDeHecho } from '../../lib/honestidad';
import { esDeAntes, frasesConCitas, sinLoQueNoAfirma } from '../../lib/cerebro-manos';
import { plano } from '../../lib/promesas';

/** Lo que de verdad pasó en un turno de Electrum. `lectura`: una herramienta terminó bien (no dejó nada). */
export type ReciboElectrum = { clase: 'informe' | 'mapa' | 'guardado' | 'lectura'; t?: number };
export type ClaseAfirmacion = 'informe' | 'mapa' | 'alerta' | 'envio' | 'guardado' | 'llamada' | 'generico';

/** Las herramientas de Electrum que escriben (lib/manos/memoria.ts). */
const ESCRIBEN = new Set(['entidad_registrar', 'entidad_relacionar', 'entidad_evento']);
/** Las órdenes que mueven el mapa (manos.ts y las garantías). */
const ORDENES_MAPA = new Set(['volar', 'capa', 'candidatas', 'filtrar', 'resaltar', 'geologia', 'indice', 'comando']);

/** Los recibos de este turno: los pasos que terminaron bien y lo que llegó a la pantalla. */
export function recibosElectrum(traza: ReadonlyArray<{ herramienta: string; ok: boolean }>, ui: ReadonlyArray<Record<string, unknown>> = []): ReciboElectrum[] {
  const out: ReciboElectrum[] = [];
  const poner = (clase: ReciboElectrum['clase']) => {
    if (!out.some((r) => r.clase === clase)) out.push({ clase });
  };
  for (const t of traza) {
    if (!t?.ok) continue;
    if (t.herramienta === 'informe_pdf' || t.herramienta === 'mapa_geologico') poner('informe');
    if (t.herramienta === 'mapa_geologico' || t.herramienta === 'mapa_garantia' || t.herramienta === 'mapas_geo_garantia' || t.herramienta === 'mapa_volar' || t.herramienta === 'mapa_capa' || t.herramienta === 'encender_capa' || t.herramienta === 'aplicar_filtro' || t.herramienta === 'acercar_a') poner('mapa');
    if (ESCRIBEN.has(t.herramienta)) poner('guardado');
    poner('lectura');
  }
  for (const u of ui) {
    if (!u || typeof u !== 'object') continue;
    const informe = (u as any).informe;
    if (informe && typeof informe === 'object') poner('informe');
    if (ORDENES_MAPA.has(String((u as any).accion || '')) || (u as any).geojson || (u as any).encuadre) poner('mapa');
  }
  return out;
}

/* ------------------------------------------------------------------ lo que da por hecho */

/*
 * Lo que el doctor dice que HIZO, en primera persona, o el participio que abre la cláusula («Listo, el informe quedó
 * armado»). «El informe generado por INHGEOMIN en 2019 dice…» o «saqué del informe de JICA que…» leen un dato: no.
 */
const INFORME = [
  /\b(genere|arme|prepare|redacte|adjunte|elabore|hice|te deje|le deje)\b (?:[\wñ]+ ){0,3}(informe|reporte|pdf|ficha tecnica)\b/,
  // «El informe ya quedó listo», o el participio que cierra la cláusula («Listo, informe generado.»).
  /(?:^|[,;:]\s*)\s*(?:listo,? |ya |bueno,? )?(?:el |tu |su )?(?:informe|reporte|pdf) (?:ya )?(?:esta|quedo|queda) (?:listo|generado|armado|preparado|adjunto)\b/,
  /(?:^|[,;:]\s*)\s*(?:listo,? |ya |bueno,? )?(?:el |tu |su )?(?:informe|reporte|pdf) (?:listo|generado|armado|preparado|adjunto)\s*(?:$|[.,;:!])/,
  /\bahi (tenes|tiene|tienes|esta|va|te va|le va) (el |tu |su )?(informe|reporte|pdf)\b/,
  /\bi(?:'ve| have)? (just |already )?(generated|prepared|created|attached|made) (the |your |a )?(report|pdf)\b/,
  /\b(the |your )?(report|pdf) is (ready|attached|done)\b/,
];
const MAPA = [
  /\b(te |se )?(lo |la |los |las )?(puse|marque|resalte|dibuje|pinte|ubique|mostre|cargue|deje)\b[^.?!]{0,30}\b(en|sobre) (el |tu |su )?mapa\b/,
  /\bya (esta|estan|quedo|quedaron) (en|sobre) el mapa\b/,
  /\bi(?:'ve| have)? (just |already )?(put|marked|highlighted|plotted|drew|loaded) (it|them|the \w+) on the map\b/,
];
const ALERTA = [
  /\b(te |le |les |se )?(lo |la )?(mande|envie|puse|programe|active|cree|deje|configure)\b[^.?!]{0,25}\b(alerta|alertas|aviso|avisos|notificacion|notificaciones)\b/,
  /\b(alerta|aviso|notificacion)\b[^.?!]{0,20}\b(enviada|mandada|activada|programada|creada|puesta|configurada)\b/,
  /\bi(?:'ve| have)? (just |already )?(sent|set|created|scheduled|configured) (an |the |a |your )?(alert|notification)s?\b/,
];
const GUARDADO = [/\b(te |lo |la )?(guarde|registre|anote|agregue|subi|cargue|archive)\b[^.?!]{0,30}\b(expediente|ficha|memoria|cerebro|catastro|base|carpeta)\b/];

const hay = (res: RegExp[], s: string) => res.some((r) => r.test(s));
/** Lo que nombra que algo SALIÓ hacia alguien (para no tomar «como le dije» por un envío). */
const SALIDA = /\b(mand|envi|reenvi|despach|correo|mail|whatsapp|wasap|telegram|mensaje|sms|sent|send|emailed|texted)\w*/;

export type AfirmacionElectrum = { frase: string; clase: ClaseAfirmacion };

/** Las frases que dan por HECHO algo, con su clase (fuera de lo citado, lo negado, lo referido y las preguntas). */
export function afirmacionesElectrum(texto: string, contexto: { mensaje?: string } = {}): AfirmacionElectrum[] {
  const out: AfirmacionElectrum[] = [];
  for (const l of String(texto || '').split('\n')) {
    for (const f of frasesConCitas(l)) {
      const propia = f.propia;
      if (!propia.trim() || /[¿?]/.test(propia) || esDeAntes(propia)) continue;
      const s = sinLoQueNoAfirma(plano(propia));
      let clase: ClaseAfirmacion | null = hay(INFORME, s) ? 'informe' : hay(MAPA, s) ? 'mapa' : hay(ALERTA, s) ? 'alerta' : hay(GUARDADO, s) ? 'guardado' : null;
      if (!clase) {
        // Lo de AU-RA (enviado, agendado, llamé, «ya quedó»), frase por frase. Su «le dije» / «le avisé» es a un
        // tercero; el doctor trata de usted, y «como le dije» es a quien tiene enfrente: un envío solo si se nombra
        // qué salió o por dónde.
        const a = afirmacionesDeHecho(f.texto, { mensaje: contexto.mensaje })[0];
        if (a && !(a.clase === 'envio' && !SALIDA.test(s))) clase = a.clase === 'recordatorio' ? 'alerta' : a.clase === 'app' ? 'generico' : a.clase;
      }
      if (clase) out.push({ frase: f.texto, clase });
    }
  }
  return out;
}

/** ¿Este trozo da algo por hecho? (el stream lo retiene hasta la guarda del final). */
export function trozoAfirmaHechoElectrum(trozo: string): boolean {
  return afirmacionesElectrum(trozo).length > 0;
}

/* ------------------------------------------------------------------ los recibos de antes */

/** Cuánto vale un recibo de un turno anterior cuando la persona pregunta por él («¿ya generaste el informe?»). */
export const RECIBO_RECIENTE_MS = 20 * 60_000;
const RECIENTES = new Map<string, ReciboElectrum[]>();

/** Lo que de verdad hizo este turno, para no desmentirlo en el siguiente. Sin `quien`, no se guarda. */
export function anotarRecibosElectrum(quien: string | null | undefined, recibos: ReadonlyArray<ReciboElectrum>, ahora = Date.now()): void {
  const k = String(quien || '').trim().toLowerCase();
  const nuevos = recibos.filter((r) => r.clase !== 'lectura');
  if (!k || !nuevos.length) return;
  const xs = (RECIENTES.get(k) || []).filter((x) => ahora - (x.t ?? 0) <= RECIBO_RECIENTE_MS);
  RECIENTES.set(k, [...xs, ...nuevos.map((r) => ({ ...r, t: ahora }))].slice(-20));
  if (RECIENTES.size > 5_000) RECIENTES.delete(RECIENTES.keys().next().value as string);
}
export function recibosRecientesElectrum(quien: string | null | undefined, ahora = Date.now()): ReciboElectrum[] {
  const k = String(quien || '').trim().toLowerCase();
  return (RECIENTES.get(k) || []).filter((x) => ahora - (x.t ?? 0) <= RECIBO_RECIENTE_MS);
}
/** Pruebas. */
export function _olvidarRecibosElectrum() {
  RECIENTES.clear();
}

/* ------------------------------------------------------------------ la guarda */

function respalda(clase: ClaseAfirmacion, recibos: ReadonlyArray<ReciboElectrum>): boolean {
  const tiene = (c: ReciboElectrum['clase']) => recibos.some((r) => r.clase === c);
  switch (clase) {
    case 'informe':
      return tiene('informe');
    case 'mapa':
      return tiene('mapa');
    // El informe llega en la conversación (la pantalla o Telegram): eso es lo único que Electrum «manda».
    case 'envio':
      return tiene('informe');
    case 'guardado':
      return tiene('guardado') || tiene('informe');
    case 'alerta':
    case 'llamada':
      return false;
    default:
      return recibos.length > 0;
  }
}

/** La verdad, con la voz del doctor (nunca contiene una afirmación de hecho: la guarda es idempotente). */
function verdad(clase: ClaseAfirmacion, en: boolean): string {
  switch (clase) {
    case 'informe':
      return en ? "I haven't generated that report yet; ask me and I'll put it together." : 'Todavía no generé ese informe; si lo querés, pedímelo y lo armo.';
    case 'mapa':
      return en ? "It isn't on the map yet." : 'Todavía no está marcado en el mapa.';
    case 'alerta':
      return en ? "I haven't set any alert: I don't schedule or send alerts from this conversation." : 'No dejé ninguna alerta puesta: desde esta conversación no programo ni mando avisos.';
    case 'envio':
      return en ? "I haven't sent anything yet." : 'Todavía no mandé nada.';
    case 'guardado':
      return en ? "I haven't saved it yet." : 'Todavía no lo guardé.';
    case 'llamada':
      return en ? "I haven't called anyone." : 'No llamé a nadie.';
    default:
      return en ? "I haven't done that yet." : 'Todavía no lo hice.';
  }
}

export type ContextoHonestidadElectrum = {
  /** Los recibos de ESTE turno (`recibosElectrum`). */
  recibos: ReadonlyArray<ReciboElectrum>;
  /** Los de turnos anteriores (`recibosRecientesElectrum`): solo valen si la persona pregunta por lo hecho. */
  previos?: ReadonlyArray<ReciboElectrum>;
  mensaje?: string;
  idioma?: 'es' | 'en';
};

export type ResultadoHonestidadElectrum = { texto: string; cambiada: boolean; falsas: AfirmacionElectrum[] };

export function guardaHonestidadElectrum(texto: string, ctx: ContextoHonestidadElectrum): ResultadoHonestidadElectrum {
  const original = String(texto || '');
  const afirmaciones = afirmacionesElectrum(original, { mensaje: ctx.mensaje });
  if (!afirmaciones.length) return { texto: original, cambiada: false, falsas: [] };
  // Lo de antes respalda solo si la persona pregunta por eso («¿ya generaste el informe?»), no si pide hacerlo ahora.
  const pregunta = /[¿?]/.test(String(ctx.mensaje || ''));
  const recibos = pregunta ? [...ctx.recibos, ...(ctx.previos || [])] : ctx.recibos;
  const falsas = afirmaciones.filter((a) => !respalda(a.clase, recibos));
  if (!falsas.length) return { texto: original, cambiada: false, falsas: [] };
  const en = ctx.idioma === 'en';
  const dichas = new Set<string>();
  const nuevas = original.split('\n').map((l) => {
    const fs = frasesConCitas(l);
    if (!fs.some((f) => falsas.some((a) => a.frase === f.texto))) return l;
    const partes: string[] = [];
    for (const f of fs) {
      const a = falsas.find((x) => x.frase === f.texto);
      if (!a) {
        partes.push(f.texto.trim());
        continue;
      }
      const v = verdad(a.clase, en);
      if (!dichas.has(v)) {
        dichas.add(v);
        partes.push(v);
      }
    }
    return partes.filter(Boolean).join(' ');
  });
  const final = nuevas.join('\n').replace(/[ \t]{2,}/g, ' ').trim();
  return { texto: final, cambiada: final !== original.trim(), falsas };
}
