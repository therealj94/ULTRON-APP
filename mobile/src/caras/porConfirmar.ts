/**
 * «POR CONFIRMAR»: LA DUEÑA CONFIRMA EN SU PANTALLA A UN POSIBLE MENOR (tanda F1; servidor: lib/biometria-consentimiento.ts).
 *
 * El micrófono no sabe quién dijo el «sí»: cuando AURA guarda la cara o la voz de alguien que puede ser menor de edad (lo
 * dijo la app o el parentesco: hija, nieto, sobrina…), el servidor la deja POR CONFIRMAR y no la usa para reconocer ni la
 * nombra en la escena hasta que la dueña lo toca en su pantalla (POST /api/caras/:id/confirmar, /api/voces/:id/confirmar).
 *
 * Lo puro (sin React Native; lo prueba pruebas/consentimiento): las filas de la hoja con su insignia, lo que dice la hoja de
 * confirmar (a quién se guardó, quién la presentó, cuándo y «puede ser menor de edad»), a quién toca avisar UNA vez al abrir la
 * mesa, y el aviso entre «Más → Caras / Voces» (useCaras, useVoces) y la hoja (HojaConsentimiento.tsx), que vive una sola
 * vez en la mesa.
 */

export type TipoBio = 'cara' | 'voz';

/** Lo que el listado del servidor dice de alguien (GET /api/caras, GET /api/voces), lo que usa la hoja. */
export type PersonaListada = {
  id: string;
  nombre: string;
  relacion: 'yo' | 'conocido';
  parentesco?: string;
  creado?: number;
  porConfirmar?: boolean;
  menor?: boolean;
  presentadoPor?: string;
  presentadoEn?: number;
};

/** Una fila de la hoja. */
export type FilaBio = {
  tipo: TipoBio;
  id: string;
  nombre: string;
  relacion: 'yo' | 'conocido';
  parentesco?: string;
  porConfirmar: boolean;
  menor: boolean;
  presentadoPor?: string;
  /** Cuándo se guardó (la constancia del permiso; si no, el alta). */
  cuando?: number;
};

const limpio = (x: unknown, max: number) =>
  String(x ?? '')
    .replace(/[\u0000-\u001f<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);

/** Las filas de un listado, sanas: primero las que esperan su confirmación, después la dueña y el resto por nombre. */
export function filasBio(tipo: TipoBio, personas: readonly PersonaListada[] | null | undefined): FilaBio[] {
  const out: FilaBio[] = [];
  for (const p of personas || []) {
    const id = limpio(p?.id, 40);
    const nombre = limpio(p?.nombre, 60);
    if (!id || !nombre) continue;
    const parentesco = limpio(p.parentesco, 30);
    const presentadoPor = limpio(p.presentadoPor, 60);
    const cuando = Number(p.presentadoEn) > 0 ? Number(p.presentadoEn) : Number(p.creado) > 0 ? Number(p.creado) : undefined;
    out.push({
      tipo,
      id,
      nombre,
      relacion: p.relacion === 'yo' ? 'yo' : 'conocido',
      ...(parentesco ? { parentesco } : {}),
      porConfirmar: p.porConfirmar === true,
      menor: p.menor === true,
      ...(presentadoPor ? { presentadoPor } : {}),
      ...(cuando ? { cuando } : {}),
    });
  }
  const peso = (f: FilaBio) => (f.porConfirmar ? 0 : f.relacion === 'yo' ? 1 : 2);
  return out.sort((a, b) => peso(a) - peso(b) || a.nombre.localeCompare(b.nombre));
}

/** La insignia de la fila («Por confirmar»), o '' si no le falta nada. */
export function insignia(f: Pick<FilaBio, 'porConfirmar'>, en = false): string {
  return f.porConfirmar ? (en ? 'To confirm' : 'Por confirmar') : '';
}

/** Lo que se lee debajo del nombre en la lista. */
export function subtituloFila(f: FilaBio, en = false): string {
  if (f.relacion === 'yo') return en ? 'You' : 'Tú';
  const partes = [f.parentesco ? (en ? `your ${f.parentesco}` : `tu ${f.parentesco}`) : '', f.porConfirmar ? (en ? 'not recognized until you confirm' : 'no la reconozco hasta que confirmes') : ''];
  return partes.filter(Boolean).join(' · ');
}

/** «8 oct, 3:05 p. m.» en la hora del teléfono. */
export function fechaCorta(t: number, en = false): string {
  const d = new Date(t);
  const meses = en ? ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] : ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  const h = d.getHours();
  const mm = String(d.getMinutes()).padStart(2, '0');
  const reloj = en ? `${h % 12 || 12}:${mm} ${h < 12 ? 'AM' : 'PM'}` : `${h % 12 || 12}:${mm} ${h < 12 ? 'a. m.' : 'p. m.'}`;
  return en ? `${meses[d.getMonth()]} ${d.getDate()}, ${reloj}` : `${d.getDate()} ${meses[d.getMonth()]}, ${reloj}`;
}

