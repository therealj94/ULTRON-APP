/**
 * LA CARTERA DE VETA WALLET Y PAGAR POR PULSE2CHAT (mobile/src/cartera/, lib/cartera.ts, docs/CARTERA.md).
 *
 * Lo puro, sin teléfono ni red de verdad: la cantidad y la dirección, el enlace a la wallet (el mismo de AURA
 * para Windows), la lectura de saldos contra un RPC falso (lo que no se pudo leer NO es cero), la búsqueda
 * del envío en los bloques, la comprobación del comprobante, el vigía del pago (con una cadena falsa), el
 * perfil con la cartera, la herramienta `cartera` del harness y las manos `cartera` y `pagar`.
 */
import './datos-prueba'; // la junta inventada de las pruebas (lo real vive en Render)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  aWei,
  buscarEnvio,
  cantidadDeHex,
  comprobarTx,
  datosTransfer,
  decirSaldos,
  direccionDeFicha,
  enlaceApp,
  enlaceWeb,
  esDireccion,
  leerEnlacePagar,
  montoValido,
  precio,
  simbolo,
  TOKENS,
  VUELTA_PAGO,
  armarLote,
} from '../mobile/src/cartera/logica';
import { _olvidarCacheCartera, buscarEnvioEnRed, leerSaldos, verificarComprobante, type Pedidor } from '../mobile/src/cartera/red';
import { VigiaPago, TOPE_VIGIA_MS, type Pendiente } from '../mobile/src/cartera/vigia';
import { extraerPedidoHerramienta, instruccionHarness, resolverPedido } from '../lib/harness';
import { validarMano, reglasManos, MANOS } from '../lib/manos-app';
import { prepararAcciones, validarAccion } from '../lib/acciones-app';

const ANA = '0x6Facc8Df79cEDc6C5065442ce27e915Aa3a26B9B';
const YO = '0x1111111111111111111111111111111111111111';
const AUKA = TOKENS.find((t) => t.simbolo === 'AUKA')!.contrato!;
const WEI = BigInt('1000000000000000000');
const hex = (n: bigint) => '0x' + n.toString(16);

/* ── la cantidad, la dirección y la moneda ────────────────────────────────────────────────── */

test('montoValido: lo escrito o dicho → texto canónico exacto, nunca un flotante', () => {
  const casos: Array<[string, string | null]> = [
    ['5', '5'],
    [' 3 ', '3'],
    ['2,5', '2.5'],
    ['2.50', '2.5'],
    ['0,5', '0.5'],
    ['007', '7'],
    ['1,000', '1000'],
    ['1,000.50', '1000.5'],
    ['12,345,678', '12345678'],
    ['0.000000000000000001', '0.000000000000000001'],
    ['0.0000000000000000001', null], // 19 decimales: no cabe en la cadena
    ['0', null],
    ['0.00', null],
    ['-1', null],
    ['abc', null],
    ['1.2.3', null],
    ['2,5,3', null],
    ['', null],
    ['1e5', null],
  ];
  for (const [entra, sale] of casos) assert.equal(montoValido(entra), sale, `«${entra}»`);
  assert.equal(aWei('2.5'), BigInt('2500000000000000000'));
  assert.equal(aWei('1,000'), BigInt(1000) * WEI);
  assert.equal(aWei('0.000000000000000001'), BigInt(1));
  assert.throws(() => aWei('0'));
});

test('la dirección sale de la ficha (addr), y solo si es una dirección de verdad', () => {
  assert.ok(esDireccion(ANA));
  assert.ok(!esDireccion('0x123'));
  assert.ok(!esDireccion(ANA + '0'));
  assert.equal(direccionDeFicha({ addr: ANA, nombre: 'Ana' }), ANA);
  assert.equal(direccionDeFicha({ direccion: ` ${ANA} ` }), ANA);
  assert.equal(direccionDeFicha({ addr: '0xnoesdireccion' }), null);
  assert.equal(direccionDeFicha(null), null);
  assert.equal(simbolo('origen'), 'ORIGEN');
  assert.equal(simbolo('Origenes'), 'ORIGEN');
  assert.equal(simbolo('auka'), 'AUKA');
  assert.equal(simbolo('BTC'), null);
});

/* ── el enlace a Veta Wallet ──────────────────────────────────────────────────────────────── */

