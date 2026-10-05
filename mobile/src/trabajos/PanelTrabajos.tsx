/**
 * EL PANEL DE TAREAS (AUR08, sección 6): lo que AURA hace por ti fuera del turno, en tres grupos —
 * pendientes de decisión, activas y recientes— con su objetivo, dónde se hace, el paso actual, el progreso
 * real («3 de 5 pasos», nunca un porcentaje), la última señal, los controles y el resultado.
 *
 * Cerrar el panel NO cancela nada (lo dice arriba). Cada control llama al servidor y pinta lo que el
 * servidor contesta (el backend es la fuente de verdad); un error es recuperable y dice que no se ejecutó.
 *
 * La tarjeta de decisión (TarjetaDecision) muestra exactamente qué se propone, desde qué cuenta, a quién,
 * con qué datos, el alcance, la caducidad y el efecto de cada botón. La opción con efecto va al final, sin
 * estilo de principal, sin preselección, y no se arma hasta ARMADO_MS después de aparecer la tarjeta.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Linking, StyleSheet, View } from 'react-native';
import { tr } from '../i18n';
import { MEDIDA, useTema } from '../nucleo/tema';
import { Boton, Hoja, Texto } from '../ui';
import {
  ARMADO_MS,
  criteriosEnPalabras,
  etiquetaBoton,
  etiquetaEstado,
  gira,
  grupos,
  haceCuanto,
  opcionesTarjeta,
  puedeActivar,
  textoProgreso,
  type ResultadoAccion,
  type TareaVista,
} from '../lib/trabajos';
import { clienteTrabajos } from './useTrabajos';

type Props = {
  visible: boolean;
  onCerrar: () => void;
  tareas: TareaVista[];
  /** La última lista vino parcial (revisión 9): lo que dijo el servidor. Las que no vinieron siguen «sin confirmar». */
  aviso?: string | null;
  reducido: boolean;
  idioma: 'es' | 'en';
  /** Lo que contestó el servidor: el panel lo pinta (y el indicador se recalcula). */
  onTarea: (t: TareaVista | null | undefined) => void;
  onRefrescar: () => void;
  /** «Editar»: lo que se propone escribir en el chat («Cambia el correo para Ana: »). */
  onEditar: (sugerencia: string) => void;
  onAbrirComputadora: () => void;
};

export function PanelTrabajos({ visible, onCerrar, tareas, aviso, reducido, idioma, onTarea, onRefrescar, onEditar, onAbrirComputadora }: Props) {
  const g = useMemo(() => grupos(tareas), [tareas]);
  const vacio = !g.decisiones.length && !g.activas.length && !g.recientes.length;
  const variasDecisiones = g.decisiones.length > 1;
  const comun = { reducido, idioma, onTarea, onRefrescar, onEditar, onAbrirComputadora, variasDecisiones };
  return (
    <Hoja visible={visible} onCerrar={onCerrar} titulo={tr('Tareas', 'Tasks')} subtitulo={tr('Cerrar esto no cancela nada: siguen en marcha.', 'Closing this cancels nothing: they keep going.')}>
      {aviso ? (
        <Texto v="chica" color="aviso" accessibilityRole="alert" style={s.vacio}>
          {aviso}
        </Texto>
      ) : null}
      {vacio && !aviso ? (
        <Texto color="texto2" style={s.vacio}>
          {tr('No hay tareas en marcha. Cuando me pidas algo que tarde o necesite tu decisión, aparece aquí.', 'No tasks running. When you ask for something that takes time or needs your decision, it shows up here.')}
        </Texto>
      ) : null}
      {g.decisiones.length ? <Seccion titulo={tr('Necesitan tu decisión', 'Need your decision')} tareas={g.decisiones} {...comun} /> : null}
      {g.activas.length ? <Seccion titulo={tr('En marcha', 'In progress')} tareas={g.activas} {...comun} /> : null}
      {g.recientes.length ? <Seccion titulo={tr('Recientes', 'Recent')} tareas={g.recientes} {...comun} /> : null}
    </Hoja>
  );
}