/** La hoja de confirmar: el título, las líneas (a quién, quién la presentó, cuándo, «puede ser menor de edad») y la nota. */
export function detalleConfirmar(f: FilaBio, en = false): { titulo: string; lineas: string[]; nota: string } {
  const que = f.tipo === 'cara' ? (en ? 'face' : 'cara') : en ? 'voice' : 'voz';
  const como = f.parentesco ? (en ? `${f.nombre} (your ${f.parentesco})` : `${f.nombre} (tu ${f.parentesco})`) : f.nombre;
  const lineas = [en ? `I saved the ${que} of ${como}.` : `Guardé la ${que} de ${como}.`];
  if (f.presentadoPor) lineas.push(en ? `Introduced by ${f.presentadoPor}.` : `La presentó ${f.presentadoPor}.`);
  // «a. m.» / «p. m.» ya cierran con punto.
  if (f.cuando) lineas.push(en ? `When: ${fechaCorta(f.cuando, true)}.` : `Cuándo: ${fechaCorta(f.cuando)}`);
  if (f.menor) lineas.push(en ? 'This person may be a minor.' : 'Puede ser menor de edad.');
  const nota = en
    ? `Until you confirm here, I don't use this ${que} to recognize anyone and I don't say the name. “Yes, save” keeps it; “Delete” erases it.`
    : `Hasta que lo confirmes aquí, no uso esta ${que} para reconocer a nadie ni digo su nombre. «Sí, guardar» la deja; «Borrar» la borra.`;
  return { titulo: en ? `Keep ${f.nombre}?` : `¿Guardo a ${f.nombre}?`, lineas, nota };
}

/* ── el aviso de una vez al abrir la mesa ─────────────────────────────────────────────────── */

/** Lo ya avisado, por cuenta: correo → claves (`cara:<id>`, `voz:<id>`). */
export type Avisados = Record<string, string[]>;
export const CLAVE_AVISADOS = 'aura.biometria.avisoMenores.v1';
const claveFila = (f: Pick<FilaBio, 'tipo' | 'id'>) => `${f.tipo}:${f.id}`;
const correoNormal = (c: string) => String(c || '').trim().toLowerCase();

/** Los posibles menores por confirmar a los que todavía no se les avisó a esta cuenta (cada uno, una vez). */
export function porAvisar(filas: readonly FilaBio[], avisados: Avisados | null | undefined, correo: string): FilaBio[] {
  const ya = new Set((avisados || {})[correoNormal(correo)] || []);
  return filas.filter((f) => f.porConfirmar && f.menor && !ya.has(claveFila(f)));
}

/** Lo avisado más estas (sin perder lo de otras cuentas del teléfono; con tope). */
export function conAvisados(avisados: Avisados | null | undefined, correo: string, filas: readonly FilaBio[]): Avisados {
  const c = correoNormal(correo);
  const out: Avisados = { ...(avisados || {}) };
  if (!c) return out;
  out[c] = [...new Set([...(out[c] || []), ...filas.map(claveFila)])].slice(-200);
  return out;
}

