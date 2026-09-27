/**
 * EL INFORME — y de dónde salen sus números.
 *
 * La tentación evidente es pedirle al modelo que escriba el informe y volcarlo a un PDF. Sería
 * mucho menos código y estaría mal, por una razón que no es de estilo: **un PDF se firma, se
 * imprime y se lleva a una reunión.** El día que una cifra inventada sale con membrete, deja de
 * ser una respuesta desafortunada y pasa a ser un documento falso.
 *
 * Así que el reparto es estricto:
 *
 *   · Los DATOS salen del catastro y de las medidas sobre el elipsoide. Ni una cifra del modelo.
 *   · El MODELO aporta, como mucho, un párrafo de lectura, y el documento lo dice con todas sus
 *     letras: «Lectura de Dr Electrum», separado del resto. Quien lo lee sabe qué es medido y qué
 *     es opinión.
 *   · Las CONTRADICCIONES se buscan a propósito y van arriba, en un aviso. Un informe que esconde
 *     que el padrón se contradice es peor que no tener informe.
 *
 * Es el mismo principio del canal `ui` de las manos: el modelo pide, el servidor construye.
 */
import { areaHectareas, perimetroKm } from './gis';
import {
  buscarConcesiones,
  buscarEnExpedientes,
  consulta,
  geometriaDe,
  hayBase,
  coberturaDeFechas,
  contarPorVencer,
  porVencer,
  resumenTraslapes,
  traslapes,
  traslapesDe,
  distinguir,
  unicaExacta,
  type FilaConcesion,
} from './db';
import { documentoPdf, medirJpeg, type Bloque } from '../../lib/pdf';
import { entornoDe, NOMBRE_ROL, pct, RADIO_LEJOS_M, RADIO_POBLADOS_M, type Entorno, type Seccion } from './entorno';
import { planoConcesion } from './plano';

export const AMBAR: [number, number, number] = [1, 0.68, 0.23];

const nf = (n: number, d = 2) =>
  new Intl.NumberFormat('es-ES', { minimumFractionDigits: d, maximumFractionDigits: d }).format(n);

function fecha(d = new Date()): string {
  return new Intl.DateTimeFormat('es-ES', { dateStyle: 'long', timeZone: 'America/Tegucigalpa' }).format(d);
}

export function pie(quien: string | null): string {
  const q = quien ? ` · a petición de ${quien}` : '';
  return `Dr Electrum FP · ${fecha()}${q} · documento de demostración`;
}

const dias = (n: number) => `${n} ${n === 1 ? 'día' : 'días'}`;

/** Días hasta la fecha. Negativo = ya pasó. */
function diasHasta(iso: string | null): number | null {
  if (!iso) return null;
  const t = Date.parse(`${iso}T00:00:00Z`);
  if (!isFinite(t)) return null;
  /*
   * Días de CALENDARIO en Honduras, no horas partidas por veinticuatro. Antes se restaba la hora de
   * ahora a la medianoche UTC del vencimiento y se redondeaba: por la tarde la ficha decía «pasó
   * hace 969 días» mientras la herramienta del chat, que cuenta en la base, decía 968. Dos cifras
   * distintas para la misma fecha, en el mismo turno.
   */
  const hoy = Date.parse(`${new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Tegucigalpa' }).format(new Date())}T00:00:00Z`);
  return Math.round((t - hoy) / 86_400_000);
}

/**
 * Lo que el padrón dice y no encaja. Se busca a propósito porque es lo que un informe tiene que
 * levantar: nadie abre un PDF de cuarenta concesiones a comprobar fechas a mano.
 */
export function contradicciones(c: FilaConcesion): string[] {
  const avisos: string[] = [];
  const d = diasHasta(c.vence);
  const estado = String(c.estado || '').toLowerCase();

  if (d !== null && d < 0 && /vigent/.test(estado)) {
    avisos.push(
      `El padrón la da por VIGENTE pero la fecha de vencimiento (${c.vence}) pasó hace ${dias(Math.abs(d))}. Una de las dos cosas está mal: no afirmar la vigencia sin el expediente delante.`
    );
  }
  if (d !== null && d >= 0 && d <= 180 && /vigent/.test(estado)) {
    avisos.push(`Vence el ${c.vence}, dentro de ${dias(d)}. Si hay que renovar, el trámite se empieza ahora, no en la última semana.`);
  }
  if (c.hectareas != null && c.hectareas_dec != null) {
    const dif = Math.abs(c.hectareas - c.hectareas_dec);
    // Medio por ciento es más de lo que explica el redondeo de un plano: ahí hay un lindero movido.
    if (c.hectareas_dec > 0 && dif / c.hectareas_dec > 0.005) {
      avisos.push(
        `El área medida sobre la geometría (${nf(c.hectareas)} ha) no coincide con la declarada en el padrón (${nf(c.hectareas_dec)} ha): ${nf(dif)} ha de diferencia. Hay que mirar el plano.`
      );
    }
  }
  if (!c.titular) avisos.push('No tiene titular declarado en el padrón.');
  return avisos;
}

/* ------------------------------------------------------------------ concesión */

export type OpcionesInforme = {
  /** Quién lo pidió, para el pie. */
  quien?: string | null;
  /** Párrafo del modelo. Va etiquetado como lectura, nunca mezclado con los datos. */
  lectura?: string;
  /** Captura del mapa en JPEG, tal como la da el lienzo de MapLibre. */
  mapa?: Buffer;
};

