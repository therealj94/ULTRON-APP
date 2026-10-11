/**
 * LAS RUTAS DE LA APP (native-stack) y la referencia a la navegación para quien no es pantalla: el
 * bus de acciones de AURA («vete atrás», «abre ajustes»), la sesión al cerrarse, la intro al terminar.
 *
 *   Intro → Bienvenida (primera vez sin sesión) → Entrar ⇄ CrearCuenta / CrearGenesis / OtrasFormas
 *        → PrimeraVez (si el perfil no está completado) → Mesa ⇄ Ajustes ⇄ Perfil
 *                                                           Mesa ⇄ Chats ⇄ Conversacion
 */
import { CommonActions, createNavigationContainerRef, StackActions } from '@react-navigation/native';
import type { Pantalla } from '../nucleo/contrato';

export type RaizParams = {
  Intro: undefined;
  Bienvenida: { desdeIntro?: boolean } | undefined;
  /** `reintentar`: pedir el pase al llegar (cambia en cada pedido, como `Chats.whatsapp`). */
  Entrar: { desdeIntro?: boolean; aviso?: string; codigo?: string; reintentar?: number } | undefined;
  CrearGenesis: { motivo?: 'sin-gid' } | undefined;
  /**
   * «Crear cuenta» de AU-RA (correo y contraseña), con la confirmación del correo por código. `correo`: el ya escrito.
   * `paso: 'codigo'`: directo al código (Entrar con una cuenta sin confirmar; el correo y la clave van en memoria).
   */
  CrearCuenta: { correo?: string; paso?: 'codigo' } | undefined;
  /** `aviso`: lo que se dice al llegar (la sesión terminó y hay clave o huella guardada en este teléfono). */
  OtrasFormas: { aviso?: string } | undefined;
  PrimeraVez: { desdeIntro?: boolean } | undefined;
  Mesa: { desdeIntro?: boolean; recienElegido?: boolean } | undefined;
  Ajustes: undefined;
  Perfil: undefined;
  /** `whatsapp`: abrir con la pestaña de WhatsApp (cambia en cada pedido: «abre WhatsApp» otra vez la vuelve a poner). */
  Chats: { whatsapp?: number } | undefined;
  Conversacion: { con: string; nombre?: string };
};

export type NombreRuta = keyof RaizParams;

export const nav = createNavigationContainerRef<RaizParams>();

/**
 * La ruta visible → la `Pantalla` del contrato (las de entrada no cuentan: AURA no vive ahí). Las
 * del chat no se anuncian desde aquí: lo hacen sus pantallas, que saben además con quién se habla.
 */
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
 * La entrada con clave o huella («Otras formas de entrar») con la de Genesis ID debajo: «atrás» vuelve a Entrar. Para
 * cuando la sesión terminó y en este teléfono hay una clave guardada de esa persona (Intro).
 */
export function reiniciarAClave(aviso: string) {
  if (!nav.isReady()) return;
  nav.dispatch(CommonActions.reset({ index: 1, routes: [{ name: 'Entrar', params: { desdeIntro: true } }, { name: 'OtrasFormas', params: { aviso } }] }));
}

/**
 * Abre una pantalla de la sesión. Si ya está en la pila, se vuelve a ella (no se apilan dos Ajustes);
 * la mesa es siempre la base.
 */
export function abrirRuta(ruta: 'Mesa' | 'Ajustes' | 'Perfil' | 'Chats', params?: RaizParams['Chats']) {
  if (!nav.isReady()) return;
  const estado = nav.getRootState();
  const nombres = estado?.routes.map((r) => r.name) || [];
  if (!nombres.includes('Mesa')) return;
  const i = nombres.lastIndexOf(ruta);
  if (i >= 0) {
    const sobran = nombres.length - 1 - i;
    if (sobran > 0) nav.dispatch(StackActions.pop(sobran));
    // Ya estaba: se le pasan los datos nuevos («abre WhatsApp» con los chats abiertos cambia de pestaña).
    if (params && estado?.routes[i]?.key) nav.dispatch({ ...CommonActions.setParams(params), source: estado.routes[i].key });
    return;
  }
  if (ruta === 'Perfil' && !nombres.includes('Ajustes')) nav.dispatch(StackActions.push('Ajustes'));
  nav.dispatch(StackActions.push(ruta, params));
}

/** «Abre WhatsApp»: los chats con la pestaña de WhatsApp (si la cuenta lo tiene; si no, PULSE2CHAT). */
export function abrirWhatsapp() {
  abrirRuta('Chats', { whatsapp: Date.now() });
}

export function atras(): boolean {
  if (!nav.isReady() || !nav.canGoBack()) return false;
  nav.goBack();
  return true;
}

/** Las rutas donde la sesión está abierta: ahí vive AURA (la compañera y su voz). */
export const RUTAS_DE_SESION: readonly string[] = ['Mesa', 'Ajustes', 'Perfil', 'Chats', 'Conversacion'];

/**
 * El hilo con una persona. Si ya está abierto con ella, se queda; si no, se abre encima de la lista
 * de chats (así «atrás» vuelve a la lista y luego a la mesa, como en cualquier app de mensajes).
 *
 * El correo va siempre en minúsculas: el hilo y su borrador (el que AURA dejó por voz) se guardan
 * así, y «el mismo hilo» se reconoce sin importar cómo vino escrito. Devuelve false si no se pudo
 * abrir (la navegación no está lista o no hay sesión): así AURA no dice «listo» en falso.
 */
export function abrirConversacion(con: string, nombre?: string): boolean {
  if (!nav.isReady()) return false;
  const correo = String(con || '').trim().toLowerCase();
  if (!correo) return false;
  const estado = nav.getRootState();
  const rutas = estado?.routes || [];
  if (!rutas.some((r) => r.name === 'Mesa')) return false;
  const arriba = rutas[rutas.length - 1];
  const abiertoCon = String((arriba?.params as RaizParams['Conversacion'] | undefined)?.con || '').toLowerCase();
  if (arriba?.name === 'Conversacion' && abiertoCon === correo) return true;
  if (arriba?.name === 'Conversacion') {
    nav.dispatch(StackActions.replace('Conversacion', { con: correo, nombre }));
    return true;
  }
  abrirRuta('Chats');
  nav.dispatch(StackActions.push('Conversacion', { con: correo, nombre }));
  return true;
}
