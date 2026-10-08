/**
 * LA INICIATIVA DEL DÍA (tanda F2: lib/iniciativa-dia.ts, server/iniciativa-dia.ts, la llamada por un VIP urgente en
 * lib/alertas-mensajes.ts y el enlace de llamada del calendario):
 *
 *  · el resumen a SU hora en Honduras (UTC−6 sin horario de verano), el día local correcto alrededor de medianoche, otra
 *    zona con horario de verano, y la ventana si el servidor estuvo caído;
 *  · los empujones: horas quietas, el tope de 3 al día, 45 minutos entre uno y otro, el «hoy no» y el «para» a secas;
 *  · nada sale si no hay nada que decir; encendida por omisión solo para la cuenta dueña;
 *  · honestidad: los textos proponen, nunca dicen que algo se hizo; lo que el modelo diga de más se cambia por el armado
 *    a mano;
 *  · costo: una redacción al día por persona (también tras un reinicio);
 *  · nada sale dos veces tras un reinicio (lo reclamado queda en el cajón, como el reloj de los recordatorios);
 *  · «llámame»: el resumen y el VIP urgente, fuera de las horas quietas; si la llamada no sale, el aviso;
 *  · la voz: «no me molestes hoy», «mándame el resumen de la mañana a las 7», «ya no me llames»; y (revisión de la tanda F,
 *    B1) lo que NO es una orden: dictados para otra persona, recordatorios, otro «resumen», una hora sin mañana/tarde;
 *  · las rutas de Ajustes → Iniciativa, por la sesión;
 *  · revisión de la tanda F: el borrador que se empuja sale de la decisión abierta de verdad y nunca si ya tiene recibo de
 *    envío (B3); el «hoy no» lo respetan también la iniciativa de siempre, sus llamadas y los avisos (B4); la hora del
 *    resumen respeta las horas quietas salvo elegida a sabiendas; el aviso bloqueado del resumen no lleva texto libre;
 *    como mucho 2 llamadas por un VIP al día.
 */
import './datos-prueba';
import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import type { AddressInfo } from 'node:net';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'iniciativa-dia-'));
process.env.ULTRON_INICIATIVA_DIA_DIR = path.join(dir, 'dia');
process.env.ULTRON_DURABLE_DIR = path.join(dir, 'durable');
process.env.ULTRON_SESIONES_CERRADAS_ARCHIVO = path.join(dir, 'cerradas.json');
process.env.ULTRON_SESION_SECRETO = 'secreto-de-prueba-largo-para-la-iniciativa-del-dia';
process.env.ULTRON_MEMORIA_BUCKET = '';
after(() => fs.rmSync(dir, { recursive: true, force: true }));

const D = await import('../lib/iniciativa-dia');
const S = await import('../server/iniciativa-dia');
const A = await import('../lib/alertas-mensajes');
const { listarEventos } = await import('../lib/calendario/proveedores');
const { emitirSesion, sesionDe, exigirMesa } = await import('../server/seguridad');
const { datosParaFcm } = await import('../lib/push');

/** Un instante de reloj de pared en Honduras (UTC−6 todo el año). */
const hn = (anio: number, mes: number, dia: number, hora: number, min = 0) => Date.UTC(anio, mes - 1, dia, hora + 6, min);
const MIN = 60_000;
const H = 3600_000;
const DUENO = 'jose@og.hn';
let n = 0;
const cuenta = () => `persona${++n}-${Date.now().toString(36)}@x.hn`;
const duenas = new Set([DUENO]);
/** Otra cuenta dueña (cada prueba la suya: el resumen de un día sale una sola vez por cuenta). */
const nuevaDuena = () => {
  const c = `duena${++n}@og.hn`;
  duenas.add(c);
  return c;
};
D.fijarDuenoDia((c) => duenas.has(c));

beforeEach(() => D._olvidarIniciativaDia());

/* ── las fuentes y las salidas de mentira ────────────────────────────────────────────────── */

type Fuentes = Parameters<typeof S.materialDelDia>[1];
const vacias = (): Fuentes => ({
  eventos: async () => null,
  recordatorios: async () => [],
  mensajes: async () => [],
  abiertos: async () => [],
  misiones: async () => [],
  propuesta: async () => null,
});

/** `texto`: lo que AURA dice (al tocar el aviso, o en la llamada); `aviso`: lo que se ve en el aviso (pantalla bloqueada). */
type Salida = { tipo: 'aviso' | 'llamada'; correo: string; texto: string; id: string; aviso?: string };
function reloj(o: { ahora: () => number; fuentes?: Partial<Fuentes>; personas?: string[]; salidas?: Salida[]; llamadaSale?: boolean; redactor?: (m: any) => Promise<string>; unaVez?: Set<string> | null; pedidos?: any[] }) {
  const salidas = o.salidas || [];
  const unaVez = o.unaVez === undefined ? new Set<string>() : o.unaVez;
  return new S.RelojIniciativaDia({
    personas: () => o.personas || [],
    ahora: o.ahora,
    fuentes: { ...vacias(), ...(o.fuentes || {}) },
    salidas: {
      avisar: async (correo, a) => (salidas.push({ tipo: 'aviso', correo, texto: a.decir ?? a.texto, aviso: a.texto, id: a.id }), 1),
      llamar: async (correo, a) => (o.llamadaSale === false ? 0 : (salidas.push({ tipo: 'llamada', correo, texto: a.motivo, id: a.id }), 1)),
      ...(unaVez ? { unaVez: async (f: string, c: string, id: string) => !unaVez.has(`${f}|${c}|${id}`) && !!unaVez.add(`${f}|${c}|${id}`) } : {}),
      redactor: o.redactor
        ? async (m) => {
            o.pedidos?.push(m);
            return o.redactor!(m);
          }
        : null,
    },
  });
}

/** Borradores que esperan su «sí» de verdad (la decisión abierta) y, por omisión, sin recibo de envío. */
const conBorradores = (bs: Array<{ id: string; canal: 'correo' | 'whatsapp'; para: string; creado: number; caduca?: number }>, recibos: Record<string, 'hay' | 'ninguno' | 'incierto'> = {}): Partial<Fuentes> => ({
  borradores: async () => bs,
  reciboEnvio: async (_c, _canal, id) => recibos[id] || 'ninguno',
});

/** Una reunión hora y media después de pedirla y la pastilla media hora después (a las 7:30: 9:00 y 8:00). */
const conAgenda = (): Partial<Fuentes> => ({
  eventos: async (_c, desde) => [{ id: `e1-${desde}`, titulo: 'Reunión con Ana', inicio: desde + 90 * MIN, fin: desde + 150 * MIN, lugar: 'Oficina central' }],
  recordatorios: async (_c, desde) => [{ texto: 'La pastilla', cuando: desde + 30 * MIN }],
});

/* ── el resumen: cuándo ──────────────────────────────────────────────────────────────────── */

test('el resumen sale a su hora de Honduras: 7:30 HN = 13:30 UTC; ni antes ni, pasada la ventana, tarde', () => {
  const p = D.prefsEfectivas({}, { dueno: true });
  assert.equal(p.horaResumen, '07:30');
  assert.equal(p.zona, 'America/Tegucigalpa');
  assert.equal(D.momentoResumen(p, '2026-10-08'), Date.parse('2026-10-08T13:30:00Z'));
  const e = { resumenFecha: undefined, hoyNo: undefined };
  assert.deepEqual(D.tocaResumen(e, p, hn(2026, 10, 8, 7, 29)), { toca: false, porque: 'temprano' });
  assert.deepEqual(D.tocaResumen(e, p, hn(2026, 10, 8, 7, 30)), { toca: true, fecha: '2026-10-08' });
  // 07:30 UTC es la 01:30 de Honduras: todavía no (no se confunde UTC con la hora local).
  assert.deepEqual(D.tocaResumen(e, p, Date.parse('2026-10-08T07:30:00Z')), { toca: false, porque: 'temprano' });
  // Las 23:59 del 7 en Honduras ya son el 8 en UTC: el «día» es el de Honduras.
  assert.equal(D.tocaResumen(e, p, hn(2026, 10, 7, 23, 59)).toca, false);
  assert.equal((D.tocaResumen(e, p, hn(2026, 10, 7, 23, 59)) as any).porque, 'tarde', 'el del 7 ya pasó y el del 8 todavía no llega');
  // El servidor estuvo caído a las 7:30: a las 8:45 todavía sale; a las 9:15, ya no (mañana otro).
  assert.equal(D.tocaResumen(e, p, hn(2026, 10, 8, 8, 45)).toca, true);
  assert.equal((D.tocaResumen(e, p, hn(2026, 10, 8, 9, 15)) as any).porque, 'tarde');
  assert.equal((D.tocaResumen({ resumenFecha: '2026-10-08' }, p, hn(2026, 10, 8, 7, 45)) as any).porque, 'ya');
  assert.equal((D.tocaResumen({ hoyNo: '2026-10-08' }, p, hn(2026, 10, 8, 7, 45)) as any).porque, 'hoy_no');
  // Honduras no cambia la hora cuando EE. UU. sí (1-nov): sigue siendo 13:30 UTC.
  assert.equal(D.momentoResumen(p, '2026-11-02'), Date.parse('2026-11-02T13:30:00Z'));
  // Otra zona con horario de verano: 7:30 en Nueva York es 11:30 UTC en octubre y 12:30 UTC en noviembre.
  const ny = D.prefsEfectivas({ zona: 'America/New_York' }, { dueno: true });
  assert.equal(D.momentoResumen(ny, '2026-10-08'), Date.parse('2026-10-08T11:30:00Z'));
  assert.equal(D.momentoResumen(ny, '2026-11-02'), Date.parse('2026-11-02T12:30:00Z'));
});

