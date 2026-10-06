/**
 * La ventana de decisión de la mesa, en movimiento (José, 5-oct). La lógica pura está en lib/decisionesMesa.ts; aquí:
 *  · la fila (las tareas del panel + la pregunta de su computadora), cuál se ve y si se abre sola;
 *  · avisar al servidor qué decisión se ve (POST /api/trabajos/:id/en-pantalla): un «sí» o un «no» dicho mientras se
 *    ve es para ESA, también por la voz (server/decision-turno.ts);
 *  · decir la pregunta una vez (cuando toca: lib/decisionesMesa.ts `debeHablar`);
 *  · contestar: Sí / No / la opción → POST decisiones (la de siempre: decisionId + versión + opción; un 409 trae la tarea
 *    de ahora y se muestra esa); Editar → POST editar y se vuelve a mostrar la versión final; Rehacer → un turno que pide
 *    el borrador de nuevo; Luego → pospone (vuelve sola en LUEGO_MS) y la ventana no se le echa encima otra vez.
 * El backend es la fuente de verdad: después de cada respuesta se vuelve a preguntar la lista.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Keyboard } from 'react-native';
import { api } from '../lib/api';
import { puedeActivar, type ResultadoAccion } from '../lib/trabajos';
import {
  LUEGO_MS,
  botonesVentana,
  colaVentana,
  cuerpoEdicion,
  datosVentana,
  debeHablar,
  edicionVigente,
  elegirActual,
  empezarEdicion,
  fraseVentana,
  hastaLuego,
  luegoEnServidor,
  nuevoPorVoz,
  pedidoRehacer,
  puedeGuardar,
  seAbreSola,
  tareaEnPantalla,
  tieneLuego,
  textoPosicion,
  type BotonVentana,
  type Edicion,
  type ItemVentana,
  type PreguntaPc,
} from '../lib/decisionesMesa';
import { respuestaPc, type TareaPc } from '../compa/computadora';
import { clienteTrabajos, marcarVentanaAbierta, tareasDelUltimoTurno, type Trabajos } from './useTrabajos';
import { campoDecisionVista, fijarDecisionVista, trasAvisoPantalla } from '../lib/decisionVista';

/** Lo que el turno acaba de preguntar cuenta como «primero» este rato (después, la fila vuelve a ser por antigüedad). */
const DEL_TURNO_MS = 10 * 60_000;
/** Cada cuánto se le recuerda al servidor qué se ve (vale EN_PANTALLA_VIVE_MS: 4 min). */
const RENOVAR_PANTALLA_MS = 90_000;

type Opciones = {
  trabajos: Trabajos;
  /** La mesa a la vista y nada encima (ni el chat, ni el panel, ni el recorrido…). */
  activa: boolean;
  idioma: 'es' | 'en';
  /** En una conversación de voz no habla (ahí pregunta el agente). */
  conversando: () => boolean;
  /** AU-RA ya está hablando. */
  hablando: () => boolean;
  decir: (texto: string) => void;
  /** «Rehacer» pide el borrador otra vez como un turno normal. */
  mandarTurno: (texto: string) => void;
  /** Su computadora: la tarea actual y su estado (la mesa ya lo pregunta). */
  pc?: { id: string; estado: string; instruccion: string; pasos?: number } | null;
};

