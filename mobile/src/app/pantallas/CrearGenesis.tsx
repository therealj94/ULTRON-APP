/**
 * «Crea tu Genesis ID»: para quien no tiene (o no ha terminado) su identidad de Orden Global.
 *
 * Tres pasos, cada uno en su tarjeta con su número dorado:
 *   1. Abre Orden Global (la app de la wallet) o la web de Veta Wallet
 *   2. Regístrate y verifica tu identidad (documento y selfie): así nace tu Genesis ID
 *   3. Vuelve aquí y toca «Entrar con Genesis ID»
 *
 * «Abrir la app Orden Global» usa `vetawallet://genesis`, el enlace con que la app abre su
 * verificación de identidad (si no hay sesión, la app lo guarda y lo atiende en cuanto la persona se
 * registra o entra). Si la app no está instalada, se abre su página en Google Play. «Registrarme en
 * la web» abre Veta Wallet en `/#verificar`, la misma verificación en la web (sin sesión, pasa antes
 * por la puerta de registro).
 */
import { Linking, StyleSheet, View } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { tr, useIdioma } from '../../i18n';
import { MEDIDA, useTema } from '../../nucleo/tema';
import { Aparecer, Boton, Icono, PantallaConCabecera, Tarjeta, Texto, type NombreIcono } from '../../ui';
import type { RaizParams } from '../rutas';

type Props = NativeStackScreenProps<RaizParams, 'CrearGenesis'>;

export const ENLACE_APP_GENESIS = 'vetawallet://genesis';
export const PAQUETE_ORDEN_GLOBAL = 'com.ordenglobal.app';
export const WEB_REGISTRO_GENESIS = 'https://app.vetawallet.com/#verificar';

/** La app Orden Global en su verificación; si no está instalada, su ficha en Google Play. */
export async function abrirAppOrdenGlobal() {
  try {
    await Linking.openURL(ENLACE_APP_GENESIS);
    return;
  } catch {
    /* no está instalada: la tienda */
  }
  try {
    await Linking.openURL(`market://details?id=${PAQUETE_ORDEN_GLOBAL}`);
  } catch {
    await WebBrowser.openBrowserAsync(`https://play.google.com/store/apps/details?id=${PAQUETE_ORDEN_GLOBAL}`).catch(() => {});
  }
}

export async function abrirWebRegistro() {
  await WebBrowser.openBrowserAsync(WEB_REGISTRO_GENESIS, { showTitle: true, enableBarCollapsing: true }).catch(() => Linking.openURL(WEB_REGISTRO_GENESIS).catch(() => {}));
}

function Paso({ n, icono, titulo, texto, retraso }: { n: number; icono: NombreIcono; titulo: string; texto: string; retraso: number }) {
  const tema = useTema();
  return (
    <Aparecer retraso={retraso}>
      <Tarjeta>
        <View style={s.paso}>
          <View style={[s.numero, { backgroundColor: tema.acento }]}>
            <Texto v="cuerpoFuerte" color="sobreAcento">
              {n}
            </Texto>
          </View>
          <View style={{ flex: 1, gap: 4 }}>
            <View style={s.filaTitulo}>
              <Texto v="subtitulo" style={{ flex: 1 }}>
                {titulo}
              </Texto>
              <Icono nombre={icono} tam={20} color={tema.acentoTexto} />
            </View>
            <Texto v="cuerpo" color="texto2">
              {texto}
            </Texto>
          </View>
        </View>
      </Tarjeta>
    </Aparecer>
  );
}

export function CrearGenesis({ navigation, route }: Props) {
  useIdioma();
  const tema = useTema();
  return (
    <PantallaConCabecera
      titulo={tr('Crea tu Genesis ID', 'Create your Genesis ID')}
      subtitulo={tr('Es gratis y toma unos minutos. Con él entras a AURA y a todo Orden Global.', 'It’s free and takes a few minutes. It opens AURA and all of Orden Global.')}
      onAtras={() => navigation.goBack()}
    >
      <View style={{ gap: MEDIDA.espacio.m }}>
        {route.params?.sinVerificar && (
          <Aparecer desde="escala">
            <View style={[s.aviso, { backgroundColor: tema.acentoFondo }]} accessibilityRole="alert">
              <Icono nombre="info" tam={18} color={tema.acentoTexto} />
              <Texto v="chica" color="texto" style={{ flex: 1 }}>
                {tr(
                  'Tu Genesis ID todavía no está verificado. Termina la verificación en tu wallet y vuelve.',
                  'Your Genesis ID isn’t verified yet. Finish the verification in your wallet and come back.'
                )}
              </Texto>
            </View>
          </Aparecer>
        )}
        <Paso
          n={1}
          icono="wallet"
          retraso={40}
          titulo={tr('Abre Orden Global', 'Open Orden Global')}
          texto={tr('La app de tu wallet. Si no la tienes, se descarga gratis, o usa la web de Veta Wallet.', 'Your wallet app. If you don’t have it, it’s a free download, or use the Veta Wallet website.')}
        />
        <Paso
          n={2}
          icono="escudo"
          retraso={110}
          titulo={tr('Regístrate y verifica tu identidad', 'Sign up and verify your identity')}
          texto={tr('Con tu documento y una selfie. Así nace tu Genesis ID, que solo es tuyo.', 'With your ID document and a selfie. That’s how your Genesis ID is born, and it’s yours alone.')}
        />
        <Paso
          n={3}
          icono="huella"
          retraso={180}
          titulo={tr('Vuelve y entra', 'Come back and sign in')}
          texto={tr('Toca «Entrar con Genesis ID» y tu wallet confirma que eres tú.', 'Tap “Sign in with Genesis ID” and your wallet confirms it’s you.')}
        />
        <Aparecer retraso={260} style={{ gap: MEDIDA.espacio.m, marginTop: MEDIDA.espacio.m }}>
          <Boton titulo={tr('Abrir la app Orden Global', 'Open the Orden Global app')} icono="wallet" onPress={() => void abrirAppOrdenGlobal()} />
          <Boton titulo={tr('Registrarme en la web', 'Sign up on the web')} icono="globo" variante="secundario" onPress={() => void abrirWebRegistro()} />
          <Boton titulo={tr('Ya tengo mi Genesis ID', 'I already have my Genesis ID')} variante="fantasma" onPress={() => navigation.goBack()} />
        </Aparecer>
      </View>
    </PantallaConCabecera>
  );
}

const s = StyleSheet.create({
  paso: { flexDirection: 'row', gap: 14, alignItems: 'flex-start' },
  numero: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  filaTitulo: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  aviso: { flexDirection: 'row', gap: 10, padding: 14, borderRadius: MEDIDA.radio.m, alignItems: 'center' },
});
