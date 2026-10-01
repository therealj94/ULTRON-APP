/**
 * OAuth para el MCP: que alguien conecte SU Claude (claude.ai, la app de escritorio o la del
 * teléfono) con Dr Electrum entrando con SU cuenta, sin llaves de API ni tokens copiados a mano.
 *
 * Claude agrega un «conector personalizado» con la dirección de /mcp. El servidor le contesta 401 y
 * le dice dónde está la puerta (RFC 9728); Claude se registra solo (RFC 7591), abre la pantalla de
 * entrada de Dr Electrum en el navegador de la persona, y con el código que vuelve (PKCE S256,
 * OAuth 2.1) saca un token de una hora que se renueva solo.
 *
 * Qué NO cambia: el MCP sigue siendo de lectura (server/mcp.ts), cada llamada queda a nombre de
 * quien entró y pasa por el padrón y el motor de reglas. Quien no tiene acceso a esta plataforma no
 * saca token. Sacarlo del padrón, cambiar la contraseña o cerrar el token lo corta.
 *
 * Nada se guarda en la base: el id de cliente, el código y los tokens van firmados con el secreto de
 * sesión, así que un redespliegue no desconecta a nadie. Lo único en memoria es la lista de códigos
 * ya usados (viven 5 minutos).
 */
import crypto from 'node:crypto';
import express from 'express';
import { identificar, nivelDe } from '../lib/acceso';
import { PLATAFORMA, type Plataforma } from '../lib/plataforma';
import { borrarSesion, emitirTokenMcp, firmarDato, leerDato, leerTokenMcp, limitar, sesionDe } from './seguridad';
import { modoDesarrollo } from '../lib/entorno';

export const TTL_ACCESO_MS = 60 * 60_000;
export const TTL_REFRESCO_MS = 30 * 24 * 60 * 60_000;
const TTL_CODIGO_MS = 5 * 60_000;
export const ALCANCE = 'lectura';

/**
 * A dónde puede volver el código. Solo Claude y los clientes locales (Claude Code, la app de
 * escritorio): un sitio cualquiera que se registrara con su propia dirección podría, si no, pedirle
 * a alguien que «entre con Dr Electrum» y quedarse con el token. `MCP_OAUTH_REDIRECTS` agrega
 * direcciones exactas, separadas por comas.
 */
export function redireccionPermitida(uri: string): boolean {
  let u: URL;
  try {
    u = new URL(uri);
  } catch {
    return false;
  }
  if (u.hash || u.username || u.password) return false;
  const extra = String(process.env.MCP_OAUTH_REDIRECTS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (extra.includes(uri)) return true;
  if (u.protocol === 'https:' && ['claude.ai', 'claude.com'].includes(u.hostname)) return u.pathname === '/api/mcp/auth_callback';
  if (u.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname)) return true;
  return false;
}

export function basePublica(req: express.Request): string {
  const fija = String(process.env.URL_PUBLICA || '').trim().replace(/\/+$/, '');
  if (fija) return fija;
  // https salvo en modo desarrollo: un despliegue sin NODE_ENV no anuncia endpoints de OAuth en http.
  const proto = modoDesarrollo() ? req.protocol : 'https';
  return `${proto}://${req.get('host')}`;
}

export const urlRecurso = (req: express.Request) => `${basePublica(req)}/mcp`;
export const urlMetadatosRecurso = (req: express.Request) => `${basePublica(req)}/.well-known/oauth-protected-resource/mcp`;

type Cliente = { r: string[]; n: string };

function clienteDe(clientId: unknown): Cliente | null {
  const c = leerDato('c1', String(clientId || ''));
  if (!c || !Array.isArray(c.r) || !c.r.length) return null;
  return { r: c.r.map(String), n: String(c.n || 'Cliente MCP').slice(0, 80) };
}