function fichaCampos(c: FilaConcesion): Array<[string, string]> {
  const filas: Array<[string, string]> = [
    ['Expediente', c.expediente || 'sin número'],
    ['Titular', c.titular || 'no declarado'],
    ['Tipo', c.tipo ? `Concesión de ${c.tipo}` : 'no declarado'],
    ['Mineral', c.mineral || 'no declarado'],
  ];
  const lugar = [c.municipio, c.departamento].filter(Boolean).join(', ');
  if (lugar) filas.push(['Ubicación', lugar]);
  filas.push(['Estado', c.estado || 'no declarado']);
  if (c.otorgada) filas.push(['Otorgada', c.otorgada]);
  if (c.vence) {
    const d = diasHasta(c.vence);
    filas.push(['Vence', d === null ? c.vence : d < 0 ? `${c.vence} (venció hace ${dias(-d)})` : d === 0 ? `${c.vence} (hoy)` : `${c.vence} (en ${dias(d)})`]);
  }
  return filas;
}

/**
 * Un documento listo para recoger. `pdf` son los bytes, sean de un PDF o —con `tipo` 'image/jpeg'—
 * de un mapa: los mapas geológicos viajan por el mismo almacén, con el mismo dueño y la misma
 * caducidad, y Telegram los manda como foto en vez de como archivo.
 */
export type Informe = { pdf: Buffer; nombre: string; dicho: string; tipo?: 'application/pdf' | 'image/jpeg' };

/* ------------------------------------------------------------------ entorno en la ficha */

const km = (k: number) => (k < 1 ? `${Math.round(k * 1000)} m` : `${nf(k, 1)} km`);
const ha = (h: number) => `${nf(h, h >= 100 ? 0 : 2)} ha`;

/**
 * Lo que se dice cuando un cruce no se pudo hacer. «No cargada» y «no hay» son cosas opuestas:
 * la primera es que falta el dato, la segunda es una respuesta. La ficha nunca dice la segunda sin
 * haber tenido la capa delante.
 */
function sinCruce(s: Seccion<object>, que: string): Bloque | null {
  if (s.estado === 'no-cargada') {
    return { tipo: 'parrafo', texto: `Capa de ${que} no cargada: este cruce no se hizo. No quiere decir que no haya; quiere decir que no se sabe.` };
  }
  if (s.estado === 'error') return { tipo: 'parrafo', texto: `No se pudo cruzar con la capa de ${que} (${s.motivo}). El resto de la ficha no depende de esto.` };
  return null;
}

/**
 * ¿El padrón y la geometría dicen el mismo municipio? El padrón lo escribió alguien; la geometría
 * cae donde cae. Si no coinciden, una de las dos está mal, y eso va arriba.
 */
export function municipioContradice(padron: string | null, e: Entorno | null): string | null {
  if (!padron || !e || e.municipios.estado !== 'ok' || !e.municipios.lista.length) return null;
  const p = normal(padron);
  const toca = e.municipios.lista.map((m) => m.nombre);
  if (toca.some((m) => normal(m).includes(p) || p.includes(normal(m)))) return null;
  return `El padrón la ubica en el municipio de ${padron}, pero su geometría cae en ${toca.join(', ')} según la capa de municipios. Una de las dos cosas está mal: hay que mirar el plano o el expediente.`;
}

