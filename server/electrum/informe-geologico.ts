/**
 * El informe geológico en PDF: los tres mapas (litológico, estructural, geotectónico) y lo que dice
 * cada uno, con los indicios y sus razones arriba y los límites y las fuentes al final.
 *
 * Como la ficha de concesión, no recibe cifras de nadie: todo sale de PostGIS (geologia.ts) y de
 * los mapas dibujados en el servidor (mapa-geologico.ts). Si un mapa no se puede dibujar, el
 * informe sale igual y lo dice.
 */
import { documentoPdf, type Bloque } from '../../lib/pdf';
import { geologiaDe, NOMBRE_ROL_GEO, type Geologia, type Zona } from './geologia';
import { mapaGeologico, NOMBRE_MAPA, TIPOS_MAPA_GEO } from './mapa-geologico';
import { AMBAR, pie, type Informe } from './informe';

const nf = (x: number, d = 1) => new Intl.NumberFormat('es-ES', { maximumFractionDigits: d }).format(x);
const km = (k: number) => (k < 1 ? `${Math.round(k * 1000)} m` : `${nf(k)} km`);
const slug = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w.-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').toLowerCase().slice(0, 60);

const NIVEL: Record<Geologia['indicios']['nivel'], string> = {
  alto: 'ALTO: varias condiciones de los yacimientos conocidos se juntan aquí',
  medio: 'MEDIO: algunas condiciones favorables',
  bajo: 'BAJO: una o dos condiciones sueltas',
  'sin indicios': 'SIN INDICIOS en las capas cargadas',
};