test('el enlace de la web es idéntico al de AURA para Windows, y el de la app se lee igual', () => {
  // El mismo caso que windows/tests/Program.cs («enlace pagar»).
  assert.equal(enlaceWeb({ direccion: ANA, monto: '2.5', simbolo: 'origen' }), `https://app.vetawallet.com/#pagar?a=${ANA}&m=2.5&s=ORIGEN`);
  const app = enlaceApp({ direccion: ANA, monto: '2,5', simbolo: 'ORIGEN' });
  assert.equal(app, `vetawallet://pagar?a=${ANA}&m=2.5&s=ORIGEN&vuelta=ultronfp%3A%2F%2Fpago`);
  assert.deepEqual(leerEnlacePagar(app), { direccion: ANA, monto: '2.5', simbolo: 'ORIGEN', vuelta: VUELTA_PAGO });
  assert.deepEqual(leerEnlacePagar(enlaceWeb({ direccion: ANA, monto: '10', simbolo: 'AUKA' })), { direccion: ANA, monto: '10', simbolo: 'AUKA', vuelta: null });
  // La vuelta solo puede ser la de AU-RA: una ajena se descarta (el envío se lee igual).
  assert.equal(leerEnlacePagar(`vetawallet://pagar?a=${ANA}&m=1&s=ORIGEN&vuelta=https%3A%2F%2Fmalo.com`)?.vuelta, null);
  // Lo que no cuadra no es un envío.
  assert.equal(leerEnlacePagar(`vetawallet://pagar?a=0x12&m=1&s=ORIGEN`), null);
  assert.equal(leerEnlacePagar(`vetawallet://pagar?a=${ANA}&m=0&s=ORIGEN`), null);
  assert.equal(leerEnlacePagar(`vetawallet://pagar?a=${ANA}&m=1&s=BTC`), null);
  assert.equal(leerEnlacePagar(`vetawallet://pagarlo?a=${ANA}&m=1&s=ORIGEN`), null);
  assert.equal(leerEnlacePagar(`vetawallet://pagar?a=${ANA}&m=%E0%A4%A&s=ORIGEN`), null);
  assert.throws(() => enlaceApp({ direccion: 'escrita a mano', monto: '1', simbolo: 'ORIGEN' }), /dirección/);
  assert.throws(() => enlaceApp({ direccion: ANA, monto: '0', simbolo: 'ORIGEN' }), /cantidad/);
  assert.throws(() => enlaceWeb({ direccion: ANA, monto: '1', simbolo: 'XYZ' }), /moneda/);
});

/* ── los saldos, contra un RPC falso ──────────────────────────────────────────────────────── */

type Llamada = { method: string; params: any[]; id: number };

function rpcFalso(responder: (c: Llamada) => unknown, precios: unknown = { 'pax-gold': { usd: 4146.44 }, 'kinesis-silver': { usd: 60.7 } }) {
  const vistos = { rpc: 0, precios: 0 };
  const pedir: Pedidor = async (url, init) => {
    if (url.includes('coingecko')) {
      vistos.precios++;
      return { ok: true, status: 200, json: async () => precios };
    }
    vistos.rpc++;
    const cuerpo = JSON.parse(String(init?.body || 'null'));
    const una = (c: Llamada) => {
      const r = responder(c);
      return r instanceof Error ? { jsonrpc: '2.0', id: c.id, error: { code: -32000, message: r.message } } : { jsonrpc: '2.0', id: c.id, result: r };
    };
    return { ok: true, status: 200, json: async () => (Array.isArray(cuerpo) ? cuerpo.map(una) : una(cuerpo)) };
  };
  return { pedir, vistos };
}

test('leer saldos: nativo + tokens en un lote; lo que vino con error NO es cero; precios como Windows', async () => {
  _olvidarCacheCartera();
  assert.equal(armarLote(YO).length, TOKENS.length);
  const { pedir, vistos } = rpcFalso((c) => {
    if (c.method === 'eth_getBalance') return hex((WEI * BigInt(3)) / BigInt(2)); // 1.5 ORIGEN
    if (c.method === 'eth_call' && c.params[0].to === AUKA) {
      assert.equal(c.params[0].data, '0x70a08231' + YO.slice(2).padStart(64, '0'));
      return hex(WEI * BigInt(2)); // 2 AUKA
    }
    if (c.method === 'eth_call' && c.params[0].to === TOKENS.find((t) => t.simbolo === 'ONDK')!.contrato) return new Error('execution reverted');
    return '0x0';
  });
  const c = await leerSaldos(YO, { pedir, ahora: 1_000_000 });
  const de = (s: string) => c.saldos.find((x) => x.simbolo === s)!;
  assert.equal(de('ORIGEN').cantidad, 1.5);
  assert.ok(Math.abs(de('ORIGEN').precio! - 4146.44 / 31.1035 / 55) < 1e-9);
  assert.equal(de('AUKA').cantidad, 2);
  assert.equal(de('AUKA').usd, 8292.88);
  assert.equal(de('ONDK').cantidad, null, 'una lectura con error es «no se pudo leer», no cero');
  assert.equal(de('HARV').cantidad, 0);
  assert.equal(c.total, Math.round((de('ORIGEN').usd! + 8292.88) * 100) / 100);
  assert.match(decirSaldos(c.saldos), /^Tienes unos .* dólares: 2 AUKA, 1[.,]5 ORIGEN\. \(No pude leer ONDK\.\)$/);
  assert.match(decirSaldos(c.saldos, 'origen'), /^Tienes 1[.,]5 ORIGEN \(unos .* dólares\)\.$/);
  assert.match(decirSaldos(c.saldos, 'ondk'), /no pude leer tu saldo de ONDK/);
  assert.match(decirSaldos(c.saldos, 'btc'), /No conozco el token btc/);
  assert.match(decirSaldos(c.saldos, null, 'en'), /^You have about .* dollars: 2 AUKA, 1\.5 ORIGEN\./);
  // 30 s de caché; `forzar` vuelve a la cadena. Los precios, 5 min.
  await leerSaldos(YO, { pedir, ahora: 1_010_000 });
  assert.equal(vistos.rpc, 1);
  await leerSaldos(YO, { pedir, ahora: 1_020_000, forzar: true });
  assert.equal(vistos.rpc, 2);
  assert.equal(vistos.precios, 1);
  // Sin precio no se inventa: «sin precio» y sin dólares.
  _olvidarCacheCartera();
  const sinPrecio = rpcFalso(() => hex(WEI), {});
  const c2 = await leerSaldos(YO, { pedir: sinPrecio.pedir });
  assert.equal(c2.saldos[0].precio, null);
  assert.equal(c2.saldos[0].usd, null);
  assert.equal(c2.conPrecio, false);
  assert.equal(precio('AGRO', null, null), 13.13);
  // La red sin contestar es un error, no una cartera vacía.
  _olvidarCacheCartera();
  const caida: Pedidor = async () => ({ ok: false, status: 502, json: async () => ({}) });
  await assert.rejects(leerSaldos(YO, { pedir: caida }), /no contestó \(502\)/);
  const todoMal = rpcFalso(() => new Error('nodo caído'));
  await assert.rejects(leerSaldos(YO, { pedir: todoMal.pedir }), /no devolvió tus saldos/);
  assert.equal(cantidadDeHex('0x'), 0);
  assert.equal(cantidadDeHex('nada'), null);
});

