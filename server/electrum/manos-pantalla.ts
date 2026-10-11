/**
 * LAS MANOS QUE LE FALTABAN A DR ELECTRUM (auditoría del 10 de octubre de 2026).
 *
 * La pantalla tenía controles que solo respondían a frases fijas de voz (fondo satélite, 3D, abrir el
 * tablero, el timelapse de la concesión abierta, la mesa técnica…): si Electrum decía «te pongo el
 * satélite», no pasaba nada. Tampoco podía analizar un área que le dictaran, ni decir cómo está el
 * sistema. Aquí van esas tres manos, con las mismas órdenes que ya ejecuta la pantalla
 * (`ui.accion = 'comando'` → App.tsx → ejecutarComando).
 */
import type { Geometry } from 'geojson';
import type { Herramienta } from '../../lib/agente/tipos';
import { nodoConfigurado } from '../../lib/nodo';
import { analizarArea, poligonoValido } from './area';
import { convertir, leerSistema, type Sistema } from './datum';
import { hayBase, saludBase } from './db';
import { encuadre } from './gis';
import { manifiesto } from './indice-capas';
import { indiceTeselas } from './teselas';

type Accion = 'fondo' | 'tres_d' | 'vista' | 'abrir' | 'ficha' | 'mesa' | 'silencio' | 'reparto' | 'pantalla_completa' | 'cerrar';
const SI = /^(si|sí|true|1|activar|activa|encender|enciende|on|abrir|abre|prender)$/i;
const NO = /^(no|false|0|desactivar|desactiva|apagar|apaga|off|cerrar|cierra|quitar|quita)$/i;
/** Un interruptor: sí o no dicho de verdad; si falta o no se entiende, no se adivina (revisión de Codex en #170). */
function interruptor(v: string, nombre: string): boolean | { error: string } {
  if (SI.test(v)) return true;
  if (NO.test(v)) return false;
  return { error: `${nombre}: valor «si» o «no».` };
}

/** Lo pedido → el comando que la pantalla ya sabe ejecutar (src-electrum/panel/comandos.ts). */
export function comandoDePantalla(accion: string, valor: string): Record<string, unknown> | { error: string } {
  const v = String(valor || '').toLowerCase().trim();
  switch (accion as Accion) {
    case 'fondo':
      return /cal|mapa|vial/.test(v) ? { accion: 'fondo', cual: 'calles' } : /sat/.test(v) ? { accion: 'fondo', cual: 'satelite' } : { error: 'fondo: «satelite» o «calles».' };
    case 'tres_d': {
      const x = interruptor(v, 'tres_d');
      return typeof x === 'boolean' ? { accion: 'tresD', activar: x } : x;
    }
    case 'vista': {
      const m: Record<string, Record<string, unknown>> = {
        pais: { accion: 'pais' }, honduras: { accion: 'pais' }, norte: { accion: 'norte' }, cenital: { accion: 'cenital' }, inclinar: { accion: 'inclinar' },
        orbitar: { accion: 'orbitar' }, ubicacion: { accion: 'ubicacion' }, acercar: { accion: 'zoom', dir: 1 }, alejar: { accion: 'zoom', dir: -1 },
        girar_derecha: { accion: 'rotar', dir: 1 }, girar_izquierda: { accion: 'rotar', dir: -1 },
        arriba: { accion: 'mover', dir: 'arriba' }, abajo: { accion: 'mover', dir: 'abajo' }, izquierda: { accion: 'mover', dir: 'izquierda' }, derecha: { accion: 'mover', dir: 'derecha' },
      };
      return m[v.replace(/\s+/g, '_')] || { error: `vista: ${Object.keys(m).join(', ')}.` };
    }
    case 'abrir': {
      const ok = ['tablero', 'capas', 'expedientes', 'infraestructura', 'consulta', 'recorrido'];
      return ok.includes(v) ? { accion: 'abrir', que: v } : { error: `abrir: ${ok.join(', ')}.` };
    }
    case 'ficha': {
      const ok = ['pdf', 'geologico', 'timelapse', 'analizar'];
      return ok.includes(v) ? { accion: 'ficha', que: v } : { error: `ficha: ${ok.join(', ')}.` };
    }
    case 'mesa': {
      const x = interruptor(v, 'mesa');
      return typeof x === 'boolean' ? { accion: 'mesa', abrir: x } : x;
    }
    case 'silencio': {
      const x = interruptor(v, 'silencio');
      return typeof x === 'boolean' ? { accion: 'silencio', activar: x } : x;
    }
    case 'reparto':
      return ['mapa', 'mitad', 'chat'].includes(v) ? { accion: 'reparto', alto: v } : { error: 'reparto: mapa, mitad o chat.' };
    case 'pantalla_completa': {
      const x = interruptor(v, 'pantalla_completa');
      return typeof x === 'boolean' ? { accion: 'pantalla', entrar: x } : x;
    }
    case 'cerrar':
      return { accion: 'cerrar' };
  }
  return { error: 'accion: fondo, tres_d, vista, abrir, ficha, mesa, silencio, reparto, pantalla_completa o cerrar.' };
}

