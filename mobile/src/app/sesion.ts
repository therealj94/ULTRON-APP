/**
 * LA SESIÓN DE LA CARCASA: quién entró, qué perfil tiene y a dónde va después.
 *
 * Un almacén de módulo (como el perfil): lo leen la intro, las pantallas de entrada, la mesa y
 * Ajustes. Entrar (con Genesis ID o con clave) guarda la sesión, carga el perfil y decide la ruta:
 * la primera vez si el perfil no está completado, la mesa si ya lo está. Salir borra la sesión, el
 * pase del chat y suelta el perfil (la caché del perfil de esa persona se queda para su vuelta).
 */
import { useSyncExternalStore } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { SessionUser } from '../config';
import { logoutRemote } from '../lib/api';
import { cargarPerfil, soltarPerfil } from '../lib/perfil';
import { borrarRastrosViejos, saveSession } from '../lib/storage';
import { salir as salirDelChat } from '../pulse/relevo';
import { miga } from '../lib/reporte';
import { reiniciarA } from './rutas';

/** Lo que Genesis ID compartió al entrar (si el servidor lo manda: `genesis` de /api/genesis/entrar). */
export type Compartido = { nombre?: string | null; cumple?: string | null };

let usuario: SessionUser | null = null;
/** El avatar se acaba de elegir en la primera vez: la mesa lo presenta con su voz al abrirse. */
let recienElegido = false;
const oyentes = new Set<() => void>();
const avisar = () => {
  for (const f of [...oyentes]) f();
};

export function usuarioActual(): SessionUser | null {
  return usuario;
}

export function useUsuario(): SessionUser | null {
  return useSyncExternalStore(
    (f) => {
      oyentes.add(f);
      return () => oyentes.delete(f);
    },
    () => usuario,
    () => usuario
  );
}

export function fijarUsuario(u: SessionUser | null) {
  usuario = u;
  avisar();
}

export function marcarRecienElegido(si: boolean) {
  recienElegido = si;
}

export function tomarRecienElegido(): boolean {
  const r = recienElegido;
  recienElegido = false;
  return r;
}

/* ── la bienvenida se ve una vez por teléfono ─────────────────────────────────────────────── */

const CLAVE_BIENVENIDA = 'aura.bienvenida.vista.v1';

export async function bienvenidaVista(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(CLAVE_BIENVENIDA)) === '1';
  } catch {
    return false;
  }
}

export async function marcarBienvenidaVista() {
  await AsyncStorage.setItem(CLAVE_BIENVENIDA, '1').catch(() => {});
}

/* ── entrar y salir ───────────────────────────────────────────────────────────────────────── */

/**
 * Tras verificar quién es (Genesis o clave): guarda la sesión, carga su perfil (sin esperar más de
 * unos segundos al servidor) y lleva a la primera vez o a la mesa.
 */
export async function entrarCon(u: SessionUser, compartido?: Compartido | null) {
  miga('entró: cargando perfil');
  const s = { ...u, correo: u.correo.trim().toLowerCase() };
  await saveSession(s).catch(() => {});
  fijarUsuario(s);
  const p = await cargarPerfil(s.correo, { nombre: s.name, genesis: compartido || null, topeMs: 6_000 });
  reiniciarA(p.completado ? 'Mesa' : 'PrimeraVez');
}

/** Cerrar sesión desde la mesa o desde Ajustes: vuelve a la entrada. */
export function salirDeLaSesion() {
  miga('cerrando sesión');
  // El historial del turno vive en la mesa y se va con ella; la memoria de largo plazo es por
  // persona. Las credenciales guardadas se quedan: las usa «Otras formas de entrar».
  void saveSession(null);
  void logoutRemote();
  void borrarRastrosViejos();
  // El chat es de esta persona: al salir se olvida la llave del relevo en este teléfono.
  void salirDelChat();
  soltarPerfil();
  fijarUsuario(null);
  recienElegido = false;
  reiniciarA('Entrar');
}
