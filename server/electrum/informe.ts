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
  porVencer,
  traslapes,
  type FilaConcesion,
} from './db';
import { documentoPdf, medirJpeg, type Bloque } from '../../lib/pdf';

const AMBAR: [number, number, number] = [1, 0.68, 0.23];

const nf = (n: number, d = 2) =>
  new Intl.NumberFormat('es-ES', { minimumFractionDigits: d, maximumFractionDigits: d }).format(n);

function fecha(d = new Date()): string {
  return new Intl.DateTimeFormat('es-ES', { dateStyle: 'long', timeZone: 'America/Tegucigalpa' }).format(d);
}

function pie(quien: string | null): string {
  const q = quien ? ` · a petición de ${quien}` : '';
  return `Dr Electrum FP · ${fecha()}${q} · documento de demostración`;
}

/** Días hasta la fecha. Negativo = ya pasó. */
function diasHasta(iso: string | null): number | null {
  if (!iso) return null;
  const t = Date.parse(`${iso}T00:00:00Z`);
  if (!isFinite(t)) return null;
  return Math.round((t - Date.now()) / 86_400_000);
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
      `El padrón la da por VIGENTE pero la fecha de vencimiento (${c.vence}) pasó hace ${Math.abs(d)} días. Una de las dos cosas está mal: no afirmar la vigencia sin el expediente delante.`
    );
  }
  if (d !== null && d >= 0 && d <= 180 && /vigent/.test(estado)) {
    avisos.push(`Vence el ${c.vence}, dentro de ${d} días. Si hay que renovar, el trámite se empieza ahora, no en la última semana.`);
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
    filas.push(['Vence', d === null ? c.vence : d < 0 ? `${c.vence} (hace ${Math.abs(d)} días)` : `${c.vence} (en ${d} días)`]);
  }
  return filas;
}

export type Informe = { pdf: Buffer; nombre: string; dicho: string };

export async function informeConcesion(
  ref: { id?: number; nombre?: string },
  opts: OpcionesInforme = {}
): Promise<Informe | { error: string }> {
  if (!hayBase()) return { error: 'El catastro no está conectado, así que no puedo armar el informe. Decilo tal cual.' };

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
    const hits = await buscarConcesiones(ref.nombre, 4);
    if (hits.length > 1) {
      return { error: `Coinciden ${hits.length}: ${hits.map((h) => h.nombre).join(', ')}. Pedí una por su nombre exacto para el informe.` };
    }
    fila = hits[0];
  }
  if (!fila) return { error: `No encontré esa concesión en el catastro. No voy a armar un informe de algo que no tengo.` };

  const bloques: Bloque[] = [];
  const avisos = contradicciones(fila);
  if (avisos.length) for (const a of avisos) bloques.push({ tipo: 'aviso', texto: a });

  bloques.push({ tipo: 'seccion', texto: 'Identificación' }, { tipo: 'campos', filas: fichaCampos(fila) });

  /* --- geometría: lo único que este informe mide por su cuenta --- */
  const geo = await geometriaDe(fila.id);
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
          ['Centro', `${geo.centro[0].toFixed(5)}, ${geo.centro[1].toFixed(5)} (lon, lat)`],
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
  } else {
    bloques.push({ tipo: 'seccion', texto: 'Geometría medida' }, { tipo: 'parrafo', texto: 'Esta concesión no tiene geometría cargada, así que no hay área medida ni mapa. Lo que diga el padrón sobre hectáreas está sin comprobar.' });
  }

  /* --- traslapes que le toquen --- */
  const todos = await traslapes(200);
  const suyos = todos.filter((t) => t.a_id === fila!.id || t.b_id === fila!.id);
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
  const hits = await buscarEnExpedientes(fila.nombre, 4).catch(() => []);
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
    }.`,
  };
}

/* ------------------------------------------------------------------ cartera */

/** El estado de todo lo cargado: cuánto hay, qué vence y qué se pisa. */
export async function informeCartera(opts: OpcionesInforme = {}): Promise<Informe | { error: string }> {
  if (!hayBase()) return { error: 'El catastro no está conectado, así que no hay cartera que informar. Decilo tal cual.' };

  const [resumen] = await consulta<{ total: number; con_geom: number; hectareas: number; titulares: number }>(
    `SELECT count(*)::int AS total,
            count(geom)::int AS con_geom,
            coalesce(sum(hectareas),0)::float8 AS hectareas,
            count(DISTINCT titular)::int AS titulares
     FROM concesion`
  );
  if (!resumen || !resumen.total) return { error: 'No hay ninguna concesión cargada todavía. Súbanme el catastro y lo armo.' };

  const vencen = await porVencer(365, 60);
  const cobertura = await coberturaDeFechas();
  const pisadas = await traslapes(60);
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

  bloques.push({ tipo: 'seccion', texto: 'Vencimientos en los próximos 365 días' });
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
      { tipo: 'aviso', texto: `${vencen.length} ${vencen.length === 1 ? 'concesión vence' : 'concesiones vencen'} dentro del año.` },
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
    const ha = pisadas.reduce((a, t) => a + t.hectareas, 0);
    bloques.push(
      {
        tipo: 'aviso',
        texto: `Hay ${pisadas.length} ${pisadas.length === 1 ? 'traslape' : 'traslapes'}, ${nf(ha)} hectáreas en común. Un traslape es un conflicto de derechos hasta que alguien demuestre prelación.`,
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
    dicho: `Armé el informe de cartera: ${resumen.total} concesiones, ${nf(resumen.hectareas)} hectáreas, ${cobertura.total && !cobertura.conVence ? 'sin fechas de vencimiento en el padrón' : `${vencen.length} por vencer`} y ${pisadas.length} traslapes.`,
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
const guardados = new Map<string, { informe: Informe; at: number; quien: string | null }>();

export function guardarInforme(informe: Informe, quien: string | null): string {
  const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  guardados.set(id, { informe, at: Date.now(), quien });
  const limite = Date.now() - VIDA_MS;
  for (const [k, v] of guardados) if (v.at < limite) guardados.delete(k);
  // Un tope duro además del tiempo: si alguien pide informes en bucle, no se come la memoria.
  while (guardados.size > 40) guardados.delete(guardados.keys().next().value as string);
  return id;
}

export function tomarInforme(id: string): Informe | null {
  const g = guardados.get(String(id));
  if (!g) return null;
  if (Date.now() - g.at > VIDA_MS) {
    guardados.delete(String(id));
    return null;
  }
  return g.informe;
}

export function olvidarInformes() {
  guardados.clear();
}
