// Identidad · cuándo se aplica la actualización por aire (lib/barreraOta.ts, la lógica pura de lib/ota.ts).
//
//  O1  Al volver a la app: tras ≥ 45 s fuera se aplica (antes 10 min); menos es mirar y regresar.
//  O2  Con la app delante y quieta 3 min (sin toques ni voz) se aplica; con actividad reciente, no.
//  O3  Al terminar una llamada: se aplica si nadie tocó nada en 20 s; con la llamada viva, nunca.
//  O4  Nada se queda frenando para siempre: un borrador olvidado (> 10 min) y un `llamada`/`voz`
//      sin su cierre (> 5 min) dejan de frenar; lo vivo (comprobador `true`) sigue frenando.
//  O5  «Instala la APK nueva» solo en producción y con una huella de verdad distinta a la instalada.
const { ok, fin } = require('../chat/comun.cjs');

(async () => {
  const M = require(process.env.IDENTIDAD || './out/identidad.cjs');
  const { BARRERA: B, CONTRATO } = M;
  console.log('identidad · la actualización por aire\n');
  if (!B || !B.decidirAplicar) {
    ok('O1: hay decidirAplicar en lib/barreraOta', false);
    return fin();
  }
  const MIN = 60_000;
  const t0 = Date.now();
  B._reiniciarBarreraOta();

  /* ── O1: al volver ─────────────────────────────────────────────────────────────────── */
  ok('O1: sin OTA descargada, nada', B.decidirAplicar({ pendiente: false, momento: 'volver', fueraMs: 60 * MIN, motivos: [] }) === 'nada');
  ok('O1: vuelve tras 50 s, aplica', B.decidirAplicar({ pendiente: true, momento: 'volver', fueraMs: 50_000, motivos: [] }) === 'aplicar');
  ok('O1: vuelve tras 10 s, nada', B.decidirAplicar({ pendiente: true, momento: 'volver', fueraMs: 10_000, motivos: [] }) === 'nada');
  ok('O1: vuelve tras 50 s con llamada, pospone', B.decidirAplicar({ pendiente: true, momento: 'volver', fueraMs: 50_000, motivos: ['llamada'] }) === 'posponer');

  /* ── O2: quieta ────────────────────────────────────────────────────────────────────── */
  ok('O2: 4 min quieta, aplica', B.decidirAplicar({ pendiente: true, momento: 'quieto', quietoMs: 4 * MIN, motivos: [] }) === 'aplicar');
  ok('O2: tocada hace 1 min, nada', B.decidirAplicar({ pendiente: true, momento: 'quieto', quietoMs: MIN, motivos: [] }) === 'nada');
  ok('O2: quieta pero AURA hablando, pospone', B.decidirAplicar({ pendiente: true, momento: 'quieto', quietoMs: 4 * MIN, motivos: ['aura-habla'] }) === 'posponer');
  B.marcarActividad(t0);
  ok('O2: marcarActividad pone el reloj de quieta a cero', B.quietoDesdeMs(t0 + 1000) === 1000, String(B.quietoDesdeMs(t0 + 1000)));
  ok('O2: …y a los 3 min ya cuenta como quieta', B.quietoDesdeMs(t0 + 3 * MIN) >= B.QUIETO_PARA_APLICAR_MS);

  /* ── O3: al terminar una llamada ───────────────────────────────────────────────────── */
  ok('O3: colgó y 25 s sin tocar, aplica', B.decidirAplicar({ pendiente: true, momento: 'fin-trabajo', quietoMs: 25_000, motivos: [] }) === 'aplicar');
  ok('O3: colgó y tocó hace 5 s, nada (lo toma «quieta» después)', B.decidirAplicar({ pendiente: true, momento: 'fin-trabajo', quietoMs: 5_000, motivos: [] }) === 'nada');
  let viva = true;
  const quitarViva = B.registrarTrabajoActivo('llamada-en-curso', () => viva);
  ok('O3: con la llamada viva, pospone', B.decidirAplicar({ pendiente: true, momento: 'fin-trabajo', quietoMs: 25_000 }) === 'posponer');
  ok('O3: el botón tampoco recarga encima de la llamada', B.decidirAplicar({ pendiente: true, momento: 'boton' }) === 'posponer');
  viva = false;
  ok('O3: ya colgada, el botón aplica', B.decidirAplicar({ pendiente: true, momento: 'boton' }) === 'aplicar', B.motivosParaNoRecargar().join());
  quitarViva();

  /* ── O4: nada frena para siempre ───────────────────────────────────────────────────── */
  let tocadoEn = t0;
  const quitarBorrador = B.registrarTrabajoActivo('borrador-chat', () => tocadoEn || false);
  ok('O4: borrador tocado hace 2 min, frena', B.motivosParaNoRecargar(t0 + 2 * MIN).includes('borrador-chat'));
  ok('O4: borrador olvidado hace 11 min, ya no frena', !B.motivosParaNoRecargar(t0 + 11 * MIN).includes('borrador-chat'));
  tocadoEn = 0;
  ok('O4: sin borrador (0), no frena', !B.motivosParaNoRecargar(t0).includes('borrador-chat'));
  quitarBorrador();

  CONTRATO.emitir('llamada', { activa: true, video: false });
  ok('O4: aviso de llamada recién llegado, frena', B.motivosParaNoRecargar().includes('llamada'));
  ok('O4: el cierre se perdió: a los 6 min ya no frena', !B.motivosParaNoRecargar(Date.now() + 6 * MIN).includes('llamada'));
  CONTRATO.emitir('llamada', { activa: false, video: false });
  CONTRATO.emitir('voz', { libre: false });
  ok('O4: la conversación tomó el audio, frena', B.motivosParaNoRecargar().includes('voz'));
  ok('O4: sin «libre» en 6 min, ya no frena', !B.motivosParaNoRecargar(Date.now() + 6 * MIN).includes('voz'));
  CONTRATO.emitir('voz', { libre: true });
  ok('O4: con todo libre, no hay motivos', B.motivosParaNoRecargar().length === 0, B.motivosParaNoRecargar().join());

  const quitarTeclado = B.registrarTrabajoActivo('teclado', () => true);
  ok('O4: lo vivo (true) frena aunque pase una hora', B.motivosParaNoRecargar(Date.now() + 60 * MIN).includes('teclado'));
  quitarTeclado();
  const quitarRepetido = B.registrarTrabajoActivo('llamada', () => true);
  CONTRATO.emitir('llamada', { activa: true, video: false });
  ok('O4: un motivo no sale dos veces', B.motivosParaNoRecargar().filter((m) => m === 'llamada').length === 1);
  CONTRATO.emitir('llamada', { activa: false, video: false });
  quitarRepetido();

  /* ── O5: ¿APK nueva? ───────────────────────────────────────────────────────────────── */
  const h1 = 'a'.repeat(40);
  const h2 = 'b'.repeat(40);
  ok('O5: misma huella, no', B.necesitaApkNueva({ instalado: h1, publicado: h1 + '\n', canal: 'production' }) === false);
  ok('O5: otra huella en producción, sí', B.necesitaApkNueva({ instalado: h1, publicado: h2 + '\n', canal: 'production' }) === true);
  ok('O5: APK de una rama (canal pruebas), no', B.necesitaApkNueva({ instalado: h1, publicado: h2, canal: 'pruebas' }) === false);
  ok('O5: lo publicado no es una huella (una página de error), no', B.necesitaApkNueva({ instalado: h1, publicado: '<html>Not Found</html>', canal: 'production' }) === false);
  ok('O5: sin huella instalada (desarrollo), no', B.necesitaApkNueva({ instalado: null, publicado: h2, canal: 'production' }) === false);

  fin();
})();
