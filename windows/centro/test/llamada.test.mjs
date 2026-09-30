/**
 * EL MOTOR DE LLAMADAS del Centro (`src/pulse/llamada.ts`), con dos (o tres) motores de verdad
 * conectados por un bus de señales de mentira y un WebRTC de mentira:
 *
 *   · `Conexion` imita RTCPeerConnection: estados de señalización, oferta/respuesta, rollback, ICE
 *     (suelta un candidato tras cada descripción local) y, con las dos descripciones puestas y estable,
 *     «conecta» (iceConnectionState/connectionState → connected, y llega la pista del otro). Con
 *     `red.bloqueada` se queda en `checking` para siempre (no hay camino).
 *   · El bus entrega cada señal al motor del destinatario, EN ORDEN por remitente (como el relevo), y
 *     puede tardar en contestarle al que manda (`retrasoRespuesta[tipo]`), como un POST lento.
 *
 * Los plazos se achican (timbre, conexión, corte) para que las pruebas duren milisegundos.
 */
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { armar, esperar, dormir, CENTRO } from './ayudas.mjs';

let crearMotor;

before(async () => {
  ({ crearMotor } = await armar(join(CENTRO, 'src', 'pulse', 'llamada.ts')));
});

/* ── medios y WebRTC de mentira ───────────────────────────────────────────────────────────── */

let serie = 0;
const red = { bloqueada: false, conexiones: [] };

class Pista {
  constructor(kind) {
    this.kind = kind;
    this.id = `${kind}-${++serie}`;
    this.enabled = true;
    this.readyState = 'live';
  }
  stop() {
    this.readyState = 'ended';
  }
  addEventListener() {}
  removeEventListener() {}
  getSettings() {
    return { deviceId: 'default' };
  }
}

class Flujo {
  constructor(pistas = []) {
    this.id = `flujo-${++serie}`;
    this.pistas = [...pistas];
  }
  getTracks() {
    return [...this.pistas];
  }
  getAudioTracks() {
    return this.pistas.filter((p) => p.kind === 'audio');
  }
  getVideoTracks() {
    return this.pistas.filter((p) => p.kind === 'video');
  }
  addTrack(p) {
    this.pistas.push(p);
  }
  removeTrack(p) {
    this.pistas = this.pistas.filter((x) => x !== p);
  }
}
globalThis.MediaStream ??= Flujo;

const falla = (que) => Object.assign(new Error(`InvalidStateError: ${que}`), { name: 'InvalidStateError' });

