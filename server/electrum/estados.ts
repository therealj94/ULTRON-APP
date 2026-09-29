/**
 * LOS ESTADOS DEL CATASTRO MINERO, en el idioma de quien pregunta.
 *
 * El catastro de INHGEOMIN no dice «en exploración»: dice «Explorar» (derecho de exploración
 * vigente) y «S-Explorar» (solicitud de exploración en trámite). Igual con «Explotar» y
 * «S-Explotar». Cuando alguien preguntó «¿cuántas concesiones están en exploración?», el doctor
 * buscó el estado literal, no lo encontró y contestó que no había ninguna — había 86 vigentes y
 * 90 solicitadas. Aquí vive la traducción, en un solo sitio y probada.
 */

const sinTildes = (s: string) =>
  String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();

/** Lo que significa cada estado, dicho como lo diría un técnico del catastro. */
export function significadoEstado(estado: string | null | undefined): string {
  const e = sinTildes(estado || '');
  if (!e) return 'sin estado declarado';
  if (e === 'explorar') return 'exploración vigente';
  if (e === 's-explorar') return 'solicitud de exploración';
  if (e === 'explotar') return 'explotación vigente';
  if (e === 's-explotar') return 'solicitud de explotación';
  if (e === 'solicitud') return 'solicitud en trámite';
  if (e === 'otorgada') return 'otorgada';
  if (e === 'delimitada') return 'área delimitada';
  if (e === 'suspenso') return 'en suspenso';
  if (e.startsWith('s-')) return `solicitud (${estado})`;
  return String(estado);
}

/**
 * Qué estados del catastro calzan con lo que se pidió. Devuelve los estados tal como están
 * escritos en la base (de la lista `existentes`), o null si el texto no habla de estados.
 *
 *  · «exploración», «explorar», «en exploración» → Explorar y S-Explorar (y se reportan aparte).
 *  · «explotación», «producción», «extracción» → Explotar y S-Explotar.
 *  · «solicitud», «en trámite», «solicitadas» → Solicitud y todas las S-….
 *  · «vigentes», «otorgadas», «activas» → Otorgada, Explorar y Explotar.
 *  · Cualquier otro texto: el estado con ese nombre (sin tildes ni mayúsculas).
 */
export function estadosQueCalzan(texto: string, existentes: string[]): string[] | null {
  const t = sinTildes(texto);
  if (!t) return null;
  const hay = (re: RegExp) => existentes.filter((e) => re.test(sinTildes(e)));
  const soloSolicitud = /solicit|tramite|pedid/.test(t);
  const soloVigente = /vigente|otorgad|activ|aprobad/.test(t) && !soloSolicitud;
  let r: string[] = [];
  if (/explor/.test(t)) r = hay(/explorar/);
  else if (/explot|produc|extrac/.test(t)) r = hay(/explotar/);
  else if (soloSolicitud) r = hay(/^solicitud$|^s-/);
  else if (soloVigente) r = hay(/^otorgada$|^explorar$|^explotar$/);
  else {
    const exacto = existentes.filter((e) => sinTildes(e) === t);
    r = exacto.length ? exacto : hay(new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  // «solicitudes de exploración» → solo la S-; «exploración vigente» → solo la otorgada.
  if (/explor|explot/.test(t)) {
    if (soloSolicitud) r = r.filter((e) => sinTildes(e).startsWith('s-'));
    else if (soloVigente) r = r.filter((e) => !sinTildes(e).startsWith('s-'));
  }
  return r;
}

/** Fases agrupadas: vigente y solicitada de exploración, y de explotación. */
export function fasesDe(porEstado: Array<{ nombre: string; n: number; ha?: number }>) {
  const n = (re: RegExp) => porEstado.filter((e) => re.test(sinTildes(e.nombre))).reduce((s, e) => s + e.n, 0);
  return {
    exploracion: { vigentes: n(/^explorar$/), solicitadas: n(/^s-explorar$/) },
    explotacion: { vigentes: n(/^explotar$/), solicitadas: n(/^s-explotar$/) },
  };
}