type Comun = Pick<Props, 'reducido' | 'idioma' | 'onTarea' | 'onRefrescar' | 'onEditar' | 'onAbrirComputadora'> & { variasDecisiones: boolean };

function Seccion({ titulo, tareas, ...c }: Comun & { titulo: string; tareas: TareaVista[] }) {
  return (
    <View style={s.seccion}>
      <Texto v="etiqueta" color="texto3">
        {titulo}
      </Texto>
      {tareas.map((t) => (
        <TarjetaTarea key={t.id} t={t} {...c} />
      ))}
    </View>
  );
}

function TarjetaTarea({ t, reducido, idioma, onTarea, onRefrescar, onEditar, onAbrirComputadora, variasDecisiones }: Comun & { t: TareaVista }) {
  const tema = useTema();
  const [ocupado, setOcupado] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const prog = textoProgreso(t.progress, idioma);
  const senal = haceCuanto(t.lastHeartbeatAt || t.updatedAt, Date.now(), idioma);
  const tras = (r: ResultadoAccion) => {
    if (r.ok) {
      setAviso(null);
      onTarea(r.tarea);
      if (!r.tarea) onRefrescar();
    } else {
      setAviso(r.mensaje);
      if (r.tarea) onTarea(r.tarea);
      else onRefrescar();
    }
  };
  const control = async (f: () => Promise<ResultadoAccion>) => {
    setOcupado(true);
    try {
      tras(await f());
    } finally {
      setOcupado(false);
    }
  };
  const cancelar = () =>
    Alert.alert(tr('¿Cancelar esta tarea?', 'Cancel this task?'), tr('No hago nada más con ella. Lo que ya se hizo queda anotado.', 'I will do nothing more with it. What was already done stays on record.'), [
      { text: tr('No', 'No'), style: 'cancel' },
      { text: tr('Cancelar la tarea', 'Cancel the task'), style: 'destructive', onPress: () => void control(() => clienteTrabajos.cancelar(t.id)) },
    ]);
  return (
    <View style={[s.tarjeta, { backgroundColor: tema.superficie, borderColor: tema.borde }]}>
      <View style={s.fila}>
        <Texto v="cuerpoFuerte" style={{ flex: 1 }}>
          {t.title}
        </Texto>
        <View style={s.estado}>
          {gira(t.state) && !reducido ? <ActivityIndicator size="small" color={tema.texto3} /> : null}
          <Texto v="chicaFuerte" color={t.state === 'failed' || t.state === 'blocked' ? 'aviso' : t.state === 'completed' ? 'exito' : 'texto2'}>
            {etiquetaEstado(t.state, idioma)}
          </Texto>
        </View>
      </View>
      {t.objective && t.objective !== t.title ? (
        <Texto v="chica" color="texto2">
          {t.objective}
        </Texto>
      ) : null}
      <Texto v="chica" color="texto3">
        {[t.environment.displayName, prog, senal ? tr(`última señal ${senal}`, `last signal ${senal}`) : ''].filter(Boolean).join(' · ')}
      </Texto>
      {t.sinConfirmar ? (
        <Texto v="chica" color="aviso">
          {tr('Sin confirmar: no pude leerla ahora; es lo último que supe, no es que ya no exista.', 'Unconfirmed: I could not read it just now; this is the last I knew, it is not gone.')}
        </Texto>
      ) : null}
      {t.currentStep && !t.terminal ? <Texto v="chica">{t.currentStep}</Texto> : null}
      {t.decision && !t.terminal ? <TarjetaDecision t={t} idioma={idioma} variasTareas={variasDecisiones} onResultado={tras} onEditar={onEditar} /> : null}
      {t.result ? <TarjetaResultado t={t} /> : null}
      {aviso ? (
        <Texto v="chica" color="aviso" accessibilityLiveRegion="polite">
          {aviso}
        </Texto>
      ) : null}
      {!t.terminal ? (
        <View style={s.controles}>
          {t.controls.open === 'computadora' ? <Boton titulo={tr('Abrir la computadora', 'Open the computer')} variante="contorno" tam="chico" onPress={onAbrirComputadora} /> : null}
          {t.controls.pause ? <Boton titulo={tr('Pausar', 'Pause')} variante="contorno" tam="chico" cargando={ocupado} onPress={() => void control(() => clienteTrabajos.pausar(t.id))} /> : null}
          {t.controls.resume ? <Boton titulo={tr('Reanudar', 'Resume')} variante="contorno" tam="chico" cargando={ocupado} onPress={() => void control(() => clienteTrabajos.reanudar(t.id))} /> : null}
          {t.controls.cancel ? <Boton titulo={tr('Cancelar tarea', 'Cancel task')} variante="peligro" tam="chico" deshabilitado={ocupado} onPress={cancelar} /> : null}
        </View>
      ) : null}
    </View>
  );
}