class Conexion extends EventTarget {
  constructor(cfg) {
    super();
    this.cfg = cfg;
    this.id = ++serie;
    this.n = 0;
    this.signalingState = 'stable';
    this.iceConnectionState = 'new';
    this.connectionState = 'new';
    this.localDescription = null;
    this.remoteDescription = null;
    this.emisores = [];
    this.candidatos = [];
    this.pistaEntregada = false;
    this.localAntes = null;
    red.conexiones.push(this);
  }
  vivo() {
    if (this.signalingState === 'closed') throw falla('conexión cerrada');
  }
  addTrack(track, flujo) {
    const e = { track, replaceTrack: async (n) => void (e.track = n) };
    this.emisores.push(e);
    this.flujoLocal = flujo;
    return e;
  }
  getSenders() {
    return this.emisores;
  }
  async createOffer(o = {}) {
    this.vivo();
    return { type: 'offer', sdp: `oferta-${this.id}-${++this.n}${o.iceRestart ? '-reinicio' : ''}` };
  }
  async createAnswer() {
    this.vivo();
    if (this.signalingState !== 'have-remote-offer') throw falla('respuesta sin oferta');
    return { type: 'answer', sdp: `respuesta-${this.id}-${++this.n}` };
  }
  async setLocalDescription(d) {
    this.vivo();
    if (d.type === 'rollback') {
      if (this.signalingState !== 'have-local-offer') throw falla('rollback sin oferta');
      this.localDescription = this.localAntes;
      this.signalingState = 'stable';
      return;
    }
    if (d.type === 'offer') {
      if (this.signalingState !== 'stable') throw falla('oferta en ' + this.signalingState);
      this.localAntes = this.localDescription;
      this.localDescription = { type: d.type, sdp: d.sdp };
      this.signalingState = 'have-local-offer';
    } else {
      if (this.signalingState !== 'have-remote-offer') throw falla('respuesta local en ' + this.signalingState);
      this.localDescription = { type: d.type, sdp: d.sdp };
      this.signalingState = 'stable';
    }
    this.soltarCandidato();
    this.revisar();
  }
  async setRemoteDescription(d) {
    this.vivo();
    if (!d || typeof d.sdp !== 'string' || !d.type) throw new TypeError('descripción inválida');
    if (d.type === 'offer') {
      if (this.signalingState !== 'stable') throw falla('oferta remota en ' + this.signalingState);
      this.remoteDescription = { type: d.type, sdp: d.sdp };
      this.signalingState = 'have-remote-offer';
    } else {
      if (this.signalingState !== 'have-local-offer') throw falla('respuesta remota en ' + this.signalingState);
      this.remoteDescription = { type: d.type, sdp: d.sdp };
      this.signalingState = 'stable';
    }
    this.revisar();
  }
  async addIceCandidate(c) {
    this.vivo();
    if (!this.remoteDescription) throw falla('candidato sin descripción remota');
    this.candidatos.push(c);
  }
  close() {
    this.signalingState = 'closed';
    this.iceConnectionState = 'closed';
    this.connectionState = 'closed';
  }
  emitir(tipo, props = {}) {
    this.dispatchEvent(Object.assign(new Event(tipo), props));
  }
  soltarCandidato() {
    const n = this.n;
    setTimeout(() => {
      if (this.signalingState === 'closed') return;
      const candidate = {
        candidate: `candidate:${this.id}-${n} 1 udp 1 10.0.0.1 5000 typ host`,
        type: 'host',
        toJSON() {
          return { candidate: this.candidate, sdpMid: '0', sdpMLineIndex: 0 };
        },
      };
      this.emitir('icecandidate', { candidate });
      this.emitir('icecandidate', { candidate: null });
    }, 1);
  }
  revisar() {
    if (this.signalingState !== 'stable' || !this.localDescription || !this.remoteDescription) return;
    setTimeout(() => {
      if (this.signalingState !== 'stable' || this.connectionState === 'closed') return;
      if (red.bloqueada) return this.ponerIce('checking');
      this.ponerIce('connected');
      this.ponerConexion('connected');
      if (!this.pistaEntregada) {
        this.pistaEntregada = true;
        const pista = new Pista('audio');
        this.emitir('track', { track: pista, streams: [new Flujo([pista])] });
      }
    }, 3);
  }
  ponerIce(st) {
    this.iceConnectionState = st;
    this.emitir('iceconnectionstatechange');
  }
  ponerConexion(st) {
    this.connectionState = st;
    this.emitir('connectionstatechange');
  }
  /** Se cae el camino (un cambio de red): ICE y conexión pasan a «disconnected». */
  cortar() {
    this.ponerIce('disconnected');
    this.ponerConexion('disconnected');
  }
}

/* ── el bus de señales y los participantes ────────────────────────────────────────────────── */

const PLAZOS = { timbre: 400, conexion: 400, corte: 250, reinicio: 30, turno: 20, huerfano: 150 };

function crearBus() {
  const motores = new Map();
  const registro = [];
  const retrasoRespuesta = {};
  const mandarDesde = (de) => (para, tipo, datos) => {
    registro.push({ de, para, tipo, datos });
    const copia = structuredClone(datos ?? {});
    // Como el relevo: en orden por remitente, un momento después.
    setTimeout(() => {
      const p = motores.get(para);
      if (p) void p.motor.recibir({ de, tipo, datos: copia });
    }, 1);
    const espera = retrasoRespuesta[tipo] || 0;
    return new Promise((r) => setTimeout(() => r({ ok: true }), espera));
  };
  return { motores, registro, retrasoRespuesta, mandarDesde, enviadas: (de, tipo) => registro.filter((x) => x.de === de && x.tipo === tipo) };
}