export async function informeGeologico(z: Zona, opts: { quien?: string | null; lectura?: string } = {}): Promise<Informe | { error: string }> {
  const g = await geologiaDe(z);
  if ('error' in g) return g;
  const mapas = await Promise.all(
    TIPOS_MAPA_GEO.map((t) => mapaGeologico(t, z, { pie: 'Dr Electrum FP' }).catch((e: any) => ({ error: String(e?.message || e).slice(0, 160) })))
  );
  const [lito, estr, geot] = mapas;
  const b: Bloque[] = [];
  const mapa = (m: (typeof mapas)[number], i: number, pieTexto: string) => {
    if (m && 'jpeg' in m) b.push({ tipo: 'imagen', jpeg: m.jpeg, ancho: m.ancho, alto: m.alto, altoMax: 520, pie: pieTexto });
    else b.push({ tipo: 'nota', texto: `No se pudo dibujar el ${NOMBRE_MAPA[TIPOS_MAPA_GEO[i]].toLowerCase()} (${m && 'error' in m ? m.error : 'sin datos'}). El resto del informe no depende de él.` });
  };

  /* --- arriba, lo que hay que leer --- */
  b.push({ tipo: 'aviso', texto: `Indicios: ${NIVEL[g.indicios.nivel]} (${g.indicios.puntos} puntos).` });
  for (const c of g.indicios.criterios.filter((x) => x.cumple)) b.push({ tipo: 'aviso', texto: c.evidencia });
  if (g.indicios.modelos.length) b.push({ tipo: 'parrafo', texto: `Modelos de yacimiento compatibles con lo que hay: ${g.indicios.modelos.join(', ')}.` });
  b.push({
    tipo: 'nota',
    texto: `Un indicio no es un recurso.${g.escala ? ` El mapa geológico cargado es regional (${g.escala}, con un error de ubicación del orden de 1,6 km): sirve para decidir qué mirar, no para decidir dentro de una concesión.` : ''} Lo que sigue es cartografía 1:50 000, muestreo y geoquímica; si responde, geofísica y perforación.`,
  });
  if (g.faltan.length) b.push({ tipo: 'nota', texto: `Capas no cargadas (no se afirma ni se niega nada de ellas): ${g.faltan.join(', ')}.` });

  b.push(
    { tipo: 'seccion', texto: 'Zona' },
    {
      tipo: 'campos',
      filas: [
        ['Zona', g.zona.nombre],
        ['Tipo', g.zona.tipo],
        ['Superficie', `${nf(g.zona.ha, 0)} ha`],
        ['Punto interior', `${g.zona.lon.toFixed(5)}, ${g.zona.lat.toFixed(5)} (lon, lat · WGS84)`],
        ['Entorno mirado', `${g.radioKm} km alrededor`],
        ...(g.tectonica.provincias.length ? ([['Provincia geológica', g.tectonica.provincias.map((p) => p.nombre).join(' / ')]] as Array<[string, string]>) : []),
      ],
    }
  );

  /* --- rocas --- */
  b.push({ tipo: 'pagina' }, { tipo: 'seccion', texto: 'Rocas' });
  mapa(lito, 0, 'Mapa litológico generado en el servidor con las capas cargadas · UTM zona 16N.');
  if (g.litologia.dentro.length) {
    b.push({
      tipo: 'tabla',
      cabecera: ['Unidad', 'Descripción', 'Edad', 'Clase', 'ha', '%'],
      filas: g.litologia.dentro.slice(0, 20).map((u) => [u.unidad, u.descripcion, u.edad || '—', u.clase, nf(u.ha, 0), nf(u.pct)]),
      anchos: [44, 210, 90, 70, 45, 45],
    });
    if (g.litologia.coberturaPct < 98) b.push({ tipo: 'nota', texto: `El mapa cubre el ${nf(g.litologia.coberturaPct)} % de la zona; el resto no tiene unidad asignada.` });
  } else if (g.fuentes.litologia?.length) b.push({ tipo: 'parrafo', texto: 'El mapa geológico cargado no tiene unidades dentro de la zona.' });
  const i = g.intrusivos;
  if (g.fuentes.litologia?.length) {
    b.push({
      tipo: 'campos',
      filas: [
        ['Intrusivos dentro', i.dentro.length ? i.dentro.map((u) => `${u.unidad} (${nf(u.pct)} %)`).join(', ') : 'ninguno'],
        ['Intrusivos cerca', i.cerca.length ? i.cerca.slice(0, 4).map((u) => `${u.unidad} a ${km(u.km)}`).join(', ') : `ninguno a menos de ${g.radioKm} km`],
        ['Contacto intrusivo dentro', `${nf(i.kmContactoDentro)} km`],
        ['Contacto intrusivo–estratos marinos', i.kmContactoCarbonato > 0 ? `${nf(i.kmContactoCarbonato)} km en el entorno (ambiente de skarn)` : 'no hay en el entorno'],
      ],
    });
  }

  /* --- estructura --- */
  b.push({ tipo: 'pagina' }, { tipo: 'seccion', texto: 'Estructura' });
  mapa(estr, 1, 'Mapa estructural: fallas por cinemática, cruces y roseta de rumbos · UTM zona 16N.');
  const f = g.fallas;
  if (g.fuentes.falla?.length) {
    b.push({
      tipo: 'campos',
      filas: [
        ['Fallas que cruzan', f.dentro.length ? `${f.dentro.length}, ${nf(f.kmDentro)} km de traza dentro` : 'ninguna'],
        ['Densidad', f.densidad != null ? `${nf(f.densidad, 2)} km de falla por km²` : 'zona demasiado chica para medirla'],
        ['Rumbo dominante', f.rumbos.dominante ? `${f.rumbos.dominante} (concentración ${nf(f.rumbos.concentracion, 2)}, ${nf(f.rumbos.kmMedidos)} km medidos)` : 'sin fallas medidas en el entorno'],
        ['Familias', f.rumbos.familias.length ? f.rumbos.familias.map((x) => `${x.rumbo}: ${Math.round(x.peso * 100)} %`).join('; ') : '—'],
        ['Cruces de fallas', `${f.intersecciones.length} a menos de ${g.radioKm} km`],
        ['Falla activa más cercana', f.activaMasCercana ? `${f.activaMasCercana.nombre} (${f.activaMasCercana.tipo}), a ${km(f.activaMasCercana.km)}` : 'no hay fallas activas cargadas'],
      ],
    });
    const filas = [...f.dentro, ...f.cerca].slice(0, 18).map((x) => [x.nombre, x.tipo, x.activa ? 'sí' : 'no', x.kmDentro > 0 ? `${nf(x.kmDentro)} km dentro` : `a ${km(x.km)}`, x.capa]);
    if (filas.length) b.push({ tipo: 'tabla', cabecera: ['Falla', 'Tipo', 'Activa', 'Dónde', 'Fuente'], filas, anchos: [120, 120, 40, 80, 144] });
  }

  /* --- tectónica --- */
  b.push({ tipo: 'pagina' }, { tipo: 'seccion', texto: 'Marco geotectónico' });
  mapa(geot, 2, 'Mapa geotectónico regional: placas y límites (PB2002), provincias geológicas (USGS) y fallas activas (GEM).');
  if (g.tectonica.placas.length) {
    b.push({ tipo: 'tabla', cabecera: ['Límite de placa', 'Tipo', 'Distancia'], filas: g.tectonica.placas.map((p) => [p.nombre, p.tipo, `${nf(p.km, 0)} km`]), anchos: [150, 274, 80] });
  }

  /* --- recursos --- */
  b.push({ tipo: 'seccion', texto: 'Recursos conocidos y potencial' });
  for (const t of g.recursos.tractos) {
    b.push({
      tipo: 'parrafo',
      texto: `${t.nombre} (${nf(t.pct)} % de la zona; ${t.edad}). ${t.geologia} El USGS estima ${t.esperados || '?'} depósitos de pórfido de cobre por descubrir en todo el tracto (P50 ${t.p50 || '?'}, P10 ${t.p10 || '?'}; ${t.conocidos || '0'} conocidos). Es una estimación para el tracto entero, no para esta zona.`.replace(/(\d)\.(\d)/g, '$1,$2'),
    });
  }
  if (g.recursos.yacimientos.length) {
    b.push({
      tipo: 'tabla',
      cabecera: ['Yacimiento', 'Mineral', 'Tipo', 'Estado', 'Dónde'],
      filas: g.recursos.yacimientos.slice(0, 30).map((y) => [y.nombre, y.mineral || '—', y.tipo || '—', y.estado || '—', y.dentro ? 'dentro' : `a ${km(y.km)}`]),
      anchos: [130, 110, 110, 84, 70],
    });
  } else if (g.fuentes.ocurrencia?.length) b.push({ tipo: 'parrafo', texto: `Ningún yacimiento registrado a menos de ${g.radioKm} km.` });

  b.push({ tipo: 'seccion', texto: 'Cómo se llegó a los indicios' });
  b.push({
    tipo: 'tabla',
    cabecera: ['Criterio', 'Se cumple', 'Puntos', 'Evidencia'],
    filas: g.indicios.criterios.map((c) => [c.clave.replace(/_/g, ' '), c.cumple ? 'sí' : 'no', String(c.puntos), c.evidencia]),
    anchos: [90, 50, 40, 324],
  });
  b.push({ tipo: 'nota', texto: 'Alto con 7 puntos o más, medio de 4 a 6, bajo de 1 a 3. Son los criterios de la exploración regional en el bloque Chortís, cada uno con su razón a la vista, no una fórmula que decida por nadie.' });

  if (opts.lectura?.trim()) {
    b.push(
      { tipo: 'seccion', texto: 'Lectura de Dr Electrum' },
      { tipo: 'parrafo', texto: opts.lectura.trim().slice(0, 1800) },
      { tipo: 'nota', texto: 'Esta sección es interpretación. Todo lo demás sale de las capas cargadas y de PostGIS.' }
    );
  }
  const fuentes = Object.entries(g.fuentes).map(([rol, v]) => `${NOMBRE_ROL_GEO[rol] || rol}: ${v!.join(', ')}`);
  b.push(
    { tipo: 'regla' },
    { tipo: 'nota', texto: `Fuentes: ${fuentes.join(' · ')}. Geología y fallas: USGS OFR 97-470-K (dominio público). Fallas activas: GEM Global Active Faults (CC BY-SA 4.0). Límites de placa: PB2002, Bird 2003 (ODC-BY). Tractos y depósitos de pórfido: USGS SIR 2010-5090-I. Yacimientos: USGS MRDS y DEFOMIN.` },
    { tipo: 'nota', texto: 'Documento de demostración generado por Dr Electrum FP. No sustituye a una Persona Calificada ni a un informe firmado.' }
  );

  const pdf = documentoPdf({
    titulo: `Informe geológico — ${g.zona.nombre}`,
    subtitulo: `Rocas, estructura, tectónica y yacimientos · entorno de ${g.radioKm} km`,
    bloques: b,
    pie: pie(opts.quien || null),
    acento: AMBAR,
  });
  const dibujados = mapas.filter((m) => m && 'jpeg' in m).length;
  return {
    pdf,
    nombre: `geologia-${slug(g.zona.nombre) || 'zona'}.pdf`,
    dicho: `Armé el informe geológico de ${g.zona.nombre}: indicios ${g.indicios.nivel} (${g.indicios.puntos} puntos), con ${dibujados} de 3 mapas.`,
    tipo: 'application/pdf',
  };
}