test('encendida por omisión solo para la cuenta dueña; las demás, apagadas; «llámame» siempre empieza apagado', async () => {
  const dueno = D.prefsEfectivas({}, { dueno: true });
  const otra = D.prefsEfectivas({}, { dueno: false });
  assert.ok(dueno.activa && dueno.resumen && dueno.empujones);
  assert.equal(otra.activa, false);
  assert.equal(dueno.llamarResumen || dueno.llamarVip || otra.llamarResumen || otra.llamarVip, false);
  assert.deepEqual(dueno.quietas, { desde: '22:00', hasta: '07:00' });
  // Con el reloj: a la misma hora y con lo mismo que decir, solo le llega a la dueña.
  const salidas: Salida[] = [];
  const otraC = cuenta();
  const duena = nuevaDuena();
  const r = reloj({ ahora: () => hn(2026, 10, 8, 7, 31), personas: [duena, otraC], fuentes: conAgenda(), salidas });
  const v = await r.vuelta();
  assert.deepEqual(salidas.map((s) => s.correo), [duena]);
  assert.equal(v.resumenes.length, 1);
  // La otra la enciende: desde ahí, también (y su hora ya pasó hoy: empieza mañana).
  const c = await D.cambiarPrefsDia(otraC, { activa: true }, hn(2026, 10, 8, 7, 40));
  assert.ok(c.prefs.activa && c.desdeManana);
  assert.ok((await D.cuentasConIniciativa()).includes(otraC), 'queda en el índice que mira el reloj');
  assert.equal((await reloj({ ahora: () => hn(2026, 10, 8, 7, 41), personas: [otraC], fuentes: conAgenda(), salidas }).resumenPara(otraC)).porque, 'ya');
  assert.equal((await reloj({ ahora: () => hn(2026, 10, 9, 7, 31), personas: [otraC], fuentes: conAgenda(), salidas }).resumenPara(otraC)).salio, true);
  await D.cambiarPrefsDia(otraC, { activa: false }, hn(2026, 10, 9, 8));
  assert.ok(!(await D.cuentasConIniciativa()).includes(otraC), 'apagada: sale del índice');
});

test('si no hay nada que valga la pena decir, no sale nada (y una fuente caída no es «no tienes nada»)', async () => {
  const a = cuenta();
  await D.cambiarPrefsDia(a, { activa: true }, hn(2026, 10, 8, 6));
  const salidas: Salida[] = [];
  const r = reloj({
    ahora: () => hn(2026, 10, 8, 7, 30),
    personas: [a],
    salidas,
    fuentes: { eventos: async () => [], mensajes: async () => Promise.reject(new Error('caído')), abiertos: async () => [{ id: 'x', texto: 'Algo ya cerrado', tipo: 'tarea', estado: 'hecho', creado: 0 }] },
  });
  const v = await r.resumenPara(a);
  assert.equal(v.porque, 'vacio');
  assert.equal(salidas.length, 0);
  assert.equal(D.resumenDeterminista({ eventos: null, recordatorios: [], mensajes: [], abiertos: [], misiones: [], zona: 'America/Tegucigalpa' }), '');
  // Sin calendario conectado (null) no se dice nada de la agenda, pero lo demás sí.
  const t = D.resumenDeterminista({ eventos: null, recordatorios: [], mensajes: [], abiertos: [{ texto: 'revisar el contrato', tipo: 'promesa_persona' }], misiones: [], zona: 'America/Tegucigalpa' });
  assert.match(t, /Quedó a medias: revisar el contrato/);
  assert.doesNotMatch(t, /agenda/);
});

test('el resumen: agenda, recordatorios, mensajes desde anoche, lo que quedó a medias y misiones; al tocarlo abre la mesa', async () => {
  const salidas: Salida[] = [];
  const pedidosMensajes: number[] = [];
  const duena = nuevaDuena();
  const r = reloj({
    ahora: () => hn(2026, 10, 8, 7, 30),
    personas: [duena],
    salidas,
    unaVez: null,
    fuentes: {
      ...conAgenda(),
      mensajes: async (_c, desde) => (pedidosMensajes.push(desde), [{ quien: 'Ana Paz', canal: 'whatsapp' }, { quien: 'Banco', canal: 'correo' }]),
      abiertos: async () => [
        { id: 'a1', texto: 'Te aviso cuando llegue el contrato', tipo: 'promesa_aura', estado: 'abierto', creado: hn(2026, 10, 7, 15) },
        { id: 'a2', texto: 'Lanzar la web', tipo: 'mision', estado: 'abierto', creado: 0 },
      ],
      misiones: async () => [{ titulo: 'Lanzar la web', proximoPaso: 'elegir el dominio' }],
    },
  });
  const v = await r.resumenPara(duena);
  assert.equal(v.salio, true);
  assert.equal(pedidosMensajes[0], hn(2026, 10, 7, 20), 'desde las 20:00 de anoche en Honduras');
  const t = salidas[0].texto;
  assert.match(t, /^Buenos días\./);
  assert.match(t, /En tu agenda de hoy: 9:00 Reunión con Ana\./);
  assert.match(t, /8:00 La pastilla/);
  assert.match(t, /Ana Paz \(WhatsApp\) y Banco \(correo\)/);
  assert.match(t, /Quedó a medias: cuando llegue el contrato/);
  assert.match(t, /misión «Lanzar la web» sigue abierta; el próximo paso es elegir el dominio/);
  assert.doesNotMatch(t, /Lanzar la web.*Lanzar la web/, 'la misión no sale dos veces (también en lo abierto)');
  assert.ok(D.textoHonesto(t), t);
  // Revisión de la tanda F: lo que se VE en el aviso (la pantalla bloqueada) son cuántos y quién; nada de texto libre (lo
  // que quedó a medias, la reunión, la misión). Lo detallado lo dice AURA al tocarlo (`decir`).
  const visto = salidas[0].aviso!;
  assert.equal(visto, 'Hoy: 1 evento en tu agenda, 1 recordatorio, mensajes sin contestar de Ana Paz y Banco, 1 pendiente y 1 misión abierta. Tócalo y te lo cuento.');
  for (const libre of ['Reunión', 'pastilla', 'contrato', 'Lanzar la web', 'dominio']) assert.ok(!visto.includes(libre), `el aviso bloqueado no dice «${libre}»: ${visto}`);
  // Viaja como un `mensaje` que abre la mesa (y AU-RA lo lee al tocarlo: mobile/src/push/nativo.ts).
  const fcm = datosParaFcm(duena, { tipo: 'mensaje', titulo: 'Tu día', texto: visto, decir: t, id: salidas[0].id, abrir: 'mesa' });
  assert.equal(fcm.abrir, 'mesa');
  assert.equal(fcm.id, salidas[0].id);
  assert.equal(fcm.texto, visto);
  assert.equal(fcm.decir, t);
});

/* ── el costo y el reinicio ──────────────────────────────────────────────────────────────── */

