// ../lib/api de mentira para el visor: el mismo contrato de errores que lib/api.ts (pedirApi) sobre el `fetch` global
// —que la prueba cambia por el servidor falso de /api/computadora—, sin sesión, token ni aparato:
//   · respuesta no-ok → Error con `status` y `data` (el código del servidor en data.code);
//   · no llegó (red caída, se cortó esperando) → el error de fetch tal cual, SIN status (así lo trata el visor: red).
const API_BASE = 'https://aura.prueba';

async function api(path, init, timeoutMs = 30_000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), Math.max(1, timeoutMs));
  try {
    const res = await fetch(`${API_BASE}${path}`, { ...init, signal: ctrl.signal, headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...(init?.headers || {}) } });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || `HTTP ${res.status}`);
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { api, API_BASE };
