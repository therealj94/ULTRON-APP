/**
 * «LO QUE VEO»: la vista en vivo de la cámara con lo que AU-RA reconoce encima (lo puro; se prueba en Node).
 *
 * José (5-oct): «cuando enciendo la cámara, ver lo que mira y que salga el cuadro de lo que reconoce, y
 * poder poner cámara frontal y de atrás». La vista la dibuja components/CamaraVision.tsx; aquí:
 *
 *  · `cajaEnPantalla`: una caja de la FOTO (fracciones 0..1) en píxeles de la vista previa. La vista previa
 *    de la cámara frontal sale ESPEJADA (como un espejo) y la foto no: con la frontal x se refleja. La
 *    vista previa llena su marco recortando lo que sobre (como `cover`); el marco se hace con la proporción
 *    de la foto (`marcoParaFoto`) para que casi no recorte, y si recorta, la cuenta lo tiene en cuenta.
 *  · `marcasEnVivo`: qué recuadros se dibujan: cada cara de ML Kit vista hace < 1,5 s con su nombre
 *    confirmado («José · tú», «Ana · tu esposa») o «Persona», y «mirando» en la de quien mira la pantalla;
 *    los objetos con caja del servidor (otro estilo) solo mientras la vista es fresca.
 *  · `lineaEstado`: la línea de abajo («Te veo · mirando la pantalla», «No veo a nadie», «Reconociendo…»).
 *  · `pedidoDeVista`: «muéstrame lo que ves», «cierra la vista», «cámara trasera», «voltea la cámara».
 *  · `ladoValido`: la cámara elegida, guardada en los ajustes (frontal si no hay nada o es basura).
 *
 * Privacidad: la vista y sus recuadros se ven solo en este teléfono; nada de esto sale de él.
 */
import type { CajaN, Identidad, Pista } from '../caras/seguimiento';
import type { VistaCamara } from './vistaCamara';

export type Lado = 'frontal' | 'trasera';
export type Rect = { left: number; top: number; width: number; height: number };

/** Los objetos del servidor se dibujan mientras la vista tenga menos que esto. */
export const VISTA_FRESCA_MS = 20_000;

export function ladoValido(v: unknown): Lado {
  return v === 'trasera' ? 'trasera' : 'frontal';
}

/** La caja de ML Kit (píxeles de la foto) en fracciones de la foto, recortada a la foto. null si no sirve. */
export function cajaNormal(b: { x: number; y: number; width: number; height: number }, w: number, h: number): CajaN | null {
  if (!(w > 0 && h > 0) || !b || ![b.x, b.y, b.width, b.height].every(Number.isFinite)) return null;
  const x1 = Math.max(0, b.x / w);
  const y1 = Math.max(0, b.y / h);
  const x2 = Math.min(1, (b.x + b.width) / w);
  const y2 = Math.min(1, (b.y + b.height) / h);
  return x2 - x1 > 0.005 && y2 - y1 > 0.005 ? { x: x1, y: y1, w: x2 - x1, h: y2 - y1 } : null;
}

/** El marco de la vista previa: la proporción de la foto, lo más grande que quepa en `area`. */
export function marcoParaFoto(foto: { w: number; h: number } | null, area: { w: number; h: number }): { w: number; h: number } {
  const aw = Math.max(0, area.w);
  const ah = Math.max(0, area.h);
  // Sin foto todavía: la proporción típica (3:4 en vertical, 4:3 en horizontal).
  const r = foto && foto.w > 0 && foto.h > 0 ? foto.w / foto.h : aw >= ah ? 4 / 3 : 3 / 4;
  const w = Math.min(aw, ah * r);
  return { w: Math.round(w), h: Math.round(w / r) };
}

/**
 * Una caja de la foto (0..1) en píxeles del marco. La vista previa llena el marco recortando (cover) y,
 * con la cámara frontal, espejada: x se refleja. Recortada a lo visible; null si queda fuera.
 */
export function cajaEnPantalla(c: CajaN, foto: { w: number; h: number }, marco: { w: number; h: number }, espejo: boolean): Rect | null {
  if (!(foto.w > 0 && foto.h > 0 && marco.w > 0 && marco.h > 0)) return null;
  const s = Math.max(marco.w / foto.w, marco.h / foto.h);
  const W = foto.w * s;
  const H = foto.h * s;
  const ox = (marco.w - W) / 2;
  const oy = (marco.h - H) / 2;
  const x = espejo ? 1 - c.x - c.w : c.x;
  const left = Math.max(0, ox + x * W);
  const top = Math.max(0, oy + c.y * H);
  const right = Math.min(marco.w, ox + (x + c.w) * W);
  const bottom = Math.min(marco.h, oy + (c.y + c.h) * H);
  if (right - left < 2 || bottom - top < 2) return null;
  return { left, top, width: right - left, height: bottom - top };
}

export type MarcaViva = { clave: string; caja: CajaN; etiqueta: string; tipo: 'cara' | 'objeto'; conocida?: boolean; detalle?: string };

/** El nombre de una cara para la vista: «José · tú», «Ana · tu esposa», «Ana», o «Persona». */
export function etiquetaCara(i: Identidad | null, lado: Lado, en = false): string {
  if (!i) return en ? 'Person' : 'Persona';
  if (i.relacion === 'yo') return lado === 'frontal' ? `${i.nombre} · ${en ? 'you' : 'tú'}` : i.nombre;
  if (i.parentesco) return `${i.nombre} · ${en ? `your ${i.parentesco}` : `tu ${i.parentesco}`}`;
  return i.nombre;
}

