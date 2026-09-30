// Costura · una llamada con AURA abierta: motor de llamadas + bus + sesión de la voz (sesion.ts,
// coordinarLlamadas, audioVoz) + relevo REAL, con WebRTC, audio, notifee y AppState simulados.
//
//  · El cierre de ElevenLabs para la sesión de audio DESPUÉS de desconectar: la llamada tiene que
//    arrancar la suya después de ese stop, no antes (si no, se queda sin audio).
//  · Conectar con la app detrás no relanza el servicio de micrófono (Android 14): solo cambia el texto.
//  · Si la llamada termina con la app detrás, ElevenLabs no se reabre en segundo plano.
//  · Salir de la cuenta cuelga la llamada y el otro recibe `cuelgo` (firmado antes de soltar la llave).
const { ok, fin, espera, arrancarRelevo, entrarComo } = require('../chat/comun.cjs');

(async () => {
  const R = await arrancarRelevo();
  const M = require(process.env.COSTURAS || './out/costuras.cjs');
  const { RELEVO, LLAMADA, CONTRATO, SESION, COMPA_LLAMADA, AUDIO_VOZ } = M;
  const audio = globalThis.__audio;
  const notifee = globalThis.__notifee;
  const rtc = globalThis.__rtc;
  const rn = globalThis.__rn;

  const A = await R.cuenta('José');
  const B = await R.cuenta('Beto Pérez');
  await R.amigos(A, B);
  await entrarComo(M, A);
  const senalesDeBeto = async () => ((await R.post('/senales', { ...B, aparato: 'aparatoDeBeto' })).senales || []).filter((s) => s.de === A.correo);

  // Lo que monta la app: PulseProvider (motor de llamadas por el relevo y colgar al salir de la cuenta)
  // y VozProvider (la sesión de AURA se apaga en la llamada; el audio de ElevenLabs avisa por el bus).
  LLAMADA.arrancar({ mandar: (para, tipo, datos) => RELEVO.senalar(para, tipo, datos), alCambiar: () => {}, aparato: RELEVO.miId, correo: () => RELEVO.quien()?.correo || '' });
  RELEVO.antesDeSalir(() => {
    if (LLAMADA.enLlamada()) LLAMADA.colgar('yo');
  });
  const control = new SESION.ControlSesion('aura', 'es');
  const audioVoz = new AUDIO_VOZ.AudioVoz((libre) => CONTRATO.emitir('voz', { libre }));
  COMPA_LLAMADA.coordinarLlamadas({
    escuchar: (t, f) => CONTRATO.escuchar(t, f),
    sesion: control,
    enPrimerPlano: () => rn.estado === 'active',
    suspenderVoz() {},
    suspenderOido() {},
    suspenderSfx() {},
  });
  // ModoConversacion simulado: al montarse toma el audio; al desmontarse (llamada) pide cerrar y el
  // SDK, 400 ms después, para la sesión de audio y recién entonces avisa onDisconnect.
  let genMontada = 0;
  control.suscribir((v) => {
    if (v.montada && v.gen !== genMontada) {
      genMontada = v.gen;
      audioVoz.tomar(v.gen);
      audio.historia.push('start-eleven');
    } else if (!v.montada && genMontada) {
      const g = genMontada;
      genMontada = 0;
      audioVoz.cerrando(g);
      setTimeout(() => {
        audio.estado = 'parada';
        audio.historia.push('stop-eleven');
        audioVoz.soltar(g);
      }, 400);
    }
  });

  console.log('costura · AURA abierta y entra una llamada saliente\n');
  control.iniciar();
  control.alEstado(control.vista().gen, 'escuchando');
  audio.historia.length = 0;
  await LLAMADA.llamar(B.correo, false);
  ok('AURA se apagó (sesión suspendida y desmontada)', control.vista().suspendida && !control.vista().montada);
  const h = audio.historia.join(' → ');
  ok('el audio de la llamada arranca DESPUÉS del stop de ElevenLabs', h.lastIndexOf('start') > h.indexOf('stop-eleven') && h.indexOf('stop-eleven') >= 0, h);
  ok('y queda arrancado', audio.estado === 'arrancada');
  ok('el servicio arrancó con la app delante', notifee.activo && notifee.avisos[0]?.android?.asForegroundService === true);
  await espera(100);
  ok('Beto recibe el «llamo» por el relevo', (await senalesDeBeto()).some((s) => s.tipo === 'llamo'));

  console.log('\ncostura · contesta con la app detrás\n');
  rn.estado = 'background';
  const avisosAntes = notifee.avisos.length;
  await LLAMADA.recibir({ de: B.correo, tipo: 'respuesta', datos: { sdp: { type: 'answer', sdp: 'respuesta' } } });
  rtc.pcs[rtc.pcs.length - 1].conectar();
  await espera(50);
  const nuevos = notifee.avisos.slice(avisosAntes);
  ok('hablando', LLAMADA.cuento().estado === 'hablando');
  ok('no se relanzó el servicio desde segundo plano', nuevos.length === 1 && !nuevos[0].android.asForegroundService, JSON.stringify(nuevos.map((n) => n.android.asForegroundService)));
  ok('pero la notificación dice que ya se habla', /Cifrada|encrypted/.test(nuevos[0]?.body || ''));
  ok('el audio se re-aplicó al conectar', audio.historia.filter((x) => x === 'start').length === 2 && audio.estado === 'arrancada', audio.historia.join(' → '));

  console.log('\ncostura · Beto cuelga con la app detrás\n');
  await LLAMADA.recibir({ de: B.correo, tipo: 'cuelgo', datos: {} });
  await espera(50);
  ok('la llamada terminó', !LLAMADA.enLlamada());
  ok('ElevenLabs NO se reabre en segundo plano', !control.vista().montada && !control.vista().suspendida, JSON.stringify(control.vista()));
  rn.estado = 'active';

  console.log('\ncostura · salir de la cuenta en plena llamada\n');
  await LLAMADA.llamar(B.correo, false);
  await espera(100);
  ok('llamando', LLAMADA.cuento().estado === 'llamando');
  await RELEVO.salir();
  await espera(300);
  ok('salir colgó la llamada', !LLAMADA.enLlamada());
  const llegan = await senalesDeBeto();
  ok('y a Beto le llega el «cuelgo» (salió firmado antes de soltar la llave)', llegan.some((s) => s.tipo === 'cuelgo'), llegan.map((s) => s.tipo).join());
  ok('el servicio se paró', !notifee.activo);
  fin();
})().catch((e) => {
  console.error('ERR', e);
  process.exit(1);
});
