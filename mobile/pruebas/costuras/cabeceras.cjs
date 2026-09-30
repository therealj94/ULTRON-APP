// Costura · qué teléfono habla: `x-aura-aparato` en toda llamada al servidor (api(), el turno, el turno
// en stream, /api/voz/agente) y `x-aura-origen: app` en los turnos. Con cuenta del chat es el id del
// aparato en el relevo REAL (RELEVO.miId); sin ella, uno propio que se crea una vez y queda guardado.
const { ok, fin, arrancarRelevo, entrarComo } = require('../chat/comun.cjs');

(async () => {
  const R = await arrancarRelevo();
  const M = require(process.env.COSTURAS || './out/costuras.cjs');
  const { RELEVO, API } = M;
  console.log('costura · las cabeceras del aparato\n');

  // El servidor de AU-RA de mentira: anota las cabeceras de cada petición y contesta JSON. Lo demás
  // (el relevo) pasa de largo.
  const vistas = [];
  const fetchDeVerdad = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    if (!u.includes('/api/')) return fetchDeVerdad(url, init);
    vistas.push({ ruta: new URL(u).pathname, cab: { ...(init.headers || {}) } });
    return new Response(JSON.stringify({ reply: 'hola', token: 't', pase: 'p', cid: 'c-1' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  // Y el XMLHttpRequest del turno en stream.
  const xhrs = [];
  globalThis.XMLHttpRequest = class {
    constructor() {
      this.cab = {};
      this.readyState = 0;
      this.status = 0;
      this.responseText = '';
      xhrs.push(this);
    }
    open(m, u) {
      this.u = u;
    }
    setRequestHeader(k, v) {
      this.cab[k] = v;
    }
    send() {
      this.status = 200;
      this.responseText = 'event: done\ndata: {"reply":"hola"}\n\n';
      this.readyState = 4;
      setTimeout(() => this.onreadystatechange && this.onreadystatechange(), 5);
    }
    abort() {}
  };
  const ultima = () => vistas[vistas.length - 1];

  // Sin cuenta del chat: un id propio, el mismo siempre, guardado en SecureStore.
  await API.api('/api/perfil', undefined, 5000);
  const propio = ultima().cab['x-aura-aparato'];
  ok('sin chat: manda un id propio', typeof propio === 'string' && propio.length >= 8, propio);
  ok('y lo deja guardado para la próxima vez', globalThis.__ss.m.get('aura.aparato.v1') === propio);
  await API.api('/api/voz/agente', { method: 'POST', body: '{}' }, 5000);
  ok('/api/voz/agente también lo lleva (el mismo)', ultima().ruta === '/api/voz/agente' && ultima().cab['x-aura-aparato'] === propio);
  ok('fuera del turno no dice x-aura-origen', !('x-aura-origen' in ultima().cab));

  await API.turno({ message: 'abre ajustes', mode: 'conversar', userName: 'José', historial: [] });
  ok('/api/turno: x-aura-origen: app', ultima().ruta === '/api/turno' && ultima().cab['x-aura-origen'] === 'app', JSON.stringify(ultima().cab));
  ok('/api/turno: x-aura-aparato', ultima().cab['x-aura-aparato'] === propio);
  ok('y la sesión de la mesa sigue yendo', ultima().cab['x-ultron-sesion'] === 'tok-mesa');

  const st = API.turnoStream({ message: 'envíalo', mode: 'conversar', userName: 'José', historial: [] }, { onDelta() {} });
  await st.promise.catch(() => null);
  const x = xhrs[xhrs.length - 1];
  ok('/api/turno/stream: las dos cabeceras', /\/api\/turno\/stream$/.test(x.u) && x.cab['x-aura-origen'] === 'app' && x.cab['x-aura-aparato'] === propio, JSON.stringify(x.cab));

  // Con cuenta del chat: el id del aparato en el relevo.
  const A = await R.cuenta('José');
  await entrarComo(M, A);
  const delRelevo = RELEVO.miId();
  await API.api('/api/perfil', undefined, 5000);
  ok('con chat: el id del aparato en el relevo', !!delRelevo && ultima().cab['x-aura-aparato'] === delRelevo, `${ultima().cab['x-aura-aparato']} / ${delRelevo}`);
  // El SSE se rehace al avisar la cuenta (VozProvider), cuando el relevo todavía no pidió el id: las
  // cabeceras de ese momento ya tienen que ser las del relevo, no las propias.
  const alAvisar = [];
  const off = RELEVO.escucharCuenta(() => {
    if (RELEVO.quien()) alAvisar.push(M.APARATO.cabecerasAparato());
  });
  await entrarComo(M, A);
  off();
  const cab = alAvisar.length ? await alAvisar[0] : {};
  ok('recién recuperada la cuenta (al avisar), ya es el id del relevo', cab['x-aura-aparato'] === RELEVO.miId() && !!RELEVO.miId(), JSON.stringify(cab));
  await RELEVO.salir();
  await API.api('/api/perfil', undefined, 5000);
  ok('al salir del chat vuelve el propio', ultima().cab['x-aura-aparato'] === propio);
  globalThis.fetch = fetchDeVerdad;
  fin();
})().catch((e) => {
  console.error('ERR', e);
  process.exit(1);
});
