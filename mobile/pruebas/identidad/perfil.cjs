// Identidad · el perfil en un teléfono compartido (auditoría A02 y A05).
//
//  R3  La lectura local del perfil de A llega tarde, cuando ya está B: antes pisaba el perfil de B.
//      También A → B → A: una operación vieja de A no se confunde con la sesión nueva de A.
//  R2  El servidor contesta el PUT con `durable: false` (sin S3, o S3 falló): antes el teléfono lo
//      daba por guardado y tiraba el cambio pendiente. Ahora sigue pendiente y se reintenta; solo con
//      `durable: true` se da por guardado. Un GET con `disponible: false` no es «no tiene perfil».
const { ok, fin } = require('../chat/comun.cjs');

const tic = () => new Promise((r) => setTimeout(r, 0));

(async () => {
  const M = require(process.env.IDENTIDAD || './out/identidad.cjs');
  const { PERFIL } = M;
  const as = globalThis.__as;
  console.log('identidad · el perfil\n');

  /* ── R2: durable:false no es «guardado» ────────────────────────────────────────────── */
  const puts = [];
  let durable = false;
  globalThis.__api = async (ruta, init) => {
    if (init?.method === 'PUT') {
      puts.push(JSON.parse(init.body));
      return { perfil: { apodo: JSON.parse(init.body).apodo || 'B', avatar: 'aura', tema: 'oscuro', idioma: 'es', encuesta: {}, completado: true, actualizado: Date.now() }, durable };
    }
    return { perfil: null, durable: false };
  };
  await PERFIL.cargarPerfil('b@prueba.local', { nombre: 'B' });
  PERFIL.guardarPerfil({ apodo: 'B cambiado' });
  await tic();
  await PERFIL.enviarPendiente();
  ok('R2: con durable:false NO se da por guardado en la cuenta', PERFIL.perfilSincronizado() === false);
  ok('…y el cambio sigue pendiente (no se tiró)', !!as.m.get('aura.perfil.pendiente.v1:b@prueba.local'), String(as.m.get('aura.perfil.pendiente.v1:b@prueba.local')));
  if (PERFIL.estadoPerfil) ok('el estado dice «recibido», no «durable»', PERFIL.estadoPerfil().estado === 'recibido' && PERFIL.estadoPerfil().pendiente === true, JSON.stringify(PERFIL.estadoPerfil()));
  durable = true;
  await PERFIL.enviarPendiente();
  ok('con durable:true se da por guardado y se vacía la cola', PERFIL.perfilSincronizado() === true && !as.m.get('aura.perfil.pendiente.v1:b@prueba.local'));
  ok('se reenvió el mismo cambio (idempotente)', puts.length >= 2 && puts.every((p) => p.apodo === 'B cambiado'), JSON.stringify(puts));
  PERFIL.soltarPerfil();

  // Un GET que no pudo leer lo guardado (S3 caído) no borra ni se toma por «no tiene».
  as.m.set('aura.perfil.v1:c@prueba.local', JSON.stringify({ apodo: 'Ceci', avatar: 'aura', tema: 'claro', idioma: 'es', encuesta: { vive: 'Tela' }, completado: true, actualizado: 5 }));
  const envios = [];
  globalThis.__api = async (_ruta, init) => {
    if (init?.method === 'PUT') envios.push(JSON.parse(init.body));
    return init?.method === 'PUT' ? { perfil: null, durable: false } : { perfil: null, disponible: false, durable: true };
  };
  const pc = await PERFIL.cargarPerfil('c@prueba.local', { nombre: 'C' });
  await tic();
  ok('GET disponible:false: se sigue con lo local, sin tomarlo por perfil vacío', pc.apodo === 'Ceci' && pc.encuesta.vive === 'Tela');
  ok('…y no se da por sincronizado', PERFIL.perfilSincronizado() === false);
  ok('…ni se reenvían «huecos» como si el servidor no tuviera nada', envios.length === 0, JSON.stringify(envios));
  PERFIL.soltarPerfil();

  /* ── R3: la lectura local de A llega tarde ─────────────────────────────────────────── */
  globalThis.__api = async () => ({ perfil: null, durable: true });
  as.m.set('aura.perfil.v1:a@prueba.local', JSON.stringify({ apodo: 'PERFIL_A', avatar: 'aura', tema: 'claro', idioma: 'es', encuesta: {}, completado: true, actualizado: 1 }));
  as.retener = (k) => k === 'aura.perfil.v1:a@prueba.local';
  const cargaA = PERFIL.cargarPerfil('a@prueba.local', { nombre: 'A' });
  await tic();
  as.retener = () => false;
  await PERFIL.cargarPerfil('b@prueba.local', { nombre: 'B' });
  const deB = PERFIL.perfilActual()?.apodo;
  as.soltar['aura.perfil.v1:a@prueba.local']();
  await cargaA;
  await tic();
  ok('R3: la lectura tardía de A NO reemplaza el perfil de B', PERFIL.perfilActual()?.apodo === deB && deB !== 'PERFIL_A', `${PERFIL.perfilActual()?.apodo} (B era ${deB})`);
  PERFIL.soltarPerfil();

  /* ── A → B → A: comparar el correo no basta ────────────────────────────────────────── */
  as.retener = (k) => k === 'aura.perfil.v1:a@prueba.local';
  const vieja = PERFIL.cargarPerfil('a@prueba.local', { nombre: 'A' });
  await tic();
  as.retener = () => false;
  const soltarVieja = as.soltar['aura.perfil.v1:a@prueba.local'];
  PERFIL.soltarPerfil();
  await PERFIL.cargarPerfil('b@prueba.local', { nombre: 'B' });
  PERFIL.soltarPerfil();
  as.m.set('aura.perfil.v1:a@prueba.local', JSON.stringify({ apodo: 'A de hoy', avatar: 'aura', tema: 'oscuro', idioma: 'es', encuesta: {}, completado: true, actualizado: 9 }));
  await PERFIL.cargarPerfil('a@prueba.local', { nombre: 'A' });
  // La lectura vieja devuelve lo que había al pedirla… cambiado a propósito para verla.
  as.m.set('aura.perfil.v1:a@prueba.local', JSON.stringify({ apodo: 'A de ayer', avatar: 'aura', tema: 'claro', idioma: 'es', encuesta: {}, completado: true, actualizado: 1 }));
  soltarVieja();
  await vieja;
  await tic();
  ok('A→B→A: la operación vieja de A no pisa la sesión nueva de A', PERFIL.perfilActual()?.apodo === 'A de hoy', PERFIL.perfilActual()?.apodo);
  PERFIL.soltarPerfil();

  /* ── la iniciativa de AURA (Ajustes → «Iniciativa de AURA»): viaja en el PUT como motorComputadora ─ */
  const base = PERFIL.normalizarPerfil({ apodo: 'J', avatar: 'aura', tema: 'oscuro', idioma: 'es', encuesta: {}, completado: true, actualizado: 1, iniciativa: 'baja' });
  ok('iniciativa: el perfil del servidor la trae', base?.iniciativa === 'baja', base?.iniciativa);
  ok('iniciativa: un valor que no existe se ignora', PERFIL.normalizarPerfil({ ...base, iniciativa: 'muchísima' })?.iniciativa === undefined);
  const alta = PERFIL.aplicarCambios(base, { iniciativa: 'alta' }, 2);
  ok('iniciativa: cambiarla se aplica', alta.iniciativa === 'alta', alta.iniciativa);
  ok('iniciativa: el PUT la manda', JSON.stringify(PERFIL.cuerpoPut(alta, { iniciativa: 'alta' })) === '{"iniciativa":"alta"}', JSON.stringify(PERFIL.cuerpoPut(alta, { iniciativa: 'alta' })));
  ok('iniciativa: un cambio de otra cosa no la manda', !('iniciativa' in PERFIL.cuerpoPut(alta, { tema: 'claro' })));
  ok('iniciativa: «apagada» también vale', PERFIL.aplicarCambios(base, { iniciativa: 'apagada' }, 3).iniciativa === 'apagada');

  /* ── PRIV01: borrar una respuesta espera su recibo durable ─────────────────────────── */
  //  Antes «Borrar todo» y «Borrar esta respuesta» mandaban el PUT sin esperar: la pantalla se cerraba
  //  aunque el servidor no lo hubiera guardado. `guardarPerfilConRecibo` dice true SOLO con durable:true.
  {
    let durableP = false;
    let caido = false;
    const putsP = [];
    let servidorP = { apodo: 'Dani', avatar: 'aura', tema: 'oscuro', idioma: 'es', encuesta: { vive: 'Tela', comida: 'Baleadas' }, completado: true, actualizado: 100 };
    globalThis.__api = async (_r, init) => {
      if (caido) throw Object.assign(new Error('sin red'), { status: 0 });
      if (init?.method === 'PUT') {
        const b = JSON.parse(init.body);
        putsP.push(b);
        if (b.encuesta) servidorP = { ...servidorP, encuesta: Object.fromEntries(Object.entries(b.encuesta).filter(([, v]) => v)), actualizado: servidorP.actualizado + 1 };
        return { perfil: servidorP, durable: durableP };
      }
      return { perfil: servidorP, durable: durableP, disponible: true };
    };
    if (!PERFIL.guardarPerfilConRecibo) {
      ok('PRIV01: hay guardarPerfilConRecibo en lib/perfil', false);
    } else {
      await PERFIL.cargarPerfil('d@prueba.local', { nombre: 'D' });
      caido = true;
      ok('PRIV01: sin red, borrar NO se confirma', (await PERFIL.guardarPerfilConRecibo({ encuesta: { vive: '' } })) === false);
      ok('…pero en este teléfono ya no está y queda pendiente para reenviar', !PERFIL.perfilActual().encuesta.vive && PERFIL.estadoPerfil().pendiente === true);
      caido = false;
      ok('PRIV01: con durable:false, tampoco se confirma', (await PERFIL.guardarPerfilConRecibo({ encuesta: { vive: '' } })) === false);
      durableP = true;
      ok('PRIV01: con durable:true, sí', (await PERFIL.guardarPerfilConRecibo({ encuesta: { vive: '' } })) === true, JSON.stringify(putsP.at(-1)));
      ok('…y el PUT mandó el campo vacío a propósito', putsP.at(-1)?.encuesta?.vive === '');
      // Mientras viaja un envío, otro cambio: el recibo del segundo espera al suyo (no se da por bueno el primero).
      const a = PERFIL.guardarPerfilConRecibo({ encuesta: { comida: '' } });
      const b = PERFIL.guardarPerfilConRecibo({ encuesta: { musica: '' } });
      ok('PRIV01: dos borrados seguidos, cada uno con su recibo', (await a) === true && (await b) === true && !PERFIL.estadoPerfil().pendiente);
      PERFIL.soltarPerfil();

      /* ── PRIV01: lo borrado en OTRO teléfono no resucita desde la caché de este ──────── */
      // Este teléfono vio el perfil en su versión 100 (con vive). El otro lo borró: el servidor (durable)
      // está en la 105 sin vive. Antes el hueco se tomaba por «el servidor lo perdió» y se reenviaba.
      as.m.set('aura.perfil.v1:e@prueba.local', JSON.stringify({ apodo: 'Eli', avatar: 'aura', tema: 'oscuro', idioma: 'es', encuesta: { vive: 'Tela', musica: 'Jazz' }, completado: true, actualizado: 100 }));
      as.m.set('aura.perfil.servidor.v1:e@prueba.local', '100');
      putsP.length = 0;
      servidorP = { apodo: 'Eli', avatar: 'aura', tema: 'oscuro', idioma: 'es', encuesta: { musica: 'Jazz' }, completado: true, actualizado: 105 };
      durableP = true;
      const pe = await PERFIL.cargarPerfil('e@prueba.local', { nombre: 'E' });
      await tic();
      await tic();
      ok('PRIV01: lo borrado en otro teléfono NO se reenvía desde la caché', !putsP.some((p) => p.encuesta?.vive), JSON.stringify(putsP));
      ok('…y aquí también desaparece', !pe.encuesta.vive && pe.encuesta.musica === 'Jazz', JSON.stringify(pe.encuesta));
      PERFIL.soltarPerfil();

      // Lo de siempre se conserva: un servidor que PERDIÓ lo guardado (sin almacén durable) sí recibe los huecos.
      as.m.set('aura.perfil.v1:f@prueba.local', JSON.stringify({ apodo: 'Fer', avatar: 'aura', tema: 'oscuro', idioma: 'es', encuesta: { vive: 'Tela' }, completado: true, actualizado: 100 }));
      as.m.set('aura.perfil.servidor.v1:f@prueba.local', '100');
      putsP.length = 0;
      servidorP = { apodo: 'Fer', avatar: 'aura', tema: 'oscuro', idioma: 'es', encuesta: {}, completado: false, actualizado: 200 };
      durableP = false;
      await PERFIL.cargarPerfil('f@prueba.local', { nombre: 'F' });
      await tic();
      await tic();
      ok('servidor sin almacén durable que volvió vacío: lo de este teléfono se le reenvía (como antes)', putsP.some((p) => p.encuesta?.vive === 'Tela'), JSON.stringify(putsP));
      PERFIL.soltarPerfil();
    }
  }

  /* ── AUR11: las marcas de supresión del servidor prevalecen sobre la copia de este teléfono ── */
  //  El servidor marca cada respuesta borrada con la hora de su marca (`supresiones`) y rechaza lo que llega
  //  sin hora o con una hora de antes (`suprimidos`). El teléfono: no reenvía lo que el servidor borró, suelta
  //  su copia vieja (de la cola y de la caché) y manda cada cambio nuevo con su hora (`hechoEn`).
  {
    const MARCA = 5_000;
    const base = { apodo: 'Gabi', avatar: 'aura', tema: 'oscuro', idioma: 'es', completado: true };
    let servidor = { ...base, encuesta: { musica: 'Jazz' }, actualizado: 200 };
    let caido = false;
    const puts = [];
    globalThis.__api = async (_r, init) => {
      if (caido) throw Object.assign(new Error('sin red'), { status: 0 });
      if (init?.method === 'PUT') {
        const b = JSON.parse(init.body);
        puts.push(b);
        // Como el servidor (lib/olvido.ts): «vive» está marcado; sin hora posterior a la marca, no entra.
        const suprimidos = [];
        const enc = { ...servidor.encuesta };
        for (const [k, v] of Object.entries(b.encuesta || {})) {
          if (k === 'vive' && v && v !== enc.vive && !((b.hechoEn || {})['encuesta.vive'] > MARCA)) {
            suprimidos.push('encuesta.vive');
            continue;
          }
          if (v) enc[k] = v;
          else delete enc[k];
        }
        servidor = { ...servidor, encuesta: enc, actualizado: servidor.actualizado + 1 };
        return { perfil: servidor, durable: true, suprimidos, supresiones: { 'encuesta.vive': MARCA } };
      }
      return { perfil: servidor, durable: true, disponible: true, supresiones: { 'encuesta.vive': MARCA } };
    };

    // G: offline, este teléfono tenía en la cola un cambio de «vive» hecho ANTES del borrado en otro.
    as.m.set('aura.perfil.v1:g@prueba.local', JSON.stringify({ ...base, encuesta: { vive: 'Tela', musica: 'Jazz' }, actualizado: 100 }));
    as.m.set('aura.perfil.pendiente.v1:g@prueba.local', JSON.stringify({ encuesta: { vive: 'Tela' } }));
    as.m.set('aura.perfil.pendiente.en.v1:g@prueba.local', JSON.stringify({ 'encuesta.vive': 1_000 }));
    await PERFIL.cargarPerfil('g@prueba.local', { nombre: 'G' });
    await tic();
    await tic();
    ok('AUR11: la cola vieja (cambio de antes del borrado) no resucita «vive» en el servidor', !servidor.encuesta.vive && !puts.some((p) => p.encuesta?.vive === 'Tela' && (p.hechoEn || {})['encuesta.vive'] > MARCA), JSON.stringify(puts));
    ok('…ni se queda en este teléfono', !PERFIL.perfilActual().encuesta.vive, JSON.stringify(PERFIL.perfilActual().encuesta));
    ok('…y no queda pendiente para siempre', !PERFIL.estadoPerfil().pendiente, String(as.m.get('aura.perfil.pendiente.v1:g@prueba.local')));
    // Un cambio NUEVO, después del borrado: sale con su hora y vale.
    PERFIL.guardarPerfil({ encuesta: { vive: 'Tocoa' } });
    await tic();
    await PERFIL.enviarPendiente();
    const ult = puts.at(-1);
    ok('AUR11: un cambio nuevo sale con su hora (hechoEn) y el servidor lo acepta', ult?.encuesta?.vive === 'Tocoa' && ult.hechoEn?.['encuesta.vive'] > MARCA && servidor.encuesta.vive === 'Tocoa', JSON.stringify(ult));
    ok('…solo con la hora de lo que cambió (no de toda la encuesta)', Object.keys(ult?.hechoEn || {}).join() === 'encuesta.vive', JSON.stringify(ult?.hechoEn));
    ok('…y aquí se queda', PERFIL.perfilActual().encuesta.vive === 'Tocoa');
    PERFIL.soltarPerfil();

    // H: instalación de antes (nunca vio el servidor: sin «visto») y caché con «vive»: antes se tomaba por un
    // hueco del servidor y se reenviaba. Con la marca, no.
    servidor = { ...base, encuesta: { musica: 'Jazz' }, actualizado: 300 };
    puts.length = 0;
    as.m.set('aura.perfil.v1:h@prueba.local', JSON.stringify({ ...base, encuesta: { vive: 'Tela', musica: 'Jazz' }, actualizado: 100 }));
    const ph = await PERFIL.cargarPerfil('h@prueba.local', { nombre: 'H' });
    await tic();
    await tic();
    ok('AUR11: una instalación vieja no reenvía como «hueco» lo que el servidor borró', !puts.some((p) => p.encuesta?.vive), JSON.stringify(puts));
    ok('…y lo suelta aquí', !ph.encuesta.vive && ph.encuesta.musica === 'Jazz', JSON.stringify(ph.encuesta));
    PERFIL.soltarPerfil();

    // I: sin red al abrir (sin GET), con un cambio pendiente de una versión vieja de la app (sin hora). Al volver
    // la red, el servidor lo rechaza (`suprimidos`): se suelta, no se reintenta para siempre.
    servidor = { ...base, encuesta: { musica: 'Jazz' }, actualizado: 400 };
    puts.length = 0;
    as.m.set('aura.perfil.v1:i@prueba.local', JSON.stringify({ ...base, encuesta: { vive: 'Tela', musica: 'Jazz' }, actualizado: 100 }));
    as.m.set('aura.perfil.pendiente.v1:i@prueba.local', JSON.stringify({ encuesta: { vive: 'Tela' } }));
    caido = true;
    await PERFIL.cargarPerfil('i@prueba.local', { nombre: 'I' });
    caido = false;
    await PERFIL.enviarPendiente();
    await tic();
    ok('AUR11: un PUT rechazado por la marca suelta la copia vieja', !PERFIL.perfilActual().encuesta.vive && !servidor.encuesta.vive, JSON.stringify(PERFIL.perfilActual().encuesta));
    ok('…y la cola queda vacía (sin reintentos eternos)', !PERFIL.estadoPerfil().pendiente);
    PERFIL.soltarPerfil();
  }

  /* ── El reloj del teléfono va atrasado respecto al del servidor (Codex, PR 140) ── */
  //  Borró «vive» y lo vuelve a escribir: la marca del servidor queda DESPUÉS de la hora del teléfono. Como este
  //  teléfono ya vio la marca, su cambio nuevo va después de ella y vale (no se toma por una copia vieja).
  {
    const MARCA = Date.now() + 10 * 60_000;
    const base = { apodo: 'Jo', avatar: 'aura', tema: 'oscuro', idioma: 'es', completado: true };
    let servidor = { ...base, encuesta: { musica: 'Jazz' }, actualizado: 500 };
    const puts = [];
    globalThis.__api = async (_r, init) => {
      if (init?.method === 'PUT') {
        const b = JSON.parse(init.body);
        puts.push(b);
        const suprimidos = [];
        const enc = { ...servidor.encuesta };
        for (const [k, v] of Object.entries(b.encuesta || {})) {
          if (k === 'vive' && v && v !== enc.vive && !((b.hechoEn || {})['encuesta.vive'] > MARCA)) {
            suprimidos.push('encuesta.vive');
            continue;
          }
          if (v) enc[k] = v;
          else delete enc[k];
        }
        servidor = { ...servidor, encuesta: enc, actualizado: servidor.actualizado + 1 };
        return { perfil: servidor, durable: true, suprimidos, supresiones: { 'encuesta.vive': MARCA } };
      }
      return { perfil: servidor, durable: true, disponible: true, supresiones: { 'encuesta.vive': MARCA } };
    };
    await PERFIL.cargarPerfil('j@prueba.local', { nombre: 'J' });
    await tic();
    PERFIL.guardarPerfil({ encuesta: { vive: 'Tocoa' } });
    await tic();
    await PERFIL.enviarPendiente();
    const ult = puts.at(-1);
    ok('reloj atrasado: el cambio de después de ver la marca sale con hora posterior a ella', ult?.hechoEn?.['encuesta.vive'] > MARCA, JSON.stringify(ult));
    ok('…el servidor lo acepta', servidor.encuesta.vive === 'Tocoa', JSON.stringify(servidor.encuesta));
    ok('…y aquí no se suelta', PERFIL.perfilActual().encuesta.vive === 'Tocoa', JSON.stringify(PERFIL.perfilActual().encuesta));
    PERFIL.soltarPerfil();
  }

  fin();
})();
