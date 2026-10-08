/**
 * LOS RECORDATORIOS DEL SERVIDOR, EN EL TELÉFONO (auditoría del 7-oct, A-3). La lógica pura: sin React Native ni notifee
 * (lo prueba node). El pegamento está en compa/recordatoriosSync.ts y la hoja en ajustes/Recordatorios.tsx.
 *
 * El servidor (lib/recordatorios-servidor.ts) guarda cada recordatorio con su repetición y su PRÓXIMA vez; el teléfono
 * sigue siendo el timbre: notifee pone la alarma de esa próxima vez, que suena aunque no haya red. La alarma de una vez de
 * un recordatorio del servidor se llama `<id>-<vez en base 36>` (`baseServidor`), así se sabe de cuál es y de qué vez.
 *
 * RECONCILIAR (al abrir la app y al llegar un push, `planReconciliar`):
 *   · cada recordatorio del servidor con su próxima vez por delante y sin su alarma → se pone (`poner`);
 *   · cada alarma del servidor que ya no corresponde (lo borraron, lo marcaron hecho, cambió la hora o el texto) → se
 *     quita (`quitar`). Solo si el servidor DIJO que no está (lo borrado) o tiene otra vez/otro texto: si el servidor no la
 *     conoce y no la borró (su guardado falló), se le sube (`subir`) en vez de quitarla;
 *   · las alarmas viejas del teléfono (de antes, sin servidor) se suben para que entren en la lista; cuando el servidor ya
 *     la tiene adoptada (`local`), la vieja se quita y queda la suya.
 * Las de otra persona no se ven aquí (recordatorios.ts listarRecordatorios ya filtra por dueño).
 *
 * EL PUSH DE ESA VEZ (`pushYaSonoAqui`): el servidor manda un aviso a la hora; si este teléfono tenía puesta la alarma de
 * ESA vez, ya sonó (o va a sonar) aquí: el aviso no se enseña (no suena dos veces) y solo sirve para reconciliar.
 */
import type { RecordatorioPuesto } from '../nucleo/contrato';

export const RE_ID_SERVIDOR = /^aura-rec-s[a-z0-9]{8,20}$/;
export const RE_BASE_SERVIDOR = /^(aura-rec-s[a-z0-9]{8,20})-([a-z0-9]{1,12})$/;
/** Lo mínimo por delante para poner una alarma (recordatorios.ts MARGEN_MS). */
export const MARGEN_PONER_MS = 20_000;
/** Cuánto se recuerda qué alarmas del servidor se pusieron aquí (para no enseñar el push de una vez que ya sonó). */
export const PUESTAS_VIVEN_MS = 7 * 24 * 3600_000;

export type RepeticionApp = { tipo: 'nunca' | 'diario' | 'laborables' | 'semanal' | 'mensual'; dia?: number };

/** Un recordatorio como lo manda GET /api/recordatorios (lo que se usa aquí). */
export type RecordatorioDelServidor = {
  id: string;
  texto: string;
  proxima: number | null;
  llamada: boolean;
  repetir: RepeticionApp;
  /** Cómo se dice la repetición («todos los días»); '' si no se repite. */
  repeticion: string;
  /** Uno de una vez que ya sonó y nadie marcó hecho. */
  sonado: boolean;
  /** La alarma vieja de este teléfono que adoptó. */
  local?: string;
  /** La última vez que el servidor la entregó por push (ms). Su alarma de esa vez no se quita: puede no haber sonado aún. */
  ultimaEntrega?: number;
};

export type ListaDelServidor = { recordatorios: RecordatorioDelServidor[]; borrados: string[] };

/** La base de la alarma de una vez de un recordatorio del servidor. */
export const baseServidor = (rid: string, cuando: number) => `${rid}-${Math.round(cuando).toString(36)}`;

