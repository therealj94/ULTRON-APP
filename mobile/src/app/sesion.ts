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
import { borrarRastrosViejos, getFingerprintUnlock, loadCreds, saveCreds, saveMesaToken, saveSession } from '../lib/storage';
import { fijarCuenta, generacionCuenta, sigueVigente } from '../lib/cuenta';
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
  // La generación de la sesión (lib/cuenta.ts): lo que siga en vuelo de la persona anterior ya no aplica.
  fijarCuenta(u?.correo ?? null);
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
  await olvidarClaveAjena(s.correo);
  await saveSession(s).catch(() => {});
  fijarUsuario(s);
  const gen = generacionCuenta();
  const p = await cargarPerfil(s.correo, { nombre: s.name, genesis: compartido || null, topeMs: 6_000 });
  // Si mientras cargaba el perfil salió (o entró otra persona), esta entrada ya no navega.
  if (!sigueVigente(gen)) return;
  reiniciarA(p.completado ? 'Mesa' : 'PrimeraVez');
}

/** La clave guardada de OTRA persona no sobrevive a que entre alguien distinto en este teléfono. */
async function olvidarClaveAjena(correo: string) {
  const creds = await loadCreds();
  if (creds?.correo && creds.correo.trim().toLowerCase() !== correo) await saveCreds(null);
}

async function guardarClaveSoloConHuella(correo: string, gen: number) {
  const [creds, huella] = await Promise.all([loadCreds(), getFingerprintUnlock()]);
  // Si alguien entró mientras se leía, la clave guardada ya puede ser la suya: no se toca.
  if (!creds || !sigueVigente(gen)) return;
  const mismo = (c?: string) => !!c && !!correo && c.trim().toLowerCase() === correo.trim().toLowerCase();
  if (!(huella?.enabled && mismo(huella.correo) && mismo(creds.correo))) await saveCreds(null);
}

/**
 * La sesión guardada ya no vale (venció, la cerraron en otro lado o es de otra cuenta): se borra aquí
 * sin pasar por el servidor, y la intro lleva a la entrada con el aviso. Deja el MISMO estado seguro
 * que cerrar sesión: también se olvida la cuenta del chat de este teléfono (antes quedaba guardada y
 * el chat la recuperaba aunque AU-RA ya no tuviera a nadie dentro).
 */
export async function soltarSesionCaida() {
  miga('sesión guardada caída: a la entrada');
  soltarPerfil();
  fijarUsuario(null);
  await Promise.all([saveSession(null), saveMesaToken(null), salirDelChat()]).catch(() => {});
}

/** Cerrar sesión desde la mesa o desde Ajustes: vuelve a la entrada. */
export function salirDeLaSesion() {
  miga('cerrando sesión');
  // El historial del turno vive en la mesa y se va con ella; la memoria de largo plazo es por
  // persona. La clave guardada solo se queda si su dueño activó entrar con huella (la usa «Otras
  // formas de entrar»); si no, se va: en un teléfono compartido nadie debe quedar con la ajena.
  const quien = usuario?.correo || '';
  // Primero se suelta a la persona (generación nueva): nada de lo que sigue en vuelo puede tocar a
  // quien entre después.
  soltarPerfil();
  fijarUsuario(null);
  const gen = generacionCuenta();
  void guardarClaveSoloConHuella(quien, gen);
  void saveSession(null);
  // Revoca SOLO el token de esta persona (lo captura al empezar; ver lib/api.ts).
  void logoutRemote();
  void borrarRastrosViejos();
  // El chat es de esta persona: al salir se olvida la llave del relevo en este teléfono.
  void salirDelChat();
  recienElegido = false;
  reiniciarA('Entrar');
}