/* ── el envío en la cadena ────────────────────────────────────────────────────────────────── */

const H1 = '0x' + 'a'.repeat(64);
const H2 = '0x' + 'b'.repeat(64);
const nativo = (o: Partial<Record<string, string>> = {}) => ({ hash: H1, from: YO.toLowerCase(), to: ANA.toLowerCase(), value: hex(WEI * BigInt(5)), input: '0x', ...o });
const token = (o: Partial<Record<string, string>> = {}) => ({ hash: H2, from: YO, to: AUKA, value: '0x0', input: datosTransfer(ANA, aWei('2.5')), ...o });

test('buscarEnvio: solo ESE envío (de mí, a su dirección, esa cantidad exacta, esa moneda)', () => {
  const bloques = [{ id: 10, result: { transactions: [nativo({ value: hex(WEI * BigInt(4)) }), nativo()] } }, { id: 11, result: null }];
  assert.equal(buscarEnvio(bloques, { desde: YO, para: ANA, simbolo: 'ORIGEN', monto: '5' }), H1);
  assert.equal(buscarEnvio(bloques, { desde: YO, para: ANA, simbolo: 'ORIGEN', monto: '5.1' }), null);
  assert.equal(buscarEnvio(bloques, { desde: ANA, para: ANA, simbolo: 'ORIGEN', monto: '5' }), null, 'de otra persona no');
  assert.equal(buscarEnvio(bloques, { desde: YO, para: YO, simbolo: 'ORIGEN', monto: '5' }), null, 'a otra dirección no');
  assert.equal(buscarEnvio(bloques, { desde: YO, para: ANA, simbolo: 'AUKA', monto: '5' }), null, 'otra moneda no');
  const conToken = [{ result: { transactions: [token()] } }];
  assert.equal(buscarEnvio(conToken, { desde: YO, para: ANA, simbolo: 'AUKA', monto: '2,5' }), H2);
  assert.equal(buscarEnvio(conToken, { desde: YO, para: ANA, simbolo: 'AGKA', monto: '2.5' }), null, 'transfer a otro contrato no');
  assert.equal(datosTransfer(ANA, aWei('2.5')), '0xa9059cbb' + ANA.slice(2).toLowerCase().padStart(64, '0') + aWei('2.5').toString(16).padStart(64, '0'));
});

test('buscarEnvioEnRed: desde el bloque pedido, hasta 60 por vuelta, y dice el siguiente', async () => {
  const pedidos: number[] = [];
  const { pedir } = rpcFalso((c) => {
    if (c.method === 'eth_blockNumber') return hex(BigInt(1000));
    if (c.method === 'eth_getBlockByNumber') {
      const n = parseInt(c.params[0], 16);
      pedidos.push(n);
      assert.equal(c.params[1], true, 'con las transacciones completas');
      return { number: c.params[0], transactions: n === 995 ? [nativo()] : [] };
    }
    return null;
  });
  const r = await buscarEnvioEnRed({ desde: YO, para: ANA, simbolo: 'ORIGEN', monto: '5' }, 990, { pedir });
  assert.equal(r.hash, H1);
  assert.equal(r.siguiente, 1001);
  assert.deepEqual([pedidos[0], pedidos[pedidos.length - 1]], [990, 1000]);
  pedidos.length = 0;
  const lejos = await buscarEnvioEnRed({ desde: YO, para: ANA, simbolo: 'ORIGEN', monto: '5' }, 800, { pedir });
  assert.equal(lejos.siguiente, 860);
  assert.equal(pedidos.length, 60);
  // Sin base, se empieza en el último: mirar atrás podría tomar un envío viejo igual.
  pedidos.length = 0;
  await buscarEnvioEnRed({ desde: YO, para: ANA, simbolo: 'ORIGEN', monto: '5' }, 0, { pedir });
  assert.deepEqual(pedidos, [1000]);
});

test('el comprobante se vuelve a mirar en la cadena: ok, pendiente, rechazado o no coincide', async () => {
  const b = { para: ANA, monto: '5', simbolo: 'ORIGEN' };
  assert.equal(comprobarTx(nativo(), { blockNumber: '0x10', status: '0x1' }, b), 'ok');
  assert.equal(comprobarTx(nativo(), null, b), 'pendiente');
  assert.equal(comprobarTx(null, null, b), 'pendiente');
  assert.equal(comprobarTx(nativo(), { blockNumber: '0x10', status: '0x0' }, b), 'fallo');
  assert.equal(comprobarTx(nativo({ value: hex(WEI) }), { blockNumber: '0x10', status: '0x1' }, b), 'no-coincide');
  assert.equal(comprobarTx(nativo(), { blockNumber: '0x10', status: '0x1' }, { ...b, desde: ANA }), 'no-coincide');
  const { pedir } = rpcFalso((c) => (c.method === 'eth_getTransactionByHash' ? nativo() : { blockNumber: '0x99', status: '0x1' }));
  assert.equal(await verificarComprobante(H1, b, { pedir }), 'ok');
  assert.equal(await verificarComprobante('0x123', b, { pedir }), 'no-coincide');
});

