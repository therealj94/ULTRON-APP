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
 *    (`confirmadoEnPantalla`, la hora; ausente = todavía no). Hoy se REGISTRA (no se exige): el teléfono todavía no tiene esa
 *    pantalla; `pendienteDeConfirmar` lo dice para que la app lo pida.
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

/** Un alta nueva de alguien ya guardado: la constancia nueva, sin perder una confirmación en pantalla de antes. */
export function unirConsentimiento(previo: ConsentimientoBio | undefined, nuevo: ConsentimientoBio): ConsentimientoBio {
  const conf = nuevo.confirmadoEnPantalla || (nuevo.menor && previo?.confirmadoEnPantalla) || 0;
  return { ...nuevo, ...(conf ? { confirmadoEnPantalla: conf } : {}) };
}

/** Es posible menor y la dueña todavía no lo confirmó en pantalla. */
export function pendienteDeConfirmar(c: ConsentimientoBio | undefined): boolean {
  return !!c?.menor && !c.confirmadoEnPantalla;
}
