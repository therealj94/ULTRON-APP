/**
 * SU COMPUTADORA: ver lo que hace la computadora en la nube del avatar y encargarle algo
 * (server/computadora.ts; la lógica en compa/computadora.ts).
 *
 *   · Arriba, cómo está: lista, trabajando, apagada o sin conectar.
 *   · El encargo de ahora (o el último): lo que está viendo (la captura del último paso, se renueva
 *     sola cada 2,5 s mientras trabaja), cada paso en palabras («Abrió es.wikipedia.org», «Escribió
 *     “Morazán” y dio Enter»), el resultado y el botón «Parar». Tocar un paso muestra lo que veía ahí.
 *   · Abajo, «¿Qué quieres que haga?» con ejemplos: se le encarga sin pasar por la conversación.
 *
 * Solo se miran capturas: nadie puede tomar el control del escritorio desde aquí (por seguridad la
 * vista en vivo con control no se publica). Cada persona ve solo sus encargos.
 *
 * Desde el 2-oct (José: «abrió la página y se quedó ahí») la hoja es UNA para toda la app
 * (app/ComputadoraEnVivo.tsx la dibuja encima de cualquier pantalla): se abre sola cuando una tarea
 * empieza, sigue la tarea que le dicen (`tareaId`, también la que sigue la misión) y muestra arriba lo
 * último que AURA contó («Ya entré a bch.hn.»). `HojaComputadora` (la de la mesa y Ajustes) solo la abre.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { api } from '../lib/api';
import { tr, idiomaActual } from '../i18n';
import { MEDIDA, useTema } from '../nucleo/tema';
import { Boton, Campo, Hoja, Texto, vibrar } from '../ui';
import { EJEMPLOS_PC, estadoEnPalabras, sondeoMs, tareaEnPalabras, trabajando, type EstadoPc, type TareaPc } from '../compa/computadora';
import { abrirHoja, hayAnfitrion } from '../app/hojas';

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

export function HojaComputadoraVivo({
  visible,
  onCerrar,
  nombreAvatar,
  tareaId = null,
  frase = '',
  alEstado,
}: PropsHoja & {
  /** Lo que ve de la tarea (para que el tecleo se apague si terminó y el aviso se perdió). */
  alEstado?: (id: string, trabajandoAhora: boolean) => void;
  /** La tarea que hay que mostrar (la que acaba de empezar o la que sigue la misión). */
  tareaId?: string | null;
  /** Lo último que AURA contó de lo que hace. */
  frase?: string;
}) {
  const tema = useTema();
  const { width } = useWindowDimensions();
  const idioma = idiomaActual() === 'en' ? 'en' : 'es';
  const [estado, setEstado] = useState<EstadoPc | null>(null);
  const [tarea, setTarea] = useState<TareaPc | null>(null);
  const [verPaso, setVerPaso] = useState<number | null>(null);
  const [capturaPaso, setCapturaPaso] = useState<string | null>(null);
  const [pedido, setPedido] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState('');
  const idRef = useRef<string | null>(null);
  const tareaRef = useRef(tarea);
  tareaRef.current = tarea;
  const alEstadoRef = useRef(alEstado);
  alEstadoRef.current = alEstado;

  const leerTarea = useCallback(
    async (id: string) => {
      try {
        const r = await api<{ tarea: TareaPc }>(`/api/computadora/tareas/${encodeURIComponent(id)}?idioma=${idioma}`, { method: 'GET' }, 12_000);
        if (idRef.current === id) setTarea(r.tarea);
        alEstadoRef.current?.(id, trabajando(r.tarea.estado));
      } catch {
        /* la próxima vuelta lo intenta otra vez */
      }
    },
    [idioma]
  );

  const leerEstado = useCallback(async () => {
    try {
      const s = await api<EstadoPc>('/api/computadora', { method: 'GET' }, 12_000);
      setEstado(s);
      const id = s.actual?.id || s.ultima;
      if (id && id !== idRef.current) {
        idRef.current = id;
        void leerTarea(id);
      }
      return s;
    } catch (e: any) {
      setEstado((x) => x ?? { configurada: true, ok: false, motores: [], ocupada: false, ultima: null, actual: null, detalle: String(e?.message || '') });
      return null;
    }
  }, [leerTarea]);

  // Abierta: estado y encargo; mientras trabaja se renueva rápido (se ve avanzar), si no, despacio.
  useEffect(() => {
    if (!visible) return;
    let vivo = true;
    let reloj: ReturnType<typeof setTimeout>;
    const vuelta = async () => {
      if (!vivo) return;
      const s = await leerEstado();
      if (idRef.current && trabajando(s?.actual?.estado ?? tareaRef.current?.estado)) await leerTarea(idRef.current);
      if (vivo) reloj = setTimeout(vuelta, sondeoMs(s?.actual?.estado ?? tareaRef.current?.estado, true));
    };
    void vuelta();
    return () => {
      vivo = false;
      clearTimeout(reloj);
    };
  }, [visible, leerEstado, leerTarea]);

  // Le dicen qué tarea seguir (empezó una, o la misión siguió con otra): se muestra ya, sin esperar al sondeo.
  useEffect(() => {
    if (!visible || !tareaId || tareaId === idRef.current) return;
    idRef.current = tareaId;
    setVerPaso(null);
    setTarea((t) => (t?.id === tareaId ? t : { id: tareaId, instruccion: t?.instruccion || '', estado: 'en_cola', pasos: [], respuesta: null, error: null, segundos: 0 }));
    void leerTarea(tareaId);
  }, [visible, tareaId, leerTarea]);

  useEffect(() => {
    if (!visible) {
      setVerPaso(null);
      setCapturaPaso(null);
      setError('');
    }
  }, [visible]);

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
    try {
      const r = await api<{ id: string }>('/api/computadora/tareas', { method: 'POST', body: JSON.stringify({ instruccion: t, idioma }) }, 20_000);
      vibrar('exito');
      idRef.current = r.id;
      setVerPaso(null);
      setTarea({ id: r.id, instruccion: t, estado: 'en_cola', pasos: [], respuesta: null, error: null, segundos: 0 });
      setPedido('');
      void leerEstado();
    } catch (e: any) {
      vibrar('aviso');
      setError(e?.message || tr('No pude encargárselo.', 'I couldn’t give it the task.'));
    } finally {
      setEnviando(false);
    }
  };

  const parar = async () => {
    if (!tarea) return;
    try {
      await api(`/api/computadora/tareas/${encodeURIComponent(tarea.id)}/parar`, { method: 'POST', body: '{}' }, 10_000);
      vibrar('medio');
      void leerTarea(tarea.id);
    } catch (e: any) {
      setError(e?.message || '');
    }
  };

  const linea = estadoEnPalabras(estado, idioma);
  const colorLinea = linea.tono === 'bien' ? tema.exito : linea.tono === 'trabaja' ? tema.acento : linea.tono === 'mal' ? tema.aviso : tema.texto3;
  const sigue = trabajando(tarea?.estado);
  // Lo que se ve grande: el paso que tocó, o lo último que vio.
  const ultimaCaptura = tarea ? [...tarea.pasos].reverse().find((p) => p.miniatura)?.miniatura || null : null;
  const captura = verPaso != null ? capturaPaso : ultimaCaptura;
  const anchoImg = Math.min(width - 2 * MEDIDA.espacio.xl - 4, 520);
  const puede = !!estado?.configurada && !!estado?.ok;

  return (
    <Hoja
      visible={visible}
      onCerrar={onCerrar}
      titulo={tr('Su computadora', 'Their computer')}
      subtitulo={tr(
        `${nombreAvatar} tiene su propia computadora en la nube (con Firefox) para hacer cosas en páginas por ti. Aquí ves lo que hace, paso a paso.`,
        `${nombreAvatar} has a cloud computer (with Firefox) to do things on websites for you. Here you see what it does, step by step.`
      )}
    >
      <View style={{ gap: MEDIDA.espacio.l }}>
        <View style={s.fila}>
          <View style={[s.punto, { backgroundColor: colorLinea }]} />
          <Texto v="chicaFuerte" style={{ flex: 1 }}>
            {linea.texto}
          </Texto>
        </View>
        {sigue && frase ? (
          <View style={[s.frase, { backgroundColor: tema.acentoFondo }]}>
            <ActivityIndicator size="small" color={tema.acento} />
            <Texto v="chica" style={{ flex: 1 }}>
              {nombreAvatar}: «{frase}»
            </Texto>
          </View>
        ) : null}

        {tarea ? (
          <View style={[s.tarjeta, { borderColor: tema.borde, backgroundColor: tema.superficie }]}>
            <Texto v="mini" color="texto3">
              {sigue ? tr('ENCARGO EN CURSO', 'TASK IN PROGRESS') : tr('ÚLTIMO ENCARGO', 'LAST TASK')}
            </Texto>
            {tarea.instruccion ? <Texto v="cuerpo">«{tarea.instruccion}»</Texto> : null}
            <View style={s.fila}>
              {sigue ? <ActivityIndicator size="small" color={tema.acento} /> : null}
              <Texto v="chica" color={tarea.estado === 'fallo' || tarea.estado === 'sin_pasos' ? 'aviso' : 'texto2'} style={{ flex: 1 }}>
                {tareaEnPalabras(tarea, idioma)}
              </Texto>
            </View>
            <View style={[s.pantalla, { width: anchoImg, height: Math.round(anchoImg * 0.625), borderColor: tema.borde, backgroundColor: tema.fondo2 }]}>
              {captura ? (
                <Image source={{ uri: `data:image/jpeg;base64,${captura}` }} style={StyleSheet.absoluteFill} resizeMode="contain" accessibilityLabel={tr('Lo que ve su computadora', 'What its computer sees')} />
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
                    ● {tr('en vivo', 'live')}
                  </Texto>
                </View>
              ) : null}
            </View>
            {tarea.respuesta ? (
              <View style={{ gap: 4 }}>
                <Texto v="chicaFuerte">{tr('Lo que encontró', 'What it found')}</Texto>
                <Texto v="cuerpo" selectable>
                  {tarea.respuesta}
                </Texto>
              </View>
            ) : null}
            {tarea.pasos.filter((p) => p.texto).length ? (
              <View style={{ gap: 2 }}>
                <Texto v="chicaFuerte">{tr('Lo que hizo', 'What it did')}</Texto>
                {tarea.pasos
                  .filter((p) => p.texto)
                  .map((p) => (
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
              </View>
            ) : null}
            {sigue ? <Boton titulo={tr('Parar', 'Stop')} variante="secundario" tam="chico" onPress={() => void parar()} /> : null}
          </View>
        ) : estado?.configurada && estado.ok ? (
          <Texto v="chica" color="texto2">
            {tr(
              `Todavía no le has encargado nada. Pídeselo aquí abajo, o dile a ${nombreAvatar}: «usa tu computadora y…».`,
              `You haven’t given it anything yet. Ask below, or tell ${nombreAvatar}: “use your computer and…”.`
            )}
          </Texto>
        ) : null}

        {puede ? (
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
            {!!error && (
              <Texto v="chica" color="aviso">
                {error}
              </Texto>
            )}
            <Boton
              titulo={sigue ? tr('Está ocupada: espera o párala', 'It’s busy: wait or stop it') : tr('Encargar', 'Give it the task')}
              cargando={enviando}
              deshabilitado={sigue || pedido.trim().length < 4}
              onPress={() => void encargar(pedido)}
            />
            <Texto v="mini" color="texto3">
              {tr(
                'Tarda uno o dos minutos. Nunca paga, compra ni pone contraseñas. Solo ves capturas: nadie puede tomar el control desde aquí.',
                'It takes a minute or two. It never pays, buys or enters passwords. You only see screenshots: nobody can take control from here.'
              )}
            </Texto>
          </View>
        ) : estado ? (
          <Texto v="chica" color="texto2">
            {estado.configurada
              ? tr('La computadora no contesta. Puede estar apagada para ahorrar; avísale a quien administra AU-RA.', 'The computer isn’t answering. It may be off to save money; tell whoever runs AU-RA.')
              : tr('La computadora todavía no está conectada en el servidor.', 'The computer isn’t connected on the server yet.')}
          </Texto>
        ) : null}
      </View>
    </Hoja>
  );
}

const s = StyleSheet.create({
  fila: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  punto: { width: 10, height: 10, borderRadius: 5 },
  tarjeta: { borderWidth: 1, borderRadius: MEDIDA.radio.l, padding: MEDIDA.espacio.m, gap: MEDIDA.espacio.s },
  pantalla: { alignSelf: 'center', borderWidth: 1, borderRadius: 10, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  etiquetaPaso: { position: 'absolute', left: 8, top: 8, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  paso: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6, paddingHorizontal: 6, borderRadius: 8 },
  pasoN: { width: 18, textAlign: 'right' },
  ejemplo: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 7 },
  frase: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 8 },
});
