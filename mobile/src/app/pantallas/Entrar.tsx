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
 *   · SIN_GID (la wallet no tiene Genesis ID) o «No tengo Genesis ID» → «Crea tu Genesis ID», con los
 *     tres pasos.
 *   · GID_PENDIENTE: el Genesis ID existe y está en verificación. Tarjeta propia, sin mandar a crear
 *     otro: el mismo botón sirve cuando lo aprueben.
 *   · NO_VINCULADA: la cuenta de la wallet no está atada a un Genesis ID; cómo vincularlo y un botón
 *     que abre la app Orden Global.
 *   · CORREO_SIN_CONFIRMAR, LIMITE (esperar) y RED (reintentar): cada uno con su título y qué hacer.
 *   · SIN_WALLET (no está la app Orden Global): «No encontramos tu wallet», con «Instalar Orden
 *     Global» (Google Play), «Usar Veta Wallet en la web» y «Entrar con mi correo».
 *   · La vuelta TARDÍA de la wallet (sacó su Genesis ID mientras tanto, docs/ENTRAR-GENESIS.md): la
 *     pantalla la escucha mientras está montada y entra sola, como si hubiera vuelto a tiempo.
 *   · `reintentar` (lo manda «Crea tu Genesis ID»): vuelve aquí y pide el pase enseguida.
 *   · Correo y clave quedan como «Otras formas de entrar», chiquito: para la junta y el modo local.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useFocusEffect } from '@react-navigation/native';
import { orientar } from '../../lib/orientacion';
import { APP_VERSION } from '../../config';
import { entrarConGenesis, escucharVueltaTardia, type OpcionesEntrada, type ResultadoGenesis } from '../../lib/genesis';
import { abrirAppOrdenGlobal, abrirTiendaOrdenGlobal } from './CrearGenesis';
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
  | { tipo: 'error'; mensaje: string; codigo?: string }
  | { tipo: 'pendiente' }
  | { tipo: 'gidPendiente' }
  | { tipo: 'noVinculada' }
  | { tipo: 'sinWallet' };

/**
 * El estado de la pantalla para un código de src/lib/genesis.ts (los del contrato con la wallet y los
 * del servidor). SIN_GID y CANCELADO no llegan a tarjeta: el primero va a «Crea tu Genesis ID» y el
 * segundo deja la pantalla como estaba.
 */
function estadoPorCodigo(codigo: string | undefined, mensaje: string): Estado {
  if (codigo === 'PENDIENTE') return { tipo: 'pendiente' };
  if (codigo === 'GID_PENDIENTE') return { tipo: 'gidPendiente' };
  if (codigo === 'NO_VINCULADA') return { tipo: 'noVinculada' };
  if (codigo === 'SIN_WALLET') return { tipo: 'sinWallet' };
  if (codigo === 'CANCELADO' || codigo === 'SIN_GID') return { tipo: 'listo' };
  return { tipo: 'error', mensaje, codigo };
}

/**
 * Título y texto de la tarjeta de error. Los códigos con trato propio se escriben aquí (y se
 * traducen al dibujar, por si cambia el idioma con la tarjeta puesta); el resto muestra el mensaje
 * que trajo el error.
 */
