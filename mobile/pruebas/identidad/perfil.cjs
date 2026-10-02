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

  fin();
})();
