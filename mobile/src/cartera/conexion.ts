/**
 * TU CARTERA CONECTADA: la dirección PÚBLICA de tu Veta Wallet (con ella AU-RA solo puede LEER saldos).
 *
 * De dónde sale, en este orden:
 *   1. la que ya está guardada en este teléfono para esta persona;
 *   2. tu ficha en PULSE2CHAT (`/ficha`, campo `addr`): el chat y la wallet son la MISMA cuenta (la misma
 *      contraseña), así que con el chat conectado la cartera se conecta sola;
 *   3. tu perfil en el servidor de AU-RA (`cartera`), por si la conectaste en otro teléfono;
 *   4. si no hay ninguna, la hoja pide pegarla (Veta Wallet → Recibir → Copiar dirección).
 *
 * La que se encuentra se sube al perfil del servidor (PUT /api/perfil {cartera}) para que AURA también la
 * sepa («¿cuánto tengo en mi wallet?», lib/cartera.ts). Nunca viaja ni se guarda una contraseña.
 *
 * Es de quien estaba dentro AL EMPEZAR (auditoría AUR01): cada búsqueda captura la persona y la generación
 * de la sesión (lib/cuenta.ts) y las vuelve a mirar después de cada `await`, antes de guardar, de subir y de
 * devolver. Antes, el perfil o la ficha de A que llegaban con B dentro quedaban como la cartera de B (y se
 * subían a SU perfil), y desconectar la de A podía vaciar la del perfil de B.
 */
import * as SecureStore from 'expo-secure-store';
import { api } from '../lib/api';
import { alCambiarCuenta, correoCuenta, generacionCuenta, sigueVigente } from '../lib/cuenta';
import * as RELEVO from '../pulse/relevo';
import { direccionDeFicha, direccionValida } from './logica';

export type FuenteCartera = 'chat' | 'perfil' | 'manual';
export type MiCartera = { direccion: string; fuente: FuenteCartera };
type Guardada = MiCartera & { correo: string };
/** De quién es una búsqueda: la persona y la generación de su sesión al empezar. */
type Dueno = { correo: string; gen: number };

const CAJON = 'aura.cartera.direccion';
let actual: Guardada | null = null;
/** La última dirección subida al perfil, y de quién (`correo|dirección`). */
let subidaA = '';
const oyentes = new Set<() => void>();

const duenoAhora = (): Dueno => ({ correo: correoCuenta(), gen: generacionCuenta() });
const sigue = (d: Dueno) => !!d.correo && sigueVigente(d.gen);

function avisar() {
  for (const f of [...oyentes]) {
    try {
      f();
    } catch {
      /* nada */
    }
  }
}

export function escucharCartera(f: () => void): () => void {
  oyentes.add(f);
  return () => {
    oyentes.delete(f);
  };
}

/** La que ya se sabe en memoria (de esta persona), sin esperar a nada. */
export function carteraConocida(): MiCartera | null {
  const yo = correoCuenta();
  return actual && yo && actual.correo === yo ? { direccion: actual.direccion, fuente: actual.fuente } : null;
}

// Salir de AURA o entrar otra persona: la cartera en memoria de la anterior se suelta en el acto.
alCambiarCuenta(() => {
  actual = null;
  subidaA = '';
  avisar();
});

/** Lo que llega cuando la búsqueda ya no es de quien está dentro. */
const vencida = () => Object.assign(new Error('La sesión cambió mientras se guardaba la cartera.'), { code: 'vencida' });

/**
 * La deja como la cartera de `d` (en memoria y en el teléfono) y la sube a SU perfil, solo si `d` sigue
 * siendo quien está dentro. false = ya no lo era (no se avisa ni se sube nada).
 */
async function fijar(d: Dueno, direccion: string, fuente: FuenteCartera, o: { subir?: boolean } = {}): Promise<boolean> {
  if (!sigue(d)) return false;
  actual = { correo: d.correo, direccion, fuente };
  await SecureStore.setItemAsync(CAJON, JSON.stringify(actual)).catch(() => {});
  // Guardada queda a nombre de `d` (otra persona no la lee: guardadaAqui mira el correo); el resto, solo si sigue.
  if (!sigue(d)) return false;
  avisar();
  if (o.subir !== false) void subir(d, direccion);
  return true;
}

/** La sube al perfil del servidor de `d` (una vez por persona, dirección y arranque). Si falla, se reintenta la próxima vez. */
async function subir(d: Dueno, direccion: string) {
  const marca = `${d.correo}|${direccion.toLowerCase()}`;
  // api() sale con la sesión de quien está dentro al llamarla: solo se llama si sigue siendo `d`.
  if (subidaA === marca || !sigue(d)) return;
  try {
    await api('/api/perfil', { method: 'PUT', body: JSON.stringify({ cartera: direccion }) }, 15_000);
    if (sigue(d)) subidaA = marca;
  } catch {
    /* sin servidor ahora (o ya era otra sesión): AURA la sabrá la próxima vez */
  }
}