export function useVentanaDecision(o: Opciones) {
  const [luego, setLuego] = useState<Record<string, number>>({});
  const [cerrada, setCerrada] = useState<{ en: number; hasta: number } | null>(null);
  const [forzada, setForzada] = useState(false);
  const [actualId, setActualId] = useState<string | null>(null);
  const [edicion, setEdicion] = useState<Edicion | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [pc, setPc] = useState<(PreguntaPc & { tarea: TareaPc }) | null>(null);
  const [reloj, setReloj] = useState(() => Date.now());
  const dichas = useRef(new Set<string>());
  const tomados = useRef(new Set<string>());
  const aparecio = useRef<{ clave: string; t: number }>({ clave: '', t: 0 });

  // El reloj de la ventana: lo dejado para luego vuelve solo.
  useEffect(() => {
    const r = setInterval(() => setReloj(Date.now()), 15_000);
    return () => clearInterval(r);
  }, []);

  // ¿Está escribiendo? (el teclado abierto): la ventana no se le echa encima.
  const [teclado, setTeclado] = useState(false);
  useEffect(() => {
    const a = Keyboard.addListener('keyboardDidShow', () => setTeclado(true));
    const b = Keyboard.addListener('keyboardDidHide', () => setTeclado(false));
    return () => {
      a.remove();
      b.remove();
    };
  }, []);

  // La pregunta de su computadora (estado `confirmar`): la tarea con su pregunta, su id y la huella de la propuesta.
  const pcId = o.pc?.estado === 'confirmar' ? o.pc.id : null;
  // Otra pregunta de la misma tarea (avanzó un paso): se vuelve a leer.
  const pcPaso = o.pc?.pasos ?? 0;
  useEffect(() => {
    if (!pcId) {
      setPc(null);
      return;
    }
    let vivo = true;
    void api<{ tarea: TareaPc }>(`/api/computadora/tareas/${encodeURIComponent(pcId)}?idioma=${o.idioma}`, { method: 'GET' }, 12_000)
      .then((r) => {
        const t = r?.tarea;
        if (!vivo || !t || t.estado !== 'confirmar' || !t.pregunta) return;
        setPc({ tareaId: t.id, instruccion: t.instruccion, pregunta: t.pregunta, preguntaId: t.pregunta_id ?? null, propuesta: t.propuesta ?? null, desde: Date.now(), tarea: t });
      })
      .catch(() => undefined);
    return () => {
      vivo = false;
    };
  }, [pcId, pcPaso, o.idioma]);

  const turno = tareasDelUltimoTurno();
  const primero = Date.now() - turno.t < DEL_TURNO_MS ? turno.ids : [];
  const cola = useMemo(() => colaVentana({ tareas: o.trabajos.tareas, pc, ahora: reloj, primero, luego, todas: forzada }), [o.trabajos.tareas, pc, reloj, primero.join(','), luego, forzada]);
  // Lo que acaba de preguntar el turno toma el lugar (una vez por turno y tarea). En una conversación de voz las respuestas
  // no pasan por la mesa: lo que apareció DESPUÉS de lo que se ve (AU-RA lo acaba de preguntar en voz) toma el lugar.
  const vistoDesde = useRef<{ id: string; t: number } | null>(null);
  const porVoz = nuevoPorVoz(cola, { conversando: o.conversando(), visto: vistoDesde.current, tomados: tomados.current });
  const nuevo = primero.find((id) => !tomados.current.has(`${turno.t}:${id}`) && cola.some((x) => x.id === id)) ?? porVoz?.id ?? null;
  const actual = elegirActual(cola, { actual: actualId, nuevo });
  const delTurno = !!actual && primero.includes(actual.id);
  // Con el teclado abierto (está escribiendo en el chat), no se le abre encima: espera a que lo cierre. Si ya estaba abierta
  // (el teclado es el de Editar), sigue.
  const abiertaAntes = useRef(false);
  const abierta = o.activa && (!teclado || abiertaAntes.current) && seAbreSola(actual, { ahora: reloj, cerrada, delTurno, forzada });
  abiertaAntes.current = abierta;
  useEffect(() => {
    marcarVentanaAbierta(abierta);
    return () => marcarVentanaAbierta(false);
  }, [abierta]);

  useEffect(() => {
    if (nuevo) tomados.current.add(`${turno.t}:${nuevo}`);
    if (porVoz) tomados.current.add(`voz:${porVoz.clave}`);
    if (actual && actual.id !== actualId) setActualId(actual.id);
    if (!actual && actualId) setActualId(null);
    // Desde cuándo se ve ESTA (lo que aparezca después, en una conversación de voz, es lo que AU-RA acaba de preguntar).
    if (actual && vistoDesde.current?.id !== actual.id) vistoDesde.current = { id: actual.id, t: Date.now() };
  }, [actual?.id, nuevo, turno.t]); // eslint-disable-line react-hooks/exhaustive-deps

  // Otra decisión a la vista: lo de antes no vale (ni la edición ni el aviso) y la opción con efecto se vuelve a armar.
  const clave = abierta && actual ? actual.clave : '';
  if (clave && aparecio.current.clave !== clave) aparecio.current = { clave, t: Date.now() };
  useEffect(() => {
    setAviso(null);
    setEdicion((e) => (e && clave && e.clave === clave ? e : null));
  }, [clave]);

  // El servidor sabe qué se ve (un «sí» dicho mientras tanto es para ESTA); se renueva mientras siga a la vista.
  // Mientras edita, nada está «a la vista» para el servidor (un «sí» dicho no manda el texto viejo). Cancelar la edición
  // rápido manda «oculta» y «visible» a la vez: cada aviso lleva su número de orden y el servidor ignora el que llegue
  // tarde (revisión 7.5, MENOR 2; lib/trabajos.ts enPantalla).
  const visto = abierta ? tareaEnPantalla(actual, edicion) : null;
  const vistoClave = visto ? actual!.clave : '';
  // Revisión del 6-oct (bloqueante 1): lo que se ve (tarea, decisión y huella) va con el próximo turno HABLADO; mientras
  // edita, o cerrada, nada (lib/decisionVista.ts, lib/api.ts turnoBody).
  const huellaVista = visto?.decision?.fingerprint || '';
  useEffect(() => {
    fijarDecisionVista(visto ? campoDecisionVista(visto) : null);
    return () => fijarDecisionVista(null);
  }, [vistoClave, huellaVista]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!visto) return;
    const t = visto;
    void clienteTrabajos.enPantalla(t, true).then((r) => {
      // La decisión ya cambió (409 decision-vieja con la de ahora): se muestra la nueva.
      if (!r.ok && r.tarea) o.trabajos.aplicar(r.tarea);
      // SEC-01: no quedó registrada (no espera un borrador, o llegó tarde): el «sí» no va atado a esto.
      trasAvisoPantalla(campoDecisionVista(t), r);
    });
    // Renovar no la revive si AU-RA preguntó otra cosa después (la pregunta más reciente es esa). SEC-01: si la renovación
    // dice `registrada: false`, se pierde la autoridad (se suelta el campo), no se toma como éxito.
    const cada = setInterval(() => void clienteTrabajos.enPantalla(t, true, { renovar: true }).then((r) => trasAvisoPantalla(campoDecisionVista(t), r)), RENOVAR_PANTALLA_MS);
    return () => {
      clearInterval(cada);
      void clienteTrabajos.enPantalla(t, false);
    };
  }, [vistoClave]); // eslint-disable-line react-hooks/exhaustive-deps

  // La pregunta en voz alta, una vez por decisión y solo cuando toca.
  useEffect(() => {
    if (!abierta || !actual) return;
    if (debeHablar({ clave: actual.clave, dichas: dichas.current, conversando: o.conversando(), hablando: o.hablando(), visible: true, delTurno })) {
      o.decir(fraseVentana(actual, o.idioma));
    }
    // Dicha o no (en una conversación de voz, o porque el turno ya la leyó), no se vuelve a decir esta misma.
    dichas.current.add(actual.clave);
  }, [abierta, actual?.clave]); // eslint-disable-line react-hooks/exhaustive-deps

  const tras = useCallback(
    (r: ResultadoAccion) => {
      if (r.ok) {
        setAviso(null);
        o.trabajos.aplicar(r.tarea);
      } else {
        setAviso(r.mensaje);
        // 409 con la tarea de ahora (otra decisión, otra versión): se muestra la de ahora, nunca una vieja.
        if (r.tarea) o.trabajos.aplicar(r.tarea);
      }
      void o.trabajos.refrescar();
    },
    [o.trabajos]
  );

  const responder = useCallback(
    async (b: BotonVentana) => {
      if (!actual || ocupado) return;
      if (b.tipo === 'editar') {
        setEdicion(empezarEdicion(actual, o.idioma));
        return;
      }
      if (b.tipo === 'rehacer') {
        const pedido = pedidoRehacer(actual, o.idioma);
        // Se aparta mientras AU-RA arma el nuevo (que vuelve a esta misma tarjeta para su «sí»).
        setLuego((l) => ({ ...l, [actual.clave]: Date.now() + LUEGO_MS }));
        if (pedido) o.mandarTurno(pedido);
        return;
      }
      if (!puedeActivar({ conEfecto: b.conEfecto }, { aparecio: aparecio.current.t, ahora: Date.now(), via: 'toque' })) return;
      setOcupado(b.id);
      try {
        if (actual.tipo === 'computadora') {
          try {
            await api(`/api/computadora/tareas/${encodeURIComponent(actual.pc.tareaId)}/confirmar`, { method: 'POST', body: JSON.stringify(respuestaPc(b.tipo === 'si', null, pc?.tarea)) }, 15_000);
            setPc(null);
            setAviso(null);
          } catch (e: any) {
            setAviso(String(e?.data?.error || e?.message || (o.idioma === 'en' ? 'It did not get your answer.' : 'No le llegó tu respuesta.')).slice(0, 160));
          }
          return;
        }
        if (!b.opcion) return;
        tras(await clienteTrabajos.decidir(actual.tarea, b.opcion));
      } finally {
        setOcupado(null);
      }
    },
    [actual, ocupado, pc, tras, o]
  );

  const guardar = useCallback(async () => {
    if (!actual || actual.tipo !== 'tarea' || !edicion || !edicionVigente(edicion, actual) || !puedeGuardar(edicion) || ocupado) return;
    setOcupado('guardar');
    try {
      const r = await clienteTrabajos.editar(actual.tarea, cuerpoEdicion(edicion));
      if (r.ok) setEdicion(null);
      tras(r);
    } finally {
      setOcupado(null);
    }
  }, [actual, edicion, ocupado, tras]);

  /** «Luego» (o cerrar la ventana): se pospone (vuelve sola) y la ventana no se le echa encima otra vez por un rato. */
  const despues = useCallback(() => {
    if (!actual) return;
    const ahora = Date.now();
    setLuego((l) => ({ ...l, [actual.clave]: ahora + LUEGO_MS }));
    setCerrada({ en: ahora, hasta: ahora + LUEGO_MS });
    setForzada(false);
    setEdicion(null);
    if (luegoEnServidor(actual) && actual.tipo === 'tarea') void clienteTrabajos.decidir(actual.tarea, 'posponer', { hasta: hastaLuego(ahora) }).then((r) => r.ok && o.trabajos.aplicar(r.tarea));
  }, [actual, o.trabajos]);

  /** Tocó el indicador: si hay algo que decidir (también lo dejado para luego), se abre la ventana. */
  const abrirDesdeIndicador = useCallback((): boolean => {
    const todas = colaVentana({ tareas: o.trabajos.tareas, pc, ahora: Date.now(), todas: true });
    if (!todas.length) return false;
    setCerrada(null);
    setLuego({});
    setForzada(true);
    return true;
  }, [o.trabajos.tareas, pc]);

  /**
   * «Editar» desde el panel de tareas: se abre la ventana con ESA tarea y su texto listo para cambiar (antes, Editar tiraba
   * el borrador y dejaba una sugerencia en el chat). false si no se puede editar aquí (el panel sigue como siempre).
   */
  const abrirParaEditar = useCallback(
    (id: string): boolean => {
      const item = colaVentana({ tareas: o.trabajos.tareas, ahora: Date.now(), todas: true }).find((x) => x.id === id);
      const e = item ? empezarEdicion(item, o.idioma) : null;
      if (!item || !e) return false;
      setCerrada(null);
      setForzada(true);
      setActualId(id);
      // La edición se pone cuando la ventana ya muestra esa tarea (al cambiar de clave se limpia la de antes).
      setTimeout(() => setEdicion(e), 0);
      return true;
    },
    [o.trabajos.tareas, o.idioma]
  );

  // Sin nada que mostrar, lo forzado se apaga (la próxima vez vuelve a respetar «Luego»).
  useEffect(() => {
    if (forzada && !cola.length) setForzada(false);
  }, [forzada, cola.length]);

  const i = actual ? cola.findIndex((x) => x.clave === actual.clave) : -1;
  return {
    abierta,
    item: abierta ? (actual as ItemVentana) : null,
    datos: abierta && actual ? datosVentana(actual, o.idioma) : null,
    botones: abierta && actual ? botonesVentana(actual, o.idioma) : [],
    conLuego: abierta && !!actual && tieneLuego(actual),
    posicion: textoPosicion(i, cola.length, o.idioma),
    armadaDesde: aparecio.current.t,
    edicion,
    setEdicion,
    puedeGuardar: puedeGuardar(edicion),
    ocupado,
    aviso,
    responder,
    guardar,
    despues,
    abrirDesdeIndicador,
    abrirParaEditar,
  };
}

export type VentanaDecisionEstado = ReturnType<typeof useVentanaDecision>;
