/**
 * ENTRAR: con el espíritu de la puerta de Veta Wallet / Orden Global (la marca en serif, una sola acción dorada,
 * «Protegido por Orden Global» al pie). Dos vistas en la misma pantalla (José, 11-oct: «que se mire bien, que no se
 * confunda, que se vea nativo, que no fallemos en lo principal»):
 *
 * LA CUENTA DE AU-RA, lo que se ve al abrir (José, 10-oct: «nadie normal puede entrar»):
 *   · correo + contraseña (con el ojito) + «¿Olvidaste tu contraseña?» pegado a la derecha + «Entrar», el único botón
 *     dorado → POST /api/ultron/entrar (lib/api.ts loginClave). Errores debajo del campo o del formulario, precisos:
 *     contraseña mala ≠ sin conexión ≠ servidor ocupado (lib/cuentaPropia.ts errorDeEntrada).
 *   · «Crear cuenta» justo debajo → su pantalla (CrearCuenta.tsx): nombre, correo y contraseña; el código del correo.
 *   · «o» y UNA puerta: «Continuar con Veta Wallet». Al pie, chiquito, «Otras formas de entrar» (la huella, la cuenta
 *     guardada en este teléfono y el modo local).
 *
 * LA VISTA DE VETA WALLET (flecha atrás o el «atrás» de Android vuelven a la cuenta):
 *   · la cuenta de Veta Wallet (correo y contraseña; su botón es el dorado de esta vista). El TELÉFONO hace login en
 *     la wallet, intenta el pase de Genesis ID y, si no hay pase o AU-RA no lo acepta (el «pase no válido» del 10-oct),
 *     entra igual como miembro «Veta Wallet» (lib/entrarConClave.ts, 4b y 4c). La contraseña va directo a la wallet:
 *     nunca al servidor de AU-RA; se borra del estado al terminar.
 *   · «Abrir Orden Global» (src/lib/genesis.ts): la wallet pide permiso y devuelve un pase que solo este teléfono
 *     puede canjear («Esperando tu wallet…»). Sus casos tienen tarjeta propia y, vengan de donde vengan, se ven en
 *     esta vista (`esDeWallet`): PENDIENTE, GID_PENDIENTE, NO_VINCULADA, SIN_WALLET (con «Instalar Orden Global» y
 *     «Usar Veta Wallet en la web»), CORREO_SIN_CONFIRMAR, LIMITE, RED; SIN_GID o «No tengo Genesis ID» → «Crea tu
 *     Genesis ID». La vuelta TARDÍA de la wallet se escucha mientras la pantalla está montada; `reintentar` (lo manda
 *     «Crea tu Genesis ID») pide el pase.
 *   · «Crear cuenta en Veta Wallet»: la web de la wallet con el pedido de AU-RA (`#sso-aura`): ahí se crea la cuenta
 *     y vuelve sola.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { BackHandler, ScrollView, StyleSheet, View, useWindowDimensions, type TextInput } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useFocusEffect } from '@react-navigation/native';
import { orientar } from '../../lib/orientacion';
import { APP_VERSION } from '../../config';
import { entrarConGenesis, entrarConVetaWallet, escucharVueltaTardia, recuperarClaveWallet, type OpcionesEntrada, type ResultadoGenesis } from '../../lib/genesis';
import { WALLET_WEB, correoValido } from '../../lib/entrarConClave';
import { loginClave, olvideClave } from '../../lib/api';
import { errorDeEntrada, validarEntrada, type ErrorCuenta } from '../../lib/cuentaPropia';
import { cancelarIntento, empezarIntento, esVencida, type Intento } from '../../lib/intentoEntrada';
import { abrirAppOrdenGlobal, abrirTiendaOrdenGlobal } from './CrearGenesis';
import { pedirCodigoPara } from './CrearCuenta';
import { miga } from '../../lib/reporte';
import { registrarTrabajoActivo } from '../../lib/barreraOta';
import { tr, useIdioma } from '../../i18n';
import { MEDIDA, useTema } from '../../nucleo/tema';
import { Aparecer, Aura, Boton, BotonCheck, BotonRedondo, Campo, Icono, SelectorIdioma, Texto, vibrar, type NombreIcono } from '../../ui';
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

/** Lo que solo tiene sentido en la vista de Veta Wallet: sus tarjetas, la espera y los errores con código. */
function esDeWallet(e: Estado): boolean {
  return e.tipo === 'esperando' || e.tipo === 'pendiente' || e.tipo === 'gidPendiente' || e.tipo === 'noVinculada' || e.tipo === 'sinWallet' || (e.tipo === 'error' && !!e.codigo);
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
        titulo: tr('Sin conexión con AU-RA', 'No connection to AU-RA'),
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
  // Dos vistas en la misma pantalla (José, 11-oct: «que se mire bien, no se confunda, se vea nativo»): la cuenta de
  // AU-RA (lo principal: correo, contraseña, Entrar, Crear cuenta) y, detrás de UNA puerta, todo lo de Veta Wallet.
  const [vista, setVista] = useState<'cuenta' | 'wallet'>(() => (esDeWallet(inicial) ? 'wallet' : 'cuenta'));
  const abrirVista = (v: 'cuenta' | 'wallet') => {
    if (estadoRef.current.tipo === 'exito') return;
    // De vuelta a la cuenta, las tarjetas y la espera de la wallet se quitan (si la wallet contesta tarde, igual entra:
    // escucharVueltaTardia sigue puesto).
    if (v === 'cuenta' && esDeWallet(estadoRef.current)) {
      // La espera en curso ya no manda: si contesta tarde con un error, no regresa a la wallet.
      esperaGenesis.current++;
      setEstado({ tipo: 'listo' });
    }
    setVista(v);
    setErrorA(null);
    setErrorClave(null);
  };
  const abrirVistaRef = useRef(abrirVista);
  abrirVistaRef.current = abrirVista;
  // Lo que dice la wallet o Genesis ID (su tarjeta, sus botones) se ve en su vista, venga de donde venga.
  useEffect(() => {
    if (esDeWallet(estado)) setVista('wallet');
  }, [estado]);
  // El «atrás» de Android en la vista de la wallet vuelve a la cuenta de AU-RA (no cierra la app).
  useEffect(() => {
    if (vista !== 'wallet') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      abrirVistaRef.current('cuenta');
      return true;
    });
    return () => sub.remove();
  }, [vista]);
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

  /**
   * El número de la espera de Genesis vigente: solo la última puede cambiar la pantalla. Si la persona vuelve a la
   * cuenta de AU-RA, entra por otro camino o pide otra espera, el resultado tardío de la anterior (p. ej. SIN_VUELTA a
   * los minutos) ya no la arrastra a la vista de la wallet ni le tapa un error del formulario (revisión del 11-oct).
   * Un pase bueno sigue entrando: entrarCon valida su intento, y las vueltas tardías siguen por escucharVueltaTardia.
   */
  const esperaGenesis = useRef(0);
  const entrarGenesis = async (o: OpcionesEntrada = {}) => {
    const n = ++esperaGenesis.current;
    setEstado({ tipo: 'esperando' });
    try {
      const r = await entrarConGenesis(o);
      if (n !== esperaGenesis.current && !r.ok) return;
      await alVolver(r);
    } catch (e: any) {
      miga(`genesis: ${String(e?.message || e).slice(0, 80)}`);
      // Con código: se dice en la vista de la wallet, no debajo de «Entra a AU-RA».
      if (vivo.current && n === esperaGenesis.current) setEstado({ tipo: 'error', codigo: 'GENESIS_FALLO', mensaje: tr('No pude entrar con Genesis ID. Prueba de nuevo.', 'Couldn’t sign in with Genesis ID. Try again.') });
    }
  };

  // ── Lo primero: la cuenta de AU-RA (correo y contraseña) ──────────────────────────────────────────────
  const [correoA, setCorreoA] = useState('');
  const [claveA, setClaveA] = useState('');
  const [entrandoA, setEntrandoA] = useState(false);
  const [recuperandoA, setRecuperandoA] = useState(false);
  const [errorA, setErrorA] = useState<ErrorCuenta | null>(null);
  const [avisoOlvideA, setAvisoOlvideA] = useState<string | null>(null);
  const refClaveA = useRef<TextInput>(null);
  const refCorreoA = useRef<TextInput>(null);
  const entrandoARef = useRef(false);
  /** El intento de la entrada con la cuenta de AU-RA (lib/intentoEntrada.ts): si la pantalla se va, se cancela. */
  const intentoA = useRef<Intento | null>(null);
  useEffect(
    () => () => {
      if (estadoRef.current.tipo !== 'exito') cancelarIntento(intentoA.current);
    },
    []
  );

  const entrarCuenta = async () => {
    if (entrandoARef.current || enviandoRef.current || estadoRef.current.tipo === 'esperando' || estadoRef.current.tipo === 'exito') return;
    const c = correoA.trim();
    const e = validarEntrada({ correo: c, clave: claveA });
    if (e) {
      if (e.campo === 'clave') refClaveA.current?.focus();
      return setErrorA(e);
    }
    entrandoARef.current = true;
    esperaGenesis.current++;
    setEntrandoA(true);
    setErrorA(null);
    setAvisoOlvideA(null);
    if (estadoRef.current.tipo !== 'listo') setEstado({ tipo: 'listo' });
    const i = empezarIntento();
    intentoA.current = i;
    const clave = claveA;
    try {
      const d = await loginClave(c, clave, i);
      if (!vivo.current) return;
      if (!d?.token) throw Object.assign(new Error('sin token'), { status: 500, data: {} });
      const nombre = d.miembro?.nombre || c.split('@')[0];
      vibrar('exito');
      setEstado({ tipo: 'exito', nombre });
      const u = { name: nombre, role: d.miembro?.rol || '', correo: d.miembro?.correo || c.toLowerCase() };
      setTimeout(() => void entrarCon(u, null, i), 850);
    } catch (err: any) {
      // Otra entrada la reemplazó: no hay nada que decir.
      if (esVencida(err) || !vivo.current) return;
      // Cuenta propia con el correo sin confirmar: sin sesión; el servidor mandó el código y se pide aquí mismo.
      if (err?.status === 403 && err?.data?.codigo === 'CORREO_SIN_CONFIRMAR') {
        cancelarIntento(i);
        // Solo si el código salió (server.ts manda `confirmacion`): sin código no tiene caso la pantalla del código.
        const conf = err?.data?.confirmacion;
        if (conf && conf !== 'enviado' && conf !== 'espera') {
          vibrar('error');
          setErrorA({
            codigo: 'CORREO_SIN_CONFIRMAR',
            mensaje:
              err?.data?.error ||
              tr(
                'Confirma tu correo para entrar, pero ahora no pudimos enviarte el código. Entra con Veta Wallet u Orden Global, o inténtalo más tarde.',
                'Confirm your email to sign in, but we couldn’t send you the code right now. Sign in with Veta Wallet or Orden Global, or try again later.'
              ),
          });
          return;
        }
        pedirCodigoPara(c, clave);
        navigation.navigate('CrearCuenta', { correo: c, paso: 'codigo' });
        return;
      }
      miga(`cuenta aura: ${String(err?.status || err?.name || 'error').slice(0, 20)}`);
      vibrar('error');
      const ec = errorDeEntrada(err);
      if (ec.campo === 'clave') refClaveA.current?.focus();
      setErrorA(ec);
    } finally {
      entrandoARef.current = false;
      // La contraseña no se queda en la pantalla: se usó una vez y se borra (también si falló).
      if (vivo.current) {
        setClaveA('');
        setEntrandoA(false);
      }
    }
  };

  // «¿Olvidaste tu contraseña?» de la cuenta de AU-RA: el enlace de 30 minutos a ese correo (lo mismo que la web).
  const olvideCuenta = async () => {
    const c = correoA.trim();
    setErrorA(null);
    setAvisoOlvideA(null);
    if (!correoValido(c)) {
      refCorreoA.current?.focus();
      return setErrorA({ campo: 'correo', mensaje: tr('Escribe tu correo y te mandamos un enlace para poner una contraseña nueva.', 'Enter your email and we’ll send you a link to set a new password.') });
    }
    setRecuperandoA(true);
    try {
      const m = await olvideClave(c);
      if (vivo.current) setAvisoOlvideA(m);
    } catch (err: any) {
      // Aquí un 400/401 no es «contraseña mala»: el servidor no pudo mandar el enlace.
      if (vivo.current) setErrorA(errorDeEntrada(Number(err?.status) ? { status: 503, data: err?.data } : err));
    } finally {
      if (vivo.current) setRecuperandoA(false);
    }
  };

  // ── Opción: entrar con la cuenta de Veta Wallet (correo y contraseña) ─────────────────────────────────
  const [verWallet, setVerWallet] = useState(false);
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
    if (enviandoRef.current || entrandoARef.current || estadoRef.current.tipo === 'esperando' || estadoRef.current.tipo === 'exito') return;
    const c = correo.trim();
    if (!correoValido(c)) return setErrorClave({ campo: 'correo', mensaje: tr('Escribe el correo de tu cuenta de Veta Wallet.', 'Enter the email of your Veta Wallet account.') });
    if (!clave) {
      refClave.current?.focus();
      return setErrorClave({ campo: 'clave', mensaje: tr('Escribe tu contraseña de Veta Wallet.', 'Enter your Veta Wallet password.') });
    }
    enviandoRef.current = true;
    esperaGenesis.current++;
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
  useEffect(() => registrarTrabajoActivo('entrando', () => (enviandoRef.current || entrandoARef.current || estadoRef.current.tipo === 'esperando' ? true : escritoEn.current || false)), []);
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
  // Mientras se entra por un camino, los otros esperan (y nada se toca con la palomita puesta).
  const ocupado = esperando || enviando || entrandoA || estado.tipo === 'exito';
  // Chica en vertical: el formulario entero cabe en la pantalla sin bajar (en la vista de la wallet, más chica aún).
  const tamAura = horizontal ? Math.min(240, height * 0.5) : Math.min(vista === 'wallet' ? 96 : 150, width * 0.4, height * 0.18);

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
      <Texto v="etiqueta" color="acentoTexto" centro={!horizontal} style={{ marginTop: MEDIDA.espacio.s }}>
        AU-RA
      </Texto>
      {/* Acostado, el idioma va debajo de la marca para no pisar el título. */}
      {horizontal && (
        <View style={{ marginTop: MEDIDA.espacio.l }}>
          <SelectorIdioma />
        </View>
      )}
    </View>
  );

  /** Los avisos de las opciones (wallet / Genesis): con su tarjeta, debajo del título. */
  const avisos = (
    <>
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
            'Mientras tanto puedes entrar con tu cuenta de AU-RA o con tu cuenta de Veta Wallet.',
            'Meanwhile you can sign in with your AU-RA account or your Veta Wallet account.'
          )}
        />
      )}
      {estado.tipo === 'sinWallet' && (
        <Aviso
          icono="wallet"
          tono="acento"
          titulo={tr('No encontramos la app Orden Global', 'We couldn’t find the Orden Global app')}
          texto={tr(
            'No hace falta: entra con tu correo y tu contraseña arriba, o crea tu cuenta. Si prefieres tu wallet, instálala o usa Veta Wallet en la web.',
            'You don’t need it: sign in with your email and password above, or create your account. If you prefer your wallet, install it or use Veta Wallet on the web.'
          )}
        />
      )}
      {estado.tipo === 'noVinculada' && (
        <Aviso
          icono="wallet"
          tono="acento"
          titulo={tr('Vincula tu Genesis ID a tu wallet', 'Link your Genesis ID to your wallet')}
          texto={tr(
            'Tu cuenta de la wallet todavía no está atada a un Genesis ID. Abre la app Orden Global, vincula tu Genesis ID a esa cuenta y vuelve a intentar. También puedes entrar con tu cuenta de AU-RA.',
            'Your wallet account isn’t tied to a Genesis ID yet. Open the Orden Global app, link your Genesis ID to that account and try again. You can also sign in with your AU-RA account.'
          )}
        />
      )}
    </>
  );

  /** Los avisos de la wallet y de Genesis ID (tarjeta propia): solo en la vista de Veta Wallet. */
  const enWallet = vista === 'wallet';

  const cuerpoCuenta = (
    <View style={[s.cuerpo, horizontal && s.cuerpoH]}>
      <View style={{ gap: 6 }}>
        <Texto v="heroe" centro={!horizontal} accessibilityRole="header">
          {estado.tipo === 'exito' ? `${tr('¡Hola', 'Hi')}, ${estado.nombre}!` : tr('Entra a AU-RA', 'Sign in to AU-RA')}
        </Texto>
        <Texto v="cuerpo" color="texto2" centro={!horizontal}>
          {estado.tipo === 'exito' ? tr('Listo: ya estás dentro.', 'Done: you’re in.') : tr('Con tu correo y tu contraseña.', 'With your email and password.')}
        </Texto>
      </View>

      {/* Un aviso que trajo la navegación (p. ej. la sesión venció) se dice aquí; los de la wallet, en su vista. */}
      {estado.tipo === 'error' && !estado.codigo && <Aviso icono="alerta" tono="aviso" {...textoError(estado.codigo, estado.mensaje)} />}

      {/* LO PRIMERO: la cuenta de AU-RA. */}
      {estado.tipo !== 'exito' && (
        <View style={{ gap: MEDIDA.espacio.m }}>
          <Campo
            ref={refCorreoA}
            etiqueta={tr('Correo', 'Email')}
            value={correoA}
            onChangeText={(t) => {
              setCorreoA(t);
              escritoEn.current = t || claveA ? Date.now() : 0;
              if (errorA) setErrorA(null);
            }}
            placeholder={tr('tu@correo.com', 'you@email.com')}
            keyboardType="email-address"
            autoCapitalize="none"
            autoComplete="email"
            textContentType="username"
            importantForAutofill="yes"
            returnKeyType="next"
            submitBehavior="submit"
            onSubmitEditing={() => refClaveA.current?.focus()}
            editable={!ocupado}
            error={errorA?.campo === 'correo' ? errorA.mensaje : undefined}
            accessibilityLabel={tr('Correo de tu cuenta de AU-RA', 'Email of your AU-RA account')}
          />
          <View>
            <Campo
              ref={refClaveA}
              etiqueta={tr('Contraseña', 'Password')}
              clave
              value={claveA}
              onChangeText={(t) => {
                setClaveA(t);
                escritoEn.current = t || correoA ? Date.now() : 0;
                if (errorA) setErrorA(null);
              }}
              autoComplete="password"
              textContentType="password"
              importantForAutofill="yes"
              returnKeyType="go"
              onSubmitEditing={() => void entrarCuenta()}
              editable={!ocupado}
              error={errorA?.campo === 'clave' ? errorA.mensaje : undefined}
              accessibilityLabel={tr('Contraseña de tu cuenta de AU-RA', 'Password of your AU-RA account')}
            />
            {/* Como en las apps del teléfono: el «¿Olvidaste…?» pegado a la contraseña, a la derecha. */}
            <Boton
              titulo={tr('¿Olvidaste tu contraseña?', 'Forgot your password?')}
              variante="fantasma"
              tam="chico"
              onPress={() => void olvideCuenta()}
              cargando={recuperandoA}
              deshabilitado={ocupado}
              style={{ alignSelf: 'flex-end', marginTop: 2, marginRight: -6 }}
              etiqueta={tr('¿Olvidaste tu contraseña de AU-RA? Te mandamos un enlace a tu correo', 'Forgot your AU-RA password? We’ll email you a link')}
            />
          </View>
          {!!errorA && !errorA.campo && <Aviso icono="alerta" tono="aviso" titulo={tr('No se pudo entrar', 'Couldn’t sign in')} texto={errorA.mensaje} />}
          {!!avisoOlvideA && <Aviso icono="correo" tono="acento" titulo={tr('Revisa tu correo', 'Check your email')} texto={avisoOlvideA} />}
          <Boton
            titulo={tr('Entrar', 'Sign in')}
            onPress={() => void entrarCuenta()}
            cargando={entrandoA}
            textoCargando={tr('Entrando…', 'Signing in…')}
            deshabilitado={ocupado}
            etiqueta={tr('Entrar con tu correo y tu contraseña de AU-RA', 'Sign in with your AU-RA email and password')}
          />
          <Boton
            titulo={tr('Crear cuenta', 'Create account')}
            variante="secundario"
            onPress={() => navigation.navigate('CrearCuenta', correoValido(correoA.trim()) ? { correo: correoA.trim() } : undefined)}
            deshabilitado={ocupado}
            etiqueta={tr('Crear tu cuenta de AU-RA: te mandamos un código a tu correo', 'Create your AU-RA account: we’ll email you a code')}
          />
        </View>
      )}

      {estado.tipo !== 'exito' && (
        <>
          <View style={s.separador} accessible={false}>
            <View style={[s.linea, { backgroundColor: tema.borde }]} />
            <Texto v="chica" color="texto3">
              {tr('o', 'or')}
            </Texto>
            <View style={[s.linea, { backgroundColor: tema.borde }]} />
          </View>
          {/* LA OPCIÓN, una sola puerta: todo lo de la wallet vive en su vista. */}
          <Boton
            titulo={tr('Continuar con Veta Wallet', 'Continue with Veta Wallet')}
            icono="wallet"
            variante="secundario"
            onPress={() => abrirVista('wallet')}
            deshabilitado={ocupado}
            etiqueta={tr('Entrar con tu cuenta de Veta Wallet o con la app Orden Global', 'Sign in with your Veta Wallet account or the Orden Global app')}
          />
        </>
      )}

      <Boton titulo={tr('Otras formas de entrar', 'Other ways to sign in')} variante="fantasma" tam="chico" onPress={() => navigation.navigate('OtrasFormas')} deshabilitado={ocupado} style={{ alignSelf: horizontal ? 'flex-start' : 'center' }} />
    </View>
  );

  const cuerpoWallet = (
    <View style={[s.cuerpo, horizontal && s.cuerpoH]}>
      <View style={s.filaVolver}>
        <BotonRedondo onPress={() => abrirVista('cuenta')} etiqueta={tr('Volver a entrar con tu correo de AU-RA', 'Back to signing in with your AU-RA email')} />
      </View>
      <View style={{ gap: 6 }}>
        <Texto v="heroe" centro={!horizontal} accessibilityRole="header">
          {estado.tipo === 'exito' ? `${tr('¡Hola', 'Hi')}, ${estado.nombre}!` : 'Veta Wallet'}
        </Texto>
        <Texto v="cuerpo" color="texto2" centro={!horizontal}>
          {estado.tipo === 'exito'
            ? tr('Listo: ya estás dentro.', 'Done: you’re in.')
            : tr('Entra con tu cuenta de Veta Wallet o con tu app Orden Global.', 'Sign in with your Veta Wallet account or your Orden Global app.')}
        </Texto>
      </View>

      {avisos}

      {estado.tipo !== 'exito' && (
        <View style={{ gap: MEDIDA.espacio.m }}>
          <Campo
            etiqueta={tr('Correo de Veta Wallet', 'Veta Wallet email')}
            value={correo}
            onChangeText={(t) => {
              setCorreo(t);
              escritoEn.current = t || clave ? Date.now() : 0;
              if (errorClave) setErrorClave(null);
            }}
            placeholder={tr('tu@correo.com', 'you@email.com')}
            keyboardType="email-address"
            autoCapitalize="none"
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
          <View>
            <Campo
              ref={refClave}
              etiqueta={tr('Contraseña de Veta Wallet', 'Veta Wallet password')}
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
              accessibilityHint={tr('Va directo a Veta Wallet. AU-RA no la guarda.', 'It goes straight to Veta Wallet. AU-RA doesn’t keep it.')}
            />
            <Boton
              titulo={tr('¿Olvidaste tu contraseña?', 'Forgot your password?')}
              variante="fantasma"
              tam="chico"
              onPress={() => void olvide()}
              cargando={recuperando}
              deshabilitado={ocupado}
              style={{ alignSelf: 'flex-end', marginTop: 2, marginRight: -6 }}
              etiqueta={tr('¿Olvidaste tu contraseña de Veta Wallet? Te mandamos un enlace a tu correo', 'Forgot your Veta Wallet password? We’ll email you a link')}
            />
          </View>
          {!!errorClave && !errorClave.campo && <Aviso icono="alerta" tono="aviso" titulo={tr('No se pudo entrar con Veta Wallet', 'Couldn’t sign in with Veta Wallet')} texto={errorClave.mensaje} />}
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
            titulo={tr('Entrar con Veta Wallet', 'Sign in with Veta Wallet')}
            variante="principal"
            onPress={() => void entrarClave()}
            cargando={enviando}
            textoCargando={tr('Entrando con Veta Wallet…', 'Signing in with Veta Wallet…')}
            deshabilitado={ocupado}
            etiqueta={tr('Entrar con tu cuenta de Veta Wallet', 'Sign in with your Veta Wallet account')}
          />
          <View style={s.confianza}>
            <Icono nombre="candado" tam={14} color={tema.texto3} />
            <Texto v="mini" color="texto3" style={{ flexShrink: 1 }}>
              {tr('Tu contraseña va directo a Veta Wallet; AU-RA no la ve ni la guarda.', 'Your password goes straight to Veta Wallet; AU-RA never sees or keeps it.')}
            </Texto>
          </View>
        </View>
      )}

      {estado.tipo !== 'exito' && (
        <View style={{ gap: MEDIDA.espacio.m }}>
          <View style={s.separador} accessible={false}>
            <View style={[s.linea, { backgroundColor: tema.borde }]} />
            <Texto v="chica" color="texto3">
              {tr('o', 'or')}
            </Texto>
            <View style={[s.linea, { backgroundColor: tema.borde }]} />
          </View>
          <Boton
            titulo={estado.tipo === 'error' || estado.tipo === 'sinWallet' ? tr('Abrir Orden Global otra vez', 'Open Orden Global again') : tr('Abrir Orden Global', 'Open Orden Global')}
            icono="huella"
            variante="secundario"
            onPress={() => void entrarGenesis()}
            cargando={esperando}
            textoCargando={tr('Esperando tu wallet…', 'Waiting for your wallet…')}
            deshabilitado={enviando || entrandoA}
            etiqueta={tr('Entrar con Genesis ID: se abre tu wallet Orden Global', 'Sign in with Genesis ID: your Orden Global wallet opens')}
          />
          {estado.tipo === 'sinWallet' && (
            <>
              <Boton titulo={tr('Instalar Orden Global', 'Install Orden Global')} icono="descargar" variante="secundario" onPress={() => void abrirTiendaOrdenGlobal()} />
              <Boton titulo={tr('Usar Veta Wallet en la web', 'Use Veta Wallet on the web')} icono="globo" variante="secundario" onPress={() => void entrarGenesis({ web: true })} />
            </>
          )}
          {estado.tipo === 'noVinculada' && (
            <Boton titulo={tr('Abrir la app Orden Global', 'Open the Orden Global app')} icono="wallet" variante="secundario" onPress={() => void abrirAppOrdenGlobal()} />
          )}
          <View style={s.filaEnlaces}>
            <Boton
              titulo={tr('Crear cuenta en Veta Wallet', 'Create a Veta Wallet account')}
              variante="fantasma"
              tam="chico"
              onPress={() => void entrarGenesis({ web: true })}
              deshabilitado={ocupado}
              etiqueta={tr('Crear tu cuenta en la web de Veta Wallet; al terminar vuelves a AU-RA', 'Create your account on the Veta Wallet website; when you’re done you come back to AU-RA')}
            />
            {/* Con el Genesis ID en verificación no se ofrece crear otro: ya tiene uno, solo falta que lo aprueben. */}
            {estado.tipo !== 'gidPendiente' && (
              <Boton titulo={tr('No tengo Genesis ID', 'I don’t have a Genesis ID')} variante="fantasma" tam="chico" onPress={() => navigation.navigate('CrearGenesis')} deshabilitado={ocupado} />
            )}
          </View>
        </View>
      )}
    </View>
  );

  const cuerpo = enWallet ? cuerpoWallet : cuerpoCuenta;

  return (
    <View style={[s.raiz, { backgroundColor: tema.fondo }]}>
      <ScrollView
        contentContainerStyle={[s.contenido, { paddingTop: ins.top + (horizontal ? 20 : 52), paddingBottom: ins.bottom + 20 }, horizontal && s.contenidoH]}
        showsVerticalScrollIndicator={false}
        bounces={false}
        keyboardShouldPersistTaps="handled"
      >
        <Aparecer desde="escala" style={horizontal ? { flex: 1, alignItems: 'center' } : undefined}>
          {marca}
        </Aparecer>
        <Aparecer retraso={vista === 'cuenta' ? 120 : 0} clave={vista} desde={vista === 'wallet' ? 'derecha' : 'abajo'} style={horizontal ? { flex: 1.1 } : { width: '100%', maxWidth: 460 }}>
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
  separador: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  opcion: { gap: MEDIDA.espacio.m, padding: MEDIDA.espacio.l, borderRadius: MEDIDA.radio.m, borderWidth: StyleSheet.hairlineWidth },
  linea: { flex: 1, height: StyleSheet.hairlineWidth },
  filaVolver: { flexDirection: 'row', marginBottom: -MEDIDA.espacio.m },
  filaEnlaces: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', columnGap: 4 },
});
