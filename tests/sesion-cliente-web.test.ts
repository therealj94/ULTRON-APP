/**
 * IOS01 (auditoría del 3-oct): la sesión de la web (src/10-infra/sesionCliente.ts) en el icono del iPhone.
 *
 * iOS copia las COOKIES de Safari a la web instalada en Inicio (desde 17.2), pero no localStorage: quien
 * entraba en Safari y después instalaba el icono abría AURA sin sesión. Lo que tiene que ser verdad:
 *   · en Safari de iPhone/iPad (https) la sesión se copia también en una cookie propia (Secure, SameSite=Strict,
 *     Path=/, con la vida de la sesión), y el icono recién instalado la recoge y la vuelve a poner en su
 *     localStorage;
 *   · salir la borra de los dos sitios;
 *   · en Android, escritorio y Windows (sin `navigator.standalone`) no cambia nada: ni cookie;
 *   · sin https no se escribe la cookie (Secure no se puede) y una cookie con basura no se toma por sesión.
 */
import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';

/** Un navegador de mentira: localStorage, sessionStorage y document.cookie que entiende Max-Age=0. */
function navegador(o: { ios: boolean; https: boolean; cookies?: Map<string, string> }) {
  const mapa = () => {
    const m = new Map<string, string>();
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, String(v)), removeItem: (k: string) => void m.delete(k), m };
  };
  const cookies = o.cookies ?? new Map<string, string>();
  const escritas: string[] = [];
  const local = mapa();
  const sesion = mapa();
  /** Las peticiones que la página hace por su cuenta (fetch de mentira: responde 200 y apunta). */
  const pedidas: Array<{ url: string; headers: Record<string, string> }> = [];
  const fetch = async (url: string, init?: { headers?: Record<string, string> }) => {
    pedidas.push({ url: String(url), headers: { ...(init?.headers || {}) } });
    return { ok: true, status: 200, json: async () => ({ authenticated: true }) };
  };
  const document = {
    get cookie() {
      return [...cookies].map(([k, v]) => `${k}=${v}`).join('; ');
    },
    set cookie(linea: string) {
      escritas.push(linea);
      const [par, ...attrs] = linea.split(';').map((s) => s.trim());
      const i = par.indexOf('=');
      const k = par.slice(0, i);
      if (attrs.some((a) => /^max-age=0$/i.test(a))) cookies.delete(k);
      else cookies.set(k, par.slice(i + 1));
    },
  };
  const navigator: Record<string, unknown> = { userAgent: o.ios ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)' : 'Mozilla/5.0 (Linux; Android 15)' };
  if (o.ios) navigator.standalone = false;
  Object.assign(globalThis, {
    window: { localStorage: local, sessionStorage: sesion, location: { protocol: o.https ? 'https:' : 'http:' }, matchMedia: () => ({ matches: false }) },
    localStorage: local,
    sessionStorage: sesion,
    document,
    location: { protocol: o.https ? 'https:' : 'http:' },
    fetch,
  });
  Object.defineProperty(globalThis, 'navigator', { value: navigator, configurable: true, writable: true });
  return { cookies, escritas, local, pedidas };
}

const S = await import('../src/10-infra/sesionCliente');
const TOKEN = 'eyJhbGciOiJIUzI1NiJ9.eyJjIjoiYW5hQHguaG4ifQ.firma_de_prueba-123';

beforeEach(() => navegador({ ios: false, https: true }));

test('Android / escritorio / Windows: como siempre, solo localStorage y ninguna cookie', () => {
  const n = navegador({ ios: false, https: true });
  S.guardarTokenMesa(TOKEN);
  assert.equal(n.local.m.get('ultron_sesion_token'), TOKEN);
  assert.equal(n.escritas.length, 0, 'no se escribe cookie fuera de iOS');
  assert.deepEqual(S.headersMesa(), { 'x-ultron-sesion': TOKEN });
});