function textoError(codigo: string | undefined, mensaje: string): { titulo: string; texto: string } {
  switch (codigo) {
    case 'CORREO_SIN_CONFIRMAR':
      return {
        titulo: tr('Confirma tu correo', 'Confirm your email'),
        texto: tr(
          'Tu correo todavía no está confirmado en la wallet. Abre el enlace que te mandó Orden Global y vuelve a intentar.',
          'Your email isn’t confirmed in the wallet yet. Open the link Orden Global sent you and try again.'
        ),
      };
    case 'LIMITE':
      return {
        titulo: tr('Demasiados intentos', 'Too many attempts'),
        texto: tr('Por seguridad hay que esperar un poco. Espera unos minutos y vuelve a intentar.', 'For your security, please wait a bit. Wait a few minutes and try again.'),
      };
    case 'RED':
    case 'GENESIS_CAIDO':
      return {
        titulo: tr('Genesis ID no respondió', 'Genesis ID didn’t respond'),
        texto: tr(
          'No se pudo comprobar tu identidad por un problema de conexión. Revisa tu internet y toca «Intentar de nuevo».',
          'Your identity couldn’t be checked because of a connection problem. Check your internet and tap “Try again”.'
        ),
      };
    case 'SIN_VUELTA':
      // La wallet puede seguir guardando el pedido (está sacando su Genesis ID): esta pantalla la espera.
      return {
        titulo: tr('Tu wallet todavía no respondió', 'Your wallet hasn’t answered yet'),
        texto: tr(
          'Si estás creando tu Genesis ID en la wallet, termina allá: al terminar te trae de vuelta y entras solo. Si no, toca «Intentar de nuevo».',
          'If you’re creating your Genesis ID in the wallet, finish there: when you’re done it brings you back and you’re in. Otherwise, tap “Try again”.'
        ),
      };
    case 'SIN_CONEXION':
      return {
        titulo: tr('Sin conexión con AURA', 'No connection to AURA'),
        texto: tr('Revisa tu internet y toca «Intentar de nuevo».', 'Check your internet and tap “Try again”.'),
      };
    default:
      return { titulo: tr('No se pudo entrar', 'Couldn’t sign in'), texto: mensaje };
  }
}

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
  // La entrada va siempre en vertical, también al volver aquí después de cerrar sesión.
  useFocusEffect(
    useCallback(() => {
      void orientar('vertical');
    }, [])
  );
  const tema = useTema();
  const ins = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const horizontal = width > height && width > 600;
  const inicial: Estado = route.params?.codigo
    ? estadoPorCodigo(route.params.codigo, route.params.aviso || '')
    : route.params?.aviso
      ? { tipo: 'error', mensaje: route.params.aviso }
      : { tipo: 'listo' };
  const [estado, setEstado] = useState<Estado>(inicial);
  const vivo = useRef(true);
  useEffect(() => {
    // Volvía de la wallet en un arranque en frío (Intro) sin Genesis ID: a crearlo, como en caliente.
    if (route.params?.codigo === 'SIN_GID') navigation.navigate('CrearGenesis', { motivo: 'sin-gid' });
    return () => {
      vivo.current = false;
    };
    // Solo al montar: el código del arranque se atiende una vez.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const alVolver = async (r: ResultadoGenesis) => {
    if (!vivo.current) return;
    if (estadoRef.current.tipo === 'exito') return;
    if (r.ok) {
      vibrar('exito');
      setEstado({ tipo: 'exito', nombre: r.miembro.nombre });
      // Lo que Genesis compartió (nombre completo y cumpleaños) viaja a la primera vez.
      const compartido = (r as ResultadoGenesis & { genesis?: Compartido }).genesis || null;
      setTimeout(() => void entrarCon({ name: r.miembro.nombre, role: r.miembro.rol, correo: r.miembro.correo }, compartido), 850);
      return;
    }
    if (r.codigo === 'CANCELADO') return setEstado({ tipo: 'listo' });
    if (r.codigo === 'SIN_GID') {
      setEstado({ tipo: 'listo' });
      navigation.navigate('CrearGenesis', { motivo: 'sin-gid' });
      return;
    }
    const e = estadoPorCodigo(r.codigo, r.mensaje);
    vibrar(e.tipo === 'error' ? 'error' : 'aviso');
    setEstado(e);
  };

  const entrarGenesis = async (o: OpcionesEntrada = {}) => {
    setEstado({ tipo: 'esperando' });
    try {
      await alVolver(await entrarConGenesis(o));
    } catch (e: any) {
      miga(`genesis: ${String(e?.message || e).slice(0, 80)}`);
      if (vivo.current) setEstado({ tipo: 'error', mensaje: tr('No pude entrar con Genesis ID. Prueba de nuevo.', 'Couldn’t sign in with Genesis ID. Try again.') });
    }
  };

  // La vuelta tardía de la wallet (sacó su Genesis ID con el pedido guardado): se atiende mientras esta
  // pantalla viva, también con «Crea tu Genesis ID» encima. alVolver va por ref: siempre el de ahora.
  const estadoRef = useRef(estado);
  estadoRef.current = estado;
  const alVolverRef = useRef(alVolver);
  alVolverRef.current = alVolver;
  useEffect(() => escucharVueltaTardia((r) => void alVolverRef.current(r)), []);

  // «Crea tu Genesis ID» → «Crear mi Genesis ID» / «Ya lo tengo»: pedir el pase en cuanto se vuelve aquí.
  const reintentar = route.params?.reintentar;
  useEffect(() => {
    if (reintentar && estadoRef.current.tipo !== 'esperando' && estadoRef.current.tipo !== 'exito') void entrarGenesis();
    // Solo cuando cambia el pedido de reintentar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reintentar]);

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

      {estado.tipo === 'error' && <Aviso icono="alerta" tono="aviso" {...textoError(estado.codigo, estado.mensaje)} />}
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
      {estado.tipo === 'gidPendiente' && (
        <Aviso
          icono="reloj"
          tono="acento"
          titulo={tr('Tu Genesis ID está en verificación', 'Your Genesis ID is being verified')}
          texto={tr(
            'Cuando lo aprueben, entras con este mismo botón. No hace falta crear otro.',
            'Once it’s approved, sign in with this same button. No need to create another one.'
          )}
        />
      )}
      {estado.tipo === 'sinWallet' && (
        <Aviso
          icono="wallet"
          tono="acento"
          titulo={tr('No encontramos tu wallet', 'We couldn’t find your wallet')}
          texto={tr(
            'Para entrar con tu Genesis ID necesitas la app Orden Global (tu Veta Wallet). Instálala gratis —ahí mismo creas tu Genesis ID si todavía no lo tienes— y toca «Intentar de nuevo». También puedes usar Veta Wallet en la web o entrar con tu correo.',
            'To sign in with your Genesis ID you need the Orden Global app (your Veta Wallet). Install it for free —you can create your Genesis ID right there if you don’t have one yet— and tap “Try again”. You can also use Veta Wallet on the web or sign in with your email.'
          )}
        />
      )}
      {estado.tipo === 'noVinculada' && (
        <Aviso
          icono="wallet"
          tono="acento"
          titulo={tr('Vincula tu Genesis ID a tu wallet', 'Link your Genesis ID to your wallet')}
          texto={tr(
            'Tu cuenta de la wallet todavía no está atada a un Genesis ID. Abre la app Orden Global, vincula tu Genesis ID a esa cuenta y vuelve a tocar «Intentar de nuevo».',
            'Your wallet account isn’t tied to a Genesis ID yet. Open the Orden Global app, link your Genesis ID to that account and tap “Try again”.'
          )}
        />
      )}

      <View style={{ gap: MEDIDA.espacio.m }}>
        <Boton
          titulo={
            estado.tipo === 'pendiente' || estado.tipo === 'error' || estado.tipo === 'gidPendiente' || estado.tipo === 'noVinculada' || estado.tipo === 'sinWallet'
              ? tr('Intentar de nuevo', 'Try again')
              : tr('Entrar con Genesis ID', 'Sign in with Genesis ID')
          }
          icono="huella"
          onPress={() => void entrarGenesis()}
          cargando={esperando}
          textoCargando={tr('Esperando tu wallet…', 'Waiting for your wallet…')}
          deshabilitado={estado.tipo === 'exito'}
          etiqueta={tr('Entrar con Genesis ID desde tu wallet Orden Global', 'Sign in with Genesis ID from your Orden Global wallet')}
        />
        {estado.tipo === 'sinWallet' ? (
          <>
            <Boton titulo={tr('Instalar Orden Global', 'Install Orden Global')} icono="wallet" variante="secundario" onPress={() => void abrirTiendaOrdenGlobal()} />
            <Boton titulo={tr('Usar Veta Wallet en la web', 'Use Veta Wallet on the web')} icono="globo" variante="secundario" onPress={() => void entrarGenesis({ web: true })} />
            <Boton titulo={tr('Entrar con mi correo', 'Sign in with my email')} variante="fantasma" onPress={() => navigation.navigate('OtrasFormas')} />
          </>
        ) : estado.tipo === 'noVinculada' ? (
          <Boton titulo={tr('Abrir la app Orden Global', 'Open the Orden Global app')} icono="wallet" variante="secundario" onPress={() => void abrirAppOrdenGlobal()} />
        ) : (
          // Con el Genesis ID en verificación no se ofrece crear otro: ya tiene uno, solo falta que lo aprueben.
          estado.tipo !== 'gidPendiente' && (
            <Boton titulo={tr('No tengo Genesis ID', 'I don’t have a Genesis ID')} variante="secundario" onPress={() => navigation.navigate('CrearGenesis')} deshabilitado={esperando || estado.tipo === 'exito'} />
          )
        )}
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
