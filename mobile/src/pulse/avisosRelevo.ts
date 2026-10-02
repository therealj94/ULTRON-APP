/**
 * Que el chat (PULSE2CHAT) avise con la app cerrada.
 *
 * En cuanto hay cuenta del chat en este teléfono y sesión de AU-RA, se le pide al servidor de AU-RA la
 * referencia firmada (GET /api/push/relevo/ref) y se apunta en el relevo (pulse/relevo.ts apuntarAvisos).
 * Cuando llega un mensaje, el relevo se la devuelve a AU-RA y AU-RA avisa a los teléfonos de la persona
 * por Firebase (push/nativo.ts lo recibe y, al tocarlo, abre los chats). Una vez por cuenta del chat y
 * por arranque; si falla (sin red, servidor sin configurar), se reintenta en el próximo cambio de cuenta.
 */
import { api } from '../lib/api';
import { apuntarAvisos, escucharCuenta, quien } from './relevo';

let apuntadoPara = '';
let quitar: (() => void) | null = null;

async function apuntar() {
  const c = quien();
  if (!c) {
    apuntadoPara = '';
    return;
  }
  const clave = `${c.correo}|${c.aura || ''}`;
  if (apuntadoPara === clave) return;
  try {
    const r = await api<{ ref?: string }>('/api/push/relevo/ref', { method: 'GET' }, 12_000);
    if (!r?.ref || quien() !== c) return;
    await apuntarAvisos(r.ref);
    apuntadoPara = clave;
  } catch {
    /* sin red o sin configurar: se intenta otra vez con el próximo cambio de cuenta o arranque */
  }
}

/** Una vez al entrar a AU-RA (push/nativo.ts usePush): apunta ya y cada vez que cambie la cuenta del chat. */
export function iniciarAvisosRelevo(): void {
  if (!quitar) quitar = escucharCuenta(() => void apuntar());
  void apuntar();
}