const DICHO: Record<string, string> = {
  fondo: 'Cambié el fondo del mapa', tresD: 'Cambié el relieve 3D', pais: 'Mostré todo Honduras', norte: 'Puse el norte arriba', cenital: 'Puse la vista desde arriba',
  inclinar: 'Incliné el mapa', orbitar: 'Di la vuelta alrededor', ubicacion: 'Busqué su ubicación', zoom: 'Cambié el acercamiento', rotar: 'Giré el mapa', mover: 'Moví el mapa',
  abrir: 'Abrí el panel', ficha: 'Pedí a la ficha abierta', mesa: 'Cambié la mesa técnica', silencio: 'Cambié el modo silencio', reparto: 'Cambié el reparto de pantalla',
  pantalla: 'Cambié la pantalla completa', cerrar: 'Cerré lo que estaba abierto',
};

export const pantalla: Herramienta = {
  nombre: 'pantalla',
  descripcion: 'Maneja la pantalla: fondo (satelite/calles), tres_d, vista (pais, norte, acercar…), abrir un panel, ficha de la concesión abierta (pdf, geologico, timelapse, analizar), mesa, silencio.',
  esquema: {
    type: 'object',
    properties: {
      accion: { type: 'string', description: 'Qué control', enum: ['fondo', 'tres_d', 'vista', 'abrir', 'ficha', 'mesa', 'silencio', 'reparto', 'pantalla_completa', 'cerrar'] },
      valor: { type: 'string', description: 'satelite, si, pais, tablero, timelapse…' },
    },
    required: ['accion'],
  },
  plataformas: ['electrum'],
  async ejecutar({ accion, valor }, ctx) {
    // Sin pantalla con mapa (Telegram, MCP) no hay nada que mover: se dice, no se finge (revisión de Codex en #170).
    if (ctx?.canal !== 'mesa' || !ctx?.mapa) return { ok: false, texto: 'Esta conversación no tiene la pantalla del mapa abierta: no puedo cambiarla desde aquí. Decilo así.' };
    const c = comandoDePantalla(String(accion || ''), String(valor ?? ''));
    if ('error' in c) return { ok: false, texto: `No hice nada: ${c.error}` };
    const extra = c.accion === 'ficha' ? ' (necesita una concesión abierta: si no hay, primero mapa_volar a la concesión)' : '';
    return { ok: true, texto: `${DICHO[String(c.accion)] || 'Listo'}${extra}.`, ui: { accion: 'comando', comando: c } };
  },
};

