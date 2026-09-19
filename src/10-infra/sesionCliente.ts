const KEY = 'ultron_sesion_token';

function store() {
  try {
    return window.localStorage;
  } catch {
    try {
      return window.sessionStorage;
    } catch {
      return null;
    }
  }
}

export function guardarTokenMesa(token: string) {
  const s = store();
  if (!s) return;
  try {
    if (token) s.setItem(KEY, token);
    else s.removeItem(KEY);
  } catch {
    /* private mode */
  }
}

export function tokenMesa(): string {
  try {
    return localStorage.getItem(KEY) || sessionStorage.getItem(KEY) || '';
  } catch {
    return '';
  }
}

export function headersMesa(): Record<string, string> {
  const t = tokenMesa();
  return t ? { 'x-ultron-sesion': t } : {};
}