function participante(bus, correo, o = {}) {
  const cuentos = [];
  const sonidos = [];
  const medios = [];
  const abrirMedios =
    o.abrirMedios ||
    (async (video) => {
      const flujo = new Flujo([new Pista('audio'), ...(video ? [new Pista('video')] : [])]);
      medios.push(flujo);
      return { flujo, video: !!video };
    });
  const motor = crearMotor({
    mandar: bus.mandarDesde(correo),
    alCambiar: (c) => cuentos.push(c),
    aparato: () => o.aparato || `ap-${correo}`,
    correo: () => correo,
    crearConexion: (cfg) => new Conexion(cfg),
    abrirMedios,
    sonar: (s) => sonidos.push(s),
    plazos: { ...PLAZOS, ...(o.plazos || {}) },
  });
  bus.motores.set(correo, { motor });
  const p = {
    correo,
    motor,
    cuentos,
    sonidos,
    medios,
    estado: () => motor.cuento().estado,
    ultimo: () => cuentos[cuentos.length - 1],
    /** El motivo con el que terminó la última llamada (el aviso final lleva `motivo`). */
    motivo: () => [...cuentos].reverse().find((c) => c.estado === 'libre' && c.motivo)?.motivo,
  };
  return p;
}

const libre = (...ps) => ps.every((p) => p.estado() === 'libre');

beforeEach(() => {
  red.bloqueada = false;
  red.conexiones = [];
});

/* ── las pruebas ──────────────────────────────────────────────────────────────────────────── */

test('llamar → contestar → hablar → colgar', async () => {
  const bus = crearBus();
  const ana = participante(bus, 'ana@x.org');
  const beto = participante(bus, 'beto@x.org');

  await ana.motor.llamar('Beto@X.org', false);
  assert.equal(ana.estado(), 'llamando');
  assert.ok(ana.sonidos.includes('tono'), 'suena el tono de «está sonando»');
  await esperar(() => beto.estado() === 'entrando', 'a Beto le suena');
  assert.deepEqual(beto.motor.cuento().entrante, { de: 'ana@x.org', video: false });
  assert.ok(beto.sonidos.includes('timbre'));

  await beto.motor.contestar(false);
  await esperar(() => ana.estado() === 'hablando' && beto.estado() === 'hablando', 'los dos hablando');
  const a = ana.motor.cuento();
  assert.equal(a.soyQuienLlama, true);
  assert.equal(a.conQuien, 'beto@x.org');
  assert.ok(a.flujoRemoto, 'a Ana le llega el audio de Beto');
  assert.ok(typeof a.desde === 'number' && a.desde > 0, 'el reloj de la llamada arrancó');
  assert.ok(beto.motor.cuento().flujoRemoto);
  assert.equal(ana.sonidos.at(-1), null, 'el tono se calló');
  assert.equal(beto.sonidos.at(-1), null, 'el timbre se calló');
  // Los caminos viajaron y se agregaron del otro lado.
  assert.ok(bus.enviadas('ana@x.org', 'ice').length >= 1);
  assert.ok(red.conexiones.some((c) => c.candidatos.length > 0));

  // Silenciar se ve en el cuento.
  ana.motor.micro();
  assert.equal(ana.motor.cuento().micAbierto, false);
  ana.motor.micro(true);
  assert.equal(ana.motor.cuento().micAbierto, true);

  ana.motor.colgar('yo');
  assert.equal(ana.estado(), 'libre');
  assert.equal(ana.motivo(), 'yo');
  assert.equal(ana.ultimo().conQuien, 'beto@x.org', 'el aviso final dice con quién era');
  await esperar(() => beto.estado() === 'libre', 'Beto se entera');
  assert.equal(beto.motivo(), 'el-otro');
  assert.ok(red.conexiones.every((c) => c.signalingState === 'closed'), 'las conexiones se cerraron');
  assert.ok([...ana.medios, ...beto.medios].every((f) => f.getTracks().every((t) => t.readyState === 'ended')), 'micrófonos soltados');
});

