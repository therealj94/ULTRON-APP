/**
 * La clave propia en la puerta (`/api/electrum/entrar`, `/api/ultron/entrar`), cerrada si no se puede comprobar.
 *
 * Revisión 7 (G3, «ningún acceso si no puede comprobarse la autorización»): antes, si la base de cuentas lanzaba o no
 * contestaba, la entrada seguía por el cerebro remoto como si la persona no tuviera clave propia, y ese camino no mira
 * la suspensión: una cuenta suspendida entraba justo cuando la base fallaba. Ahora un fallo o un tope vencido es
 * 'sin_comprobar' y la puerta contesta 503 sin sesión. Sin base configurada (cuentasDisponibles() falso) no hay cuentas
 * que comprobar y el remoto sigue siendo la puerta, como siempre: eso lo decide server.ts antes de llamar aquí.
 */
export type EntradaPropia = 'ok' | 'mal' | 'suspendida' | 'sin_clave' | 'sin_comprobar';

/** Lo más que se espera a la base de cuentas en la entrada; pasado esto, no se entra. */
export const TOPE_CLAVE_PROPIA_MS = 8000;

export const SIN_COMPROBAR = {
  error: 'No pude comprobar tu cuenta ahora mismo. Intenta de nuevo en un momento.',
  codigo: 'CUENTA_SIN_COMPROBAR',
} as const;

export async function comprobarClavePropia(
  entrar: (correo: string, clave: string) => Promise<'ok' | 'mal' | 'suspendida' | 'sin_clave'>,
  correo: string,
  clave: string,
  topeMs = TOPE_CLAVE_PROPIA_MS
): Promise<EntradaPropia> {
  let reloj: ReturnType<typeof setTimeout> | undefined;
  const tope = new Promise<'tope'>((ok) => {
    reloj = setTimeout(() => ok('tope'), topeMs);
    reloj.unref?.();
  });
  try {
    const r = await Promise.race([Promise.resolve().then(() => entrar(correo, clave)), tope]);
    if (r === 'ok' || r === 'mal' || r === 'suspendida' || r === 'sin_clave') return r;
    return 'sin_comprobar';
  } catch (e: any) {
    console.error('[cuentas] base sin contestar en la entrada: no entra', String(e?.message || e).slice(0, 120));
    return 'sin_comprobar';
  } finally {
    clearTimeout(reloj);
  }
}
