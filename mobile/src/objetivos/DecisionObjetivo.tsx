/**
 * LAS OPCIONES DE UNA DECISIÓN DE UN OBJETIVO (Fase 2), para la tarjeta «Continuar trabajo» y la hoja del objetivo.
 *
 * Como la tarjeta de las tareas (trabajos/PanelTrabajos.tsx): ninguna opción preseleccionada ni con estilo de principal,
 * y ninguna se puede tocar hasta ARMADO_MS después de aparecer la pregunta; cuando se habilitan, se ANUNCIA (un lector de
 * pantalla no ve que un botón dejó de estar apagado). Cada opción dice su consecuencia. La elección va con la revisión que
 * se ve; si el objetivo cambió mientras tanto (409), se dice «Cambió mientras tanto» y se muestra la versión nueva.
 */
import { useEffect, useState } from 'react';
import { AccessibilityInfo, StyleSheet, View } from 'react-native';
import { tr } from '../i18n';
import { MEDIDA, useTema } from '../nucleo/tema';
import { Boton, Texto } from '../ui';
import { ARMADO_MS, type DecisionObjetivo, type ResultadoObjetivo, type VistaObjetivo } from '../lib/objetivos';
import { decidirObjetivo } from './useObjetivos';

type Props = {
  objetivo: Pick<VistaObjetivo, 'id' | 'revision' | 'titulo'>;
  decision: DecisionObjetivo;
  /** Compacta (la tarjeta): los botones en fila y sin las consecuencias debajo (van en su etiqueta accesible). */
  compacta?: boolean;
  onResultado?: (r: ResultadoObjetivo) => void;
};

export function OpcionesDecisionObjetivo({ objetivo, decision, compacta, onResultado }: Props) {
  const tema = useTema();
  const [armada, setArmada] = useState(false);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  useEffect(() => {
    setArmada(false);
    setAviso(null);
    const r = setTimeout(() => {
      setArmada(true);
      // Revisión de accesibilidad: el botón se habilitó; quien no lo ve tiene que saberlo.
      AccessibilityInfo.announceForAccessibility(tr('Ya puedes elegir una opción.', 'You can choose an option now.'));
    }, ARMADO_MS + 30);
    return () => clearTimeout(r);
  }, [decision.id, objetivo.revision]);

  const elegir = async (opcion: string) => {
    if (!armada || ocupado) return;
    setOcupado(opcion);
    try {
      const r = await decidirObjetivo(objetivo, decision, opcion);
      if (r.ok) {
        setAviso(null);
        const et = decision.opciones.find((o) => o.id === opcion)?.etiqueta || '';
        AccessibilityInfo.announceForAccessibility(tr(`Elegiste «${et}».`, `You chose «${et}».`));
      } else {
        const m = r.conflicto ? tr('Cambió mientras tanto: te muestro la versión nueva. No apliqué nada.', 'It changed in the meantime: here is the new version. Nothing was applied.') : r.mensaje;
        setAviso(m);
        AccessibilityInfo.announceForAccessibility(m);
      }
      onResultado?.(r);
    } finally {
      setOcupado(null);
    }
  };

  return (
    <View style={[s.caja, { borderColor: tema.acento, backgroundColor: tema.acentoFondo }]} accessibilityRole="summary" accessibilityLabel={tr(`Decisión: ${decision.pregunta}`, `Decision: ${decision.pregunta}`)}>
      <Texto v={compacta ? 'chicaFuerte' : 'cuerpoFuerte'} color="acentoTexto">
        {decision.pregunta}
      </Texto>
      <View style={compacta ? s.fila : s.columna}>
        {decision.opciones.map((o) => (
          <View key={o.id} style={compacta ? s.opcionFila : s.opcion}>
            <Boton
              titulo={o.etiqueta}
              variante="contorno"
              tam="chico"
              cargando={ocupado === o.id}
              deshabilitado={!!ocupado || !armada}
              etiqueta={`${o.etiqueta}. ${o.consecuencia}${armada ? '' : tr('. Se habilita en un instante.', '. Enabled in a moment.')}`}
              onPress={() => void elegir(o.id)}
            />
            {!compacta ? (
              <Texto v="mini" color="texto3">
                {o.consecuencia}
              </Texto>
            ) : null}
          </View>
        ))}
      </View>
      {aviso ? (
        <Texto v="chica" color="aviso" accessibilityLiveRegion="polite" accessibilityRole="alert">
          {aviso}
        </Texto>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  caja: { borderWidth: 1, borderRadius: MEDIDA.radio.s, padding: MEDIDA.espacio.s, gap: 6 },
  fila: { flexDirection: 'row', flexWrap: 'wrap', gap: MEDIDA.espacio.s },
  columna: { gap: MEDIDA.espacio.s },
  opcion: { gap: 2 },
  opcionFila: { flexShrink: 1 },
});
