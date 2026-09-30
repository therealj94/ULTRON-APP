/**
 * Las pruebas de las llamadas, una por hallazgo de la auditoría de la 5.0 (C1…B1) más el bus.
 *
 *   node mobile/pruebas/llamadas/pruebas.js                    → la versión del repo (todas deben pasar)
 *   LLAMADA_SRC=/ruta/llamada-vieja.ts node …/pruebas.js       → otra versión (para ver qué fallaba antes)
 *
 * Sale con código 1 si alguna falla.
 */
const H = require('./arnes');
const { obs, tick, flush, conReloj, nuevo, OFERTA, RESPUESTA } = H;

const resultados = [];
// Una versión vieja deja promesas rechazadas sin atrapar (manda y no espera): se cuentan, no tumban el informe.
let sinAtrapar = 0;
process.on('unhandledRejection', () => void sinAtrapar++);
function afirmar(cond, texto) {
  if (!cond) throw new Error(texto);
}
async function prueba(id, titulo, f) {
  try {
    await f();
    resultados.push({ id, titulo, ok: true });
  } catch (e) {
    resultados.push({ id, titulo, ok: false, error: String((e && e.message) || e).slice(0, 160) });
  }
}
const tipos = () => obs.senales.map((s) => s.tipo);
const libreYCallado = (L) => L.cuento().estado === 'libre' && obs.sonando.size === 0 && !obs.vibrando;
const pcViva = () => obs.pcs.filter((p) => !p.cerrada);

/** Quien llama, ya con respuesta del otro y la conexión en pie. */
async function llamadaEnPie(opciones = {}, video = false) {
  const n = await nuevo(opciones);
  await conReloj(n.L.llamar('b@a.com', video));
  await n.L.recibir({ de: 'b@a.com', tipo: 'respuesta', datos: { sdp: RESPUESTA() } });
  obs.pcs[obs.pcs.length - 1].conectar();
  await flush();
  return n;
}
/** Quien recibe, ya contestada y con la conexión en pie. */
async function contestadaEnPie(video = false) {
  const n = await nuevo();
  await n.L.recibir({ de: 'x@a.com', tipo: 'llamo', datos: { video, sdp: OFERTA() } });
  await conReloj(n.L.contestar(video));
  obs.pcs[obs.pcs.length - 1].conectar();
  await flush();
  return n;
}

