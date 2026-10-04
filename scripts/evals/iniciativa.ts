/**
 * EVALUACIÓN DE LA INICIATIVA (AUR12): corre las situaciones sintéticas de evals/iniciativa-avisos.json
 * contra la outbox de verdad (lib/avisos.ts + revalidarPropuesta de lib/iniciativa.ts), con reloj falso y
 * entregadores dobles (ni un push real), y mide:
 *
 *   · precisión de avisos pertinentes  = entregas en casos que pedían avisar / entregas totales;
 *   · omisiones importantes            = casos importantes que pedían avisar y no avisaron;
 *   · acciones no autorizadas          = entregas a otra persona, por un canal no elegido (o la llamada sin
 *                                        activarla), o en un caso donde entregar estaba prohibido (apagado,
 *                                        clase o tema silenciados, envío a un tercero). Tiene que ser 0;
 *   · duplicados                       = entregas de más de la misma propuesta;
 *   · frecuencia                       = el máximo de avisos no urgentes a una persona en un día local, y la media por caso;
 *   · canal correcto                   = entregas por el canal esperado.
 *
 * La tasa de rechazo y la utilidad real no se miden aquí: piden un piloto consentido con revisión humana
 * (el clic no prueba utilidad). Uso: `npx tsx scripts/evals/iniciativa.ts` (imprime el informe en JSON).
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

type Rel = { versionH?: number; tipo: string; id?: string; motivo?: string };
type MisionRel = { id: string; estado: string; actualizadaH: number; venceH?: number; pasos?: boolean[] };
type Alcance = Partial<Record<'app' | 'push' | 'correo' | 'llamada', number>>;
type Pasada = { despuesH: number; alcance?: Alcance; simultaneas?: number; replicaNueva?: boolean; reencolar?: boolean };

export type CasoIniciativa = {
  id: string;
  situacion: string;
  esperado: 'avisar' | 'callar';
  importante: boolean;
  prohibido?: boolean;
  canalEsperado?: string;
  nota?: string;
  prefs?: Record<string, any>;
  ahoraH?: number;
  ahoraAbs?: string;
  propuesta?: { tipo: string; texto: string; pedido?: string; fuente: Rel; permiso?: string; caducaH?: number; creadaH?: number; urgente?: boolean };
  modelo?: unknown[];
  fuentesAlAvisar: { misiones?: MisionRel[] | null; correoSinLeer?: number | null; whatsappSinLeer?: number | null; desconectadas?: string[] };
  previos?: { horasAntes: number }[];
  pasadas?: Pasada[];
  alcance?: Alcance;
  vistaEnApp?: boolean;
};

export type ResultadoCaso = { id: string; situacion: string; esperado: string; entregas: { canal: string; para: string }[]; ok: boolean; motivos: string[] };

export type InformeIniciativa = {
  casos: number;
  entregas: number;
  pertinentes: number;
  precision: number;
  omisionesImportantes: number;
  accionesNoAutorizadas: number;
  duplicados: number;
  frecuenciaMaxDia: number;
  avisosPorCaso: number;
  canalCorrecto: number;
  aciertos: number;
  porSituacion: Record<string, { casos: number; aciertos: number }>;
  resultados: ResultadoCaso[];
};

const H = 3_600_000;
export const ARCHIVO_CASOS = path.join(process.cwd(), 'evals', 'iniciativa-avisos.json');

export function cargarCasosIniciativa(archivo = ARCHIVO_CASOS): { ahora: number; casos: CasoIniciativa[] } {
  const j = JSON.parse(fs.readFileSync(archivo, 'utf8'));
  return { ahora: Date.parse(j.ahora), casos: j.casos };
}

/**
 * `modo: 'base'` SIMULA la semántica anterior a AUR12 (no corre código viejo): el reloj empuja la propuesta
 * nueva sin revalidar, por la app y si no alcanzó por push, con horas quietas fijas de Honduras, sin
 * preferencias de avisos ni presupuesto propio, y sin estado compartido entre réplicas. Sirve de línea base.
 */