/** Una fila «Destinatario: ana@…» de la propuesta. */
function Dato({ k, v }: { k: string; v?: string }) {
  if (!v) return null;
  return (
    <Texto v="chica">
      <Texto v="chicaFuerte">{k}: </Texto>
      {v}
    </Texto>
  );
}

function TarjetaDecision({ t, idioma, variasTareas, onResultado, onEditar }: { t: TareaVista; idioma: 'es' | 'en'; variasTareas: boolean; onResultado: (r: ResultadoAccion) => void; onEditar: (s: string) => void }) {
  const tema = useTema();
  const d = t.decision!;
  // Desde cuándo se ve ESTA decisión: la opción con efecto se arma ARMADO_MS después.
  const aparecio = useRef(Date.now());
  const idVisto = useRef(d.id);
  if (idVisto.current !== d.id) {
    idVisto.current = d.id;
    aparecio.current = Date.now();
  }
  const [armada, setArmada] = useState(false);
  const [ocupado, setOcupado] = useState<string | null>(null);
  useEffect(() => {
    setArmada(false);
    const r = setTimeout(() => setArmada(true), ARMADO_MS + 30);
    return () => clearTimeout(r);
  }, [d.id]);
  const ops = opcionesTarjeta(d);
  const caduca = d.expiresAt ? new Date(d.expiresAt) : null;
  const elegir = async (id: string, conEfecto: boolean) => {
    if (!puedeActivar({ conEfecto }, { aparecio: aparecio.current, ahora: Date.now(), via: 'toque' })) return;
    setOcupado(id);
    try {
      const r = await clienteTrabajos.decidir(t, id);
      onResultado(r);
      if (r.ok && id === 'editar' && r.sugerencia) onEditar(r.sugerencia);
    } finally {
      setOcupado(null);
    }
  };
  return (
    <View style={[s.decision, { borderColor: tema.acento, backgroundColor: tema.acentoFondo }]} accessibilityRole="summary">
      <Texto v="cuerpoFuerte" color="acentoTexto">
        {d.question}
      </Texto>
      <Texto v="chica" color="texto2">
        {d.why}
      </Texto>
      <Dato k={tr('Acción', 'Action')} v={d.proposal.action} />
      <Dato k={tr('Desde', 'From')} v={d.proposal.account} />
      <Dato k={tr('Para', 'To')} v={d.proposal.recipient} />
      {d.proposal.data.map((x, i) => (
        <Texto key={i} v="chica" selectable>
          {x}
        </Texto>
      ))}
      <Dato k={tr('Importe', 'Amount')} v={d.proposal.amount} />
      <Dato k={tr('Se repite', 'Repeats')} v={d.proposal.recurrence} />
      <Dato k={tr('Alcance', 'Scope')} v={d.proposal.scope} />
      {caduca ? <Dato k={d.expired ? tr('Caducó', 'Expired') : tr('Caduca', 'Expires')} v={caduca.toLocaleString(idioma === 'en' ? 'en-US' : 'es-HN', { hour: 'numeric', minute: '2-digit', day: 'numeric', month: 'short' })} /> : null}
      {d.postponed ? (
        <Texto v="chica" color="texto3">
          {tr('Pospuesta: sigue esperando, sin aprobar.', 'Postponed: still waiting, not approved.')}
        </Texto>
      ) : null}
      <View style={s.opciones}>
        {ops.map((o) => (
          <View key={o.id} style={s.opcion}>
            <Boton
              titulo={etiquetaBoton(o, t, variasTareas)}
              // Nunca el estilo principal para la opción con efecto; ninguna preseleccionada.
              variante={o.conEfecto ? 'contorno' : 'fantasma'}
              tam="chico"
              cargando={ocupado === o.id}
              deshabilitado={!!ocupado || (o.conEfecto && !armada)}
              etiqueta={`${etiquetaBoton(o, t, variasTareas)}. ${o.effect}`}
              onPress={() => void elegir(o.id, o.conEfecto)}
            />
            <Texto v="mini" color="texto3">
              {o.effect}
            </Texto>
          </View>
        ))}
      </View>
    </View>
  );
}

