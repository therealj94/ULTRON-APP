/**
 * ENTRAR: con el espíritu de la puerta de Veta Wallet / Orden Global (la marca en serif, una sola
 * acción dorada, «Protegido por Orden Global» al pie), pero aquí se entra con GENESIS ID.
 *
 *   · «Entrar con tu cuenta de Veta Wallet» (lo primero, José 5-oct: «necesito puedan poner su contraseña
 *     y entrar bien como en vetawallet.com»): correo y contraseña de la wallet, como en vetawallet.com.
 *     El TELÉFONO hace login en el backend de la wallet, pide el pase y sigue por el mismo canje que la
 *     vuelta (src/lib/genesis.ts `entrarConVetaWallet`). Sin Genesis ID entra igual, como miembro «Veta
 *     Wallet» (docs/ENTRAR-GENESIS.md caso f; sin chat por ese camino). La contraseña va directo a la
 *     wallet: nunca al servidor de AU-RA; no se guarda y se borra del estado al terminar. Errores debajo del formulario;
 *     los casos con tarjeta propia (sin Genesis ID, en verificación, sin vincular, en revisión) van a la
 *     misma tarjeta que el camino de la wallet. «¿Olvidaste tu contraseña?» pide el enlace a la wallet
 *     (o abre su web), y «¿No tienes cuenta?» abre la web de la wallet con el pedido de AU-RA: ahí se crea
 *     la cuenta y el Genesis ID y vuelve sola.
 *   · «Abrir mi wallet» (src/lib/genesis.ts): la wallet de la persona —la app Orden Global o la
 *     web de Veta Wallet— pide permiso y devuelve un pase que solo este teléfono puede canjear.
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
import { ScrollView, StyleSheet, View, useWindowDimensions, type TextInput } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useFocusEffect } from '@react-navigation/native';
import { orientar } from '../../lib/orientacion';
import { APP_VERSION } from '../../config';
import { entrarConGenesis, entrarConVetaWallet, escucharVueltaTardia, recuperarClaveWallet, type OpcionesEntrada, type ResultadoGenesis } from '../../lib/genesis';
import { WALLET_WEB, correoValido } from '../../lib/entrarConClave';
import { abrirAppOrdenGlobal, abrirTiendaOrdenGlobal } from './CrearGenesis';
import { miga } from '../../lib/reporte';
import { registrarTrabajoActivo } from '../../lib/barreraOta';
import { tr, useIdioma } from '../../i18n';
import { MEDIDA, useTema } from '../../nucleo/tema';
import { Aparecer, Aura, Boton, BotonCheck, Campo, Icono, SelectorIdioma, Texto, vibrar, type NombreIcono } from '../../ui';
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
 * Los resultados de la entrada con clave que siguen el trato de siempre (`alVolver`): entrar, las
 * tarjetas propias y «Crea tu Genesis ID». Los demás son errores del formulario y se dicen debajo de él.
 */
const CON_TRATO = new Set(['PENDIENTE', 'GID_PENDIENTE', 'NO_VINCULADA', 'SIN_GID', 'CANCELADO', 'VENCIDO']);

/** El error de la entrada con clave: debajo de un campo (`campo`) o del formulario. */
type ErrorClave = { campo?: 'correo' | 'clave'; mensaje: string };