test('costo: UNA redacción al día por persona (también tras un reinicio); sin modelo, armado a mano', async () => {
  const a = cuenta();
  const DUENO = nuevaDuena();
  await D.cambiarPrefsDia(a, { activa: true }, hn(2026, 10, 8, 6));
  const pedidos: any[] = [];
  const redactor = async () => 'Buenos días. Hoy tienes la reunión con Ana a media mañana y la pastilla a las 8. ¿Por dónde quieres empezar?';
  const salidas: Salida[] = [];
  const r1 = reloj({ ahora: () => hn(2026, 10, 8, 7, 30), personas: [DUENO, a], fuentes: conAgenda(), salidas, redactor, pedidos });
  await r1.vuelta();
  assert.equal(pedidos.length, 2, 'una por persona');
  assert.equal(salidas.length, 2);
  assert.ok(salidas.every((s) => s.texto.startsWith('Buenos días. Hoy tienes')));
  // El pedido es chico: el system y las piezas, nada más.
  const tam = JSON.stringify(pedidos[0]).length;
  assert.ok(tam < 2000, `pedido de ${tam} letras`);
  // Reinicio (caché vacía, otro reloj) en la misma ventana: no se pide otra redacción ni sale otro resumen.
  D._olvidarIniciativaDia();
  const r2 = reloj({ ahora: () => hn(2026, 10, 8, 7, 45), personas: [DUENO, a], fuentes: conAgenda(), salidas, redactor, pedidos, unaVez: new Set() });
  await r2.vuelta();
  assert.equal(pedidos.length, 2);
  assert.equal(salidas.length, 2);
  // Al día siguiente, otra (una).
  await reloj({ ahora: () => hn(2026, 10, 9, 7, 30), personas: [DUENO, a], fuentes: conAgenda(), salidas, redactor, pedidos }).vuelta();
  assert.equal(pedidos.length, 4);
  // Si la redacción del día ya se gastó (p. ej. el envío anterior se cayó a medias), el resumen sale a mano, sin modelo.
  const b = cuenta();
  await D.cambiarPrefsDia(b, { activa: true }, hn(2026, 10, 10, 6));
  assert.equal(await D.reclamarGeneracion(b, '2026-10-10'), true);
  const s2: Salida[] = [];
  await reloj({ ahora: () => hn(2026, 10, 10, 7, 30), personas: [b], fuentes: conAgenda(), salidas: s2, redactor, pedidos }).vuelta();
  assert.equal(pedidos.length, 4, 'sin otra redacción');
  assert.match(s2[0].texto, /^Buenos días\. En tu agenda de hoy/);
});

test('reinicio: lo reclamado queda en el cajón; ni el resumen ni un empujón salen dos veces', async () => {
  const a = cuenta();
  await D.cambiarPrefsDia(a, { activa: true }, hn(2026, 10, 8, 6));
  const salidas: Salida[] = [];
  const fuentes: Partial<Fuentes> = {
    ...conAgenda(),
    ...conBorradores([{ id: 'b1', canal: 'correo', para: 'Ana', creado: hn(2026, 10, 8, 6) }]),
  };
  // El registro durable de mentira se pierde con el reinicio: la marca del cajón alcanza sola.
  await reloj({ ahora: () => hn(2026, 10, 8, 8, 30), personas: [a], fuentes, salidas, unaVez: new Set() }).vuelta();
  assert.deepEqual(salidas.map((s) => s.texto.slice(0, 12)), ['Buenos días.', 'Tienes un bo']);
  D._olvidarIniciativaDia();
  const r2 = reloj({ ahora: () => hn(2026, 10, 8, 9, 30), personas: [a], fuentes, salidas, unaVez: new Set() });
  await r2.vuelta();
  assert.equal(salidas.length, 2, 'ni el resumen ni el mismo borrador otra vez');
  // Lo guardado en disco lo dice.
  const e = await D.leerDia(a);
  assert.equal(e.resumenFecha, '2026-10-08');
  assert.equal(e.empujones.length, 1);
  assert.ok(e.claves['bor:b1']);
});

/* ── los empujones ───────────────────────────────────────────────────────────────────────── */

test('empujones: horas quietas (22:00–07:00 HN), 3 al día, 45 minutos entre uno y otro, y «hoy no»', async () => {
  const p = D.prefsEfectivas({}, { dueno: true });
  const e = { empujones: [] as any[], hoyNo: undefined as string | undefined };
  assert.deepEqual(D.decidirEmpujon(e, p, hn(2026, 10, 8, 22, 5)), { ok: false, porque: 'quietas' });
  assert.deepEqual(D.decidirEmpujon(e, p, hn(2026, 10, 8, 6, 59)), { ok: false, porque: 'quietas' });
  assert.deepEqual(D.decidirEmpujon(e, p, hn(2026, 10, 8, 7, 0)), { ok: true });
  e.empujones.push({ t: hn(2026, 10, 8, 9), clave: 'x1', tipo: 'evento', texto: '' });
  assert.deepEqual(D.decidirEmpujon(e, p, hn(2026, 10, 8, 9, 44)), { ok: false, porque: 'espaciado' });
  assert.deepEqual(D.decidirEmpujon(e, p, hn(2026, 10, 8, 9, 45)), { ok: true });
  e.empujones.push({ t: hn(2026, 10, 8, 10), clave: 'x2', tipo: 'evento', texto: '' }, { t: hn(2026, 10, 8, 11), clave: 'x3', tipo: 'evento', texto: '' });
  assert.deepEqual(D.decidirEmpujon(e, p, hn(2026, 10, 8, 15)), { ok: false, porque: 'tope' });
  // El tope es del día de Honduras: a las 7:00 del 9 vuelve a haber.
  assert.deepEqual(D.decidirEmpujon(e, p, hn(2026, 10, 9, 7)), { ok: true });
  assert.deepEqual(D.decidirEmpujon({ ...e, hoyNo: '2026-10-09' }, p, hn(2026, 10, 9, 12)), { ok: false, porque: 'hoy_no' });
  assert.deepEqual(D.decidirEmpujon({ empujones: [] }, D.prefsEfectivas({ empujones: false }, { dueno: true }), hn(2026, 10, 9, 12)), { ok: false, porque: 'apagado' });
  assert.deepEqual(D.decidirEmpujon({ empujones: [] }, D.prefsEfectivas({}, { dueno: false }), hn(2026, 10, 9, 12)), { ok: false, porque: 'apagado' });
});

test('empujones con el reloj: el tope y el espaciado se cumplen aunque haya mucho que decir, y nada en horas quietas', async () => {
  const a = cuenta();
  await D.cambiarPrefsDia(a, { activa: true, resumen: false }, hn(2026, 10, 8, 6));
  const bs = Array.from({ length: 8 }, (_, i) => ({ id: `b${i}`, canal: 'correo' as const, para: `Persona ${i}`, creado: hn(2026, 10, 8, 0) }));
  const salidas: Salida[] = [];
  let t = hn(2026, 10, 8, 6, 0);
  const r = reloj({ ahora: () => t, personas: [a], fuentes: conBorradores(bs), salidas });
  // Un día entero, una vuelta cada 5 minutos.
  for (; t < hn(2026, 10, 9, 6, 0); t += 5 * MIN) await r.empujonPara(a);
  assert.equal(salidas.length, 3, 'tres al día');
  const e = await D.leerDia(a);
  const ts = e.empujones.map((x) => x.t).sort((x, y) => x - y);
  assert.equal(ts[0], hn(2026, 10, 8, 7, 0), 'el primero al terminar las horas quietas');
  for (let i = 1; i < ts.length; i++) assert.ok(ts[i] - ts[i - 1] >= 45 * MIN, 'nunca dos en menos de 45 minutos');
  assert.ok(ts.every((x) => x < hn(2026, 10, 8, 22)), 'nada en horas quietas');
  assert.equal(new Set(salidas.map((s) => s.texto)).size, 3, 'cada uno de algo distinto');
});

