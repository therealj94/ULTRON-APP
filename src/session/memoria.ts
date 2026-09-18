const KEY = 'ultron_memoria_larga';

export function leerLarga(): string[] {
  try {
    const raw = localStorage.getItem(KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.slice(0, 80) : [];
  } catch {
    return [];
  }
}

export function guardarHecho(hecho: string) {
  const next = [hecho, ...leerLarga().filter((x) => x !== hecho)].slice(0, 80);
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch { /* quota */ }
  fetch('/api/memoria', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ hecho }),
  }).catch(() => {});
}

export function olvidarTodo() {
  try {
    localStorage.removeItem(KEY);
  } catch { /* */ }
  fetch('/api/memoria', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ olvidar: true }),
  }).catch(() => {});
}