/** Las secciones de entorno de la ficha. Las cifras salen todas de `entornoDe`. */
function bloquesEntorno(e: Entorno): Bloque[] {
  const b: Bloque[] = [];

  /* --- ubicación administrativa --- */
  b.push({ tipo: 'seccion', texto: 'Ubicación según las capas' });
  const filas: Array<[string, string]> = [];
  for (const [etq, s] of [['Municipio', e.municipios], ['Departamento', e.departamentos]] as const) {
    if (s.estado === 'ok') filas.push([etq, s.lista.length ? s.lista.map((m) => (s.lista.length > 1 ? `${m.nombre} (${pct(m.pct)})` : m.nombre)).join(', ') : 'fuera de todos los de la capa']);
    else filas.push([etq, s.estado === 'no-cargada' ? 'capa no cargada' : `no se pudo cruzar (${s.motivo})`]);
  }
  b.push({ tipo: 'campos', filas });

  /* --- áreas protegidas, microcuencas y patrimonio forestal --- */
  b.push({ tipo: 'seccion', texto: 'Áreas protegidas, microcuencas y bosque' });
  const pisadas: string[][] = [];
  const faltan: Bloque[] = [];
  for (const [que, s] of [
    ['Área protegida', e.areasProtegidas],
    ['Microcuenca declarada', e.microcuencas],
    ['Patrimonio forestal', e.forestal],
  ] as const) {
    if (s.estado === 'ok') for (const p of s.pisa) pisadas.push([que, p.nombre, ha(p.ha), pct(p.pct)]);
    else {
      const x = sinCruce(s, que === 'Área protegida' ? 'áreas protegidas' : que === 'Microcuenca declarada' ? 'microcuencas declaradas' : 'patrimonio forestal');
      if (x) faltan.push(x);
    }
  }
  if (pisadas.length) {
    b.push({ tipo: 'tabla', cabecera: ['Pisa', 'Nombre', 'Superficie pisada', '% de la concesión'], anchos: [1.4, 2.4, 1.1, 1.1], filas: pisadas });
  } else if (faltan.length < 3) {
    b.push({ tipo: 'parrafo', texto: 'No pisa ninguna de las áreas cargadas de estas capas.' });
  }
  if (e.areasProtegidas.estado === 'ok' && e.areasProtegidas.cerca.length) {
    b.push({
      tipo: 'tabla',
      cabecera: [`Áreas protegidas a menos de ${RADIO_LEJOS_M / 1000} km`, 'Distancia al lindero'],
      anchos: [3, 1],
      filas: e.areasProtegidas.cerca.map((c) => [c.nombre, km(c.km)]),
    });
  }
  b.push(...faltan);

  /* --- agua --- */
  b.push({ tipo: 'seccion', texto: 'Ríos y quebradas' });
  if (e.rios.estado === 'ok') {
    if (e.rios.kmDentro > 0) {
      b.push({ tipo: 'campos', filas: [['Cauce dentro', `${km(e.rios.kmDentro)} en total`]] });
      b.push({
        tipo: 'tabla',
        cabecera: ['Cauce', 'Longitud dentro'],
        anchos: [3, 1],
        filas: e.rios.tramos.map((t) => [t.nombre || 'sin nombre en la capa', km(t.km)]),
      });
    } else {
      b.push({
        tipo: 'parrafo',
        texto: e.rios.masCercano
          ? `No la cruza ningún cauce de la red hídrica cargada. El más cercano es ${e.rios.masCercano.nombre}, a ${km(e.rios.masCercano.km)}.`
          : 'No la cruza ningún cauce de la red hídrica cargada.',
      });
    }
  } else b.push(sinCruce(e.rios, 'red hídrica')!);

  /* --- gente --- */
  b.push({ tipo: 'seccion', texto: 'Caseríos y aldeas' });
  if (e.poblados.estado === 'ok') {
    const p = e.poblados;
    if (!p.dentro && !p.cerca) {
      b.push({ tipo: 'parrafo', texto: `Ningún caserío ni aldea de las capas cargadas dentro ni a menos de ${RADIO_POBLADOS_M / 1000} km del lindero.` });
    } else {
      b.push({
        tipo: 'campos',
        filas: [
          ['Dentro', String(p.dentro)],
          [`A menos de ${RADIO_POBLADOS_M / 1000} km`, String(p.cerca)],
          ...(p.poblacionDentro ? ([['Población dentro', `${nf(p.poblacionDentro, 0)} personas (según la capa)`]] as Array<[string, string]>) : []),
        ],
      });
      b.push({
        tipo: 'tabla',
        cabecera: ['Nombre', 'Tipo', 'Dónde', 'Población'],
        anchos: [2.4, 1, 1.2, 1],
        filas: p.lista.map((x) => [x.nombre, x.tipo, x.dentro ? 'dentro' : `a ${km(x.km)}`, x.poblacion != null ? nf(x.poblacion, 0) : '—']),
      });
      if (p.dentro + p.cerca > p.lista.length) b.push({ tipo: 'nota', texto: `La tabla trae los ${p.lista.length} más cercanos; las cifras de arriba cuentan todos.` });
    }
  } else b.push(sinCruce(e.poblados, 'caseríos y aldeas')!);

  /* --- acceso y minería alrededor --- */
  b.push({ tipo: 'seccion', texto: 'Acceso y minería alrededor' });
  const acceso: Array<[string, string]> = [];
  if (e.carretera.estado === 'ok') {
    acceso.push([
      'Carretera',
      e.carretera.km == null
        ? 'la capa no tiene ningún tramo'
        : e.carretera.km === 0
          ? `la ${e.carretera.franja ? 'franja de carretera' : 'carretera'} toca la concesión`
          : `a ${km(e.carretera.km)}${e.carretera.franja ? ' del borde de la franja (la capa es un buffer, no el eje)' : ''}`,
    ]);
  } else acceso.push(['Carretera', e.carretera.estado === 'no-cargada' ? 'capa no cargada' : `no se pudo cruzar (${e.carretera.motivo})`]);
  b.push({ tipo: 'campos', filas: acceso });
  const alrededor: string[][] = [];
  for (const [que, s] of [
    ['Zona de minería informal', e.zonasInformales],
    ['Yacimiento u ocurrencia', e.ocurrencias],
  ] as const) {
    if (s.estado === 'ok') for (const x of s.lista) alrededor.push([que, x.nombre + (x.detalle ? ` (${x.detalle})` : ''), x.dentro ? 'dentro' : `a ${km(x.km)}`]);
  }
  if (alrededor.length) {
    b.push({ tipo: 'tabla', cabecera: [`A menos de ${RADIO_LEJOS_M / 1000} km`, 'Nombre', 'Dónde'], anchos: [1.6, 2.6, 1], filas: alrededor });
  }
  for (const [s, que] of [
    [e.zonasInformales, 'zonas de minería informal'],
    [e.ocurrencias, 'yacimientos y ocurrencias'],
  ] as const) {
    if (s.estado === 'ok' && !s.lista.length) b.push({ tipo: 'parrafo', texto: `Ninguna de la capa de ${que} a menos de ${RADIO_LEJOS_M / 1000} km.` });
    const x = sinCruce(s, que);
    if (x) b.push(x);
  }

  /* --- de dónde sale --- */
  const fuentes = Object.values(e.capas).flat();
  b.push({
    tipo: 'nota',
    texto:
      `Cruces hechos en PostGIS sobre la geometría de la concesión; superficies y distancias medidas sobre el elipsoide WGS84. ` +
      (fuentes.length ? `Capas usadas: ${fuentes.join(', ')}. ` : '') +
      (e.faltan.length ? `No cargadas: ${e.faltan.map((r) => NOMBRE_ROL[r]).join(', ')}. ` : '') +
      'Vale para lo cargado en esta plataforma y a la fecha de cada capa.',
  });
  return b;
}