test('«no me molestes hoy» pausa el día (y mañana vuelve); «para» a secas solo calla la voz: no pausa nada', async () => {
  const a = cuenta();
  await D.cambiarPrefsDia(a, { activa: true, resumen: false }, hn(2026, 10, 8, 6));
  const salidas: Salida[] = [];
  let t = hn(2026, 10, 8, 9);
  const bs = [1, 2, 3].map((i) => ({ id: `p${i}`, canal: 'whatsapp' as const, para: `Persona ${i}`, creado: hn(2026, 10, 8, 0) }));
  const r = reloj({ ahora: () => t, personas: [a], fuentes: conBorradores(bs), salidas });
  assert.equal((await r.empujonPara(a)).salio, true);
  // Revisión de la tanda F: «para» a secas a los 5 minutos del empujón NO es de la iniciativa (calla la voz y nada más).
  assert.equal(await S.ordenIniciativaDia(a, 'Para.', t + 5 * MIN), null);
  assert.equal(await S.ordenIniciativaDia(a, 'basta', t + 5 * MIN), null);
  await new Promise((ok) => setTimeout(ok, 30));
  assert.equal((await D.leerDia(a)).hoyNo, undefined, 'el «para» no pausó nada en silencio');
  assert.equal(await D.hoyNoActivo(a, t + 6 * MIN), false);
  // «No me molestes hoy» dicho: se guarda y se contesta la verdad (lo urgente de un VIP todavía puede llegar).
  t = hn(2026, 10, 8, 10);
  const o = await S.ordenIniciativaDia(a, 'No me molestes hoy, porfa', t);
  assert.equal(o!.decir, 'Listo, hoy no te busco. Solo te aviso si algo urgente de tus contactos importantes.');
  assert.equal((await D.leerDia(a)).hoyNo, '2026-10-08');
  assert.equal(await D.hoyNoActivo(a, t), true);
  t = hn(2026, 10, 8, 14);
  assert.equal((await r.empujonPara(a)).porque, 'hoy_no');
  t = hn(2026, 10, 9, 9);
  assert.equal(await D.hoyNoActivo(a, t), false);
  assert.equal((await r.empujonPara(a)).salio, true, 'mañana vuelve');
});

test('«hoy no» es durable entre procesos: otro proceso (con su caché vieja) lo lee del registro durable', async () => {
  const a = cuenta();
  const t = hn(2026, 10, 8, 10);
  await D.cambiarPrefsDia(a, { activa: true, resumen: false }, hn(2026, 10, 8, 6));
  // El «otro proceso» ya tenía el cajón en caché sin el «hoy no».
  const e = await D.leerDia(a);
  assert.equal(e.hoyNo, undefined);
  await D.pausarHoy(a, t);
  // Se simula su caché vieja: el cajón vuelve sin «hoy no» (lo que vería el proceso que no lo escribió)...
  const archivo = path.join(process.env.ULTRON_INICIATIVA_DIA_DIR!, `${crypto.createHash('sha256').update(`iniciativa-dia:${a}`).digest('hex').slice(0, 40)}.json`);
  const j = JSON.parse(fs.readFileSync(archivo, 'utf8'));
  assert.equal(j.hoyNo, '2026-10-08');
  delete j.hoyNo;
  fs.writeFileSync(archivo, JSON.stringify(j));
  D._olvidarIniciativaDia();
  assert.equal((await D.leerDia(a)).hoyNo, undefined, 'su cajón no lo sabe');
  // ...pero el registro durable sí: ni empujones, ni avisos, ni la iniciativa de siempre.
  assert.equal(await D.hoyNoActivo(a, t + MIN), true);
  const salidas: Salida[] = [];
  const r = reloj({ ahora: () => t + 60 * MIN, personas: [a], fuentes: conBorradores([{ id: 'zz', canal: 'correo', para: 'Ana', creado: hn(2026, 10, 8, 0) }]), salidas });
  assert.equal((await r.empujonPara(a)).porque, 'hoy_no');
  assert.equal(salidas.length, 0);
});

test('qué merece un empujón: un evento en 15 minutos con lugar o enlace; lo que espera su «sí» hace 2 horas; lo prometido', () => {
  const ahora = hn(2026, 10, 8, 10);
  const c = D.candidatosEmpujon(
    {
      eventos: [
        { id: 'sin', titulo: 'Bloque de foco', inicio: ahora + 10 * MIN },
        { id: 'meet', titulo: 'Llamada con Ana', inicio: ahora + 12 * MIN, reunion: 'https://meet.google.com/abc-defg-hij' },
        { id: 'lejos', titulo: 'Almuerzo', inicio: ahora + 40 * MIN, lugar: 'Café' },
        { id: 'dia', titulo: 'Feriado', inicio: ahora + 5 * MIN, todoElDia: true, lugar: 'x' },
        { id: 'zoom', titulo: 'Junta', inicio: ahora + 14 * MIN, lugar: 'https://us02web.zoom.us/j/123' },
      ],
      abiertos: [
        // Un «borrador» que la conversación detectó con reglas (lib/abiertos.ts) ya no se empuja: pudo haber salido.
        { id: 'regla', texto: 'Borrador sin mandar: Hola Ana, te paso el informe', tipo: 'borrador', estado: 'abierto', creado: ahora - 5 * H },
        { id: 'pr', texto: 'Te aviso cuando llegue el contrato', tipo: 'promesa_aura', estado: 'abierto', creado: ahora - 2 * H },
        { id: 'vieja', texto: 'Te aviso del vuelo', tipo: 'promesa_aura', estado: 'abierto', creado: ahora - 5 * 86_400_000 },
        { id: 'hecha', texto: 'Te aviso de algo', tipo: 'promesa_aura', estado: 'hecho', creado: ahora - 2 * H },
      ],
      // Los borradores de la decisión abierta de verdad: el que espera hace 2 horas, sí; el reciente y el vencido, no.
      borradores: [
        { id: 'b1', canal: 'correo', para: 'Ana Paz (ana@ejemplo.org)', creado: ahora - 2 * H - MIN },
        { id: 'b2', canal: 'whatsapp', para: 'Beto', creado: ahora - H },
        { id: 'b3', canal: 'whatsapp', para: 'Caro', creado: ahora - 5 * H, caduca: ahora - MIN },
      ],
      propuesta: { id: 'iq1', texto: '¿Repasamos tu misión?', creada: ahora - 5 * H, entregada: ahora - 3 * H },
    },
    ahora
  );
  assert.deepEqual(
    c.map((x) => x.clave),
    [`cal:meet@${ahora + 12 * MIN}`, `cal:zoom@${ahora + 14 * MIN}`, 'bor:b1', 'prop:iq1', 'prom:pr']
  );
  assert.match(c[0].texto, /^En 12 minutos empieza «Llamada con Ana», con enlace de llamada\. ¿Quieres que/);
  // Revisión de la tanda F (B3): sin «No salió nada»; solo a quién (sin la dirección ni el texto del borrador).
  assert.equal(c[2].texto, 'Tienes un borrador esperando tu «sí»: el correo para Ana Paz. ¿Lo revisamos?');
  assert.deepEqual(c[2].borrador, { id: 'b1', canal: 'correo' });
  assert.ok(c.every((x) => !/No salió nada/.test(x.texto)));
  assert.match(c[4].texto, /Quedó pendiente algo que te ofrecí: «cuando llegue el contrato»\. ¿Quieres que lo veamos ahora\?/);
  // Lo ya empujado no vuelve.
  assert.deepEqual(D.candidatosEmpujon({ borradores: [{ id: 'b1', canal: 'correo', para: 'Ana', creado: 0 }] }, ahora, { 'bor:b1': ahora - H }), []);
});

test('B3: un borrador que ya salió (con recibo de envío) no se empuja; uno sin recibo, sí; sin poder saberlo, tampoco', async () => {
  const a = cuenta();
  const t0 = hn(2026, 10, 8, 6);
  await D.cambiarPrefsDia(a, { activa: true, resumen: false }, t0);
  const { enviarUnaVez, operacionDeBorrador, reciboDeBorrador } = await import('../lib/envios');
  // El borrador «b-salio» se aprobó y salió por el panel: su operación de envío tiene recibo (lib/envios.ts).
  const r = await enviarUnaVez({ canal: 'whatsapp', dueno: a, operacion: operacionDeBorrador('whatsapp', 'b-salio'), huella: 'h1', efecto: async () => ({ estado: 'succeeded', referencia: 'wamid-1' }), reconciliar: async () => ({ encontrado: false }) });
  assert.equal(r.estado, 'succeeded');
  assert.equal(await reciboDeBorrador('whatsapp', a, 'b-salio'), 'hay');
  assert.equal(await reciboDeBorrador('whatsapp', a, 'b-espera'), 'ninguno');
  // La decisión de «b-salio» sigue abierta en la lista (no se cerró): aun así, no se empuja.
  const lista = [{ id: 'b-salio', canal: 'whatsapp' as const, para: 'Ana', creado: t0 - 4 * H }];
  const salidas: Salida[] = [];
  const fuentes: Partial<Fuentes> = { borradores: async () => lista, reciboEnvio: async (c, canal, id) => reciboDeBorrador(canal, c, id) };
  const reloj1 = reloj({ ahora: () => hn(2026, 10, 8, 9), personas: [a], fuentes, salidas });
  assert.equal((await reloj1.empujonPara(a)).porque, 'nada');
  assert.equal(salidas.length, 0, 'no sale «tienes un borrador esperando» de algo que ya salió');
  // Ni en el resumen.
  const m = await S.materialDelDia(a, { ...vacias(), ...fuentes }, D.prefsEfectivas({ activa: true }, { dueno: false }), hn(2026, 10, 8, 9));
  assert.deepEqual(m.borradores, []);
  // Uno que de verdad espera (sin recibo): sí, con el texto nuevo.
  lista.push({ id: 'b-espera', canal: 'whatsapp', para: 'Beto', creado: t0 - 4 * H });
  const e = await reloj1.empujonPara(a);
  assert.equal(e.salio, true);
  assert.equal(e.texto, 'Tienes un borrador esperando tu «sí»: el WhatsApp para Beto. ¿Lo revisamos?');
  // Sin poder mirar los recibos (el almacén no contesta, o sin esa fuente): no se empuja.
  const b = cuenta();
  await D.cambiarPrefsDia(b, { activa: true, resumen: false }, t0);
  const s2: Salida[] = [];
  const bs = [{ id: 'b-x', canal: 'correo' as const, para: 'Caro', creado: t0 - 4 * H }];
  assert.equal((await reloj({ ahora: () => hn(2026, 10, 8, 9), personas: [b], fuentes: { borradores: async () => bs, reciboEnvio: async () => 'incierto' }, salidas: s2 }).empujonPara(b)).porque, 'nada');
  assert.equal((await reloj({ ahora: () => hn(2026, 10, 8, 9), personas: [b], fuentes: { borradores: async () => bs }, salidas: s2 }).empujonPara(b)).porque, 'nada');
  assert.equal(s2.length, 0);
});