/** «x y» o «x,y» por vértice, en grados o en UTM 16N (WGS84 o NAD27). */
export function poligonoDeTexto(vertices: unknown, sistema?: string): { g: Geometry } | { error: string } {
  const pares: Array<[number, number]> = [];
  const lista = Array.isArray(vertices) ? vertices : String(vertices || '').split(/;|\n/);
  for (const v of lista) {
    const nums = (Array.isArray(v) ? v : String(v).trim().split(/[\s,]+/)).filter((x) => String(x).trim() !== '').map(Number).filter((n) => Number.isFinite(n));
    if (nums.length >= 2) pares.push([nums[0], nums[1]]);
  }
  if (pares.length < 3) return { error: 'Hacen falta al menos tres vértices.' };
  const utm = pares.every(([x, y]) => Math.abs(x) > 1000 && Math.abs(y) > 1000);
  let ll = pares;
  if (utm) {
    const s: Sistema = leerSistema(sistema) || { datum: 'WGS84', forma: 'utm', zona: 16 };
    ll = pares.map((p) => convertir(p, { ...s, forma: 'utm', zona: s.zona || 16 }, { datum: 'WGS84', forma: 'geo' } as Sistema));
  } else if (pares.every(([a, b]) => a > 0 && a < 20 && b < -80)) {
    ll = pares.map(([lat, lon]) => [lon, lat]); // vinieron como lat, lon
  }
  const anillo = [...ll];
  const [a, b] = [anillo[0], anillo[anillo.length - 1]];
  if (a[0] !== b[0] || a[1] !== b[1]) anillo.push(a);
  const g: Geometry = { type: 'Polygon', coordinates: [anillo] };
  const v = poligonoValido(g);
  return v.ok ? { g: v.geojson } : { error: (v as { motivo: string }).motivo };
}

export const area_analizar: Herramienta = {
  nombre: 'area_analizar',
  descripcion: 'Analiza un área por sus vértices: hectáreas, qué concesiones pisa, áreas protegidas, microcuencas, caseríos.',
  esquema: {
    type: 'object',
    properties: {
      vertices: { type: 'string', description: '«lon lat; lon lat; …» o UTM «x y; …»' },
      sistema: { type: 'string', description: 'Opcional: «UTM 16N NAD27» o «WGS84»' },
      nombre: { type: 'string', description: 'Opcional' },
    },
    required: ['vertices'],
  },
  plataformas: ['electrum'],
  async ejecutar({ vertices, sistema, nombre }) {
    if (!hayBase()) return { ok: false, texto: 'El catastro no está conectado: no puedo analizar el área.' };
    const p = poligonoDeTexto(vertices, typeof sistema === 'string' ? sistema : undefined);
    if ('error' in p) return { ok: false, texto: `No pude armar el polígono: ${p.error}` };
    const a = await analizarArea(p.g, String(nombre || 'Área dictada').slice(0, 80));
    if ('error' in a) return { ok: false, texto: a.error };
    const fc = { type: 'FeatureCollection' as const, features: [{ type: 'Feature' as const, geometry: p.g, properties: { nombre: a.nombre } }] };
    return {
      ok: true,
      texto: [`${a.nombre}: ${a.ha.toLocaleString('es-HN')} ha, perímetro ${a.perimetroKm} km; libre de concesiones ${a.libreHa.toLocaleString('es-HN')} ha.`, ...a.renglones, ...a.alertas.map((x) => `ALERTA: ${x}`)].join('\n'),
      ui: { accion: 'candidatas', geojson: fc, encuadre: encuadre(fc) },
    };
  },
};

export const sistema_estado: Herramienta = {
  nombre: 'sistema_estado',
  descripcion: 'Cómo está la plataforma: base, catastro, índice de capas, mapas en teselas, cerebro.',
  esquema: { type: 'object', properties: {} },
  plataformas: ['electrum'],
  async ejecutar() {
    const [b, m, t] = await Promise.all([saludBase().catch(() => ({ viva: false, motivo: 'no contesta' }) as any), manifiesto().catch(() => null), indiceTeselas().catch(() => null)]);
    const capas = m?.capas.filter((c) => c.tipo !== 'grupo') || [];
    return {
      ok: true,
      texto: [
        `Base de datos: ${b.viva ? `viva (PostGIS ${b.postgis}), ${b.concesiones} concesiones en el catastro` : `CAÍDA (${b.motivo})`}.`,
        `Índice de capas: ${m ? `v${m.version}, ${capas.length} capas y planos (${capas.filter((c: any) => c.sin_datos).length} sin datos)` : 'no se pudo leer'}.`,
        `Mapas en teselas: ${t ? `${(t as any).rasters?.length ?? 0}` : 'no se pudo leer el índice'}.`,
        `Cerebro: ${nodoConfigurado() ? 'nodo propio configurado (si no contesta, responde el modelo de respaldo)' : 'sin nodo propio: responde el modelo de respaldo'}.`,
      ].join('\n'),
    };
  },
};

export const MANOS_PANTALLA = { pantalla, area_analizar, sistema_estado };
