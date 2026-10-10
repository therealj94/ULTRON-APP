/**
 * LOS OBJETIVOS EN EL TELÉFONO (Fase 2). Un solo almacén para toda la app (la tarjeta «Continuar trabajo» de la mesa, la
 * hoja del objetivo y, más adelante, la burbuja): pregunta GET /api/objetivos con la mesa a la vista (despacio: los
 * objetivos cambian poco; nunca en segundo plano), guarda en ESTE teléfono la última revisión que vio de cada uno y, para
 * el más reciente, pide «qué cambió desde la última vez» (GET /api/objetivos/:id/cambios?desde=<esa revisión>).
 *
 * La lógica es pura (lib/objetivos.ts, la misma de la web). El servidor es la fuente de verdad: lo que contesta una
 * acción (o el objetivo de ahora que trae un 409) reemplaza lo que había.
 */
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api } from '../lib/api';
import { idAparato } from '../lib/aparato';
import { idiomaActual } from '../i18n';
import type { Pedir } from '../lib/trabajos';
import {
  anotarVista,
  crearClienteObjetivos,
  decisionesSinElegir,
  desdeParaCambios,
  lineaQueCambio,
  objetivoReciente,
  type CambiosObjetivo,
  type DecisionObjetivo,
  type ResultadoObjetivo,
  type VistaObjetivo,
  type VistosObjetivos,
} from '../lib/objetivos';
import { pedirObjetivo } from './abrirObjetivo';

/** El transporte de la app: la `api` de siempre (sesión, aparato, renovación); un 4xx vuelve con su cuerpo. */
const pedir: Pedir = async (ruta, init) => {
  try {
    const json = await api<any>(ruta, init as RequestInit, 15_000);
    return { status: 200, json };
  } catch (e: any) {
    if (typeof e?.status === 'number') return { status: e.status, json: e.data || {} };
    throw e;
  }
};

const idiomaApp = (): 'es' | 'en' => (idiomaActual() === 'en' ? 'en' : 'es');
export const clienteObjetivos = crearClienteObjetivos(pedir, idiomaApp);

const CLAVE_VISTOS = 'aura.objetivos.vistos.v1';
/** Cada cuánto se pregunta con la mesa a la vista (los objetivos cambian poco; el aviso push trae lo urgente). */
export const SONDEO_OBJETIVOS_MS = 45_000;

/* ------------------------------------------------------------------ el almacén compartido */

type Estado = {
  objetivos: VistaObjetivo[];
  cargado: boolean;
  error: string | null;
  vistos: VistosObjetivos;
  /** Lo último que dijo `cambios` por objetivo, con la revisión desde la que se pidió. */
  cambios: Record<string, { desde: number; revision: number; c: CambiosObjetivo }>;
};

let estado: Estado = { objetivos: [], cargado: false, error: null, vistos: {}, cambios: {} };
const oyentes = new Set<() => void>();
function poner(cambio: Partial<Estado>) {
  estado = { ...estado, ...cambio };
  for (const f of oyentes) f();
}
const suscribir = (f: () => void) => {
  oyentes.add(f);
  return () => {
    oyentes.delete(f);
  };
};
const foto = () => estado;

let vistosLeidos = false;
async function leerVistos() {
  if (vistosLeidos) return;
  vistosLeidos = true;
  try {
    const s = await AsyncStorage.getItem(CLAVE_VISTOS);
    const v = s ? (JSON.parse(s) as VistosObjetivos) : {};
    if (v && typeof v === 'object') poner({ vistos: { ...v, ...estado.vistos } });
  } catch {
    /* sin lo guardado: todo cuenta como nuevo, que es lo honesto */
  }
}

/** Este teléfono ya vio el objetivo en esta revisión (abrió su hoja o decidió desde la tarjeta). */
export function marcarVisto(o: Pick<VistaObjetivo, 'id' | 'revision'>) {
  const v = anotarVista(estado.vistos, o.id, o.revision, Date.now());
  if (v === estado.vistos || JSON.stringify(v) === JSON.stringify(estado.vistos)) return;
  poner({ vistos: v });
  void AsyncStorage.setItem(CLAVE_VISTOS, JSON.stringify(v)).catch(() => undefined);
}

