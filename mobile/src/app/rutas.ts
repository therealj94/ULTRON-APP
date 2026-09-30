/**
 * LAS RUTAS DE LA APP (native-stack) y la referencia a la navegación para quien no es pantalla: el
 * bus de acciones de AURA («vete atrás», «abre ajustes»), la sesión al cerrarse, la intro al terminar.
 *
 *   Intro → Bienvenida (primera vez sin sesión) → Entrar ⇄ CrearGenesis / OtrasFormas
 *        → PrimeraVez (si el perfil no está completado) → Mesa ⇄ Ajustes ⇄ Perfil
 */
import { CommonActions, createNavigationContainerRef, StackActions } from '@react-navigation/native';
import type { Pantalla } from '../nucleo/contrato';

export type RaizParams = {
  Intro: undefined;
  Bienvenida: { desdeIntro?: boolean } | undefined;
  Entrar: { desdeIntro?: boolean; aviso?: string; codigo?: string } | undefined;
  CrearGenesis: { sinVerificar?: boolean } | undefined;
  OtrasFormas: undefined;
  PrimeraVez: { desdeIntro?: boolean } | undefined;
  Mesa: { desdeIntro?: boolean; recienElegido?: boolean } | undefined;
  Ajustes: undefined;
  Perfil: undefined;
};

export type NombreRuta = keyof RaizParams;

export const nav = createNavigationContainerRef<RaizParams>();

/** La ruta visible → la `Pantalla` del contrato (las de entrada no cuentan: AURA no vive ahí). */
export function pantallaDeRuta(r: string | undefined): Pantalla | null {
  if (r === 'Mesa') return 'mesa';
  if (r === 'Ajustes') return 'ajustes';
  if (r === 'Perfil') return 'perfil';
  return null;
}

export function rutaActual(): NombreRuta | undefined {
  return nav.isReady() ? (nav.getCurrentRoute()?.name as NombreRuta | undefined) : undefined;
}

/** Deja la pila con una sola pantalla (entrar, salir, terminar la primera vez): «atrás» no vuelve. */
export function reiniciarA<R extends NombreRuta>(ruta: R, params?: RaizParams[R]) {
  if (!nav.isReady()) return;
  nav.dispatch(CommonActions.reset({ index: 0, routes: [{ name: ruta, params }] }));
}

/**
 * Abre una pantalla de la sesión. Si ya está en la pila, se vuelve a ella (no se apilan dos Ajustes);
 * la mesa es siempre la base.
 */
export function abrirRuta(ruta: 'Mesa' | 'Ajustes' | 'Perfil') {
  if (!nav.isReady()) return;
  const estado = nav.getRootState();
  const nombres = estado?.routes.map((r) => r.name) || [];
  if (!nombres.includes('Mesa')) return;
  const i = nombres.lastIndexOf(ruta);
  if (i >= 0) {
    const sobran = nombres.length - 1 - i;
    if (sobran > 0) nav.dispatch(StackActions.pop(sobran));
    return;
  }
  if (ruta === 'Perfil' && !nombres.includes('Ajustes')) nav.dispatch(StackActions.push('Ajustes'));
  nav.dispatch(StackActions.push(ruta));
}

export function atras(): boolean {
  if (!nav.isReady() || !nav.canGoBack()) return false;
  nav.goBack();
  return true;
}
