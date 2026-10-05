/**
 * Piezas que comparten los pasos de la primera vez (y Ajustes):
 *
 *   EncabezadoPaso   la etiqueta dorada, el título grande en serif y la explicación
 *   SelectorCumple   el cumpleaños sin año: los 12 meses a la vista en 3 filas y los días en filas de 7
 *                    (el 29 de febrero existe; el 31 de abril no), con «Quitar fecha»
 *   VistaAvatar      el avatar vivo: su cara (los ojos que parpadean y miran, o la foto de Claudio)
 *                    dentro de su aura, con los colores del avatar
 */
import { useEffect } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withDelay, withRepeat, withSequence, withSpring, withTiming } from 'react-native-reanimated';
import { tr, useIdioma } from '../i18n';
import { MEDIDA, useTema } from '../nucleo/tema';
import { avatarPorId, type AvatarId } from '../avatares/catalogo';
import { fotosRetrato } from '../avatares/ClaudioRetrato';
import { Aparecer, Aura, Boton, Texto, vibrar } from '../ui';
import { SIN_CUMPLE, diasDelMes, elegirDia, elegirMes, faltaEnCumple, type SeleccionCumple } from './flujo';

export function EncabezadoPaso({ etiqueta, titulo, texto, centro }: { etiqueta?: string; titulo: string; texto?: string; centro?: boolean }) {
  return (
    <View style={{ gap: 8 }}>
      {!!etiqueta && (
        <Aparecer>
          <Texto v="etiqueta" color="acentoTexto" centro={centro}>
            {etiqueta}
          </Texto>
        </Aparecer>
      )}
      <Aparecer retraso={40}>
        <Texto v="heroe" centro={centro} accessibilityRole="header">
          {titulo}
        </Texto>
      </Aparecer>
      {!!texto && (
        <Aparecer retraso={90}>
          <Texto v="grande" color="texto2" centro={centro}>
            {texto}
          </Texto>
        </Aparecer>
      )}
    </View>
  );
}

/* ── el cumpleaños ────────────────────────────────────────────────────────────────────────── */

const MESES_ES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
const MESES_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MESES_LARGOS_ES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const MESES_LARGOS_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** Columnas de cada cuadrícula: los 12 meses en 3 filas de 4; los días en filas de 7, como un calendario. */
const COLUMNAS_MES = 4;
const COLUMNAS_DIA = 7;

/** [1..n] en filas de `columnas` (la última se rellena con huecos para que las celdas midan lo mismo). */
function enFilas(n: number, columnas: number): (number | null)[][] {
  const filas: (number | null)[][] = [];
  for (let i = 0; i < n; i += columnas) filas.push(Array.from({ length: columnas }, (_, j) => (i + j < n ? i + j + 1 : null)));
  return filas;
}

/** Una celda de la cuadrícula: ocupa su parte de la fila (flex 1), nunca se sale de la pantalla. */
function Celda({ texto, activo, onPress, etiqueta }: { texto: string; activo: boolean; onPress: () => void; etiqueta?: string }) {
  const tema = useTema();
  const e = useSharedValue(1);
  const a = useAnimatedStyle(() => ({ transform: [{ scale: e.value }] }));
  useEffect(() => {
    if (activo) e.value = withSequence(withTiming(1.08, { duration: 110 }), withSpring(1, MEDIDA.resorte.vivo));
  }, [activo, e]);
  return (
    <Animated.View style={[s.celda, a]}>
      <Pressable
        onPress={() => {
          vibrar('seleccion');
          onPress();
        }}
        style={[s.boton, { backgroundColor: activo ? tema.acento : tema.superficie, borderColor: activo ? tema.acento : tema.borde }]}
        accessibilityRole="button"
        accessibilityLabel={etiqueta || texto}
        accessibilityState={{ selected: activo }}
        hitSlop={3}
      >
        <Texto v="chicaFuerte" color={activo ? 'sobreAcento' : 'texto'} numberOfLines={1}>
          {texto}
        </Texto>
      </Pressable>
    </Animated.View>
  );
}

/**
 * EL CUMPLEAÑOS: los 12 meses a la vista (3 filas de 4, sin una fila escondida que haya que deslizar) y los
 * días en filas de 7 que caben en el ancho de cualquier teléfono. Se puede empezar por el mes o por el día:
 * nada se apaga ni deja de responder (antes los días quedaban inertes hasta tener mes, y en la primera vez
 * el mes no llegaba a quedar: José, 5-oct). Cambiar a un mes donde el día no existe suelta el día (el 31
 * en abril). «Quitar fecha» lo deja en blanco: es opcional. Las reglas viven en flujo.ts (elegirMes,
 * elegirDia, diasDelMes) para probarlas en node.
 *
 * Controlado: quien lo usa guarda la selección A MEDIAS (mes sin día) y la devuelve en `mes`/`dia`.
 */
