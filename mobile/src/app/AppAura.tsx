/**
 * LA CARCASA DE AU-RA 5.0: la raíz de la app (la variante AU-RA; Dr Electrum sigue por su lado).
 *
 *   GestureHandlerRootView  → gestos nativos en toda la app (hojas, deslizar para volver)
 *   SafeAreaProvider        → los bordes del teléfono (muesca, barra de gestos)
 *   NavigationContainer     → native-stack: cada pantalla es una pantalla nativa de Android, con sus
 *                             transiciones del sistema (deslizar desde la derecha, fundido)
 *
 * Rutas: Intro → Bienvenida → Entrar ⇄ CrearGenesis / OtrasFormas → PrimeraVez → Mesa ⇄ Ajustes ⇄ Perfil,
 * y Mesa ⇄ Chats ⇄ Conversacion.
 *
 * El chat (PulseProvider: cuenta, buzón, llamadas) y la voz de AURA (VozProvider: conversación con
 * ElevenLabs, la compañera flotante, el puente de acciones) envuelven la navegación entera: AURA sigue
 * oyendo mientras la persona chatea, y una llamada suena en cualquier pantalla. Se rehacen al cambiar
 * de persona (key por correo) para que nada de una sesión quede vivo en la siguiente. La compañera se
 * dibuja solo en las pantallas de la sesión, no en la intro ni en la entrada.
 *
 * Las pantallas que reemplazan la pila (desde la intro, al entrar, al salir) entran fundiéndose;
 * las que se abren encima (Ajustes, Crea tu Genesis ID), deslizándose desde la derecha.
 *
 * Cada pantalla va dentro de LimitePantalla: si una se rompe al dibujar, enseña «Reintentar» en su
 * lugar y lo reporta, sin tumbar la app entera.
 *
 * Las barras del sistema siguen al tema (iconos claros sobre fondo oscuro y al revés); en la intro y
 * en la mesa se esconden, como antes (la mesa es un escenario de pantalla completa). Al cambiar de
 * ruta se avisa por el bus (`emitir('pantalla', …)`) para que AURA sepa dónde está la persona, y lo
 * que AURA pide por el bus («vete atrás», «abre ajustes», «pon el tema claro») lo atiende acciones.ts.
 *
 * Encima de todo, con la sesión abierta, ComputadoraEnVivo: la vista en vivo de su computadora (se abre
 * sola cuando empieza una tarea) y sus correos, que se abren por voz desde cualquier pantalla.
 */
import { useEffect, useMemo, useState } from 'react';
import { AppState, Platform, type AppStateStatus } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { DarkTheme, DefaultTheme, NavigationContainer, type Theme } from '@react-navigation/native';
import { createNativeStackNavigator, type NativeStackNavigationOptions } from '@react-navigation/native-stack';
import * as SystemUI from 'expo-system-ui';
import { modoActual, orientar } from '../lib/orientacion';
import { guardarPerfil, reintentarAhora } from '../lib/perfil';
import { useIdioma } from '../i18n';
import { emitir } from '../nucleo/contrato';
import { useTema, type Paleta } from '../nucleo/tema';
import { alElegirIdioma } from '../ui/SelectorIdioma';
import { PulseProvider } from '../pulse/PulseProvider';
import { VozProvider } from '../compa/VozProvider';
import { Ajustes } from '../ajustes/Ajustes';
import { LoQueSabe } from '../ajustes/LoQueSabe';
import { PrimeraVez } from '../primeravez/PrimeraVez';
import { useAccionesDeAura } from './acciones';
import { AvisoActualizacion } from './AvisoActualizacion';
import { AvisoDesbloqueo } from './AvisoDesbloqueo';
import { ComputadoraEnVivo } from './ComputadoraEnVivo';
import { HojasCartera } from '../cartera/HojasCartera';
import { LimitePantalla } from './LimitePantalla';
import { Bienvenida } from './pantallas/Bienvenida';
import { CrearGenesis } from './pantallas/CrearGenesis';
import { Entrar } from './pantallas/Entrar';
import { Intro } from './pantallas/Intro';
import { Mesa } from './pantallas/Mesa';
import { Chats, Conversacion } from './pantallas/Chats';
import { OtrasFormas } from './pantallas/OtrasFormas';
import { abrirConversacion, abrirRuta, nav, pantallaDeRuta, RUTAS_DE_SESION, type RaizParams } from './rutas';
import { useUsuario } from './sesion';
import { usePush } from '../push/nativo';
import { prepararVoz } from '../lib/guardiaVoz';
import { useEnlacesHablar } from '../entrada/hablar';

const Pila = createNativeStackNavigator<RaizParams>();

/** El tema de la navegación con los colores del nuestro (el fondo entre transiciones, sin destellos). */
function temaNavegacion(t: Paleta): Theme {
  const base = t.oscuro ? DarkTheme : DefaultTheme;
  return {
    ...base,
    dark: t.oscuro,
    colors: { ...base.colors, primary: t.acento, background: t.fondo, card: t.fondo, text: t.texto, border: t.borde, notification: t.aviso },
  };
}

/** Los iconos de la barra de navegación de Android (la de abajo) según el tema. */
async function estiloBarraAndroid(oscuro: boolean) {
  if (Platform.OS !== 'android') return;
  try {
    const NavigationBar = require('expo-navigation-bar') as typeof import('expo-navigation-bar');
    await NavigationBar.setButtonStyleAsync(oscuro ? 'light' : 'dark');
  } catch {
    /* versión sin el módulo: se queda la del sistema */
  }
}

/** El botón Chat de la mesa (o un aviso) abre las pantallas del chat, no una ventana encima. */
function abrirChat(con?: string) {
  if (con) abrirConversacion(con);
  else abrirRuta('Chats');
}

