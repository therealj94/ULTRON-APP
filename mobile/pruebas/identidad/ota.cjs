// Identidad · cuándo se aplica la actualización por aire (lib/barreraOta.ts, la lógica pura de lib/ota.ts).
//
//  O1  Al volver a la app: tras ≥ 45 s fuera se aplica (antes 10 min); menos es mirar y regresar.
//  O2  Con la app delante y quieta 3 min (sin toques ni voz) se aplica; con actividad reciente, no.
//  O3  Al terminar una llamada: se aplica si nadie tocó nada en 20 s; con la llamada viva, nunca.
//  O4  Nada se queda frenando para siempre: un borrador olvidado (> 10 min) y un `llamada`/`voz`
//      sin su cierre (> 5 min) dejan de frenar; lo vivo (comprobador `true`) sigue frenando.
//  O5  «Instala la APK nueva» solo en producción y con una huella de verdad distinta a la instalada.
//  O9  Recién abierta (`arranque`) no recarga a media entrada: con la app fuera (la pestaña de la wallet),
//      con algo escrito en «Entrar» ni con la entrada de la wallet / Genesis en curso; terminada, sí.
//  O10 (revisión 7.5, MENOR 3) Tampoco justo DESPUÉS de entrar (TRAS_ENTRAR_MS) ni durante la primera vez
//      (mobile/src/primeravez): no es momento para el `arranque`; se aplica en el próximo momento seguro.
const { ok, fin } = require('../chat/comun.cjs');