export function SelectorCumple({ mes, dia, onCambiar }: { mes: number | null; dia: number | null; onCambiar: (mes: number | null, dia: number | null) => void }) {
  const idioma = useIdioma();
  const meses = idioma === 'en' ? MESES_EN : MESES_ES;
  const largos = idioma === 'en' ? MESES_LARGOS_EN : MESES_LARGOS_ES;
  const sel: SeleccionCumple = { mes, dia };
  const cambiar = (n: SeleccionCumple) => onCambiar(n.mes, n.dia);
  const falta = faltaEnCumple(sel);
  const aviso =
    falta === 'dia'
      ? tr('Ahora elige el día.', 'Now pick the day.')
      : falta === 'mes'
        ? tr('Ahora elige el mes.', 'Now pick the month.')
        : null;
  return (
    <View style={{ gap: MEDIDA.espacio.l }}>
      <View style={{ gap: 8 }}>
        <Texto v="chicaFuerte" color="texto2">
          {tr('Mes', 'Month')}
        </Texto>
        {enFilas(12, COLUMNAS_MES).map((fila, f) => (
          <View key={f} style={s.fila}>
            {fila.map((m, j) =>
              m ? (
                <Celda key={m} texto={meses[m - 1]} etiqueta={largos[m - 1]} activo={mes === m} onPress={() => cambiar(elegirMes(sel, m))} />
              ) : (
                <View key={`h${j}`} style={s.celda} />
              )
            )}
          </View>
        ))}
      </View>
      <View style={{ gap: 8 }}>
        <Texto v="chicaFuerte" color="texto2">
          {tr('Día', 'Day')}
        </Texto>
        {enFilas(diasDelMes(mes), COLUMNAS_DIA).map((fila, f) => (
          <View key={f} style={s.fila}>
            {fila.map((d, j) =>
              d ? (
                <Celda key={d} texto={String(d)} activo={dia === d} onPress={() => cambiar(elegirDia(sel, d))} />
              ) : (
                <View key={`h${j}`} style={s.celda} />
              )
            )}
          </View>
        ))}
      </View>
      {(!!aviso || falta !== 'todo') && (
        <View style={s.pie}>
          <Texto v="chica" color="texto2" style={{ flex: 1 }}>
            {aviso || ''}
          </Texto>
          {falta !== 'todo' && <Boton titulo={tr('Quitar fecha', 'Clear date')} variante="fantasma" tam="chico" onPress={() => cambiar(SIN_CUMPLE)} />}
        </View>
      )}
    </View>
  );
}

/* ── el avatar vivo ───────────────────────────────────────────────────────────────────────── */

function OjosVivos({ color, lado }: { color: string; lado: number }) {
  const parpado = useSharedValue(1);
  const mirada = useSharedValue(0);
  useEffect(() => {
    parpado.value = withRepeat(withSequence(withDelay(2600, withTiming(0.08, { duration: 90 })), withTiming(1, { duration: 120 })), -1, false);
    mirada.value = withRepeat(withSequence(withTiming(1, { duration: 1400, easing: Easing.inOut(Easing.sin) }), withTiming(-1, { duration: 2200, easing: Easing.inOut(Easing.sin) }), withTiming(0, { duration: 1200 })), -1, false);
  }, [parpado, mirada]);
  const ojo = Math.round(lado * 0.3);
  const borde = Math.max(2, Math.round(ojo * 0.12));
  const pupila = Math.round(ojo * 0.32);
  const aOjo = useAnimatedStyle(() => ({ transform: [{ scaleY: parpado.value }] }));
  const aPupila = useAnimatedStyle(() => ({ transform: [{ translateX: mirada.value * ojo * 0.16 }] }));
  return (
    <View style={{ flexDirection: 'row', gap: Math.round(lado * 0.1) }}>
      {[0, 1].map((i) => (
        <Animated.View key={i} style={[{ width: ojo, height: ojo, borderRadius: ojo / 2, borderWidth: borde, borderColor: color, alignItems: 'center', justifyContent: 'center' }, aOjo]}>
          <Animated.View style={[{ width: pupila, height: pupila, borderRadius: pupila / 2, backgroundColor: color }, aPupila]} />
        </Animated.View>
      ))}
    </View>
  );
}

export function VistaAvatar({ id, tam }: { id: AvatarId; tam: number }) {
  const a = avatarPorId(id);
  const cara = tam * 0.56;
  const flota = useSharedValue(0);
  useEffect(() => {
    flota.value = withRepeat(withTiming(1, { duration: 2400, easing: Easing.inOut(Easing.sin) }), -1, true);
  }, [flota]);
  const aFlota = useAnimatedStyle(() => ({ transform: [{ translateY: (flota.value - 0.5) * 6 }] }));
  return (
    <View style={{ width: tam, height: tam, alignItems: 'center', justifyContent: 'center' }}>
      <View style={StyleSheet.absoluteFill}>
        <Aura tam={tam} particulas={16} color={a.tema.acento} colorClaro={a.tema.acentoTexto} />
      </View>
      <Animated.View style={[{ width: cara, height: cara, borderRadius: cara / 2, backgroundColor: a.tema.fondo, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: a.tema.acento }, aFlota]}>
        {fotosRetrato(id) ? (
          <Animated.Image source={fotosRetrato(id)!.base} resizeMode="cover" style={{ width: '100%', height: '100%' }} />
        ) : (
          <OjosVivos color={a.tema.acento} lado={cara} />
        )}
      </Animated.View>
    </View>
  );
}

const s = StyleSheet.create({
  fila: { flexDirection: 'row', gap: 6 },
  celda: { flex: 1, minWidth: 0 },
  boton: { height: 42, borderRadius: 14, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 2, borderWidth: StyleSheet.hairlineWidth * 2 },
  pie: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 42 },
});
