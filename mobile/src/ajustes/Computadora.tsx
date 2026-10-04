/**
 * SU COMPUTADORA: ver lo que hace la computadora en la nube del avatar y encargarle algo
 * (server/computadora.ts; la lógica en compa/computadora.ts).
 *
 * José (2-oct, tarde): «tiene que funcionar ya todo… copiemos cómo lo hacen Grok, el agente de ChatGPT».
 * La hoja es la de un agente tipo Operator, de arriba abajo:
 *   · cómo está (lista, trabajando, en pausa, espera tu sí, la tienes tú, apagada) y el TIEMPO transcurrido;
 *   · la CAPTURA en vivo (la del último paso, cada 2,5 s); con el control en tus manos, la pantalla de ahora
 *     y tocarla hace clic ahí (más escribir, Enter y bajar);
 *   · lo último que AURA contó («Ya entré a bch.hn.»);
 *   · si pide tu sí antes de algo sensible (enviar, iniciar sesión, publicar, borrar): la pregunta con
 *     «Sí, hazlo» / «No». Pagar o comprar: nunca;
 *   · el PLAN de la misión como lista que se va marcando (hecho ✓, ahora ●, en espera Ⅱ, falló ✕);
 *   · Detener siempre; Pausar/Seguir y Tomar el control/Devolver si su servicio lo sabe (si no, se dice);
 *   · al terminar, la TARJETA del resultado: lo que encontró, los datos, los enlaces, la captura final,
 *     «Compartir» (y «Seguir» si quedó a medias);
 *   · lo que hizo paso a paso (tocar uno muestra lo que veía ahí), encargar algo nuevo y el HISTORIAL.
 *
 * La hoja es UNA para toda la app (app/ComputadoraEnVivo.tsx la dibuja encima de cualquier pantalla): se
 * abre sola cuando una tarea empieza o pide tu sí, y sigue la tarea que le dicen (`tareaId`).
 * `HojaComputadora` (la de la mesa y Ajustes) solo la abre. Cada persona ve solo sus encargos.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Image, Linking, Pressable, Share, StyleSheet, View, useWindowDimensions, type GestureResponderEvent } from 'react-native';
import { api } from '../lib/api';
import { tr, idiomaActual } from '../i18n';
import { MEDIDA, useTema } from '../nucleo/tema';
import { Boton, Campo, Hoja, Texto, vibrar } from '../ui';
import {
  EJEMPLOS_PC,
  aCoordenadas,
  controlesPc,
  estadoEnPalabras,
  entregablesEnPalabras,
  finalEnPalabras,
  haceCuanto,
  marcaPlan,
  nuevoPedidoPc,
  puedeVerPantallaPc,
  relojMision,
  respuestaPc,
  sondeoMs,
  VistaPc,
  tareaEnPalabras,
  textoParaCompartir,
  trabajando,
  type EstadoPc,
  type EstadoTareaPc,
  type FinalPc,
  type MisionPc,
  type TareaPc,
} from '../compa/computadora';
import { abrirHoja, hayAnfitrion } from '../app/hojas';
import { abrirVisor } from '../app/visor';

type PropsHoja = { visible: boolean; onCerrar: () => void; nombreAvatar: string };

/**
 * La de la mesa y Ajustes: abre la hoja de toda la app (una sola, la que se abre sola al empezar una
 * tarea) y suelta la suya. Sin la raíz que la dibuja (una pantalla suelta), dibuja la propia como antes.
 */
export function HojaComputadora({ visible, onCerrar, nombreAvatar }: PropsHoja) {
  const global = hayAnfitrion();
  useEffect(() => {
    if (!visible || !global) return;
    abrirHoja('computadora');
    onCerrar();
  }, [visible, global]); // eslint-disable-line react-hooks/exhaustive-deps
  if (global) return null;
  return <HojaComputadoraVivo visible={visible} onCerrar={onCerrar} nombreAvatar={nombreAvatar} />;
}

/** Tras tantas lecturas seguidas sin respuesta, se le dice que no llega lo que hace (y se sigue intentando). */
const FALLOS_PARA_AVISAR = 3;