/* ── el vigía del pago, con una cadena falsa ──────────────────────────────────────────────── */

function vigiaFalso(o: { hashes?: Array<string | null>; publica?: boolean[]; bloque?: number } = {}) {
  let t = 1_000_000;
  const timers: Array<() => void> = [];
  const busquedas: number[] = [];
  const publicados: any[] = [];
  const guardados: any[] = [];
  const hashes = [...(o.hashes || [])];
  const publica = [...(o.publica || [])];
  const v = new VigiaPago({
    bloque: async () => o.bloque ?? 500,
    buscar: async (_b, inicio) => {
      busquedas.push(inicio);
      return { hash: hashes.length ? hashes.shift()! : null, siguiente: (inicio || 500) + 3 };
    },
    publicar: async (p) => {
      publicados.push(p);
      return publica.length ? publica.shift()! : true;
    },
    guardar: async (d) => {
      guardados.push(JSON.parse(JSON.stringify(d)));
    },
    ahora: () => t,
    esperar: (_ms, f) => {
      timers.push(f);
      return () => {
        const i = timers.indexOf(f);
        if (i >= 0) timers.splice(i, 1);
      };
    },
  });
  const tic = async () => {
    const f = timers.shift();
    f?.();
    for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
  };
  return { v, tic, busquedas, publicados, guardados, pasar: (ms: number) => (t += ms), timers };
}

const PAGO = { correo: 'Ana@Correo.com', nombre: 'Ana', direccion: ANA, mia: YO, monto: '5', moneda: 'origen' };

test('vigía: solo bloques DESPUÉS de abrir la wallet; al ver el envío publica el comprobante, y una sola vez', async () => {
  const f = vigiaFalso({ hashes: [null, H1] });
  const p = await f.v.preparar(PAGO);
  assert.equal(p.siguiente, 501);
  assert.equal(p.moneda, 'ORIGEN');
  assert.equal(p.correo, 'ana@correo.com');
  f.v.empezar(p);
  assert.equal(f.v.estado().fase, 'esperando');
  assert.equal(f.guardados.at(-1).pago.siguiente, 501, 'el pago a medias queda guardado');
  await f.tic(); // no está todavía
  assert.deepEqual(f.busquedas, [501]);
  assert.equal(f.v.estado().fase, 'esperando');
  await f.tic(); // ya está
  assert.deepEqual(f.busquedas, [501, 504]);
  assert.equal(f.v.estado().fase, 'publicado');
  assert.deepEqual(f.publicados, [{ para: 'ana@correo.com', monto: '5', moneda: 'ORIGEN', hash: H1 }]);
  assert.equal(f.guardados.at(-1).pago, null, 'terminado: no queda nada que retomar');
  assert.deepEqual(f.guardados.at(-1).usados, [H1]);
  // El mismo hash no prueba otro pago.
  f.v.olvidar();
  const f2 = new VigiaPago({ ...(f.v as any).deps });
  f2.retomar({ pago: null, usados: [H1] });
  assert.equal(f2.estado().fase, 'libre');
});

test('vigía: el mismo hash nunca prueba dos pagos; sin dirección propia no empieza', async () => {
  const f = vigiaFalso({ hashes: [H1, null, H1, H2] });
  f.v.empezar(await f.v.preparar(PAGO));
  await f.tic();
  assert.equal(f.v.estado().fase, 'publicado');
  f.v.olvidar();
  f.v.empezar(await f.v.preparar(PAGO));
  await f.tic(); // null
  await f.tic(); // H1 otra vez: ya se usó, se ignora
  assert.equal(f.v.estado().fase, 'esperando');
  await f.tic(); // H2
  assert.equal(f.v.estado().fase, 'publicado');
  assert.equal(f.publicados.length, 2);
  assert.equal(f.publicados[1].hash, H2);
  await assert.rejects(f.v.preparar({ ...PAGO, mia: '' }), /conecta tu cartera/);
  await assert.rejects(f.v.preparar({ ...PAGO, direccion: 'escrita a mano' }), /dirección/);
  await assert.rejects(f.v.preparar({ ...PAGO, monto: '0' }), /cantidad/);
});