test('rechazar: quien llama ve «rechazada», nadie queda en llamada', async () => {
  const bus = crearBus();
  const ana = participante(bus, 'ana@x.org');
  const beto = participante(bus, 'beto@x.org');
  await ana.motor.llamar('beto@x.org', true);
  await esperar(() => beto.estado() === 'entrando', 'suena');
  assert.equal(beto.motor.cuento().entrante.video, true);
  beto.motor.rechazar();
  assert.equal(beto.motivo(), 'yo');
  await esperar(() => ana.estado() === 'libre', 'Ana se entera');
  assert.equal(ana.motivo(), 'rechazada');
  assert.equal(bus.enviadas('beto@x.org', 'rechazo').length, 1);
  // Colgar mientras suena es rechazar.
  await ana.motor.llamar('beto@x.org', false);
  await esperar(() => beto.estado() === 'entrando', 'suena otra vez');
  beto.motor.colgar('yo');
  await esperar(() => ana.estado() === 'libre', 'rechazada otra vez');
  assert.equal(ana.motivo(), 'rechazada');
});

test('ocupado: a quien ya está en otra llamada no le suena; el que llama ve «ocupado»', async () => {
  const bus = crearBus();
  const ana = participante(bus, 'ana@x.org');
  const beto = participante(bus, 'beto@x.org');
  const caro = participante(bus, 'caro@x.org');
  await caro.motor.llamar('beto@x.org', false);
  await esperar(() => beto.estado() === 'entrando', 'Caro llama a Beto');
  await beto.motor.contestar(false);
  await esperar(() => beto.estado() === 'hablando' && caro.estado() === 'hablando', 'Beto habla con Caro');

  await ana.motor.llamar('beto@x.org', false);
  await esperar(() => ana.estado() === 'libre', 'Ana recibe «ocupado»');
  assert.equal(ana.motivo(), 'ocupado');
  assert.equal(bus.enviadas('beto@x.org', 'ocupado').length, 1);
  assert.equal(beto.estado(), 'hablando', 'la llamada de Beto con Caro sigue');
  assert.equal(beto.motor.cuento().conQuien, 'caro@x.org');
  caro.motor.colgar('yo');
  await esperar(() => libre(beto, caro), 'terminan');
});

test('nadie contesta: a los segundos del timbre, «no contestó» de un lado y «perdida» del otro', async () => {
  const bus = crearBus();
  const ana = participante(bus, 'ana@x.org');
  const beto = participante(bus, 'beto@x.org');
  const t0 = Date.now();
  await ana.motor.llamar('beto@x.org', false);
  await esperar(() => beto.estado() === 'entrando', 'suena');
  await esperar(() => libre(ana, beto), 'se cansa de sonar', 2000);
  assert.ok(Date.now() - t0 >= PLAZOS.timbre - 20, 'no antes del plazo');
  assert.equal(ana.motivo(), 'no-contesto');
  assert.equal(beto.motivo(), 'perdida');
  assert.equal(bus.enviadas('ana@x.org', 'cuelgo').length, 1, 'quien llama avisa que colgó');
});

test('llamadas cruzadas: sigue como llamante el correo menor y los dos terminan hablando', async () => {
  const bus = crearBus();
  const ana = participante(bus, 'ana@x.org');
  const beto = participante(bus, 'beto@x.org');
  await Promise.all([ana.motor.llamar('beto@x.org', false), beto.motor.llamar('ana@x.org', true)]);
  await esperar(() => ana.estado() === 'hablando' && beto.estado() === 'hablando', 'los dos hablando');
  assert.equal(ana.motor.cuento().soyQuienLlama, true, 'ana < beto: Ana sigue llamando');
  assert.equal(beto.motor.cuento().soyQuienLlama, false, 'Beto cedió y contestó');
  assert.equal(bus.enviadas('ana@x.org', 'ocupado').length + bus.enviadas('beto@x.org', 'ocupado').length, 0, 'nadie dijo «ocupado»');
  assert.equal(bus.enviadas('beto@x.org', 'cuelgo').length, 0, 'ceder no cuelga la llamada que sigue');
  assert.equal(bus.enviadas('beto@x.org', 'respuesta').length, 1);
  // Beto quería video, pero la llamada de Ana es de voz: contesta sin cámara.
  assert.equal(beto.motor.cuento().hayVideo, false);
  // Solo quedó UNA conexión viva por lado.
  assert.equal(red.conexiones.filter((c) => c.signalingState !== 'closed').length, 2);
  beto.motor.colgar('yo');
  await esperar(() => libre(ana, beto), 'terminan');
  assert.equal(ana.motivo(), 'el-otro');
});

