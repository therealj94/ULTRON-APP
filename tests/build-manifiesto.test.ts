/**
 * AUR16 / G0 (documento maestro del 3-oct): el manifiesto dice qué build corre sin soltar nada secreto.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { CONTRATOS, manifiestoBuild } from '../lib/build';

test('manifiesto: commit completo, servicio, contratos y banderas; ningún secreto', () => {
  const env = { RENDER_GIT_COMMIT: 'f85ef2456e0e1be7a11043f2fb65c17a82bfce19', RENDER_SERVICE_NAME: 'aura-fp', AURA_SW: '0', WEB_PUSH_VAPID_PRIVADA: 'no-debe-salir', ELECTRUM_CLAVE: 'tampoco' } as NodeJS.ProcessEnv;
  const m = manifiestoBuild({ plataforma: 'aura', banderas: { computadora: true } }, env);
  assert.equal(m.commit, 'f85ef2456e0e1be7a11043f2fb65c17a82bfce19');
  assert.equal(m.servicio, 'aura-fp');
  assert.equal(m.plataforma, 'aura');
  assert.deepEqual(m.contratos, CONTRATOS);
  assert.equal(m.banderas.serviceWorker, false);
  assert.equal(m.banderas.computadora, true);
  assert.equal(m.durable.tipo, 'memoria', 'bajo las pruebas, lo durable es memoria');
  const todo = JSON.stringify(m);
  assert.ok(!todo.includes('no-debe-salir') && !todo.includes('tampoco'), 'nada de llaves');
  assert.equal(manifiestoBuild({ plataforma: 'electrum' }, {} as NodeJS.ProcessEnv).commit, null);
});

/* ------------------------------------------------------------------ P5: el contrato de entrega */