test('vigía: tope de 15 min (seguir mirando), cancelar, comprobante rechazado y retomar tras un cierre', async () => {
  const f = vigiaFalso({ hashes: [null, null, H1], publica: [false, true] });
  const p = await f.v.preparar(PAGO);
  f.v.empezar(p);
  await f.tic();
  f.pasar(TOPE_VIGIA_MS + 1);
  await f.tic();
  assert.equal(f.v.estado().fase, 'vencido');
  f.v.seguir();
  assert.equal(f.v.estado().fase, 'esperando');
  await f.tic(); // null
  await f.tic(); // H1, pero el relevo no lo acepta
  assert.equal(f.v.estado().fase, 'sin-comprobante');
  assert.equal(f.v.estado().hash, H1);
  f.v.reintentarPublicar();
  await new Promise((r) => setImmediate(r));
  assert.equal(f.v.estado().fase, 'publicado');
  // Cancelar: deja de mirar (lo que firme después no se publica solo).
  const c = vigiaFalso({ hashes: [H2] });
  c.v.empezar(await c.v.preparar(PAGO));
  c.v.cancelar();
  assert.equal(c.v.estado().fase, 'cancelado');
  assert.equal(c.timers.length, 0);
  assert.equal(c.publicados.length, 0);
  // Retomar: Android cerró AU-RA en la wallet; al volver sigue desde el bloque donde iba.
  const r = vigiaFalso({ hashes: [H2] });
  const guardado: Pendiente = { ...p, siguiente: 777, hasta: 1_000_000 + 60_000 };
  r.v.retomar({ pago: guardado, usados: [] });
  assert.equal(r.v.estado().fase, 'esperando');
  await r.tic();
  assert.deepEqual(r.busquedas, [777]);
  assert.equal(r.v.estado().fase, 'publicado');
  // Uno ya visto pero sin publicar: se publica al retomar.
  const r2 = vigiaFalso();
  r2.v.retomar({ pago: { ...guardado, hash: H1 }, usados: [H1] });
  await new Promise((res) => setImmediate(res));
  assert.equal(r2.v.estado().fase, 'publicado');
  assert.equal(r2.publicados[0].hash, H1);
  // Uno vencido mientras la app estaba cerrada: se dice, no se mira.
  const r3 = vigiaFalso();
  r3.v.retomar({ pago: { ...guardado, hasta: 1 }, usados: [] });
  assert.equal(r3.v.estado().fase, 'vencido');
});

test('vigía: al cerrar sesión se suelta YA; lo que estaba en vuelo no publica ni pinta (auditoría WAL02)', async () => {
  // La búsqueda queda colgada hasta que la soltamos a mano: la sesión se cierra en medio.
  let soltarBusqueda: (r: { hash: string | null; siguiente: number }) => void = () => {};
  const f = vigiaFalso();
  (f.v as any).deps.buscar = () => new Promise((res) => (soltarBusqueda = res));
  f.v.empezar(await f.v.preparar(PAGO));
  const guardadosAntes = f.guardados.length;
  void f.tic(); // empieza a mirar y se queda esperando la red
  await new Promise((r) => setImmediate(r));
  f.v.soltar();
  assert.equal(f.v.estado().fase, 'libre');
  assert.equal(f.v.estado().pago, null);
  assert.equal(f.timers.length, 0, 'sin vueltas pendientes');
  assert.equal(f.guardados.length, guardadosAntes, 'lo guardado se queda: es de su dueño y solo él lo retoma');
  soltarBusqueda({ hash: H1, siguiente: 600 }); // la red contesta tarde con el envío
  for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
  assert.equal(f.publicados.length, 0, 'el comprobante de la cuenta anterior no se publica');
  assert.equal(f.v.estado().fase, 'libre');
  assert.equal(f.timers.length, 0);
  // La siguiente cuenta empieza limpia: su búsqueda corre (la bandera de la vuelta vieja no la tapa).
  (f.v as any).deps.buscar = async () => ({ hash: H2, siguiente: 9 });
  f.v.empezar(await f.v.preparar(PAGO));
  await f.tic();
  assert.equal(f.v.estado().fase, 'publicado');
  assert.deepEqual(f.publicados.map((p) => p.hash), [H2]);
});

/* ── el perfil con la cartera y la herramienta de AURA ────────────────────────────────────── */

