/**
 * «CREAR CUENTA» DE AU-RA (José, 10-oct: «login y registro que simplemente funcionen, sin abrir ninguna otra app»),
 * con el correo PROBADO antes de entrar (revisión de seguridad del PR #176).
 *
 * Dos pasos en la misma pantalla:
 *   1. Nombre, correo, contraseña y confirmarla. «Crear cuenta» abre la cuenta SIN confirmar y el servidor manda un
 *      código de 6 cifras al correo (server/registro-cuentas.ts). Todavía NO hay sesión.
 *   2. «Confirma tu correo»: las 6 cifras, «Confirmar» (correo + contraseña + código → la sesión de MIEMBRO) y
 *      «Reenviar código». No hay «Confirmar después»: sin el código no se entra, y «Volver a entrar» lo dice.
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
import { StyleSheet, View, type TextInput } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { crearCuenta, confirmarCodigoCorreo, reenviarCodigoCorreo } from '../../lib/api';
import { errorDeCodigo, errorDeRegistro, normalizarCodigo, reglasClave, validarRegistro, type ErrorCuenta } from '../../lib/cuentaPropia';
import { cancelarIntento, empezarIntento, esVencida, type Intento } from '../../lib/intentoEntrada';
import { miga } from '../../lib/reporte';
import { tr, useIdioma } from '../../i18n';
import { MEDIDA, useTema } from '../../nucleo/tema';
import { Aparecer, Boton, Campo, Icono, PantallaConCabecera, Texto, vibrar, type NombreIcono } from '../../ui';
import type { RaizParams } from '../rutas';
import { entrarCon } from '../sesion';

type Props = NativeStackScreenProps<RaizParams, 'CrearCuenta'>;

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
  const [confirmar, setConfirmar] = useState('');
  const [codigo, setCodigo] = useState('');
  const [error, setError] = useState<ErrorCuenta | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [yendo, setYendo] = useState<'' | 'crear' | 'confirmar' | 'reenviar'>('');
  const intento = useRef<Intento | null>(null);
  const entro = useRef(false);
  const vivo = useRef(true);
  const refCorreo = useRef<TextInput>(null);
  const refClave = useRef<TextInput>(null);
  const refConfirmar = useRef<TextInput>(null);

  useEffect(
    () => () => {
      vivo.current = false;
      // Salió sin entrar: ese intento ya no es de nadie.
      if (!entro.current) cancelarIntento(intento.current);
    },
    []
  );

  const cambiar = (f: (t: string) => void) => (t: string) => {
    f(t);
    if (error) setError(null);
  };

  const crear = async () => {
    if (yendo) return;
    const e = validarRegistro({ nombre, correo, clave, confirmar });
    if (e) {
      vibrar('error');
      if (e.campo === 'clave') refClave.current?.focus();
      if (e.campo === 'confirmar') refConfirmar.current?.focus();
      return setError(e);
    }
    setError(null);
    setYendo('crear');
    try {
      await crearCuenta(nombre, correo, clave);
      if (!vivo.current) return;
      // La cuenta queda sin confirmar: al código (la contraseña se queda en esta pantalla para confirmar).
      setConfirmar('');
      setPaso('codigo');
    } catch (err: any) {
      if (!vivo.current) return;
      miga(`crear cuenta: ${String(err?.status || err?.name || 'error').slice(0, 20)}`);
      vibrar('error');
      setError(errorDeRegistro(err));
      setClave('');
      setConfirmar('');
    } finally {
      if (vivo.current) setYendo('');
    }
  };

  const confirmarCodigo = async () => {
    if (yendo) return;
    const k = normalizarCodigo(codigo);
    if (k.length !== 6) return setError({ campo: 'codigo', mensaje: tr('El código tiene 6 cifras.', 'The code has 6 digits.') });
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
      setError(errorDeCodigo(err));
      setYendo('');
    }
  };

  const reenviar = async () => {
    if (yendo) return;
    setError(null);
    setAviso(null);
    setYendo('reenviar');
    try {
      await reenviarCodigoCorreo(correo, clave);
      if (vivo.current) setAviso(tr('Te mandamos un código nuevo. Revisa también la carpeta de spam.', 'We sent you a new code. Check your spam folder too.'));
    } catch (err: any) {
      if (vivo.current) setError(errorDeCodigo(err));
    } finally {
      if (vivo.current) setYendo((y) => (y === 'reenviar' ? '' : y));
    }
  };

  const ocupado = !!yendo;

  return (
    <PantallaConCabecera
      titulo={paso === 'datos' ? tr('Crear cuenta', 'Create account') : tr('Confirma tu correo', 'Confirm your email')}
      subtitulo={
        paso === 'datos'
          ? tr('Tu cuenta de AU-RA, sin otra app. Te mandamos un código a tu correo para entrar.', 'Your AU-RA account, no other app needed. We’ll email you a code to sign in.')
          : tr(`Te mandamos un código de 6 cifras a ${correo.trim().toLowerCase() || 'tu correo'}. Sin él no se puede entrar.`, `We sent a 6-digit code to ${correo.trim().toLowerCase() || 'your email'}. You can’t sign in without it.`)
      }
      onAtras={() => navigation.goBack()}
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
          <Campo
            ref={refClave}
            etiqueta={tr('Contraseña', 'Password')}
            clave
            value={clave}
            onChangeText={cambiar(setClave)}
            autoComplete="new-password"
            textContentType="newPassword"
            returnKeyType="next"
            submitBehavior="submit"
            onSubmitEditing={() => refConfirmar.current?.focus()}
            editable={!ocupado}
            ayuda={reglasClave()}
            error={error?.campo === 'clave' ? error.mensaje : undefined}
            accessibilityLabel={tr('Contraseña nueva', 'New password')}
          />
          <Campo
            ref={refConfirmar}
            etiqueta={tr('Confirmar contraseña', 'Confirm password')}
            clave
            value={confirmar}
            onChangeText={cambiar(setConfirmar)}
            autoComplete="new-password"
            textContentType="newPassword"
            returnKeyType="go"
            onSubmitEditing={() => void crear()}
            editable={!ocupado}
            error={error?.campo === 'confirmar' ? error.mensaje : undefined}
            accessibilityLabel={tr('Escribe otra vez la contraseña', 'Type the password again')}
          />
          {!!error && !error.campo && <Aviso icono="alerta" tono="aviso" titulo={tr('No se pudo crear la cuenta', 'Couldn’t create the account')} texto={error.mensaje} />}
          <Boton
            titulo={tr('Crear cuenta', 'Create account')}
            icono="persona"
            onPress={() => void crear()}
            cargando={yendo === 'crear'}
            textoCargando={tr('Creando tu cuenta…', 'Creating your account…')}
            deshabilitado={ocupado}
            etiqueta={tr('Crear tu cuenta de AU-RA; te mandamos un código al correo', 'Create your AU-RA account; we’ll email you a code')}
          />
          <Boton titulo={tr('Ya tengo cuenta: entrar', 'I already have an account: sign in')} variante="fantasma" onPress={() => navigation.goBack()} deshabilitado={ocupado} />
          <View style={s.nota}>
            <Icono nombre="candado" tam={15} color={tema.texto3} />
            <Texto v="chica" color="texto3" style={{ flex: 1 }}>
              {tr(
                'Entras como miembro de la comunidad. Si necesitas acceso de la junta, pídelo después desde «Otras formas de entrar».',
                'You join as a community member. If you need board access, request it later from “Other ways to sign in”.'
              )}
            </Texto>
          </View>
        </View>
      ) : (
        <View style={{ gap: MEDIDA.espacio.m }}>
          <Campo
            etiqueta={tr('Código', 'Code')}
            value={codigo}
            onChangeText={cambiar((t) => setCodigo(normalizarCodigo(t)))}
            placeholder="123456"
            keyboardType="number-pad"
            textContentType="oneTimeCode"
            autoComplete="one-time-code"
            maxLength={6}
            returnKeyType="go"
            onSubmitEditing={() => void confirmarCodigo()}
            editable={!ocupado}
            error={error?.campo === 'codigo' ? error.mensaje : undefined}
            accessibilityLabel={tr('Código de 6 cifras que te llegó al correo', '6-digit code from your email')}
          />
          {!!error && !error.campo && <Aviso icono="alerta" tono="aviso" titulo={tr('No se pudo confirmar', 'Couldn’t confirm')} texto={error.mensaje} />}
          {!!aviso && <Aviso icono="correo" tono="acento" titulo={tr('Revisa tu correo', 'Check your email')} texto={aviso} />}
          <Boton
            titulo={tr('Confirmar', 'Confirm')}
            icono="check"
            onPress={() => void confirmarCodigo()}
            cargando={yendo === 'confirmar'}
            textoCargando={tr('Confirmando…', 'Confirming…')}
            deshabilitado={ocupado}
            etiqueta={tr('Confirmar tu correo con el código y entrar', 'Confirm your email with the code and sign in')}
          />
          <Boton titulo={tr('Reenviar código', 'Resend code')} icono="correo" variante="secundario" onPress={() => void reenviar()} cargando={yendo === 'reenviar'} deshabilitado={ocupado} />
          <Boton
            titulo={tr('Volver a entrar', 'Back to sign in')}
            variante="fantasma"
            onPress={() => navigation.goBack()}
            deshabilitado={ocupado}
            etiqueta={tr('Volver a entrar: necesitas el código para entrar con esta cuenta', 'Back to sign in: you need the code to use this account')}
          />
          <Texto v="chica" color="texto3" centro>
            {tr(
              'Sin el código no puedes entrar con esta cuenta. Mientras tanto puedes entrar con Veta Wallet u Orden Global.',
              'You can’t sign in with this account without the code. Meanwhile you can sign in with Veta Wallet or Orden Global.'
            )}
          </Texto>
        </View>
      )}
    </PantallaConCabecera>
  );
}

const s = StyleSheet.create({
  aviso: { flexDirection: 'row', gap: 12, padding: 14, borderRadius: MEDIDA.radio.m, alignItems: 'flex-start' },
  nota: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 4 },
});
