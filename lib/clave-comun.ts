/**
 * LA CLAVE COMÚN entre una respuesta del perfil (lib/perfil-persona.ts) y su copia en «lo que sé de ti»
 * (lib/conocer-persona.ts): «Dónde vives» ↔ «Vive en Tela» son el mismo dato. Vive aquí, sin dependencias,
 * para que la usen el borrado y la corrección (lib/olvido.ts) y la VISTA AUTORIZADA del contexto
 * (perfilDeUso en lib/perfil-persona.ts: un dato que la persona limitó con «No usarlo» tampoco entra por su
 * copia del perfil). La misma tabla que la app (mobile/src/primeravez/flujo.ts CLAVE_CONOCER; una prueba
 * las compara).
 */
export const CAMPO_CLAVE = {
  trabajo: { categoria: 'trabajo', clave: 'oficio' },
  vive: { categoria: 'rutinas', clave: 'vive' },
  familia: { categoria: 'familia', clave: 'familia:encuesta' },
  gustos: { categoria: 'gustos', clave: 'pasatiempos' },
  comida: { categoria: 'gustos', clave: 'comida favorita' },
  musica: { categoria: 'gustos', clave: 'musica' },
  ayuda: { categoria: 'metas', clave: 'quiere de aura' },
} as const;
export type CampoConClave = keyof typeof CAMPO_CLAVE;

/**
 * El cumpleaños propio que AURA aprendió conversando («Su cumpleaños es el 14 de marzo», fechas/«cumpleanos
 * propio») es el mismo dato que el `cumple` del perfil. Solo para LIMITAR (la app no tiene esta clave en su
 * tabla de la primera vez).
 */
export const CLAVE_CUMPLE = { categoria: 'fechas', clave: 'cumpleanos propio' } as const;

export const plegarClave = (s: string | undefined) =>
  String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

/** La respuesta del perfil que corresponde a un dato con clave común, o null. */
export function campoDeClave(k: { categoria?: string; clave?: string }): CampoConClave | null {
  const clave = plegarClave(k.clave);
  if (!clave) return null;
  for (const [campo, c] of Object.entries(CAMPO_CLAVE)) if (c.categoria === k.categoria && c.clave === clave) return campo as CampoConClave;
  return null;
}

/** El campo del perfil (`encuesta.vive`, `cumple`) que repite un dato por su clave común, o null. */
export function campoPerfilDeDato(k: { categoria?: string; clave?: string }): string | null {
  const campo = campoDeClave(k);
  if (campo) return `encuesta.${campo}`;
  return k.categoria === CLAVE_CUMPLE.categoria && plegarClave(k.clave) === CLAVE_CUMPLE.clave ? 'cumple' : null;
}
