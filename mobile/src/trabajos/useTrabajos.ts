/**
 * Las tareas durables en el teléfono (AUR08): pregunta GET /api/trabajos con la mesa a la vista (rápido si
 * hay trabajo vivo, despacio si no, nunca en segundo plano), reconcilia con el reductor puro
 * (lib/trabajos.ts) y da el indicador estable. El backend es la fuente de verdad: cerrar el panel o la mesa
 * no cancela nada y, al volver, la misma tarea (mismo id) vuelve con su estado.
 *
 * `avisarTrabajos()` lo llama la mesa cuando la respuesta de un turno enlaza tareas: se pregunta al momento.
 */
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { AccessibilityInfo } from 'react-native';
import { api } from '../lib/api';
import {
  crearClienteTrabajos,
  estadoInicial,
  indicadorEstable,
  lista,
  MINIMO_INDICADOR_MS,
  reducir,
  resumen,
  sondeoTrabajosMs,
  textoIndicador,
  type Indicador,
  type Pedir,
  type TareaVista,
} from '../lib/trabajos';

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

export const clienteTrabajos = crearClienteTrabajos(pedir);

const oyentes = new Set<() => void>();
/** Algo cambió (un turno creó o tocó tareas): que se pregunte ya. */
export function avisarTrabajos() {
  for (const f of oyentes) f();
}

export function useTrabajos(o: { activo: boolean; panelAbierto: boolean; idioma: 'es' | 'en' }) {
  const [s, despachar] = useReducer(reducir, undefined, estadoInicial);
  const [reducido, setReducido] = useState(false);
  const [ind, setInd] = useState<Indicador | null>(null);
  const [reloj, setReloj] = useState(() => Date.now());
  const tareas = useMemo(() => lista(s), [s]);
  const res = useMemo(() => resumen(tareas, reloj), [tareas, reloj]);
  const resRef = useRef(res);
  resRef.current = res;

  const refrescar = useCallback(async () => {
    const r = await clienteTrabajos.listar();
    const t = Date.now();
    if (r.ok) despachar({ tipo: 'lista', tareas: r.tareas, en: t });
    else if (r.sinSesion) despachar({ tipo: 'sin-sesion' });
    else despachar({ tipo: 'error', mensaje: r.mensaje, en: t });
    setReloj(t);
    return r.ok;
  }, []);

  const aplicar = useCallback((t: TareaVista | null | undefined) => {
    if (t) despachar({ tipo: 'una', tarea: t, en: Date.now() });
  }, []);

  // «Reducir movimiento»: el indicador no se mueve.
  useEffect(() => {
    let vivo = true;
    void AccessibilityInfo.isReduceMotionEnabled()
      .then((v) => vivo && setReducido(!!v))
      .catch(() => undefined);
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', (v) => setReducido(!!v));
    return () => {
      vivo = false;
      sub.remove();
    };
  }, []);

  // El sondeo: con la mesa (o el panel) a la vista. Una vuelta no se pisa con la siguiente.
  useEffect(() => {
    if (!o.activo) return;
    let vivo = true;
    let t: ReturnType<typeof setTimeout> | undefined;
    let enVuelo = false;
    const vuelta = async () => {
      if (enVuelo) return;
      enVuelo = true;
      clearTimeout(t);
      try {
        await refrescar();
      } finally {
        enVuelo = false;
      }
      if (vivo) t = setTimeout(vuelta, sondeoTrabajosMs(resRef.current, o.panelAbierto));
    };
    void vuelta();
    const ya = () => void vuelta();
    oyentes.add(ya);
    return () => {
      vivo = false;
      clearTimeout(t);
      oyentes.delete(ya);
    };
  }, [o.activo, o.panelAbierto, refrescar]);

  // El indicador estable: si el texto cambió muy pronto, se vuelve a mirar al cumplir el mínimo.
  const texto = textoIndicador(res, o.idioma);
  useEffect(() => {
    setInd((prev) => indicadorEstable(prev, texto, Date.now()));
    const t = setTimeout(() => setInd((prev) => indicadorEstable(prev, texto, Date.now())), MINIMO_INDICADOR_MS + 50);
    return () => clearTimeout(t);
  }, [texto]);

  return { tareas, resumen: res, indicador: ind?.texto ?? null, reducido, refrescar, aplicar, error: s.error, cargado: s.cargado };
}

export type Trabajos = ReturnType<typeof useTrabajos>;