/** El id del servidor de una alarma (`<id>-<vez>`) o de un id del servidor; null si es una alarma vieja del teléfono. */
export function ridDe(id: unknown): string | null {
  const s = String(id ?? '');
  if (RE_ID_SERVIDOR.test(s)) return s;
  const m = RE_BASE_SERVIDOR.exec(s);
  return m ? m[1] : null;
}

const linea = (v: unknown, max: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const TIPOS = ['nunca', 'diario', 'laborables', 'semanal', 'mensual'];

/** La respuesta de GET /api/recordatorios, sana (lo que no tiene forma se salta). Nunca lanza. */
export function listaDelServidor(r: unknown): ListaDelServidor {
  const x = (r || {}) as { recordatorios?: unknown; borrados?: unknown };
  const recordatorios: RecordatorioDelServidor[] = [];
  for (const it of Array.isArray(x.recordatorios) ? x.recordatorios : []) {
    const o = (it || {}) as Record<string, unknown>;
    const id = String(o.id ?? '');
    const texto = linea(o.texto, 140);
    if (!RE_ID_SERVIDOR.test(id) || !texto || o.hecho === true) continue;
    const proxima = o.proxima === null || o.proxima === undefined || !Number.isFinite(Number(o.proxima)) ? null : Number(o.proxima);
    const rep = (o.repetir || {}) as Record<string, unknown>;
    const tipo = TIPOS.includes(String(rep.tipo)) ? (String(rep.tipo) as RepeticionApp['tipo']) : 'nunca';
    const dia = Number(rep.dia);
    recordatorios.push({
      id,
      texto,
      proxima,
      llamada: o.llamada === true,
      repetir: { tipo, ...(Number.isInteger(dia) ? { dia } : {}) },
      repeticion: linea(o.repeticion, 60),
      sonado: o.sonado === true,
      ...(Number.isFinite(Number(o.ultimaEntrega)) && Number(o.ultimaEntrega) > 0 ? { ultimaEntrega: Math.round(Number(o.ultimaEntrega)) } : {}),
      ...(typeof o.local === 'string' && /^aura-rec-[a-z0-9-]{1,80}$/.test(o.local) ? { local: o.local } : {}),
    });
  }
  const borrados = (Array.isArray(x.borrados) ? x.borrados : []).map(String).filter((b) => RE_ID_SERVIDOR.test(b));
  return { recordatorios, borrados };
}

export type AlarmaPorPoner = { rid: string; texto: string; cuando: number; llamada: boolean };
/** Lo que se sube al servidor: una alarma del servidor que él no conoce (`id`), o una vieja del teléfono (`local`). */
export type PorSubir = { id?: string; local?: string; texto: string; cuando: number; llamada: boolean };
export type PlanReconciliar = { poner: AlarmaPorPoner[]; quitar: string[]; subir: PorSubir[] };

/**
 * Qué hacer para que las alarmas de este teléfono sean las del servidor (ver arriba). `locales`: las de quien está dentro
 * (recordatorios.ts listarRecordatorios). `adoptar`: subir las alarmas viejas del teléfono (sin servidor) para que entren
 * en la lista.
 */
export function planReconciliar(servidor: ListaDelServidor, locales: readonly RecordatorioPuesto[], ahora: number, o: { adoptar?: boolean } = {}): PlanReconciliar {
  const plan: PlanReconciliar = { poner: [], quitar: [], subir: [] };
  const porId = new Map(servidor.recordatorios.map((r) => [r.id, r]));
  const borrados = new Set(servidor.borrados);
  const esperadas = new Map<string, RecordatorioDelServidor>();
  for (const r of servidor.recordatorios) if (r.proxima !== null && r.proxima > ahora + MARGEN_PONER_MS) esperadas.set(baseServidor(r.id, r.proxima), r);
  const locPorId = new Map(locales.map((l) => [l.id, l]));
  // Las del servidor que faltan (o que cambiaron de texto o de llamada: se quitan y se ponen otra vez).
  for (const [base, r] of esperadas) {
    const l = locPorId.get(base);
    if (l && l.texto === r.texto && l.llamada === r.llamada) continue;
    if (l) plan.quitar.push(base);
    plan.poner.push({ rid: r.id, texto: r.texto, cuando: r.proxima as number, llamada: r.llamada });
  }
  for (const l of locales) {
    const rid = ridDe(l.id);
    if (rid) {
      if (esperadas.has(l.id)) continue;
      const s = porId.get(rid);
      if (s) {
        // La de su próxima vez, que suena en unos segundos (ya no se «pone», pero tampoco se quita).
        if (s.proxima !== null && l.id === baseServidor(s.id, s.proxima)) continue;
        // La vez que el servidor ACABA de entregar (su push llegó y por eso se reconcilia): si la alarma de aquí todavía no
        // sonó (Doze la atrasa, o el reloj del teléfono va unos segundos detrás) y se quitara, no sonaría nunca, porque el
        // push de esa vez se calla por «ya sonó aquí» (revisión de la tanda E, B3).
        if (s.ultimaEntrega !== undefined && l.id === baseServidor(s.id, s.ultimaEntrega)) continue;
        // Otra vez (cambió la hora, ya pasó esta y toca la siguiente), o ya no hay próxima: esta alarma sobra.
        if (!plan.quitar.includes(l.id)) plan.quitar.push(l.id);
      } else if (borrados.has(rid)) plan.quitar.push(l.id);
      // El servidor no la conoce y no la borró (su guardado falló): se le sube, la alarma se queda.
      else if (l.cuando > ahora + MARGEN_PONER_MS) plan.subir.push({ id: rid, texto: l.texto, cuando: l.cuando, llamada: l.llamada });
      continue;
    }
    // Una alarma vieja del teléfono: si el servidor ya la adoptó, sobra (queda la suya); si no, se sube.
    const adoptada = servidor.recordatorios.some((r) => r.local === l.id);
    if (adoptada) plan.quitar.push(l.id);
    else if (o.adoptar && l.cuando > ahora + MARGEN_PONER_MS) plan.subir.push({ local: l.id, texto: l.texto, cuando: l.cuando, llamada: l.llamada });
  }
  return plan;
}

/** Las alarmas del servidor que se pusieron aquí: base → cuándo (para `pushYaSonoAqui`). */
export type Puestas = Record<string, number>;

export function anotarPuesta(p: Puestas, base: string, cuando: number, ahora: number): Puestas {
  const out: Puestas = {};
  for (const [b, t] of Object.entries({ ...p, [base]: cuando })) if (Number.isFinite(t) && t > ahora - PUESTAS_VIVEN_MS) out[b] = t;
  return out;
}

/**
 * ¿El push de esta vez es de una alarma que este teléfono ya tenía puesta? Entonces sonó (o sonará) aquí con notifee y el
 * aviso no se enseña. Sin `rid` (un aviso de antes, o de otra cosa), no.
 */
export function pushYaSonoAqui(d: { rid?: string; cuando?: number }, puestas: Puestas): boolean {
  if (!d.rid || !RE_ID_SERVIDOR.test(d.rid) || !Number.isFinite(d.cuando)) return false;
  return Object.prototype.hasOwnProperty.call(puestas, baseServidor(d.rid, d.cuando as number));
}

/* ── la hoja ─────────────────────────────────────────────────────────────────────────────── */

type Idioma = 'es' | 'en';

/** «hoy 5:00 p. m.», «mañana 7:00 a. m.», «vie 3/10 9:30 a. m.» en la hora del teléfono. */
export function proximaEnPalabras(cuando: number | null, ahora: number, idioma: Idioma = 'es'): string {
  if (cuando === null) return idioma === 'en' ? 'Already rang' : 'Ya sonó';
  const d = new Date(cuando);
  const hoy = new Date(ahora);
  const manana = new Date(ahora + 86_400_000);
  const mismo = (x: Date, y: Date) => x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth() && x.getDate() === y.getDate();
  const h = d.getHours();
  const mm = String(d.getMinutes()).padStart(2, '0');
  const reloj = idioma === 'en' ? `${h % 12 || 12}:${mm} ${h < 12 ? 'AM' : 'PM'}` : `${h % 12 || 12}:${mm} ${h < 12 ? 'a. m.' : 'p. m.'}`;
  if (mismo(d, hoy)) return idioma === 'en' ? `Today ${reloj}` : `Hoy ${reloj}`;
  if (mismo(d, manana)) return idioma === 'en' ? `Tomorrow ${reloj}` : `Mañana ${reloj}`;
  const dias = idioma === 'en' ? ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] : ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
  return idioma === 'en' ? `${dias[d.getDay()]} ${d.getMonth() + 1}/${d.getDate()} ${reloj}` : `${dias[d.getDay()]} ${d.getDate()}/${d.getMonth() + 1} ${reloj}`;
}

