/**
 * LA HOJA «MÁS» DE LA MESA: todo lo que no cabe en los tres botones, a un toque y sin tapar al
 * avatar mientras no se abre. Sube desde abajo (ui/Hoja: arrastrar para cerrar, velo, «atrás»).
 *
 * En una rejilla de mosaicos grandes (≥ 72 dp de alto, dos columnas en vertical, cuatro acostado):
 *   · Conversar en vivo — hablar de corrido con el avatar, como una llamada (ElevenLabs);
 *   · Escribir          — el teclado y el menú de siempre;
 *   · Cámara            — apagada / solo ahora / siempre (lib/camaraModo.ts);
 *   · Caras             — reconocer a la persona y a quien presente, con permiso (src/caras);
 *   · Avatar            — cambiar con quién hablas;
 *   · Modo trabajo      — el avatar compacto y la conversación escrita debajo, para leer y volver a
 *                         consultar lo dicho (y «Modo charla» para volver al avatar grande);
 *   · Qué puedo hacer   — el recorrido corto (src/tutorial);
 *   · Ajustes           — el menú completo de la mesa (DeskMenu).
 * Cada mosaico dice su estado debajo del nombre (p. ej. «Solo ahora · 8 min»).
 */
import { useMemo } from 'react';
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { tr } from '../i18n';
import { MEDIDA, useTema, type Paleta } from '../nucleo/tema';
import { Hoja } from '../ui/Hoja';
import { Icono, type NombreIcono } from '../pulse/ui/Icono';
import { Tocable } from '../pulse/ui/Tocable';

export type OpcionMas = 'envivo' | 'escribir' | 'camara' | 'caras' | 'avatar' | 'modo' | 'tutorial' | 'ajustes';

type Props = {
  visible: boolean;
  onCerrar: () => void;
  onOpcion: (o: OpcionMas) => void;
  nombreAvatar: string;
  conversando: boolean;
  /** Lo que se lee debajo de «Cámara» («Apagada», «Solo ahora · 8 min», «Siempre»). */
  estadoCamara: string;
  camaraEncendida: boolean;
  /** Lo que se lee debajo de «Caras» («Apagado», «Conozco a 2»). */
  estadoCaras: string;
  /** La mesa está en modo trabajo (avatar compacto + la conversación escrita). */
  trabajando: boolean;
};

type Mosaico = { id: OpcionMas; icono: NombreIcono; titulo: string; sub: string; activo?: boolean };

export function HojaMas(p: Props) {
  const tema = useTema();
  const st = useMemo(() => estilos(tema), [tema]);
  const { width, fontScale } = useWindowDimensions();
  // Con la letra grande del sistema (o un teléfono muy angosto), una columna: nada se parte ni se corta.
  const columnas = width >= 640 ? (fontScale >= 1.3 ? 2 : 4) : fontScale >= 1.3 || width < 340 ? 1 : 2;
  const mosaicos: Mosaico[] = [
    {
      id: 'envivo',
      icono: 'llamar',
      titulo: p.conversando ? tr('Terminar en vivo', 'End live talk') : tr('Conversar en vivo', 'Live conversation'),
      sub: p.conversando ? tr(`Hablando con ${p.nombreAvatar}`, `Talking with ${p.nombreAvatar}`) : tr('De corrido, como una llamada', 'Hands-free, like a call'),
      activo: p.conversando,
    },
    { id: 'escribir', icono: 'teclado', titulo: tr('Escribir', 'Type'), sub: tr('El teclado y el menú', 'Keyboard and menu') },
    { id: 'camara', icono: p.camaraEncendida ? 'camara' : 'camaraNo', titulo: tr('Cámara', 'Camera'), sub: p.estadoCamara, activo: p.camaraEncendida },
    { id: 'caras', icono: 'caraId', titulo: tr('Caras', 'Faces'), sub: p.estadoCaras },
    { id: 'avatar', icono: 'cambiar', titulo: tr('Avatar', 'Avatar'), sub: p.nombreAvatar },
    {
      id: 'modo',
      icono: p.trabajando ? 'expandir' : 'burbujas',
      titulo: p.trabajando ? tr('Modo charla', 'Chat mode') : tr('Modo trabajo', 'Work mode'),
      sub: p.trabajando ? tr('El avatar grande otra vez', 'The big avatar again') : tr('Avatar chico y lo escrito', 'Small avatar, written chat'),
      activo: p.trabajando,
    },
    { id: 'tutorial', icono: 'ayuda', titulo: tr('Qué puedo hacer', 'What I can do'), sub: tr('Un recorrido corto', 'A short tour') },
    { id: 'ajustes', icono: 'ajustes', titulo: tr('Ajustes', 'Settings'), sub: tr('Todo lo de la mesa', 'Everything else') },
  ];
  const ancho = `${100 / columnas}%` as const;
  return (
    <Hoja visible={p.visible} onCerrar={p.onCerrar} titulo={tr('Más', 'More')}>
      <View style={st.rejilla}>
        {mosaicos.map((m) => (
          <View key={m.id} style={[st.celda, { width: ancho }]}>
            <Tocable
              onPress={() => p.onOpcion(m.id)}
              vibrar
              hundir={0.97}
              caja={st.llenar}
              etiqueta={`${m.titulo}. ${m.sub}`}
              style={[st.mosaico, m.activo && { borderColor: tema.acento, backgroundColor: tema.acentoFondo }]}
            >
              <Icono nombre={m.icono} tam={26} color={m.activo ? tema.acentoTexto : tema.texto} grosor={1.9} lleno={m.icono === 'puntos'} />
              <View style={st.textos}>
                <Text style={st.titulo} numberOfLines={3}>
                  {m.titulo}
                </Text>
                <Text style={st.sub} numberOfLines={3}>
                  {m.sub}
                </Text>
              </View>
            </Tocable>
          </View>
        ))}
      </View>
    </Hoja>
  );
}

function estilos(p: Paleta) {
  return StyleSheet.create({
    rejilla: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -MEDIDA.espacio.xs },
    celda: { padding: MEDIDA.espacio.xs },
    llenar: { flex: 1 },
    mosaico: {
      flex: 1,
      minHeight: 76,
      flexDirection: 'row',
      alignItems: 'center',
      gap: MEDIDA.espacio.m,
      paddingHorizontal: MEDIDA.espacio.m,
      paddingVertical: MEDIDA.espacio.m,
      borderRadius: MEDIDA.radio.m,
      borderWidth: 1,
      borderColor: p.borde,
      backgroundColor: p.superficie,
    },
    textos: { flex: 1 },
    titulo: { color: p.texto, fontSize: MEDIDA.letra.cuerpo, fontWeight: '700' },
    sub: { color: p.texto2, fontSize: MEDIDA.letra.chica + 0.5, marginTop: 2 },
  });
}