test('perfil: la cartera es una dirección 0x…40 hex, se borra con vacío y sobrevive a leer de disco', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'perfil-cartera-'));
  process.env.ULTRON_PERFILES_DIR = dir;
  const P = await import('../lib/perfil-persona');
  assert.deepEqual(P.validarCambios({ cartera: ANA }), { ok: true, cambios: { cartera: ANA } });
  assert.equal(P.validarCambios({ cartera: '0x123' }).ok, false);
  assert.equal(P.validarCambios({ cartera: 'mi contraseña' }).ok, false);
  const base = P.perfilInicial({ apodo: 'José' });
  const con = P.aplicarCambios(base, { cartera: ANA });
  assert.equal(con.cartera, ANA);
  const sin = P.aplicarCambios(con, (P.validarCambios({ cartera: '' }) as any).cambios);
  assert.equal('cartera' in sin, false);
  await P.actualizarPerfil('jose.h@ordenglobal.com', { cartera: ANA });
  P._olvidarCachePerfiles();
  assert.equal((await P.leerPerfil('jose.h@ordenglobal.com'))?.cartera, ANA);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('herramienta cartera: lee con la dirección guardada, solo lectura; sin dirección dice cómo conectarla', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'perfil-cartera2-'));
  process.env.ULTRON_PERFILES_DIR = dir;
  const P = await import('../lib/perfil-persona');
  P._olvidarCachePerfiles();
  const { correrCartera, SIN_CARTERA } = await import('../lib/cartera');
  _olvidarCacheCartera();
  const { pedir } = rpcFalso((c) => (c.method === 'eth_getBalance' ? hex(WEI * BigInt(10)) : '0x0'));
  assert.equal(await correrCartera('ana@x.com', '', { pedir }), SIN_CARTERA);
  assert.match(await correrCartera('', '', { pedir }), /solo con sesión/);
  await P.actualizarPerfil('ana@x.com', { cartera: YO });
  const todo = await correrCartera('ana@x.com', '', { pedir });
  assert.match(todo, /^HARNESS cartera \(Veta Wallet 0x111111…111111, leída de la cadena de Orden Global, solo lectura\): Tienes unos .* dólares: 10 ORIGEN\./);
  assert.match(todo, /nunca mueves dinero/);
  assert.match(await correrCartera('ana@x.com', 'origen', { pedir }), /Tienes 10 ORIGEN/);
  const caida: Pedidor = async () => ({ ok: false, status: 503, json: async () => ({}) });
  _olvidarCacheCartera();
  assert.match(await correrCartera('ana@x.com', '', { pedir: caida }), /no contestó .*No inventes saldos/);
  fs.rmSync(dir, { recursive: true, force: true });

  // El harness: la línea, el runner y la instrucción (solo con sesión).
  assert.deepEqual(extraerPedidoHerramienta('Déjame ver.\nPEDIR_HERRAMIENTA: cartera ORIGEN'), { herramienta: 'cartera', arg: 'ORIGEN' });
  const r = await resolverPedido({ herramienta: 'cartera', arg: 'AUKA' }, { web: async () => '', sistema: async () => '', leer: async () => '', ejecutor: async () => '', cartera: async (a) => `leí ${a}` });
  assert.equal(r, 'leí AUKA');
  assert.match(await resolverPedido({ herramienta: 'cartera', arg: '' }, { web: async () => '', sistema: async () => '', leer: async () => '', ejecutor: async () => '' }), /no está disponible/);
  assert.match(instruccionHarness('miembro', false, false, true), /PEDIR_HERRAMIENTA: cartera/);
  assert.doesNotMatch(instruccionHarness('miembro', false, false, false), /PEDIR_HERRAMIENTA: cartera/);
});

/* ── las manos de la voz: abrir la cartera y dejar listo un envío (nunca pagar) ───────────── */

test('manos cartera y pagar: forma estricta, solo a un contacto sin dudas, y la regla en el prompt', () => {
  assert.ok((MANOS as readonly string[]).includes('cartera') && (MANOS as readonly string[]).includes('pagar'));
  assert.deepEqual(validarMano({ tipo: 'cartera' }), { tipo: 'cartera' });
  assert.deepEqual(validarMano({ tipo: 'pagar', con: 'Ana', monto: '5', moneda: 'origen' }), { tipo: 'pagar', con: 'Ana', monto: '5', moneda: 'ORIGEN' });
  assert.deepEqual(validarMano({ tipo: 'pagar', con: 'Ana' }), { tipo: 'pagar', con: 'Ana' });
  assert.equal(validarMano({ tipo: 'pagar', con: '' }), null);
  // Lo que el modelo escriba de más (una dirección, una contraseña) no viaja: la forma no tiene dónde.
  assert.deepEqual(validarAccion({ tipo: 'pagar', con: 'Ana', monto: '5', moneda: 'ORIGEN', direccion: '0xdead', clave: 'x' }), { tipo: 'pagar', con: 'Ana', monto: '5', moneda: 'ORIGEN' });
  const contexto = {
    pantalla: 'mesa' as const,
    contactos: [
      { correo: 'ana@x.com', nombre: 'Ana López' },
      { correo: 'beto@x.com', nombre: 'Beto' },
      { correo: 'beto2@x.com', nombre: 'Beto Ruiz' },
    ],
    manos: ['pagar', 'cartera'] as any,
  };
  const out = prepararAcciones([{ tipo: 'pagar', con: 'Ana', monto: '5', moneda: 'ORIGEN' }], { mensaje: 'mándale 5 origen a Ana', contexto });
  assert.deepEqual(out, [{ tipo: 'pagar', con: 'ana@x.com', monto: '5', moneda: 'ORIGEN' }]);
  assert.deepEqual(prepararAcciones([{ tipo: 'pagar', con: 'Carlos', monto: '5' }], { mensaje: 'x', contexto }), [], 'quien no está en contactos, no');
  // Un teléfono que no declaró la mano (APK viejo) no la recibe.
  assert.deepEqual(prepararAcciones([{ tipo: 'pagar', con: 'Ana', monto: '5' }], { mensaje: 'x', contexto: { ...contexto, manos: [] } }), []);
  const reglas = reglasManos(contexto as any).join('\n');
  assert.match(reglas, /"tipo":"pagar"/);
  assert.match(reglas, /NUNCA pagas ni pides contraseñas/);
  assert.match(reglas, /"tipo":"cartera"/);
});

/* ── la pestaña Veta Wallet: movimientos, distribución y QR para recibir ─────────────────── */

import crypto from 'node:crypto';
import { historialDe, leerHistorial, distribucion, _olvidarHistorial, EXPLORADOR_API } from '../mobile/src/cartera/movimientos';
import { codigoQR, capacidad } from '../mobile/src/cartera/qr';

const HX1 = '0x' + 'a'.repeat(64);
const HX2 = '0x' + 'b'.repeat(64);
const HX3 = '0x' + 'c'.repeat(64);
const OTRO = '0x2222222222222222222222222222222222222222';

