/**
 * Listas agrupadas al estilo del sistema (Ajustes de Android/iOS): grupos con título chico en
 * mayúsculas, filas con ícono en su cuadrito de color, valor a la derecha y chevron; separadores de
 * un pelo que no llegan al borde. Más el control segmentado (Oscuro · Claro · Sistema) con la
 * píldora que se desliza, y el interruptor del sistema pintado con el tema.
 */
import { Children, Fragment, isValidElement, useEffect, useRef, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Switch, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { MEDIDA, useTema } from '../nucleo/tema';
import { vibrar } from './hapticos';
import { Icono, type NombreIcono } from './Icono';
import { sombraDe } from './Tarjeta';
import { Texto } from './Texto';

export function Grupo({ titulo, pie, children }: { titulo?: string; pie?: string; children: ReactNode }) {
  const tema = useTema();
  const hijos = Children.toArray(children).filter(isValidElement);
  return (
    <View style={s.grupo}>
      {!!titulo && (
        <Texto v="etiqueta" color="texto3" style={s.tituloGrupo}>
          {titulo}
        </Texto>
      )}
      <View style={[s.caja, { backgroundColor: tema.superficie, borderColor: tema.borde }, sombraDe(tema)]}>
        {hijos.map((h, i) => (
          <Fragment key={i}>
            {i > 0 && <View style={[s.separador, { backgroundColor: tema.borde }]} />}
            {h}
          </Fragment>
        ))}
      </View>
      {!!pie && (
        <Texto v="chica" color="texto3" style={s.pie}>
          {pie}
        </Texto>
      )}
    </View>
  );
}

type FilaProps = {
  titulo: string;
  detalle?: string;
  icono?: NombreIcono;
  /** Color del cuadrito del ícono (por omisión, el fondo dorado del tema). */
  colorIcono?: string;
  valor?: string;
  derecha?: ReactNode;
  onPress?: () => void;
  destructiva?: boolean;
  chevron?: boolean;
};

export function Fila({ titulo, detalle, icono, colorIcono, valor, derecha, onPress, destructiva, chevron = !!onPress }: FilaProps) {
  const tema = useTema();
  const contenido = (
    <>
      {icono && (
        <View style={[s.icono, { backgroundColor: destructiva ? tema.avisoFondo : colorIcono || tema.acentoFondo }]}>
          <Icono nombre={icono} tam={18} color={destructiva ? tema.aviso : colorIcono ? '#FFFFFF' : tema.acentoTexto} />
        </View>
      )}
      <View style={s.textos}>
        <Texto v="cuerpoFuerte" color={destructiva ? 'aviso' : 'texto'} numberOfLines={2}>
          {titulo}
        </Texto>
        {!!detalle && (
          <Texto v="chica" color="texto3" numberOfLines={2}>
            {detalle}
          </Texto>
        )}
      </View>
      {!!valor && (
        <Texto v="chica" color="texto2" numberOfLines={1} style={s.valor}>
          {valor}
        </Texto>
      )}
      {derecha}
      {chevron && <Icono nombre="adelante" tam={18} color={tema.texto3} />}
    </>
  );
  if (!onPress) return <View style={s.fila}>{contenido}</View>;
  return (
    <Pressable
      onPress={() => {
        vibrar('seleccion');
        onPress();
      }}
      android_ripple={{ color: tema.acentoFondo }}
      style={({ pressed }) => [s.fila, pressed && { backgroundColor: tema.superficie2 }]}
      accessibilityRole="button"
      accessibilityLabel={[titulo, valor, detalle].filter(Boolean).join(', ')}
    >
      {contenido}
    </Pressable>
  );
}

export function Interruptor({ valor, onCambiar, etiqueta }: { valor: boolean; onCambiar: (v: boolean) => void; etiqueta: string }) {
  const tema = useTema();
  return (
    <Switch
      value={valor}
      onValueChange={(v) => {
        vibrar('seleccion');
        onCambiar(v);
      }}
      accessibilityLabel={etiqueta}
      trackColor={{ true: tema.acento, false: tema.superficie2 }}
      thumbColor={valor ? '#FFFFFF' : tema.oscuro ? tema.texto2 : '#FFFFFF'}
      ios_backgroundColor={tema.superficie2}
    />
  );
}

export type OpcionSegmento<T extends string> = { id: T; texto: string; icono?: NombreIcono };

export function Segmentado<T extends string>({ opciones, valor, onCambiar }: { opciones: OpcionSegmento<T>[]; valor: T; onCambiar: (v: T) => void }) {
  const tema = useTema();
  const [ancho, setAncho] = useState(0);
  const i = Math.max(0, opciones.findIndex((o) => o.id === valor));
  const cada = ancho ? (ancho - 8) / opciones.length : 0;
  const x = useSharedValue(0);
  const medida = useRef(0);
  useEffect(() => {
    // Al medir por primera vez (o al girar el teléfono) la píldora se coloca sin viaje; al elegir, se desliza.
    if (medida.current !== cada) {
      medida.current = cada;
      x.value = i * cada;
    } else x.value = withSpring(i * cada, MEDIDA.resorte.suave);
  }, [i, cada, x]);
  const a = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));
  return (
    <View
      style={[s.segmentos, { backgroundColor: tema.superficie2, borderColor: tema.borde }]}
      onLayout={(e) => setAncho(e.nativeEvent.layout.width)}
      accessibilityRole="radiogroup"
    >
      {cada > 0 && <Animated.View style={[s.pildora, { width: cada, backgroundColor: tema.superficie }, sombraDe(tema), a]} />}
      {opciones.map((o) => {
        const activo = o.id === valor;
        return (
          <Pressable
            key={o.id}
            onPress={() => {
              if (activo) return;
              vibrar('seleccion');
              onCambiar(o.id);
            }}
            style={s.segmento}
            accessibilityRole="radio"
            accessibilityState={{ selected: activo }}
            accessibilityLabel={o.texto}
          >
            {o.icono && <Icono nombre={o.icono} tam={16} color={activo ? tema.acentoTexto : tema.texto3} />}
            <Texto v="chicaFuerte" color={activo ? 'texto' : 'texto2'} numberOfLines={1}>
              {o.texto}
            </Texto>
          </Pressable>
        );
      })}
    </View>
  );
}

const s = StyleSheet.create({
  grupo: { gap: 8 },
  tituloGrupo: { marginLeft: 16 },
  caja: { borderRadius: MEDIDA.radio.l, borderWidth: StyleSheet.hairlineWidth * 2, overflow: 'hidden' },
  separador: { height: StyleSheet.hairlineWidth * 2, marginLeft: 60, opacity: 0.7 },
  pie: { marginHorizontal: 16 },
  fila: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 58, paddingHorizontal: 14, paddingVertical: 10 },
  icono: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  textos: { flex: 1, gap: 2 },
  valor: { maxWidth: 150, textAlign: 'right' },
  segmentos: { flexDirection: 'row', borderRadius: MEDIDA.radio.m, padding: 4, borderWidth: StyleSheet.hairlineWidth * 2, minHeight: 46 },
  pildora: { position: 'absolute', top: 4, bottom: 4, left: 4, borderRadius: MEDIDA.radio.m - 4 },
  segmento: { flex: 1, flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center', minHeight: 38 },
});
