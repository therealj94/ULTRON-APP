/**
 * LA HOJA «MÁS» DE LA MESA: todo lo que no cabe en los tres botones, a un toque y sin tapar al
 * avatar mientras no se abre. Sube desde abajo (ui/Hoja: arrastrar para cerrar, velo, «atrás»).
 *
 * En una rejilla de mosaicos grandes (≥ 72 dp de alto, dos columnas en vertical, cuatro acostado):
 *   · Que te llame     — el avatar te llama (la pantalla «te está llamando», compa/LlamadaAvatar) y
 *                         hablan de corrido hasta que cuelgues; en la llamada, «Colgar»;
 *   · Escribir          — pone el cursor en «Escríbele…» de la mesa (o en el chat del modo trabajo): lo
 *                         escrito va al avatar como un turno hablado. Ya no abre el menú viejo (DeskMenu);
 *   · Cámara            — apagada / solo ahora / siempre (lib/camaraModo.ts);
 *   · Caras             — reconocer a la persona y a quien presente, con permiso (src/caras);
 *   · Voces             — saber por la voz quién habla (la dueña o su círculo), con permiso (src/voces);
 *   · Avatar            — cambiar con quién hablas;
 *   · Modo trabajo      — el avatar compacto y la conversación escrita debajo, para leer y volver a
 *                         consultar lo dicho (y «Modo charla» para volver al avatar grande);
 *   · Misiones          — las metas que AURA te ayuda a cumplir (ajustes/Misiones.tsx);
 *   · Mi círculo        — tu gente cercana y sus recordatorios (app/HojasCerebro.tsx);
 *   · Cartera           — tus saldos de Veta Wallet (cartera/);
 *   · Hoy               — tu calendario de hoy, mañana o la semana (agenda/HojaHoy.tsx; se conecta en Ajustes);
 *   · Su computadora    — lo que hace la computadora en la nube del avatar, y encargarle algo
 *                         (ajustes/Computadora.tsx); solo si el servidor la tiene;
 *   · Qué puedo hacer   — el recorrido corto (src/tutorial);
 *   · Ajustes           — la pantalla de Ajustes (voz, oído, memoria, su cara, tema, perfil, permisos
 *                         y sesión). «Más» es la única hoja de opciones de la mesa.
 * Cada mosaico dice su estado debajo del nombre (p. ej. «Solo ahora · 8 min»).
 *
 * Debajo de los mosaicos, `extra`: lo del avatar que vivía en el menú viejo de la derecha (DeskMenu, que se fue con la
 * auditoría del 7-oct, M-7): sus atajos, tono y presencia, orar y cantar, investigar y el catálogo (MasDelAvatar.tsx).
 * La orden de voz «menú» abre esta hoja.
 *
 * El layout, a prueba de Android (José, Samsung con Android 16: las tarjetas salían apiladas como una
 * baraja y la hoja cortada): antes la caja y el mosaico llevaban `flex: 1`, que en Yoga es base 0; con
 * la altura por contenido, la celda medía solo su relleno y cada tarjeta se desbordaba encima de la
 * siguiente. Ahora las alturas salen del contenido (`minHeight`, `flexGrow` sin base 0), la rejilla va
 * dentro de un ScrollView que se encoge para caber en la hoja (si no cabe, se desplaza; nunca se
 * comprime) y cada celda es una fracción del ancho real de la rejilla. Nada depende de una animación:
 * sin ella se ve igual.
 */
import { useMemo, type ReactNode } from 'react';
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { tr } from '../i18n';
import { MEDIDA, useTema, type Paleta } from '../nucleo/tema';
import { Hoja } from '../ui/Hoja';
import { Icono, type NombreIcono } from '../pulse/ui/Icono';
import { Tocable } from '../pulse/ui/Tocable';

export type OpcionMas = 'chat' | 'envivo' | 'escribir' | 'camara' | 'caras' | 'voces' | 'avatar' | 'modo' | 'misiones' | 'circulo' | 'cartera' | 'agenda' | 'computadora' | 'tutorial' | 'ajustes';