test('movimientos: lo que entró y salió, del más nuevo al más viejo, sin repetidos ni basura (OrdenScan)', () => {
  const j = {
    transactions: [
      { hash: HX1, from: OTRO, to: YO.toUpperCase().replace('0X', '0x'), value: '20', symbol: 'ORIGEN', timestamp: '1790000000', blockNumber: '100' },
      { hash: HX2, from: YO, to: OTRO, value: '0.35', symbol: 'AUKA', timestamp: '1790033715', blockNumber: '233251' },
      { hash: HX2, from: YO, to: OTRO, value: '0.35', symbol: 'AUKA', timestamp: '1790033715', blockNumber: '233251' },
      { hash: HX3, from: YO, to: YO, value: '1', symbol: 'ONDK', timestamp: '1790000500', blockNumber: '150' },
      { hash: HX3, from: OTRO, to: ANA, value: '9', symbol: 'ONDK', blockNumber: '160' },
      { hash: 'no', from: YO, to: OTRO, value: '1', symbol: 'AGKA' },
      { hash: '0x' + 'd'.repeat(64), from: YO, to: null, value: '1', symbol: 'CONTRACT' },
      { hash: '0x' + 'e'.repeat(64), from: YO, to: OTRO, value: '0', symbol: 'AGKA' },
    ],
    tokensBalance: { AUKA: { name: 'Gold Kapital' }, AGKA: { name: 'AGKA' } },
    identidad: { verificada: true, gid: 'GEN-X' },
  };
  const h = historialDe(j, YO, 5);
  assert.deepEqual(h.movimientos.map((m) => [m.tipo, m.simbolo, m.monto, m.bloque]), [
    ['salida', 'AUKA', 0.35, 233251],
    ['propio', 'ONDK', 1, 150],
    ['entrada', 'ORIGEN', 20, 100],
  ]);
  assert.equal(h.movimientos[0].otra, OTRO);
  assert.equal(h.movimientos[2].otra, OTRO, 'en una entrada, la otra es quien envió');
  assert.equal(h.movimientos[0].fecha, 1790033715000);
  assert.deepEqual(h.nombres, { AUKA: 'Gold Kapital' }, 'un nombre igual al símbolo no se repite');
  assert.equal(h.verificada, true);
  assert.deepEqual(historialDe(null, YO).movimientos, []);
  assert.equal(historialDe({ identidad: { verificada: false } }, YO).verificada, false);
});

test('movimientos: se piden a OrdenScan por dirección, un minuto en memoria, y un fallo se dice', async () => {
  _olvidarHistorial();
  const urls: string[] = [];
  const pedir: Pedidor = async (url) => {
    urls.push(url);
    return { ok: true, status: 200, json: async () => ({ transactions: [{ hash: HX1, from: OTRO, to: YO, value: '2', symbol: 'ORIGEN', blockNumber: '9' }] }) };
  };
  const a = await leerHistorial(YO, { pedir, ahora: 1000 });
  assert.equal(a.movimientos.length, 1);
  assert.equal(urls[0], `${EXPLORADOR_API}/address/${YO.toLowerCase()}`);
  await leerHistorial(YO, { pedir, ahora: 30_000 });
  assert.equal(urls.length, 1, 'dentro del minuto no se vuelve a pedir');
  await leerHistorial(YO, { pedir, ahora: 30_000, forzar: true });
  assert.equal(urls.length, 2);
  _olvidarHistorial();
  await assert.rejects(leerHistorial(YO, { pedir: async () => ({ ok: false, status: 503, json: async () => ({}) }) }), /OrdenScan no contestó \(503\)/);
  await assert.rejects(leerHistorial('no-es', { pedir }), /dirección/);
});

test('distribución: las 4 monedas que más valen y «otras», en partes del total', () => {
  const d = distribucion([
    { simbolo: 'AUKA', usd: 50 },
    { simbolo: 'ORIGEN', usd: 20 },
    { simbolo: 'ONDK', usd: 10 },
    { simbolo: 'AGKA', usd: 10 },
    { simbolo: 'MNKA', usd: 6 },
    { simbolo: 'IBS', usd: 4 },
    { simbolo: 'SOL', usd: null },
    { simbolo: 'LOVE', usd: 0 },
  ]);
  assert.deepEqual(d.map((x) => x.simbolo), ['AUKA', 'ORIGEN', 'ONDK', 'AGKA', 'OTRAS']);
  assert.equal(Math.round(d.reduce((a, x) => a + x.parte, 0) * 1000), 1000);
  assert.equal(d[0].parte, 0.5);
  assert.deepEqual(distribucion([{ simbolo: 'X', usd: null }]), []);
});

