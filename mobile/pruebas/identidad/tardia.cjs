// Identidad · la respuesta tardía de A no llena el estado de B (punto 3 de la revisión del 4-oct).
//
//  A pide algo (JSON o turno en stream); antes de que el servidor conteste, A sale y entra B. La respuesta de A
//  llega entonces. Antes se entregaba igual: la mesa (que pudo seguir viva un instante) la decía o ejecutaba sus
//  acciones con B dentro. Ahora quien la pidió recibe «vencida» y nada de A pasa: ni el cuerpo, ni los trozos del
//  stream, ni su `done`. Y lo que B pide después sale con B, sin nada de A.
// Todo con red de mentira: nada sale del proceso.
const { ok, fin } = require('../chat/comun.cjs');

const espera = (ms) => new Promise((r) => setTimeout(r, ms));
const ev = (e, d) => `event: ${e}\ndata: ${JSON.stringify(d)}\n\n`;
const resp = (cuerpo, status = 200) => new Response(JSON.stringify(cuerpo), { status });

(async () => {
  const M = require(process.env.IDENTIDAD || './out/identidad.cjs');
  const { API, CUENTA, INTENTO } = M;
  const mesa = globalThis.__mesa;
  const esVencida = (e) => !!INTENTO?.esVencida?.(e);
  const dentro = (correo, token) => {
    CUENTA.fijarCuenta(correo);
    mesa.token = token;
    mesa.sesion = correo ? { correo } : null;
  };

  console.log('Respuesta tardía de A con B dentro\n');

  /* ── api(): la respuesta de A llega cuando ya está B ─────────────────────────────────── */
  CUENTA.fijarCuenta(null, { nueva: true });
  dentro('a@prueba.local', 'tok-A');
  let soltar = null;
  globalThis.fetch = () => new Promise((r) => (soltar = () => r(resp({ dato: 'secreto-de-A' }))));
  const pApi = API.api('/api/memoria', { method: 'GET' }, 5000).then(
    (d) => d,
    (e) => e
  );
  await espera(20);
  dentro(null, '');
  dentro('b@prueba.local', 'tok-B');
  soltar();
  const rApi = await pApi;
  ok('api(): la respuesta de A no se entrega con B dentro', !JSON.stringify(rApi || {}).includes('secreto-de-A'), JSON.stringify(rApi));
  ok('…quien la pidió recibe «vencida»', esVencida(rApi), String(rApi?.message || rApi));

  /* ── turno() JSON: tampoco, y viene marcado para no decir nada ─────────────────────────── */
  CUENTA.fijarCuenta(null, { nueva: true });
  dentro('a@prueba.local', 'tok-A');
  globalThis.fetch = () => new Promise((r) => (soltar = () => r(resp({ reply: 'Ana, tu código es PIÑA-7781.', acciones: [{ tipo: 'enviar', a: 'x' }] }))));
  const pTurno = API.turno({ message: 'mi código', mode: 'conversar', userName: 'Ana', historial: [] });
  await espera(20);
  dentro(null, '');
  dentro('b@prueba.local', 'tok-B');
  soltar();
  const rTurno = await pTurno;
  ok('turno(): sin la respuesta de A', !String(rTurno.reply || '').includes('PIÑA'), JSON.stringify(rTurno));
  ok('…sin sus acciones', !rTurno.acciones, JSON.stringify(rTurno.acciones || null));
  ok('…y marcado como vencido (la mesa calla)', rTurno.vencida === true, JSON.stringify(rTurno));

  /* ── turnoStream(): trozos y done de A llegan después del cambio ─────────────────────────── */
  const xhrs = [];
  globalThis.XMLHttpRequest = class {
    constructor() {
      this.cab = {};
      this.readyState = 0;
      this.status = 0;
      this.responseText = '';
      this.abortado = false;
      xhrs.push(this);
    }
    open(_m, u) {
      this.u = u;
    }
    setRequestHeader(k, v) {
      this.cab[k] = v;
    }
    send(p) {
      this.payload = p;
    }
    abort() {
      this.abortado = true;
    }
    llega(t) {
      this.status = 200;
      this.readyState = 3;
      this.responseText += t;
      this.onprogress?.();
    }
    cierra(status = 200) {
      this.status = status;
      this.readyState = 4;
      this.onreadystatechange?.();
    }
  };
  CUENTA.fijarCuenta(null, { nueva: true });
  dentro('a@prueba.local', 'tok-A');
  const visto = { deltas: [], herramientas: [] };
  const st = API.turnoStream(
    { message: 'mi código', mode: 'conversar', userName: 'Ana', historial: [], idTurno: 'turno-a-0001' },
    { onDelta: (p) => visto.deltas.push(p), onTools: (t) => visto.herramientas.push(...t) }
  );
  await espera(20);
  const x = xhrs[xhrs.length - 1];
  x.llega(ev('emocion', { emocion: 'neutral' }) + ev('delta', { text: 'Un momento. ', voz: 'Un momento. ' }));
  dentro(null, '');
  dentro('b@prueba.local', 'tok-B');
  x.llega(ev('tools', { tools: ['whatsapp'] }) + ev('delta', { text: 'Ana, tu código es PIÑA-7781.', voz: 'Ana, tu código es PIÑA-7781.' }) + ev('done', { reply: 'Ana, tu código es PIÑA-7781.', acciones: [{ tipo: 'enviar' }] }));
  x.cierra();
  const rSt = await Promise.race([st.promise.catch((e) => e), espera(500).then(() => 'colgado')]);
  ok('stream: lo de antes del cambio sí llegó (era de A, con A dentro)', visto.deltas.join('') === 'Un momento. ', JSON.stringify(visto.deltas));
  ok('stream: nada de A después del cambio (ni trozos ni herramientas)', !visto.deltas.join('').includes('PIÑA') && visto.herramientas.length === 0, JSON.stringify(visto));
  ok('stream: el turno termina «vencido», sin su done', esVencida(rSt), String(rSt?.message || JSON.stringify(rSt)));
  ok('stream: la conexión de A se corta', x.abortado === true);

  /* ── lo siguiente de B sale con B y sin nada de A ───────────────────────────────────────── */
  const enviados = [];
  globalThis.fetch = async (url, init = {}) => {
    enviados.push({ token: String((init.headers || {})['x-ultron-sesion'] || ''), cuerpo: String(init.body || '') });
    return resp({ reply: 'Hola, Bea.' });
  };
  const rB = await API.turno({ message: 'Hola', mode: 'conversar', userName: 'Bea', historial: [] });
  ok('B: su turno contesta', rB.reply === 'Hola, Bea.', JSON.stringify(rB));
  ok('B: sale con el token de B y sin nada de A', enviados.length === 1 && enviados[0].token === 'tok-B' && !/PIÑA|mi código/.test(enviados[0].cuerpo), JSON.stringify(enviados));
  fin();
})();