/** Minúsculas, sin tildes y con los espacios juntos: para comparar nombres como los escribe la gente. */
function normal(t: string): string {
  return t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * ¿Este trozo habla de ESTA concesión?
 *
 * La búsqueda en expedientes es de palabras: para «San José de las Palmas» encuentra también un
 * reglamento con «San Pedro Sula», «José Trinidad Reyes» y unas palmas tres renglones más abajo. En
 * el chat eso es una pista; en una ficha que se imprime y se firma, es una cita falsa con membrete.
 * En la ficha solo entra lo que nombra a la concesión tal cual.
 */
export function citaDe(texto: string, nombre: string): boolean {
  const n = normal(nombre);
  return n.length >= 3 && normal(texto).includes(n);
}

export async function informeConcesion(
  ref: { id?: number; nombre?: string },
  opts: OpcionesInforme = {}
): Promise<Informe | { error: string }> {
  if (!hayBase()) return { error: 'El catastro no está conectado, así que no puedo armar el informe.' };

  let fila: FilaConcesion | undefined;
  if (ref.id != null) {
    [fila] = await consulta<FilaConcesion>(
      `SELECT id, expediente, nombre, titular, departamento, municipio, tipo, mineral, estado,
              to_char(otorgada,'YYYY-MM-DD') AS otorgada, to_char(vence,'YYYY-MM-DD') AS vence,
              hectareas::float8 AS hectareas, hectareas_dec::float8 AS hectareas_dec
       FROM concesion WHERE id = $1`,
      [ref.id]
    );
  } else if (ref.nombre) {
    const hits = await buscarConcesiones(ref.nombre, 6);
    // La que se nombró tal cual gana; si hay varias que se llaman igual, se dice cuál es cuál.
    const elegida = hits.length === 1 ? hits[0] : unicaExacta(hits, ref.nombre);
    if (!elegida && hits.length > 1) {
      return { error: `Coinciden ${hits.length}: ${hits.map(distinguir).join('; ')}. Pedí la ficha por su id o su expediente.` };
    }
    fila = elegida || undefined;
  }
  if (!fila) return { error: `No encontré esa concesión en el catastro. No voy a armar un informe de algo que no tengo.` };

  /*
   * La geometría, el entorno y el plano, a la vez: son independientes, y en serie la ficha tardaba
   * la suma. Si el entorno o el plano fallan, la ficha sale igual y lo dice; no se cae entera
   * porque una capa trae un polígono roto.
   */
  const f = fila;
  const [geo, entorno, plano] = await Promise.all([
    geometriaDe(f.id),
    entornoDe(f.id).catch((e) => {
      console.error('[electrum] entorno de', f.id, String(e?.message || e).slice(0, 200));
      return null;
    }),
    planoConcesion(f.id, {
      subtitulo: [f.expediente ? `Expediente ${f.expediente}` : null, f.titular || 'sin titular declarado'].filter(Boolean).join(' · '),
      pie: `Dr Electrum FP · ${fecha()}`,
    }).catch((e) => ({ error: String(e?.message || e).slice(0, 160) })),
  ]);

  const bloques: Bloque[] = [];
  const avisos = contradicciones(fila);
  const otroMunicipio = municipioContradice(fila.municipio, entorno);
  if (otroMunicipio) avisos.push(otroMunicipio);
  if (avisos.length) for (const a of avisos) bloques.push({ tipo: 'aviso', texto: a });
  // Las alertas del entorno, juntas en un solo aviso: diez cajas seguidas no se leen, una lista sí.
  if (entorno?.alertas.length) bloques.push({ tipo: 'aviso', texto: `Entorno:\n${entorno.alertas.map((a) => `· ${a}`).join('\n')}` });

  bloques.push({ tipo: 'seccion', texto: 'Identificación' }, { tipo: 'campos', filas: fichaCampos(fila) });

  /* --- geometría: lo único que este informe mide por su cuenta --- */
  if (geo) {
    const ha = areaHectareas(geo.geojson);
    const km = perimetroKm(geo.geojson);
    bloques.push(
      { tipo: 'seccion', texto: 'Geometría medida' },
      {
        tipo: 'campos',
        filas: [
          ['Área', `${nf(ha)} hectáreas`],
          ['Perímetro', `${nf(km)} km`],
          // Con el sistema dicho: una coordenada sin datum es la mitad de una coordenada.
          ['Punto interior', `${geo.centro[0].toFixed(5)}, ${geo.centro[1].toFixed(5)} (lon, lat · WGS84, EPSG:4326)`],
        ],
      },
      {
        tipo: 'nota',
        texto:
          'El área se calcula sobre la esfera autálica del elipsoide WGS84, no sobre una esfera de radio medio. A la latitud de Honduras la diferencia ronda el 0,37 %: sobre cuatrocientas hectáreas, hectárea y media. Suficiente para mover un canon o una discusión de linderos.',
      }
    );
    if (opts.mapa?.length) {
      const m = medirJpeg(opts.mapa);
      if (m) bloques.push({ tipo: 'imagen', jpeg: opts.mapa, ancho: m.ancho, alto: m.alto, pie: `${fila.nombre} — vista del mapa al momento del informe.` });
    }
    /*
     * El plano técnico va SIEMPRE, venga o no la captura del navegador: la captura es lo que se
     * estaba mirando; el plano tiene cuadrícula, escala y norte, y es lo que sirve para ubicarse.
     * Por Telegram no hay navegador, y antes la ficha salía sin ningún mapa.
     */
    if (plano && 'jpeg' in plano) {
      bloques.push(
        { tipo: 'seccion', texto: 'Plano de situación' },
        { tipo: 'imagen', jpeg: plano.jpeg, ancho: plano.ancho, alto: plano.alto, altoMax: 520, pie: 'Plano generado en el servidor con el catastro y las capas cargadas · UTM zona 16N.' }
      );
    } else if (plano && 'error' in plano) {
      bloques.push({ tipo: 'nota', texto: `No se pudo dibujar el plano de situación (${plano.error}). Los datos de la ficha no dependen de él.` });
    }
  } else {
    bloques.push({ tipo: 'seccion', texto: 'Geometría medida' }, { tipo: 'parrafo', texto: 'Esta concesión no tiene geometría cargada, así que no hay área medida ni mapa. Lo que diga el padrón sobre hectáreas está sin comprobar.' });
  }

  if (entorno) bloques.push(...bloquesEntorno(entorno));

  /* --- traslapes que le toquen --- */
  const suyos = await traslapesDe(fila.id);
  bloques.push({ tipo: 'seccion', texto: 'Traslapes' });
  if (!suyos.length) {
    bloques.push({ tipo: 'parrafo', texto: 'No se pisa con ninguna otra concesión de las cargadas. Esto vale para lo que hay en el catastro, no para lo que no se ha subido.' });
  } else {
    bloques.push({
      tipo: 'tabla',
      cabecera: ['Se pisa con', 'Hectáreas en común'],
      anchos: [3, 1],
      filas: suyos.map((t) => [t.a_id === fila!.id ? t.b : t.a, nf(t.hectareas)]),
    });
  }

  /* --- lo que digan los expedientes, citado con página --- */
  // Se piden más de los que caben y se quedan solo los que nombran a la concesión: ver `citaDe`.
  const hits = (await buscarEnExpedientes(fila.nombre, 12).catch(() => []))
    .filter((h) => citaDe(h.texto, fila!.nombre))
    .slice(0, 4);
  if (hits.length) {
    bloques.push({ tipo: 'seccion', texto: 'En los expedientes' });
    for (const h of hits) {
      bloques.push({
        tipo: 'cita',
        texto: h.texto.replace(/\s+/g, ' ').slice(0, 480),
        fuente: `${h.documento}${h.pagina ? `, página ${h.pagina}` : ''}`,
      });
    }
  }

  if (opts.lectura?.trim()) {
    bloques.push(
      { tipo: 'seccion', texto: 'Lectura de Dr Electrum' },
      { tipo: 'parrafo', texto: opts.lectura.trim().slice(0, 1800) },
      { tipo: 'nota', texto: 'Esta sección es interpretación, no medida. Todo lo anterior sale del catastro y de la geometría; esto sale de quien lo lee.' }
    );
  }

  bloques.push(
    { tipo: 'regla' },
    {
      tipo: 'nota',
      texto:
        'Documento de demostración generado por Dr Electrum FP. No sustituye a una Persona Calificada ni a un informe firmado, y no vale como constancia registral. Los datos son los del catastro cargado en esta plataforma.',
    }
  );

  const pdf = documentoPdf({
    titulo: `Ficha de concesión — ${fila.nombre}`,
    subtitulo: `${fila.expediente ? `Expediente ${fila.expediente} · ` : ''}${fila.titular || 'sin titular declarado'}`,
    bloques,
    pie: pie(opts.quien || null),
    acento: AMBAR,
  });

  return {
    pdf,
    nombre: `ficha-${(fila.expediente || fila.nombre).replace(/[^\w.-]+/g, '-').toLowerCase()}.pdf`,
    dicho: `Armé la ficha de ${fila.nombre}${avisos.length ? `, con ${avisos.length} ${avisos.length === 1 ? 'aviso' : 'avisos'} arriba` : ''}${
      suyos.length ? ` y ${suyos.length} ${suyos.length === 1 ? 'traslape' : 'traslapes'}` : ''
    }${entorno?.alertas.length ? `; el entorno deja ${entorno.alertas.length} ${entorno.alertas.length === 1 ? 'alerta' : 'alertas'}` : ''}${
      plano && 'jpeg' in plano ? ', con el plano de situación' : ''
    }.`,
  };
}

/* ------------------------------------------------------------------ cartera */

/** El estado de todo lo cargado: cuánto hay, qué vence y qué se pisa. */
export async function informeCartera(opts: OpcionesInforme = {}): Promise<Informe | { error: string }> {
  if (!hayBase()) return { error: 'El catastro no está conectado, así que no hay cartera que informar.' };

  const [resumen] = await consulta<{ total: number; con_geom: number; hectareas: number; titulares: number }>(
    `SELECT count(*)::int AS total,
            count(geom)::int AS con_geom,
            coalesce(sum(hectareas),0)::float8 AS hectareas,
            count(DISTINCT titular)::int AS titulares
     FROM concesion`
  );
  if (!resumen || !resumen.total) return { error: 'No hay ninguna concesión cargada todavía. Súbanme el catastro y lo armo.' };

  // La tabla lleva los primeros; las cifras que se afirman salen de contar todo, no del largo de la tabla.
  const vencen = await porVencer(365, 60);
  const totalVencen = await contarPorVencer(365);
  /*
   * `porVencer` trae también las YA vencidas —de hace un mes o de hace diez años—, que es lo que
   * hay que mirar primero. Pero contarlas como «vencen dentro del año» era falso: una concesión
   * caducada en 2019 no vence este año. Se cuentan aparte y se dicen aparte.
   */
  const yaVencidas = await contarPorVencer(-1);
  const vencenEnElAnio = totalVencen - yaVencidas;
  const cobertura = await coberturaDeFechas();
  const pisadas = await traslapes(60);
  const pisan = await resumenTraslapes();
  const porEstado = await consulta<{ estado: string | null; n: number; ha: number }>(
    `SELECT estado, count(*)::int AS n, coalesce(sum(hectareas),0)::float8 AS ha
     FROM concesion GROUP BY estado ORDER BY n DESC`
  );

  const bloques: Bloque[] = [
    { tipo: 'seccion', texto: 'Lo que hay cargado' },
    {
      tipo: 'campos',
      filas: [
        ['Concesiones', `${resumen.total}`],
        ['Con geometría', `${resumen.con_geom} de ${resumen.total}`],
        ['Área total medida', `${nf(resumen.hectareas)} hectáreas`],
        ['Titulares distintos', `${resumen.titulares}`],
      ],
    },
  ];

  if (resumen.con_geom < resumen.total) {
    bloques.push({
      tipo: 'aviso',
      texto: (() => {
        const n = resumen.total - resumen.con_geom;
        return `${n} ${n === 1 ? 'concesión no tiene geometría' : 'concesiones no tienen geometría'}: de ${n === 1 ? 'esa' : 'esas'} no hay área medida ni se pueden comprobar traslapes. Lo que ${n === 1 ? 'diga' : 'digan'} sus hectáreas está sin verificar.`;
      })(),
    });
  }

  bloques.push(
    { tipo: 'seccion', texto: 'Por estado' },
    {
      tipo: 'tabla',
      cabecera: ['Estado', 'Concesiones', 'Hectáreas'],
      anchos: [2, 1, 1.2],
      filas: porEstado.map((e) => [e.estado || 'no declarado', String(e.n), nf(e.ha)]),
    }
  );

  if (opts.mapa?.length) {
    const m = medirJpeg(opts.mapa);
    if (m) {
      bloques.push(
        { tipo: 'seccion', texto: 'El mapa' },
        { tipo: 'imagen', jpeg: opts.mapa, ancho: m.ancho, alto: m.alto, pie: 'Vista del catastro tal como estaba al pedir el informe.' }
      );
    }
  }

  bloques.push({ tipo: 'seccion', texto: 'Vencidas y por vencer en los próximos 365 días' });
  if (!vencen.length && !cobertura.conVence && cobertura.total) {
    /*
     * Un padrón sin fechas y un padrón donde de verdad no vence nada dan la misma lista vacía, y
     * son noticias opuestas: la primera dice que falta un dato, la segunda tranquiliza. Firmar un
     * informe diciendo «nada vence dentro del año» cuando en realidad no se sabe es exactamente la
     * clase de frase por la que después nadie vuelve a creerse el informe entero.
     */
    bloques.push({
      tipo: 'aviso',
      texto:
        `No se puede decir: ninguna de las ${cobertura.total} concesiones del padrón trae fecha de vencimiento. ` +
        `El archivo cargado no incluye esa columna, así que esta sección no es «no vence nada», es «no se sabe».`,
    });
  } else if (!vencen.length) {
    bloques.push({ tipo: 'parrafo', texto: 'Nada vence dentro del año. Esto sale de la fecha del padrón; si una fecha está mal cargada, acá no se ve.' });
  } else {
    bloques.push(
      {
        tipo: 'aviso',
        texto:
          `${vencenEnElAnio} ${vencenEnElAnio === 1 ? 'concesión vence' : 'concesiones vencen'} dentro del año` +
          (yaVencidas ? ` y ${yaVencidas} ${yaVencidas === 1 ? 'ya está vencida' : 'ya están vencidas'} (van primero, con los días en negativo)` : '') +
          '.' +
          (totalVencen > vencen.length ? ` La tabla trae las ${vencen.length} más urgentes.` : ''),
      },
      {
        tipo: 'tabla',
        cabecera: ['Concesión', 'Titular', 'Vence', 'Días', 'Hectáreas'],
        anchos: [2, 2, 1.1, 0.6, 0.9],
        filas: vencen.map((v) => [v.nombre, v.titular || 'no declarado', v.vence || '—', String(v.dias), v.hectareas != null ? nf(v.hectareas) : '—']),
      }
    );
  }

  bloques.push({ tipo: 'seccion', texto: 'Traslapes' });
  if (!pisadas.length) {
    bloques.push({ tipo: 'parrafo', texto: 'Ninguna concesión cargada se pisa con otra.' });
  } else {
    bloques.push(
      {
        tipo: 'aviso',
        texto:
          `Hay ${pisan.total} ${pisan.total === 1 ? 'traslape' : 'traslapes'}, ${nf(pisan.hectareas)} hectáreas en común` +
          `${pisan.ajenos ? `; ${pisan.ajenos} entre titulares distintos` : ''}. ` +
          `Un traslape es un conflicto de derechos hasta que alguien demuestre prelación.` +
          (pisan.total > pisadas.length ? ` La tabla trae los ${pisadas.length} mayores.` : ''),
      },
      {
        tipo: 'tabla',
        cabecera: ['Concesión', 'Se pisa con', 'Hectáreas'],
        anchos: [2, 2, 1],
        filas: pisadas.map((t) => [t.a, t.b, nf(t.hectareas)]),
      }
    );
  }

  if (opts.lectura?.trim()) {
    bloques.push(
      { tipo: 'seccion', texto: 'Lectura de Dr Electrum' },
      { tipo: 'parrafo', texto: opts.lectura.trim().slice(0, 1800) },
      { tipo: 'nota', texto: 'Esta sección es interpretación, no medida. Todo lo anterior sale del catastro.' }
    );
  }

  bloques.push(
    { tipo: 'regla' },
    {
      tipo: 'nota',
      texto:
        'Documento de demostración generado por Dr Electrum FP. Cubre únicamente lo cargado en esta plataforma: lo que no se ha subido no aparece, y su ausencia no significa que no exista.',
    }
  );

  const pdf = documentoPdf({
    titulo: 'Estado de la cartera minera',
    subtitulo: `${resumen.total} concesiones · ${nf(resumen.hectareas)} hectáreas medidas · ${fecha()}`,
    bloques,
    pie: pie(opts.quien || null),
    acento: AMBAR,
  });

  return {
    pdf,
    nombre: `cartera-${new Date().toISOString().slice(0, 10)}.pdf`,
    dicho: `Armé el informe de cartera: ${resumen.total} concesiones, ${nf(resumen.hectareas)} hectáreas, ${cobertura.total && !cobertura.conVence ? 'sin fechas de vencimiento en el padrón' : `${vencenEnElAnio} por vencer${yaVencidas ? ` (más ${yaVencidas} ya ${yaVencidas === 1 ? 'vencida' : 'vencidas'})` : ''}`} y ${pisan.total} ${pisan.total === 1 ? 'traslape' : 'traslapes'}.`,
  };
}

/* ------------------------------------------------------------------ conversación */

type MsgConversacion = { role: 'user' | 'assistant'; content: string };

const URL = /https?:\/\/[^\s)>\]»"']+/g;