test('colgar con el «llamo» todavía en camino: al otro le llega el `cuelgo` y deja de sonar en el acto', async () => {
  const bus = crearBus();
  bus.retrasoRespuesta.llamo = 150; // el relevo entrega el llamo, pero el POST tarda en volver
  const ana = participante(bus, 'ana@x.org');
  const beto = participante(bus, 'beto@x.org', { plazos: { timbre: 10_000 } });
  const llamando = ana.motor.llamar('beto@x.org', false);
  await esperar(() => beto.estado() === 'entrando', 'a Beto ya le suena');
  ana.motor.colgar('yo');
  assert.equal(ana.estado(), 'libre');
  await llamando;
  await esperar(() => beto.estado() === 'libre', 'Beto deja de sonar sin esperar el plazo', 1000);
  assert.equal(beto.motivo(), 'perdida');
  assert.equal(bus.enviadas('ana@x.org', 'cuelgo').length, 1);
});

test('`atendida`: si contestó OTRO aparato de la cuenta deja de sonar aquí; la propia se ignora', async () => {
  const bus = crearBus();
  const ana = participante(bus, 'ana@x.org');
  const beto = participante(bus, 'beto@x.org', { aparato: 'centro-beto' });
  await ana.motor.llamar('beto@x.org', false);
  await esperar(() => beto.estado() === 'entrando', 'suena');
  await beto.motor.recibir({ de: 'ana@x.org', tipo: 'atendida', datos: { como: 'respuesta' }, desde: 'centro-beto' });
  assert.equal(beto.estado(), 'entrando', 'la que causó este mismo aparato no cuenta');
  await beto.motor.recibir({ de: 'ana@x.org', tipo: 'atendida', datos: { como: 'respuesta' }, desde: 'telefono-beto' });
  assert.equal(beto.estado(), 'libre');
  assert.equal(beto.motivo(), 'en-otro-aparato');
  assert.equal(bus.enviadas('beto@x.org', 'rechazo').length + bus.enviadas('beto@x.org', 'cuelgo').length, 0, 'no le avisa nada a Ana');
  ana.motor.colgar('yo');

  // Rechazada en el otro aparato.
  await ana.motor.llamar('beto@x.org', false);
  await esperar(() => beto.estado() === 'entrando', 'suena de nuevo');
  await beto.motor.recibir({ de: 'ana@x.org', tipo: 'atendida', datos: { como: 'rechazo' }, desde: 'telefono-beto' });
  assert.equal(beto.motivo(), 'rechazada-en-otro-aparato');
  ana.motor.colgar('yo');
});

test('contestar sin permiso de micrófono: quien llama ve que quiso contestar y no pudo', async () => {
  const bus = crearBus();
  const ana = participante(bus, 'ana@x.org');
  const beto = participante(bus, 'beto@x.org', {
    abrirMedios: async () => {
      throw Object.assign(new Error('sin-permiso'), { motivo: 'sin-permiso' });
    },
  });
  await ana.motor.llamar('beto@x.org', false);
  await esperar(() => beto.estado() === 'entrando', 'suena');
  await beto.motor.contestar(false);
  assert.equal(beto.motivo(), 'sin-permiso');
  await esperar(() => ana.estado() === 'libre', 'Ana se entera');
  assert.equal(ana.motivo(), 'el-otro-sin-permiso');
});

test('un «rechazo» tardío de otro aparato no tumba la llamada ya contestada', async () => {
  const bus = crearBus();
  const ana = participante(bus, 'ana@x.org');
  const beto = participante(bus, 'beto@x.org');
  await ana.motor.llamar('beto@x.org', false);
  await esperar(() => beto.estado() === 'entrando', 'suena');
  await beto.motor.contestar(false);
  await esperar(() => ana.estado() === 'hablando', 'hablando');
  await ana.motor.recibir({ de: 'beto@x.org', tipo: 'rechazo', datos: {} });
  await ana.motor.recibir({ de: 'beto@x.org', tipo: 'ocupado', datos: {} });
  assert.equal(ana.estado(), 'hablando');
  ana.motor.colgar('yo');
  await esperar(() => libre(ana, beto), 'terminan');
});