test('P5: el manifiesto de entrega acredita servidor, web, nodo (o «desconocido»), validador mínimo, esquema y banderas; nada secreto', async () => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const B: any = await import('../lib/build');
  const { VALIDADOR_MIN } = await import('../lib/entregables');
  assert.equal(typeof B.manifiestoEntrega, 'function', 'lib/build.ts exporta manifiestoEntrega');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aura-build-'));
  const archivoWeb = path.join(dir, 'aura-build.json');
  fs.writeFileSync(archivoWeb, JSON.stringify({ sha: '0123456789abcdef0123456789abcdef01234567', hora: '2026-10-04T20:00:00.000Z' }));
  const env = { RENDER_GIT_COMMIT: 'f85ef2456e0e1be7a11043f2fb65c17a82bfce19', RENDER_SERVICE_NAME: 'aura-fp', COMPUTADORA_CLAVE: 'clave-del-nodo-no-sale', COMPUTADORA_URL: 'http://nodo-privado.interno:8080' } as NodeJS.ProcessEnv;
  const nodoVivo = async () => ({ configurada: true, ok: true, motores: ['holo'], ocupada: false, capacidades: ['pausar', 'control', 'entrada', 'seguro'], hash: 'a1b2c3d4e5f60718', validador: 12 });
  const m = await B.manifiestoEntrega({ plataforma: 'aura', banderas: { computadora: true } }, { env, nodo: nodoVivo, archivoWeb });
  assert.equal(m.servidor.sha, 'f85ef2456e0e1be7a11043f2fb65c17a82bfce19');
  assert.ok(Date.parse(m.servidor.hora) > 0, 'hora de arranque del servidor');
  assert.equal(m.web.sha, '0123456789abcdef0123456789abcdef01234567');
  assert.equal(m.web.hora, '2026-10-04T20:00:00.000Z');
  assert.equal(m.nodo.estado, 'alcanzable');
  assert.equal(m.nodo.hash, 'a1b2c3d4e5f60718');
  assert.equal(m.nodo.validador, 12);
  assert.deepEqual(m.nodo.capacidades, ['pausar', 'control', 'entrada', 'seguro']);
  assert.equal(m.validadorMinimo, VALIDADOR_MIN);
  assert.equal(m.nodo.validadorSuficiente, 12 >= VALIDADOR_MIN);
  assert.ok(m.esquema && typeof m.esquema === 'object' && Number.isInteger(m.esquema.tareas) && Number.isInteger(m.esquema.misionesComputadora), 'versiones de esquema');
  assert.equal(m.banderas.computadora, true);
  assert.deepEqual(m.contratos, CONTRATOS, 'compatible con el manifiesto de antes');
  assert.equal(m.commit, 'f85ef2456e0e1be7a11043f2fb65c17a82bfce19', 'los campos de antes siguen');
  const todo = JSON.stringify(m);
  assert.ok(!todo.includes('clave-del-nodo-no-sale') && !todo.includes('nodo-privado.interno'), 'ni la llave ni la dirección del nodo');

  // Nodo que no contesta, nodo viejo sin hash, y sin build web: «desconocido», nunca inventado.
  const caido = await B.manifiestoEntrega(
    { plataforma: 'aura' },
    { env: {} as NodeJS.ProcessEnv, nodo: async () => ({ configurada: true, ok: false, motores: [], ocupada: false, capacidades: [], detalle: 'ECONNREFUSED http://nodo-privado.interno' }), archivoWeb: path.join(dir, 'no-existe.json') }
  );
  assert.equal(caido.nodo.estado, 'desconocido');
  assert.equal(caido.nodo.hash, 'desconocido');
  assert.equal(caido.nodo.validador, 'desconocido');
  assert.equal(caido.nodo.validadorSuficiente, null);
  assert.equal(caido.web.sha, 'desconocido');
  assert.equal(caido.servidor.sha, 'desconocido');
  assert.ok(!JSON.stringify(caido).includes('nodo-privado'), 'el detalle del error no filtra la dirección');
  const viejo = await B.manifiestoEntrega({ plataforma: 'aura' }, { env, nodo: async () => ({ configurada: true, ok: true, motores: ['holo'], ocupada: false, capacidades: [] }), archivoWeb });
  assert.equal(viejo.nodo.estado, 'alcanzable');
  assert.equal(viejo.nodo.hash, 'desconocido');
  assert.equal(viejo.nodo.validadorSuficiente, false, 'un nodo que no dice su validador no cumple el mínimo');
  const lanza = await B.manifiestoEntrega(
    { plataforma: 'aura' },
    {
      env,
      nodo: async () => {
        throw new Error('timeout');
      },
      archivoWeb,
    }
  );
  assert.equal(lanza.nodo.estado, 'desconocido');
});

test('P5: la salud del almacén durable se comprueba leyendo y escribiendo (un /api/health 200 no lo prueba)', async () => {
  const B: any = await import('../lib/build');
  const { almacenEnMemoria } = await import('../lib/durable');
  assert.equal(typeof B.sondearAlmacen, 'function', 'lib/build.ts exporta sondearAlmacen');
  const sano = await B.sondearAlmacen(almacenEnMemoria(), { forzar: true });
  assert.equal(sano.ok, true);
  assert.equal(sano.lectura, true);
  assert.equal(sano.escritura, true);
  assert.equal(sano.tipo, 'memoria');
  const roto = { tipo: 's3', multiReplica: true, leer: async () => ({ ok: false, detalle: 'S3 503' }), crear: async () => ({ ok: false, conflicto: false, detalle: 'S3 503' }), cas: async () => ({ ok: false, conflicto: false, detalle: 'S3 503' }) };
  const malo = await B.sondearAlmacen(roto, { forzar: true });
  assert.equal(malo.ok, false);
  assert.equal(malo.escritura, false);
  const soloLee = { ...almacenEnMemoria(), crear: async () => ({ ok: false, conflicto: false, detalle: 'solo lectura' }), cas: async () => ({ ok: false, conflicto: false, detalle: 'solo lectura' }) };
  const medio = await B.sondearAlmacen(soloLee, { forzar: true });
  assert.equal(medio.ok, false, 'leer sin poder escribir no es sano');
});