/**
 * Lo que se dibuja: las caras a la vista (la más grande es la principal: lleva «mirando» si mira la
 * pantalla, solo con la frontal) y los objetos con caja de la última vista del servidor, si es fresca.
 */
export function marcasEnVivo(o: { pistas: Pista[]; mirando: boolean; lado: Lado; vista: { v: VistaCamara; ts: number } | null; ahora: number; en?: boolean }): MarcaViva[] {
  const m: MarcaViva[] = [];
  const principal = o.pistas.reduce<Pista | null>((a, p) => (!a || p.caja.h > a.caja.h ? p : a), null);
  for (const p of o.pistas) {
    const mira = p === principal && o.mirando && o.lado === 'frontal';
    m.push({ clave: `c${p.id}`, caja: p.caja, etiqueta: etiquetaCara(p.identidad, o.lado, o.en), tipo: 'cara', conocida: !!p.identidad, ...(mira ? { detalle: o.en ? 'looking' : 'mirando' } : {}) });
  }
  const v = o.vista;
  if (v && o.ahora - v.ts <= VISTA_FRESCA_MS && v.v.cajasFiables) {
    v.v.objetos.forEach((x, i) => {
      if (x.caja) m.push({ clave: `o${i}-${x.nombre}`, caja: x.caja, etiqueta: x.nombre, tipo: 'objeto' });
    });
  }
  return m;
}

const NUMEROS = ['cero', 'una', 'dos', 'tres', 'cuatro', 'cinco', 'seis'];
const nPersonas = (n: number, en: boolean) => (en ? (n === 1 ? 'one person' : `${n} people`) : n === 1 ? 'una persona' : `${NUMEROS[n] || n} personas`);

/** La línea de estado de la vista. */
export function lineaEstado(o: { lado: Lado; personas: number; mirando: boolean; nombres: string[]; reconociendo: boolean; sinDetector?: boolean; en?: boolean }): string {
  const en = !!o.en;
  if (o.sinDetector) return en ? 'Looking through the server (no face boxes)' : 'Miro con el servidor (sin recuadros de caras)';
  const quien = o.nombres.length ? o.nombres.join(', ') : '';
  const reco = o.reconociendo ? (en ? ' · Recognizing…' : ' · Reconociendo…') : '';
  if (o.lado === 'trasera') {
    if (o.personas <= 0) return en ? 'Back camera · I see no one' : 'Cámara trasera · no veo a nadie';
    return `${en ? 'Back camera · I see' : 'Cámara trasera · veo a'} ${quien || nPersonas(o.personas, en)}${reco}`;
  }
  if (o.personas <= 0) return en ? 'I see no one' : 'No veo a nadie';
  if (o.personas === 1) {
    const base = quien ? (en ? `I see you, ${quien}` : `Te veo, ${quien}`) : en ? 'I see you' : 'Te veo';
    return `${base} · ${o.mirando ? (en ? 'looking at the screen' : 'mirando la pantalla') : en ? 'looking away' : 'mirando a otro lado'}${reco}`;
  }
  return `${en ? 'I see' : 'Veo a'} ${nPersonas(o.personas, en)}${quien ? `: ${quien}` : ''}${reco}`;
}

/* ── por voz ─────────────────────────────────────────────────────────────────────────────── */

export type PedidoVista = 'abrir' | 'cerrar' | 'trasera' | 'frontal' | 'voltear';

const sinTildes = (t: string) => String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/**
 * ¿Pide ver la cámara, cerrarla o cambiar de cámara? «Cierra la cámara» con la vista ABIERTA cierra la
 * vista (la cámara sigue mirando); con la vista cerrada no es de aquí: lo atiende lib/camaraModo.ts
 * (apagarla), como siempre.
 */
export function pedidoDeVista(texto: string, o: { vistaAbierta: boolean } = { vistaAbierta: false }): PedidoVista | null {
  const t = sinTildes(texto)
    .replace(/[¿?¡!.,;:«»"]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!t) return null;
  if (/\b(no me (veas|mires)|apaga)\b/.test(t)) return null;
  if (/\bcamara (trasera|de atras|de detras|posterior|de la espalda)\b|\b(usa|pon|cambia a|pasa a) la (de atras|trasera)\b|\b(back|rear) camera\b/.test(t)) return 'trasera';
  if (/\bcamara (frontal|delantera|de adelante|de enfrente|del frente|de selfie)\b|\b(usa|pon|cambia a|pasa a) la (de adelante|frontal|delantera)\b|\b(front|selfie) camera\b/.test(t)) return 'frontal';
  if (/\b(voltea|gira|cambia|invierte|da vuelta a|dale la vuelta a) (la )?camara\b|\bcambia de camara\b|\b(flip|switch) (the )?camera\b/.test(t)) return 'voltear';
  if (/\b(cierra|quita|oculta|esconde) (la vista|lo que ves|la vista de la camara)\b|\bya no (me )?(muestres|ensenes) (la camara|lo que ves)\b|\b(close|hide) (the )?(view|camera view)\b/.test(t)) return 'cerrar';
  if (o.vistaAbierta && /\b(cierra|quita|oculta|esconde) (la )?camara\b/.test(t)) return 'cerrar';
  // «Abre la cámara» es encenderla (camaraModo); «abre la vista» sí es esto.
  if (/\b(muestrame|ensename|dejame ver|quiero ver) (lo que (ves|estas viendo|miras)|la camara|tu camara|la vista|como me ves|lo que reconoces)\b|\babre (la vista|lo que ves)\b|\bshow me (what you see|the camera)\b/.test(t)) return 'abrir';
  return null;
}
