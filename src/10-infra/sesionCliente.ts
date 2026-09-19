const KEY = 'ultron_sesion_token';

export function guardarTokenMesa(token: string) {
  try {
    if (token) sessionStorage.setItem(KEY, token);
    else sessionStorage.removeItem(KEY);
  } catch {
    /* private mode */
  }
}

export function tokenMesa(): string {
  try {
    return sessionStorage.getItem(KEY) || '';
  } catch {
    return '';
  }
}

export function headersMesa(): Record<string, string> {
  const t = tokenMesa();
  return t ? { 'x-ultron-sesion': t } : {};
}