test('revisión 13 (A7): la sonda de listado lista UNA clave en el espacio de las tareas (no en `salud/`), sin enseñar lo listado', async () => {
  const B: any = await import('../lib/build');
  const { almacenEnMemoria } = await import('../lib/durable');
  const { ESPACIO_TAREAS } = await import('../lib/tareas-durables');
  /** Un permiso de listar acotado por prefijo (como `s3:prefix` en la política del bucket). */
  const acotado = (permitido: (prefijo: string) => boolean) => {
    const m = almacenEnMemoria();
    const pedidos: { prefijo: string; max?: number }[] = [];
    const listar = m.listar!.bind(m);
    // Un objeto de tarea de alguien en el almacén: la salud nunca debe contarlo ni enseñarlo.
    m.objetos.set(`${ESPACIO_TAREAS}/${'a'.repeat(40)}/tk_secreta`, JSON.stringify({ v: 1, titulo: 'secreto' }));
    return {
      pedidos,
      a: Object.assign(m, {
        listar: async (prefijo: string, o?: { desde?: string | null; max?: number }) => {
          pedidos.push({ prefijo, max: o?.max });
          return permitido(prefijo) ? listar(prefijo, o) : { ok: false as const, detalle: 'S3 403: AccessDenied' };
        },
      }),
    };
  };
  // Solo se deja listar `salud/`: antes daba «ok» aunque el inventario de tareas no pudiera listar.
  const soloSalud = acotado((p) => p === 'salud' || p.startsWith('salud/'));
  const r1 = await B.sondearAlmacen(soloSalud.a, { forzar: true });
  assert.equal(r1.ok, true, 'leer y escribir siguen decidiendo la salud');
  assert.equal(r1.listado, 'denegado', 'el inventario no podría listar: no es «ok»');
  // Solo se deja listar `tareas/*` (lo que el inventario necesita): «ok».
  const soloTareas = acotado((p) => p.startsWith(`${ESPACIO_TAREAS}/`));
  const r2 = await B.sondearAlmacen(soloTareas.a, { forzar: true });
  assert.equal(r2.listado, 'ok');
  assert.equal(soloTareas.pedidos.length, 1);
  const { prefijo, max } = soloTareas.pedidos[0];
  assert.equal(max, 1, 'una sola clave');
  assert.match(prefijo, new RegExp(`^${ESPACIO_TAREAS}/[0-9a-f]{40}$`), 'la misma forma que la carpeta de un dueño');
  assert.equal(prefijo, B.prefijoSondaListado());
  assert.doesNotMatch(JSON.stringify(r2), /tk_|secreto|tareas\//, 'lo listado no sale en la salud');
  assert.deepEqual(['ok', 'denegado', 'sin-fuente'].includes(r2.listado), true);
});

test('recepción (5-oct): el build pone su SHA en una meta del HTML (no en el JS) y el mismo en aura-build.json', async () => {
  const { conMetaBuild, infoBuildWeb } = await import('../scripts/pwa/vite-build-info');
  const SHA = '0123456789abcdef0123456789abcdef01234567';
  const html = '<!doctype html>\n<html lang="es">\n  <head>\n    <meta charset="UTF-8" />\n  </head>\n  <body></body>\n</html>';
  const con = conMetaBuild(html, SHA);
  assert.match(con, /<head>\n\s*<meta name="aura-build" content="0123456789abcdef0123456789abcdef01234567">/);
  assert.equal(conMetaBuild(con, SHA), con, 'una sola vez');
  assert.equal(conMetaBuild(html, 'desconocido'), html, 'sin SHA de verdad no se inventa una meta');
  assert.equal(conMetaBuild(html, 'abc" onload="x'), html, 'nada que no sea hex entra en el HTML');
  // El plugin usa UNA revisión para las dos cosas.
  const p: any = infoBuildWeb();
  const html2 = p.transformIndexHtml(html);
  const emitidos: any[] = [];
  p.generateBundle.call({ emitFile: (f: any) => emitidos.push(f) });
  const json = JSON.parse(emitidos[0].source);
  if (json.sha === 'desconocido') assert.equal(html2, html);
  else assert.ok(html2.includes(`content="${json.sha}"`), 'la meta y aura-build.json dicen el mismo SHA');
});