/** Lo que se lee debajo del texto: la próxima vez, la repetición y si llama («Mañana 7:00 a. m. · todos los días · te llamo»). */
export function lineaDeRecordatorio(r: Pick<RecordatorioDelServidor, 'proxima' | 'repeticion' | 'llamada'>, ahora: number, idioma: Idioma = 'es'): string {
  return [proximaEnPalabras(r.proxima, ahora, idioma), r.repeticion, r.llamada ? (idioma === 'en' ? 'I call you' : 'te llamo') : ''].filter(Boolean).join(' · ');
}

/** Una vez que ya sonó y se marca hecha dentro de este tiempo es ESA (lib/recordatorios-servidor.ts marcarHechoServidor). */
export const HECHO_DE_LA_QUE_SONO_MS = 12 * 3600_000;

/**
 * Las alarmas de ESTE teléfono que se quitan YA al marcar hecho (o borrar) un recordatorio del servidor (tanda F1). Antes
 * esperaban a reconciliar, y reconciliar NO quita la alarma de la vez que el servidor acaba de entregar (`ultimaEntrega`,
 * revisión B3: podía no haber sonado todavía): uno de una vez marcado «hecho» entre el push del servidor y la alarma del
 * teléfono (Doze la atrasa) sonaba igual una vez.
 *   · borrar, o uno de una vez hecho: todas las suyas (de cualquier vez);
 *   · uno que se repite, hecho: la de la vez que se hizo. Si acaba de sonar (< 12 h), la vez entregada (`ultimaEntrega`);
 *     si no, la próxima (el servidor salta a la siguiente y reconciliar pone la nueva). La siguiente de una que acaba de
 *     sonar se queda: esa sigue en pie.
 */
export function alarmasAlCambiar(r: Pick<RecordatorioDelServidor, 'id' | 'proxima' | 'repetir' | 'ultimaEntrega'>, que: 'hecho' | 'borrar', locales: readonly Pick<RecordatorioPuesto, 'id'>[], ahora: number): string[] {
  const suyas = locales.map((l) => l.id).filter((id) => ridDe(id) === r.id);
  if (que === 'borrar' || r.repetir.tipo === 'nunca') return suyas;
  const acabaDeSonar = r.ultimaEntrega !== undefined && ahora - r.ultimaEntrega < HECHO_DE_LA_QUE_SONO_MS;
  const vez = acabaDeSonar ? r.ultimaEntrega : r.proxima;
  if (vez === null || vez === undefined) return [];
  const base = baseServidor(r.id, vez);
  return suyas.filter((id) => id === base);
}

/** La lista quitando uno (lo que se ve al instante al borrar o marcar hecho uno de una vez). */
export function sinRecordatorio(xs: readonly RecordatorioDelServidor[], id: string): RecordatorioDelServidor[] {
  return xs.filter((r) => r.id !== id);
}
