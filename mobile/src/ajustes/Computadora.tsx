/**
 * SU COMPUTADORA: ver lo que hace la computadora en la nube del avatar y encargarle algo
 * (server/computadora.ts; la lógica en compa/computadora.ts).
 *
 * José (2-oct, tarde): «tiene que funcionar ya todo… copiemos cómo lo hacen Grok, el agente de ChatGPT».
 * José (7-oct): «no me ha convencido», ni cómo funciona ni cómo se ve. La auditoría (capturas en
 * scripts/qa/computadora-movil) encontró: «● en vivo» encima de la captura del último paso aunque no llegaran noticias,
 * la ruedita de «En fila» al mismo tiempo que «no me llega lo que hace», el resultado debajo del plan (a más de una
 * pantalla), la pregunta de su sí y los mandos fuera de la vista, y la imagen más ancha que su tarjeta.
 *
 * La hoja, ahora, es UNA TARJETA de la tarea, de arriba abajo:
 *   · cómo va ESTA tarea (Trabajando, En fila, Espera tu sí, En pausa, Tienes el control, Sin noticias, o cómo terminó)
 *     y el TIEMPO transcurrido;
 *   · la misión (lo que pidió) y «Ahora: …», el paso de ahora en palabras;
 *   · si pide su sí antes de algo sensible (enviar, iniciar sesión, publicar, borrar): la pregunta con «Sí, hazlo» /
 *     «No», ARRIBA de todo lo demás. Pagar o comprar: nunca;
 *   · la PANTALLA: la de ahora (GET …/pantalla cada 2 s; «EN VIVO» solo si es fresca y llegan noticias) o, si el servicio
 *     no la da, la del último paso dicha así («Paso 4»). Tocarla la abre en grande (el visor completo si la tarea vive y
 *     su servicio lo sabe; si no, la imagen a pantalla completa). Con el control en sus manos, tocarla hace clic ahí;
 *   · Pausar/Seguir y Tomar el control/Devolver (si su servicio lo sabe y llegan noticias); Detener SIEMPRE, fijo abajo;
 *   · el PLAN que se va marcando y lo que hizo paso a paso (tocar uno muestra lo que veía ahí);
 *   · al terminar, el RESULTADO primero: cómo terminó, lo que encontró, los datos, los enlaces y la EVIDENCIA (la pantalla
 *     al terminar, que se abre en grande), «Compartir», «Seguir» si quedó a medias y «Pedir otra vez» si falló;
 *   · sin noticias de la computadora no hay ruedita ni «en vivo»: «Sin noticias», desde cuándo y que no se sabe si sigue.
 *
 * La hoja es UNA para toda la app (app/ComputadoraEnVivo.tsx la dibuja encima de cualquier pantalla): se
 * abre sola cuando una tarea empieza o pide tu sí, y sigue la tarea que le dicen (`tareaId`).
 * `HojaComputadora` (la de la mesa y Ajustes) solo la abre. Cada persona ve solo sus encargos.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Image, Linking, Modal, Pressable, Share, StyleSheet, View, useWindowDimensions, type GestureResponderEvent } from 'react-native';
import { api } from '../lib/api';
import { tr, idiomaActual } from '../i18n';
import { MEDIDA, useTema } from '../nucleo/tema';
import { Boton, Campo, Hoja, Texto, vibrar } from '../ui';
import {
  EJEMPLOS_PC,
  FALLOS_SIN_NOTICIAS,
  VIVA_CADA_MS,
  aCoordenadas,
  avisoSinNoticias,
  chipPc,
  controlesPc,
  estadoEnPalabras,
  entregablesEnPalabras,
  finalEnPalabras,
  fotoPc,
  haceCuanto,
  marcaPlan,
  nuevoPedidoPc,
  pasoAhoraPc,
  puedeVerPantallaPc,
  relojMision,
  respuestaPc,
  sondeoMs,
  textoApagadaPc,
  VistaPc,
  textoParaCompartir,
  trabajando,
  enMarcha,
  type EstadoPc,
  type EstadoTareaPc,
  type FinalPc,
  type FotoPc,
  type MisionPc,
  type TareaPc,
} from '../compa/computadora';
import { abrirHoja, hayAnfitrion } from '../app/hojas';
import { abrirVisor, marcaVisor } from '../app/visor';

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

/** La pantalla de ahora que llegó (de qué tarea, cuándo llegó y qué edad traía del nodo). */
type Viva = { tarea: string; imagen: string; llegada: number; edadMs: number | null };

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
  /** Cuándo llegó la última lectura buena de la tarea (para decir desde cuándo no hay noticias). */
  const [ultimaNoticia, setUltimaNoticia] = useState(0);
  const [viva, setViva] = useState<Viva | null>(null);
  const [textoControl, setTextoControl] = useState('');
  const [todosLosPasos, setTodosLosPasos] = useState(false);
  /** Una imagen abierta en grande (la miniatura tocada, o la evidencia del resultado). */
  const [grande, setGrande] = useState<FotoPc | null>(null);
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
  const abiertaEn = useRef(Date.now());

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
        setUltimaNoticia(Date.now());
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
    abiertaEn.current = Date.now();
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
      setViva(null);
      setGrande(null);
    }
  }, [visible]);

  const sigue = trabajando(tarea?.estado);
  const conControl = tarea?.estado === 'control';
  const sinNoticias = sigue && sinRespuesta >= FALLOS_SIN_NOTICIAS;

  // El reloj de la misión (y la frescura de la pantalla), cada segundo mientras está viva.
  useEffect(() => {
    if (!visible || !sigue) return;
    const r = setInterval(() => setAhora(Date.now()), 1000);
    return () => clearInterval(r);
  }, [visible, sigue]);

  // La pantalla de ahora mientras la tarea vive y su servicio la da (el que sabe dar el control): cada 2 s con AURA al
  // mando, cada 1,5 s y más nítida con el control en sus manos. Nunca dos pedidos a la vez; sin noticias, no se pide (iría
  // al mismo nodo que no contesta); en entrada segura el nodo no la da (423) y no se insiste en mostrarla.
  const daPantalla = !!estado?.capacidades?.includes('control');
  const pideViva = visible && !!tarea && sigue && tarea.estado !== 'en_cola' && daPantalla && !sinNoticias && !tarea.seguro;
  useEffect(() => {
    if (!pideViva || !tarea) return;
    let vivo = true;
    let reloj: ReturnType<typeof setTimeout>;
    const id = tarea.id;
    const cada = conControl ? 1500 : VIVA_CADA_MS;
    const ancho = conControl ? 960 : 640;
    const vuelta = async () => {
      try {
        const r = await api<{ imagen: string; frame?: { edadMs?: number } | null }>(`/api/computadora/tareas/${encodeURIComponent(id)}/pantalla?ancho=${ancho}`, { method: 'GET' }, 10_000);
        if (vivo && r?.imagen) setViva({ tarea: id, imagen: r.imagen, llegada: Date.now(), edadMs: typeof r.frame?.edadMs === 'number' ? r.frame.edadMs : null });
      } catch {
        /* la próxima: la etiqueta dirá cuántos segundos tiene la imagen que hay */
      }
      if (vivo) reloj = setTimeout(vuelta, cada);
    };
    void vuelta();
    return () => {
      vivo = false;
      clearTimeout(reloj);
    };
  }, [pideViva, tarea?.id, conControl]); // eslint-disable-line react-hooks/exhaustive-deps

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
      setViva(null);
      setTarea({ id: r.id, instruccion: t, estado: 'en_cola', pasos: [], respuesta: null, error: null, segundos: 0 });
      setMision(r.mision);
      setRecibida(Date.now());
      setPedido('');
      void leerEstado();
    } catch (e: any) {
      vibrar('aviso');
      setError(e?.message || tr('No pude encargárselo. Prueba en un momento.', 'I couldn’t give it the task. Try again in a moment.'));
      // No contesta (apagada o caída): la hoja lo dice ya, sin esperar al próximo sondeo, y quita el campo de encargar.
      if (e?.data?.code === 'apagada') void leerEstado();
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
      setViva(null);
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

  /** «Pedir otra vez»: la misma instrucción en el campo, para revisarla y encargarla (no se lanza sola). */
  const pedirOtraVez = (instruccion: string) => {
    setDelHistorial(null);
    setPedido(instruccion);
    vibrar('suave');
  };

  // Las medidas: la pantalla cabe DENTRO de la tarjeta (antes se salía de su borde: no restaba el relleno de la tarjeta).
  const anchoImg = Math.min(width - 2 * MEDIDA.espacio.xl - 2 * MEDIDA.espacio.m - 2, 520);
  const altoImg = Math.round(anchoImg * 0.625);
  const puede = !!estado?.configurada && !!estado?.ok;
  const misionDeAhora = mision;
  const plan = misionDeAhora?.plan?.length ? misionDeAhora.plan : planInicial.map((texto, i) => ({ texto, estado: i === 0 && sigue ? ('actual' as const) : ('pendiente' as const) }));
  const transcurrido = misionDeAhora ? misionDeAhora.transcurrido + (sigue && recibida ? Math.max(0, Math.round((ahora - recibida) / 1000)) : 0) : tarea?.segundos || 0;
  const pregunta = tarea?.estado === 'confirmar' ? misionDeAhora?.pregunta || tarea.pregunta || preguntaAviso : null;
  const c = controlesPc(estado?.capacidades, tarea?.estado, sinNoticias);
  const finalAhora = !sigue ? misionDeAhora?.final ?? null : null;
  const pasosConTexto = tarea ? tarea.pasos.filter((p) => p.texto) : [];
  const pasosVisibles = todosLosPasos ? pasosConTexto : pasosConTexto.slice(-4);
  const historial = (estado?.historial ?? []).filter((h) => h.id !== misionDeAhora?.id).slice(0, 6);
  const chip = chipPc(tarea?.estado, finalAhora, sinNoticias, idioma);
  const colorTono = (t: string) => (t === 'bien' ? tema.exito : t === 'trabaja' ? tema.acento : t === 'mal' ? tema.aviso : t === 'espera' ? tema.acento : tema.texto3);
  const foto = tarea
    ? fotoPc(
        {
          estado: tarea.estado,
          viva: viva && viva.tarea === tarea.id ? viva : null,
          pasos: tarea.pasos,
          verPaso: verPaso != null ? { n: verPaso, imagen: capturaPaso } : null,
          finalCaptura: misionDeAhora?.final?.captura ?? null,
          sinNoticias,
          ahora,
        },
        idioma
      )
    : null;
  const verVisor = !!tarea && puedeVerPantallaPc(estado?.capacidades, tarea.estado) && !sinNoticias;
  // El reloj solo si hay de dónde contarlo (la misión, o la tarea con sus segundos): nunca un «0:00» inventado.
  const hayReloj = !!tarea && (!!misionDeAhora || (tarea.segundos ?? 0) > 0);
  const linea = estadoEnPalabras(estado, idioma);
  // La misión en sus palabras: la de la misión, la de la tarea o, si la primera lectura no llegó, la del estado general.
  const instruccion = misionDeAhora?.instruccion || tarea?.instruccion || (tarea && estado?.actual?.id === tarea.id ? estado.actual.instruccion : '');

  const abrirVisorCompleto = () => {
    if (!tarea) return;
    const id = tarea.id;
    // De esta cuenta: si en la espera cambió, el visor de la anterior no se abre.
    const marca = marcaVisor();
    onCerrar();
    // La hoja termina de irse antes de abrir el visor (iOS no presenta un Modal mientras otro se va).
    setTimeout(() => abrirVisor(id, marca), 320);
  };

  const tocarPantalla = (ev: GestureResponderEvent) => {
    if (conControl) {
      const { locationX, locationY } = ev.nativeEvent;
      void accion({ tipo: 'click', ...aCoordenadas(locationX, locationY, anchoImg, altoImg) });
      return;
    }
    // Sin el control: verla en grande. La tarea viva va al visor completo (con zoom y el control); lo demás, la imagen.
    if (verVisor && verPaso == null) return abrirVisorCompleto();
    if (foto) setGrande(foto);
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
      // La explicación larga solo sin tarea: con una en curso, cada renglón es para la tarea.
      subtitulo={
        tarea || delHistorial
          ? undefined
          : tr(
              `${nombreAvatar} tiene su propia computadora en la nube (con Firefox) para hacer cosas en páginas por ti. Aquí ves lo que hace, en vivo y paso a paso.`,
              `${nombreAvatar} has a cloud computer (with Firefox) to do things on websites for you. Here you see what it does, live and step by step.`
            )
      }
    >
      <View style={{ gap: MEDIDA.espacio.l }}>
        {/* Cómo está la computadora: solo sin tarea a la vista o si no contesta (con tarea, manda la etiqueta de la tarea). */}
        {!tarea || !puede ? (
          <View style={s.fila}>
            <View style={[s.punto, { backgroundColor: colorTono(linea.tono) }]} />
            <Texto v="chicaFuerte" style={{ flex: 1 }}>
              {linea.texto}
            </Texto>
          </View>
        ) : null}

        {delHistorial ? (
          <TarjetaFinal
            mision={delHistorial}
            onCompartir={compartir}
            onSeguir={seguirMision}
            onOtraVez={puede ? pedirOtraVez : undefined}
            onVerGrande={setGrande}
            ocupado={ocupado}
            ancho={anchoImg}
            arriba={
              <Pressable onPress={() => setDelHistorial(null)} accessibilityRole="button" hitSlop={10}>
                <Texto v="chica" color="acento">
                  ‹ {tr('Volver a lo de ahora', 'Back to now')}
                </Texto>
              </Pressable>
            }
          />
        ) : tarea ? (
          <View style={[s.tarjeta, { borderColor: chip.tono === 'espera' && pregunta ? tema.acento : tema.borde, backgroundColor: tema.superficie }]}>
            {/* 1 · Cómo va y cuánto lleva. */}
            <View style={s.fila}>
              <View style={[s.chip, { borderColor: colorTono(chip.tono) }]} accessibilityLabel={`${tr('Estado', 'Status')}: ${chip.texto}`}>
                <View style={[s.punto, { backgroundColor: colorTono(chip.tono) }]} />
                <Texto v="chicaFuerte" style={{ color: colorTono(chip.tono) }}>
                  {chip.texto}
                </Texto>
              </View>
              <View style={{ flex: 1 }} />
              {hayReloj ? (
                <Texto v="chicaFuerte" color="texto2" accessibilityLabel={tr('Tiempo transcurrido', 'Elapsed time')}>
                  ⏱ {relojMision(finalAhora ? finalAhora.segundos : transcurrido)}
                </Texto>
              ) : null}
            </View>

            {/* 2 · La misión, en sus palabras. */}
            {instruccion ? (
              <Texto v="cuerpoFuerte" numberOfLines={3}>
                {instruccion}
              </Texto>
            ) : null}
            {misionDeAhora?.vuelta ? (
              <Texto v="mini" color="texto3">
                {tr(`Parte ${misionDeAhora.vuelta + 1}: sigue desde donde quedó`, `Part ${misionDeAhora.vuelta + 1}: going on from where it left off`)}
              </Texto>
            ) : null}

            {/* 3 · Lo de ahora (vivo) o el resultado (terminada). */}
            {sigue && !(pregunta && c.contestar) ? (
              <View style={s.fila}>
                {tarea.estado === 'trabajando' && !sinNoticias ? <ActivityIndicator size="small" color={tema.acento} /> : null}
                <Texto v="chica" color={sinNoticias ? 'aviso' : 'texto2'} style={{ flex: 1 }}>
                  {tarea.estado === 'trabajando' && !sinNoticias ? tr('Ahora: ', 'Now: ') : ''}
                  {pasoAhoraPc(tarea, sinNoticias, idioma)}
                </Texto>
              </View>
            ) : null}

            {/* 4 · Su sí antes de algo sensible: arriba de todo, con botones grandes. Pagar o comprar, nunca. */}
            {pregunta && c.contestar ? (
              <View style={[s.pregunta, { borderColor: tema.acento, backgroundColor: tema.acentoFondo }]} accessibilityLiveRegion="polite">
                <Texto v="chicaFuerte" color="acento">
                  {tr('ANTES DE SEGUIR NECESITO TU SÍ', 'I NEED YOUR OK BEFORE GOING ON')}
                </Texto>
                <Texto v="cuerpo" selectable>
                  {pregunta}
                </Texto>
                <View style={s.filaBotones}>
                  <Boton titulo={tr('Sí, hazlo', 'Yes, do it')} cargando={ocupado === 'si'} onPress={() => void sobreTarea('si', 'confirmar', respuestaPc(true, misionDeAhora, tarea))} style={{ flex: 1 }} />
                  <Boton titulo={tr('No', 'No')} variante="secundario" cargando={ocupado === 'no'} onPress={() => void sobreTarea('no', 'confirmar', respuestaPc(false, misionDeAhora, tarea))} style={{ flex: 1 }} />
                </View>
                <Texto v="mini" color="texto3">
                  {tr('Mientras no contestes, no toca nada. También puedes decírmelo en voz. Pagar o comprar no lo hago nunca.', 'Until you answer, it touches nothing. You can also say it out loud. I never pay or buy.')}
                </Texto>
              </View>
            ) : null}

            {sinNoticias ? (
              <View style={[s.aviso, { backgroundColor: tema.avisoFondo }]} accessibilityLiveRegion="polite">
                <Texto v="chica" color="aviso">
                  {avisoSinNoticias(ahora - (ultimaNoticia || abiertaEn.current), idioma)}
                </Texto>
              </View>
            ) : null}

            {/* 5 · La pantalla. Viva: la de ahora o la del último paso, dicha como es. Terminada: la evidencia va en el resultado. */}
            {sigue || !finalAhora ? (
              <View style={{ gap: 6 }}>
                <Pressable
                  onPress={tocarPantalla}
                  disabled={!foto && !conControl}
                  accessibilityRole="button"
                  accessibilityLabel={
                    conControl ? tr('Toca para hacer clic ahí', 'Tap to click there') : tr('Lo que ve su computadora. Toca para verla en grande', 'What its computer sees. Tap to see it full screen')
                  }
                  style={[s.pantalla, { width: anchoImg, height: altoImg, borderColor: conControl ? tema.acento : tema.borde, backgroundColor: tema.fondo2 }]}
                >
                  {foto ? (
                    <Image source={{ uri: `data:image/jpeg;base64,${foto.imagen}` }} style={StyleSheet.absoluteFill} resizeMode="contain" />
                  ) : (
                    <View style={{ alignItems: 'center', gap: 8, paddingHorizontal: 16 }}>
                      {enMarcha(tarea.estado) && !sinNoticias ? <ActivityIndicator color={tema.acento} /> : null}
                      <Texto v="chica" color="texto3" centro>
                        {sinNoticias
                          ? tr('Todavía no llegó ninguna imagen.', 'No image has arrived yet.')
                          : tarea.estado === 'en_cola'
                            ? tr('Preparando su escritorio…', 'Getting its desktop ready…')
                            : tarea.seguro
                              ? tr('Entrada segura: AURA no ve la pantalla.', 'Secure input: AURA can’t see the screen.')
                              : sigue
                                ? tr('Esperando la primera imagen…', 'Waiting for the first image…')
                                : tr('Sin captura', 'No screenshot')}
                      </Texto>
                    </View>
                  )}
                  {foto ? (
                    verPaso != null ? (
                      <Pressable onPress={() => setVerPaso(null)} style={[s.etiqueta, { backgroundColor: tema.acento }]} accessibilityRole="button" hitSlop={8}>
                        <Texto v="mini" style={{ color: tema.sobreAcento }}>
                          {foto.etiqueta} · {tr('volver a lo de ahora', 'back to now')}
                        </Texto>
                      </Pressable>
                    ) : (
                      <View style={[s.etiqueta, { backgroundColor: foto.enVivo ? '#B3261E' : 'rgba(0,0,0,0.66)' }]}>
                        <Texto v="mini" style={{ color: '#fff' }}>
                          {foto.enVivo ? '● ' : ''}
                          {tarea.estado === 'pausada' && !foto.enVivo ? `Ⅱ ${tr('en pausa', 'paused')} · ` : ''}
                          {foto.etiqueta}
                        </Texto>
                      </View>
                    )
                  ) : null}
                  {foto && !conControl ? (
                    <View style={[s.ampliar, { backgroundColor: 'rgba(0,0,0,0.66)' }]} pointerEvents="none">
                      <Texto v="mini" style={{ color: '#fff' }}>
                        ⤢ {tr('Ver en grande', 'Full screen')}
                      </Texto>
                    </View>
                  ) : null}
                </Pressable>
                {conControl && verVisor ? <Boton titulo={tr('Pantalla completa', 'Full screen')} variante="secundario" onPress={abrirVisorCompleto} /> : null}
              </View>
            ) : null}

            {sigue && frase && !pregunta && !sinNoticias ? (
              <Texto v="chica" color="texto2">
                {nombreAvatar}: «{frase}»
              </Texto>
            ) : null}

            {/* 6 · Los mandos: Pausar/Seguir y el control si su servicio los sabe (Detener va fijo abajo). */}
            {sigue && (c.pausar || c.seguir || c.tomar || c.devolver) ? (
              <View style={s.filaBotones}>
                {c.pausar ? <Boton titulo={tr('Pausar', 'Pause')} variante="secundario" cargando={ocupado === 'pausar'} onPress={() => void sobreTarea('pausar', 'pausar')} style={{ flex: 1 }} /> : null}
                {c.seguir ? <Boton titulo={tr('Seguir', 'Resume')} cargando={ocupado === 'seguir-t'} onPress={() => void sobreTarea('seguir-t', 'reanudar')} style={{ flex: 1 }} /> : null}
                {c.tomar ? <Boton titulo={tr('Tomar el control', 'Take over')} variante="secundario" cargando={ocupado === 'tomar'} onPress={() => void sobreTarea('tomar', 'control', { tomar: true })} style={{ flex: 1 }} /> : null}
                {c.devolver ? <Boton titulo={tr('Devolver', 'Give back')} cargando={ocupado === 'devolver'} onPress={() => void sobreTarea('devolver', 'control', { tomar: false })} style={{ flex: 1 }} /> : null}
              </View>
            ) : null}
            {c.faltaActualizar ? (
              <Texto v="mini" color="texto3">
                {tr('Pausar y tomar el control llegan cuando se actualice el servicio de su computadora. Por ahora puedes detenerla.', 'Pause and take over arrive once its computer service is updated. For now you can stop it.')}
              </Texto>
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
                  <Boton titulo="↑" tam="chico" variante="secundario" etiqueta={tr('Subir', 'Scroll up')} onPress={() => void accion({ tipo: 'scroll', direccion: 'up' })} />
                  <Boton titulo="↓" tam="chico" variante="secundario" etiqueta={tr('Bajar', 'Scroll down')} onPress={() => void accion({ tipo: 'scroll', direccion: 'down' })} />
                </View>
                <Texto v="mini" color="texto3">
                  {tr('Lo que escribes no se guarda en los pasos. Cuando termines, devuélvela y sigue desde ahí.', 'What you type isn’t kept in the steps. When you’re done, give it back and it goes on from there.')}
                </Texto>
              </View>
            ) : null}

            {/* 7 · Terminada: el RESULTADO primero, con su evidencia. */}
            {finalAhora && misionDeAhora ? (
              <TarjetaFinal mision={misionDeAhora} onCompartir={compartir} onSeguir={seguirMision} onOtraVez={puede ? pedirOtraVez : undefined} onVerGrande={setGrande} ocupado={ocupado} ancho={anchoImg} dentro />
            ) : null}
            {!finalAhora && !sigue ? (
              <View style={{ gap: 4 }}>
                <Texto v="chica" color={tarea.estado === 'fallo' || tarea.estado === 'sin_pasos' ? 'aviso' : 'texto2'}>
                  {pasoAhoraPc(tarea, false, idioma)}
                </Texto>
                {tarea.respuesta ? (
                  <Texto v="cuerpo" selectable>
                    {tarea.respuesta}
                  </Texto>
                ) : null}
              </View>
            ) : null}

            {/* 8 · El plan que se va marcando. */}
            {plan.length ? (
              <View style={{ gap: 2 }}>
                <Texto v="chicaFuerte" color="texto2">
                  {tr('El plan', 'The plan')}
                </Texto>
                {plan.map((p, i) => (
                  <View key={`${i}-${p.texto}`} style={s.paso} accessibilityLabel={`${p.texto}: ${p.estado}`}>
                    {p.estado === 'actual' && !sinNoticias && tarea.estado === 'trabajando' ? (
                      <ActivityIndicator size="small" color={tema.acento} style={s.marca} />
                    ) : (
                      <Texto v="chicaFuerte" style={[s.marca, { color: p.estado === 'hecho' ? tema.exito : p.estado === 'fallo' ? tema.aviso : p.estado === 'pendiente' ? tema.texto3 : tema.acento }]}>
                        {marcaPlan(p.estado)}
                      </Texto>
                    )}
                    <Texto v="chica" color={p.estado === 'pendiente' ? 'texto3' : p.estado === 'hecho' ? 'texto2' : 'texto'} style={{ flex: 1 }}>
                      {p.texto}
                    </Texto>
                  </View>
                ))}
              </View>
            ) : null}

            {/* 9 · Lo que hizo, paso a paso (tocar uno muestra lo que veía ahí). */}
            {pasosConTexto.length ? (
              <View style={{ gap: 2 }}>
                <Texto v="chicaFuerte" color="texto2">
                  {tr('Lo que hizo', 'What it did')}
                </Texto>
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
                  <Pressable onPress={() => setTodosLosPasos((x) => !x)} accessibilityRole="button" hitSlop={10}>
                    <Texto v="chica" color="acento">
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

        {/* No contesta: dicho claro, sin campo para encargar (no se finge que se puede). */}
        {!puede && estado && !sigue ? (
          <View style={[s.aviso, { backgroundColor: tema.avisoFondo }]}>
            <Texto v="chica" color="aviso">
              {textoApagadaPc(estado.configurada, idioma)}
            </Texto>
          </View>
        ) : null}

        {puede && !sigue ? (
          <View style={{ gap: MEDIDA.espacio.m }}>
            <Campo
              etiqueta={tarea ? tr('¿Algo más?', 'Anything else?') : tr('¿Qué quieres que haga?', 'What should it do?')}
              value={pedido}
              onChangeText={setPedido}
              placeholder={tr('Entra a… y dime…', 'Go to… and tell me…')}
              multiline
              maxLength={600}
            />
            {!tarea ? (
              <View style={{ gap: 6 }}>
                {EJEMPLOS_PC.map((e) => (
                  <Pressable key={e.es} onPress={() => setPedido(e[idioma])} accessibilityRole="button" style={[s.ejemplo, { borderColor: tema.borde }]}>
                    <Texto v="chica" color="texto2">
                      {e[idioma]}
                    </Texto>
                  </Pressable>
                ))}
              </View>
            ) : null}
            <Boton titulo={tr('Encargar', 'Give it the task')} cargando={enviando} deshabilitado={pedido.trim().length < 4} onPress={() => void encargar(pedido)} />
            <Texto v="mini" color="texto3">
              {tr(
                'Tarda uno o dos minutos. La ves en vivo, te pide permiso antes de enviar, iniciar sesión, publicar o borrar, puedes pausarla o tomar el control, y nunca paga ni compra.',
                'It takes a minute or two. You watch it live, it asks before sending, signing in, posting or deleting, you can pause it or take over, and it never pays or buys.'
              )}
            </Texto>
          </View>
        ) : null}

        {/* Sus misiones recientes: tocar una abre su tarjeta. */}
        {historial.length ? (
          <View style={{ gap: 4 }}>
            <Texto v="chicaFuerte" color="texto2">
              {tr('Misiones recientes', 'Recent missions')}
            </Texto>
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
      <VerEnGrande foto={grande} onCerrar={() => setGrande(null)} />
    </Hoja>
  );
}

/** Una imagen de su pantalla a pantalla completa (la miniatura o la evidencia del resultado), con su etiqueta. */
function VerEnGrande({ foto, onCerrar }: { foto: FotoPc | null; onCerrar: () => void }) {
  return (
    <Modal visible={!!foto} transparent animationType="fade" onRequestClose={onCerrar} statusBarTranslucent>
      <Pressable onPress={onCerrar} style={s.grande} accessibilityRole="button" accessibilityLabel={tr('Cerrar la imagen', 'Close the image')}>
        {foto ? <Image source={{ uri: `data:image/jpeg;base64,${foto.imagen}` }} style={s.grandeImg} resizeMode="contain" accessibilityLabel={foto.etiqueta} /> : null}
        <View style={s.grandePie}>
          <Texto v="chica" style={{ color: '#fff', flex: 1 }}>
            {foto?.etiqueta}
          </Texto>
          <Texto v="chicaFuerte" style={{ color: '#fff' }}>
            {tr('Cerrar ✕', 'Close ✕')}
          </Texto>
        </View>
      </Pressable>
    </Modal>
  );
}

/**
 * La tarjeta del resultado: cómo terminó, lo que encontró, los datos, los enlaces, la EVIDENCIA (la pantalla al terminar,
 * que se abre en grande), compartir, seguir (a medias) y pedir otra vez (falló o quedó a medias).
 */
function TarjetaFinal({
  mision,
  onCompartir,
  onSeguir,
  onOtraVez,
  onVerGrande,
  ocupado,
  ancho,
  arriba,
  dentro,
}: {
  mision: MisionPc;
  onCompartir: (instruccion: string, f: FinalPc) => void;
  onSeguir: (m: MisionPc) => void;
  /** Sin él (la computadora no contesta), no se ofrece pedirla otra vez. */
  onOtraVez?: (instruccion: string) => void;
  onVerGrande: (f: FotoPc) => void;
  ocupado: string | null;
  ancho: number;
  arriba?: React.ReactNode;
  /** Va dentro de la tarjeta de la tarea (la misión ya se lee arriba). */
  dentro?: boolean;
}) {
  const tema = useTema();
  const idioma = idiomaActual() === 'en' ? 'en' : 'es';
  const f = mision.final;
  const ok = !!f?.ok;
  const marco = dentro ? null : [s.tarjeta, { borderColor: ok ? tema.exito : tema.borde, backgroundColor: tema.superficie }];
  return (
    <View style={[{ gap: MEDIDA.espacio.s }, marco]}>
      {arriba}
      {!dentro ? (
        <>
          <Texto v="mini" color="texto3">
            {tr('RESULTADO', 'RESULT')}
            {f ? ` · ${finalEnPalabras(f, idioma)} · ${relojMision(f.segundos)} · ${tr(`${f.pasos} pasos`, `${f.pasos} steps`)}` : ''}
          </Texto>
          <Texto v="cuerpoFuerte" numberOfLines={3}>
            {mision.instruccion}
          </Texto>
        </>
      ) : f ? (
        <Texto v="mini" color="texto3">
          {tr(`${f.pasos} pasos`, `${f.pasos} steps`)}
        </Texto>
      ) : null}
      {f ? (
        <>
          {f.respuesta ? (
            <View style={[s.respuesta, { backgroundColor: ok ? tema.exitoFondo : tema.fondo2 }]}>
              <Texto v="cuerpo" selectable>
                {f.respuesta}
              </Texto>
            </View>
          ) : (
            <View style={[s.respuesta, { backgroundColor: tema.avisoFondo }]}>
              <Texto v="cuerpo" color="aviso">
                {f.texto}
              </Texto>
            </View>
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
                  <Texto v="chica" color="texto3" style={{ flex: 1 }}>
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
            <View style={{ gap: 4 }}>
              {f.enlaces.map((u) => (
                <Pressable key={u} onPress={() => void Linking.openURL(u).catch(() => undefined)} accessibilityRole="link" hitSlop={8}>
                  <Texto v="chica" color="acento" numberOfLines={1}>
                    ↗ {u.replace(/^https?:\/\//, '')}
                  </Texto>
                </Pressable>
              ))}
            </View>
          ) : null}
          {f.captura ? (
            <View style={{ gap: 4 }}>
              <Texto v="mini" color="texto3">
                {ok ? tr('EVIDENCIA · LA PANTALLA AL TERMINAR', 'EVIDENCE · THE SCREEN AT THE END') : tr('LA ÚLTIMA PANTALLA QUE VIO', 'THE LAST SCREEN IT SAW')}
              </Texto>
              <Pressable
                onPress={() => onVerGrande({ imagen: f.captura!, fuente: 'final', etiqueta: tr('La pantalla al terminar', 'The screen at the end'), enVivo: false })}
                accessibilityRole="button"
                accessibilityLabel={tr('La pantalla al terminar. Toca para verla en grande', 'The screen at the end. Tap to see it full screen')}
                style={[s.pantalla, { width: ancho, height: Math.round(ancho * 0.625), borderColor: tema.borde, backgroundColor: tema.fondo2 }]}
              >
                <Image source={{ uri: `data:image/jpeg;base64,${f.captura}` }} style={StyleSheet.absoluteFill} resizeMode="contain" />
                <View style={[s.ampliar, { backgroundColor: 'rgba(0,0,0,0.66)' }]} pointerEvents="none">
                  <Texto v="mini" style={{ color: '#fff' }}>
                    ⤢ {tr('Ver en grande', 'Full screen')}
                  </Texto>
                </View>
              </Pressable>
            </View>
          ) : null}
          <View style={s.filaBotones}>
            <Boton titulo={tr('Compartir', 'Share')} variante="secundario" onPress={() => onCompartir(mision.instruccion, f)} style={{ flex: 1 }} />
            {mision.puedeSeguir ? <Boton titulo={tr('Seguir', 'Keep going')} cargando={ocupado === 'seguir'} onPress={() => onSeguir(mision)} style={{ flex: 1 }} /> : null}
            {!ok && onOtraVez && !mision.puedeSeguir ? <Boton titulo={tr('Pedir otra vez', 'Ask again')} variante="secundario" onPress={() => onOtraVez(mision.instruccion)} style={{ flex: 1 }} /> : null}
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
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  tarjeta: { borderWidth: 1, borderRadius: MEDIDA.radio.l, padding: MEDIDA.espacio.m, gap: MEDIDA.espacio.m },
  pantalla: { alignSelf: 'center', borderWidth: 1, borderRadius: 10, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  etiqueta: { position: 'absolute', left: 8, top: 8, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  ampliar: { position: 'absolute', right: 8, bottom: 8, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  paso: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6, paddingHorizontal: 6, borderRadius: 8 },
  pasoN: { width: 18, textAlign: 'right' },
  marca: { width: 20, textAlign: 'center' },
  ejemplo: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10 },
  pregunta: { borderWidth: 1.5, borderRadius: 12, padding: 12, gap: 10 },
  aviso: { borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10 },
  respuesta: { borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10 },
  datos: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 4 },
  dato: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 },
  historia: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 8 },
  grande: { flex: 1, backgroundColor: 'rgba(0,0,0,0.94)', justifyContent: 'center' },
  grandeImg: { width: '100%', aspectRatio: 1.6 },
  grandePie: { position: 'absolute', left: 16, right: 16, bottom: 32, flexDirection: 'row', alignItems: 'center', gap: 12 },
});