export function HojaComputadoraVivo({
  visible,
  onCerrar,
  nombreAvatar,
  tareaId = null,
  frase = '',
  planInicial = [],
  pregunta: preguntaAviso = null,
  alEstado,
}: PropsHoja & {
  /** Lo que ve de la tarea (para que el tecleo se apague si terminó o se quedó quieta y el aviso se perdió). */
  alEstado?: (id: string, trabajandoAhora: boolean, estado: EstadoTareaPc) => void;
  /** La tarea que hay que mostrar (la que acaba de empezar o la que sigue la misión). */
  tareaId?: string | null;
  /** Lo último que AURA contó de lo que hace. */
  frase?: string;
  /** El plan que llegó con el aviso de empezar (antes de la primera consulta). */
  planInicial?: string[];
  /** La pregunta que llegó con el aviso (antes de la primera consulta). */
  pregunta?: string | null;
}) {
  const tema = useTema();
  const { width } = useWindowDimensions();
  const idioma = idiomaActual() === 'en' ? 'en' : 'es';
  const [estado, setEstado] = useState<EstadoPc | null>(null);
  const [tarea, setTarea] = useState<TareaPc | null>(null);
  const [mision, setMision] = useState<MisionPc | null>(null);
  /** Cuándo llegó la misión (el reloj cuenta desde su `transcurrido`, sin depender de la hora del teléfono). */
  const [recibida, setRecibida] = useState(0);
  const [ahora, setAhora] = useState(Date.now());
  const [verPaso, setVerPaso] = useState<number | null>(null);
  const [capturaPaso, setCapturaPaso] = useState<string | null>(null);
  const [pedido, setPedido] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [sinRespuesta, setSinRespuesta] = useState(0);
  const [pantallaViva, setPantallaViva] = useState<string | null>(null);
  const [textoControl, setTextoControl] = useState('');
  const [todosLosPasos, setTodosLosPasos] = useState(false);
  /** Una misión del historial abierta (su tarjeta del final). */
  const [delHistorial, setDelHistorial] = useState<MisionPc | null>(null);
  /**
   * Qué tarea se mira y qué respuesta todavía vale (época de la vista y versión del estado): una lectura que
   * salió antes de elegir otra tarea, o más vieja que la última pintada, no se pinta (auditoría 3-oct, PC05).
   */
  const vista = useRef(new VistaPc()).current;
  /** El encargo en camino y su id: si se reintenta el mismo texto, va con el mismo id (el servidor no lanza dos). */
  const pedidoRef = useRef<{ texto: string; id: string } | null>(null);
  const tareaRef = useRef(tarea);
  tareaRef.current = tarea;
  const alEstadoRef = useRef(alEstado);
  alEstadoRef.current = alEstado;

  const leerTarea = useCallback(
    async (id: string) => {
      const boleto = vista.boleto();
      try {
        const r = await api<{ tarea: TareaPc; mision: MisionPc | null; version?: number }>(`/api/computadora/tareas/${encodeURIComponent(id)}?idioma=${idioma}`, { method: 'GET' }, 12_000);
        const vale = vista.acepta(boleto, id, r.version, r.tarea.estado);
        if (vale) {
          setTarea(r.tarea);
          if (r.mision) {
            setMision(r.mision);
            setRecibida(Date.now());
          }
        }
        setSinRespuesta(0);
        // Un estado vivo viejo de una tarea que ya se vio terminar no vuelve a encender nada (AUR04).
        if (vale || !vista.terminada(id)) alEstadoRef.current?.(id, trabajando(r.tarea.estado), r.tarea.estado);
      } catch {
        // La próxima vuelta lo intenta otra vez; tras unas cuantas, se le dice (nunca se queda colgada sin decir nada).
        setSinRespuesta((n) => n + 1);
      }
    },
    [idioma, vista]
  );

  const leerEstado = useCallback(async () => {
    const boleto = vista.boleto();
    try {
      const s = await api<EstadoPc>('/api/computadora', { method: 'GET' }, 12_000);
      if (!vista.aceptaEstado(s.version)) return s;
      setEstado(s);
      const id = s.actual?.id || s.ultima;
      // Solo si nadie eligió otra tarea mientras esta lectura iba (antes un estado viejo volvía a la anterior).
      if (id && id !== vista.id && vista.puedeCambiar(boleto)) {
        vista.elegir(id);
        setMision((m) => (m && m.tareaId === id ? m : null));
        void leerTarea(id);
      }
      return s;
    } catch (e: any) {
      setEstado((x) => x ?? { configurada: true, ok: false, motores: [], ocupada: false, ultima: null, actual: null, detalle: String(e?.message || '') });
      return null;
    }
  }, [leerTarea, vista]);

  // Abierta: estado y encargo; mientras trabaja se renueva rápido (se ve avanzar), si no, despacio.
  useEffect(() => {
    if (!visible) return;
    let vivo = true;
    let reloj: ReturnType<typeof setTimeout>;
    const vuelta = async () => {
      if (!vivo) return;
      const s = await leerEstado();
      // También cuando el servidor ya la ve terminada y aquí sigue «trabajando»: una última lectura para cerrarla
      // (auditoría, 3-oct: el reloj y Detener se quedaban para siempre).
      if (vista.id && (trabajando(tareaRef.current?.estado) || trabajando(s?.actual?.estado))) await leerTarea(vista.id);
      if (vivo) reloj = setTimeout(vuelta, sondeoMs(s?.actual?.estado ?? tareaRef.current?.estado, true));
    };
    void vuelta();
    return () => {
      vivo = false;
      clearTimeout(reloj);
    };
  }, [visible, leerEstado, leerTarea, vista]);

  // Le dicen qué tarea seguir (empezó una, o la misión siguió con otra): se muestra ya, sin esperar al sondeo.
  useEffect(() => {
    if (!visible || !tareaId || tareaId === vista.id) return;
    vista.elegir(tareaId);
    setVerPaso(null);
    setDelHistorial(null);
    // Otra misión: la de antes no se mezcla (mientras llega, el plan es el del aviso de empezar).
    setMision((m) => (m && m.tareaId === tareaId ? m : null));
    setTarea((t) => (t?.id === tareaId ? t : { id: tareaId, instruccion: t?.instruccion || '', estado: 'en_cola', pasos: [], respuesta: null, error: null, segundos: 0 }));
    void leerTarea(tareaId);
  }, [visible, tareaId, leerTarea, vista]);

  useEffect(() => {
    if (!visible) {
      setVerPaso(null);
      setCapturaPaso(null);
      setError('');
      setDelHistorial(null);
      setPantallaViva(null);
    }
  }, [visible]);

  const sigue = trabajando(tarea?.estado);
  const conControl = tarea?.estado === 'control';

  // El reloj de la misión, cada segundo mientras está viva.
  useEffect(() => {
    if (!visible || !sigue) return;
    const r = setInterval(() => setAhora(Date.now()), 1000);
    return () => clearInterval(r);
  }, [visible, sigue]);

  // Con el control en sus manos: la pantalla de ahora (no la del último paso del agente), cada 1,5 s.
  useEffect(() => {
    if (!visible || !conControl || !tarea) {
      setPantallaViva(null);
      return;
    }
    let vivo = true;
    let reloj: ReturnType<typeof setTimeout>;
    const id = tarea.id;
    const vuelta = async () => {
      try {
        const r = await api<{ imagen: string }>(`/api/computadora/tareas/${encodeURIComponent(id)}/pantalla`, { method: 'GET' }, 12_000);
        if (vivo) setPantallaViva(r.imagen);
      } catch {
        /* la próxima */
      }
      if (vivo) reloj = setTimeout(vuelta, 1500);
    };
    void vuelta();
    return () => {
      vivo = false;
      clearTimeout(reloj);
    };
  }, [visible, conControl, tarea?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Tocó un paso: la captura de ese momento.
  useEffect(() => {
    setCapturaPaso(null);
    if (verPaso == null || !tarea) return;
    let vivo = true;
    void api<{ tarea: TareaPc }>(`/api/computadora/tareas/${encodeURIComponent(tarea.id)}?paso=${verPaso}&idioma=${idioma}`, { method: 'GET' }, 12_000)
      .then((r) => vivo && setCapturaPaso(r.tarea.pasos.find((p) => p.n === verPaso)?.miniatura || null))
      .catch(() => {});
    return () => {
      vivo = false;
    };
  }, [verPaso, tarea?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const encargar = async (texto: string) => {
    const t = texto.trim();
    if (t.length < 4) return;
    setError('');
    setEnviando(true);
    // El mismo texto que no alcanzó a contestar (se cortó la red) vuelve con el mismo id: la misma misión.
    if (pedidoRef.current?.texto !== t) pedidoRef.current = { texto: t, id: nuevoPedidoPc() };
    try {
      const r = await api<{ id: string; mision: MisionPc | null }>('/api/computadora/tareas', { method: 'POST', body: JSON.stringify({ instruccion: t, idioma, requestId: pedidoRef.current.id }) }, 20_000);
      vibrar('exito');
      pedidoRef.current = null;
      vista.elegir(r.id);
      setVerPaso(null);
      setDelHistorial(null);
      setTarea({ id: r.id, instruccion: t, estado: 'en_cola', pasos: [], respuesta: null, error: null, segundos: 0 });
      setMision(r.mision);
      setRecibida(Date.now());
      setPedido('');
      void leerEstado();
    } catch (e: any) {
      vibrar('aviso');
      setError(e?.message || tr('No pude encargárselo. Prueba en un momento.', 'I couldn’t give it the task. Try again in a moment.'));
    } finally {
      setEnviando(false);
    }
  };

  /** Un botón sobre la tarea (detener, pausar, seguir, control, sí/no): con su «cargando» y el error dicho claro. */
  const sobreTarea = async (que: string, ruta: string, cuerpo: unknown = {}) => {
    // Detener nunca espera a otro botón: si «Sí» o «Pausar» siguen en camino, se manda igual (auditoría, 3-oct).
    if (!tarea || (ocupado && que !== 'parar') || ocupado === 'parar') return;
    setError('');
    setOcupado(que);
    try {
      const r = await api<{ fase?: string | null }>(`/api/computadora/tareas/${encodeURIComponent(tarea.id)}/${ruta}`, { method: 'POST', body: JSON.stringify(cuerpo) }, 15_000);
      vibrar('medio');
      // Un toque que ya había salido termina primero (no se deshace): no se dice «detenida» ni «tú controlas» todavía.
      if (r?.fase === 'draining')
        setError(tr('Está terminando una acción que ya había empezado; en un momento queda como pediste.', 'It is finishing an action it had already started; in a moment it will be as you asked.'));
      await leerTarea(tarea.id);
    } catch (e: any) {
      vibrar('aviso');
      setError(e?.message || tr('La computadora no contestó.', 'The computer didn’t answer.'));
    } finally {
      setOcupado(null);
    }
  };

  /** Con el control: tocar la pantalla, escribir, una tecla, bajar. */
  const accion = async (cuerpo: Record<string, unknown>) => {
    if (!tarea) return;
    try {
      await api(`/api/computadora/tareas/${encodeURIComponent(tarea.id)}/accion`, { method: 'POST', body: JSON.stringify(cuerpo) }, 20_000);
      vibrar('suave');
    } catch (e: any) {
      setError(e?.message || '');
    }
  };

  const seguirMision = async (m: MisionPc) => {
    setError('');
    setOcupado('seguir');
    try {
      const r = await api<{ id: string }>(`/api/computadora/misiones/${encodeURIComponent(m.id)}/seguir`, { method: 'POST', body: '{}' }, 20_000);
      vista.elegir(r.id);
      setDelHistorial(null);
      setTarea({ id: r.id, instruccion: m.instruccion, estado: 'en_cola', pasos: [], respuesta: null, error: null, segundos: 0 });
      void leerTarea(r.id);
    } catch (e: any) {
      setError(e?.message || '');
    } finally {
      setOcupado(null);
    }
  };

  const abrirDelHistorial = async (id: string) => {
    try {
      const r = await api<{ mision: MisionPc }>(`/api/computadora/misiones/${encodeURIComponent(id)}`, { method: 'GET' }, 12_000);
      setDelHistorial(r.mision);
    } catch (e: any) {
      setError(e?.message || '');
    }
  };

  const compartir = (instruccion: string, f: FinalPc) => {
    void Share.share({ message: textoParaCompartir(instruccion, f, idioma) }).catch(() => undefined);
  };

  const linea = estadoEnPalabras(estado, idioma);
  const colorLinea = linea.tono === 'bien' ? tema.exito : linea.tono === 'trabaja' ? tema.acento : linea.tono === 'mal' ? tema.aviso : tema.texto3;
  // Lo que se ve grande: con el control, la pantalla de ahora; si no, el paso que tocó o lo último que vio.
  const ultimaCaptura = tarea ? [...tarea.pasos].reverse().find((p) => p.miniatura)?.miniatura || null : null;
  const captura = conControl && pantallaViva ? pantallaViva : verPaso != null ? capturaPaso : ultimaCaptura || mision?.final?.captura || null;
  const anchoImg = Math.min(width - 2 * MEDIDA.espacio.xl - 4, 520);
  const altoImg = Math.round(anchoImg * 0.625);
  const puede = !!estado?.configurada && !!estado?.ok;
  const misionDeAhora = mision;
  const plan = misionDeAhora?.plan?.length ? misionDeAhora.plan : planInicial.map((texto, i) => ({ texto, estado: i === 0 && sigue ? ('actual' as const) : ('pendiente' as const) }));
  const transcurrido = misionDeAhora ? misionDeAhora.transcurrido + (sigue && recibida ? Math.max(0, Math.round((ahora - recibida) / 1000)) : 0) : tarea?.segundos || 0;
  const pregunta = tarea?.estado === 'confirmar' ? misionDeAhora?.pregunta || tarea.pregunta || preguntaAviso : null;
  const c = controlesPc(estado?.capacidades, tarea?.estado);
  const finalAhora = !sigue ? misionDeAhora?.final ?? null : null;
  const pasosConTexto = tarea ? tarea.pasos.filter((p) => p.texto) : [];
  const pasosVisibles = todosLosPasos ? pasosConTexto : pasosConTexto.slice(-4);
  const historial = (estado?.historial ?? []).filter((h) => h.id !== misionDeAhora?.id).slice(0, 6);

  const tocarPantalla = (ev: GestureResponderEvent) => {
    if (!conControl) return;
    const { locationX, locationY } = ev.nativeEvent;
    void accion({ tipo: 'click', ...aCoordenadas(locationX, locationY, anchoImg, altoImg) });
  };

  return (
    <Hoja
      visible={visible}
      onCerrar={onCerrar}
      // Detener siempre a la vista, fijo abajo, aunque la hoja sea larga (antes quedaba debajo de la captura y el plan).
      pie={
        tarea && sigue ? (
          <Boton titulo={tr('Detener la tarea', 'Stop the task')} variante="peligro" cargando={ocupado === 'parar'} onPress={() => void sobreTarea('parar', 'parar')} />
        ) : undefined
      }
      titulo={tr('Su computadora', 'Their computer')}
      subtitulo={tr(
        `${nombreAvatar} tiene su propia computadora en la nube (con Firefox) para hacer cosas en páginas por ti. Aquí ves su plan y lo que hace, paso a paso.`,
        `${nombreAvatar} has a cloud computer (with Firefox) to do things on websites for you. Here you see its plan and what it does, step by step.`
      )}
    >
      <View style={{ gap: MEDIDA.espacio.l }}>
        <View style={s.fila}>
          <View style={[s.punto, { backgroundColor: colorLinea }]} />
          <Texto v="chicaFuerte" style={{ flex: 1 }}>
            {linea.texto}
          </Texto>
          {tarea && (sigue || finalAhora) ? (
            <Texto v="mini" color="texto3" accessibilityLabel={tr('Tiempo transcurrido', 'Elapsed time')}>
              ⏱ {relojMision(finalAhora ? finalAhora.segundos : transcurrido)}
            </Texto>
          ) : null}
        </View>

        {delHistorial ? (
          <TarjetaFinal
            mision={delHistorial}
            onCompartir={compartir}
            onSeguir={seguirMision}
            ocupado={ocupado}
            ancho={anchoImg}
            arriba={
              <Pressable onPress={() => setDelHistorial(null)} accessibilityRole="button">
                <Texto v="mini" color="acento">
                  ‹ {tr('Volver a lo de ahora', 'Back to now')}
                </Texto>
              </Pressable>
            }
          />
        ) : tarea ? (
          <View style={[s.tarjeta, { borderColor: tema.borde, backgroundColor: tema.superficie }]}>
            <Texto v="mini" color="texto3">
              {sigue ? tr('MISIÓN EN CURSO', 'MISSION IN PROGRESS') : tr('ÚLTIMA MISIÓN', 'LAST MISSION')}
              {misionDeAhora?.vuelta ? ` · ${tr(`parte ${misionDeAhora.vuelta + 1}`, `part ${misionDeAhora.vuelta + 1}`)}` : ''}
            </Texto>
            {tarea.instruccion || misionDeAhora?.instruccion ? <Texto v="cuerpo">«{misionDeAhora?.instruccion || tarea.instruccion}»</Texto> : null}

            {/* La pantalla en vivo, arriba de todo (con el control, tocarla hace clic ahí). */}
            <Pressable
              onPress={tocarPantalla}
              disabled={!conControl}
              accessibilityRole={conControl ? 'button' : 'image'}
              accessibilityLabel={conControl ? tr('Toca para hacer clic ahí', 'Tap to click there') : tr('Lo que ve su computadora', 'What its computer sees')}
              style={[s.pantalla, { width: anchoImg, height: altoImg, borderColor: conControl ? tema.acento : tema.borde, backgroundColor: tema.fondo2 }]}
            >
              {captura ? (
                <Image source={{ uri: `data:image/jpeg;base64,${captura}` }} style={StyleSheet.absoluteFill} resizeMode="contain" />
              ) : (
                <Texto v="mini" color="texto3">
                  {sigue ? tr('Abriendo el escritorio…', 'Opening the desktop…') : tr('Sin captura', 'No screenshot')}
                </Texto>
              )}
              {verPaso != null ? (
                <Pressable onPress={() => setVerPaso(null)} style={[s.etiquetaPaso, { backgroundColor: tema.acento }]} accessibilityRole="button">
                  <Texto v="mini" style={{ color: tema.sobreAcento }}>
                    {tr(`Paso ${verPaso} · volver a lo de ahora`, `Step ${verPaso} · back to now`)}
                  </Texto>
                </Pressable>
              ) : sigue ? (
                <View style={[s.etiquetaPaso, { backgroundColor: 'rgba(0,0,0,0.6)' }]}>
                  <Texto v="mini" style={{ color: '#fff' }}>
                    {conControl ? `✋ ${tr('tienes el control: toca para hacer clic', 'you have control: tap to click')}` : tarea.estado === 'pausada' ? `Ⅱ ${tr('en pausa', 'paused')}` : `● ${tr('en vivo', 'live')}`}
                  </Texto>
                </View>
              ) : null}
            </Pressable>

            {/* El visor a pantalla completa (app/VisorComputadora.tsx): verla y usarla de verdad. Cerrarlo vuelve al
                chat sin tocar la tarea; reabrirlo encuentra la misma sesión. AURA nunca lo abre sola. */}
            {puedeVerPantallaPc(estado?.capacidades, tarea.estado) ? (
              <Boton
                titulo={tr('Pantalla completa', 'Full screen')}
                tam="chico"
                variante="secundario"
                onPress={() => {
                  const id = tarea.id;
                  onCerrar();
                  // La hoja termina de irse antes de abrir el visor (iOS no presenta un Modal mientras otro se va).
                  setTimeout(() => abrirVisor(id), 320);
                }}
              />
            ) : null}

            {sinRespuesta >= FALLOS_PARA_AVISAR && sigue ? (
              <Texto v="chica" color="aviso">
                {tr('No me llega lo que hace tu computadora. Sigo intentando…', 'I’m not getting updates from your computer. Still trying…')}
              </Texto>
            ) : null}

            {sigue && frase && !pregunta ? (
              <View style={[s.frase, { backgroundColor: tema.acentoFondo }]}>
                {tarea.estado === 'trabajando' || tarea.estado === 'en_cola' ? <ActivityIndicator size="small" color={tema.acento} /> : null}
                <Texto v="chica" style={{ flex: 1 }}>
                  {nombreAvatar}: «{frase}»
                </Texto>
              </View>
            ) : null}

            {/* Antes de algo sensible: su sí. Pagar o comprar, nunca. */}
            {pregunta && c.contestar ? (
              <View style={[s.pregunta, { borderColor: tema.acento, backgroundColor: tema.acentoFondo }]}>
                <Texto v="chicaFuerte">{tr('Necesito tu sí para seguir', 'I need your OK to go on')}</Texto>
                <Texto v="cuerpo">{pregunta}</Texto>
                <View style={s.filaBotones}>
                  <Boton titulo={tr('Sí, hazlo', 'Yes, do it')} tam="chico" cargando={ocupado === 'si'} onPress={() => void sobreTarea('si', 'confirmar', respuestaPc(true, misionDeAhora, tarea))} style={{ flex: 1 }} />
                  <Boton titulo={tr('No', 'No')} tam="chico" variante="secundario" cargando={ocupado === 'no'} onPress={() => void sobreTarea('no', 'confirmar', respuestaPc(false, misionDeAhora, tarea))} style={{ flex: 1 }} />
                </View>
                <Texto v="mini" color="texto3">
                  {tr('También puedes decírmelo en voz. Pagar o comprar no lo hago nunca.', 'You can also say it out loud. I never pay or buy.')}
                </Texto>
              </View>
            ) : null}

            {/* Con el control: escribir, Enter, bajar/subir, y devolver. */}
            {conControl ? (
              <View style={{ gap: 6 }}>
                <Campo
                  etiqueta={tr('Escribir en la computadora', 'Type on the computer')}
                  value={textoControl}
                  onChangeText={setTextoControl}
                  placeholder={tr('Toca primero el campo en la pantalla', 'Tap the field on the screen first')}
                  maxLength={500}
                />
                <View style={s.filaBotones}>
                  <Boton
                    titulo={tr('Escribir', 'Type')}
                    tam="chico"
                    variante="secundario"
                    deshabilitado={!textoControl}
                    onPress={() => {
                      void accion({ tipo: 'escribir', texto: textoControl });
                      setTextoControl('');
                    }}
                    style={{ flex: 1 }}
                  />
                  <Boton titulo="Enter" tam="chico" variante="secundario" onPress={() => void accion({ tipo: 'tecla', teclas: 'enter' })} style={{ flex: 1 }} />
                  <Boton titulo="↑" tam="chico" variante="secundario" onPress={() => void accion({ tipo: 'scroll', direccion: 'up' })} />
                  <Boton titulo="↓" tam="chico" variante="secundario" onPress={() => void accion({ tipo: 'scroll', direccion: 'down' })} />
                </View>
                <Texto v="mini" color="texto3">
                  {tr('Lo que escribes no se guarda en los pasos. Cuando termines, devuélvela y sigue desde ahí.', 'What you type isn’t kept in the steps. When you’re done, give it back and it goes on from there.')}
                </Texto>
              </View>
            ) : null}

            {/* El plan: la lista que se va marcando. */}
            {plan.length ? (
              <View style={{ gap: 2 }}>
                <Texto v="chicaFuerte">{tr('El plan', 'The plan')}</Texto>
                {plan.map((p, i) => (
                  <View key={`${i}-${p.texto}`} style={s.paso} accessibilityLabel={`${p.texto}: ${p.estado}`}>
                    {p.estado === 'actual' && sigue ? (
                      <ActivityIndicator size="small" color={tema.acento} style={s.marca} />
                    ) : (
                      <Texto v="chicaFuerte" style={[s.marca, { color: p.estado === 'hecho' ? tema.exito : p.estado === 'fallo' ? tema.aviso : p.estado === 'pendiente' ? tema.texto3 : tema.acento }]}>
                        {marcaPlan(p.estado)}
                      </Texto>
                    )}
                    <Texto v="chica" color={p.estado === 'pendiente' ? 'texto3' : 'texto'} style={[{ flex: 1 }, p.estado === 'hecho' && { textDecorationLine: 'line-through' }]}>
                      {p.texto}
                    </Texto>
                  </View>
                ))}
              </View>
            ) : null}

            <View style={s.fila}>
              {sigue && tarea.estado !== 'confirmar' ? <ActivityIndicator size="small" color={tema.acento} /> : null}
              <Texto v="chica" color={tarea.estado === 'fallo' || tarea.estado === 'sin_pasos' ? 'aviso' : 'texto2'} style={{ flex: 1 }}>
                {tareaEnPalabras(tarea, idioma)}
              </Texto>
            </View>

            {/* Los mandos: Detener siempre; Pausar/Seguir y el control si su servicio los sabe. */}
            {sigue ? (
              <View style={{ gap: 6 }}>
                <View style={s.filaBotones}>
                  {c.pausar ? <Boton titulo={tr('Pausar', 'Pause')} tam="chico" variante="secundario" cargando={ocupado === 'pausar'} onPress={() => void sobreTarea('pausar', 'pausar')} style={{ flex: 1 }} /> : null}
                  {c.seguir ? <Boton titulo={tr('Seguir', 'Resume')} tam="chico" cargando={ocupado === 'seguir-t'} onPress={() => void sobreTarea('seguir-t', 'reanudar')} style={{ flex: 1 }} /> : null}
                  {c.tomar ? <Boton titulo={tr('Tomar el control', 'Take control')} tam="chico" variante="secundario" cargando={ocupado === 'tomar'} onPress={() => void sobreTarea('tomar', 'control', { tomar: true })} style={{ flex: 1 }} /> : null}
                  {c.devolver ? <Boton titulo={tr('Devolver', 'Give back')} tam="chico" cargando={ocupado === 'devolver'} onPress={() => void sobreTarea('devolver', 'control', { tomar: false })} style={{ flex: 1 }} /> : null}
                </View>
                {c.faltaActualizar ? (
                  <Texto v="mini" color="texto3">
                    {tr(
                      'Pausar y tomar el control llegan cuando se actualice el servicio de su computadora. Por ahora puedes detenerla.',
                      'Pause and take control arrive once its computer service is updated. For now you can stop it.'
                    )}
                  </Texto>
                ) : null}
              </View>
            ) : null}

            {/* El final: la tarjeta para leer, copiar y compartir. */}
            {finalAhora && misionDeAhora ? <TarjetaFinal mision={misionDeAhora} onCompartir={compartir} onSeguir={seguirMision} ocupado={ocupado} ancho={anchoImg} sinCaptura /> : null}
            {!finalAhora && !sigue && tarea.respuesta ? (
              <View style={{ gap: 4 }}>
                <Texto v="chicaFuerte">{tr('Lo que encontró', 'What it found')}</Texto>
                <Texto v="cuerpo" selectable>
                  {tarea.respuesta}
                </Texto>
              </View>
            ) : null}

            {pasosConTexto.length ? (
              <View style={{ gap: 2 }}>
                <Texto v="chicaFuerte">{tr('Lo que hizo', 'What it did')}</Texto>
                {pasosVisibles.map((p) => (
                  <Pressable key={p.n} onPress={() => setVerPaso(p.n === verPaso ? null : p.n)} accessibilityRole="button" style={[s.paso, p.n === verPaso && { backgroundColor: tema.acentoFondo }]}>
                    <Texto v="mini" color="texto3" style={s.pasoN}>
                      {p.n}
                    </Texto>
                    <Texto v="chica" style={{ flex: 1 }}>
                      {p.texto}
                    </Texto>
                    <Texto v="mini" color="texto3">
                      {Math.round(p.t)} s
                    </Texto>
                  </Pressable>
                ))}
                {pasosConTexto.length > pasosVisibles.length || todosLosPasos ? (
                  <Pressable onPress={() => setTodosLosPasos((x) => !x)} accessibilityRole="button">
                    <Texto v="mini" color="acento">
                      {todosLosPasos ? tr('Ver menos', 'Show less') : tr(`Ver los ${pasosConTexto.length} pasos`, `See all ${pasosConTexto.length} steps`)}
                    </Texto>
                  </Pressable>
                ) : null}
              </View>
            ) : null}
          </View>
        ) : estado?.configurada && estado.ok ? (
          <Texto v="chica" color="texto2">
            {tr(
              `Todavía no le has encargado nada. Pídeselo aquí abajo, o dile a ${nombreAvatar}: «usa tu computadora y…».`,
              `You haven’t given it anything yet. Ask below, or tell ${nombreAvatar}: “use your computer and…”.`
            )}
          </Texto>
        ) : null}

        {!!error && (
          <Texto v="chica" color="aviso">
            {error}
          </Texto>
        )}

        {puede && !sigue ? (
          <View style={{ gap: MEDIDA.espacio.m }}>
            <Campo
              etiqueta={tr('¿Qué quieres que haga?', 'What should it do?')}
              value={pedido}
              onChangeText={setPedido}
              placeholder={tr('Entra a… y dime…', 'Go to… and tell me…')}
              multiline
              maxLength={600}
            />
            <View style={{ gap: 6 }}>
              {EJEMPLOS_PC.map((e) => (
                <Pressable key={e.es} onPress={() => setPedido(e[idioma])} accessibilityRole="button" style={[s.ejemplo, { borderColor: tema.borde }]}>
                  <Texto v="mini" color="texto2">
                    {e[idioma]}
                  </Texto>
                </Pressable>
              ))}
            </View>
            <Boton titulo={tr('Encargar', 'Give it the task')} cargando={enviando} deshabilitado={pedido.trim().length < 4} onPress={() => void encargar(pedido)} />
            <Texto v="mini" color="texto3">
              {tr(
                'Tarda uno o dos minutos. Te muestra su plan, te pide permiso antes de enviar, iniciar sesión, publicar o borrar, y nunca paga ni compra.',
                'It takes a minute or two. It shows you its plan, asks before sending, signing in, posting or deleting, and never pays or buys.'
              )}
            </Texto>
          </View>
        ) : !puede && estado ? (
          <Texto v="chica" color="texto2">
            {estado.configurada
              ? tr('La computadora no contesta. Puede estar apagada para ahorrar; avísale a quien administra AU-RA.', 'The computer isn’t answering. It may be off to save money; tell whoever runs AU-RA.')
              : tr('La computadora todavía no está conectada en el servidor.', 'The computer isn’t connected on the server yet.')}
          </Texto>
        ) : null}

        {/* Sus misiones recientes: tocar una abre su tarjeta. */}
        {historial.length ? (
          <View style={{ gap: 4 }}>
            <Texto v="chicaFuerte">{tr('Misiones recientes', 'Recent missions')}</Texto>
            {historial.map((h) => (
              <Pressable key={h.id} onPress={() => void abrirDelHistorial(h.id)} accessibilityRole="button" style={[s.historia, { borderColor: tema.borde }]}>
                <Texto v="chicaFuerte" style={[s.marca, { color: h.ok ? tema.exito : h.respondida ? tema.acento : h.ok === false ? tema.aviso : tema.acento }]}>
                  {h.ok ? '✓' : h.respondida ? '?' : h.ok === false ? '✕' : '●'}
                </Texto>
                <View style={{ flex: 1 }}>
                  <Texto v="chica" numberOfLines={1}>
                    {h.instruccion}
                  </Texto>
                  <Texto v="mini" color="texto3" numberOfLines={1}>
                    {haceCuanto(h.inicio, Date.now(), idioma)} · {relojMision(h.segundos)}
                    {h.resultado ? ` · ${h.resultado}` : ''}
                  </Texto>
                </View>
              </Pressable>
            ))}
          </View>
        ) : null}
      </View>
    </Hoja>
  );
}

/** La tarjeta del resultado: cómo terminó, lo que encontró, los datos, los enlaces, la captura final, compartir y seguir. */
function TarjetaFinal({
  mision,
  onCompartir,
  onSeguir,
  ocupado,
  ancho,
  arriba,
  sinCaptura,
}: {
  mision: MisionPc;
  onCompartir: (instruccion: string, f: FinalPc) => void;
  onSeguir: (m: MisionPc) => void;
  ocupado: string | null;
  ancho: number;
  arriba?: React.ReactNode;
  /** La captura ya se ve arriba (la misión de ahora). */
  sinCaptura?: boolean;
}) {
  const tema = useTema();
  const idioma = idiomaActual() === 'en' ? 'en' : 'es';
  const f = mision.final;
  return (
    <View style={[s.tarjeta, { borderColor: f?.ok ? tema.exito : tema.borde, backgroundColor: tema.superficie }]}>
      {arriba}
      <View style={s.fila}>
        <Texto v="mini" color="texto3" style={{ flex: 1 }}>
          {tr('RESULTADO', 'RESULT')}
          {f ? ` · ${finalEnPalabras(f, idioma)} · ${relojMision(f.segundos)} · ${tr(`${f.pasos} pasos`, `${f.pasos} steps`)}` : ''}
        </Texto>
      </View>
      {sinCaptura ? null : <Texto v="cuerpo">«{mision.instruccion}»</Texto>}
      {f ? (
        <>
          {f.respuesta ? (
            <Texto v="cuerpo" selectable>
              {f.respuesta}
            </Texto>
          ) : (
            <Texto v="chica" color="aviso">
              {f.texto}
            </Texto>
          )}
          {f.entregables?.length ? (
            // Cada cosa pedida con su marca: lo comprobado con su archivo, lo que falta o no es lo pedido, lo sin comprobar.
            <View style={{ gap: 2 }} accessibilityLabel={tr('Lo que pediste, uno por uno', 'What you asked for, one by one')}>
              {entregablesEnPalabras(f.entregables).map((linea, i) => (
                <Texto key={f.entregables![i].id} v="chica" color={f.entregables![i].estado === 'verified' ? 'texto2' : 'aviso'} selectable>
                  {linea}
                </Texto>
              ))}
            </View>
          ) : null}
          {f.sinComprobar ? (
            <Texto v="chica" color="aviso">
              {f.sinComprobar}
            </Texto>
          ) : null}
          {f.datos.length >= 2 ? (
            <View style={[s.datos, { borderColor: tema.borde }]}>
              {f.datos.map((d, i) => (
                <View key={`${i}-${d.clave}`} style={s.dato}>
                  <Texto v="mini" color="texto3" style={{ flex: 1 }}>
                    {d.clave}
                  </Texto>
                  <Texto v="chicaFuerte" selectable style={{ flex: 1, textAlign: 'right' }}>
                    {d.valor}
                  </Texto>
                </View>
              ))}
            </View>
          ) : null}
          {f.enlaces.length ? (
            <View style={{ gap: 2 }}>
              {f.enlaces.map((u) => (
                <Pressable key={u} onPress={() => void Linking.openURL(u).catch(() => undefined)} accessibilityRole="link">
                  <Texto v="mini" color="acento" numberOfLines={1}>
                    ↗ {u.replace(/^https?:\/\//, '')}
                  </Texto>
                </Pressable>
              ))}
            </View>
          ) : null}
          {!sinCaptura && f.captura ? (
            <View style={[s.pantalla, { width: ancho, height: Math.round(ancho * 0.625), borderColor: tema.borde, backgroundColor: tema.fondo2 }]}>
              <Image source={{ uri: `data:image/jpeg;base64,${f.captura}` }} style={StyleSheet.absoluteFill} resizeMode="contain" accessibilityLabel={tr('La pantalla al terminar', 'The screen at the end')} />
            </View>
          ) : null}
          <View style={s.filaBotones}>
            <Boton titulo={tr('Compartir', 'Share')} tam="chico" variante="secundario" onPress={() => onCompartir(mision.instruccion, f)} style={{ flex: 1 }} />
            {mision.puedeSeguir ? <Boton titulo={tr('Seguir', 'Keep going')} tam="chico" cargando={ocupado === 'seguir'} onPress={() => onSeguir(mision)} style={{ flex: 1 }} /> : null}
          </View>
        </>
      ) : (
        <Texto v="chica" color="texto2">
          {tr('Todavía no termina.', 'It hasn’t finished yet.')}
        </Texto>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  fila: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  filaBotones: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  punto: { width: 10, height: 10, borderRadius: 5 },
  tarjeta: { borderWidth: 1, borderRadius: MEDIDA.radio.l, padding: MEDIDA.espacio.m, gap: MEDIDA.espacio.s },
  pantalla: { alignSelf: 'center', borderWidth: 1, borderRadius: 10, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  etiquetaPaso: { position: 'absolute', left: 8, top: 8, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  paso: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6, paddingHorizontal: 6, borderRadius: 8 },
  pasoN: { width: 18, textAlign: 'right' },
  marca: { width: 20, textAlign: 'center' },
  ejemplo: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 7 },
  frase: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 8 },
  pregunta: { borderWidth: 1, borderRadius: 12, padding: 12, gap: 8 },
  datos: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 4 },
  dato: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 },
  historia: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 8 },
});
