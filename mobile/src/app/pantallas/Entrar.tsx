/**
 * ENTRAR: con el espíritu de la puerta de Veta Wallet / Orden Global (la marca en serif, una sola
 * acción dorada, «Protegido por Orden Global» al pie), pero aquí se entra con GENESIS ID.
 *
 *   · «Entrar con Genesis ID» (src/lib/genesis.ts): la wallet de la persona —la app Orden Global o la
 *     web de Veta Wallet— pide permiso y devuelve un pase que solo este teléfono puede canjear. Sin
 *     contraseña que escribir aquí.
 *   · Mientras tanto el botón dice «Esperando tu wallet…»; si vuelve bien, la palomita ✔ y adentro.
 *   · Si falla, el mensaje del servidor en una tarjeta debajo (no un aviso que tapa la pantalla).
 *   · PENDIENTE: «Tu acceso está en revisión» (José aprueba las solicitudes); el mismo botón sirve
 *     cuando la aprueben.
 *   · SIN_GID o «No tengo Genesis ID» → «Crea tu Genesis ID», con los tres pasos.
 *   · Correo y clave quedan como «Otras formas de entrar», chiquito: para la junta y el modo local.
 */
import { useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { APP_VERSION } from '../../config';
import { entrarConGenesis, type ResultadoGenesis } from '../../lib/genesis';
import { miga } from '../../lib/reporte';
import { tr, useIdioma } from '../../i18n';
import { MEDIDA, useTema } from '../../nucleo/tema';
import { Aparecer, Aura, Boton, BotonCheck, Icono, SelectorIdioma, Texto, vibrar, type NombreIcono } from '../../ui';
import { fuenteDisplay } from '../../ui/tipografia';
import type { RaizParams } from '../rutas';
import { entrarCon, type Compartido } from '../sesion';

type Props = NativeStackScreenProps<RaizParams, 'Entrar'>;

type Estado =
  | { tipo: 'listo' }
  | { tipo: 'esperando' }
  | { tipo: 'exito'; nombre: string }
  | { tipo: 'error'; mensaje: string }
  | { tipo: 'pendiente' };

/** El aviso de la tarjeta de estado (error o revisión), con su ícono y su color. */
function Aviso({ icono, titulo, texto, tono }: { icono: NombreIcono; titulo: string; texto?: string; tono: 'aviso' | 'acento' }) {
  const tema = useTema();
  const fondo = tono === 'aviso' ? tema.avisoFondo : tema.acentoFondo;
  const color = tono === 'aviso' ? tema.aviso : tema.acentoTexto;
  return (
    <Aparecer desde="escala">
      <View style={[s.aviso, { backgroundColor: fondo }]} accessibilityRole="alert" accessibilityLiveRegion="polite">
        <View style={[s.avisoIcono, { backgroundColor: tema.oscuro ? 'rgba(0,0,0,0.18)' : 'rgba(255,255,255,0.6)' }]}>
          <Icono nombre={icono} tam={18} color={color} />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Texto v="cuerpoFuerte" color={color}>
            {titulo}
          </Texto>
          {!!texto && (
            <Texto v="chica" color="texto2">
              {texto}
            </Texto>
          )}
        </View>
      </View>
    </Aparecer>
  );
}

export function Entrar({ navigation, route }: Props) {
  useIdioma();
  const tema = useTema();
  const ins = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const horizontal = width > height && width > 600;
  const inicial: Estado =
    route.params?.codigo === 'PENDIENTE' ? { tipo: 'pendiente' } : route.params?.aviso ? { tipo: 'error', mensaje: route.params.aviso } : { tipo: 'listo' };
  const [estado, setEstado] = useState<Estado>(inicial);
  const vivo = useRef(true);
  useEffect(
    () => () => {
      vivo.current = false;
    },
    []
  );

  const alVolver = async (r: ResultadoGenesis) => {
    if (!vivo.current) return;
    if (r.ok) {
      vibrar('exito');
      setEstado({ tipo: 'exito', nombre: r.miembro.nombre });
      // Lo que Genesis compartió (nombre completo y cumpleaños) viaja a la primera vez.
      const compartido = (r as ResultadoGenesis & { genesis?: Compartido }).genesis || null;
      setTimeout(() => void entrarCon({ name: r.miembro.nombre, role: r.miembro.rol, correo: r.miembro.correo }, compartido), 850);
      return;
    }
    if (r.codigo === 'CANCELADO') return setEstado({ tipo: 'listo' });
    if (r.codigo === 'PENDIENTE') {
      vibrar('aviso');
      return setEstado({ tipo: 'pendiente' });
    }
    if (r.codigo === 'SIN_GID') {
      setEstado({ tipo: 'listo' });
      navigation.navigate('CrearGenesis', { sinVerificar: true });
      return;
    }
    vibrar('error');
    setEstado({ tipo: 'error', mensaje: r.mensaje });
  };

  const entrarGenesis = async () => {
    setEstado({ tipo: 'esperando' });
    try {
      await alVolver(await entrarConGenesis());
    } catch (e: any) {
      miga(`genesis: ${String(e?.message || e).slice(0, 80)}`);
      if (vivo.current) setEstado({ tipo: 'error', mensaje: tr('No pude entrar con Genesis ID. Prueba de nuevo.', 'Couldn’t sign in with Genesis ID. Try again.') });
    }
  };

  const esperando = estado.tipo === 'esperando';
  const tamAura = horizontal ? Math.min(260, height * 0.56) : Math.min(220, width * 0.56, height * 0.28);

  const marca = (
    <View style={[s.marca, horizontal && s.marcaH]}>
      <View style={{ width: tamAura, height: tamAura, alignItems: 'center', justifyContent: 'center' }}>
        <View style={StyleSheet.absoluteFill}>
          <Aura tam={tamAura} particulas={18} color={tema.acento} colorClaro={tema.oscuro ? '#FFF1CC' : '#F3E0B0'} />
        </View>
        {estado.tipo === 'exito' ? (
          <BotonCheck hecho animarAlMontar={60} tam={tamAura * 0.3} vibra={false} />
        ) : (
          <View style={[s.sello, { width: tamAura * 0.34, height: tamAura * 0.34, borderRadius: tamAura, backgroundColor: tema.oscuro ? 'rgba(28,29,32,0.7)' : 'rgba(255,255,255,0.75)', borderColor: tema.acento }]}>
            <Icono nombre="huella" tam={tamAura * 0.16} color={tema.acentoTexto} />
          </View>
        )}
      </View>
      <Texto v="etiqueta" color="acentoTexto" centro={!horizontal} style={{ marginTop: MEDIDA.espacio.l }}>
        PULSE 2CHAT × AURA
      </Texto>
      {/* Acostado, el idioma va debajo de la marca para no pisar el título. */}
      {horizontal && (
        <View style={{ marginTop: MEDIDA.espacio.l }}>
          <SelectorIdioma />
        </View>
      )}
    </View>
  );

  const cuerpo = (
    <View style={[s.cuerpo, horizontal && s.cuerpoH]}>
      <View style={{ gap: 8 }}>
        <Texto v="heroe" centro={!horizontal} accessibilityRole="header">
          {estado.tipo === 'exito' ? `${tr('¡Hola', 'Hi')}, ${estado.nombre}!` : tr('Entra con tu identidad', 'Sign in with your identity')}
        </Texto>
        <Texto v="cuerpo" color="texto2" centro={!horizontal}>
          {estado.tipo === 'exito'
            ? tr('Tu Genesis ID confirmó que eres tú.', 'Your Genesis ID confirmed it’s you.')
            : tr(
                'Tu Genesis ID es tu identidad de Orden Global. Sin contraseñas: tu wallet confirma que eres tú.',
                'Your Genesis ID is your Orden Global identity. No passwords: your wallet confirms it’s you.'
              )}
        </Texto>
      </View>

      {estado.tipo === 'error' && <Aviso icono="alerta" tono="aviso" titulo={tr('No se pudo entrar', 'Couldn’t sign in')} texto={estado.mensaje} />}
      {estado.tipo === 'pendiente' && (
        <Aviso
          icono="reloj"
          tono="acento"
          titulo={tr('Tu acceso está en revisión', 'Your access is under review')}
          texto={tr(
            'Tu Genesis ID es válido y tu solicitud ya llegó. Cuando la aprueben, entras con este mismo botón.',
            'Your Genesis ID is valid and your request arrived. Once approved, sign in with this same button.'
          )}
        />
      )}

      <View style={{ gap: MEDIDA.espacio.m }}>
        <Boton
          titulo={estado.tipo === 'pendiente' || estado.tipo === 'error' ? tr('Intentar de nuevo', 'Try again') : tr('Entrar con Genesis ID', 'Sign in with Genesis ID')}
          icono="huella"
          onPress={() => void entrarGenesis()}
          cargando={esperando}
          textoCargando={tr('Esperando tu wallet…', 'Waiting for your wallet…')}
          deshabilitado={estado.tipo === 'exito'}
          etiqueta={tr('Entrar con Genesis ID desde tu wallet Orden Global', 'Sign in with Genesis ID from your Orden Global wallet')}
        />
        <Boton titulo={tr('No tengo Genesis ID', 'I don’t have a Genesis ID')} variante="secundario" onPress={() => navigation.navigate('CrearGenesis')} deshabilitado={esperando || estado.tipo === 'exito'} />
      </View>

      <View style={s.confianza}>
        <Icono nombre="candado" tam={15} color={tema.texto3} />
        <Texto v="chica" color="texto3" style={{ flex: 1 }}>
          {tr('Tu clave de la wallet nunca pasa por AURA.', 'Your wallet password never goes through AURA.')}
        </Texto>
      </View>

      <Boton titulo={tr('Otras formas de entrar', 'Other ways to sign in')} variante="fantasma" tam="chico" onPress={() => navigation.navigate('OtrasFormas')} deshabilitado={esperando} style={{ alignSelf: horizontal ? 'flex-start' : 'center' }} />
    </View>
  );

  return (
    <View style={[s.raiz, { backgroundColor: tema.fondo }]}>
      <ScrollView
        contentContainerStyle={[s.contenido, { paddingTop: ins.top + (horizontal ? 20 : 64), paddingBottom: ins.bottom + 20 }, horizontal && s.contenidoH]}
        showsVerticalScrollIndicator={false}
        bounces={false}
      >
        <Aparecer desde="escala" style={horizontal ? { flex: 1, alignItems: 'center' } : undefined}>
          {marca}
        </Aparecer>
        <Aparecer retraso={120} style={horizontal ? { flex: 1.1 } : { width: '100%', maxWidth: 460 }}>
          {cuerpo}
        </Aparecer>
        {!horizontal && (
          <View style={s.pie}>
            <View style={s.fila}>
              <Icono nombre="escudo" tam={14} color={tema.texto3} />
              <Texto v="mini" color="texto3">
                {tr('Protegido por', 'Secured by')}
              </Texto>
              <Texto v="chica" color="texto2" style={[fuenteDisplay(), { fontSize: 14, letterSpacing: 2 }]}>
                ORDEN GLOBAL
              </Texto>
            </View>
            <Texto v="mini" color="texto3">
              v{APP_VERSION}
            </Texto>
          </View>
        )}
      </ScrollView>
      {!horizontal && (
        <View style={[s.idioma, { top: ins.top + 10 }]}>
          <SelectorIdioma />
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  raiz: { flex: 1 },
  contenido: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: MEDIDA.espacio.xl, gap: MEDIDA.espacio.xl },
  contenidoH: { flexDirection: 'row', paddingHorizontal: 48, gap: 48 },
  marca: { alignItems: 'center' },
  marcaH: { alignItems: 'center' },
  sello: { alignItems: 'center', justifyContent: 'center', borderWidth: 1.5 },
  cuerpo: { gap: MEDIDA.espacio.xl, width: '100%' },
  cuerpoH: { maxWidth: 440, gap: MEDIDA.espacio.l },
  aviso: { flexDirection: 'row', gap: 12, padding: 14, borderRadius: MEDIDA.radio.m, alignItems: 'flex-start' },
  avisoIcono: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  confianza: { flexDirection: 'row', alignItems: 'center', gap: 8, justifyContent: 'center', paddingHorizontal: 8 },
  pie: { alignItems: 'center', gap: 6, marginTop: 'auto', paddingTop: MEDIDA.espacio.l },
  fila: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  idioma: { position: 'absolute', right: MEDIDA.espacio.l },
});