/** Lo que contestó el servidor (una acción o el objetivo de ahora de un 409) reemplaza lo que había. */
export function aplicarObjetivo(o: VistaObjetivo | null | undefined) {
  if (!o || typeof o.id !== 'string') return;
  const previo = estado.objetivos.find((x) => x.id === o.id);
  if (previo && previo.revision > o.revision) return;
  const objetivos = [o, ...estado.objetivos.filter((x) => x.id !== o.id)].sort((a, b) => (b.actualizado || 0) - (a.actualizado || 0));
  poner({ objetivos });
}

let enVuelo: Promise<void> | null = null;
/** Pregunta la lista (una a la vez) y los cambios del más reciente. */
export function refrescarObjetivos(): Promise<void> {
  if (enVuelo) return enVuelo;
  enVuelo = (async () => {
    await leerVistos();
    const r = await clienteObjetivos.listar();
    if (r.ok === false) {
      if (r.sinSesion) poner({ objetivos: [], cargado: true, error: null, cambios: {} });
      else poner({ error: r.mensaje });
      return;
    }
    poner({ objetivos: r.objetivos, cargado: true, error: null });
    const rec = objetivoReciente(r.objetivos);
    if (!rec) return;
    const desde = desdeParaCambios(estado.vistos, rec);
    const ya = estado.cambios[rec.id];
    if (ya && ya.desde === desde && ya.revision === rec.revision) return;
    const c = await clienteObjetivos.cambios(rec.id, desde);
    if (c) poner({ cambios: { ...estado.cambios, [rec.id]: { desde, revision: rec.revision, c } } });
  })().finally(() => {
    enVuelo = null;
  });
  return enVuelo;
}

/** Al salir de la sesión: nada de la persona anterior se queda a la vista. */
export function olvidarObjetivos() {
  poner({ objetivos: [], cargado: false, error: null, cambios: {} });
}

/* ------------------------------------------------------------------ decidir y controles */

/**
 * Elige una opción de una decisión del objetivo con la revisión que se vio. Un 409 trae el objetivo de ahora: se aplica
 * (la hoja y la tarjeta muestran la versión nueva) y el resultado dice «Cambió mientras tanto».
 */
export async function decidirObjetivo(o: Pick<VistaObjetivo, 'id' | 'revision'>, d: Pick<DecisionObjetivo, 'id'>, opcion: string): Promise<ResultadoObjetivo> {
  const aparato = await idAparato().catch(() => '');
  const r = await clienteObjetivos.decidir(o.id, { decisionId: d.id, opcion, revisionVista: o.revision, ...(aparato ? { aparato } : {}) });
  aplicarObjetivo(r.objetivo ?? null);
  if (r.ok) marcarVisto(r.objetivo || o);
  if (!r.ok && !r.objetivo && r.conflicto) void refrescarObjetivos();
  return r;
}

/** Pausar, reanudar o cancelar con la revisión que se vio; lo que vuelva se aplica (también el objetivo de un 409). */
export async function controlObjetivo(o: Pick<VistaObjetivo, 'id' | 'revision'>, control: 'pausar' | 'reanudar' | 'cancelar'): Promise<ResultadoObjetivo> {
  const r = await clienteObjetivos[control](o.id, o.revision);
  aplicarObjetivo(r.objetivo ?? null);
  return r;
}

export async function cerrarObjetivo(o: Pick<VistaObjetivo, 'id' | 'revision'>, evidencias: Parameters<typeof clienteObjetivos.cerrar>[2]): Promise<ResultadoObjetivo> {
  const r = await clienteObjetivos.cerrar(o.id, o.revision, evidencias);
  aplicarObjetivo(r.objetivo ?? null);
  return r;
}

