/**
 * Las piezas de las escenas que SEÑALAN DÓNDE TOCAR (José, 2-oct: «paso a paso, claro, señalando dónde
 * tocar»): copias en miniatura de lo que hay de verdad en la app (la barra de la mesa, la hoja «Más», las
 * pestañas de los chats, las filas de Ajustes) y un marco que late con su manito encima de lo que toca
 * tocar. Lo que espera un toque de verdad usa `Toca` (comun.tsx); esto solo señala.
 */
import type { ReactNode } from 'react';
import { Animated, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { COLOR, Icono, useCiclo, useVaiven } from './comun';
import type { NombreIcono } from '../../ui/iconos';

/** Un marco que late alrededor de lo señalado, con la manito (sin tocar nada: solo enseña dónde). */
export function Senala({ activo, color, children, mano = true, radio = 14, style }: { activo: boolean; color: string; children: ReactNode; mano?: boolean; radio?: number; style?: StyleProp<ViewStyle> }) {
  const late = useCiclo(1400, activo);
  const va = useVaiven(900, activo);
  return (
    <View style={style}>
      {children}
      {activo ? (
        <>
          <Animated.View
            pointerEvents="none"
            style={[
              StyleSheet.absoluteFill,
              { borderRadius: radio, borderWidth: 2.5, borderColor: color, opacity: late.interpolate({ inputRange: [0, 0.5, 1], outputRange: [1, 0.45, 1] }), transform: [{ scale: late.interpolate({ inputRange: [0, 0.5, 1], outputRange: [1, 1.06, 1] }) }] },
            ]}
          />
          {mano ? (
            <Animated.View pointerEvents="none" style={[st.mano, { transform: [{ translateY: va.interpolate({ inputRange: [0, 1], outputRange: [6, -3] }) }] }]}>
              <Text style={{ fontSize: 24 }}>👆</Text>
            </Animated.View>
          ) : null}
        </>
      ) : null}
    </View>
  );
}

/** Un botón de la barra de la mesa (Chat · Hablar · Más). */
export function BotonBarra({ icono, texto, grande, color }: { icono: NombreIcono; texto: string; grande?: boolean; color: string }) {
  return (
    <View style={st.botonBarra}>
      <View style={[st.circulo, grande && { width: 54, height: 54, borderRadius: 27, backgroundColor: color }]}>
        <Icono nombre={icono} tam={grande ? 26 : 20} color={grande ? '#141414' : COLOR.texto} />
      </View>
      <Text style={st.textoBarra}>{texto}</Text>
    </View>
  );
}

/** Una fila de menú (Ajustes, la hoja Más): ícono, título y una línea. */
export function FilaMenu({ icono, titulo, sub, valor }: { icono: NombreIcono; titulo: string; sub?: string; valor?: string }) {
  return (
    <View style={st.fila}>
      <Icono nombre={icono} tam={18} color={COLOR.texto2} />
      <View style={{ flex: 1 }}>
        <Text style={st.filaTitulo} numberOfLines={1}>
          {titulo}
        </Text>
        {sub ? (
          <Text style={st.filaSub} numberOfLines={1}>
            {sub}
          </Text>
        ) : null}
      </View>
      {valor ? <Text style={st.filaValor}>{valor}</Text> : <Text style={st.filaValor}>›</Text>}
    </View>
  );
}

/** El título de un grupo de filas («TU PERFIL», «PRIVACIDAD»). */
export function Grupo({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <View style={{ gap: 4 }}>
      <Text style={st.grupo}>{titulo}</Text>
      <View style={st.caja}>{children}</View>
    </View>
  );
}

/** «Más → Ajustes»: el camino de toques, como migas. */
export function Camino({ pasos, color }: { pasos: string[]; color: string }) {
  return (
    <View style={st.camino}>
      {pasos.map((p, k) => (
        <View key={p} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          {k > 0 ? <Text style={st.flecha}>→</Text> : null}
          <View style={[st.miga, k === pasos.length - 1 && { borderColor: color }]}>
            <Text style={[st.migaTexto, k === pasos.length - 1 && { color }]}>{p}</Text>
          </View>
        </View>
      ))}
    </View>
  );
}

export const st = StyleSheet.create({
  mano: { position: 'absolute', right: -14, bottom: -16 },
  botonBarra: { flex: 1, alignItems: 'center', gap: 4, paddingVertical: 6 },
  circulo: { width: 42, height: 42, borderRadius: 21, backgroundColor: COLOR.panel2, alignItems: 'center', justifyContent: 'center' },
  textoBarra: { color: COLOR.texto2, fontSize: 12, fontWeight: '700' },
  fila: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 9 },
  filaTitulo: { color: COLOR.texto, fontSize: 14, fontWeight: '700' },
  filaSub: { color: COLOR.texto3, fontSize: 11.5 },
  filaValor: { color: COLOR.texto3, fontSize: 13, fontWeight: '700' },
  grupo: { color: COLOR.texto3, fontSize: 11, fontWeight: '800', letterSpacing: 1, paddingHorizontal: 4 },
  caja: { borderRadius: 14, backgroundColor: COLOR.panel2, overflow: 'visible' },
  camino: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 },
  flecha: { color: COLOR.texto3, fontSize: 13 },
  miga: { borderWidth: 1, borderColor: COLOR.borde, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  migaTexto: { color: COLOR.texto2, fontSize: 12, fontWeight: '800' },
});
