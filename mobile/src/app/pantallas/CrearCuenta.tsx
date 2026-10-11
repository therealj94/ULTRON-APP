/**
 * «CREAR CUENTA» DE AU-RA (José, 10-oct: «login y registro que simplemente funcionen, sin abrir ninguna otra app»),
 * con el correo PROBADO antes de entrar (revisión de seguridad del PR #176).
 *
 * Dos pasos en la misma pantalla, como en las apps del teléfono (José, 11-oct: «que se vea nativo, que no se confunda»):
 *   1. Nombre, correo y contraseña (UNA vez, con el ojito para verla y la regla que se cumple mientras escribe).
 *      «Crear cuenta» abre la cuenta SIN confirmar y el servidor manda un código de 6 cifras al correo
 *      (server/registro-cuentas.ts). Todavía NO hay sesión.
 *   2. «Revisa tu correo»: seis casillas (ui/CampoCodigo.tsx: pegar y autocompletar del teléfono sirven) que
 *      confirman solas al llenarse (correo + contraseña + código → la sesión de MIEMBRO). «Reenviar código» espera su
 *      minuto con la cuenta atrás a la vista, y «Cambiar correo» vuelve al paso 1. No hay «Confirmar después»: sin el
 *      código no se entra.
 *
 * También se llega directo al paso 2 desde «Entrar» cuando la cuenta existe pero el correo sigue sin confirmar
 * (CORREO_SIN_CONFIRMAR): Entrar deja el correo y la contraseña aquí con `pedirCodigoPara` (en memoria, una vez;
 * nunca en los parámetros de la navegación) y navega con `paso: 'codigo'`.
 *
 * Al confirmar sigue el camino de siempre (app/sesion.ts entrarCon: primera vez o mesa), como UN intento de entrar
 * (lib/intentoEntrada.ts). La contraseña vive solo en el estado de esta pantalla hasta confirmar o salir; no se
 * guarda en ningún lado. Errores debajo del campo que hay que arreglar, o del formulario.
 */
import { useEffect, useRef, useState } from 'react';
import { AppState, BackHandler, StyleSheet, View, type TextInput } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { crearCuenta, confirmarCodigoCorreo, reenviarCodigoCorreo } from '../../lib/api';
import { errorDeCodigo, errorDeRegistro, normalizarCodigo, problemaDeClave, reglasClave, validarRegistro, type ErrorCuenta } from '../../lib/cuentaPropia';
import { cancelarIntento, empezarIntento, esVencida, type Intento } from '../../lib/intentoEntrada';
import { miga } from '../../lib/reporte';
import { tr, useIdioma } from '../../i18n';
import { MEDIDA, useTema } from '../../nucleo/tema';
import { Aparecer, Boton, Campo, CampoCodigo, Icono, LARGO_CODIGO, PantallaConCabecera, Texto, vibrar, type NombreIcono } from '../../ui';
import type { RaizParams } from '../rutas';
import { entrarCon } from '../sesion';

type Props = NativeStackScreenProps<RaizParams, 'CrearCuenta'>;

/** Lo que el servidor hace esperar entre un código y otro (server/registro-cuentas.ts, ESPERA). */
const ESPERA_REENVIO_S = 60;

/** Lo que «Entrar» deja para el paso del código (una cuenta sin confirmar): se toma una vez y se borra. */
let pendiente: { correo: string; clave: string } | null = null;
export function pedirCodigoPara(correo: string, clave: string) {
  pendiente = { correo: correo.trim().toLowerCase(), clave };
}
function tomarPendiente() {
  const p = pendiente;
  pendiente = null;
  return p;
}