test('QR para recibir: la matriz que el lector de OpenCV leyó bien (huella fija), buscadores y tamaño', () => {
  const huella = (m: boolean[][]) => crypto.createHash('sha256').update(m.map((f) => f.map((v) => (v ? '1' : '0')).join('')).join('\n')).digest('hex');
  const dir = codigoQR('0x746268404cc9ca2ef0ac344f02b236db232c3ad8')!;
  assert.equal(dir.length, 29, 'una dirección cabe en la versión 3 (29×29)');
  assert.equal(huella(dir), '844fa284bed48bb317056a103e1bd2a3115f44ce9c36296aee27334006b9f6f2');
  const largo = codigoQR('Mi dirección de Veta Wallet: 0x746268404cc9ca2ef0ac344f02b236db232c3ad8 — red Orden Global, ñ á é')!;
  assert.equal(largo.length, 41, 'UTF-8 con acentos, versión 6');
  assert.equal(huella(largo), '883aa102e320390c2212c920292dcd81ec3a2e335a303a3d60e0f2fe515229f2');
  // Los tres buscadores (7×7 con borde oscuro y centro 3×3) en sus esquinas.
  const n = dir.length;
  for (const [x0, y0] of [[0, 0], [n - 7, 0], [0, n - 7]]) {
    for (let i = 0; i < 7; i++) {
      assert.ok(dir[y0][x0 + i] && dir[y0 + 6][x0 + i] && dir[y0 + i][x0] && dir[y0 + i][x0 + 6], 'borde del buscador');
    }
    assert.ok(dir[y0 + 3][x0 + 3] && !dir[y0 + 1][x0 + 1]);
  }
  assert.equal(capacidad(3), 42);
  assert.equal(capacidad(10), 213);
  assert.equal(codigoQR('x'.repeat(213))!.length, 57, 'la 10 llena');
  assert.equal(codigoQR('x'.repeat(214)), null, 'lo que no cabe no se dibuja a medias');
});

/* ── revisión 4-oct: un envío preparado para Nicole no sale para otra persona ─────────────── */

test('pagar (servidor, ya seguro: evidencia): con dos «Nicole» no se prepara nada; con el nombre entero va el correo EXACTO', () => {
  const contexto = {
    pantalla: 'mesa' as const,
    contactos: [
      { correo: 'nicole.paz@x.com', nombre: 'Nicole Paz' },
      { correo: 'nicole.lopez@x.com', nombre: 'Nicole López' },
      { correo: 'bruno@x.com', nombre: 'Bruno' },
    ],
    manos: ['pagar'] as any,
  };
  assert.deepEqual(prepararAcciones([{ tipo: 'pagar', con: 'Nicole', monto: '5', moneda: 'ORIGEN' }], { mensaje: 'mándale 5 a Nicole', contexto }), [], 'dos Nicole: el cerebro tiene que preguntar');
  assert.deepEqual(prepararAcciones([{ tipo: 'pagar', con: 'Nicole Paz', monto: '5', moneda: 'ORIGEN' }], { mensaje: 'x', contexto }), [{ tipo: 'pagar', con: 'nicole.paz@x.com', monto: '5', moneda: 'ORIGEN' }]);
  assert.deepEqual(prepararAcciones([{ tipo: 'pagar', con: 'Nicol', monto: '5' }], { mensaje: 'x', contexto }), [], 'un nombre mal oído no elige a nadie');
});

test('pagar (teléfono): el destino del envío preparado es EXACTO — el correo tal cual, o un solo contacto sin dudas; nunca el «más parecido»', async () => {
  const { destinoDePago } = await import('../mobile/src/cartera/logica');
  const contactos = [
    { correo: 'nicole.paz@x.com', nombre: 'Nicole Paz' },
    { correo: 'nicole.lopez@x.com', nombre: 'Nicole López' },
    { correo: 'bruno@x.com', nombre: 'Bruno Díaz' },
  ];
  // Lo que manda el servidor: el correo exacto. Se usa tal cual, aunque haya otro contacto que «se le parezca».
  assert.deepEqual(destinoDePago('Nicole.Paz@x.com', contactos), { correo: 'nicole.paz@x.com', nombre: 'Nicole Paz' });
  assert.deepEqual(destinoDePago('nueva@x.com', contactos), { correo: 'nueva@x.com', nombre: 'nueva' });
  // Un nombre (un servidor viejo): solo si es uno sin dudas.
  assert.deepEqual(destinoDePago('Nicole', contactos), { varios: [contactos[0], contactos[1]] });
  assert.deepEqual(destinoDePago('nicole lopez', contactos), { correo: 'nicole.lopez@x.com', nombre: 'Nicole López' });
  assert.deepEqual(destinoDePago('Bruno', contactos), { correo: 'bruno@x.com', nombre: 'Bruno Díaz' });
  // Mal oído o parecido: nadie (antes una letra de diferencia elegía al «más parecido»).
  assert.equal(destinoDePago('Nicol', contactos), null);
  assert.equal(destinoDePago('Brunno', contactos), null);
  assert.equal(destinoDePago('', contactos), null);
});

test('pagar (teléfono): lo que se confirma es lo que se revisó — otra persona, dirección, cantidad o moneda no se firma con esa revisión', async () => {
  const { mismoEnvio } = await import('../mobile/src/cartera/logica');
  const revisado = { correo: 'nicole.paz@x.com', direccion: ANA, monto: '5', moneda: 'ORIGEN' };
  assert.equal(mismoEnvio(revisado, { ...revisado }), true);
  assert.equal(mismoEnvio(revisado, { ...revisado, correo: 'NICOLE.PAZ@x.com', direccion: ANA.toLowerCase() }), true, 'mayúsculas no cambian a quién va');
  assert.equal(mismoEnvio(revisado, { ...revisado, correo: 'bruno@x.com' }), false, 'la hoja ahora es de Bruno');
  assert.equal(mismoEnvio(revisado, { ...revisado, direccion: YO }), false, 'la dirección que llegó es otra');
  assert.equal(mismoEnvio(revisado, { ...revisado, monto: '50' }), false);
  assert.equal(mismoEnvio(revisado, { ...revisado, moneda: 'AUKA' }), false);
  assert.equal(mismoEnvio(null, revisado), false, 'sin revisión, nada');
});