test('B3: los borradores salen de la decisión abierta de verdad (tareas en awaiting_approval ligadas a un borrador)', () => {
  const ahora = hn(2026, 10, 8, 10);
  const dec = (o: Record<string, unknown> = {}) => ({ creada: ahora - 3 * H, caduca: ahora + H, propuesta: { destinatario: 'Ana' }, vinculo: { tipo: 'borrador', canal: 'correo', intento: 'i1' }, ...o });
  const lista = {
    ok: true as const,
    tareas: [
      { estado: 'awaiting_approval', decision: dec() },
      { estado: 'succeeded', decision: dec({ vinculo: { tipo: 'borrador', canal: 'correo', intento: 'i2' } }) },
      { estado: 'awaiting_approval', decision: dec({ vinculo: { tipo: 'taller', intento: 'i3' } }) },
      { estado: 'awaiting_approval', decision: dec({ caduca: ahora - 1, vinculo: { tipo: 'borrador', canal: 'whatsapp', intento: 'i4' } }) },
      { estado: 'awaiting_approval', decision: dec({ pospuestaHasta: ahora + H, vinculo: { tipo: 'borrador', canal: 'whatsapp', intento: 'i5' } }) },
      { estado: 'awaiting_approval', decision: null },
    ],
  };
  assert.deepEqual(S.borradoresEsperando(lista, ahora), [{ id: 'i1', canal: 'correo', para: 'Ana', creado: ahora - 3 * H, caduca: ahora + H }]);
  assert.deepEqual(S.borradoresEsperando({ ok: false }, ahora), [], 'sin poder leerla, ninguno (nunca se adivina)');
});

/* ── la honestidad ───────────────────────────────────────────────────────────────────────── */

test('honestidad: cada empujón y el resumen PROPONEN; nunca dicen que algo se hizo; lo que el modelo diga de más se descarta', async () => {
  const ahora = hn(2026, 10, 8, 10);
  const textos = D.candidatosEmpujon(
    {
      eventos: [{ id: 'e', titulo: 'Cita con el notario', inicio: ahora + 10 * MIN, lugar: 'Col. Palmira' }],
      abiertos: [{ id: 'p', texto: 'Te aviso cuando Carlos conteste', tipo: 'promesa_aura', estado: 'abierto', creado: ahora - 2 * H }],
      borradores: [{ id: 'b', canal: 'whatsapp', para: 'Ana', creado: ahora - 3 * H }],
      propuesta: { id: 'q', texto: 'Ya te mandé el resumen por correo', creada: 0, entregada: ahora - 3 * H },
    },
    ahora
  ).map((c) => c.texto);
  assert.equal(textos.length, 4);
  for (const t of textos) {
    assert.ok(D.textoHonesto(t), `honesto: ${t}`);
    assert.match(t, /(¿Quieres que [^?]+|¿Lo revisamos)\?$/, `termina en una propuesta: ${t}`);
    assert.doesNotMatch(t, /No salió nada/);
  }
  // El modelo: si dice que hizo algo (o promete hacerlo), se descarta y sale el armado a mano.
  const m = { eventos: [{ id: 'e', titulo: 'Reunión con Ana', inicio: hn(2026, 10, 8, 9) }], recordatorios: [], mensajes: [], abiertos: [], misiones: [], zona: 'America/Tegucigalpa' };
  for (const malo of ['Buenos días. Ya te mandé el correo a Ana y quedó agendada la reunión.', 'Buenos días. Voy a revisar tus correos y te aviso.', 'ok', '']) {
    const r = await D.redactarResumen(m, { redactor: async () => malo });
    assert.equal(r.generado, false, malo);
    assert.equal(r.texto, D.resumenDeterminista(m));
  }
  const bueno = await D.redactarResumen(m, { redactor: async () => '[EMO:alegre] Buenos días. A las 9:00 tienes la reunión con Ana. ¿Quieres que la repasemos?' });
  assert.ok(bueno.generado);
  assert.equal(bueno.texto, 'Buenos días. A las 9:00 tienes la reunión con Ana. ¿Quieres que la repasemos?');
  // Un modelo que tarda demasiado no deja el resumen esperando.
  const lento = await D.redactarResumen(m, { redactor: () => new Promise((ok) => setTimeout(() => ok('Buenos días, tarde.'), 500)), topeMs: 30 });
  assert.equal(lento.generado, false);
  assert.ok(D.textoHonesto(D.resumenDeterminista(m)));
});

/* ── «llámame» ───────────────────────────────────────────────────────────────────────────── */

test('«llámame» con el resumen: llamada fuera de las horas quietas; en ellas, o si la llamada no sale, el aviso', async () => {
  const a = cuenta();
  await D.cambiarPrefsDia(a, { activa: true, llamarResumen: true }, hn(2026, 10, 8, 6));
  const salidas: Salida[] = [];
  await reloj({ ahora: () => hn(2026, 10, 8, 7, 30), personas: [a], fuentes: conAgenda(), salidas }).vuelta();
  assert.deepEqual(salidas.map((s) => s.tipo), ['llamada']);
  assert.ok(salidas[0].texto.length <= 300, 'el motivo de la llamada cabe');
  // A las 6:30 (dentro de 22:00–07:00): aviso, no llamada.
  const b = cuenta();
  await D.cambiarPrefsDia(b, { activa: true, llamarResumen: true, horaResumen: '06:30' }, hn(2026, 10, 8, 5));
  const s2: Salida[] = [];
  await reloj({ ahora: () => hn(2026, 10, 8, 6, 30), personas: [b], fuentes: conAgenda(), salidas: s2 }).vuelta();
  assert.deepEqual(s2.map((s) => s.tipo), ['aviso']);
  // La llamada no sale (sin teléfono que conteste): el aviso de siempre.
  const c = cuenta();
  await D.cambiarPrefsDia(c, { activa: true, llamarResumen: true }, hn(2026, 10, 8, 6));
  const s3: Salida[] = [];
  await reloj({ ahora: () => hn(2026, 10, 8, 7, 30), personas: [c], fuentes: conAgenda(), salidas: s3, llamadaSale: false }).vuelta();
  assert.deepEqual(s3.map((s) => s.tipo), ['aviso']);
});

