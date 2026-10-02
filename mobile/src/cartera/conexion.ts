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
 */
import * as SecureStore from 'expo-secure-store';
import { api } from '../lib/api';
import { correoCuenta } from '../lib/cuenta';
import * as RELEVO from '../pulse/relevo';
import { direccionDeFicha, direccionValida } from './logica';

export type FuenteCartera = 'chat' | 'perfil' | 'manual';
export type MiCartera = { direccion: string; fuente: FuenteCartera };
type Guardada = MiCartera & { correo: string };

const CAJON = 'aura.cartera.direccion';
let actual: Guardada | null = null;
let subidaA = '';
const oyentes = new Set<() => void>();

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

async function fijar(direccion: string, fuente: FuenteCartera, o: { subir?: boolean } = {}) {
  const yo = correoCuenta();
  if (!yo) return;
  actual = { correo: yo, direccion, fuente };
  await SecureStore.setItemAsync(CAJON, JSON.stringify(actual)).catch(() => {});
  avisar();
  if (o.subir !== false) void subir(direccion);
}

/** La sube al perfil del servidor (una vez por dirección y arranque). Si falla, se reintenta la próxima vez. */
async function subir(direccion: string) {
  if (subidaA === direccion.toLowerCase()) return;
  try {
    await api('/api/perfil', { method: 'PUT', body: JSON.stringify({ cartera: direccion }) }, 15_000);
    subidaA = direccion.toLowerCase();
  } catch {
    /* sin servidor ahora: AURA la sabrá la próxima vez */
  }
}

async function guardadaAqui(): Promise<Guardada | null> {
  const yo = correoCuenta();
  if (!yo) return null;
  try {
    const g = JSON.parse((await SecureStore.getItemAsync(CAJON)) || 'null') as Guardada | null;
    if (g && g.correo === yo && direccionValida(g.direccion)) return g;
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
  const yo = correoCuenta();
  if (!yo) return null;
  let g: Guardada | null = actual && actual.correo === yo ? actual : await guardadaAqui();
  if (g && (!actual || actual.correo !== yo)) {
    actual = g;
    avisar();
  }
  if (g && !o.revisar) {
    void subir(g.direccion);
    return { direccion: g.direccion, fuente: g.fuente };
  }
  if (!g || g.fuente !== 'manual') {
    const delChat = await direccionDelChat();
    if (delChat) {
      if (!g || g.direccion.toLowerCase() !== delChat.toLowerCase()) await fijar(delChat, 'chat');
      else void subir(delChat);
      return { direccion: delChat, fuente: 'chat' };
    }
  }
  if (g) return { direccion: g.direccion, fuente: g.fuente };
  const p = await delPerfil();
  if (p) {
    await fijar(p, 'perfil', { subir: false });
    subidaA = p.toLowerCase();
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
  await fijar(d, 'manual');
  return { direccion: d, fuente: 'manual' };
}

/** Desconecta la cartera de este teléfono (y del perfil): AURA deja de leerla. */
export async function desconectar() {
  actual = null;
  subidaA = '';
  await SecureStore.deleteItemAsync(CAJON).catch(() => {});
  avisar();
  try {
    await api('/api/perfil', { method: 'PUT', body: JSON.stringify({ cartera: '' }) }, 15_000);
  } catch {
    /* sin servidor: se borra al volver a conectar otra */
  }
}

// Al salir de la cuenta del chat no se borra la cartera (es de la persona de AU-RA, no del chat).