/**
 * El informe de una conversación: lo que Dr Electrum YA respondió, puesto en un PDF.
 *
 * Nació de un pedido real por Telegram: después de investigar dónde hay caliza coralina, «hacerme
 * un pdf». La herramienta solo sabía armar la ficha de una concesión o la cartera, y el turno
 * terminó sin respuesta. Esto no rompe el reparto de arriba: el modelo no escribe el documento. Se
 * copian tal cual las respuestas que ya se dieron (ya las leyó quien pregunta), con su pregunta al
 * lado, y las direcciones que se citaron. Lo único del modelo es, si quiere, la lectura rotulada.
 */
export function informeConversacion(
  opts: OpcionesInforme & { titulo?: string; historial: MsgConversacion[] }
): Informe | { error: string } {
  const hist = (opts.historial || []).filter((m) => String(m.content || '').trim());
  const pares: Array<{ pregunta: string; respuesta: string }> = [];
  for (let i = 0; i < hist.length; i++) {
    if (hist[i].role !== 'assistant') continue;
    const previa = hist[i - 1]?.role === 'user' ? hist[i - 1].content : '';
    pares.push({ pregunta: previa.trim(), respuesta: hist[i].content.trim() });
  }
  if (!pares.length) return { error: 'Todavía no hay nada conversado que poner en un PDF. Preguntame primero y después te lo armo.' };
  const ultimos = pares.slice(-12);

  const fuentes = [...new Set(hist.flatMap((m) => m.content.match(URL) || []).map((u) => u.replace(/[.,;:]+$/, '')))].slice(0, 30);

  const bloques: Bloque[] = [{ tipo: 'seccion', texto: 'Lo conversado' }];
  for (const p of ultimos) {
    if (p.pregunta) bloques.push({ tipo: 'nota', texto: `Pregunta: ${p.pregunta.slice(0, 600)}` });
    bloques.push({ tipo: 'parrafo', texto: p.respuesta });
  }
  if (fuentes.length) {
    bloques.push({ tipo: 'seccion', texto: 'Fuentes citadas' }, { tipo: 'tabla', cabecera: ['Dirección'], filas: fuentes.map((u) => [u]) });
  }
  if (opts.lectura?.trim()) {
    bloques.push(
      { tipo: 'seccion', texto: 'Lectura de Dr Electrum' },
      { tipo: 'parrafo', texto: opts.lectura.trim().slice(0, 1800) },
      { tipo: 'nota', texto: 'Esta sección es interpretación, escrita para este documento.' }
    );
  }
  bloques.push(
    { tipo: 'regla' },
    {
      tipo: 'nota',
      texto:
        'Recopila, tal cual, lo que Dr Electrum respondió en esta conversación: no agrega cifras. Lo que viene de internet va con su dirección y no está verificado contra el catastro; lo que no se subió a la plataforma no aparece.',
    }
  );

  const titulo = String(opts.titulo || '').trim().slice(0, 90) || 'Conversación con Dr Electrum';
  const n = ultimos.length;
  const pdf = documentoPdf({
    titulo,
    subtitulo: `${n} ${n === 1 ? 'respuesta' : 'respuestas'}${fuentes.length ? ` · ${fuentes.length} ${fuentes.length === 1 ? 'fuente citada' : 'fuentes citadas'}` : ''} · ${fecha()}`,
    bloques,
    pie: pie(opts.quien || null),
    acento: AMBAR,
  });
  const archivo = titulo
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 50);
  return {
    pdf,
    nombre: `${archivo || 'conversacion'}-${new Date().toISOString().slice(0, 10)}.pdf`,
    dicho: `Armé el PDF con lo que venimos conversando: ${n} ${n === 1 ? 'respuesta' : 'respuestas'}${fuentes.length ? ` y ${fuentes.length} ${fuentes.length === 1 ? 'fuente citada' : 'fuentes citadas'}` : ''}.`,
  };
}

