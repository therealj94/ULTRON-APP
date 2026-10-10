/**
 * LA HOJA DEL OBJETIVO (Fase 2): todo lo que es de él, de un vistazo —meta, siguiente paso, los criterios de cierre (✓ o
 * pendiente), los documentos vigentes con su versión, las decisiones (las que esperan, con sus botones; las tomadas, con
 * lo que se eligió) y lo que pasó (eventos)— y sus controles: pausar, reanudar, cancelar y cerrar (con la evidencia de
 * cada criterio: un documento vigente).
 *
 * Abrirla anota en ESTE teléfono que vio esa revisión (el «qué cambió» de la tarjeta empieza de ahí). Toda acción va con
 * la revisión que se ve; si el objetivo cambió mientras tanto (409), se muestra el de ahora y se dice. El estado y los
 * avisos van en regiones vivas. Mismos estilos que el panel de tareas (trabajos/PanelTrabajos.tsx).
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AccessibilityInfo, Alert, StyleSheet, View } from 'react-native';
import { tr, useIdioma } from '../i18n';
import { MEDIDA, useTema } from '../nucleo/tema';
import { Boton, Chip, Hoja, Texto } from '../ui';
import {
  anuncioCambioEstado,
  controlesObjetivo,
  criteriosVista,
  decisionesSinElegir,
  documentosVigentes,
  etiquetaEstadoObjetivo,
  evidenciasParaCerrar,
  type ResultadoObjetivo,
  type VistaObjetivo,
} from '../lib/objetivos';
import { haceCuanto } from '../lib/trabajos';
import { cerrarObjetivo, controlObjetivo, marcarVisto, useObjetivo } from './useObjetivos';
import { OpcionesDecisionObjetivo } from './DecisionObjetivo';

type Props = { id: string | null; onCerrar: () => void };

export function HojaObjetivo({ id, onCerrar }: Props) {
  const tema = useTema();
  const idioma = useIdioma() === 'en' ? 'en' : 'es';
  const { objetivo: o, noEsta } = useObjetivo(id);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [cerrando, setCerrando] = useState(false);
  const [elegidos, setElegidos] = useState<Record<string, string>>({});

  // Lo que se ve, visto en este teléfono (la revisión de ahora).
  const revision = o?.revision ?? 0;
  useEffect(() => {
    if (id && o) marcarVisto(o);
  }, [id, revision]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setAviso(null);
    setCerrando(false);
    setElegidos({});
  }, [id]);

  const antes = useRef<VistaObjetivo | null>(null);
  useEffect(() => {
    const m = anuncioCambioEstado(antes.current, o, idioma);
    if (m) AccessibilityInfo.announceForAccessibility(m);
    antes.current = o;
  }, [o, idioma]);

  const criterios = useMemo(() => (o ? criteriosVista(o, idioma) : []), [o, idioma]);
  const docs = useMemo(() => (o ? documentosVigentes(o) : []), [o]);
  const pendientes = o ? decisionesSinElegir(o) : [];
  const tomadas = o ? o.decisiones.filter((d) => d.elegida) : [];
  const ctl = o ? controlesObjetivo(o) : { pausar: false, reanudar: false, cancelar: false, cerrar: false };
  const evidencias = o ? evidenciasParaCerrar(o, elegidos) : null;

  const tras = (r: ResultadoObjetivo) => {
    const m = r.ok ? null : r.conflicto ? tr('Cambió mientras tanto: te muestro la versión nueva. No apliqué nada.', 'It changed in the meantime: here is the new version. Nothing was applied.') : r.mensaje;
    setAviso(m);
    if (m) AccessibilityInfo.announceForAccessibility(m);
  };
  const control = async (c: 'pausar' | 'reanudar' | 'cancelar') => {
    if (!o) return;
    setOcupado(c);
    try {
      tras(await controlObjetivo(o, c));
    } finally {
      setOcupado(null);
    }
  };
  const cancelar = () =>
    Alert.alert(tr('¿Cancelar este objetivo?', 'Cancel this goal?'), tr('No hago nada más con él y descarto los borradores que esperaban tu «sí». Lo que ya se hizo queda anotado.', 'I will do nothing more with it and discard the drafts waiting for your «yes». What was already done stays on record.'), [
      { text: tr('No', 'No'), style: 'cancel' },
      { text: tr('Cancelar el objetivo', 'Cancel the goal'), style: 'destructive', onPress: () => void control('cancelar') },
    ]);
  const cerrar = async () => {
    if (!o || !evidencias) return;
    setOcupado('cerrar');
    try {
      const r = await cerrarObjetivo(o, evidencias);
      tras(r);
      if (r.ok) setCerrando(false);
    } finally {
      setOcupado(null);
    }
  };

  const visible = !!id;
  if (!o) {
    return (
      <Hoja visible={visible} onCerrar={onCerrar} titulo={tr('Objetivo', 'Goal')}>
        <Texto color={noEsta ? 'aviso' : 'texto2'} style={s.vacio} accessibilityLiveRegion="polite">
          {noEsta ? tr('No pude abrir ese objetivo ahora (o ya no está). Prueba en un momento.', 'I could not open that goal right now (or it is gone). Try again in a moment.') : tr('Buscando el objetivo…', 'Looking for the goal…')}
        </Texto>
      </Hoja>
    );
  }
  return (
    <Hoja visible={visible} onCerrar={onCerrar} titulo={o.titulo} subtitulo={tr('Cerrar esto no cancela nada.', 'Closing this cancels nothing.')}>
      <View style={s.fila} accessibilityLiveRegion="polite">
        <Texto v="chicaFuerte" color={o.estado === 'esperando-decision' ? 'acentoTexto' : o.estado === 'fallido' || o.estado === 'incierto' ? 'aviso' : o.estado === 'completado' ? 'exito' : 'texto2'}>
          {etiquetaEstadoObjetivo(o, idioma)}
        </Texto>
        <Texto v="mini" color="texto3">
          {tr(`revisión ${o.revision} · ${haceCuanto(new Date(o.actualizado).toISOString(), Date.now(), idioma)}`, `revision ${o.revision} · ${haceCuanto(new Date(o.actualizado).toISOString(), Date.now(), idioma)}`)}
        </Texto>
      </View>
      {aviso ? (
        <Texto v="chica" color="aviso" accessibilityRole="alert" accessibilityLiveRegion="assertive">
          {aviso}
        </Texto>
      ) : null}

      <Seccion titulo={tr('Meta', 'Goal')}>
        <Texto v="chica" selectable>
          {o.meta}
        </Texto>
        {o.siguientePaso ? (
          <Texto v="chica">
            <Texto v="chicaFuerte">{tr('Siguiente: ', 'Next: ')}</Texto>
            {o.siguientePaso}
          </Texto>
        ) : null}
      </Seccion>

      {pendientes.length ? (
        <Seccion titulo={tr('Necesita tu decisión', 'Needs your decision')}>
          {pendientes.map((d) => (
            <OpcionesDecisionObjetivo key={d.id} objetivo={o} decision={d} onResultado={tras} />
          ))}
        </Seccion>
      ) : null}

      <Seccion titulo={tr('Cómo sabremos que está terminado', 'How we will know it is done')}>
        {criterios.map((c) => (
          <View key={c.id} style={s.criterio} accessible accessibilityLabel={c.etiqueta}>
            <Texto v="chica" color={c.cumplido ? 'exito' : 'texto3'} style={s.marca}>
              {c.marca}
            </Texto>
            <Texto v="chica" style={{ flex: 1 }}>
              {c.texto}
            </Texto>
          </View>
        ))}
        {cerrando
          ? o.criterioCierre
              .filter((c) => !c.evidencias.length)
              .map((c) => (
                <View key={c.id} style={s.elegir}>
                  <Texto v="mini" color="texto2">
                    {tr(`Evidencia de «${c.texto}»:`, `Evidence for «${c.texto}»:`)}
                  </Texto>
                  <View style={s.chips}>
                    {docs.map((d) => (
                      <Chip key={d.id} texto={`${d.nombre} · v${d.version}`} activo={elegidos[c.id] === d.id} onPress={() => setElegidos((e) => ({ ...e, [c.id]: d.id }))} tam="chico" />
                    ))}
                  </View>
                </View>
              ))
          : null}
      </Seccion>

      <Seccion titulo={tr('Documentos vigentes', 'Current documents')}>
        {docs.length ? (
          docs.map((d) => (
            <Texto key={d.id} v="chica" selectable accessibilityLabel={tr(`${d.nombre}, versión ${d.version}`, `${d.nombre}, version ${d.version}`)}>
              · {d.nombre} <Texto v="mini" color="texto3">{`v${d.version}`}</Texto>
            </Texto>
          ))
        ) : (
          <Texto v="chica" color="texto3">
            {tr('Todavía ninguno.', 'None yet.')}
          </Texto>
        )}
      </Seccion>

      {tomadas.length ? (
        <Seccion titulo={tr('Decisiones tomadas', 'Decisions made')}>
          {tomadas.slice(-6).map((d) => (
            <Texto key={d.id} v="chica">
              {d.pregunta} <Texto v="chicaFuerte">→ {d.opciones.find((x) => x.id === d.elegida)?.etiqueta || d.elegida}</Texto>
              {d.por === 'aura' ? tr(' (AURA, con tu permiso)', ' (AURA, with your permission)') : ''}
            </Texto>
          ))}
        </Seccion>
      ) : null}

      <Seccion titulo={tr('Lo que pasó', 'What happened')}>
        {[...o.eventos]
          .reverse()
          .slice(0, 10)
          .map((e) => (
            <Texto key={e.revision} v="chica" color="texto2">
              {`${haceCuanto(new Date(e.t).toISOString(), Date.now(), idioma)} · ${e.texto}`}
            </Texto>
          ))}
      </Seccion>

      {!o.terminal ? (
        <View style={[s.controles, { borderTopColor: tema.borde }]}>
          {ctl.pausar ? <Boton titulo={tr('Pausar', 'Pause')} variante="contorno" tam="chico" cargando={ocupado === 'pausar'} deshabilitado={!!ocupado} onPress={() => void control('pausar')} /> : null}
          {ctl.reanudar ? <Boton titulo={tr('Reanudar', 'Resume')} variante="contorno" tam="chico" cargando={ocupado === 'reanudar'} deshabilitado={!!ocupado} onPress={() => void control('reanudar')} /> : null}
          {ctl.cerrar && !cerrando ? <Boton titulo={tr('Cerrar con evidencia', 'Close with evidence')} variante="contorno" tam="chico" deshabilitado={!!ocupado} onPress={() => setCerrando(true)} /> : null}
          {cerrando ? (
            <Boton
              titulo={tr('Confirmar cierre', 'Confirm closing')}
              variante="contorno"
              tam="chico"
              cargando={ocupado === 'cerrar'}
              deshabilitado={!!ocupado || !evidencias}
              etiqueta={evidencias ? tr('Confirmar el cierre con la evidencia elegida', 'Confirm closing with the chosen evidence') : tr('Elige un documento para cada criterio pendiente', 'Choose a document for each pending criterion')}
              onPress={() => void cerrar()}
            />
          ) : null}
          {cerrando ? <Boton titulo={tr('No cerrar', 'Do not close')} variante="fantasma" tam="chico" deshabilitado={!!ocupado} onPress={() => setCerrando(false)} /> : null}
          {ctl.cancelar ? <Boton titulo={tr('Cancelar objetivo', 'Cancel goal')} variante="peligro" tam="chico" deshabilitado={!!ocupado} onPress={cancelar} /> : null}
        </View>
      ) : null}
    </Hoja>
  );
}

function Seccion({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <View style={s.seccion}>
      <Texto v="etiqueta" color="texto3" accessibilityRole="header">
        {titulo}
      </Texto>
      {children}
    </View>
  );
}

const s = StyleSheet.create({
  vacio: { paddingVertical: MEDIDA.espacio.l },
  fila: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: MEDIDA.espacio.s, marginBottom: MEDIDA.espacio.s },
  seccion: { gap: 6, marginBottom: MEDIDA.espacio.l },
  criterio: { flexDirection: 'row', gap: MEDIDA.espacio.s, alignItems: 'flex-start' },
  marca: { minWidth: 64 },
  elegir: { gap: 4, marginTop: 4 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  controles: { flexDirection: 'row', flexWrap: 'wrap', gap: MEDIDA.espacio.s, paddingTop: MEDIDA.espacio.m, borderTopWidth: StyleSheet.hairlineWidth },
});