const usados = new Map<string, number>(); // huella del código → cuándo vence
function gastarCodigo(codigo: string): boolean {
  const ahora = Date.now();
  for (const [h, v] of usados) if (v <= ahora) usados.delete(h);
  const h = crypto.createHash('sha256').update(codigo).digest('hex');
  if (usados.has(h)) return false;
  usados.set(h, ahora + TTL_CODIGO_MS);
  return true;
}

const s256 = (verificador: string) => crypto.createHash('sha256').update(verificador).digest('base64url');

/** Quién entra a esta plataforma con esa sesión, o por qué no. */
function personaConAcceso(correo: string, nombre: string, plataforma: Plataforma) {
  const id = identificar({ correo, nombre });
  if (!id || id.prueba !== 'sesion') return null;
  const nivel = nivelDe(id.persona, plataforma);
  return nivel ? { persona: id.persona, nivel } : null;
}

/** Lo que /mcp necesita saber de un token de acceso: a nombre de quién va y con qué nivel. */
export function quienPorTokenMcp(token: string, plataforma: Plataforma = PLATAFORMA) {
  const t = leerTokenMcp(token, 'acceso');
  if (!t) return null;
  // El padrón se mira en CADA llamada: a quien le quitan el acceso se le corta sin esperar la hora.
  const p = personaConAcceso(t.correo, t.nombre, plataforma);
  return p ? { quien: p.persona.id, nivel: p.nivel, cliente: t.cid } : null;
}

const errorOauth = (res: express.Response, status: number, error: string, descripcion: string) =>
  res.status(status).setHeader('Cache-Control', 'no-store').json({ error, error_description: descripcion });