/** La web de Veta Wallet en una pestaña segura (su puerta, sin sesión, es el login con «¿Olvidaste…?»). */
const abrirWalletWeb = () => WebBrowser.openBrowserAsync(WALLET_WEB, { showTitle: true, enableBarCollapsing: true }).catch(() => {});

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
    // Otra entrada la reemplazó (lib/intentoEntrada.ts): esta no tiene nada que decir; solo deja de esperar.
    if (!r.ok && r.codigo === 'VENCIDO') {
      if (estadoRef.current.tipo === 'esperando') setEstado({ tipo: 'listo' });
      return;
    }
    if (r.ok) {
      vibrar('exito');
      setEstado({ tipo: 'exito', nombre: r.miembro.nombre });
      // Lo que Genesis compartió (nombre completo y cumpleaños) viaja a la primera vez.
      const compartido = (r as ResultadoGenesis & { genesis?: Compartido }).genesis || null;
      // Con su intento: si en estos 850 ms empezó otra entrada, esta no fija a nadie.
      setTimeout(() => void entrarCon({ name: r.miembro.nombre, role: r.miembro.rol, correo: r.miembro.correo }, compartido, r.intento), 850);
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

  // ── Entrar con la cuenta de Veta Wallet (correo y contraseña) ──────────────────────────────────────
  const [correo, setCorreo] = useState('');
  const [clave, setClave] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [recuperando, setRecuperando] = useState(false);
  const [errorClave, setErrorClave] = useState<ErrorClave | null>(null);
  const [avisoCorreo, setAvisoCorreo] = useState<string | null>(null);
  const refClave = useRef<TextInput>(null);
  // Un solo envío a la vez aunque el «go» del teclado y el botón lleguen juntos.
  const enviandoRef = useRef(false);
  /** Cuándo escribió por última vez en el formulario (0 si está vacío): la OTA no recarga encima. */
  const escritoEn = useRef(0);

  const entrarClave = async () => {
    if (enviandoRef.current || estadoRef.current.tipo === 'esperando' || estadoRef.current.tipo === 'exito') return;
    const c = correo.trim();
    if (!correoValido(c)) return setErrorClave({ campo: 'correo', mensaje: tr('Escribe el correo de tu cuenta de Veta Wallet.', 'Enter the email of your Veta Wallet account.') });
    if (!clave) {
      refClave.current?.focus();
      return setErrorClave({ campo: 'clave', mensaje: tr('Escribe tu contraseña de Veta Wallet.', 'Enter your Veta Wallet password.') });
    }
    enviandoRef.current = true;
    setEnviando(true);
    setErrorClave(null);
    setAvisoCorreo(null);
    // Las tarjetas de un intento anterior se quitan: esta es otra entrada.
    if (estadoRef.current.tipo !== 'listo') setEstado({ tipo: 'listo' });
    try {
      const r = await entrarConVetaWallet(c, clave);
      if (!vivo.current) return;
      if (r.ok || CON_TRATO.has(r.codigo)) await alVolver(r);
      else {
        vibrar('error');
        setErrorClave({ mensaje: r.mensaje });
      }
    } catch (e: any) {
      // Solo el nombre del error: nada de lo escrito sale a los registros.
      miga(`clave wallet: ${String(e?.name || 'error').slice(0, 40)}`);
      if (vivo.current) setErrorClave({ mensaje: tr('No pude entrar con tu cuenta de Veta Wallet. Prueba de nuevo.', 'I couldn’t sign in with your Veta Wallet account. Try again.') });
    } finally {
      enviandoRef.current = false;
      // La contraseña no se queda en la pantalla: se usó una vez y se borra (también si falló).
      if (vivo.current) {
        setClave('');
        setEnviando(false);
      }
    }
  };

  // «¿Olvidaste tu contraseña?»: con el correo escrito, la wallet le manda el enlace (lo mismo que su web);
  // sin correo, o si la wallet no contesta, su web, donde está la misma opción.
  const olvide = async () => {
    const c = correo.trim();
    setErrorClave(null);
    setAvisoCorreo(null);
    if (!correoValido(c)) return void abrirWalletWeb();
    setRecuperando(true);
    const ok = await recuperarClaveWallet(c);
    if (!vivo.current) return;
    setRecuperando(false);
    if (!ok) return void abrirWalletWeb();
    setAvisoCorreo(c);
  };

  // La vuelta tardía de la wallet (sacó su Genesis ID con el pedido guardado): se atiende mientras esta
  // pantalla viva, también con «Crea tu Genesis ID» encima. alVolver va por ref: siempre el de ahora.
  const estadoRef = useRef(estado);
  estadoRef.current = estado;
  // Entrando (revisión del 5-oct): con algo escrito (la hora del último toque: caduca como un borrador, ver
  // lib/barreraOta.ts), enviando o esperando a la wallet, la actualización por aire no recarga encima, ni
  // al abrir la app (`arranque`). La entrada con la wallet en curso la frena también lib/genesis.ts.
  useEffect(() => registrarTrabajoActivo('entrando', () => (enviandoRef.current || estadoRef.current.tipo === 'esperando' ? true : escritoEn.current || false)), []);
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
  // Mientras se entra por un camino, el otro espera (y nada se toca con la palomita puesta).
  const ocupado = esperando || enviando || estado.tipo === 'exito';
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
                'Con tu cuenta de Veta Wallet, la misma de vetawallet.com. Si tienes Genesis ID, AURA lo reconoce.',
                'With your Veta Wallet account, the same as on vetawallet.com. If you have a Genesis ID, AURA recognizes it.'
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
            'Tu Genesis ID es válido y tu solicitud ya llegó. Cuando la aprueben, vuelve a entrar aquí.',
            'Your Genesis ID is valid and your request arrived. Once approved, sign in here again.'
          )}
        />
      )}
      {estado.tipo === 'gidPendiente' && (
        <Aviso
          icono="reloj"
          tono="acento"
          titulo={tr('Tu Genesis ID está en verificación', 'Your Genesis ID is being verified')}
          texto={tr(
            'Cuando lo aprueben, vuelve a entrar aquí. No hace falta crear otro.',
            'Once it’s approved, sign in here again. No need to create another one.'
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

      {/* Entrar con la cuenta de Veta Wallet: correo y contraseña, como en vetawallet.com. */}
      {estado.tipo !== 'exito' && (
        <View style={{ gap: MEDIDA.espacio.m }}>
          <Texto v="subtitulo" accessibilityRole="header">
            {tr('Entrar con tu cuenta de Veta Wallet', 'Sign in with your Veta Wallet account')}
          </Texto>
          <Campo
            etiqueta={tr('Correo', 'Email')}
            value={correo}
            onChangeText={(t) => {
              setCorreo(t);
              escritoEn.current = t || clave ? Date.now() : 0;
              if (errorClave) setErrorClave(null);
            }}
            placeholder={tr('tu@correo.com', 'you@email.com')}
            keyboardType="email-address"
            autoComplete="email"
            textContentType="emailAddress"
            importantForAutofill="yes"
            returnKeyType="next"
            submitBehavior="submit"
            onSubmitEditing={() => refClave.current?.focus()}
            editable={!ocupado}
            error={errorClave?.campo === 'correo' ? errorClave.mensaje : undefined}
            accessibilityLabel={tr('Correo de tu cuenta de Veta Wallet', 'Email of your Veta Wallet account')}
          />
          <Campo
            ref={refClave}
            etiqueta={tr('Contraseña', 'Password')}
            clave
            value={clave}
            onChangeText={(t) => {
              setClave(t);
              escritoEn.current = t || correo ? Date.now() : 0;
              if (errorClave) setErrorClave(null);
            }}
            autoComplete="password"
            textContentType="password"
            importantForAutofill="yes"
            returnKeyType="go"
            onSubmitEditing={() => void entrarClave()}
            editable={!ocupado}
            error={errorClave?.campo === 'clave' ? errorClave.mensaje : undefined}
            accessibilityLabel={tr('Contraseña de tu cuenta de Veta Wallet', 'Password of your Veta Wallet account')}
            accessibilityHint={tr('Va directo a Veta Wallet. AURA no la guarda.', 'It goes straight to Veta Wallet. AURA doesn’t keep it.')}
          />
          {!!errorClave && !errorClave.campo && <Aviso icono="alerta" tono="aviso" titulo={tr('No se pudo entrar', 'Couldn’t sign in')} texto={errorClave.mensaje} />}
          {!!avisoCorreo && (
            <Aviso
              icono="correo"
              tono="acento"
              titulo={tr('Revisa tu correo', 'Check your email')}
              texto={tr(
                `Si ${avisoCorreo} tiene cuenta en Veta Wallet, te mandamos un enlace para poner una contraseña nueva. Ábrelo, cámbiala y vuelve aquí a entrar.`,
                `If ${avisoCorreo} has a Veta Wallet account, we sent a link to set a new password. Open it, change it and come back here to sign in.`
              )}
            />
          )}
          <Boton
            titulo={tr('Entrar', 'Sign in')}
            icono="candado"
            onPress={() => void entrarClave()}
            cargando={enviando}
            textoCargando={tr('Entrando con Veta Wallet…', 'Signing in with Veta Wallet…')}
            deshabilitado={ocupado}
            etiqueta={tr('Entrar con tu cuenta de Veta Wallet', 'Sign in with your Veta Wallet account')}
          />
          <View style={s.enlaces}>
            <Boton
              titulo={tr('¿Olvidaste tu contraseña?', 'Forgot your password?')}
              variante="fantasma"
              tam="chico"
              onPress={() => void olvide()}
              cargando={recuperando}
              deshabilitado={ocupado}
              etiqueta={tr('¿Olvidaste tu contraseña de Veta Wallet? Te mandamos un enlace a tu correo', 'Forgot your Veta Wallet password? We’ll email you a link')}
            />
            <Boton
              titulo={tr('¿No tienes cuenta? Créala en Veta Wallet', 'No account? Create one in Veta Wallet')}
              variante="fantasma"
              tam="chico"
              onPress={() => void entrarGenesis({ web: true })}
              deshabilitado={ocupado}
              etiqueta={tr('Crear tu cuenta en la web de Veta Wallet; al terminar vuelves a AURA', 'Create your account on the Veta Wallet website; when you’re done you come back to AURA')}
            />
          </View>
        </View>
      )}

      {estado.tipo !== 'exito' && (
        <View style={s.separador} accessible={false}>
          <View style={[s.linea, { backgroundColor: tema.borde }]} />
          <Texto v="chica" color="texto3">
            {tr('o con tu wallet', 'or with your wallet')}
          </Texto>
          <View style={[s.linea, { backgroundColor: tema.borde }]} />
        </View>
      )}

      <View style={{ gap: MEDIDA.espacio.m }}>
        <Boton
          titulo={estado.tipo === 'error' || estado.tipo === 'sinWallet' ? tr('Intentar de nuevo', 'Try again') : tr('Abrir mi wallet', 'Open my wallet')}
          icono="huella"
          variante="secundario"
          onPress={() => void entrarGenesis()}
          cargando={esperando}
          textoCargando={tr('Esperando tu wallet…', 'Waiting for your wallet…')}
          deshabilitado={estado.tipo === 'exito' || enviando}
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
            <Boton titulo={tr('No tengo Genesis ID', 'I don’t have a Genesis ID')} variante="fantasma" onPress={() => navigation.navigate('CrearGenesis')} deshabilitado={ocupado} />
          )
        )}
      </View>

      <View style={s.confianza}>
        <Icono nombre="candado" tam={15} color={tema.texto3} />
        <Texto v="chica" color="texto3" style={{ flex: 1 }}>
          {tr(
            'Tu contraseña va directo de este teléfono a Veta Wallet: el servidor de AURA nunca la ve y no se guarda.',
            'Your password goes straight from this phone to Veta Wallet: the AURA server never sees it and it isn’t stored.'
          )}
        </Texto>
      </View>

      <Boton titulo={tr('Otras formas de entrar', 'Other ways to sign in')} variante="fantasma" tam="chico" onPress={() => navigation.navigate('OtrasFormas')} deshabilitado={ocupado} style={{ alignSelf: horizontal ? 'flex-start' : 'center' }} />
    </View>
  );

  return (
    <View style={[s.raiz, { backgroundColor: tema.fondo }]}>
      <ScrollView
        contentContainerStyle={[s.contenido, { paddingTop: ins.top + (horizontal ? 20 : 64), paddingBottom: ins.bottom + 20 }, horizontal && s.contenidoH]}
        showsVerticalScrollIndicator={false}
        bounces={false}
        keyboardShouldPersistTaps="handled"
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
  enlaces: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', columnGap: 4 },
  separador: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  linea: { flex: 1, height: StyleSheet.hairlineWidth },
});
