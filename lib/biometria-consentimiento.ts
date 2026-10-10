/**
 * LA CONSTANCIA DEL PERMISO de una cara o una voz guardada (auditoría A-7), igual para lib/caras-miembro.ts y
 * lib/voces-miembro.ts. Viaja dentro del sobre cifrado (lib/biometria-sobre.ts), con la persona.
 *
 *  · `como`: 'dueño' (la dueña pidió guardar lo suyo) o 'voz' (alguien presentado dijo que sí en voz alta);
 *  · `quien`: quién dio el permiso (la dueña por su nombre de sesión, o la persona presentada por su nombre) y `t`, cuándo
 *    (la hora del servidor, no la del teléfono); `frase`: lo que dijo, como constancia;
 *  · `presentadoPor`: quién la presentó (la dueña de la cuenta) cuando el permiso lo dio otra persona;
 *  · `menor`: posible menor de edad, porque la app lo dijo (`menor: true`) o por el parentesco (hijo/a, nieto/a, sobrino/a).
 *    El micrófono no sabe quién dijo el «sí»: para un menor, además, la dueña lo re-confirma tocando su pantalla
 *    (`confirmadoEnPantalla`, la hora; ausente = todavía no). Tanda F1: se EXIGE. Mientras falte (`pendienteDeConfirmar`),
 *    su cara y su voz no se usan para reconocer (`reconocible`: el listado de caras no le da sus vectores al teléfono,
 *    lib/voces-miembro.ts identificarVoz no la compara) ni su nombre llega a la escena del turno (lib/caras-turno.ts
 *    escenaSinPorConfirmar). La app lo pide con su hoja «Por confirmar» (mobile/src/caras/HojaConsentimiento.tsx).
 */
export type ConsentimientoBio = {
  como: 'dueño' | 'voz';
  frase?: string;
  t: number;
  quien?: string;
  presentadoPor?: string;
  menor?: boolean;
  confirmadoEnPantalla?: number;
};

const limpio = (x: unknown, max: number) =>
  String(x || '')
    .replace(/[\u0000-\u001f<>{}\[\]]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);

const sinTildes = (t: string) => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
/** Parentescos que, dichos por la dueña, suelen ser de un menor de edad. */
const RE_MENOR = /^(hij[oa]|niet[oa]|sobrin[oa]|bebe|nin[oa])$/;
export function parentescoDeMenor(p: unknown): boolean {
  return RE_MENOR.test(sinTildes(String(p || '')));
}

/** Lo guardado, saneado (lo de antes de A-7 solo tenía `como`, `frase` y `t`: sigue valiendo). */
export function consentimientoValido(x: any): ConsentimientoBio {
  const como = x?.como === 'voz' ? 'voz' : 'dueño';
  const frase = limpio(x?.frase, 160);
  const quien = limpio(x?.quien, 60);
  const presentadoPor = limpio(x?.presentadoPor, 60);
  const confirmado = Number(x?.confirmadoEnPantalla) > 0 ? Number(x.confirmadoEnPantalla) : 0;
  return {
    como,
    ...(frase ? { frase } : {}),
    t: Number(x?.t) || 0,
    ...(quien ? { quien } : {}),
    ...(presentadoPor && como === 'voz' ? { presentadoPor } : {}),
    ...(x?.menor === true ? { menor: true } : {}),
    ...(confirmado ? { confirmadoEnPantalla: confirmado } : {}),
  };
}

/**
 * La constancia de un alta (ya validado el permiso por quien llama): quién, cuándo, quién la presentó, si es posible menor y
 * si la dueña ya lo confirmó en pantalla (`confirmadoEnPantalla: true` del teléfono, solo cuenta para un menor).
 */
export function consentimientoDeAlta(o: { relacion: 'yo' | 'conocido'; crudo: unknown; nombre: string; nombreSesion: string; parentesco?: string; ahora?: number }): ConsentimientoBio {
  const c = (o.crudo || {}) as { frase?: unknown; menor?: unknown; confirmadoEnPantalla?: unknown };
  const ahora = o.ahora ?? Date.now();
  const frase = limpio(c.frase, 160);
  if (o.relacion === 'yo') return { como: 'dueño', ...(frase ? { frase } : {}), t: ahora, quien: limpio(o.nombreSesion, 60) || 'dueña' };
  const menor = c.menor === true || parentescoDeMenor(o.parentesco);
  const presentadoPor = limpio(o.nombreSesion, 60) || 'dueña';
  return {
    como: 'voz',
    ...(frase ? { frase } : {}),
    t: ahora,
    quien: limpio(o.nombre, 60),
    presentadoPor,
    ...(menor ? { menor: true } : {}),
    ...(menor && c.confirmadoEnPantalla === true ? { confirmadoEnPantalla: ahora } : {}),
  };
}

/**
 * Un alta nueva de alguien ya guardado: la constancia nueva, sin perder una confirmación en pantalla de antes. La marca
 * de posible menor es PEGAJOSA: si la persona ya la tenía, la conserva aunque el alta nueva no repita el parentesco
 * («mi hija Nora» y después solo «Nora»); y con ella su «por confirmar». Solo la confirmación explícita de la dueña en su
 * pantalla (confirmarConsentimiento*, o `confirmadoEnPantalla` del alta) la vuelve reconocible.
 */
export function unirConsentimiento(previo: ConsentimientoBio | undefined, nuevo: ConsentimientoBio): ConsentimientoBio {
  const menor = !!nuevo.menor || !!previo?.menor;
  const conf = nuevo.confirmadoEnPantalla || (menor && previo?.confirmadoEnPantalla) || 0;
  return { ...nuevo, ...(menor ? { menor: true } : {}), ...(conf ? { confirmadoEnPantalla: conf } : {}) };
}

/** Es posible menor y la dueña todavía no lo confirmó en pantalla. */
export function pendienteDeConfirmar(c: ConsentimientoBio | undefined): boolean {
  return !!c?.menor && !c.confirmadoEnPantalla;
}

/** Tanda F1: ¿se puede usar para reconocer? Todo, salvo un posible menor que la dueña todavía no confirmó en pantalla. */
export function reconocible(c: ConsentimientoBio | undefined): boolean {
  return !pendienteDeConfirmar(c);
}

/**
 * Lo que el listado de la app (GET /api/caras, GET /api/voces) dice del permiso de alguien POR CONFIRMAR, para la hoja de
 * la dueña: quién la presentó, cuándo y que es posible menor. Vacío si no falta nada (no cambia el listado de siempre).
 */
export function vistaPorConfirmar(c: ConsentimientoBio | undefined): { porConfirmar?: true; menor?: true; presentadoPor?: string; presentadoEn?: number } {
  if (!pendienteDeConfirmar(c)) return {};
  return { porConfirmar: true, menor: true, ...(c?.presentadoPor ? { presentadoPor: c.presentadoPor } : {}), ...(c?.t ? { presentadoEn: c.t } : {}) };
}
