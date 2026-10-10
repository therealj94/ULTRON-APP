/**
 * «CONTINUAR TRABAJO» EN LA MESA (Fase 2): una tarjeta compacta con el objetivo abierto más reciente —su título, en una
 * línea qué cambió desde la última vez que lo vio ESTE teléfono, el siguiente paso y, si espera una decisión, sus botones
 * ahí mismo—. Tocarla abre la hoja del objetivo. «Ocultar» la quita hasta que el objetivo cambie (otra revisión).
 *
 * Accesible: la tarjeta es un botón con todo dicho en su etiqueta; lo que cambia (estado, aviso) va en una región viva.
 */
import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { tr, useIdioma } from '../i18n';
import { MEDIDA, useTema } from '../nucleo/tema';
import { Texto } from '../ui';
import { anuncioCambioEstado, etiquetaEstadoObjetivo, type VistaObjetivo } from '../lib/objetivos';
import { useObjetivoReciente } from './useObjetivos';
import { OpcionesDecisionObjetivo } from './DecisionObjetivo';

type Props = { style?: StyleProp<ViewStyle>; onAbrir: (id: string) => void };

export function TarjetaContinuar({ style, onAbrir }: Props) {
  const tema = useTema();
  const idioma = useIdioma() === 'en' ? 'en' : 'es';
  const { objetivo, queCambio, decision } = useObjetivoReciente();
  const [oculta, setOculta] = useState<{ id: string; revision: number } | null>(null);
  // El estado cambió entre dos lecturas (otro aparato decidió, terminó un paso): se anuncia una vez.
  const antes = useRef<VistaObjetivo | null>(null);
  useEffect(() => {
    const m = anuncioCambioEstado(antes.current, objetivo, idioma);
    if (m) AccessibilityInfo.announceForAccessibility(m);
    antes.current = objetivo;
  }, [objetivo, idioma]);

  if (!objetivo) return null;
  if (oculta && oculta.id === objetivo.id && oculta.revision === objetivo.revision) return null;
  const estado = etiquetaEstadoObjetivo(objetivo, idioma);
  const etiqueta = [
    tr('Continuar trabajo', 'Continue work'),
    objetivo.titulo,
    estado,
    queCambio,
    objetivo.siguientePaso ? tr(`Siguiente: ${objetivo.siguientePaso}`, `Next: ${objetivo.siguientePaso}`) : '',
    tr('Toca para abrir el objetivo', 'Tap to open the goal'),
  ]
    .filter(Boolean)
    .join('. ');
  return (
    <View style={[s.caja, { backgroundColor: tema.superficie, borderColor: decision ? tema.acento : tema.borde }, style]}>
      <Pressable onPress={() => onAbrir(objetivo.id)} accessibilityRole="button" accessibilityLabel={etiqueta} hitSlop={4} style={s.cuerpo}>
        <View style={s.cabeza}>
          <Texto v="mini" color="texto3" style={{ flex: 1 }}>
            {tr('Continuar trabajo', 'Continue work')}
          </Texto>
          <Texto v="mini" color={decision ? 'acentoTexto' : 'texto2'} accessibilityLiveRegion="polite">
            {estado}
          </Texto>
        </View>
        <Texto v="cuerpoFuerte" numberOfLines={1}>
          {objetivo.titulo}
        </Texto>
        {queCambio ? (
          <Texto v="chica" color="texto2" numberOfLines={1}>
            {queCambio}
          </Texto>
        ) : null}
        {objetivo.siguientePaso ? (
          <Texto v="chica" numberOfLines={1}>
            {tr(`Siguiente: ${objetivo.siguientePaso}`, `Next: ${objetivo.siguientePaso}`)}
          </Texto>
        ) : null}
      </Pressable>
      {decision ? <OpcionesDecisionObjetivo objetivo={objetivo} decision={decision} compacta /> : null}
      <Pressable
        onPress={() => setOculta({ id: objetivo.id, revision: objetivo.revision })}
        accessibilityRole="button"
        accessibilityLabel={tr('Ocultar hasta que cambie algo', 'Hide until something changes')}
        hitSlop={10}
        style={s.ocultar}
      >
        <Texto v="mini" color="texto3">
          {tr('Ocultar', 'Hide')}
        </Texto>
      </Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  caja: { borderWidth: 1, borderRadius: MEDIDA.radio.m, padding: MEDIDA.espacio.s, gap: 6, maxWidth: 520, width: '100%' },
  cuerpo: { gap: 2, minHeight: 48 },
  cabeza: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  ocultar: { alignSelf: 'flex-end', minHeight: 32, justifyContent: 'center', paddingHorizontal: 6 },
});