type Props = {
  visible: boolean;
  onCerrar: () => void;
  onOpcion: (o: OpcionMas) => void;
  nombreAvatar: string;
  /** Hay llamada del avatar (suena o se habla): el mosaico cuelga. */
  conversando: boolean;
  /** Lo que se lee debajo de «Cámara» («Apagada», «Solo ahora · 8 min», «Siempre»). */
  estadoCamara: string;
  camaraEncendida: boolean;
  /** Lo que se lee debajo de «Caras» («Apagado», «Conozco a 2»). */
  estadoCaras: string;
  /** Lo que se lee debajo de «Voces» («Apagado», «Conozco 2»); sin él, no se muestra. */
  estadoVoces?: string;
  /** La mesa está en modo trabajo (avatar compacto + la conversación escrita). */
  trabajando: boolean;
  /** Sin la barra de tres botones a la vista (el chat de la mesa): «Chats» también va aquí. */
  conChat?: boolean;
  /** Lo que se lee debajo de «Su computadora» («Lista», «Trabajando…»); sin él, no se muestra. */
  estadoComputadora?: string | null;
  computadoraTrabajando?: boolean;
  /** Lo que va debajo de los mosaicos (lo del avatar: MasDelAvatar.tsx). */
  extra?: ReactNode;
};

type Mosaico = { id: OpcionMas; icono: NombreIcono; titulo: string; sub: string; activo?: boolean };