function TarjetaResultado({ t }: { t: TareaVista }) {
  const tema = useTema();
  const r = t.result!;
  const pedidos = criteriosEnPalabras(t.acceptance);
  return (
    <View style={[s.resultado, { borderColor: tema.borde, backgroundColor: tema.superficie2 }]}>
      <Texto v="chicaFuerte">{tr('Resultado', 'Result')}</Texto>
      <Texto v="chica" selectable>
        {r.summary}
      </Texto>
      {pedidos.length ? (
        <>
          <Texto v="chicaFuerte" color="texto2">
            {tr('Lo que pediste, uno por uno', 'What you asked for, one by one')}
          </Texto>
          {pedidos.map((c) => (
            <Texto key={c.id} v="chica" color={c.estado === 'verified' ? 'texto' : 'aviso'} selectable>
              {c.texto}
            </Texto>
          ))}
        </>
      ) : null}
      {r.evidence.length ? (
        <>
          <Texto v="chicaFuerte" color="texto2">
            {tr('Lo que lo acredita', 'Evidence')}
          </Texto>
          {r.evidence.map((e) =>
            e.ref && /^https:\/\//i.test(e.ref) ? (
              <Texto key={e.id} v="chica" color="acentoTexto" accessibilityRole="link" onPress={() => void Linking.openURL(e.ref!).catch(() => undefined)}>
                {e.etiqueta}
              </Texto>
            ) : (
              <Texto key={e.id} v="chica" selectable>
                · {e.etiqueta}
              </Texto>
            )
          )}
        </>
      ) : null}
      {r.partial.length ? (
        <>
          <Texto v="chicaFuerte" color="aviso">
            {tr('Quedó parcial', 'Left partial')}
          </Texto>
          {r.partial.map((p, i) => (
            <Texto key={i} v="chica">
              · {p}
            </Texto>
          ))}
        </>
      ) : null}
      {r.pending.length ? (
        <>
          <Texto v="chicaFuerte" color="texto2">
            {tr('Requiere tu decisión', 'Needs your decision')}
          </Texto>
          {r.pending.map((p, i) => (
            <Texto key={i} v="chica">
              · {p}
            </Texto>
          ))}
        </>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  vacio: { paddingVertical: MEDIDA.espacio.l },
  seccion: { gap: MEDIDA.espacio.s, marginBottom: MEDIDA.espacio.l },
  tarjeta: { borderWidth: 1, borderRadius: MEDIDA.radio.m, padding: MEDIDA.espacio.m, gap: 6 },
  fila: { flexDirection: 'row', alignItems: 'flex-start', gap: MEDIDA.espacio.s },
  estado: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  controles: { flexDirection: 'row', flexWrap: 'wrap', gap: MEDIDA.espacio.s, marginTop: 4 },
  decision: { borderWidth: 1, borderRadius: MEDIDA.radio.s, padding: MEDIDA.espacio.m, gap: 4, marginTop: 4 },
  opciones: { gap: MEDIDA.espacio.s, marginTop: MEDIDA.espacio.s },
  opcion: { gap: 2 },
  resultado: { borderWidth: 1, borderRadius: MEDIDA.radio.s, padding: MEDIDA.espacio.m, gap: 4, marginTop: 4 },
});