/* ------------------------------------------------------------------ entrega */

/**
 * Los informes recién hechos, a la espera de que alguien los recoja.
 *
 * No van en la respuesta JSON: un PDF de cartera con cuarenta concesiones son un par de cientos de
 * kilobytes, y en base64 casi el doble, metidos en el mismo cuerpo que el texto de la respuesta.
 * Se guarda en memoria unos minutos y se entrega por su URL, que además es lo que necesita Telegram
 * para mandarlo como archivo.
 *
 * En memoria a propósito: un informe es de este momento y de estos datos. Si el servidor se
 * redesplegó, el informe viejo ya no describe el catastro de ahora y vale más rehacerlo.
 */
const VIDA_MS = 30 * 60 * 1000;
const guardados = new Map<string, { informe: Informe; at: number; quien: string | null; compartido: boolean }>();

export function guardarInforme(informe: Informe, quien: string | null): string {
  const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  guardados.set(id, { informe, at: Date.now(), quien, compartido: false });
  const limite = Date.now() - VIDA_MS;
  for (const [k, v] of guardados) if (v.at < limite) guardados.delete(k);
  // Un tope duro además del tiempo: si alguien pide informes en bucle, no se come la memoria.
  while (guardados.size > 40) guardados.delete(guardados.keys().next().value as string);
  return id;
}

