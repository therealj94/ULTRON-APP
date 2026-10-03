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
  });
  Object.defineProperty(globalThis, 'navigator', { value: navigator, configurable: true, writable: true });
  return { cookies, escritas, local };
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