test('Safari de iPhone: la sesión va también a la cookie espejo, Secure y SameSite=Strict, con la vida de la sesión', () => {
  const n = navegador({ ios: true, https: true });
  S.guardarTokenMesa(TOKEN);
  const linea = n.escritas.at(-1) || '';
  assert.match(linea, new RegExp(`^${S.COOKIE_ESPEJO}=`));
  assert.match(linea, /; Path=\//);
  assert.match(linea, /; Secure/);
  assert.match(linea, /; SameSite=Strict/);
  assert.match(linea, /; Max-Age=1209600/, 'catorce días, como la sesión');
  assert.doesNotMatch(linea, /HttpOnly/, 'la lee la propia web (el servidor sigue leyendo la cabecera, no la cookie)');
});

test('el icono recién instalado (cookies copiadas, localStorage vacío) entra con la sesión y la guarda', () => {
  const enSafari = navegador({ ios: true, https: true });
  S.guardarTokenMesa(TOKEN);
  // Instalar: iOS copia las cookies; el localStorage del icono nace vacío.
  const icono = navegador({ ios: true, https: true, cookies: new Map(enSafari.cookies) });
  assert.equal(icono.local.m.size, 0);
  assert.equal(S.tokenMesa(), TOKEN);
  assert.deepEqual(S.headersMesa(), { 'x-ultron-sesion': TOKEN });
  assert.equal(icono.local.m.get('ultron_sesion_token'), TOKEN, 'y queda en su localStorage');
});

test('salir borra la sesión de los dos sitios', () => {
  const n = navegador({ ios: true, https: true });
  S.guardarTokenMesa(TOKEN);
  S.guardarTokenMesa('');
  assert.equal(n.local.m.get('ultron_sesion_token'), undefined);
  assert.equal(n.cookies.has(S.COOKIE_ESPEJO), false);
  assert.match(n.escritas.at(-1) || '', /Max-Age=0/);
  assert.equal(S.tokenMesa(), '');
});

test('sin https no hay cookie (Secure no se puede), y una cookie con basura no es sesión', () => {
  const n = navegador({ ios: true, https: false });
  S.guardarTokenMesa(TOKEN);
  assert.equal(n.escritas.length, 0);
  const raro = navegador({ ios: true, https: true, cookies: new Map([[S.COOKIE_ESPEJO, encodeURIComponent('<script>alert(1)</script>')]]) });
  assert.equal(S.tokenMesa(), '');
  assert.equal(raro.local.m.size, 0);
});

test('icono instalado: se sabe (para pedir entrar ahí dentro, con su explicación)', () => {
  navegador({ ios: true, https: true });
  assert.equal(S.enIconoInstalado(), false);
  (globalThis.navigator as any).standalone = true;
  assert.equal(S.enIconoInstalado(), true);
});

test('recepción (5-oct): solo la comprobación de sesión lleva qué build corre; el id se renueva al cambiar la sesión', () => {
  const n = navegador({ ios: false, https: true });
  assert.deepEqual(S.headersComprobarSesion(), {}, 'sin sesión, nada');
  S.guardarTokenMesa(TOKEN);
  const h = S.headersComprobarSesion();
  assert.equal(h['x-ultron-sesion'], TOKEN);
  assert.match(h['x-aura-cliente'], /^v1;p=web;i=[A-Za-z0-9-]{8,64}$/, 'sin meta del build (desarrollo), sin `w`');
  assert.deepEqual(S.headersMesa(), { 'x-ultron-sesion': TOKEN }, 'las demás peticiones, como siempre');
  const id = h['x-aura-cliente'].split('i=')[1];
  assert.equal(S.headersComprobarSesion()['x-aura-cliente'].split('i=')[1], id, 'estable con la misma sesión');
  S.guardarTokenMesa('');
  assert.equal(n.local.m.get('aura_recepcion_instalacion'), undefined, 'al salir se olvida');
  S.guardarTokenMesa(TOKEN);
  assert.notEqual(S.headersComprobarSesion()['x-aura-cliente'].split('i=')[1], id, 'la sesión nueva estrena id');
});

test('recepción tras entrar (revisión del 5-oct): la web anota su build en cuanto entra, sin recargar, una sola vez', () => {
  // La PWA abierta SIN sesión: la comprobación del arranque no lleva nada (no hay a quién anotarlo).
  const n = navegador({ ios: false, https: true });
  assert.deepEqual(S.headersComprobarSesion(), {});
  // Entrar con correo y clave (AccesoModal.entrar), Genesis (App.tsx) o un enlace de correo: todos guardan el token.
  S.guardarTokenMesa(TOKEN);
  const conCabecera = n.pedidas.filter((p) => p.headers['x-aura-cliente']);
  assert.equal(conCabecera.length, 1, 'una petición con qué build corre, en el acto');
  assert.equal(conCabecera[0].url, '/api/ultron/sesion', 'la comprobación de sesión de siempre (el servidor anota antes de las rutas)');
  assert.equal(conCabecera[0].headers['x-ultron-sesion'], TOKEN, 'con la sesión recién dada: el servidor sabe de qué cuenta es');
  assert.match(conCabecera[0].headers['x-aura-cliente'], /^v1;p=web;i=[A-Za-z0-9-]{8,64}$/);
  const idA = conCabecera[0].headers['x-aura-cliente'].split('i=')[1];
  assert.equal(n.local.m.get('aura_recepcion_instalacion'), idA, 'el id que se anunció es el de esta sesión');
  // Lo demás que haga la pestaña sigue sin la cabecera: no es una petición más por cada llamada.
  assert.deepEqual(S.headersMesa(), { 'x-ultron-sesion': TOKEN });
  assert.equal(n.pedidas.length, 1, 'nada más se pidió');
  // Salir no anuncia nada (no hay cuenta); entrar con OTRA cuenta anuncia de nuevo, con id nuevo y la sesión nueva.
  S.guardarTokenMesa('');
  assert.equal(n.pedidas.filter((p) => p.headers['x-aura-cliente']).length, 1, 'al salir no se manda');
  const OTRO = 'eyJhbGciOiJIUzI1NiJ9.eyJjIjoibHVpc0B4LmhuIn0.otra_firma-456';
  S.guardarTokenMesa(OTRO);
  const tras = n.pedidas.filter((p) => p.headers['x-aura-cliente']);
  assert.equal(tras.length, 2);
  assert.equal(tras[1].headers['x-ultron-sesion'], OTRO, 'a la cuenta nueva');
  assert.notEqual(tras[1].headers['x-aura-cliente'].split('i=')[1], idA, 'con el id estrenado para esa sesión');
});

test('recepción tras entrar: sin red o sin almacenamiento no rompe la entrada', () => {
  const n = navegador({ ios: false, https: true });
  (globalThis as any).fetch = () => {
    throw new Error('sin red');
  };
  assert.doesNotThrow(() => S.guardarTokenMesa(TOKEN));
  assert.equal(n.local.m.get('ultron_sesion_token'), TOKEN, 'la sesión quedó guardada igual');
  (globalThis as any).fetch = async () => Promise.reject(new Error('sin red'));
  assert.doesNotThrow(() => S.guardarTokenMesa(TOKEN));
});
