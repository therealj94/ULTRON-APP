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

  fin();
})();
