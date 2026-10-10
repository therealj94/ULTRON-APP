/**
 * «CREAR CUENTA» DE AU-RA (José, 10-oct: «login y registro que simplemente funcionen, sin abrir ninguna otra app»).
 *
 * Dos pasos en la misma pantalla:
 *   1. Nombre, correo, contraseña y confirmarla. «Crear cuenta» abre la cuenta y la sesión de MIEMBRO en el acto
 *      (server/registro-cuentas.ts): nada de solicitudes que esperan a José.
 *   2. Si el servidor mandó el código al correo: «Confirma tu correo» con las 6 cifras, «Confirmar»,
 *      «Reenviar código» y «Confirmar después». Si no pudo mandarlo (sin correo configurado), se entra directo.
 *
 * Al terminar sigue el camino de siempre (app/sesion.ts entrarCon: primera vez o mesa). Es UN intento de entrar
 * (lib/intentoEntrada.ts): «atrás» en el paso 1 lo cancela; en el paso 2 la cuenta ya existe y la sesión ya está
 * guardada, así que «atrás» es «Confirmar después» (entra).
 *
 * La contraseña no se guarda en ningún lado y se borra del estado al mandar. Errores debajo del campo que hay
 * que arreglar (o del formulario si no es de un campo), nunca en un aviso que tapa la pantalla.
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

type Miembro = { nombre: string; rol: string; correo: string };

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
  const [paso, setPaso] = useState<'datos' | 'codigo'>('datos');
  const [nombre, setNombre] = useState('');
  const [correo, setCorreo] = useState(route.params?.correo || '');
  const [clave, setClave] = useState('');
  const [confirmar, setConfirmar] = useState('');
  const [codigo, setCodigo] = useState('');
  const [error, setError] = useState<ErrorCuenta | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [yendo, setYendo] = useState<'' | 'crear' | 'confirmar' | 'reenviar' | 'entrar'>('');
  const intento = useRef<Intento | null>(null);
  const miembro = useRef<Miembro | null>(null);
  const vivo = useRef(true);
  const refCorreo = useRef<TextInput>(null);
  const refClave = useRef<TextInput>(null);
  const refConfirmar = useRef<TextInput>(null);

  useEffect(
    () => () => {
      vivo.current = false;
      // Salió sin terminar el paso 1: ese intento ya no es de nadie.
      if (!miembro.current) cancelarIntento(intento.current);
    },
    []
  );

  const cambiar = (f: (t: string) => void) => (t: string) => {
    f(t);
    if (error) setError(null);
  };

  /** Adentro: la sesión ya está guardada; entrarCon decide primera vez o mesa. */
  const entrar = async () => {
    const m = miembro.current;
    const i = intento.current;
    if (!m || !i) return;
    setYendo('entrar');
    vibrar('exito');
    await entrarCon({ name: m.nombre, role: m.rol, correo: m.correo }, null, i);
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
    const i = empezarIntento();
    intento.current = i;
    try {
      const r = await crearCuenta(nombre, correo, clave, i);
      if (!vivo.current) return;
      if (!r?.token || !r.miembro) throw Object.assign(new Error('sin token'), { status: 500, data: {} });
      miembro.current = { nombre: r.miembro.nombre || nombre.trim(), rol: r.miembro.rol || '', correo: r.miembro.correo || correo.trim().toLowerCase() };
      setClave('');
      setConfirmar('');
      if (r.confirmacion === 'enviado') {
        setPaso('codigo');
        setYendo('');
        return;
      }
      // Sin correo para mandar el código: se entra igual (la cuenta queda sin confirmar).
      await entrar();
    } catch (err: any) {
      if (esVencida(err) || !vivo.current) return;
      miga(`crear cuenta: ${String(err?.status || err?.name || 'error').slice(0, 20)}`);
      vibrar('error');
      setError(errorDeRegistro(err));
      setYendo('');
      setClave('');
      setConfirmar('');
    }
  };

  const confirmarCodigo = async () => {
    if (yendo) return;
    const k = normalizarCodigo(codigo);
    if (k.length !== 6) return setError({ campo: 'codigo', mensaje: tr('El código tiene 6 cifras.', 'The code has 6 digits.') });
    setError(null);
    setAviso(null);
    setYendo('confirmar');
    try {
      await confirmarCodigoCorreo(k);
      if (!vivo.current) return;
      await entrar();
    } catch (err: any) {
      if (!vivo.current) return;
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
      const r = await reenviarCodigoCorreo();
      if (!vivo.current) return;
      if (r.confirmado) return void (await entrar());
      setAviso(tr('Te mandamos un código nuevo. Revisa también la carpeta de spam.', 'We sent you a new code. Check your spam folder too.'));
    } catch (err: any) {
      if (vivo.current) setError(errorDeCodigo(err));
    } finally {
      if (vivo.current) setYendo((y) => (y === 'reenviar' ? '' : y));
    }
  };

  const atras = () => {
    // En el paso 2 la cuenta ya existe y la sesión está guardada: «atrás» es «Confirmar después».
    if (paso === 'codigo') return void entrar();
    navigation.goBack();
  };

  const ocupado = !!yendo;

  return (
    <PantallaConCabecera
      titulo={paso === 'datos' ? tr('Crear cuenta', 'Create account') : tr('Confirma tu correo', 'Confirm your email')}
      subtitulo={
        paso === 'datos'
          ? tr('Tu cuenta de AU-RA: entras en cuanto la creas, sin otra app.', 'Your AU-RA account: you’re in as soon as you create it, no other app needed.')
          : tr(`Te mandamos un código de 6 cifras a ${miembro.current?.correo || 'tu correo'}.`, `We sent a 6-digit code to ${miembro.current?.correo || 'your email'}.`)
      }
      onAtras={atras}
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
            cargando={yendo === 'crear' || yendo === 'entrar'}
            textoCargando={tr('Creando tu cuenta…', 'Creating your account…')}
            deshabilitado={ocupado}
            etiqueta={tr('Crear tu cuenta de AU-RA y entrar', 'Create your AU-RA account and sign in')}
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
            cargando={yendo === 'confirmar' || yendo === 'entrar'}
            textoCargando={tr('Confirmando…', 'Confirming…')}
            deshabilitado={ocupado}
            etiqueta={tr('Confirmar tu correo con el código', 'Confirm your email with the code')}
          />
          <Boton titulo={tr('Reenviar código', 'Resend code')} icono="correo" variante="secundario" onPress={() => void reenviar()} cargando={yendo === 'reenviar'} deshabilitado={ocupado} />
          <Boton
            titulo={tr('Confirmar después', 'Confirm later')}
            variante="fantasma"
            onPress={() => void entrar()}
            deshabilitado={ocupado}
            etiqueta={tr('Confirmar el correo después y entrar ya', 'Confirm the email later and sign in now')}
          />
        </View>
      )}
    </PantallaConCabecera>
  );
}

const s = StyleSheet.create({
  aviso: { flexDirection: 'row', gap: 12, padding: 14, borderRadius: MEDIDA.radio.m, alignItems: 'flex-start' },
  nota: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 4 },
});