(async () => {
  /* ── C1: plazos de timbre y de conexión ── */
  await prueba('C1', 'quien llama sin respuesta: sigue sonando a los 21 s y a los 45 s cuelga «no contestó» avisando', async () => {
    const { L, ultimo } = await nuevo();
    await conReloj(L.llamar('b@a.com', false));
    await tick(21_000);
    afirmar(L.cuento().estado === 'llamando', 'a los 21 s ya no estaba llamando: ' + L.cuento().estado + '/' + ultimo().motivo);
    await tick(25_000);
    afirmar(libreYCallado(L), 'a los 46 s sigue en ' + L.cuento().estado);
    afirmar(ultimo().motivo === 'no-contesto', 'motivo ' + ultimo().motivo);
    afirmar(tipos().includes('cuelgo'), 'no mandó cuelgo: ' + tipos());
  });
  await prueba('C1', 'quien recibe y nadie toca nada: a los 45 s deja de sonar y queda «perdida»', async () => {
    const { L, ultimo } = await nuevo();
    await L.recibir({ de: 'x@a.com', tipo: 'llamo', datos: { video: false, sdp: OFERTA() } });
    await tick(46_000);
    afirmar(libreYCallado(L), 'sigue ' + L.cuento().estado + ' sonando=' + obs.sonando.size + ' vibrando=' + obs.vibrando);
    afirmar(ultimo().motivo === 'perdida', 'motivo ' + ultimo().motivo);
  });
  await prueba('C1', 'quien llama: el plazo de conexión (20 s) corre desde la respuesta y «sin camino» avisa con cuelgo', async () => {
    const { L, ultimo } = await nuevo();
    await conReloj(L.llamar('b@a.com', false));
    await tick(30_000);
    await L.recibir({ de: 'b@a.com', tipo: 'respuesta', datos: { sdp: RESPUESTA() } });
    afirmar(L.cuento().estado === 'conectando', 'tras la respuesta: ' + L.cuento().estado);
    await tick(19_000);
    afirmar(L.cuento().estado === 'conectando', 'colgó antes de los 20 s de la respuesta');
    await tick(2_000);
    afirmar(ultimo().motivo === 'sin-camino', 'motivo ' + ultimo().motivo);
    afirmar(tipos().filter((t) => t === 'cuelgo').length === 1, 'cuelgo: ' + tipos());
  });
  await prueba('C1', 'quien recibe: el plazo de conexión se arma al contestar y avisa con cuelgo', async () => {
    const { L, ultimo } = await nuevo();
    await L.recibir({ de: 'x@a.com', tipo: 'llamo', datos: { video: false, sdp: OFERTA() } });
    await tick(10_000);
    await conReloj(L.contestar(false));
    await tick(21_000);
    afirmar(ultimo().motivo === 'sin-camino', 'motivo ' + ultimo().motivo + ' estado ' + L.cuento().estado);
    afirmar(tipos().includes('cuelgo'), 'no mandó cuelgo: ' + tipos());
  });
  await prueba('C1', 'quien llama cuelga mientras suena: al que recibe le queda «perdida»', async () => {
    const { L, ultimo } = await nuevo();
    await L.recibir({ de: 'x@a.com', tipo: 'llamo', datos: { video: false, sdp: OFERTA() } });
    await L.recibir({ de: 'x@a.com', tipo: 'cuelgo', datos: {} });
    await tick(1000);
    afirmar(libreYCallado(L), 'sigue sonando');
    afirmar(ultimo().motivo === 'perdida', 'motivo ' + ultimo().motivo);
  });

  /* ── C2: carrera en sonar()/callar() ── */
  await prueba('C2', '«llamo» y «atendida» en el mismo lote: el timbre y la vibración no quedan en bucle', async () => {
    const { L } = await nuevo();
    void L.recibir({ de: 'x@a.com', tipo: 'llamo', datos: { video: false, sdp: OFERTA() } });
    void L.recibir({ de: 'x@a.com', tipo: 'atendida', datos: { como: 'respuesta' }, desde: 'OG' });
    await tick(60_000);
    afirmar(libreYCallado(L), 'sonando=' + [...obs.sonando] + ' vibrando=' + obs.vibrando);
  });
  await prueba('C2', '«llamo» y «cuelgo» en el mismo lote: nada sonando', async () => {
    const { L } = await nuevo();
    void L.recibir({ de: 'x@a.com', tipo: 'llamo', datos: { video: false, sdp: OFERTA() } });
    void L.recibir({ de: 'x@a.com', tipo: 'cuelgo', datos: {} });
    await tick(60_000);
    afirmar(libreYCallado(L), 'sonando=' + [...obs.sonando] + ' vibrando=' + obs.vibrando);
  });

  /* ── A1: colgar mientras llamar()/contestar() esperan ── */
  await prueba('A1', 'colgar con el diálogo de permisos abierto: sin tono, sin sesión de audio, sin pistas, sin «llamo»', async () => {
    const { L, avisos } = await nuevo();
    obs.retrasoPermiso = 3000;
    const p = L.llamar('b@a.com', true).catch(() => {});
    await tick(1000);
    L.colgar('yo');
    await tick(3000);
    await p;
    const n = avisos.length;
    await tick(30_000);
    afirmar(libreYCallado(L), 'sonando=' + [...obs.sonando]);
    afirmar(obs.audioSesion === 'parada', 'sesión de audio ' + obs.audioSesion);
    afirmar(!tipos().includes('llamo'), 'mandó llamo: ' + JSON.stringify(obs.senales));
    afirmar(!tipos().includes('cuelgo'), 'mandó cuelgo a quien nunca supo: ' + tipos());
    afirmar(obs.pcs.every((x) => x.cerrada), 'conexión huérfana');
    afirmar(obs.tracks.every((t) => t.parado && t.liberado), 'pistas sin soltar: ' + JSON.stringify(obs.tracks.map((t) => [t.parado, t.liberado])));
    afirmar(avisos.length === n, 'siguió avisando después de colgar');
  });
  await prueba('A1', '/turno lento (15 s): el «llamo» sale en menos de 3 s igual', async () => {
    const turnoLento = () => new Promise((r) => setTimeout(() => r([{ urls: 'turn:x' }]), 15_000));
    const { L } = await nuevo({ traerTurno: turnoLento });
    const p = L.llamar('b@a.com', false);
    await tick(3000);
    afirmar(tipos().includes('llamo'), 'a los 3 s aún no sale el llamo: ' + tipos());
    await p;
  });
  await prueba('A1', 'colgar mientras espera el /turno: nada se abre después', async () => {
    const turnoLento = () => new Promise((r) => setTimeout(() => r([]), 15_000));
    const { L } = await nuevo({ traerTurno: turnoLento });
    const p = L.llamar('b@a.com', false).catch(() => {});
    await tick(500);
    L.colgar('yo');
    await tick(20_000);
    await p;
    afirmar(obs.tracks.length === 0 && obs.pcs.length === 0, 'abrió medios o conexión tras colgar');
    afirmar(!tipos().includes('llamo'), 'mandó llamo');
    afirmar(obs.sonando.size === 0, 'tono sonando');
  });
  await prueba('A1', 'quien llama cuelga mientras el que recibe está en el diálogo de permisos: no sale «respuesta»', async () => {
    const { L } = await nuevo();
    await L.recibir({ de: 'x@a.com', tipo: 'llamo', datos: { video: true, sdp: OFERTA() } });
    obs.retrasoPermiso = 4000;
    const p = L.contestar(true).catch(() => {});
    await tick(1000);
    await L.recibir({ de: 'x@a.com', tipo: 'cuelgo', datos: {} });
    await tick(5000);
    await p;
    afirmar(!tipos().includes('respuesta'), 'mandó respuesta: ' + tipos());
    afirmar(obs.tracks.every((t) => t.parado && t.liberado), 'pistas sin soltar');
    afirmar(obs.audioSesion === 'parada', 'sesión de audio ' + obs.audioSesion);
    afirmar(obs.pcs.every((x) => x.cerrada), 'conexión huérfana');
  });

  /* ── A2: señales tardías ── */
  await prueba('A2', '«rechazo» tardío de otro aparato con la llamada en pie: no la tumba', async () => {
    const { L } = await llamadaEnPie();
    await L.recibir({ de: 'b@a.com', tipo: 'rechazo', datos: {} });
    afirmar(L.cuento().estado === 'hablando', 'estado ' + L.cuento().estado);
  });
  await prueba('A2', '«ocupado» tardío con la llamada conectando: no la tumba', async () => {
    const { L } = await nuevo();
    await conReloj(L.llamar('b@a.com', false));
    await L.recibir({ de: 'b@a.com', tipo: 'respuesta', datos: { sdp: RESPUESTA() } });
    await L.recibir({ de: 'b@a.com', tipo: 'ocupado', datos: {} });
    afirmar(L.cuento().estado === 'conectando', 'estado ' + L.cuento().estado);
  });
  await prueba('A2', 'segunda «respuesta» (dos aparatos del otro contestan): se ignora', async () => {
    const { L } = await llamadaEnPie();
    await L.recibir({ de: 'b@a.com', tipo: 'respuesta', datos: { sdp: RESPUESTA('a2') } });
    afirmar(L.cuento().estado === 'hablando', 'estado ' + L.cuento().estado);
  });

  /* ── A3: doble toque en Contestar ── */
  await prueba('A3', 'doble toque en Contestar: una sola conexión, una sola respuesta, un solo micrófono', async () => {
    const { L } = await nuevo();
    await L.recibir({ de: 'x@a.com', tipo: 'llamo', datos: { video: false, sdp: OFERTA() } });
    await conReloj(Promise.all([L.contestar(false).catch(() => {}), L.contestar(false).catch(() => {})]));
    afirmar(tipos().filter((t) => t === 'respuesta').length === 1, 'respuestas: ' + tipos());
    afirmar(obs.pcs.length === 1, 'conexiones: ' + obs.pcs.length);
    afirmar(obs.tracks.filter((t) => !t.parado).length === 1, 'micrófonos abiertos: ' + obs.tracks.filter((t) => !t.parado).length);
  });

  /* ── A5: servicio en primer plano ── */
  await prueba('A5', 'servicio en primer plano: micrófono al llamar, texto «Llamada con…», reloj al conectar, se para al colgar', async () => {
    const { L } = await llamadaEnPie();
    const ns = obs.servicio.notificaciones;
    afirmar(ns.length >= 2, 'notificaciones: ' + ns.length);
    const n = ns[ns.length - 1];
    afirmar(n.android.asForegroundService === true, 'no es servicio en primer plano');
    afirmar(JSON.stringify(n.android.foregroundServiceTypes) === '[128]', 'tipos ' + JSON.stringify(n.android.foregroundServiceTypes));
    afirmar(/Llamada con b · PULSE2CHAT/.test(n.title), 'título ' + n.title);
    afirmar(n.android.showChronometer === true, 'sin reloj al conectar');
    afirmar(n.android.actions.some((a) => a.pressAction.id === 'colgar'), 'sin acción Colgar');
    afirmar(!n.android.foregroundServiceTypes.includes(4), 'usa phoneCall');
    L.colgar('yo');
    await flush();
    afirmar(!obs.servicio.activo && obs.servicio.paradas === 1, 'el servicio sigue');
  });
  await prueba('A5', 'videollamada: tipos micrófono + cámara', async () => {
    await llamadaEnPie({}, true);
    const n = obs.servicio.notificaciones[obs.servicio.notificaciones.length - 1];
    afirmar(JSON.stringify(n.android.foregroundServiceTypes) === '[128,64]', 'tipos ' + JSON.stringify(n.android.foregroundServiceTypes));
  });
  await prueba('A5', 'el botón Colgar de la notificación (en segundo plano) cuelga y avisa al otro', async () => {
    const { L, ultimo } = await llamadaEnPie();
    const id = obs.servicio.notificaciones[0].id;
    await obs.notifee.background({ type: H.NOTIFEE.EventType.ACTION_PRESS, detail: { notification: { id }, pressAction: { id: 'colgar' } } });
    await flush();
    afirmar(L.cuento().estado === 'libre' && ultimo().motivo === 'yo', 'estado ' + L.cuento().estado);
    afirmar(tipos().includes('cuelgo'), 'no avisó');
    afirmar(!obs.servicio.activo, 'servicio activo');
  });
  await prueba('A5', 'colgar antes de que termine de mostrarse la notificación: el servicio no queda huérfano', async () => {
    const { L } = await nuevo();
    const orig = H.NOTIFEE.default.displayNotification;
    H.NOTIFEE.default.displayNotification = (n) => new Promise((r) => setTimeout(() => r(orig(n)), 500));
    try {
      const p = L.llamar('b@a.com', false).catch(() => {});
      await tick(100);
      await tick(100);
      L.colgar('yo');
      await tick(2000);
      await p;
      afirmar(!obs.servicio.activo, 'servicio quedó activo');
    } finally {
      H.NOTIFEE.default.displayNotification = orig;
    }
  });

  /* ── M1: el error real del «llamo» ── */
  for (const [code, motivo] of [
    [403, 'no-te-acepto'],
    [413, 'senal-grande'],
    [429, 'demasiadas'],
    [0, 'sin-red'],
  ]) {
    await prueba('M1', `«llamo» falla con ${code || 'sin red'} → «${motivo}», sin tono ni timbre`, async () => {
      const mandar = (_p, tipo) => (tipo === 'llamo' ? Promise.reject(Object.assign(new Error('x'), code ? { code } : {})) : Promise.resolve({}));
      const { L, ultimo } = await nuevo({ mandar });
      await conReloj(L.llamar('b@a.com', false).catch(() => {}));
      await tick(200);
      afirmar(ultimo().motivo === motivo, 'motivo ' + ultimo().motivo);
      afirmar(libreYCallado(L), 'quedó sonando');
      afirmar(!tipos().includes('cuelgo'), 'mandó cuelgo por algo que nunca llegó');
    });
  }
  await prueba('M1', '«llamo» con relevo.senalar actual (se traga el error y devuelve null) → «no-llego»', async () => {
    const { L, ultimo } = await nuevo({ mandar: () => Promise.resolve(null) });
    await conReloj(L.llamar('b@a.com', false).catch(() => {}));
    afirmar(ultimo().motivo === 'no-llego', 'motivo ' + ultimo().motivo);
  });

  /* ── M2: ICE antes que la oferta ── */
  await prueba('M2', '«ice» que llega antes que el «llamo» se aplica al contestar', async () => {
    const { L } = await nuevo();
    await L.recibir({ de: 'x@a.com', tipo: 'ice', datos: { candidato: { candidate: 'c1' } } });
    await L.recibir({ de: 'x@a.com', tipo: 'llamo', datos: { video: false, sdp: OFERTA() } });
    await L.recibir({ de: 'x@a.com', tipo: 'ice', datos: { candidato: { candidate: 'c2' } } });
    await conReloj(L.contestar(false));
    const c = obs.pcs[0].iceAplicados.map((x) => x.candidate);
    afirmar(c.includes('c1') && c.includes('c2'), 'aplicados: ' + c);
  });
  await prueba('M2', 'un «ice» huérfano caduca a los pocos segundos', async () => {
    const { L } = await nuevo();
    await L.recibir({ de: 'x@a.com', tipo: 'ice', datos: { candidato: { candidate: 'viejo' } } });
    await tick(30_000);
    await L.recibir({ de: 'x@a.com', tipo: 'llamo', datos: { video: false, sdp: OFERTA() } });
    await conReloj(L.contestar(false));
    afirmar(!obs.pcs[0].iceAplicados.some((x) => x.candidate === 'viejo'), 'aplicó un ice de hace 30 s');
  });
  await prueba('M2', 'los caminos propios no salen antes que el «llamo»', async () => {
    let soltar;
    const mandar = (_p, tipo) => (tipo === 'llamo' ? new Promise((r) => (soltar = () => r({}))) : undefined);
    const { L } = await nuevo({ mandar });
    const p = L.llamar('b@a.com', false);
    for (let i = 0; i < 50 && !obs.pcs[0]; i++) await tick(10);
    await tick(50);
    obs.pcs[0].candidato({ candidate: 'mio' });
    afirmar(!tipos().includes('ice'), 'salió un ice antes del llamo: ' + tipos());
    soltar();
    await p;
    const t = tipos();
    afirmar(t.indexOf('ice') > t.indexOf('llamo'), 'orden ' + t);
  });

  /* ── M3: llamadas cruzadas ── */
  await prueba('M3', 'se llaman a la vez y mi correo es el MENOR: sigo llamando, no mando «ocupado»', async () => {
    const { L } = await nuevo({ correo: 'a@a.com' });
    await conReloj(L.llamar('b@a.com', false));
    await L.recibir({ de: 'b@a.com', tipo: 'llamo', datos: { video: false, sdp: OFERTA() } });
    afirmar(!tipos().includes('ocupado'), 'mandó ocupado');
    afirmar(L.cuento().estado === 'llamando', 'estado ' + L.cuento().estado);
    await L.recibir({ de: 'b@a.com', tipo: 'respuesta', datos: { sdp: RESPUESTA() } });
    afirmar(L.cuento().estado === 'conectando', 'tras la respuesta: ' + L.cuento().estado);
  });
  await prueba('M3', 'se llaman a la vez y mi correo es el MAYOR: contesto la del otro, sin «ocupado», sin avisos de fin', async () => {
    const { L, avisos } = await nuevo({ correo: 'c@a.com' });
    await conReloj(L.llamar('b@a.com', false));
    await L.recibir({ de: 'b@a.com', tipo: 'ice', datos: { candidato: { candidate: 'deb' } } });
    await conReloj(L.recibir({ de: 'b@a.com', tipo: 'llamo', datos: { video: false, sdp: OFERTA('ob') } }));
    await tick(500);
    afirmar(!tipos().includes('ocupado') && !tipos().includes('cuelgo'), 'señales ' + tipos());
    afirmar(tipos().includes('respuesta'), 'no contestó: ' + tipos());
    afirmar(L.cuento().estado === 'conectando', 'estado ' + L.cuento().estado);
    afirmar(obs.pcs[0].cerrada && pcViva().length === 1, 'conexiones');
    afirmar(pcViva()[0].iceAplicados.some((x) => x.candidate === 'deb'), 'perdió el ice del otro');
    afirmar(!avisos.some((a) => a.estado === 'libre'), 'pasó por libre');
  });

  /* ── M4: contestar sin permiso ── */
  await prueba('M4', 'contestar sin micrófono: quien llama recibe «rechazo» con motivo; en «no volver a preguntar» se ofrece Ajustes', async () => {
    const { L, ultimo } = await nuevo();
    obs.permiso = (p) => (p === 'mic' ? 'never_ask_again' : 'granted');
    await L.recibir({ de: 'x@a.com', tipo: 'llamo', datos: { video: false, sdp: OFERTA() } });
    await conReloj(L.contestar(false).catch(() => {}));
    const r = obs.senales.find((s) => s.tipo === 'rechazo');
    afirmar(r && r.datos && r.datos.motivo === 'sin-permiso', 'señales ' + JSON.stringify(obs.senales));
    afirmar(ultimo().motivo === 'sin-permiso' && ultimo().abrirAjustes === true, JSON.stringify({ m: ultimo().motivo, a: ultimo().abrirAjustes }));
    afirmar(typeof L.abrirAjustes === 'function', 'sin abrirAjustes');
    L.abrirAjustes();
    await flush();
    afirmar(obs.ajustesAbiertos === 1, 'no abrió Ajustes');
  });
  await prueba('M4', 'quien llama recibe «rechazo» por permiso: «le faltó permiso», no «no contestó»', async () => {
    const { L, ultimo } = await nuevo();
    await conReloj(L.llamar('b@a.com', false));
    await L.recibir({ de: 'b@a.com', tipo: 'rechazo', datos: { motivo: 'sin-permiso' } });
    afirmar(ultimo().motivo === 'el-otro-sin-permiso', 'motivo ' + ultimo().motivo);
  });
  await prueba('M4', 'videollamada sin cámara pero con micrófono: sigue de voz', async () => {
    const { L } = await nuevo();
    obs.permiso = (p) => (p === 'cam' ? 'denied' : 'granted');
    await conReloj(L.llamar('b@a.com', true));
    const llamo = obs.senales.find((s) => s.tipo === 'llamo');
    afirmar(llamo && llamo.datos.video === false && L.cuento().estado === 'llamando', 'estado ' + L.cuento().estado);
  });

  /* ── M5: segundo «llamo» del mismo contacto ── */
  await prueba('M5', 'segundo «llamo» del mismo contacto mientras suena: se reemplaza la oferta, sin «ocupado»', async () => {
    const { L } = await nuevo();
    await L.recibir({ de: 'x@a.com', tipo: 'llamo', datos: { video: false, sdp: OFERTA('o1') } });
    await L.recibir({ de: 'x@a.com', tipo: 'llamo', datos: { video: false, sdp: OFERTA('o2') } });
    afirmar(!tipos().includes('ocupado'), 'mandó ocupado');
    afirmar(L.cuento().estado === 'entrando', 'estado ' + L.cuento().estado);
    await conReloj(L.contestar(false));
    afirmar(obs.pcs[0].remoteDescription.sdp === 'o2', 'usó la oferta ' + obs.pcs[0].remoteDescription.sdp);
  });

  /* ── M7: Bluetooth ── */
  await prueba('M7', 'al llamar se pide BLUETOOTH_CONNECT (y avisos en Android 13+) junto con el micrófono', async () => {
    const { L } = await nuevo();
    await conReloj(L.llamar('b@a.com', false));
    const q = obs.permisoPedido[0] || [];
    afirmar(q.includes('mic') && q.includes('bt') && q.includes('avisos'), 'pidió ' + q);
  });

  /* ── M9: reinicio de ICE ── */
  await prueba('M9', '«oferta» en plena llamada (reinicio de ICE de la web): se contesta con «respuesta» y sigue', async () => {
    const { L } = await contestadaEnPie();
    const antes = tipos().filter((t) => t === 'respuesta').length;
    await L.recibir({ de: 'x@a.com', tipo: 'oferta', datos: { sdp: OFERTA('o-reinicio') } });
    afirmar(tipos().filter((t) => t === 'respuesta').length === antes + 1, 'señales ' + tipos());
    afirmar(L.cuento().estado === 'hablando', 'estado ' + L.cuento().estado);
  });
  await prueba('M9', 'corte de red: a los 6 s sigue (reconectando), pide camino nuevo y cuelga recién a los 10 s', async () => {
    const { L, ultimo } = await llamadaEnPie();
    const c = obs.pcs[0];
    c.ice('disconnected');
    await tick(6_500);
    afirmar(L.cuento().estado === 'hablando', 'colgó a los 6 s');
    afirmar(L.cuento().reconectando === true, 'no dice reconectando');
    afirmar(c.ofertas.some((o) => o.iceRestart) && tipos().includes('oferta'), 'no pidió reinicio de ICE: ' + tipos());
    await tick(4_000);
    afirmar(ultimo().motivo === 'corte' && tipos().includes('cuelgo'), 'motivo ' + ultimo().motivo);
  });
  await prueba('M9', 'corte que se recupera a los 8 s: la llamada sigue', async () => {
    const { L } = await llamadaEnPie();
    const c = obs.pcs[0];
    c.ice('disconnected');
    await tick(3_000);
    await L.recibir({ de: 'b@a.com', tipo: 'respuesta', datos: { sdp: RESPUESTA('a-reinicio') } });
    await tick(5_000);
    c.conectar();
    await tick(20_000);
    afirmar(L.cuento().estado === 'hablando' && !L.cuento().reconectando, 'estado ' + L.cuento().estado);
  });

  /* ── revisión 5: el audio que AURA suelta tarde y el servicio desde segundo plano ── */
  await prueba('R5-3', 'con AURA cerrándose, la llamada espera «voz libre» y el stop tardío de ElevenLabs no le apaga el audio', async () => {
    const { L } = await nuevo();
    const bus = H.contrato();
    bus.emitir('voz', { libre: false }); // la conversación de AURA tiene el audio
    const p = L.llamar('b@a.com', false);
    await tick(800);
    afirmar(obs.audioArranques === 0, 'arrancó el audio con AURA todavía cerrándose');
    // Así cierra el SDK de ElevenLabs: primero para la sesión de audio y DESPUÉS avisa (onDisconnect).
    await H.AUDIO.stopAudioSession();
    bus.emitir('voz', { libre: true });
    await conReloj(p);
    afirmar(obs.audioArranques === 1 && obs.audioSesion === 'arrancada', `audio ${obs.audioSesion} (${obs.audioArranques} arranques)`);
    L.colgar('yo');
    await flush();
  });
  await prueba('R5-3', 'si AURA nunca avisa, la llamada no espera más de 2,5 s', async () => {
    const { L } = await nuevo();
    H.contrato().emitir('voz', { libre: false });
    const p = L.llamar('b@a.com', false);
    await tick(2000);
    afirmar(obs.audioArranques === 0, 'no esperó');
    await tick(600);
    afirmar(obs.audioArranques === 1, 'a los 2,6 s todavía sin audio');
    await conReloj(p);
    L.colgar('yo');
    await flush();
    H.contrato().emitir('voz', { libre: true });
  });
  await prueba('R5-3', 'al conectar se re-aplica el audio una vez, respetando el altavoz que eligió la persona', async () => {
    const n = await nuevo();
    await conReloj(n.L.llamar('b@a.com', false));
    await n.L.altavoz(true);
    await n.L.recibir({ de: 'b@a.com', tipo: 'respuesta', datos: { sdp: RESPUESTA() } });
    // Un cierre tardío de AURA le apagó el audio justo antes de conectar.
    await H.AUDIO.stopAudioSession();
    obs.pcs[obs.pcs.length - 1].conectar();
    await flush();
    afirmar(obs.audioArranques === 2 && obs.audioSesion === 'arrancada', `${obs.audioArranques} arranques, ${obs.audioSesion}`);
    afirmar(n.L.cuento().porAltavoz === true, 'volvió al auricular');
    // Un reinicio de ICE que vuelve a «connected» no lo re-aplica otra vez.
    obs.pcs[obs.pcs.length - 1].ice('disconnected');
    obs.pcs[obs.pcs.length - 1].conectar();
    await flush();
    afirmar(obs.audioArranques === 2, 'lo re-aplicó de más: ' + obs.audioArranques);
  });
  await prueba('R5-9', 'al apagar el altavoz con Bluetooth o audífonos, sale por ellos; sin nada, por el auricular', async () => {
    const n = await nuevo();
    await conReloj(n.L.llamar('b@a.com', true));
    obs.salidasHay = ['speaker', 'earpiece', 'bluetooth'];
    await n.L.altavoz(false);
    afirmar(obs.salidaElegida === 'bluetooth', 'con el carro puesto fue a: ' + obs.salidaElegida);
    obs.salidasHay = ['speaker', 'earpiece', 'headset'];
    await n.L.altavoz(true);
    afirmar(obs.salidaElegida === 'speaker', 'altavoz: ' + obs.salidaElegida);
    await n.L.altavoz(false);
    afirmar(obs.salidaElegida === 'headset', 'con audífonos fue a: ' + obs.salidaElegida);
    obs.salidasHay = null;
    await n.L.altavoz(true);
    await n.L.altavoz(false);
    afirmar(obs.salidaElegida === 'earpiece', 'sin nada conectado fue a: ' + obs.salidaElegida);
    n.L.colgar('yo');
    await flush();
  });
  await prueba('R5-8', 'conecta con la app DETRÁS: no relanza el servicio (Android 14), solo cambia el texto', async () => {
    const n = await nuevo();
    await conReloj(n.L.llamar('b@a.com', false));
    const antes = obs.servicio.notificaciones.length;
    afirmar(antes === 1 && obs.servicio.notificaciones[0].android.asForegroundService === true, 'no arrancó el servicio al llamar');
    obs.appState = 'background';
    await n.L.recibir({ de: 'b@a.com', tipo: 'respuesta', datos: { sdp: RESPUESTA() } });
    obs.pcs[obs.pcs.length - 1].conectar();
    await flush();
    const despues = obs.servicio.notificaciones.slice(antes);
    afirmar(despues.length === 1, 'notificaciones al conectar: ' + despues.length);
    afirmar(!despues[0].android.asForegroundService && !despues[0].android.foregroundServiceTypes, 'volvió a pedir el servicio en primer plano desde segundo plano');
    afirmar(/Cifrada|encrypted/.test(despues[0].body) && despues[0].android.showChronometer, 'no actualizó el texto: ' + despues[0].body);
    afirmar(obs.servicio.activo, 'el servicio que ya corría se paró');
    n.L.colgar('yo');
    await flush();
    afirmar(!obs.servicio.activo, 'al colgar el servicio sigue');
  });
  await prueba('R5-8', 'con la app delante al conectar, el texto se actualiza como siempre', async () => {
    const n = await llamadaEnPie();
    const ult = obs.servicio.notificaciones[obs.servicio.notificaciones.length - 1];
    afirmar(ult.android.asForegroundService === true && /Cifrada|encrypted/.test(ult.body), JSON.stringify(ult.body));
    n.L.colgar('yo');
    await flush();
  });

  /* ── M10: liberar pistas ── */
  await prueba('M10', 'al colgar las pistas se paran Y se liberan (release)', async () => {
    const { L } = await nuevo();
    await conReloj(L.llamar('b@a.com', true));
    L.colgar('yo');
    await flush();
    afirmar(obs.tracks.length === 2 && obs.tracks.every((t) => t.parado && t.liberado), JSON.stringify(obs.tracks.map((t) => [t.kind, t.parado, t.liberado])));
  });

  /* ── M11: video remoto ── */
  await prueba('M11', 'el video grande se decide por las pistas del OTRO, no por la cámara propia', async () => {
    const { L } = await llamadaEnPie({}, false);
    obs.pcs[0].llegaPista(true);
    await flush();
    const c1 = L.cuento();
    afirmar(c1.videoRemoto === true && c1.hayVideo === false, JSON.stringify({ r: c1.videoRemoto, p: c1.hayVideo }));
    const n = await llamadaEnPie({}, true);
    obs.pcs[0].llegaPista(false);
    await flush();
    const c2 = n.L.cuento();
    afirmar(c2.videoRemoto === false && c2.hayVideo === true, JSON.stringify({ r: c2.videoRemoto, p: c2.hayVideo }));
  });

  /* ── B1: atendida en otro aparato ── */
  for (const [como, motivo] of [
    ['respuesta', 'en-otro-aparato'],
    ['rechazo', 'rechazada-en-otro-aparato'],
    ['', 'atendida-en-otro-aparato'],
  ]) {
    await prueba('B1', `«atendida» { como: '${como}' } → «${motivo}»`, async () => {
      const { L, ultimo } = await nuevo();
      await L.recibir({ de: 'x@a.com', tipo: 'llamo', datos: { video: false, sdp: OFERTA() } });
      await L.recibir({ de: 'x@a.com', tipo: 'atendida', datos: como ? { como } : {}, desde: 'OG' });
      afirmar(ultimo().motivo === motivo, 'motivo ' + ultimo().motivo);
    });
  }

  /* ── el bus del contrato ── */
  await prueba('BUS', 'llamada saliente: «llamada» activa:true al empezar y activa:false al terminar, una vez cada una', async () => {
    const eventos = [];
    const soltar = H.contrato().escuchar('llamada', (e) => eventos.push(e));
    try {
      const { L } = await nuevo();
      await conReloj(L.llamar('b@a.com', true));
      afirmar(eventos.length === 1 && eventos[0].activa === true && eventos[0].video === true, JSON.stringify(eventos));
      L.colgar('yo');
      await flush();
      afirmar(eventos.length === 2 && eventos[1].activa === false && eventos[1].video === true, JSON.stringify(eventos));
    } finally {
      soltar();
    }
  });
  await prueba('BUS', 'llamada entrante: activa:true al sonar y activa:false al quedar perdida', async () => {
    const eventos = [];
    const soltar = H.contrato().escuchar('llamada', (e) => eventos.push(e));
    try {
      const { L } = await nuevo();
      await L.recibir({ de: 'x@a.com', tipo: 'llamo', datos: { video: false, sdp: OFERTA() } });
      afirmar(eventos.length === 1 && eventos[0].activa && !eventos[0].video, JSON.stringify(eventos));
      await tick(46_000);
      afirmar(eventos.length === 2 && !eventos[1].activa, JSON.stringify(eventos));
    } finally {
      soltar();
    }
  });

  /* ── el informe ── */
  const fallas = resultados.filter((r) => !r.ok);
  for (const r of resultados) console.log(`${r.ok ? 'PASA ' : 'FALLA'}  ${r.id.padEnd(4)} ${r.titulo}${r.ok ? '' : '\n        → ' + r.error}`);
  console.log(`\n${resultados.length - fallas.length}/${resultados.length} pasan  (${H.SRC})${sinAtrapar ? `  · ${sinAtrapar} promesas rechazadas sin atrapar` : ''}`);
  if (sinAtrapar) process.exitCode = 1;
  process.exit(fallas.length || sinAtrapar ? 1 : 0);
})();