test('«llámame» con un VIP urgente: llama si lo eligió (fuera de horas quietas y sin «hoy no»); si no, el aviso', async () => {
  const a = cuenta();
  const DIEZ = hn(2026, 10, 8, 10);
  const llamadas: any[] = [];
  const pushes: any[] = [];
  let ahora = DIEZ;
  A._olvidarAlertas();
  A._alertasDePrueba({
    vips: async () => [{ nombre: 'Ana Paz', numero: '50499991111', t: 0 }],
    circulo: async () => [],
    laya: async () => null,
    push: async (c, d) => (pushes.push({ c, d }), { enviados: 1, entrega: 'aceptado' as const }),
    llamar: async (c, o) => (llamadas.push({ c, o }), { enviados: 1, entrega: 'aceptado' as const }),
    primeraVez: async () => true,
    apagado: async () => false,
    ahora: () => ahora,
  });
  const ev = (id: string, texto: string) => ({ canal: 'whatsapp' as const, id, chat: `${id}@s.whatsapp.net`, nombre: 'Ana Paz', numero: '+50499991111', grupo: false, hora: ahora, texto });
  try {
    // Sin elegirlo: aviso.
    assert.equal((await A.alertarSiImporta(a, ev('m1', 'Llámame, es urgente'), 'wa-alerta')).avisado, true);
    assert.equal(llamadas.length, 0);
    await D.cambiarPrefsDia(a, { activa: true, llamarVip: true }, DIEZ);
    const r = await A.alertarSiImporta(a, ev('m2', 'Es urgente, contéstame'), 'wa-alerta');
    assert.match(r.porque, /^llamada/);
    assert.equal(llamadas.length, 1);
    assert.match(llamadas[0].o.motivo, /^Urgente · WhatsApp · Ana Paz\. Ana Paz: «Es urgente/);
    // Algo no urgente del mismo VIP: aviso, no llamada.
    await A.alertarSiImporta(a, ev('m3', 'Hola, ¿cómo estás?'), 'wa-alerta');
    assert.equal(llamadas.length, 1);
    // En horas quietas: el urgente del VIP sale (como siempre) pero como aviso, no como llamada.
    ahora = hn(2026, 10, 8, 23, 30);
    A._olvidarAlertas();
    await A.alertarSiImporta(a, ev('m4', 'Urgente, llámame'), 'wa-alerta');
    assert.equal(llamadas.length, 1);
    // «No me molestes hoy»: tampoco llama.
    ahora = hn(2026, 10, 9, 10);
    await D.pausarHoy(a, ahora);
    A._olvidarAlertas();
    await A.alertarSiImporta(a, ev('m5', 'Urgente, llámame'), 'wa-alerta');
    assert.equal(llamadas.length, 1);
    // «Ya no me llames» por voz: lo apaga.
    await D.pausarHoy(a, ahora, { quitar: true });
    const o = await S.ordenIniciativaDia(a, 'Ya no me llames', ahora);
    assert.match(o!.decir, /ya no te llamo/);
    A._olvidarAlertas();
    await A.alertarSiImporta(a, ev('m6', 'Urgente, llámame'), 'wa-alerta');
    assert.equal(llamadas.length, 1);
    assert.equal(pushes.length, 5);
  } finally {
    A._alertasDePrueba(null);
  }
});

test('B4: «no me molestes hoy» calla los avisos de mensajes que no son urgentes de un VIP; lo urgente de un VIP pasa (sin llamada)', async () => {
  const a = cuenta();
  let ahora = hn(2026, 10, 8, 10);
  const pushes: any[] = [];
  const llamadas: any[] = [];
  A._olvidarAlertas();
  A._alertasDePrueba({
    vips: async () => [{ nombre: 'Ana Paz', numero: '50499991111', t: 0 }],
    circulo: async () => [{ id: 'c1', nombre: 'Mamá', alias: [], relacion: 'madre' as const, canales: { whatsapp: '+50488882222' }, permisos: { recordatorios: 'preguntar', mensajes: 'preguntar' }, creado: 0, actualizado: 0 }],
    laya: async () => null,
    push: async (c, d) => (pushes.push({ c, d }), { enviados: 1, entrega: 'aceptado' as const }),
    llamar: async (c, o) => (llamadas.push({ c, o }), { enviados: 1, entrega: 'aceptado' as const }),
    primeraVez: async () => true,
    apagado: async () => false,
    ahora: () => ahora,
  });
  const ev = (id: string, nombre: string, numero: string, texto: string) => ({ canal: 'whatsapp' as const, id, chat: `${id}@s.whatsapp.net`, nombre, numero, grupo: false, hora: ahora, texto });
  try {
    await D.cambiarPrefsDia(a, { activa: true, llamarVip: true }, ahora);
    const o = await S.ordenIniciativaDia(a, 'no me molestes hoy', ahora);
    assert.equal(o!.decir, 'Listo, hoy no te busco. Solo te aviso si algo urgente de tus contactos importantes.');
    // Un VIP sin urgencia: hoy, nada.
    assert.deepEqual([(await A.alertarSiImporta(a, ev('h1', 'Ana Paz', '+50499991111', 'Hola, ¿cómo estás?'), 'wa-alerta')).porque], ['hoy_no']);
    // Alguien del círculo con algo urgente (no es VIP): hoy, nada.
    assert.equal((await A.alertarSiImporta(a, ev('h2', 'Mamá', '+50488882222', 'Es urgente, llámame'), 'wa-alerta')).avisado, false);
    assert.equal(pushes.length, 0);
    // Lo urgente de un VIP sí pasa, como aviso (hoy tampoco llama).
    const u = await A.alertarSiImporta(a, ev('h3', 'Ana Paz', '+50499991111', 'Urgente, contéstame'), 'wa-alerta');
    assert.equal(u.avisado, true);
    assert.equal(pushes.length, 1);
    assert.equal(llamadas.length, 0);
    // Mañana vuelve todo.
    ahora = hn(2026, 10, 9, 10);
    A._olvidarAlertas();
    assert.equal((await A.alertarSiImporta(a, ev('h4', 'Ana Paz', '+50499991111', 'Hola, ¿cómo estás?'), 'wa-alerta')).avisado, true);
  } finally {
    A._alertasDePrueba(null);
  }
});

test('llamadas por un VIP urgente: como mucho 2 al día; la tercera, el aviso de siempre', async () => {
  const a = cuenta();
  let ahora = hn(2026, 10, 8, 10);
  const pushes: any[] = [];
  const llamadas: any[] = [];
  A._olvidarAlertas();
  A._alertasDePrueba({
    vips: async () => [{ nombre: 'Ana Paz', numero: '50499991111', t: 0 }],
    circulo: async () => [],
    laya: async () => null,
    push: async (c, d) => (pushes.push({ c, d }), { enviados: 1, entrega: 'aceptado' as const }),
    llamar: async (c, o) => (llamadas.push({ c, o }), { enviados: 1, entrega: 'aceptado' as const }),
    primeraVez: async () => true,
    apagado: async () => false,
    ahora: () => ahora,
  });
  const ev = (id: string) => ({ canal: 'whatsapp' as const, id, chat: `${id}@s.whatsapp.net`, nombre: 'Ana Paz', numero: '+50499991111', grupo: false, hora: ahora, texto: 'Urgente, llámame' });
  try {
    await D.cambiarPrefsDia(a, { activa: true, llamarVip: true }, ahora);
    assert.equal(D.TOPE_LLAMADAS_VIP_DIA, 2);
    for (const [i, id] of ['v1', 'v2', 'v3'].entries()) {
      ahora = hn(2026, 10, 8, 10 + i);
      A._olvidarAlertas();
      await A.alertarSiImporta(a, ev(id), 'wa-alerta');
    }
    assert.equal(llamadas.length, 2, 'dos llamadas');
    assert.equal(pushes.length, 1, 'la tercera, aviso');
    // Al día siguiente vuelve a haber.
    ahora = hn(2026, 10, 9, 10);
    A._olvidarAlertas();
    await A.alertarSiImporta(a, ev('v4'), 'wa-alerta');
    assert.equal(llamadas.length, 3);
  } finally {
    A._alertasDePrueba(null);
  }
});

/* ── la voz ──────────────────────────────────────────────────────────────────────────────── */

/**
 * Revisión de la tanda F (B1): frases de todos los días que NO son órdenes de la iniciativa (antes varias secuestraban el
 * turno: movían el resumen, lo apagaban, pausaban el día o apagaban las llamadas).
 */