(async () => {
  const M = require('./paquete.cjs')();
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

  /* ── O8 (José, 5-oct): recién abierta, lo descargado se aplica ya; lo vivo sigue frenando ── */
  ok('O8: recién abierta (arranque), aplica aunque la acaben de tocar', B.decidirAplicar({ pendiente: true, momento: 'arranque', quietoMs: 0, motivos: [] }) === 'aplicar');
  ok('O8: recién abierta pero escribiendo (teclado), pospone', B.decidirAplicar({ pendiente: true, momento: 'arranque', quietoMs: 0, motivos: ['teclado'] }) === 'posponer');
  ok('O8: sin nada descargado, nada', B.decidirAplicar({ pendiente: false, momento: 'arranque', motivos: [] }) === 'nada');
  ok('O8: la ventana de «recién abierta» es corta (≤ 2 min)', B.VENTANA_ARRANQUE_MS > 0 && B.VENTANA_ARRANQUE_MS <= 120_000, String(B.VENTANA_ARRANQUE_MS));

  /* ── O9 (revisión del 5-oct): recién abierta pero entrando (login, wallet, Genesis) no se recarga ── */
  ok('O9: recién abierta con la app FUERA (la pestaña de la wallet delante), pospone', B.decidirAplicar({ pendiente: true, momento: 'arranque', quietoMs: 0, motivos: [], activa: false }) === 'posponer');
  ok('O9: …y con la app delante, aplica', B.decidirAplicar({ pendiente: true, momento: 'arranque', quietoMs: 0, motivos: [], activa: true }) === 'aplicar');
  ok('O9: escribiendo en la pantalla de entrar (aunque el teclado se haya cerrado), pospone', B.decidirAplicar({ pendiente: true, momento: 'arranque', quietoMs: 0, motivos: ['entrando'] }) === 'posponer');
  if (B.empezarTrabajo) {
    const soltar = B.empezarTrabajo('entrada-wallet');
    const soltar2 = B.empezarTrabajo('entrada-wallet');
    ok('O9: un trabajo en curso (empezarTrabajo) frena', B.motivosParaNoRecargar().includes('entrada-wallet'));
    soltar();
    soltar();
    ok('O9: …hasta que terminan todos (soltar dos veces el mismo no cuenta doble)', B.motivosParaNoRecargar().includes('entrada-wallet'));
    soltar2();
    ok('O9: …y al terminar ya no frena', !B.motivosParaNoRecargar().includes('entrada-wallet'), B.motivosParaNoRecargar().join());
  } else ok('O9: hay empezarTrabajo en lib/barreraOta', false);
  // La entrada con Genesis ID de verdad: mientras la wallet tiene el pedido (la app fuera), no se recarga.
  if (M.GENESIS && globalThis.__rn) {
    const rn = globalThis.__rn;
    const fetchAntes = globalThis.fetch;
    globalThis.fetch = async () => new Response('{}', { status: 200 });
    rn.openURL = async () => {};
    globalThis.__wb = async () => ({ type: 'dismiss' });
    const pG = M.GENESIS.entrarConGenesis();
    await new Promise((r) => setTimeout(r, 30));
    ok('O9: con la wallet abierta esperando su vuelta, la entrada frena la recarga', B.motivosParaNoRecargar().includes('entrada-wallet'), B.motivosParaNoRecargar().join());
    ok('O9: …también en el arranque', B.decidirAplicar({ pendiente: true, momento: 'arranque', quietoMs: 0 }) === 'posponer');
    rn.app.forEach((f) => f('background'));
    rn.app.forEach((f) => f('active'));
    await pG;
    ok('O9: terminada la entrada, ya no frena (se aplica en el próximo momento seguro)', !B.motivosParaNoRecargar().includes('entrada-wallet'), B.motivosParaNoRecargar().join());
    globalThis.fetch = fetchAntes;
  } else ok('O9: hay GENESIS en el paquete de pruebas', false);

  /* ── O10 (revisión 7.5, MENOR 3): ni justo después de entrar ni en la primera vez ───────────── */
  if (B.marcarEntradaLograda && B.frenarArranque && B.motivosContraArranque) {
    B._reiniciarBarreraOta();
    const ahora = Date.now();
    ok('O10: sin entrar recién, el arranque aplica', B.decidirAplicar({ pendiente: true, momento: 'arranque', quietoMs: 0, motivos: [] }) === 'aplicar');
    B.marcarEntradaLograda(ahora);
    ok('O10: recién entró (la pantalla de entrar se cerró): el arranque NO recarga', B.decidirAplicar({ pendiente: true, momento: 'arranque', quietoMs: 0, motivos: [] }) === 'posponer', B.motivosContraArranque().join());
    ok('O10: …y lo dice', B.motivosContraArranque(ahora + 1000).includes('recien-entrada'));
    ok('O10: pasado TRAS_ENTRAR_MS ya no frena', B.TRAS_ENTRAR_MS >= 30_000 && !B.motivosContraArranque(ahora + B.TRAS_ENTRAR_MS + 1).includes('recien-entrada'), String(B.TRAS_ENTRAR_MS));
    ok('O10: el próximo momento seguro (quieta 4 min) sí aplica', B.decidirAplicar({ pendiente: true, momento: 'quieto', quietoMs: 4 * MIN, motivos: [] }) === 'aplicar');
    ok('O10: …y el botón «Reiniciar» también', B.decidirAplicar({ pendiente: true, momento: 'boton', motivos: [] }) === 'aplicar');
    B._reiniciarBarreraOta();
    const soltarPv = B.frenarArranque('primera-vez');
    const soltarPv2 = B.frenarArranque('primera-vez');
    ok('O10: en la primera vez, el arranque NO recarga', B.decidirAplicar({ pendiente: true, momento: 'arranque', quietoMs: 0, motivos: [] }) === 'posponer');
    soltarPv();
    soltarPv();
    ok('O10: …mientras siga montada (soltar dos veces no cuenta doble)', B.motivosContraArranque().includes('primera-vez'));
    soltarPv2();
    ok('O10: terminada la primera vez, el arranque aplica', B.decidirAplicar({ pendiente: true, momento: 'arranque', quietoMs: 0, motivos: [] }) === 'aplicar', B.motivosContraArranque().join());
    // Lo usan de verdad: entrar marca la entrada lograda y la primera vez frena el arranque mientras está montada.
    const fs = require('fs');
    const path = require('path');
    const src = (r) => fs.readFileSync(path.join(__dirname, '../../src', r), 'utf8');
    ok('O10: entrarCon (app/sesion.ts) marca la entrada lograda al fijar a la persona', /fijarUsuario\(s\);\s*\n\s*marcarEntradaLograda\(\)/.test(src('app/sesion.ts')));
    ok('O10: la primera vez (primeravez/PrimeraVez.tsx) frena el arranque mientras está montada', /useEffect\(\(\) => frenarArranque\('primera-vez'\), \[\]\)/.test(src('primeravez/PrimeraVez.tsx')));
    B._reiniciarBarreraOta();
  } else ok('O10: hay marcarEntradaLograda, frenarArranque y motivosContraArranque en lib/barreraOta', false);

  /* ── O5: ¿APK nueva? ───────────────────────────────────────────────────────────────── */
  const h1 = 'a'.repeat(40);
  const h2 = 'b'.repeat(40);
  ok('O5: misma huella, no', B.necesitaApkNueva({ instalado: h1, publicado: h1 + '\n', canal: 'production' }) === false);
  ok('O5: otra huella en producción, sí', B.necesitaApkNueva({ instalado: h1, publicado: h2 + '\n', canal: 'production' }) === true);
  ok('O5: APK de una rama (canal pruebas), no', B.necesitaApkNueva({ instalado: h1, publicado: h2, canal: 'pruebas' }) === false);
  ok('O5: lo publicado no es una huella (una página de error), no', B.necesitaApkNueva({ instalado: h1, publicado: '<html>Not Found</html>', canal: 'production' }) === false);
  ok('O5: sin huella instalada (desarrollo), no', B.necesitaApkNueva({ instalado: null, publicado: h2, canal: 'production' }) === false);

  /* ── O6 (UI01, 3-oct): antes de recargar, cada frente guarda lo suyo (el borrador del chat) ── */
  if (!B.antesDeRecargar || !B.prepararRecarga) {
    ok('O6: hay antesDeRecargar y prepararRecarga en lib/barreraOta', false);
    return fin();
  }
  B._reiniciarBarreraOta();
  const guardados = [];
  const quitarA = B.antesDeRecargar('borrador-chat', async () => {
    await new Promise((r) => setTimeout(r, 5));
    guardados.push('borrador');
  });
  const quitarB = B.antesDeRecargar('roto', async () => {
    throw new Error('llavero lleno');
  });
  const quitarC = B.antesDeRecargar('lento', () => new Promise(() => {}));
  const t1 = Date.now();
  const r = await B.prepararRecarga(200);
  ok('O6: el borrador se guardó antes de recargar', guardados.includes('borrador'), JSON.stringify(guardados));
  ok('O6: uno que falla no tapa a los demás, y se dice cuál', r.fallaron.includes('roto') && !r.fallaron.includes('borrador-chat'), JSON.stringify(r));
  ok('O6: uno que no termina no cuelga la recarga (tope)', Date.now() - t1 < 1500 && r.fallaron.includes('lento'), `${Date.now() - t1} ms`);
  quitarA();
  quitarB();
  quitarC();
  ok('O6: sin nadie registrado, nada que esperar', (await B.prepararRecarga(50)).fallaron.length === 0);

  /* ── O7: la recarga de la OTA no se acusa como crash ─────────────────────────────────── */
  //  La OTA recarga con la app delante. La marca de «viva» se baja (y se espera) antes de recargar: el
  //  arranque siguiente no manda un `crash-previo` por una recarga que la app hizo a propósito.
  if (M.REPORTE && M.REPORTE.cierreIntencional) {
    const as = globalThis.__as;
    if (typeof globalThis.__DEV__ === 'undefined') globalThis.__DEV__ = false;
    as.m.set('ultron_migas_viva_v1', '1');
    await M.REPORTE.cierreIntencional('ota: recarga intencional');
    ok('O7: la recarga intencional baja la marca de «viva» antes de recargar', as.m.get('ultron_migas_viva_v1') === '0', String(as.m.get('ultron_migas_viva_v1')));
    const migas = JSON.parse(as.m.get('ultron_migas_v1') || as.m.get([...as.m.keys()].find((k) => /migas/.test(k) && !/viva/.test(k))) || '[]');
    ok('…y deja la miga de por qué', migas.some((x) => /recarga intencional/.test(x)), JSON.stringify(migas.slice(-2)));
  } else ok('O7: hay cierreIntencional en lib/reporte', false);

  fin();
})();