/* ------------------------------------------------------------------ los ganchos */

/** El almacén, para quien lo pinta. */
export function useEstadoObjetivos(): Estado {
  return useSyncExternalStore(suscribir, foto, foto);
}

/**
 * En la mesa: pregunta mientras `activo` (la mesa a la vista y la app delante), despacio; al volver a primer plano,
 * enseguida. Sin sesión, nada.
 */
export function useObjetivos(o: { activo: boolean; conSesion: boolean }) {
  const s = useEstadoObjetivos();
  useEffect(() => {
    if (!o.conSesion) {
      olvidarObjetivos();
      return;
    }
    if (!o.activo) return;
    void refrescarObjetivos();
    const r = setInterval(() => {
      if (AppState.currentState === 'active') void refrescarObjetivos();
    }, SONDEO_OBJETIVOS_MS);
    const sub = AppState.addEventListener('change', (st) => {
      if (st === 'active') void refrescarObjetivos();
    });
    return () => {
      clearInterval(r);
      sub.remove();
    };
  }, [o.activo, o.conSesion]);
  return s;
}

export type ObjetivoReciente = {
  /** El objetivo abierto más reciente, o null. */
  objetivo: VistaObjetivo | null;
  /** «Qué cambió desde la última vez» en este teléfono, en una línea ('' mientras no se sabe). */
  queCambio: string;
  /** La primera decisión que espera, o null. */
  decision: DecisionObjetivo | null;
  /** Abre su hoja (la mesa la toma, también si todavía no está montada). */
  abrir: () => void;
  /** Elige una opción de `decision` con la revisión que se ve. */
  decidir: (opcion: string) => Promise<ResultadoObjetivo | null>;
};

/**
 * El objetivo más reciente y lo que cambió, para «Continuar trabajo» (la mesa) y la burbuja (mobile/src/burbuja, cuando
 * exista). No sondea por su cuenta (eso lo hace `useObjetivos` en la mesa): si al montarse todavía no se leyó nada, pide
 * una vez.
 */
export function useObjetivoReciente(): ObjetivoReciente {
  const s = useEstadoObjetivos();
  useEffect(() => {
    if (!estado.cargado) void refrescarObjetivos();
  }, []);
  const objetivo = useMemo(() => objetivoReciente(s.objetivos), [s.objetivos]);
  const c = objetivo ? s.cambios[objetivo.id] : undefined;
  const queCambio = useMemo(() => (objetivo && c ? lineaQueCambio(c.c, idiomaApp(), objetivo) : ''), [objetivo, c]);
  const decision = objetivo ? decisionesSinElegir(objetivo)[0] ?? null : null;
  const abrir = useCallback(() => {
    if (objetivo) pedirObjetivo(objetivo.id);
  }, [objetivo]);
  const decidir = useCallback(async (opcion: string) => (objetivo && decision ? decidirObjetivo(objetivo, decision, opcion) : null), [objetivo, decision]);
  return { objetivo, queCambio, decision, abrir, decidir };
}

/**
 * Un objetivo por su id (la hoja): el del almacén, y lo pide al servidor al abrirse para tenerlo al día. `noEsta`: el
 * servidor no lo dio (no existe, es de otra cuenta o no se pudo leer) y tampoco estaba en el almacén.
 */
export function useObjetivo(id: string | null): { objetivo: VistaObjetivo | null; noEsta: boolean } {
  const s = useEstadoObjetivos();
  const [fallo, setFallo] = useState<string | null>(null);
  useEffect(() => {
    setFallo(null);
    if (!id) return;
    let vivo = true;
    void clienteObjetivos.ver(id).then((o) => {
      if (!vivo) return;
      if (o) aplicarObjetivo(o);
      else setFallo(id);
    });
    return () => {
      vivo = false;
    };
  }, [id]);
  const objetivo = id ? s.objetivos.find((o) => o.id === id) ?? null : null;
  return { objetivo, noEsta: !objetivo && !!id && fallo === id };
}