/**
 * Lo que puede pasar al recoger un informe.
 *
 * `no-esta` cubre a la vez «no existe» y «ya caducó», a propósito: contestarlos distinto le
 * confirmaría a quien prueba identificadores cuáles existen.
 */
export type TomaInforme = { estado: 'ok'; informe: Informe } | { estado: 'no-esta' } | { estado: 'ajeno' };

/**
 * Recoger un informe.
 *
 * **Privado por defecto.** El `quien` se guardaba desde el principio y no se comparaba con nadie:
 * cualquiera con acceso a Electrum y el identificador podía bajarse el informe de otro. Los
 * identificadores no se adivinan fácil, pero «difícil de adivinar» no es un permiso — y un informe
 * de cartera lleva nombres de concesionarios y hectáreas.
 *
 * Quien lo pidió puede compartirlo con el equipo a propósito. Eso es una decisión suya, no un
 * descuido nuestro.
 */
export function tomarInforme(id: string, quien: string | null = null): TomaInforme {
  const g = guardados.get(String(id));
  if (!g) return { estado: 'no-esta' };
  if (Date.now() - g.at > VIDA_MS) {
    guardados.delete(String(id));
    return { estado: 'no-esta' };
  }
  // Sin autor conocido —un informe pedido por Telegram sin identificar— no hay a quién reservárselo.
  if (g.quien && !g.compartido && g.quien !== quien) return { estado: 'ajeno' };
  return { estado: 'ok', informe: g.informe };
}

/** Compartirlo con el equipo. Solo quien lo pidió puede hacerlo. */
export function compartirInforme(id: string, quien: string | null): 'hecho' | 'no-esta' | 'ajeno' {
  const g = guardados.get(String(id));
  if (!g || Date.now() - g.at > VIDA_MS) return 'no-esta';
  if (g.quien && g.quien !== quien) return 'ajeno';
  g.compartido = true;
  return 'hecho';
}

/** ¿Ya está compartido? Para que la pantalla no ofrezca compartir lo que ya está compartido. */
export function informeCompartido(id: string): boolean {
  return !!guardados.get(String(id))?.compartido;
}

export function olvidarInformes() {
  guardados.clear();
}