function esc(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/** Valida lo que llega a /oauth/authorize; lo mismo al mostrar la pantalla y al aprobar. */
function pedidoDeAutorizacion(q: Record<string, unknown>, req: express.Request) {
  const cliente = clienteDe(q.client_id);
  const redirect = String(q.redirect_uri || '');
  // Sin cliente o sin dirección válida NO se redirige: se le avisa a la persona en pantalla.
  if (!cliente) return { ok: false as const, pantalla: 'Esta aplicación no está registrada en Dr Electrum. Volvé a agregar el conector en Claude.' };
  if (!cliente.r.includes(redirect) || !redireccionPermitida(redirect)) return { ok: false as const, pantalla: 'La dirección de vuelta no coincide con la que registró la aplicación.' };
  const volver = (error: string, descripcion: string) => {
    const u = new URL(redirect);
    u.searchParams.set('error', error);
    u.searchParams.set('error_description', descripcion);
    if (q.state) u.searchParams.set('state', String(q.state));
    return u.toString();
  };
  if (q.response_type !== 'code') return { ok: false as const, volver: volver('unsupported_response_type', 'Solo response_type=code') };
  const reto = String(q.code_challenge || '');
  if (q.code_challenge_method !== 'S256' || !/^[A-Za-z0-9_-]{43,128}$/.test(reto)) {
    return { ok: false as const, volver: volver('invalid_request', 'PKCE con S256 es obligatorio') };
  }
  const recurso = q.resource ? String(q.resource) : '';
  if (recurso && recurso.replace(/\/+$/, '') !== urlRecurso(req)) return { ok: false as const, volver: volver('invalid_target', 'Este servidor solo emite tokens para su /mcp') };
  return { ok: true as const, cliente, clientId: String(q.client_id), redirect, reto, state: q.state ? String(q.state) : '' };
}

function pantalla(req: express.Request, p: { cliente: Cliente; producto: string; error?: string }) {
  const params = new URLSearchParams(req.query as Record<string, string>).toString();
  const quien = esc(p.cliente.n);
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Conectar con ${esc(p.producto)}</title>
<style>
:root{--f:#f6f4ef;--t:#1d1b18;--s:#6b665e;--c:#fff;--b:#e2ddd3;--a:#b4541f;--e:#a3261c}
@media (prefers-color-scheme:dark){:root{--f:#161513;--t:#eeeae3;--s:#a39d93;--c:#201e1b;--b:#34312c;--a:#e07a3f;--e:#ef7266}}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--f);color:var(--t);font:16px/1.5 system-ui,-apple-system,Segoe UI,sans-serif;padding:16px}
main{width:100%;max-width:400px;background:var(--c);border:1px solid var(--b);border-radius:14px;padding:28px}
h1{font-size:20px;margin:0 0 6px}p{margin:0 0 14px;color:var(--s)}ul{margin:0 0 18px;padding-left:20px;color:var(--s);font-size:14px}
label{display:block;font-size:14px;margin:10px 0 4px}input{width:100%;padding:10px 12px;border:1px solid var(--b);border-radius:8px;background:var(--f);color:var(--t);font:inherit}
button{width:100%;margin-top:16px;padding:11px;border:0;border-radius:8px;background:var(--a);color:#fff;font:600 16px system-ui;cursor:pointer}button[disabled]{opacity:.6}
.sec{background:transparent;color:var(--s);border:1px solid var(--b);margin-top:8px;font-weight:500}.err{color:var(--e);min-height:1.5em;margin:10px 0 0;font-size:14px}
#ya{display:none}
</style></head><body><main>
<h1>Conectar ${quien} con ${esc(p.producto)}</h1>
<p><b>${quien}</b> quiere consultar ${esc(p.producto)} a tu nombre.</p>
<ul><li>Solo lectura: catastro, expedientes, biblioteca, cálculos.</li><li>No carga, no borra y no cambia nada.</li><li>Cada consulta queda registrada a tu nombre.</li></ul>
<div id="ya"><p>Ya entraste como <b id="yaQuien"></b>.</p><button id="permitir">Permitir</button><button class="sec" id="otra">Entrar con otra cuenta</button></div>
<form id="f"><label for="correo">Correo</label><input id="correo" type="email" autocomplete="username" required>
<label for="clave">Contraseña</label><input id="clave" type="password" autocomplete="current-password" required>
<button id="entrar">Entrar y permitir</button></form>
<button class="sec" id="no">Cancelar</button>
<p class="err" id="err" role="alert">${p.error ? esc(p.error) : ''}</p>
</main><script>
(function(){
var Q=${JSON.stringify(params).replace(/</g, '\\u003c')},K='ultron_sesion_token',err=document.getElementById('err');
function leer(){try{return localStorage.getItem(K)||sessionStorage.getItem(K)}catch(e){return null}}
function aprobar(tok,decision){return fetch('/oauth/authorize?'+Q,{method:'POST',headers:{'content-type':'application/json','x-ultron-sesion':tok||''},body:JSON.stringify({decision:decision})}).then(function(r){return r.json().then(function(d){if(d.volver){location.href=d.volver}else{throw new Error(d.error||'No se pudo')}})})}
var tok=leer();
if(tok){fetch('/api/ultron/sesion',{headers:{'x-ultron-sesion':tok}}).then(function(r){return r.json()}).then(function(d){if(d.authenticated){document.getElementById('ya').style.display='block';document.getElementById('f').style.display='none';document.getElementById('yaQuien').textContent=d.user.nombre+' ('+d.user.correo+')'}}).catch(function(){})}
document.getElementById('permitir').onclick=function(){this.disabled=true;aprobar(tok,'permitir').catch(function(e){err.textContent=e.message})};
document.getElementById('otra').onclick=function(){tok=null;document.getElementById('ya').style.display='none';document.getElementById('f').style.display='block'};
document.getElementById('no').onclick=function(){aprobar(tok,'negar').catch(function(e){err.textContent=e.message})};
document.getElementById('f').onsubmit=function(ev){ev.preventDefault();var b=document.getElementById('entrar');b.disabled=true;err.textContent='';
fetch('/api/ultron/entrar',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({correo:document.getElementById('correo').value,clave:document.getElementById('clave').value})})
.then(function(r){return r.json().then(function(d){if(!r.ok||!d.token)throw new Error(d.error||'No se pudo entrar');return aprobar(d.token,'permitir')})})
.catch(function(e){err.textContent=e.message;b.disabled=false})};
})();
</script></body></html>`;
}

export function montarOauthMcp(app: express.Express, plataforma: Plataforma = PLATAFORMA) {
  const producto = plataforma === 'electrum' ? 'Dr Electrum FP' : 'AU-RA FP';
  const formulario = express.urlencoded({ extended: false, limit: '20kb' });

  const metadatosRecurso = (req: express.Request, res: express.Response) =>
    res.json({
      resource: urlRecurso(req),
      authorization_servers: [basePublica(req)],
      scopes_supported: [ALCANCE],
      bearer_methods_supported: ['header'],
      resource_name: producto,
    });
  app.get(['/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/mcp'], metadatosRecurso);

  app.get(['/.well-known/oauth-authorization-server', '/.well-known/oauth-authorization-server/mcp'], (req, res) => {
    const b = basePublica(req);
    res.json({
      issuer: b,
      authorization_endpoint: `${b}/oauth/authorize`,
      token_endpoint: `${b}/oauth/token`,
      registration_endpoint: `${b}/oauth/register`,
      revocation_endpoint: `${b}/oauth/revoke`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
      revocation_endpoint_auth_methods_supported: ['none'],
      scopes_supported: [ALCANCE],
    });
  });

  // Registro dinámico (RFC 7591). Cliente público: sin secreto, la prueba es PKCE.
  app.post('/oauth/register', limitar(20, 60 * 60_000, 'oauth-registro'), (req, res) => {
    const r = req.body?.redirect_uris;
    if (!Array.isArray(r) || !r.length || r.length > 5) return errorOauth(res, 400, 'invalid_redirect_uri', 'Hacen falta entre 1 y 5 redirect_uris');
    const malas = r.filter((u: unknown) => typeof u !== 'string' || !redireccionPermitida(u));
    if (malas.length) return errorOauth(res, 400, 'invalid_redirect_uri', 'Solo se aceptan las direcciones de vuelta de Claude o de un cliente local');
    const nombre = String(req.body?.client_name || 'Cliente MCP').replace(/[\u0000-\u001f]/g, ' ').slice(0, 80);
    const clientId = firmarDato('c1', { r, n: nombre, at: Date.now() });
    res.status(201).setHeader('Cache-Control', 'no-store').json({
      client_id: clientId,
      client_id_issued_at: Math.floor(Date.now() / 1000),
      client_name: nombre,
      redirect_uris: r,
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    });
  });

  app.get('/oauth/authorize', limitar(60), (req, res) => {
    const p = pedidoDeAutorizacion(req.query as Record<string, unknown>, req);
    res.setHeader('Cache-Control', 'no-store');
    // Que nadie meta esta pantalla en un marco ajeno para robar el clic de «Permitir».
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "frame-ancestors 'none'");
    if (p.ok === false) {
      if ('volver' in p) return res.redirect(302, p.volver);
      return res.status(400).type('html').send(`<!doctype html><meta charset="utf-8"><p style="font:16px system-ui;padding:24px">${esc(p.pantalla)}</p>`);
    }
    res.type('html').send(pantalla(req, { cliente: p.cliente, producto }));
  });

  // La pantalla aprueba con la sesión de la app (la que ya tenía el navegador o la que acaba de sacar).
  app.post('/oauth/authorize', limitar(30), (req, res) => {
    const p = pedidoDeAutorizacion(req.query as Record<string, unknown>, req);
    if (p.ok === false) return res.status(400).json({ error: 'pantalla' in p ? p.pantalla : 'Pedido inválido', volver: 'volver' in p ? p.volver : undefined });
    const volver = (params: Record<string, string>) => {
      const u = new URL(p.redirect);
      for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
      if (p.state) u.searchParams.set('state', p.state);
      return u.toString();
    };
    if (req.body?.decision !== 'permitir') return res.json({ volver: volver({ error: 'access_denied', error_description: 'La persona no lo permitió' }) });
    const s = sesionDe(req);
    if (!s) return res.status(401).json({ error: 'Tu sesión venció. Entrá de nuevo.' });
    const acceso = personaConAcceso(s.correo, s.nombre, plataforma);
    if (!acceso) return res.status(403).json({ error: `Tu cuenta no tiene acceso a ${producto}.` });
    const codigo = firmarDato('k1', {
      c: s.correo,
      nm: s.nombre,
      rl: s.rol,
      cid: p.clientId,
      ru: p.redirect,
      cc: p.reto,
      exp: Date.now() + TTL_CODIGO_MS,
      n: crypto.randomBytes(9).toString('base64url'),
    });
    console.log(`[mcp-oauth] ${acceso.persona.id} conectó «${p.cliente.n}» a ${plataforma}`);
    res.json({ volver: volver({ code: codigo }) });
  });

  app.post('/oauth/token', limitar(60), formulario, (req, res) => {
    const b = req.body || {};
    const clientId = String(b.client_id || '');
    if (!clienteDe(clientId)) return errorOauth(res, 401, 'invalid_client', 'Cliente desconocido');
    const emitir = (u: { correo: string; nombre: string; rol: string }) => {
      const acceso = emitirTokenMcp(u, 'acceso', clientId, TTL_ACCESO_MS);
      const refresco = emitirTokenMcp(u, 'refresco', clientId, TTL_REFRESCO_MS);
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Pragma', 'no-cache');
      res.json({ access_token: acceso.token, token_type: 'Bearer', expires_in: Math.floor(TTL_ACCESO_MS / 1000), refresh_token: refresco.token, scope: ALCANCE });
    };

    if (b.grant_type === 'authorization_code') {
      const codigo = String(b.code || '');
      const k = leerDato('k1', codigo);
      if (!k || Number(k.exp) < Date.now()) return errorOauth(res, 400, 'invalid_grant', 'Código vencido o inválido');
      if (k.cid !== clientId || k.ru !== String(b.redirect_uri || '')) return errorOauth(res, 400, 'invalid_grant', 'El código es de otro cliente o de otra dirección');
      if (s256(String(b.code_verifier || '')) !== k.cc) return errorOauth(res, 400, 'invalid_grant', 'code_verifier no corresponde');
      if (!gastarCodigo(codigo)) return errorOauth(res, 400, 'invalid_grant', 'Ese código ya se usó');
      if (!personaConAcceso(k.c, k.nm, plataforma)) return errorOauth(res, 400, 'invalid_grant', 'La cuenta ya no tiene acceso');
      return emitir({ correo: k.c, nombre: k.nm, rol: k.rl });
    }

    if (b.grant_type === 'refresh_token') {
      const viejo = String(b.refresh_token || '');
      const t = leerTokenMcp(viejo, 'refresco');
      if (!t || t.cid !== clientId) return errorOauth(res, 400, 'invalid_grant', 'Token de refresco vencido, cerrado o de otro cliente');
      if (!personaConAcceso(t.correo, t.nombre, plataforma)) return errorOauth(res, 400, 'invalid_grant', 'La cuenta ya no tiene acceso');
      // Rotación (OAuth 2.1 para clientes públicos): el refresco viejo deja de valer al usarse.
      void borrarSesion(viejo);
      return emitir({ correo: t.correo, nombre: t.nombre, rol: t.rol });
    }

    return errorOauth(res, 400, 'unsupported_grant_type', 'Solo authorization_code y refresh_token');
  });

  // RFC 7009: siempre 200, exista o no el token.
  app.post('/oauth/revoke', limitar(30), formulario, async (req, res) => {
    const t = String(req.body?.token || '');
    if (leerTokenMcp(t, 'refresco') || leerTokenMcp(t, 'acceso')) await borrarSesion(t);
    res.status(200).end();
  });
}
