/**
 * AUTORIZAR CON LA CONTRASEÑA DE VETA WALLET (o con la huella / Face ID). La misma ficha para todo lo que el
 * backend protege con contraseña: ver número, vencimiento y CVV, ver o crear el PIN, recargar la tarjeta.
 * Se comporta como la de Veta Wallet (veta-wallet-app/src/PedirClave.js):
 *
 *   · Con el desbloqueo activo, prueba la biometría SOLA al abrirse: lo normal es no teclear nada.
 *   · Si se cancela o falla, cae al campo de contraseña (con el ojito para verla) y deja reintentar.
 *   · Sin desbloqueo, ofrece «Usar la huella la próxima vez» (solo si el teléfono la tiene), y la guarda
 *     únicamente cuando el servidor aceptó esa contraseña.
 *
 * `onAutorizar(clave)` devuelve { ok } (o lanza). { ok: false, msg } deja la ficha abierta con el error.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { tr, idiomaActual } from '../../i18n';
import { MEDIDA, useTema } from '../../nucleo/tema';
import { Boton, Campo, Hoja, Icono, Texto, vibrar } from '../../ui';
import { activarDesbloqueo, capacidadBiometrica, desbloqueoActivo, desbloquearClave, nombreBiometria, type TipoBiometria } from './desbloqueo';

type Props = {
  visible: boolean;
  titulo: string;
  subtitulo?: string;
  accion?: string;
  onCancelar: () => void;
  onAutorizar: (clave: string) => Promise<{ ok: boolean; msg?: string }>;
};

export function PedirClave({ visible, titulo, subtitulo, accion, onCancelar, onAutorizar }: Props) {
  const tema = useTema();
  const [clave, setClave] = useState('');
  const [yendo, setYendo] = useState(false);
  const [error, setError] = useState('');
  const [bio, setBio] = useState<{ disponible: boolean; tipo: TipoBiometria }>({ disponible: false, tipo: 'huella' });
  const [activo, setActivo] = useState(false);
  const [probandoBio, setProbandoBio] = useState(false);
  const [quiereActivar, setQuiereActivar] = useState(true);
  const [manual, setManual] = useState(false);
  const enVuelo = useRef(false);
  const nombre = nombreBiometria(bio.tipo, idiomaActual() !== 'en');

  const enviar = useCallback(
    async (c: string, deBio = false) => {
      if (!c || enVuelo.current) return;
      enVuelo.current = true;
      setYendo(true);
      setError('');
      try {
        const r = await onAutorizar(c);
        if (r && r.ok === false) {
          vibrar('aviso');
          if (deBio) {
            // La guardada ya no sirve (la cambió en otro lado): a escribirla de nuevo.
            setManual(true);
            setError(tr('La contraseña guardada ya no sirve. Escríbela de nuevo para actualizarla.', 'The saved password no longer works. Type it again to update it.'));
          } else setError(r.msg || tr('Contraseña incorrecta', 'Wrong password'));
          return;
        }
        vibrar('exito');
        if (!deBio && quiereActivar && bio.disponible && !activo) await activarDesbloqueo(c);
      } catch (e: any) {
        setError(e?.message || tr('No se pudo. Intenta otra vez.', 'It didn’t work. Try again.'));
      } finally {
        enVuelo.current = false;
        setYendo(false);
        setClave('');
      }
    },
    [onAutorizar, quiereActivar, bio.disponible, activo]
  );

  const usarBio = useCallback(async () => {
    setProbandoBio(true);
    setError('');
    const c = await desbloquearClave(titulo);
    setProbandoBio(false);
    if (!c) {
      setManual(true);
      return;
    }
    await enviar(c, true);
  }, [enviar, titulo]);

  useEffect(() => {
    if (!visible) {
      setClave('');
      setYendo(false);
      setError('');
      setManual(false);
      setProbandoBio(false);
      return;
    }
    let vivo = true;
    void (async () => {
      const [cap, act] = await Promise.all([capacidadBiometrica(), desbloqueoActivo()]);
      if (!vivo) return;
      setBio(cap);
      const listo = act && cap.disponible;
      setActivo(listo);
      if (listo) {
        setProbandoBio(true);
        const c = await desbloquearClave(titulo);
        if (!vivo) return;
        setProbandoBio(false);
        if (c) await enviar(c, true);
        else setManual(true);
      }
    })();
    return () => {
      vivo = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const conBio = activo && !manual;

  return (
    <Hoja visible={visible} onCerrar={yendo ? () => undefined : onCancelar} titulo={titulo} subtitulo={subtitulo || tr('Autoriza con tu contraseña de Veta Wallet.', 'Authorize with your Veta Wallet password.')}>
      {conBio ? (
        <View style={{ alignItems: 'center', gap: MEDIDA.espacio.m, paddingVertical: MEDIDA.espacio.s }}>
          <View style={[s.bio, { backgroundColor: tema.acentoFondo, borderColor: tema.acento }]}>
            {probandoBio || yendo ? <ActivityIndicator size="large" color={tema.acento} /> : <Icono nombre={bio.tipo === 'face' ? 'cara' : 'huella'} tam={42} color={tema.acentoTexto} />}
          </View>
          <Texto v="cuerpo" color="texto2" style={{ textAlign: 'center' }}>
            {yendo ? tr('Verificando…', 'Verifying…') : tr(`Confirma con ${nombre} para continuar.`, `Confirm with ${nombre} to continue.`)}
          </Texto>
          {!!error && (
            <Texto v="chica" color="aviso" style={{ textAlign: 'center' }}>
              {error}
            </Texto>
          )}
          {!probandoBio && !yendo ? <Boton titulo={tr(`Usar ${nombre}`, `Use ${nombre}`)} icono="huella" onPress={() => void usarBio()} /> : null}
          <Boton titulo={tr('Usar mi contraseña', 'Use my password')} variante="fantasma" tam="chico" onPress={() => setManual(true)} />
        </View>
      ) : (
        <View style={{ gap: MEDIDA.espacio.m }}>
          <Campo
            etiqueta={tr('Contraseña de Veta Wallet', 'Veta Wallet password')}
            value={clave}
            onChangeText={(t) => {
              setClave(t);
              if (error) setError('');
            }}
            clave
            autoFocus={!activo}
            error={error || undefined}
            onSubmitEditing={() => void enviar(clave)}
            returnKeyType="go"
          />
          {bio.disponible && !activo ? (
            <Pressable onPress={() => setQuiereActivar((v) => !v)} accessibilityRole="checkbox" accessibilityState={{ checked: quiereActivar }} style={s.casillaFila}>
              <View style={[s.casilla, { borderColor: quiereActivar ? tema.acento : tema.borde, backgroundColor: quiereActivar ? tema.acento : 'transparent' }]}>
                {quiereActivar ? <Icono nombre="check" tam={14} color={tema.sobreAcento} /> : null}
              </View>
              <View style={{ flex: 1 }}>
                <Texto v="cuerpoFuerte">{tr(`Usar ${nombre} la próxima vez`, `Use ${nombre} next time`)}</Texto>
                <Texto v="mini" color="texto3">
                  {tr('Tu contraseña queda en el llavero seguro del teléfono y solo se libera con tu biometría.', 'Your password stays in the phone’s secure keychain and is only released with your biometrics.')}
                </Texto>
              </View>
            </Pressable>
          ) : null}
          <Boton titulo={yendo ? tr('Verificando…', 'Verifying…') : accion || tr('Autorizar', 'Authorize')} icono="candado" cargando={yendo} deshabilitado={!clave || yendo} onPress={() => void enviar(clave)} />
          {activo ? <Boton titulo={tr(`Usar ${nombre}`, `Use ${nombre}`)} variante="fantasma" tam="chico" icono="huella" onPress={() => void usarBio()} /> : null}
        </View>
      )}
    </Hoja>
  );
}

const s = StyleSheet.create({
  bio: { width: 96, height: 96, borderRadius: 32, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  casillaFila: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  casilla: { width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center', marginTop: 2 },
});