export function AppAura() {
  useIdioma();
  const tema = useTema();
  useAccionesDeAura();
  // `ultronfp://hablar` (el «Abrir en AURA» de la burbuja del asistente): directo a la mesa, escuchando (entrada/hablar.ts).
  useEnlacesHablar();
  const usuario = useUsuario();
  // Avisos del servidor con la app cerrada (FCM): registra este teléfono al entrar y lo suelta al salir.
  usePush(usuario?.correo);
  const [ruta, setRuta] = useState<string | undefined>(undefined);
  const enSesion = !!usuario && !!ruta && RUTAS_DE_SESION.includes(ruta);

  // El fondo de la ventana (lo que se ve detrás del teclado y entre pantallas) y los iconos de abajo.
  useEffect(() => {
    void SystemUI.setBackgroundColorAsync(tema.fondo).catch(() => {});
    void estiloBarraAndroid(tema.oscuro);
  }, [tema]);

  // La voz en streaming (modules/aura-voz): lo guardado, la guardia y el interruptor remoto. Hasta leerlos, la de siempre.
  useEffect(() => {
    void prepararVoz();
  }, []);

  // El idioma se elige en muchos lugares (la entrada, la bienvenida, Ajustes, el menú de la mesa):
  // con sesión, también queda en el perfil.
  useEffect(() => {
    alElegirIdioma((i) => guardarPerfil({ idioma: i }));
    return () => alElegirIdioma(null);
  }, []);

  // Al volver de segundo plano: la orientación que tocaba (algunos Android la sueltan) y lo que quedó
  // sin mandar del perfil.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s: AppStateStatus) => {
      if (s !== 'active') return;
      void orientar(modoActual());
      reintentarAhora();
    });
    return () => sub.remove();
  }, []);

  const temaNav = useMemo(() => temaNavegacion(tema), [tema]);
  const barras: NativeStackNavigationOptions = {
    statusBarStyle: tema.oscuro ? 'light' : 'dark',
    statusBarHidden: false,
    navigationBarHidden: false,
  };
  const inmersiva: NativeStackNavigationOptions = { statusBarHidden: true, navigationBarHidden: true, statusBarStyle: 'light' };
  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: tema.fondo }}>
      <SafeAreaProvider>
        <PulseProvider key={`p:${usuario?.correo || 'nadie'}`} abrirChatEnModal={false} alAbrir={abrirChat}>
        <VozProvider key={`v:${usuario?.correo || 'nadie'}`} conCompanera={enSesion}>
        <NavigationContainer
          ref={nav}
          theme={temaNav}
          onReady={() => setRuta(nav.getCurrentRoute()?.name)}
          onStateChange={() => {
            const r = nav.getCurrentRoute()?.name;
            setRuta(r);
            const p = pantallaDeRuta(r);
            if (p) emitir('pantalla', { pantalla: p });
          }}
        >
          <Pila.Navigator
            initialRouteName="Intro"
            // Cada pantalla en su propia red de seguridad: si una se rompe al dibujar, no tumba la app.
            screenLayout={({ route, navigation, children }) => (
              <LimitePantalla pantalla={route.name} puedeVolver={() => navigation.canGoBack()} onVolver={() => navigation.goBack()}>
                {children}
              </LimitePantalla>
            )}
            screenOptions={{
              headerShown: false,
              animation: 'slide_from_right',
              gestureEnabled: true,
              fullScreenGestureEnabled: true,
              contentStyle: { backgroundColor: tema.fondo },
              ...barras,
            }}
          >
            <Pila.Screen name="Intro" component={Intro} options={{ animation: 'none', gestureEnabled: false, contentStyle: { backgroundColor: '#0B0B0D' }, ...inmersiva }} />
            <Pila.Screen name="Bienvenida" component={Bienvenida} options={{ animation: 'fade', gestureEnabled: false }} />
            <Pila.Screen name="Entrar" component={Entrar} options={{ animation: 'fade', gestureEnabled: false }} />
            <Pila.Screen name="CrearGenesis" component={CrearGenesis} />
            <Pila.Screen name="OtrasFormas" component={OtrasFormas} />
            <Pila.Screen name="PrimeraVez" component={PrimeraVez} options={{ animation: 'fade', gestureEnabled: false }} />
            <Pila.Screen name="Mesa" component={Mesa} options={{ animation: 'fade', gestureEnabled: false, contentStyle: { backgroundColor: '#1C1D20' }, ...inmersiva }} />
            <Pila.Screen name="Ajustes" component={Ajustes} />
            <Pila.Screen name="Perfil" component={LoQueSabe} />
            <Pila.Screen name="Chats" component={Chats} />
            <Pila.Screen name="Conversacion" component={Conversacion} />
          </Pila.Navigator>
        </NavigationContainer>
        {/* «Actualización lista · Reiniciar» (lib/ota.ts) en TODAS las pantallas, también antes de entrar (José, 5-oct:
            salía hasta llegar al avatar). */}
        <AvisoActualizacion />
        {/* «Toca para desbloquear»: la sesión venció y su clave está detrás de la huella (lib/permisoHuella.ts). */}
        {enSesion && <AvisoDesbloqueo />}
        {/* Su computadora en vivo (se abre sola al empezar una tarea) y sus correos, encima de cualquier pantalla. */}
        {enSesion && <ComputadoraEnVivo />}
        {/* Su cartera de Veta Wallet y «Enviar dinero» (cartera/): se abren desde un chat, el menú o por voz. */}
        {enSesion && <HojasCartera />}
        </VozProvider>
        </PulseProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
