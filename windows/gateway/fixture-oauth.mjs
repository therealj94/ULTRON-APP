// Spotify, Google y Microsoft SIMULADOS para probar en el CI el inicio de sesión del .exe (127.0.0.1:18789):
// la página de permiso (redirige de vuelta con el código), el canje con PKCE (verifica el reto S256), la
// renovación (Google no rota el refresh token; Spotify y Microsoft sí) y las APIs que usa AURA. No es
// ningún servicio de verdad: solo prueba que el cliente habla bien el protocolo.
import http from 'node:http';
import crypto from 'node:crypto';

const retos = new Map(); // código → { reto, cliente, redirect }
const b64url = (b) => b.toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
let gmail401 = true; // el primer pedido a Gmail con el token inicial devuelve 401: el cliente tiene que renovar
const leer = (req) => new Promise((r) => { let s = ''; req.on('data', (c) => (s += c)); req.on('end', () => r(s)); });

const tokens = {
  sp: { acceso: 'SP-A1', renovar: 'SP-R1' },
  g: { acceso: 'G-A1', renovar: 'G-R1' },
  ms: { acceso: 'MS-A1', renovar: 'MS-R1' },
};
const vivos = new Set(['SP-A1', 'G-A1', 'MS-A1']);

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const json = (o, st = 200) => { res.writeHead(st, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
  const p = url.pathname;

  // ── página de permiso: /sp/authorize, /g/auth, /ms/authorize ──
  const autoriza = { '/sp/authorize': 'sp', '/g/auth': 'g', '/ms/authorize': 'ms' }[p];
  if (autoriza) {
    const q = url.searchParams;
    const esperado = { sp: 'cid-spotify', g: 'cid-google', ms: 'cid-microsoft' }[autoriza];
    if (q.get('client_id') !== esperado || q.get('response_type') !== 'code' || q.get('code_challenge_method') !== 'S256' || !q.get('code_challenge') || !q.get('state'))
      return json({ error: 'pedido de autorización incompleto' }, 400);
    if (q.get('redirect_uri') !== 'http://127.0.0.1:43821/callback') return json({ error: 'redirect_uri no registrado' }, 400);
    if (autoriza === 'g' && q.get('access_type') !== 'offline') return json({ error: 'google sin access_type=offline' }, 400);
    const codigo = autoriza + '-code-' + crypto.randomBytes(6).toString('hex');
    retos.set(codigo, { reto: q.get('code_challenge'), cliente: esperado, prov: autoriza });
    res.writeHead(302, { location: `${q.get('redirect_uri')}?code=${codigo}&state=${encodeURIComponent(q.get('state'))}` });
    return res.end();
  }

  // ── tokens: /sp/api/token, /g/token, /ms/token ──
  const tokenDe = { '/sp/api/token': 'sp', '/g/token': 'g', '/ms/token': 'ms' }[p];
  if (tokenDe && req.method === 'POST') {
    const f = new URLSearchParams(await leer(req));
    if (tokenDe === 'g' && f.get('client_secret') !== 'secreto-google') return json({ error: 'invalid_client' }, 401);
    if (tokenDe === 'ms' && f.get('grant_type') === 'refresh_token' && !String(f.get('scope')).includes('Mail.Read')) return json({ error: 'invalid_scope' }, 400);
    const t = tokens[tokenDe];
    if (f.get('grant_type') === 'authorization_code') {
      const r = retos.get(f.get('code'));
      retos.delete(f.get('code'));
      if (!r || r.prov !== tokenDe) return json({ error: 'invalid_grant', error_description: 'código desconocido' }, 400);
      if (b64url(crypto.createHash('sha256').update(f.get('code_verifier') || '').digest()) !== r.reto) return json({ error: 'invalid_grant', error_description: 'PKCE no coincide' }, 400);
      return json({ access_token: t.acceso, refresh_token: t.renovar, expires_in: 3600, token_type: 'Bearer' });
    }
    if (f.get('grant_type') === 'refresh_token') {
      if (f.get('refresh_token') !== t.renovar) return json({ error: 'invalid_grant' }, 400);
      const n = Number(t.acceso.split('-A')[1]) + 1;
      t.acceso = `${t.acceso.split('-A')[0]}-A${n}`;
      vivos.add(t.acceso);
      if (tokenDe === 'g') return json({ access_token: t.acceso, expires_in: 3600 }); // Google no rota
      t.renovar = `${t.renovar.split('-R')[0]}-R${n}`;
      return json({ access_token: t.acceso, refresh_token: t.renovar, expires_in: 3600 });
    }
    return json({ error: 'unsupported_grant_type' }, 400);
  }

  // ── APIs: todas con Bearer vivo ──
  const bearer = String(req.headers.authorization || '').replace(/^Bearer /, '');
  if (!vivos.has(bearer)) return json({ error: { status: 401, message: 'token inválido' } }, 401);
  const de = bearer.split('-A')[0];

  if (p === '/v1/me' && de === 'SP') return json({ display_name: 'José', email: 'jose@spotify.test' });
  if (p === '/oauth2/v3/userinfo' && de === 'G') return json({ sub: '1', email: 'jose@gmail.test' });
  if (p === '/v1.0/me' && de === 'MS') return json({ mail: null, userPrincipalName: 'jose@outlook.test' });

  if (p === '/v1/search' && de === 'SP') {
    if (!/track/.test(url.searchParams.get('type') || '')) return json({ error: 'type' }, 400);
    return json({ artists: { items: [{ name: 'Bad Bunny', uri: 'spotify:artist:bb' }] }, tracks: { items: [{ name: 'Tití Me Preguntó', uri: 'spotify:track:titi', artists: [{ name: 'Bad Bunny' }] }] }, playlists: { items: [null] } });
  }
  if (p === '/v1/me/player/devices' && de === 'SP') return json({ devices: [{ id: 'pc-1', name: 'MI-PC', is_active: false }] });
  if (p === '/v1/me/player/play' && de === 'SP' && req.method === 'PUT') {
    const cuerpo = JSON.parse((await leer(req)) || '{}');
    if (!url.searchParams.get('device_id')) return json({ error: { status: 404, message: 'Player command failed: No active device found', reason: 'NO_ACTIVE_DEVICE' } }, 404);
    if (cuerpo.context_uri !== 'spotify:artist:bb') return json({ error: { status: 400, message: 'se esperaba el artista' } }, 400);
    res.writeHead(204); return res.end();
  }

  if (p === '/gmail/v1/users/me/messages' && de === 'G') {
    if (gmail401 && bearer === 'G-A1') { gmail401 = false; return json({ error: { code: 401 } }, 401); }
    if (!String(url.searchParams.get('q')).includes('is:unread')) return json({ error: 'q' }, 400);
    return json({ messages: [{ id: 'm1' }, { id: 'm2' }] });
  }
  const m = p.match(/^\/gmail\/v1\/users\/me\/messages\/(m\d)$/);
  if (m && de === 'G') {
    const datos = { m1: ['Karla <k@x.test>', 'La junta', 'Se movió al jueves', 1790000000000], m2: ['banco@x.test', 'Estado de cuenta', 'Tu estado de cuenta', 1790000500000] }[m[1]];
    return json({ id: m[1], internalDate: String(datos[3]), snippet: datos[2], payload: { headers: [{ name: 'From', value: datos[0] }, { name: 'Subject', value: datos[1] }] } });
  }
  if (p === '/calendar/v3/calendars/primary/events' && de === 'G') {
    if (url.searchParams.get('singleEvents') !== 'true') return json({ error: 'singleEvents' }, 400);
    const d = new Date(Date.now() + 3600e3).toISOString();
    return json({ items: [{ summary: 'Junta directiva', location: 'Sala 2', start: { dateTime: d }, end: { dateTime: new Date(Date.now() + 7200e3).toISOString() } }] });
  }
  if (p === '/youtube/v3/search' && de === 'G') return json({ items: [{ id: { videoId: 'yt123' }, snippet: { title: 'Marc Anthony - Vivir Mi Vida' } }] });

  if (p === '/v1.0/me/mailFolders/inbox/messages' && de === 'MS') {
    const f = url.searchParams.get('$filter') || '';
    if (!/^receivedDateTime ge .* and isRead eq false$/.test(f)) return json({ error: { message: 'filtro: ' + f } }, 400);
    return json({ value: [{ id: 'o1', subject: 'Factura', bodyPreview: 'Adjunto la factura', receivedDateTime: new Date().toISOString(), from: { emailAddress: { name: 'Contabilidad', address: 'c@x.test' } } }] });
  }
  if (p === '/v1.0/me/calendarView' && de === 'MS') {
    if (!/outlook\.timezone="UTC"/.test(String(req.headers.prefer))) return json({ error: 'prefer' }, 400);
    const d = new Date(Date.now() + 5400e3).toISOString().replace('Z', '0000');
    return json({ value: [{ subject: 'Cliente', isAllDay: false, start: { dateTime: d, timeZone: 'UTC' }, end: { dateTime: d, timeZone: 'UTC' }, location: { displayName: 'Teams' } }] });
  }
  json({ error: 'no existe: ' + p }, 404);
}).listen(18789, '127.0.0.1', () => console.log('fixture OAuth en 127.0.0.1:18789'));