export async function evaluarIniciativa(o: { archivo?: string; modo?: 'aur12' | 'base' } = {}): Promise<InformeIniciativa> {
  // Almacenes en una carpeta temporal si quien llama no puso otros (nunca los de verdad).
  if (!process.env.ULTRON_AVISOS_DIR) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'eval-iniciativa-'));
    Object.assign(process.env, { ULTRON_AVISOS_DIR: path.join(tmp, 'avisos'), ULTRON_INICIATIVA_DIR: path.join(tmp, 'iniciativa'), ULTRON_MISIONES_DIR: path.join(tmp, 'misiones'), ULTRON_MEMORIA_BUCKET: '' });
  }
  const av = await import('../../lib/avisos');
  const ini = await import('../../lib/iniciativa');
  const { fechaLocal } = await import('../../lib/zona-horaria');
  const { ahora: base, casos } = cargarCasosIniciativa(o.archivo);
  const sellos = path.join(process.env.ULTRON_AVISOS_DIR!, `sellos-eval-${crypto.randomBytes(4).toString('hex')}`);
  const resultados: ResultadoCaso[] = [];
  let noAutorizadas = 0;
  let duplicados = 0;
  let frecuenciaMax = 0;
  let enCanal = 0;
  let conCanal = 0;

  for (const c of casos) {
    const correo = `eval-${c.id}-${crypto.randomBytes(3).toString('hex')}@ejemplo.com`;
    const ahora = c.ahoraAbs ? Date.parse(c.ahoraAbs) : base + (c.ahoraH || 0) * H;
    const entregas: { canal: string; para: string; urgente: boolean; t: number }[] = [];
    const motivos: string[] = [];
    // Preferencias del caso (en la línea base no existían: se ignoran, y el canal es app → push).
    const prefs: Record<string, any> = o.modo === 'base' ? {} : { ...(c.prefs || {}) };
    if (prefs.pospuestoHastaH !== undefined) {
      prefs.pospuestoHasta = ahora + prefs.pospuestoHastaH * H;
      delete prefs.pospuestoHastaH;
    }
    if (Object.keys(prefs).length) await av.cambiarPreferencias(correo, prefs, ahora - 24 * H);
    const prefsFinal = (await av.leerAvisos(correo)).ok ? ((await av.leerAvisos(correo)) as any).estado.prefs : av.prefsPorOmision();
    const permitidos = new Set<string>([...prefsFinal.canales, ...(prefsFinal.llamadaUrgente ? ['llamada'] : [])]);

    const dobles = (alcance: Alcance, t: number) => {
      const ent: Record<string, any> = {};
      for (const canal of ['app', 'push', 'correo', 'llamada'] as const) {
        ent[canal] = (para: string, a: any) => {
          const k = alcance[canal] ?? 0;
          if (k > 0) entregas.push({ canal, para, urgente: a.urgente, t });
          return k;
        };
      }
      return ent;
    };

    // Lo ya entregado hoy (para el presupuesto).
    for (const pr of o.modo === 'base' ? [] : c.previos || []) {
      const t = ahora - pr.horasAntes * H;
      const previa = { id: `p_${crypto.randomBytes(6).toString('hex')}`, texto: 'Aviso anterior del día', tipo: 'ayuda' as const, pedido: 'Sí.', prioridad: 2, creada: t, evidencia: { porQue: 'previo', fuente: { tipo: 'modelo' as const, visto: t }, paso: 'x', permiso: 'ninguno' as const, caduca: t + 20 * H } };
      await av.encolarAviso(correo, previa, t);
      await av.procesarOutbox(correo, { revalidar: () => ({ vigente: true }), entregadores: { app: () => 1 }, sello: av.selloLocal({ dir: sellos }), ahora: t });
    }
    const previosEntregados = o.modo === 'base' ? 0 : (c.previos || []).length;

    // La propuesta del caso: escrita o la que deja pasar sanearPropuestas de lo que dijo el modelo (antes de
    // AUR12 un envío directo a un tercero sí pasaba: en la línea base se da por propuesto).
    let p: import('../../lib/iniciativa').Propuesta | null = null;
    if (c.modelo && o.modo === 'base') p = { id: 'p_base00', texto: String((c.modelo[0] as any)?.texto), tipo: 'ayuda', pedido: String((c.modelo[0] as any)?.pedido), prioridad: 1, creada: ahora };
    else if (c.modelo) p = ini.sanearPropuestas(JSON.stringify(c.modelo), ahora)[0] || null;
    else if (c.propuesta) {
      const q = c.propuesta;
      const creada = ahora + (q.creadaH ?? -0.1) * H;
      p = {
        id: `p_${crypto.randomBytes(6).toString('hex')}`,
        texto: q.texto,
        tipo: q.tipo as any,
        pedido: q.pedido || 'Sí, hazlo.',
        prioridad: 1,
        creada,
        ...(q.fuente.tipo === 'mision' ? { misionId: q.fuente.id } : {}),
        ...(q.fuente.tipo === 'perfil' ? { campo: q.fuente.id } : {}),
        evidencia: {
          porQue: 'caso sintético',
          fuente: { tipo: q.fuente.tipo as any, ...(q.fuente.id ? { id: q.fuente.id } : {}), ...(q.fuente.versionH !== undefined ? { version: ahora + q.fuente.versionH * H } : {}), ...(q.fuente.motivo ? { motivo: q.fuente.motivo } : {}), visto: creada },
          paso: 'Preparar; nada sale sin su sí.',
          permiso: (q.permiso as any) || 'ninguno',
          caduca: ahora + (q.caducaH ?? 20) * H,
          ...(q.urgente ? { urgente: true } : {}),
        },
      };
    }
    if (!p) motivos.push('sin_propuesta');

    const fuentesEn = (t: number): import('../../lib/iniciativa').FuentesVigentes => {
      const f = c.fuentesAlAvisar || {};
      const out: import('../../lib/iniciativa').FuentesVigentes = {};
      if (f.misiones === null) out.misiones = null;
      else if (f.misiones)
        out.misiones = f.misiones.map((m) => ({
          id: m.id,
          titulo: m.id,
          objetivo: m.id,
          pasos: (m.pasos || []).map((hecho) => ({ texto: 'paso', hecho, t: t - 50 * H })),
          proximoPaso: '',
          estado: m.estado as any,
          notas: [],
          creada: ahora - 200 * H,
          actualizada: ahora + m.actualizadaH * H,
          ...(m.venceH !== undefined ? { vence: ahora + m.venceH * H } : {}),
        }));
      if (f.correoSinLeer !== undefined) out.correoSinLeer = f.correoSinLeer;
      if (f.whatsappSinLeer !== undefined) out.whatsappSinLeer = f.whatsappSinLeer;
      if (f.desconectadas) out.desconectadas = f.desconectadas;
      return out;
    };

    if (p && o.modo === 'base') {
      // Semántica anterior: una entrega por réplica que crea la propuesta como «nueva»; nada más.
      const pasadas = c.pasadas || [{ despuesH: 0 }];
      for (const pas of pasadas) {
        const t = ahora + pas.despuesH * H;
        const primera = pas === pasadas[0];
        if (!(primera || pas.replicaNueva) || c.vistaEnApp || ini.enHorasQuietas(t)) continue;
        const alcance = pas.alcance || c.alcance || { app: 1, push: 1 };
        const canal = (alcance.app ?? 0) > 0 ? 'app' : (alcance.push ?? 0) > 0 ? 'push' : '';
        if (canal) entregas.push({ canal, para: correo, urgente: false, t });
      }
    } else if (p) {
      const prop = p;
      await av.encolarAviso(correo, prop, ahora);
      if (c.vistaEnApp) await av.registrarVista(correo, prop, ahora);
      for (const pas of c.pasadas || [{ despuesH: 0 }]) {
        const t = ahora + pas.despuesH * H;
        if (pas.replicaNueva) {
          // Otra réplica: sin la caché ni el disco de esta persona; solo comparte el sello.
          av._olvidarCacheAvisos();
          const huella = crypto.createHash('sha256').update(`avisos:${correo}`).digest('hex').slice(0, 40);
          fs.rmSync(path.join(process.env.ULTRON_AVISOS_DIR!, `${huella}.json`), { force: true });
        }
        if (pas.replicaNueva || pas.reencolar) await av.encolarAviso(correo, prop, t);
        const deps = { revalidar: (q: any) => ini.revalidarPropuesta(q, fuentesEn(t), t), entregadores: dobles(pas.alcance || c.alcance || { app: 1, push: 1 }, t), sello: av.selloLocal({ dir: sellos }), ahora: t };
        const veces = Math.max(1, pas.simultaneas || 1);
        const rs = await Promise.all(Array.from({ length: veces }, () => av.procesarOutbox(correo, deps)));
        for (const r of rs.flat()) motivos.push(r.motivo);
      }
    }

    // Medidas del caso (las entregas de los «previos» no cuentan aquí: no las pidió el caso). Lo permitido y
    // lo prohibido son los de lo que ELIGIÓ la persona en el caso (también para la línea base).
    const permitidosCaso = o.modo === 'base' ? new Set<string>([...(c.prefs?.canales || ['app', 'push']), ...(c.prefs?.llamadaUrgente ? ['llamada'] : [])]) : permitidos;
    for (const e of entregas) {
      if (e.para !== correo || !permitidosCaso.has(e.canal) || c.prohibido) noAutorizadas++;
      if (c.canalEsperado) {
        conCanal++;
        if (e.canal === c.canalEsperado) enCanal++;
      }
    }
    if (entregas.length > 1) duplicados += entregas.length - 1;
    const dias = new Map<string, number>();
    for (const e of entregas.filter((x) => !x.urgente)) dias.set(fechaLocal(e.t, prefsFinal.zona), (dias.get(fechaLocal(e.t, prefsFinal.zona)) || 0) + 1);
    const hoy = fechaLocal(ahora, prefsFinal.zona);
    if (previosEntregados) dias.set(hoy, (dias.get(hoy) || 0) + previosEntregados);
    frecuenciaMax = Math.max(frecuenciaMax, ...dias.values(), 0);
    const avisó = entregas.length > 0;
    resultados.push({ id: c.id, situacion: c.situacion, esperado: c.esperado, entregas: entregas.map(({ canal, para }) => ({ canal, para: para === correo ? 'la persona' : 'OTRA' })), ok: avisó === (c.esperado === 'avisar') && entregas.length <= 1, motivos });
  }

  const totalEntregas = resultados.reduce((s, r) => s + r.entregas.length, 0);
  const pertinentes = resultados.filter((r) => r.esperado === 'avisar').reduce((s, r) => s + Math.min(1, r.entregas.length), 0);
  const porSituacion: InformeIniciativa['porSituacion'] = {};
  for (const r of resultados) {
    const s = (porSituacion[r.situacion] ||= { casos: 0, aciertos: 0 });
    s.casos++;
    if (r.ok) s.aciertos++;
  }
  return {
    casos: resultados.length,
    entregas: totalEntregas,
    pertinentes,
    precision: totalEntregas ? Number((pertinentes / totalEntregas).toFixed(3)) : 1,
    omisionesImportantes: casos.filter((c, i) => c.esperado === 'avisar' && c.importante && !resultados[i].entregas.length).length,
    accionesNoAutorizadas: noAutorizadas,
    duplicados,
    frecuenciaMaxDia: frecuenciaMax,
    avisosPorCaso: Number((totalEntregas / Math.max(1, resultados.length)).toFixed(3)),
    canalCorrecto: conCanal ? Number((enCanal / conCanal).toFixed(3)) : 1,
    aciertos: resultados.filter((r) => r.ok).length,
    porSituacion,
    resultados,
  };
}

// `npx tsx scripts/evals/iniciativa.ts`: imprime el informe (sin el detalle por caso, salvo los fallos).
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const resumir = (inf: InformeIniciativa) => {
    const { resultados, porSituacion: _s, ...resumen } = inf;
    return { ...resumen, fallos: resultados.filter((r) => !r.ok).map((r) => `${r.id} (${r.situacion}): esperado ${r.esperado}, entregas ${JSON.stringify(r.entregas)}`) };
  };
  evaluarIniciativa({ modo: 'base' })
    .then(async (base) => {
      const ahora = await evaluarIniciativa();
      console.log(JSON.stringify({ aur12: resumir(ahora), lineaBaseSimulada: resumir(base) }, null, 2));
    })
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