test('se cae el camino y vuelve: quien llamó pide reinicio de ICE y la llamada sigue', async () => {
  const bus = crearBus();
  const ana = participante(bus, 'ana@x.org');
  const beto = participante(bus, 'beto@x.org');
  await ana.motor.llamar('beto@x.org', false);
  await esperar(() => beto.estado() === 'entrando', 'suena');
  await beto.motor.contestar(false);
  await esperar(() => ana.estado() === 'hablando' && beto.estado() === 'hablando', 'hablando');
  const pcAna = red.conexiones.find((c) => c.signalingState !== 'closed' && c.localDescription?.type === 'offer');
  assert.ok(pcAna);
  pcAna.cortar();
  assert.equal(ana.motor.cuento().reconectando, true);
  await esperar(() => bus.enviadas('ana@x.org', 'oferta').length === 1, 'Ana pide el reinicio');
  assert.match(bus.enviadas('ana@x.org', 'oferta')[0].datos.sdp.sdp, /reinicio/);
  await esperar(() => bus.enviadas('beto@x.org', 'respuesta').length === 2, 'Beto contesta el reinicio');
  await esperar(() => ana.motor.cuento().reconectando === false, 'vuelve el camino');
  await dormir(PLAZOS.corte + 50);
  assert.equal(ana.estado(), 'hablando', 'no se colgó por el corte');
  assert.equal(beto.estado(), 'hablando');
  ana.motor.colgar('yo');
  await esperar(() => libre(ana, beto), 'terminan');
});

test('se cae el camino y no vuelve: a los segundos se cuelga por «corte» y el otro se entera', async () => {
  const bus = crearBus();
  const ana = participante(bus, 'ana@x.org');
  const beto = participante(bus, 'beto@x.org');
  await ana.motor.llamar('beto@x.org', false);
  await esperar(() => beto.estado() === 'entrando', 'suena');
  await beto.motor.contestar(false);
  await esperar(() => ana.estado() === 'hablando', 'hablando');
  red.bloqueada = true;
  const pcAna = red.conexiones.find((c) => c.signalingState !== 'closed' && c.localDescription?.type === 'offer');
  pcAna.cortar();
  await esperar(() => ana.estado() === 'libre', 'se cuelga por el corte', 2000);
  assert.equal(ana.motivo(), 'corte');
  await esperar(() => beto.estado() === 'libre', 'Beto se entera');
  assert.equal(beto.motivo(), 'el-otro');
});

test('sin camino de red: contestada pero nunca conecta → «sin-camino» (y dice que faltó un relevo TURN)', async () => {
  const bus = crearBus();
  red.bloqueada = true;
  const ana = participante(bus, 'ana@x.org');
  const beto = participante(bus, 'beto@x.org');
  await ana.motor.llamar('beto@x.org', false);
  await esperar(() => beto.estado() === 'entrando', 'suena');
  await beto.motor.contestar(false);
  await esperar(() => libre(ana, beto), 'se rinden', 2000);
  const motivos = [ana.motivo(), beto.motivo()];
  assert.ok(motivos.includes('sin-camino'), `alguno dice «sin camino» (${motivos})`);
  const fin = [...ana.cuentos, ...beto.cuentos].find((c) => c.motivo === 'sin-camino');
  assert.equal(fin.hizoFaltaRelevo, true);
});

test('ya en llamada no se puede llamar a otro (lanza sin tocar la llamada)', async () => {
  const bus = crearBus();
  const ana = participante(bus, 'ana@x.org');
  participante(bus, 'beto@x.org');
  await ana.motor.llamar('beto@x.org', false);
  await assert.rejects(ana.motor.llamar('caro@x.org', false), /ya hay una llamada/);
  assert.equal(ana.motor.cuento().conQuien, 'beto@x.org');
  ana.motor.colgar('yo');
});