/** El aviso suave: quién espera su confirmación y qué pasa mientras tanto. */
export function textoAviso(filas: readonly FilaBio[], en = false): { titulo: string; texto: string } {
  const nombres = filas.map((f) => (f.parentesco ? (en ? `${f.nombre} (your ${f.parentesco})` : `${f.nombre} (tu ${f.parentesco})`) : f.nombre));
  const lista = nombres.length < 2 ? nombres.join('') : `${nombres.slice(0, -1).join(', ')}${en ? ' and ' : ' y '}${nombres[nombres.length - 1]}`;
  const uno = filas.length === 1;
  return en
    ? {
        titulo: 'One thing to confirm',
        texto: `I saved ${lista}. Since ${uno ? 'this person may be a minor' : 'they may be minors'}, I won't recognize or name them until you confirm it here, on your screen.`,
      }
    : {
        titulo: 'Algo por confirmar',
        texto: `Guardé a ${lista}. Como ${uno ? 'puede ser menor' : 'pueden ser menores'} de edad, no ${uno ? 'la' : 'las'} reconozco ni digo su nombre hasta que tú lo confirmes aquí, en tu pantalla.`,
      };
}

/* ── «Más → Caras / Voces» abre la hoja de la mesa ────────────────────────────────────────── */

/** Un mando más de la hoja (lo que antes eran los botones del aviso: «Olvidar todas», «Desactivar»). */
export type MandoHoja = { titulo: string; peligro?: boolean; alTocar: () => void };
export type PedidoHoja = {
  tipo: TipoBio;
  titulo: string;
  /** Lo que se lee arriba (cómo se aprende a alguien, el estado del oído…). */
  texto?: string;
  mandos?: MandoHoja[];
  /** Abrir directo la confirmación de esta persona. */
  id?: string;
};

let oyente: ((p: PedidoHoja) => void) | null = null;
const alCambiar = new Set<(tipo: TipoBio) => void>();

/** Después de confirmar o borrar a alguien en la hoja: useCaras / useVoces releen su lista (con los vectores nuevos). */
export function escucharCambiosBio(f: (tipo: TipoBio) => void): () => void {
  alCambiar.add(f);
  return () => void alCambiar.delete(f);
}

export function avisarCambioBio(tipo: TipoBio): void {
  for (const f of [...alCambiar]) {
    try {
      f(tipo);
    } catch {
      /* quien escucha no tumba la hoja */
    }
  }
}

/** La hoja de la mesa escucha (una sola). Devuelve cómo dejar de escuchar. */
export function escucharHojaBio(f: (p: PedidoHoja) => void): () => void {
  oyente = f;
  return () => {
    if (oyente === f) oyente = null;
  };
}

/** Pide la hoja. false si no hay mesa que la muestre (entonces quien pide usa su aviso de siempre). */
export function abrirHojaBio(p: PedidoHoja): boolean {
  if (!oyente) return false;
  oyente(p);
  return true;
}

/** Lo que dice AURA al guardar a alguien que queda por confirmar (honesto: todavía no lo reconoce). */
export function fraseGuardadoPorConfirmar(nombre: string, tipo: TipoBio, duena: string, en = false): string {
  const que = tipo === 'cara' ? (en ? 'face' : 'cara') : en ? 'voice' : 'voz';
  return en
    ? `Nice to meet you, ${nombre}! I saved your ${que}, but since you may be a minor I won't recognize you until ${duena || 'the account owner'} confirms it on their screen (More → ${tipo === 'cara' ? 'Faces' : 'Voices'}). I only kept numbers.`
    : `¡Mucho gusto, ${nombre}! Guardé tu ${que}, pero como puedes ser menor de edad no te reconozco hasta que ${duena || 'la dueña de la cuenta'} lo confirme en su pantalla (Más → ${tipo === 'cara' ? 'Caras' : 'Voces'}). Solo guardé números.`;
}