function Aviso({ icono, titulo, texto, tono }: { icono: NombreIcono; titulo: string; texto?: string; tono: 'aviso' | 'acento' }) {
  const tema = useTema();
  const color = tono === 'aviso' ? tema.aviso : tema.acentoTexto;
  return (
    <Aparecer desde="escala">
      <View style={[s.aviso, { backgroundColor: tono === 'aviso' ? tema.avisoFondo : tema.acentoFondo }]} accessibilityRole="alert" accessibilityLiveRegion="polite">
        <Icono nombre={icono} tam={18} color={color} />
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

export function CrearCuenta({ navigation, route }: Props) {
  useIdioma();
  const tema = useTema();
  // Desde «Entrar» con una cuenta sin confirmar: directo al código, con lo que la persona ya escribió allá.
  const [desdeEntrar] = useState(() => (route.params?.paso === 'codigo' ? tomarPendiente() : null));
  const [paso, setPaso] = useState<'datos' | 'codigo'>(desdeEntrar ? 'codigo' : 'datos');
  const [nombre, setNombre] = useState('');
  const [correo, setCorreo] = useState(desdeEntrar?.correo || route.params?.correo || '');
  const [clave, setClave] = useState(desdeEntrar?.clave || '');
  const [codigo, setCodigo] = useState('');
  const [error, setError] = useState<ErrorCuenta | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [yendo, setYendo] = useState<'' | 'crear' | 'confirmar' | 'reenviar'>('');
  /**
   * Hasta cuándo no se puede pedir otro código (el servidor pide un minuto). Es una HORA, no un contador: mientras la
   * persona sale a su correo la app se duerme y un contador se congelaría (Codex, PR #178); la hora sigue corriendo.
   */
  const [hasta, setHasta] = useState(() => (paso === 'codigo' ? Date.now() + ESPERA_REENVIO_S * 1000 : 0));
  const [tic, setTic] = useState(0);
  const espera = Math.max(0, Math.ceil((hasta - Date.now()) / 1000));
  const esperarReenvio = () => setHasta(Date.now() + ESPERA_REENVIO_S * 1000);
  const intento = useRef<Intento | null>(null);
  const entro = useRef(false);
  const vivo = useRef(true);
  const refCorreo = useRef<TextInput>(null);
  const refClave = useRef<TextInput>(null);
  const refCodigo = useRef<TextInput>(null);

  useEffect(
    () => () => {
      vivo.current = false;
      // Salió sin entrar: ese intento ya no es de nadie.
      if (!entro.current) cancelarIntento(intento.current);
    },
    []
  );

  // La cuenta atrás de «Reenviar código»: se redibuja cada segundo y al volver a la app.
  useEffect(() => {
    if (espera <= 0) return;
    const t = setTimeout(() => setTic((n) => n + 1), 1000);
    return () => clearTimeout(t);
  }, [espera, tic]);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (e) => e === 'active' && setTic((n) => n + 1));
    return () => sub.remove();
  }, []);

  const cambiar = (f: (t: string) => void) => (t: string) => {
    f(t);
    if (error) setError(null);
  };

  const crear = async () => {
    if (yendo) return;
    const e = validarRegistro({ nombre, correo, clave });
    if (e) {
      vibrar('error');
      if (e.campo === 'correo') refCorreo.current?.focus();
      if (e.campo === 'clave') refClave.current?.focus();
      return setError(e);
    }
    setError(null);
    setYendo('crear');
    try {
      await crearCuenta(nombre, correo, clave);
      if (!vivo.current) return;
      // La cuenta queda sin confirmar: al código (la contraseña se queda en esta pantalla para confirmar).
      setCodigo('');
      setAviso(null);
      esperarReenvio();
      setPaso('codigo');
    } catch (err: any) {
      if (!vivo.current) return;
      miga(`crear cuenta: ${String(err?.status || err?.name || 'error').slice(0, 20)}`);
      vibrar('error');
      const ec = errorDeRegistro(err);
      setError(ec);
      // La contraseña se borra solo si es ella la que falló: por un nombre o una red caída no se vuelve a escribir.
      if (ec.campo === 'clave') setClave('');
    } finally {
      if (vivo.current) setYendo('');
    }
  };

  const confirmarCodigo = async (valor = codigo) => {
    if (yendo) return;
    const k = normalizarCodigo(valor);
    if (k.length !== LARGO_CODIGO) return setError({ campo: 'codigo', mensaje: tr('El código tiene 6 cifras.', 'The code has 6 digits.') });
    setError(null);
    setAviso(null);
    setYendo('confirmar');
    const i = empezarIntento();
    intento.current = i;
    try {
      const r = await confirmarCodigoCorreo(correo, clave, k, i);
      if (!vivo.current) return;
      if (!r?.token || !r.miembro) throw Object.assign(new Error('sin token'), { status: 500, data: {} });
      entro.current = true;
      setClave('');
      vibrar('exito');
      await entrarCon({ name: r.miembro.nombre || correo.split('@')[0], role: r.miembro.rol || '', correo: r.miembro.correo || correo.trim().toLowerCase() }, null, i);
    } catch (err: any) {
      if (esVencida(err) || !vivo.current) return;
      vibrar('error');
      const ec = errorDeCodigo(err);
      setError(ec);
      // Código malo: las casillas se vacían y el teclado vuelve, listo para el bueno.
      if (ec.campo === 'codigo') {
        setCodigo('');
        setTimeout(() => refCodigo.current?.focus(), 50);
      }
      setYendo('');
    }
  };

  const reenviar = async () => {
    if (yendo || espera > 0) return;
    setError(null);
    setAviso(null);
    setYendo('reenviar');
    try {
      await reenviarCodigoCorreo(correo, clave);
      if (!vivo.current) return;
      setCodigo('');
      esperarReenvio();
      setAviso(tr('Te mandamos un código nuevo. Revisa también la carpeta de spam.', 'We sent you a new code. Check your spam folder too.'));
    } catch (err: any) {
      if (!vivo.current) return;
      const ec = errorDeCodigo(err);
      if (ec.codigo === 'ESPERA') esperarReenvio();
      setError(ec);
    } finally {
      if (vivo.current) setYendo((y) => (y === 'reenviar' ? '' : y));
    }
  };

  /** «Cambiar correo»: al paso 1 con lo escrito (la cuenta sin confirmar no estorba: se vuelve a crear). */
  const cambiarCorreo = () => {
    setError(null);
    setAviso(null);
    setCodigo('');
    setPaso('datos');
    setTimeout(() => refCorreo.current?.focus(), 80);
  };

  // El «atrás» de Android en el paso del código hace lo mismo que la flecha: volver a los datos (no tirar la pantalla).
  // Confirmando, se queda: el servidor ya pudo gastar el código y la sesión está por llegar.
  useEffect(() => {
    if (paso !== 'codigo' || desdeEntrar) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (yendo !== 'confirmar') cambiarCorreo();
      return true;
    });
    return () => sub.remove();
    // cambiarCorreo solo usa setters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paso, desdeEntrar, yendo]);

  const ocupado = !!yendo;
  const correoVisto = correo.trim().toLowerCase();
  const problema = clave ? problemaDeClave(clave, correo) : null;
  const mmss = `${Math.floor(espera / 60)}:${String(espera % 60).padStart(2, '0')}`;

  return (
    <PantallaConCabecera
      titulo={paso === 'datos' ? tr('Crear cuenta', 'Create account') : tr('Revisa tu correo', 'Check your email')}
      subtitulo={paso === 'datos' ? tr('Tu cuenta de AU-RA en un minuto, sin otra app.', 'Your AU-RA account in a minute, no other app needed.') : undefined}
      onAtras={() => (paso === 'codigo' && !desdeEntrar ? cambiarCorreo() : navigation.goBack())}
    >
      {paso === 'datos' ? (
        <View style={{ gap: MEDIDA.espacio.m }}>
          <Campo
            etiqueta={tr('Nombre', 'Name')}
            value={nombre}
            onChangeText={cambiar(setNombre)}
            placeholder={tr('Tu nombre', 'Your name')}
            autoComplete="name"
            textContentType="name"
            autoCapitalize="words"
            returnKeyType="next"
            submitBehavior="submit"
            onSubmitEditing={() => refCorreo.current?.focus()}
            editable={!ocupado}
            maxLength={80}
            error={error?.campo === 'nombre' ? error.mensaje : undefined}
            accessibilityLabel={tr('Tu nombre', 'Your name')}
          />
          <Campo
            ref={refCorreo}
            etiqueta={tr('Correo', 'Email')}
            value={correo}
            onChangeText={cambiar(setCorreo)}
            placeholder={tr('tu@correo.com', 'you@email.com')}
            keyboardType="email-address"
            autoCapitalize="none"
            autoComplete="email"
            textContentType="emailAddress"
            returnKeyType="next"
            submitBehavior="submit"
            onSubmitEditing={() => refClave.current?.focus()}
            editable={!ocupado}
            error={error?.campo === 'correo' ? error.mensaje : undefined}
            accessibilityLabel={tr('Tu correo', 'Your email')}
          />
          <View style={{ gap: 6 }}>
            <Campo
              ref={refClave}
              etiqueta={tr('Contraseña', 'Password')}
              clave
              value={clave}
              onChangeText={cambiar(setClave)}
              autoComplete="new-password"
              textContentType="newPassword"
              returnKeyType="go"
              onSubmitEditing={() => void crear()}
              editable={!ocupado}
              error={error?.campo === 'clave' ? error.mensaje : undefined}
              accessibilityLabel={tr('Contraseña nueva', 'New password')}
            />
            {/* La regla, viva: gris mientras falta, verde cuando ya se cumple (el error rojo solo al tocar «Crear»). */}
            {error?.campo !== 'clave' && (
              <View style={s.regla} accessibilityLiveRegion="polite">
                <Icono nombre={clave && !problema ? 'check' : 'info'} tam={15} color={clave && !problema ? tema.exito : tema.texto3} />
                <Texto v="chica" color={clave && !problema ? 'exito' : 'texto3'} style={{ flex: 1 }}>
                  {!clave ? reglasClave() : problema || tr('Contraseña lista.', 'Password looks good.')}
                </Texto>
              </View>
            )}
          </View>
          {!!error && !error.campo && <Aviso icono="alerta" tono="aviso" titulo={tr('No se pudo crear la cuenta', 'Couldn’t create the account')} texto={error.mensaje} />}
          <Boton
            titulo={tr('Crear cuenta', 'Create account')}
            onPress={() => void crear()}
            cargando={yendo === 'crear'}
            textoCargando={tr('Creando tu cuenta…', 'Creating your account…')}
            deshabilitado={ocupado}
            etiqueta={tr('Crear tu cuenta de AU-RA; te mandamos un código al correo', 'Create your AU-RA account; we’ll email you a code')}
          />
          <Texto v="chica" color="texto3" centro>
            {tr('Te mandaremos un código de 6 cifras para confirmar tu correo.', 'We’ll send you a 6-digit code to confirm your email.')}
          </Texto>
          <View style={s.filaPie}>
            <Texto v="chica" color="texto2">
              {tr('¿Ya tienes cuenta?', 'Already have an account?')}
            </Texto>
            <Boton titulo={tr('Entrar', 'Sign in')} variante="fantasma" tam="chico" onPress={() => navigation.goBack()} deshabilitado={ocupado} />
          </View>
        </View>
      ) : (
        <View style={{ gap: MEDIDA.espacio.l }}>
          <View style={[s.sobre, { backgroundColor: tema.acentoFondo }]}>
            <Icono nombre="correo" tam={30} color={tema.acentoTexto} />
          </View>
          <View style={{ gap: 4 }}>
            <Texto v="cuerpo" color="texto2" centro>
              {tr('Escribe el código de 6 cifras que mandamos a', 'Enter the 6-digit code we sent to')}
            </Texto>
            <Texto v="cuerpoFuerte" centro numberOfLines={1} adjustsFontSizeToFit>
              {correoVisto || tr('tu correo', 'your email')}
            </Texto>
          </View>
          <CampoCodigo
            ref={refCodigo}
            valor={codigo}
            alCambiar={(t) => {
              setCodigo(t);
              if (error) setError(null);
            }}
            alCompletar={(k) => void confirmarCodigo(k)}
            error={error?.campo === 'codigo' ? error.mensaje : undefined}
            editable={!ocupado}
            autoFocus
            etiqueta={tr('Código de 6 cifras que te llegó al correo', '6-digit code from your email')}
          />
          {!!error && !error.campo && <Aviso icono="alerta" tono="aviso" titulo={tr('No se pudo confirmar', 'Couldn’t confirm')} texto={error.mensaje} />}
          {!!aviso && <Aviso icono="correo" tono="acento" titulo={tr('Código enviado', 'Code sent')} texto={aviso} />}
          <Boton
            titulo={tr('Confirmar y entrar', 'Confirm and sign in')}
            onPress={() => void confirmarCodigo()}
            cargando={yendo === 'confirmar'}
            textoCargando={tr('Confirmando…', 'Confirming…')}
            deshabilitado={ocupado || codigo.length !== LARGO_CODIGO}
            etiqueta={tr('Confirmar tu correo con el código y entrar', 'Confirm your email with the code and sign in')}
          />
          <View style={s.filaPie}>
            <Texto v="chica" color="texto2">
              {tr('¿No te llegó?', 'Didn’t get it?')}
            </Texto>
            <Boton
              titulo={espera > 0 ? tr(`Reenviar código en ${mmss}`, `Resend code in ${mmss}`) : tr('Reenviar código', 'Resend code')}
              variante="fantasma"
              tam="chico"
              onPress={() => void reenviar()}
              cargando={yendo === 'reenviar'}
              deshabilitado={ocupado || espera > 0}
            />
          </View>
          <Texto v="chica" color="texto3" centro>
            {tr('Revisa también la carpeta de spam o promociones. El código vale 30 minutos.', 'Check your spam or promotions folder too. The code is valid for 30 minutes.')}
          </Texto>
          <Boton
            titulo={desdeEntrar ? tr('Volver a entrar', 'Back to sign in') : tr('Cambiar correo', 'Change email')}
            variante="fantasma"
            tam="chico"
            onPress={() => (desdeEntrar ? navigation.goBack() : cambiarCorreo())}
            deshabilitado={ocupado}
            style={{ alignSelf: 'center' }}
          />
        </View>
      )}
    </PantallaConCabecera>
  );
}

const s = StyleSheet.create({
  aviso: { flexDirection: 'row', gap: 12, padding: 14, borderRadius: MEDIDA.radio.m, alignItems: 'flex-start' },
  regla: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 4 },
  filaPie: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap', columnGap: 2 },
  sobre: { width: 68, height: 68, borderRadius: 34, alignItems: 'center', justifyContent: 'center', alignSelf: 'center' },
});