const NO_SON_ORDENES = [
  // las de la revisión
  'Mándame el resumen del informe a las 3',
  'Pon un recordatorio a las 8 para leer el resumen',
  'quita el resumen del documento',
  'no me mandes el resumen por correo, mándamelo por WhatsApp',
  'Escríbele a Pedro: hoy no me llames',
  'dile a Ana por WhatsApp: no me molestes hoy',
  'no quiero avisos de Pedro',
  'mándale a Carlos que ya no me llames más',
  // otro resumen, o sin decir cuál
  'Mándame el resumen de la reunión a las 9',
  'Mándame el resumen a las 7',
  'hazme un resumen de este documento',
  'no me mandes el resumen del contrato',
  'cancela el resumen de la junta',
  'el resumen de la mañana estuvo muy bueno',
  '¿a qué hora me llega el resumen de la mañana?',
  '¿por qué no me mandaste el resumen de la mañana?',
  // una hora que no es de la mañana sin decirlo
  'Mándame el resumen de la mañana a las 3',
  'ponme el resumen del día a las 12',
  'mi resumen diario a la una',
  // recordatorios, agenda y alarmas
  'recuérdame a las 8 mandar el resumen de la mañana',
  'agenda una cita a las 10 para revisar mi resumen diario',
  'ponme una alarma a las 6 para el resumen de la mañana',
  'llámame a las 7',
  // dictados para otra persona
  'contéstale a Luis que no me molestes hoy',
  'avísale a mi mamá que hoy no me llamen',
  'pregúntale a Sofía si me manda el resumen de la mañana a las 7',
  'dile a Juan que deje de llamarme',
  'escríbele por correo a Marta: ya no me mandes el resumen diario',
  'mándale el resumen a Ana a las 7 por correo ya',
  'mándale un mensaje a Beto: no me molestes',
  // charla
  '¿qué tengo hoy?',
  'no me molestes con eso que te dije ayer de la reunión del banco',
  'no me molestes tanto con preguntas',
  'déjame en paz con ese tema',
  'no quiero avisos de esa tienda',
  'Ana dice que no la llames más',
  'hoy no me llamó nadie',
  'no me llames',
  // «para» a secas: calla la voz y nada más
  'para',
  'basta',
  'ya basta',
];

test('B1: la voz NO toma como orden de la iniciativa lo que no lo es (dictados, recordatorios, otro resumen, horas ambiguas)', async () => {
  assert.ok(NO_SON_ORDENES.length >= 25, String(NO_SON_ORDENES.length));
  for (const nada of NO_SON_ORDENES) assert.equal(D.comandoIniciativa(nada), null, `no es orden: «${nada}» → ${JSON.stringify(D.comandoIniciativa(nada))}`);
  // Y con el turno entero: no contesta ni toca nada.
  const a = cuenta();
  const t = hn(2026, 10, 8, 10);
  await D.cambiarPrefsDia(a, { activa: true }, hn(2026, 10, 8, 6));
  const antes = JSON.stringify(await D.leerDia(a));
  for (const nada of NO_SON_ORDENES) assert.equal(await S.ordenIniciativaDia(a, nada, t), null, nada);
  assert.equal(JSON.stringify(await D.leerDia(a)), antes, 'nada cambió');
  assert.equal(await D.hoyNoActivo(a, t), false);
});

test('B1: las órdenes de verdad siguen siéndolo', () => {
  const SI: Array<[string, unknown]> = [
    ['Mándame el resumen de la mañana a las 7', { tipo: 'hora_resumen', hora: '07:00', encender: false }],
    ['mándame el resumen del día a las siete y media', { tipo: 'hora_resumen', hora: '07:30', encender: false }],
    ['cambia mi resumen diario a las 6:45 de la mañana', { tipo: 'hora_resumen', hora: '06:45', encender: false }],
    ['quiero el resumen de la mañana a las 8 y cuarto', { tipo: 'hora_resumen', hora: '08:15', encender: false }],
    ['el resumen de la mañana a las 6 a. m.', { tipo: 'hora_resumen', hora: '06:00', encender: false }],
    ['Oye AURA, mi resumen a las 9, porfa', { tipo: 'hora_resumen', hora: '09:00', encender: false }],
    ['pon el resumen de la mañana a las 5 de la tarde', { tipo: 'hora_resumen', hora: '17:00', encender: false }],
    ['a las 7 mándame el resumen de la mañana', { tipo: 'hora_resumen', hora: '07:00', encender: false }],
    ['cambia la hora de mi resumen diario a las 8', { tipo: 'hora_resumen', hora: '08:00', encender: false }],
    ['enciende el resumen de la mañana a las 7', { tipo: 'hora_resumen', hora: '07:00', encender: true }],
    ['enciende mi resumen diario', { tipo: 'encender_resumen' }],
    ['No me molestes hoy', { tipo: 'hoy_no' }],
    ['No me molestes hoy, porfa', { tipo: 'hoy_no' }],
    ['no me molestes', { tipo: 'hoy_no' }],
    ['hoy no me avises de nada', { tipo: 'hoy_no' }],
    ['para de avisarme', { tipo: 'hoy_no' }],
    ['déjame tranquilo por hoy', { tipo: 'hoy_no' }],
    ['no quiero más avisos por hoy', { tipo: 'hoy_no' }],
    ['Ya no me llames', { tipo: 'no_llames' }],
    ['no me vuelvas a llamar', { tipo: 'no_llames' }],
    ['deja de llamarme', { tipo: 'no_llames' }],
    ['no me mandes más el resumen de la mañana', { tipo: 'sin_resumen' }],
    ['quita mi resumen diario', { tipo: 'sin_resumen' }],
    ['apaga el resumen del día', { tipo: 'sin_resumen' }],
  ];
  for (const [frase, esperado] of SI) assert.deepEqual(D.comandoIniciativa(frase), esperado, frase);
});

test('B1: la hora del resumen no enciende la iniciativa de quien no es dueña (salvo «enciende»); en horas quietas, lo confirma', async () => {
  // Una cuenta que NO es dueña, con la iniciativa apagada: guarda la hora, no la enciende, y lo dice.
  const a = cuenta();
  const o = await S.ordenIniciativaDia(a, 'Mándame el resumen de la mañana a las 7', hn(2026, 10, 8, 6));
  assert.match(o!.decir, /^Guardé las 7:00 para tu resumen de la mañana, pero tu iniciativa del día está apagada/);
  let p = await D.prefsDia(a);
  assert.equal(p.activa, false, 'cambiar la hora no la enciende');
  assert.equal(p.horaResumen, '07:00');
  // «Enciende…»: ahora sí.
  const e = await S.ordenIniciativaDia(a, 'enciende mi resumen de la mañana', hn(2026, 10, 8, 6, 5));
  assert.equal(e!.decir, 'Listo: tu resumen de la mañana queda encendido; te llega a las 7:00.');
  p = await D.prefsDia(a);
  assert.ok(p.activa && p.resumen);
  // La dueña (encendida por omisión): la hora, sin más.
  const d = nuevaDuena();
  assert.equal((await S.ordenIniciativaDia(d, 'Mándame el resumen de la mañana a las 7', hn(2026, 10, 8, 6)))!.decir, 'Listo: el resumen te llega a las 7:00.');
  // Dicho a las 9: hoy ya pasó, empieza mañana (y lo dice).
  const d2 = nuevaDuena();
  assert.equal((await S.ordenIniciativaDia(d2, 'mándame el resumen de la mañana a las 7', hn(2026, 10, 8, 9)))!.decir, 'Listo: el resumen te llega a las 7:00, desde mañana.');
  // Una hora DENTRO de sus horas quietas (22:00–7:00), elegida a sabiendas: se respeta y se confirma en voz alta.
  const d3 = nuevaDuena();
  const q = await S.ordenIniciativaDia(d3, 'el resumen de la mañana a las 6 a. m.', hn(2026, 10, 8, 4));
  assert.equal(q!.decir, 'Listo: el resumen te llega a las 6:00. Ojo: esa hora cae en tus horas quietas (de 22:00 a 7:00); como la elegiste tú, te lo mando a esa hora.');
  const s3: Salida[] = [];
  await reloj({ ahora: () => hn(2026, 10, 8, 6, 0), personas: [d3], fuentes: conAgenda(), salidas: s3 }).vuelta();
  assert.equal(s3.length, 1, 'sale a las 6:00 porque la eligió');
});