export function HojaMas(p: Props) {
  const tema = useTema();
  const st = useMemo(() => estilos(tema), [tema]);
  const { width, fontScale } = useWindowDimensions();
  // Con la letra grande del sistema (o un teléfono muy angosto), una columna: nada se parte ni se corta.
  // Las columnas salen del ancho de la HOJA (ui/Hoja la limita a 560 en pantallas anchas), no del de la ventana:
  // acostado eran cuatro en 560 dp y «Misiones» se partía en «Misione / s» (auditoría del 7-oct, A7).
  const anchoHoja = width > 640 ? 560 : width;
  const columnas = anchoHoja >= 520 ? (fontScale >= 1.3 ? 2 : 3) : fontScale >= 1.3 || width < 340 ? 1 : 2;
  const mosaicos: Mosaico[] = [
    ...(p.conChat ? [{ id: 'chat' as const, icono: 'burbujas' as const, titulo: tr('Mensajes', 'Messages'), sub: tr('Tu gente y sus llamadas', 'Your people and calls') }] : []),
    {
      id: 'envivo',
      icono: 'llamar',
      titulo: p.conversando ? tr('Colgar', 'Hang up') : tr(`Que ${p.nombreAvatar} te llame`, `Have ${p.nombreAvatar} call you`),
      sub: p.conversando ? tr(`En llamada con ${p.nombreAvatar}`, `On a call with ${p.nombreAvatar}`) : tr('Se abre al instante y hablan de corrido', 'Opens right away and you talk hands-free'),
      activo: p.conversando,
    },
    { id: 'escribir', icono: 'teclado', titulo: tr('Escribir', 'Type'), sub: tr(`Escríbele a ${p.nombreAvatar}`, `Write to ${p.nombreAvatar}`) },
    { id: 'camara', icono: p.camaraEncendida ? 'camara' : 'camaraNo', titulo: tr('Cámara', 'Camera'), sub: p.estadoCamara, activo: p.camaraEncendida },
    { id: 'caras', icono: 'caraId', titulo: tr('Caras', 'Faces'), sub: p.estadoCaras },
    ...(p.estadoVoces != null ? [{ id: 'voces' as const, icono: 'microfono' as const, titulo: tr('Voces', 'Voices'), sub: p.estadoVoces }] : []),
    { id: 'avatar', icono: 'cambiar', titulo: tr('Avatar', 'Avatar'), sub: p.nombreAvatar },
    {
      id: 'modo',
      icono: p.trabajando ? 'expandir' : 'burbujas',
      titulo: p.trabajando ? tr('Modo charla', 'Chat mode') : tr('Modo trabajo', 'Work mode'),
      sub: p.trabajando ? tr('El avatar grande otra vez', 'The big avatar again') : tr('Avatar chico y lo escrito', 'Small avatar, written chat'),
      activo: p.trabajando,
    },
    { id: 'misiones', icono: 'palomita', titulo: tr('Misiones', 'Missions'), sub: tr('Tus metas, paso a paso', 'Your goals, step by step') },
    { id: 'circulo', icono: 'personaMas', titulo: tr('Mi círculo', 'My circle'), sub: tr('Tu gente cercana y sus recordatorios', 'Your close people and their reminders') },
    { id: 'cartera', icono: 'dinero', titulo: tr('Cartera', 'Wallet'), sub: tr('Saldos de Veta Wallet. Tarjeta: AU-RA puede mostrar sus datos y recargarla con tu contraseña', 'Veta Wallet balances. Card: AU-RA can show its details and top it up with your password') },
    { id: 'agenda', icono: 'reloj', titulo: tr('Hoy', 'Today'), sub: tr('Tu calendario del día', 'Your calendar for the day') },
    ...(p.estadoComputadora != null
      ? [{ id: 'computadora' as const, icono: 'pantalla' as const, titulo: tr('Su computadora', 'Their computer'), sub: p.estadoComputadora, activo: !!p.computadoraTrabajando }]
      : []),
    { id: 'tutorial', icono: 'ayuda', titulo: tr('Qué puedo hacer', 'What I can do'), sub: tr('Un recorrido corto', 'A short tour') },
    { id: 'ajustes', icono: 'ajustes', titulo: tr('Ajustes', 'Settings'), sub: tr('Todo lo de la mesa', 'Everything else') },
  ];
  // Cada celda, una fracción del ancho REAL de la rejilla (el porcentaje se resuelve contra lo que mide de
  // verdad, con el borde y el relleno de la hoja; un número calculado a mano quedaba 2 px corto y partía la fila).
  const ancho = `${100 / columnas}%` as const;
  return (
    <Hoja visible={p.visible} onCerrar={p.onCerrar} titulo={tr('Más', 'More')}>
      {/* La hoja ya se recorre con el dedo (ui/Hoja): la rejilla va plana, sin otro desplazable adentro. */}
      <View style={[st.desplazable, st.rejilla]}>
        {mosaicos.map((m) => (
          <View key={m.id} style={[st.celda, { width: ancho }]}>
            <Tocable
              onPress={() => p.onOpcion(m.id)}
              vibrar
              hundir={0.97}
              caja={st.caja}
              etiqueta={`${m.titulo}. ${m.sub}`}
              style={[st.mosaico, m.activo && { borderColor: tema.acento, backgroundColor: tema.acentoFondo }]}
            >
              <Icono nombre={m.icono} tam={26} color={m.activo ? tema.acentoTexto : tema.texto} grosor={1.9} lleno={m.icono === 'puntos'} />
              <View style={st.textos}>
                <Text style={st.titulo}>{m.titulo}</Text>
                <Text style={st.sub} numberOfLines={3}>
                  {m.sub}
                </Text>
              </View>
            </Tocable>
          </View>
        ))}
      </View>
      {p.extra}
    </Hoja>
  );
}

function estilos(p: Paleta) {
  return StyleSheet.create({
    // Se encoge para caber en la hoja (maxHeight 90 %); lo que no cabe se desplaza, no se comprime.
    // El margen negativo va en el ScrollView (no en su contenido, que él recorta): las celdas llegan al borde.
    desplazable: { flexGrow: 0, flexShrink: 1, marginHorizontal: -MEDIDA.espacio.xs },
    rejilla: { flexDirection: 'row', flexWrap: 'wrap', paddingBottom: MEDIDA.espacio.xs },
    celda: { padding: MEDIDA.espacio.xs },
    // Sin `flex: 1` (base 0): en Android colapsaba la celda a su relleno y las tarjetas se apilaban.
    caja: { flexGrow: 1 },
    mosaico: {
      flexGrow: 1,
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