async function guardadaAqui(d: Dueno): Promise<Guardada | null> {
  if (!d.correo) return null;
  try {
    const g = JSON.parse((await SecureStore.getItemAsync(CAJON)) || 'null') as Guardada | null;
    if (g && g.correo === d.correo && direccionValida(g.direccion)) return g;
  } catch {
    /* nada guardado */
  }
  return null;
}

/** La de tu ficha en PULSE2CHAT, o null (sin chat conectado, o la ficha todavía sin dirección). */
export async function direccionDelChat(): Promise<string | null> {
  const yo = RELEVO.quien();
  if (!yo) return null;
  try {
    return direccionDeFicha(await RELEVO.ficha(yo.correo));
  } catch {
    return null;
  }
}

/** La dirección de Veta Wallet de alguien del chat (su ficha), o null si no la tiene a la vista. */
export async function direccionDe(correo: string): Promise<string | null> {
  if (!RELEVO.quien()) return null;
  try {
    return direccionDeFicha(await RELEVO.ficha(String(correo || '').toLowerCase()));
  } catch {
    return null;
  }
}

async function delPerfil(): Promise<string | null> {
  try {
    const r = await api<{ perfil?: { cartera?: string } | null }>('/api/perfil', { method: 'GET' }, 10_000);
    return direccionValida(r?.perfil?.cartera);
  } catch {
    return null;
  }
}

/**
 * Tu cartera: la guardada, la del chat o la del perfil (ver arriba). Con `revisar`, la del chat manda sobre
 * una guardada que vino del chat o del perfil (si cambiaste de cuenta en la wallet); una pegada a mano no se
 * pisa sola.
 */
export async function miCartera(o: { revisar?: boolean } = {}): Promise<MiCartera | null> {
  // De quien está dentro AHORA: si sale o entra otra persona mientras se busca, lo encontrado no es de nadie aquí.
  const d = duenoAhora();
  if (!d.correo) return null;
  const g: Guardada | null = actual && actual.correo === d.correo ? actual : await guardadaAqui(d);
  if (!sigue(d)) return null;
  if (g && (!actual || actual.correo !== d.correo)) {
    actual = g;
    avisar();
  }
  if (g && !o.revisar) {
    void subir(d, g.direccion);
    return { direccion: g.direccion, fuente: g.fuente };
  }
  if (!g || g.fuente !== 'manual') {
    const delChat = await direccionDelChat();
    if (!sigue(d)) return null;
    if (delChat) {
      if (!g || g.direccion.toLowerCase() !== delChat.toLowerCase()) {
        if (!(await fijar(d, delChat, 'chat'))) return null;
      } else void subir(d, delChat);
      return { direccion: delChat, fuente: 'chat' };
    }
  }
  if (g) return { direccion: g.direccion, fuente: g.fuente };
  const p = await delPerfil();
  // La respuesta del perfil es de la sesión que la pidió: con otra persona dentro no se aplica.
  if (!sigue(d)) return null;
  if (p) {
    if (!(await fijar(d, p, 'perfil', { subir: false }))) return null;
    subidaA = `${d.correo}|${p.toLowerCase()}`;
    return { direccion: p, fuente: 'perfil' };
  }
  return null;
}

/** La que pega la persona (Veta Wallet → Recibir → Copiar dirección). Lanza si no es una dirección. */
export async function conectarAMano(texto: string): Promise<MiCartera> {
  // Se acepta pegada con algo alrededor («Mi dirección: 0x…»): se toma la 0x… de 40 cifras.
  const m = String(texto || '').match(/0x[0-9a-fA-F]{40}(?![0-9a-fA-F])/);
  const d = direccionValida(m?.[0]);
  if (!d) throw new Error('Esa no es una dirección de Veta Wallet (0x seguida de 40 letras y números). En Veta Wallet: Recibir → Copiar dirección.');
  if (!(await fijar(duenoAhora(), d, 'manual'))) throw vencida();
  return { direccion: d, fuente: 'manual' };
}

/** Desconecta la cartera de este teléfono (y del perfil): AURA deja de leerla. Solo la de quien está dentro. */
export async function desconectar() {
  const d = duenoAhora();
  actual = null;
  subidaA = '';
  avisar();
  try {
    // La guardada de otra persona no se toca (es suya).
    const g = JSON.parse((await SecureStore.getItemAsync(CAJON)) || 'null') as Guardada | null;
    if (!g || g.correo === d.correo) await SecureStore.deleteItemAsync(CAJON);
  } catch {
    /* nada guardado, o sin llavero */
  }
  // Si mientras tanto salió o entró otra persona, el perfil del servidor de quien está ahora no se vacía.
  if (!sigue(d)) return;
  try {
    await api('/api/perfil', { method: 'PUT', body: JSON.stringify({ cartera: '' }) }, 15_000);
  } catch {
    /* sin servidor: se borra al volver a conectar otra */
  }
}

// Al salir de la cuenta del chat no se borra la cartera (es de la persona de AU-RA, no del chat).