test('el resumen respeta las horas quietas: una hora que quedó dentro sin elegirla así espera a que terminen', async () => {
  const d = nuevaDuena();
  // La hora de siempre (7:30) y después alarga sus horas quietas hasta las 8:00.
  await D.cambiarPrefsDia(d, { quietas: { desde: '22:00', hasta: '08:00' } }, hn(2026, 10, 8, 5));
  const p = await D.prefsDia(d);
  const e = await D.leerDia(d);
  assert.equal(e.horaEnQuietas, undefined);
  assert.equal(D.momentoEfectivoResumen(e, p, '2026-10-08'), hn(2026, 10, 8, 8, 0));
  assert.deepEqual(D.tocaResumen(e, p, hn(2026, 10, 8, 7, 45)), { toca: false, porque: 'temprano' });
  assert.deepEqual(D.tocaResumen(e, p, hn(2026, 10, 8, 8, 0)), { toca: true, fecha: '2026-10-08' });
  const s: Salida[] = [];
  const r = reloj({ ahora: () => hn(2026, 10, 8, 7, 31), personas: [d], fuentes: conAgenda(), salidas: s });
  await r.vuelta();
  assert.equal(s.length, 0, 'a las 7:31 (dentro de sus quietas) no sale');
  // Una hora a media noche que no la eligió así: ese día no hay hueco antes de medianoche.
  assert.deepEqual(D.tocaResumen({}, D.prefsEfectivas({ horaResumen: '23:00' }, { dueno: true }), hn(2026, 10, 8, 23, 5)), { toca: false, porque: 'quietas' });
  assert.equal(D.horaCaeEnQuietas('06:00', { desde: '22:00', hasta: '07:00' }), true);
  assert.equal(D.horaCaeEnQuietas('07:00', { desde: '22:00', hasta: '07:00' }), false);
});

test('B2: con `hacer` (el turno especulativo) la orden no escribe nada hasta confirmarse; descartada, nunca', async () => {
  const { abrirEspeculativo } = await import('../server/turno-especulativo');
  const a = cuenta();
  const t = hn(2026, 10, 8, 10);
  await D.cambiarPrefsDia(a, { activa: true }, hn(2026, 10, 8, 6));
  // La frase a medias «no me molestes hoy…» se especula y se descarta (la persona siguió hablando).
  const e1 = abrirEspeculativo(`prueba-${a}-1`);
  const o1 = await S.ordenIniciativaDia(a, 'no me molestes hoy', t, { hacer: e1.retener.hacer });
  assert.ok(o1, 'contesta (el texto se adelanta)');
  assert.equal((await D.leerDia(a)).hoyNo, undefined, 'sin confirmar no escribe');
  assert.equal(await D.hoyNoActivo(a, t), false);
  (e1 as any).descartar('siguió hablando');
  await new Promise((ok) => setTimeout(ok, 30));
  assert.equal((await D.leerDia(a)).hoyNo, undefined, 'descartada, nunca');
  // La final confirmada: sí.
  const e2 = abrirEspeculativo(`prueba-${a}-2`);
  await S.ordenIniciativaDia(a, 'no me molestes hoy', t, { hacer: e2.retener.hacer });
  assert.equal((await D.leerDia(a)).hoyNo, undefined);
  (e2 as any).confirmar();
  await new Promise((ok) => setTimeout(ok, 50));
  assert.equal((await D.leerDia(a)).hoyNo, '2026-10-08');
  assert.equal(await D.hoyNoActivo(a, t), true);
  // Lo mismo con la hora del resumen.
  const e3 = abrirEspeculativo(`prueba-${a}-3`);
  await S.ordenIniciativaDia(a, 'Mándame el resumen de la mañana a las 8', t, { hacer: e3.retener.hacer });
  (e3 as any).descartar('siguió hablando');
  await new Promise((ok) => setTimeout(ok, 30));
  assert.equal((await D.prefsDia(a)).horaResumen, '07:30');
  // El cableado en server.ts: ordenDelDia le da a la orden el `retener.hacer` del turno (la voz de ElevenLabs y la mesa
  // especulativa), en los dos caminos (el JSON y el stream), y su memoria también va por `retener`.
  const src = fs.readFileSync(path.join(process.cwd(), 'server.ts'), 'utf8');
  assert.match(src, /ordenIniciativaDia\(correo, message, Date\.now\(\), opciones\.retener \? \{ hacer: opciones\.retener\.hacer \} : \{\}\)/);
  assert.equal((src.match(/await ordenDelDia\(body, opciones\)/g) || []).length, 2);
  assert.doesNotMatch(src, /await ordenDelDia\(body\)/);
});

/* ── el calendario: el enlace de la llamada ──────────────────────────────────────────────── */

test('el calendario trae el enlace de la llamada (Teams y Meet) para el empujón de 15 minutos', async () => {
  const traer = (async (url: string) => {
    const graph = String(url).includes('graph.microsoft.com');
    const cuerpo = graph
      ? { value: [{ id: 'g1', subject: 'Junta', start: { dateTime: '2026-10-08T16:00:00.0000000' }, end: { dateTime: '2026-10-08T17:00:00.0000000' }, onlineMeeting: { joinUrl: 'https://teams.microsoft.com/l/meetup-join/abc' } }] }
      : { items: [{ id: 'x1', summary: 'Llamada', start: { dateTime: '2026-10-08T10:00:00-06:00' }, end: { dateTime: '2026-10-08T10:30:00-06:00' }, conferenceData: { entryPoints: [{ entryPointType: 'video', uri: 'https://meet.google.com/abc-defg-hij' }] } }] };
    return new Response(JSON.stringify(cuerpo), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  const ms = await listarEventos('microsoft', 'tok', 0, 1, traer);
  assert.equal(ms[0].reunion, 'https://teams.microsoft.com/l/meetup-join/abc');
  const go = await listarEventos('google', 'tok', 0, 1, traer);
  assert.equal(go[0].reunion, 'https://meet.google.com/abc-defg-hij');
  assert.equal(D.enlaceDeReunion({ lugar: 'Sala 2 · https://us02web.zoom.us/j/999' }), 'https://us02web.zoom.us/j/999');
  assert.equal(D.enlaceDeReunion({ lugar: 'Oficina central' }), null);
});

/* ── las rutas ───────────────────────────────────────────────────────────────────────────── */

test('las rutas de Ajustes → Iniciativa: todo por la sesión, sin sesión 401, lo malo 400', async () => {
  const app = express();
  app.use(express.json());
  const pasa = () => ((_q: express.Request, _s: express.Response, nx: express.NextFunction) => nx()) as express.RequestHandler;
  let ahora = hn(2026, 10, 8, 6);
  S.montarRutasIniciativaDia(app, { exigirMesa, limitar: pasa, sesionDe, reloj: () => ahora });
  const srv = app.listen(0, '127.0.0.1');
  await new Promise((r) => srv.once('listening', r));
  const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
  try {
    const pedir = async (metodo: string, ruta: string, token?: string, body?: unknown) => {
      const r = await fetch(`${base}${ruta}`, { method: metodo, headers: { 'content-type': 'application/json', ...(token ? { 'x-ultron-sesion': token } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
      return { status: r.status, j: (await r.json()) as any };
    };
    const ca = cuenta();
    const ta = emitirSesion({ correo: ca, nombre: 'A', rol: 'Miembro' }, { comunidad: true }).token;
    const td = emitirSesion({ correo: DUENO, nombre: 'José', rol: 'Miembro' }, { comunidad: true }).token;
    assert.equal((await pedir('GET', '/api/iniciativa/dia')).status, 401);
    const g = await pedir('GET', '/api/iniciativa/dia', ta);
    assert.equal(g.status, 200);
    assert.equal(g.j.preferencias.activa, false, 'otra cuenta: apagada');
    assert.equal(g.j.dueno, false);
    assert.deepEqual(g.j.topes, { empujonesDia: 3, espacioMin: 45 });
    const gd = await pedir('GET', '/api/iniciativa/dia', td);
    assert.equal(gd.j.preferencias.activa, true, 'la dueña: encendida');
    const c = await pedir('POST', '/api/iniciativa/dia', ta, { activa: true, horaResumen: '07:00', llamarVip: true, quietas: { desde: '23:00', hasta: '08:00' } });
    assert.equal(c.status, 200);
    assert.equal(c.j.preferencias.horaResumen, '07:00');
    assert.deepEqual(c.j.preferencias.quietas, { desde: '23:00', hasta: '08:00' });
    assert.equal(c.j.desdeManana, false);
    assert.equal((await pedir('POST', '/api/iniciativa/dia', ta, { horaResumen: '7am' })).status, 400);
    assert.equal((await pedir('POST', '/api/iniciativa/dia', ta, { correo: DUENO, activa: false })).status, 400, 'nada del cuerpo dice de quién es');
    assert.equal((await pedir('GET', '/api/iniciativa/dia', td)).j.preferencias.activa, true, 'la dueña no cambió');
    ahora = hn(2026, 10, 8, 12);
    const h = await pedir('POST', '/api/iniciativa/dia/hoy-no', ta, {});
    assert.equal(h.j.hoyNo, true);
    assert.equal((await pedir('POST', '/api/iniciativa/dia/hoy-no', ta, { quitar: true })).j.hoyNo, false);
  } finally {
    srv.close();
  }
});
