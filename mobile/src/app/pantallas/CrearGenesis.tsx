/**
 * «Crea tu Genesis ID»: para quien no tiene (o no ha terminado) su identidad de Orden Global.
 *
 * Tres pasos, cada uno en su tarjeta con su número dorado:
 *   1. Abre Orden Global (la app de la wallet) o la web de Veta Wallet
 *   2. Regístrate y verifica tu identidad (documento y selfie): así nace tu Genesis ID
 *   3. Al terminar, la wallet te trae de vuelta a AURA y entras solo
 *
 * «Crear mi Genesis ID» (el botón principal) NO abre la verificación suelta: vuelve a «Entrar» y pide
 * el pase (`reintentar`). La wallet ve que no hay Genesis ID, ofrece sacarlo ahí mismo con el pedido
 * de AU-RA guardado y, al terminar, sigue al «Permitir» y vuelve aquí con el pase: la entrada se
 * completa sola (docs/ENTRAR-GENESIS.md, caso b). «Ya tengo mi Genesis ID» hace lo mismo.
 *
 * «Abrir la app Orden Global» (secundario) usa `vetawallet://genesis`, el enlace con que la app abre su
 * verificación de identidad (si no hay sesión, la app lo guarda y lo atiende en cuanto la persona se
 * registra o entra). Si la app no está instalada, se abre su página en Google Play. «Registrarme en
 * la web» abre Veta Wallet en `/#verificar`, la misma verificación en la web (sin sesión, pasa antes
 * por la puerta de registro).
 *
 * «Entrar sin Genesis ID» vuelve a «Entrar»: con el correo y la contraseña de Veta Wallet se entra como
 * miembro aunque no haya Genesis ID (docs/ENTRAR-GENESIS.md, caso f).
 *
 * `motivo: 'sin-gid'`: llegó aquí porque la wallet contestó que no tiene Genesis ID (Entrar.tsx); se
 * dice arriba, para que no parezca que la entrada simplemente falló. (Quien lo tiene y está en
 * verificación NO llega aquí: Entrar le muestra su propia tarjeta.)
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

/** La ficha de Orden Global en Google Play (la tienda si está; si no, la página web de la tienda). */
export async function abrirTiendaOrdenGlobal() {
  try {
    await Linking.openURL(`market://details?id=${PAQUETE_ORDEN_GLOBAL}`);
  } catch {
    await WebBrowser.openBrowserAsync(`https://play.google.com/store/apps/details?id=${PAQUETE_ORDEN_GLOBAL}`).catch(() => {});
  }
}

/** La app Orden Global en su verificación; si no está instalada, su ficha en Google Play. */
export async function abrirAppOrdenGlobal() {
  try {
    await Linking.openURL(ENLACE_APP_GENESIS);
    return;
  } catch {
    /* no está instalada: la tienda */
  }
  await abrirTiendaOrdenGlobal();
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
      subtitulo={tr('Es gratis y toma unos minutos. Con él entras a AU-RA y a todo Orden Global.', 'It’s free and takes a few minutes. It opens AU-RA and all of Orden Global.')}
      onAtras={() => navigation.goBack()}
    >
      <View style={{ gap: MEDIDA.espacio.m }}>
        {route.params?.motivo === 'sin-gid' && (
          <Aparecer desde="escala">
            <View style={[s.aviso, { backgroundColor: tema.acentoFondo }]} accessibilityRole="alert">
              <Icono nombre="info" tam={18} color={tema.acentoTexto} />
              <Texto v="chica" color="texto" style={{ flex: 1 }}>
                {tr(
                  'Tu wallet todavía no tiene un Genesis ID. Créalo en tu wallet: al terminar te trae de vuelta y entras solo.',
                  'Your wallet doesn’t have a Genesis ID yet. Create it in your wallet: when you’re done it brings you back and you’re in.'
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
          titulo={tr('Vuelves solo a AU-RA', 'You’re brought back to AU-RA')}
          texto={tr(
            'Al terminar, tu wallet te pide permiso y te trae de vuelta: entras sin hacer nada más. Si no vuelve sola, toca «Ya tengo mi Genesis ID».',
            'When you finish, your wallet asks for permission and brings you back: you’re in. If it doesn’t come back by itself, tap “I already have my Genesis ID”.'
          )}
        />
        <Aparecer retraso={260} style={{ gap: MEDIDA.espacio.m, marginTop: MEDIDA.espacio.m }}>
          {/* Por la puerta de AU-RA: la wallet guarda el pedido mientras se crea el Genesis ID y vuelve sola. */}
          <Boton
            titulo={tr('Crear mi Genesis ID', 'Create my Genesis ID')}
            icono="huella"
            onPress={() => navigation.navigate('Entrar', { reintentar: Date.now() })}
            etiqueta={tr('Crear mi Genesis ID en mi wallet y volver a AU-RA', 'Create my Genesis ID in my wallet and come back to AU-RA')}
          />
          <Boton titulo={tr('Abrir la app Orden Global', 'Open the Orden Global app')} icono="wallet" variante="secundario" onPress={() => void abrirAppOrdenGlobal()} />
          <Boton titulo={tr('Registrarme en la web', 'Sign up on the web')} icono="globo" variante="secundario" onPress={() => void abrirWebRegistro()} />
          <Boton titulo={tr('Ya tengo mi Genesis ID', 'I already have my Genesis ID')} variante="fantasma" onPress={() => navigation.navigate('Entrar', { reintentar: Date.now() })} />
          {/* Sin Genesis ID también se entra, como miembro, con la cuenta de Veta Wallet (docs/ENTRAR-GENESIS.md, caso f). */}
          <Boton
            titulo={tr('Entrar sin Genesis ID, con mi cuenta de Veta Wallet', 'Sign in without a Genesis ID, with my Veta Wallet account')}
            variante="fantasma"
            onPress={() => navigation.navigate('Entrar')}
          />
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
