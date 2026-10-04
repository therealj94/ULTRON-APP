/**
 * Los avisos de la iniciativa (AUR12): zona IANA de la persona (hora local ≠ instante UTC, horario de
 * verano, cambiar de zona no mueve lo absoluto), horas quietas, canal elegido y presupuesto de contacto,
 * controles («menos avisos», «no sobre este tema», posponer, apagado que alcanza lo pendiente) y la outbox
 * deduplicada (una sola entrega por propuesta aunque el reloj corra dos veces o haya dos réplicas).
 *
 * Reloj falso y entregadores dobles: ni un push real ni una cuenta.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'avisos-'));
process.env.ULTRON_AVISOS_DIR = path.join(dir, 'avisos');
process.env.ULTRON_INICIATIVA_DIR = path.join(dir, 'iniciativa');
process.env.ULTRON_MISIONES_DIR = path.join(dir, 'misiones');
process.env.ULTRON_PERFILES_DIR = path.join(dir, 'perfiles');
process.env.ULTRON_MEMORIA_BUCKET = '';
after(() => fs.rmSync(dir, { recursive: true, force: true }));

const zh = await import('../lib/zona-horaria');
const av = await import('../lib/avisos');
const ini = await import('../lib/iniciativa');
const { crearMision, leerMisiones, validarNuevaMision } = await import('../lib/misiones');

const H = 3_600_000;
const DIA = 86_400_000;
const NY = 'America/New_York';
const HN = 'America/Tegucigalpa';
const QUIETAS = { desde: '21:00', hasta: '07:00' };
let n = 0;
const correo = () => `av-${Date.now()}-${n++}@ejemplo.com`;

/** Una propuesta mínima con evidencia, como la deja lib/iniciativa.ts. */
function propuesta(o: Partial<import('../lib/iniciativa').Propuesta> & { ahora?: number; urgente?: boolean } = {}): import('../lib/iniciativa').Propuesta {
  const ahora = o.ahora ?? Date.parse('2026-10-05T15:00:00Z');
  return {
    id: o.id || `p_${(n++).toString(16).padStart(6, '0')}${Math.floor(Math.random() * 1e6).toString(16).padStart(6, '0')}`,
    texto: o.texto || '¿Cómo vas con «Vender el carro»? ¿Lo avanzamos juntos?',
    tipo: o.tipo || 'seguimiento',
    pedido: o.pedido || 'Sí, ayúdame con mi misión «Vender el carro».',
    prioridad: 1,
    creada: ahora,
    ...(o.misionId ? { misionId: o.misionId } : {}),
    evidencia: o.evidencia || {
      porQue: 'La misión vence mañana y no tiene avance.',
      fuente: { tipo: 'mision', id: o.misionId || 'm_abcdef', version: ahora - DIA, motivo: 'por_vencer', visto: ahora },
      paso: 'Preparar el siguiente paso de la misión para su «sí».',
      permiso: 'ninguno',
      caduca: ahora + 20 * H,
      ...(o.urgente ? { urgente: true } : {}),
    },
  };
}

/** Entregadores dobles que anotan cada entrega. `alcance[canal]` = cuántos aparatos alcanza (0 = no estaba). */
function dobles(alcance: Partial<Record<import('../lib/avisos').CanalAviso, number>> = { app: 1, push: 1 }) {
  const log: { canal: string; para: string; id: string }[] = [];
  const ent: Partial<Record<import('../lib/avisos').CanalAviso, import('../lib/avisos').Entregador>> = {};
  for (const canal of Object.keys(alcance) as import('../lib/avisos').CanalAviso[]) {
    ent[canal] = (para, aviso) => {
      log.push({ canal, para, id: aviso.propuesta.id });
      return alcance[canal] || 0;
    };
  }
  return { log, ent };
}

const vigente = () => ({ vigente: true as const });

/* ------------------------------------------------------------------ zona horaria */

test('zona IANA: válidas e inválidas; hora local distinta del instante UTC', () => {
  assert.equal(zh.zonaValida('America/New_York'), 'America/New_York');
  assert.equal(zh.zonaValida('America/Tegucigalpa'), 'America/Tegucigalpa');
  assert.equal(zh.zonaValida('UTC'), 'UTC');
  for (const z of ['', 'Honduras', 'GMT-6', 'America/Nowhere', '../../etc', 42]) assert.equal(zh.zonaValida(z), null, String(z));
  const t = Date.parse('2026-07-15T11:30:00Z');
  assert.deepEqual([zh.partesLocales(t, NY).hora, zh.partesLocales(t, NY).minuto], [7, 30], 'EDT: UTC-4');
  assert.deepEqual([zh.partesLocales(t, HN).hora, zh.partesLocales(t, HN).minuto], [5, 30], 'Honduras: UTC-6 todo el año');
  assert.equal(zh.fechaLocal(Date.parse('2026-10-06T03:00:00Z'), HN), '2026-10-05', 'el día local no es el día UTC');
});

test('horas quietas en la zona de la persona, con horario de verano (America/New_York)', () => {
  // Verano (EDT): 07:30 local → fuera; invierno (EST): el mismo instante UTC es 06:30 → quietas.
  assert.equal(zh.enQuietas(Date.parse('2026-07-15T11:30:00Z'), NY, QUIETAS), false);
  assert.equal(zh.enQuietas(Date.parse('2026-12-15T11:30:00Z'), NY, QUIETAS), true);
  // Honduras no tiene horario de verano: el mismo instante es 05:30 en julio y en diciembre.
  assert.equal(zh.enQuietas(Date.parse('2026-07-15T11:30:00Z'), HN, QUIETAS), true);
  assert.equal(zh.enQuietas(Date.parse('2026-12-15T11:30:00Z'), HN, QUIETAS), true);
  // Fin de las quietas el día del cambio: 1-nov (vuelve EST) termina a las 07:00 EST = 12:00Z; 8-mar (empieza EDT) a las 07:00 EDT = 11:00Z.
  assert.equal(zh.finDeQuietas(Date.parse('2026-11-01T05:30:00Z'), NY, QUIETAS), Date.parse('2026-11-01T12:00:00Z'));
  assert.equal(zh.finDeQuietas(Date.parse('2026-03-08T06:00:00Z'), NY, QUIETAS), Date.parse('2026-03-08T11:00:00Z'));
  // Antes de medianoche, el fin es mañana.
  assert.equal(zh.finDeQuietas(Date.parse('2026-10-06T03:30:00Z'), HN, QUIETAS), Date.parse('2026-10-06T13:00:00Z'), '21:30 → 07:00 del día siguiente');
  // Fuera de las quietas, el mismo instante.
  const t = Date.parse('2026-10-05T18:00:00Z');
  assert.equal(zh.finDeQuietas(t, HN, QUIETAS), t);
  // Una ventana que no cruza medianoche y una vacía.
  assert.equal(zh.enQuietas(Date.parse('2026-10-05T19:30:00Z'), HN, { desde: '13:00', hasta: '14:00' }), true);
  assert.equal(zh.enQuietas(t, HN, { desde: '07:00', hasta: '07:00' }), false);
});

test('hora local → instante: el hueco de primavera avanza y la hora repetida de otoño toma la primera', () => {
  assert.equal(zh.instanteDeLocal('2026-10-05', '08:00', HN), Date.parse('2026-10-05T14:00:00Z'));
  assert.equal(zh.instanteDeLocal('2026-07-15', '08:00', NY), Date.parse('2026-07-15T12:00:00Z'));
  assert.equal(zh.instanteDeLocal('2026-12-15', '08:00', NY), Date.parse('2026-12-15T13:00:00Z'));
  assert.equal(zh.instanteDeLocal('2026-03-08', '02:30', NY), Date.parse('2026-03-08T07:30:00Z'), '02:30 no existe: 03:30 EDT');
  assert.equal(zh.instanteDeLocal('2026-11-01', '01:30', NY), Date.parse('2026-11-01T05:30:00Z'), '01:30 dos veces: la primera (EDT)');
  assert.equal(zh.sumarDias('2026-12-31', 1), '2027-01-01');
  assert.equal(zh.finDelDiaLocal('2026-10-05', HN), Date.parse('2026-10-06T05:59:59.999Z'));
});

test('una fecha sin hora es el FINAL de ese día en la zona de la persona, no la medianoche UTC', () => {
  const hn = validarNuevaMision({ titulo: 'Entregar el informe', vence: '2026-12-01' }, { zona: HN });
  assert.ok(hn.ok);
  if (!hn.ok) return;
  assert.equal(hn.datos.vence, Date.parse('2026-12-02T05:59:59.999Z'));
  // Antes, Date.parse('2026-12-01') = medianoche UTC = 30-nov 18:00 en Honduras: «vencida» un día antes.
  assert.ok(Number(hn.datos.vence) > Date.parse('2026-12-01T16:00:00Z'), 'el 1-dic a las 10:00 de Honduras todavía no venció');
  const ny = validarNuevaMision({ titulo: 'Entregar el informe', vence: '2026-12-01' }, { zona: NY });
  assert.ok(ny.ok && ny.datos.vence === Date.parse('2026-12-02T04:59:59.999Z'));
  // Con hora y zona explícitas (ISO), se respeta el instante tal cual.
  const iso = validarNuevaMision({ titulo: 'Llamada', vence: '2026-12-01T15:00:00Z' }, { zona: NY });
  assert.ok(iso.ok && iso.datos.vence === Date.parse('2026-12-01T15:00:00Z'));
});

test('cambiar de zona no reinterpreta citas absolutas; el día del presupuesto sí sigue la zona nueva', async () => {
  const c = correo();
  const t0 = Date.parse('2026-10-03T16:00:00Z');
  const { mision } = await crearMision(c, { titulo: 'Pagar el impuesto', vence: '2026-10-05' }, t0, { zona: HN });
  assert.equal(mision.vence, Date.parse('2026-10-06T05:59:59.999Z'));
  assert.equal(mision.zona, HN, 'se guarda en qué zona se dijo, para mostrarla');
  await av.cambiarPreferencias(c, { zona: NY }, t0 + H);
  const r = await leerMisiones(c);
  assert.ok(r.ok && r.misiones[0].vence === mision.vence, 'el instante no se mueve');
  const est = await av.leerAvisos(c);
  assert.ok(est.ok && est.estado.prefs.zona === NY);
  // Un aviso entregado a las 23:30 de Honduras (05:30Z) ya es «mañana» en Nueva York (01:30 EDT).
  assert.equal(zh.fechaLocal(Date.parse('2026-10-06T05:30:00Z'), NY), '2026-10-06');
  assert.equal(zh.fechaLocal(Date.parse('2026-10-06T05:30:00Z'), HN), '2026-10-05');
  assert.equal(zh.describirInstante(mision.vence!, HN), '5 oct 2026, 23:59 (America/Tegucigalpa)');
  assert.equal(zh.describirInstante(mision.vence!, NY), '6 oct 2026, 01:59 (America/New_York)', 'mostrado en la zona nueva, mismo instante');
});

/* ------------------------------------------------------------------ preferencias */

test('preferencias: por omisión un resumen no urgente al día, app y push, nada urgente, «luego» en 2 h', () => {
  const p = av.prefsPorOmision();
  assert.equal(p.zona, HN);
  assert.deepEqual(p.quietas, QUIETAS);
  assert.equal(p.maxDia, 1);
  assert.deepEqual(p.canales, ['app', 'push']);
  assert.deepEqual(p.urgentes, []);
  assert.equal(p.llamadaUrgente, false);
  assert.equal(p.apagado, false);
  assert.equal(p.luego, '2h');
});

test('validar cambios: zona IANA, horas HH:MM, canales conocidos (la llamada no es un canal de resumen), topes', () => {
  assert.ok(av.validarCambiosAvisos({ zona: NY, quietas: { desde: '22:00', hasta: '06:30' }, canales: ['push'], maxDia: 2 }).ok);
  for (const malo of [{ zona: 'Marte/Base' }, { quietas: { desde: '25:00', hasta: '07:00' } }, { canales: ['fax'] }, { canales: ['llamada'] }, { maxDia: 50 }, { urgentes: ['todo'] }, { luego: 'nunca' }, { pospuestoHasta: 'ayer' }]) {
    assert.equal(av.validarCambiosAvisos(malo).ok, false, JSON.stringify(malo));
  }
});

test('«luego» con preferencia explícita: 2 h, esta tarde o mañana al terminar las quietas, en su zona', () => {
  const t = Date.parse('2026-07-15T13:00:00Z'); // 09:00 EDT
  assert.equal(av.hastaDeLuego('2h', t, NY, QUIETAS), t + 2 * H);
  assert.equal(av.hastaDeLuego('tarde', t, NY, QUIETAS), Date.parse('2026-07-15T19:00:00Z'), '15:00 EDT');
  assert.equal(av.hastaDeLuego('manana', t, NY, QUIETAS), Date.parse('2026-07-16T11:00:00Z'), '07:00 EDT del día siguiente');
  assert.equal(av.hastaDeLuego('manana', Date.parse('2026-10-31T13:00:00Z'), NY, QUIETAS), Date.parse('2026-11-01T12:00:00Z'), 'tras el cambio: 07:00 EST');
  // Ya pasadas las 15:00, «esta tarde» es en 2 h.
  const tarde = Date.parse('2026-07-15T20:00:00Z');
  assert.equal(av.hastaDeLuego('tarde', tarde, NY, QUIETAS), tarde + 2 * H);
});

/* ------------------------------------------------------------------ la decisión de contactar (pura) */

test('decidir: presupuesto de un aviso no urgente por día LOCAL, urgentes solo para las clases elegidas', () => {
  const prefs = { ...av.prefsPorOmision(), zona: NY };
  const ahora = Date.parse('2026-07-15T14:00:00Z'); // 10:00 EDT
  const base = { propuestaId: 'p_000001', clase: 'seguimiento' as const, tema: { clave: 'mision:m1', texto: '' }, urgente: false, para: 'a@b.hn', dueno: 'a@b.hn' };
  assert.deepEqual(av.decidirContacto(base, { prefs, outbox: [] }, ahora), { ok: true, canales: ['app', 'push'], urgente: false });
  const yaHoy = [{ clave: 'p_x', propuestaId: 'p_x', clase: 'ayuda' as const, estado: 'entregado' as const, urgente: false, t: ahora - 3 * H, canal: 'push' as const }];
  const d = av.decidirContacto(base, { prefs, outbox: yaHoy as any }, ahora);
  assert.equal(d.ok, false);
  assert.equal(!d.ok && d.motivo, 'presupuesto');
  // Ayer en su zona (02:30Z = 22:30 EDT del día anterior) no cuenta.
  assert.equal(av.decidirContacto(base, { prefs, outbox: [{ ...yaHoy[0], t: Date.parse('2026-07-15T02:30:00Z') }] as any }, ahora).ok, true);
  // Lo que la persona abrió ella misma (pull) no gasta presupuesto.
  assert.equal(av.decidirContacto(base, { prefs, outbox: [{ ...yaHoy[0], pull: true }] as any }, ahora).ok, true);
  // Candidata a urgente, pero la clase no está elegida: cuenta como normal.
  assert.equal(av.decidirContacto({ ...base, urgente: true }, { prefs, outbox: yaHoy as any }, ahora).ok, false);
  const conUrg = { ...prefs, urgentes: ['seguimiento' as const] };
  assert.deepEqual(av.decidirContacto({ ...base, urgente: true }, { prefs: conUrg, outbox: yaHoy as any }, ahora), { ok: true, canales: ['app', 'push'], urgente: true });
  // La llamada solo si la activó para sus urgentes; nunca para lo normal.
  assert.deepEqual((av.decidirContacto({ ...base, urgente: true }, { prefs: { ...conUrg, llamadaUrgente: true }, outbox: [] }, ahora) as any).canales, ['llamada', 'app', 'push']);
  assert.deepEqual((av.decidirContacto(base, { prefs: { ...conUrg, llamadaUrgente: true }, outbox: [] }, ahora) as any).canales, ['app', 'push']);
});

test('decidir: apagado, clase apagada, tema silenciado, pospuesto, quietas, «menos avisos», ya entregada y destino ajeno', () => {
  const prefs = av.prefsPorOmision();
  const ahora = Date.parse('2026-10-05T16:00:00Z'); // 10:00 Honduras
  const base = { propuestaId: 'p_000002', clase: 'seguimiento' as const, tema: { clave: 'mision:m1', texto: 'Vender el carro' }, urgente: false, para: 'a@b.hn', dueno: 'a@b.hn' };
  const motivo = (p: any, outbox: any[] = [], t = ahora, a: any = base) => {
    const d: any = av.decidirContacto(a, { prefs: { ...prefs, ...p }, outbox }, t);
    return d.ok ? 'ok' : d.motivo;
  };
  assert.equal(motivo({ apagado: true }), 'apagado');
  assert.equal(motivo({ clasesApagadas: ['seguimiento'] }), 'clase_apagada');
  assert.equal(motivo({ temasSilenciados: [{ clave: 'mision:m1', texto: 'Vender el carro' }] }), 'tema_silenciado');
  assert.equal(motivo({ temasSilenciados: [{ clave: 'mision:otra', texto: 'Otra cosa' }] }), 'ok');
  const pos: any = av.decidirContacto(base, { prefs: { ...prefs, pospuestoHasta: ahora + DIA }, outbox: [] }, ahora);
  assert.ok(!pos.ok && pos.motivo === 'pospuesto' && pos.reintentarEn === ahora + DIA);
  const noche = Date.parse('2026-10-06T04:00:00Z'); // 22:00 Honduras
  const q: any = av.decidirContacto(base, { prefs, outbox: [] }, noche);
  assert.ok(!q.ok && q.motivo === 'horas_quietas' && q.reintentarEn === Date.parse('2026-10-06T13:00:00Z'));
  // «menos avisos»: como mucho uno cada 3 días.
  const hace2 = [{ clave: 'p_y', propuestaId: 'p_y', clase: 'ayuda', estado: 'entregado', urgente: false, t: ahora - 2 * DIA }];
  assert.equal(motivo({ cadaDias: 3 }, hace2), 'menos_avisos');
  assert.equal(motivo({ cadaDias: 3 }, [{ ...hace2[0], t: ahora - 3 * DIA }]), 'ok');
  // La misma propuesta ya entregada (por cualquier canal) no se vuelve a mandar.
  assert.equal(motivo({}, [{ clave: 'p_000002', propuestaId: 'p_000002', clase: 'seguimiento', estado: 'entregado', urgente: false, t: ahora - 10 * DIA, canal: 'app' }]), 'ya_entregada');
  // Solo a la persona dueña: nunca a un tercero.
  assert.equal(motivo({}, [], ahora, { ...base, para: 'otro@b.hn' }), 'no_autorizado');
  assert.equal(motivo({ canales: [] }), 'sin_canal');
});

/* ------------------------------------------------------------------ el sello (dedupe) */

test('sello local: la misma clave se reclama una sola vez, también entre dos «réplicas» sobre el mismo disco', async () => {
  const d = path.join(dir, 'sellos-a');
  const a = av.selloLocal({ dir: d });
  const b = av.selloLocal({ dir: d });
  const t = Date.parse('2026-10-05T16:00:00Z');
  const r = await Promise.all([a.reclamar('aviso:x:p_1', t), b.reclamar('aviso:x:p_1', t), a.reclamar('aviso:x:p_1', t)]);
  assert.equal(r.filter(Boolean).length, 1);
  assert.equal(await b.reclamada('aviso:x:p_1'), true);
  assert.equal(await a.reclamar('aviso:x:p_2', t), true, 'otra clave, otra entrega');
  // Sin disco, solo en memoria.
  const m = av.selloLocal({ dir: null });
  assert.equal(await m.reclamar('k', t), true);
  assert.equal(await m.reclamar('k', t), false);
});

/* ------------------------------------------------------------------ la outbox */

test('outbox: encolar es idempotente y dos vueltas a la vez entregan UNA vez', async () => {
  const c = correo();
  const ahora = Date.parse('2026-10-05T16:00:00Z');
  const p = propuesta({ ahora });
  const e1 = await av.encolarAviso(c, p, ahora);
  const e2 = await av.encolarAviso(c, p, ahora + 1000);
  assert.equal(e1.nuevo, true);
  assert.equal(e2.nuevo, false);
  const { log, ent } = dobles();
  const sello = av.selloLocal({ dir: path.join(dir, 'sellos-b') });
  const [r1, r2] = await Promise.all([av.procesarOutbox(c, { revalidar: vigente, entregadores: ent, sello, ahora }), av.procesarOutbox(c, { revalidar: vigente, entregadores: ent, sello, ahora })]);
  assert.equal(log.length, 1, JSON.stringify(log));
  assert.equal(log[0].canal, 'app');
  assert.equal(log[0].para, c, 'siempre a la persona dueña');
  assert.equal([...r1, ...r2].filter((x) => x.entregado).length, 1);
  assert.equal((await av.procesarOutbox(c, { revalidar: vigente, entregadores: ent, sello, ahora: ahora + H })).length, 0, 'nada pendiente');
});

test('outbox: otra réplica sin el estado (caché y disco propios) no repite la entrega gracias al sello compartido', async () => {
  const c = correo();
  const ahora = Date.parse('2026-10-05T16:00:00Z');
  const p = propuesta({ ahora });
  const sellos = path.join(dir, 'sellos-c');
  const { log, ent } = dobles();
  await av.encolarAviso(c, p, ahora);
  await av.procesarOutbox(c, { revalidar: vigente, entregadores: ent, sello: av.selloLocal({ dir: sellos }), ahora });
  // La «réplica B» no sabe nada: se le borra la caché y su disco de avisos.
  av._olvidarCacheAvisos();
  fs.rmSync(process.env.ULTRON_AVISOS_DIR!, { recursive: true, force: true });
  await av.encolarAviso(c, p, ahora + 60_000);
  const r = await av.procesarOutbox(c, { revalidar: vigente, entregadores: ent, sello: av.selloLocal({ dir: sellos }), ahora: ahora + 60_000 });
  assert.equal(log.length, 1);
  assert.equal(r[0]?.motivo, 'duplicado');
});

test('outbox: revalida JUSTO antes de avisar — asunto resuelto o fuente caída no se avisan', async () => {
  const c = correo();
  const ahora = Date.parse('2026-10-05T16:00:00Z');
  const { log, ent } = dobles();
  const sello = av.selloLocal({ dir: null });
  const p1 = propuesta({ ahora });
  const p2 = propuesta({ ahora, texto: 'Tienes 4 correos sin leer. ¿Te resumo lo importante?', tipo: 'ayuda' });
  await av.encolarAviso(c, p1, ahora);
  await av.encolarAviso(c, p2, ahora);
  let lecturas = 0;
  const revalidar = (p: any) => {
    lecturas++;
    return p.id === p1.id ? { vigente: false as const, motivo: 'resuelta' as const } : { vigente: false as const, motivo: 'fuente_desconectada' as const };
  };
  const r = await av.procesarOutbox(c, { revalidar, entregadores: ent, sello, ahora: ahora + 5 * H });
  assert.equal(log.length, 0);
  assert.equal(lecturas, 2, 'se leyeron las fuentes en el momento de avisar');
  assert.deepEqual(r.map((x) => x.motivo).sort(), ['fuente_desconectada', 'resuelta']);
  const est = await av.leerAvisos(c);
  assert.ok(est.ok && est.estado.outbox.every((x) => x.estado === 'omitido'));
});

test('outbox: el canal de respaldo solo si el primero NO alcanzó; un aviso entregado e ignorado no se persigue por otro canal', async () => {
  const c = correo();
  const ahora = Date.parse('2026-10-05T16:00:00Z');
  const sello = av.selloLocal({ dir: null });
  // La app no estaba escuchando (0): sale por push.
  const a = dobles({ app: 0, push: 1 });
  const p1 = propuesta({ ahora });
  await av.encolarAviso(c, p1, ahora);
  const r1 = await av.procesarOutbox(c, { revalidar: vigente, entregadores: a.ent, sello, ahora });
  assert.deepEqual(a.log.map((x) => x.canal), ['app', 'push']);
  assert.equal(r1[0].canal, 'push');
  // Al día siguiente, otra: la app sí la recibe → push no se toca.
  const b = dobles({ app: 1, push: 1, correo: 1 });
  const p2 = propuesta({ ahora: ahora + DIA });
  await av.encolarAviso(c, p2, ahora + DIA);
  await av.procesarOutbox(c, { revalidar: vigente, entregadores: b.ent, sello, ahora: ahora + DIA });
  assert.deepEqual(b.log.map((x) => x.canal), ['app']);
  // La ignoró: ni se re-encola ni sale por otro canal, por mucho que el reloj vuelva a pasar.
  await av.encolarAviso(c, p2, ahora + DIA + 9 * H);
  await av.procesarOutbox(c, { revalidar: vigente, entregadores: b.ent, sello: av.selloLocal({ dir: null }), ahora: ahora + DIA + 9 * H });
  assert.deepEqual(b.log.map((x) => x.canal), ['app'], 'ignorar no autoriza perseguir');
});

test('outbox: presupuesto diario — la segunda no urgente del día no se empuja (queda en la app); una urgente elegida sí', async () => {
  const c = correo();
  const ahora = Date.parse('2026-10-05T16:00:00Z');
  const sello = av.selloLocal({ dir: null });
  const { log, ent } = dobles();
  const p1 = propuesta({ ahora });
  const p2 = propuesta({ ahora: ahora + 2 * H, tipo: 'ayuda', texto: '¿Te busco vuelos a Roatán?' });
  await av.encolarAviso(c, p1, ahora);
  await av.procesarOutbox(c, { revalidar: vigente, entregadores: ent, sello, ahora });
  await av.encolarAviso(c, p2, ahora + 2 * H);
  const r = await av.procesarOutbox(c, { revalidar: vigente, entregadores: ent, sello, ahora: ahora + 2 * H });
  assert.equal(log.length, 1);
  assert.equal(r[0].motivo, 'presupuesto');
  await av.cambiarPreferencias(c, { urgentes: ['seguimiento'] }, ahora + 3 * H);
  const p3 = propuesta({ ahora: ahora + 3 * H, urgente: true });
  await av.encolarAviso(c, p3, ahora + 3 * H);
  await av.procesarOutbox(c, { revalidar: vigente, entregadores: ent, sello, ahora: ahora + 3 * H });
  assert.equal(log.length, 2, 'la urgente de una clase elegida pasa el presupuesto');
});

test('outbox: en horas quietas espera al final de las quietas (en SU zona) y revalida entonces', async () => {
  const c = correo();
  await av.cambiarPreferencias(c, { zona: NY, urgentes: ['seguimiento'] }, Date.parse('2026-12-14T15:00:00Z'));
  const noche = Date.parse('2026-12-15T03:00:00Z'); // 22:00 EST
  const p = propuesta({ ahora: noche, urgente: true });
  const { log, ent } = dobles();
  const sello = av.selloLocal({ dir: null });
  await av.encolarAviso(c, p, noche);
  const r = await av.procesarOutbox(c, { revalidar: vigente, entregadores: ent, sello, ahora: noche });
  assert.equal(r[0].motivo, 'horas_quietas');
  const est = await av.leerAvisos(c);
  assert.ok(est.ok && est.estado.outbox[0].estado === 'pendiente' && est.estado.outbox[0].cuando === Date.parse('2026-12-15T12:00:00Z'), '07:00 EST');
  assert.equal((await av.procesarOutbox(c, { revalidar: vigente, entregadores: ent, sello, ahora: Date.parse('2026-12-15T11:30:00Z') })).length, 0, 'todavía no toca');
  let revisada = false;
  await av.procesarOutbox(c, { revalidar: () => ((revisada = true), { vigente: true }), entregadores: ent, sello, ahora: Date.parse('2026-12-15T12:00:00Z') });
  assert.ok(revisada);
  assert.equal(log.length, 1);
});

test('apagado y «no sobre este tema» se propagan a los avisos pendientes y cancelan los futuros de esa clase', async () => {
  const c = correo();
  const noche = Date.parse('2026-10-06T04:00:00Z'); // 22:00 Honduras: todo queda pendiente para mañana
  await av.cambiarPreferencias(c, { urgentes: ['seguimiento', 'ayuda'] }, noche - H);
  const pSeg = propuesta({ ahora: noche, urgente: true, misionId: 'm_aaaaaa' });
  const pAyu = propuesta({ ahora: noche, urgente: true, tipo: 'ayuda', texto: 'Tienes correos sin leer', evidencia: { porQue: 'x', fuente: { tipo: 'correo', visto: noche }, paso: 'resumir', permiso: 'leer_correo', caduca: noche + DIA, urgente: true } });
  for (const p of [pSeg, pAyu]) {
    await av.encolarAviso(c, p, noche);
    await av.procesarOutbox(c, { revalidar: vigente, entregadores: {}, sello: av.selloLocal({ dir: null }), ahora: noche });
  }
  const r = await av.cambiarPreferencias(c, { clasesApagadas: ['seguimiento'] }, noche + H);
  assert.equal(r.cancelados, 1);
  const { log, ent } = dobles();
  const manana = Date.parse('2026-10-06T13:00:00Z');
  await av.procesarOutbox(c, { revalidar: vigente, entregadores: ent, sello: av.selloLocal({ dir: null }), ahora: manana });
  assert.deepEqual(log.map((x) => x.id), [pAyu.id], 'solo la de la clase que sigue encendida');
  // Una nueva de la clase apagada ni se encola como pendiente.
  const otra = propuesta({ ahora: manana + H });
  await av.encolarAviso(c, otra, manana + H);
  await av.procesarOutbox(c, { revalidar: vigente, entregadores: ent, sello: av.selloLocal({ dir: null }), ahora: manana + H });
  assert.equal(log.length, 1);
  // Apagado total: nada.
  await av.cambiarPreferencias(c, { apagado: true }, manana + 2 * H);
  const ultima = propuesta({ ahora: manana + DIA, tipo: 'ayuda' });
  await av.encolarAviso(c, ultima, manana + DIA);
  await av.procesarOutbox(c, { revalidar: vigente, entregadores: ent, sello: av.selloLocal({ dir: null }), ahora: manana + DIA });
  assert.equal(log.length, 1);
});

test('apagar una clase también la saca de la cola y de la pendiente de la iniciativa (los «jobs» del reloj)', async () => {
  const c = correo();
  const ahora = Date.parse('2026-10-02T13:30:00Z'); // 07:30 Honduras
  await crearMision(c, { titulo: 'Vender el carro', pasos: ['Tomar fotos'] }, ahora - 5 * DIA);
  const r = await leerMisiones(c);
  const misiones = r.ok ? r.misiones : [];
  const s = await ini.siguientePropuesta({ correo: c }, { ahora, misiones, modelo: null });
  assert.equal(s.propuesta?.tipo, 'seguimiento');
  await av.cambiarPreferencias(c, { clasesApagadas: ['seguimiento', 'dia'] }, ahora + 60_000);
  const est = await ini.leerEstadoIniciativa(c);
  assert.ok(est.ok);
  if (!est.ok) return;
  assert.equal(est.estado.pendiente, null, 'la pendiente de esa clase se retira');
  assert.ok(est.estado.cola.every((p) => p.tipo !== 'seguimiento' && p.tipo !== 'dia'));
});

test('ver la propuesta en la app (pull) cuenta como entregada: el reloj ya no la empuja por push', async () => {
  const c = correo();
  const ahora = Date.parse('2026-10-05T16:00:00Z');
  const p = propuesta({ ahora });
  await av.encolarAviso(c, p, ahora);
  await av.registrarVista(c, p, ahora + 60_000);
  const { log, ent } = dobles();
  await av.procesarOutbox(c, { revalidar: vigente, entregadores: ent, sello: av.selloLocal({ dir: null }), ahora: ahora + 2 * 60_000 });
  assert.equal(log.length, 0);
  // Y esa vista no gasta el presupuesto del día.
  const p2 = propuesta({ ahora: ahora + H, tipo: 'ayuda', texto: '¿Te busco vuelos a Roatán?' });
  await av.encolarAviso(c, p2, ahora + H);
  await av.procesarOutbox(c, { revalidar: vigente, entregadores: ent, sello: av.selloLocal({ dir: null }), ahora: ahora + H });
  assert.equal(log.length, 1);
});

test('una reserva que quedó a medias (caída del proceso) no se reenvía: mejor un aviso de menos que dos', async () => {
  const c = correo();
  const ahora = Date.parse('2026-10-05T16:00:00Z');
  const p = propuesta({ ahora });
  await av.encolarAviso(c, p, ahora);
  const sello = av.selloLocal({ dir: null });
  // Un entregador que se queda colgado (el proceso «se cae» con la reserva hecha).
  let soltar: (n: number) => void = () => undefined;
  const colgado = av.procesarOutbox(c, { revalidar: vigente, entregadores: { app: () => new Promise<number>((r) => (soltar = r)) }, sello, ahora });
  for (let i = 0; i < 50; i++) {
    const est = await av.leerAvisos(c);
    if (est.ok && est.estado.outbox[0]?.estado === 'reservado') break;
    await new Promise((r) => setTimeout(r, 5));
  }
  const { log, ent } = dobles();
  const r = await av.procesarOutbox(c, { revalidar: vigente, entregadores: ent, sello, ahora: ahora + 10 * 60_000 });
  assert.equal(log.length, 0);
  assert.equal(r[0]?.motivo, 'incierto');
  soltar(1);
  await colgado;
});

test('un entregador que falla cuenta como «no alcanzó» y se prueba el siguiente canal elegido', async () => {
  const c = correo();
  const ahora = Date.parse('2026-10-05T16:00:00Z');
  const p = propuesta({ ahora });
  await av.encolarAviso(c, p, ahora);
  const usados: string[] = [];
  const r = await av.procesarOutbox(c, {
    revalidar: vigente,
    entregadores: {
      app: () => {
        usados.push('app');
        throw new Error('canal roto');
      },
      push: () => (usados.push('push'), 1),
    },
    sello: av.selloLocal({ dir: null }),
    ahora,
  });
  assert.deepEqual(usados, ['app', 'push']);
  assert.equal(r[0].canal, 'push');
});

/* ------------------------------------------------------------------ la hoja «Tus avisos» del teléfono (lógica) */

test('el teléfono entiende las preferencias del servidor y arma los cambios que este acepta', async () => {
  const m = await import('../mobile/src/compa/avisos');
  const servidor = { preferencias: { ...av.prefsPorOmision(), clasesApagadas: ['conocer'], pospuestoHasta: 123 } };
  const p = m.prefsDeServidor(JSON.parse(JSON.stringify(servidor)));
  assert.ok(p);
  assert.equal(p!.zona, HN);
  assert.deepEqual(p!.canales, ['app', 'push']);
  assert.deepEqual(p!.clasesApagadas, ['conocer']);
  assert.equal(m.prefsDeServidor({ preferencias: { zona: HN } }), null, 'sin horas quietas válidas no se adivina');
  assert.equal(m.prefsDeServidor(null), null);
  // Lo que manda cada control lo acepta el validador del servidor.
  const rapida = m.QUIETAS_RAPIDAS[1];
  for (const cambio of [{ canales: m.canalesPara(false) }, { canales: m.canalesPara(true) }, { clasesApagadas: m.alternar(p!.clasesApagadas, 'dia') }, { menosAvisos: true }, { quietas: { desde: rapida.desde, hasta: rapida.hasta } }, { luego: 'manana' }, { temasSilenciados: [] }, { urgentes: ['seguimiento'] }]) {
    assert.ok(av.validarCambiosAvisos(cambio).ok, JSON.stringify(cambio));
  }
  assert.deepEqual(m.alternar(['a', 'b'], 'a'), ['b']);
  assert.equal(m.idQuietas({ desde: '21:00', hasta: '07:00' }), '21-07');
  assert.deepEqual(m.cuerpoPosponer(1, p!, new Date(2026, 9, 31, 10, 0)), { fecha: '2026-11-01', hora: '07:00' });
});

/* ------------------------------------------------------------------ P1 / A2: la outbox con la revalidación real */

const SI = await import('../server/iniciativa');
const MODELO_CORREO = async () =>
  JSON.stringify([{ tipo: 'ayuda', texto: 'Tienes tres correos sin leer. ¿Te resumo lo importante?', pedido: 'Revisa mi correo y resume lo importante', prioridad: 1, porque: 'Hay tres correos sin leer', fuente: 'correo' }]);

test('A2 outbox + revalidarAhora: la propuesta del modelo sobre el correo solo sale con el correo observado vigente; cada estado de la fuente se distingue', async () => {
  const ahora = Date.parse('2026-10-05T16:00:00Z'); // 10:00 Honduras
  const casos: Array<[string, unknown, number, string]> = [
    ['vigente', { observaciones: { correo: { estado: 'vigente', valor: 3 } } }, 1, 'entregado'],
    ['3→0', { correoSinLeer: 0 }, 0, 'resuelta'],
    ['vacío', { observaciones: { correo: { estado: 'empty' } } }, 0, 'resuelta'],
    ['desconectado', { desconectadas: ['correo'], correoSinLeer: null }, 0, 'fuente_desconectada'],
    ['no configurado', { observaciones: { correo: { estado: 'not_configured' } } }, 0, 'fuente_no_configurada'],
    ['no disponible', { observaciones: { correo: { estado: 'unavailable' } } }, 0, 'fuente_no_disponible'],
    ['ausente', {}, 0, 'sin_observacion'],
  ];
  for (const [nombre, alEntregar, n, motivo] of casos) {
    const c = correo();
    const s = await ini.siguientePropuesta({ correo: c }, { ahora, correoSinLeer: 3, modelo: MODELO_CORREO });
    assert.ok(s.propuesta, nombre);
    await av.encolarAviso(c, s.propuesta!, ahora);
    const { log, ent } = dobles();
    const r = await av.procesarOutbox(c, { revalidar: (q) => SI.revalidarAhora(c, q, { contadores: async () => alEntregar as any }, ahora + 60_000), entregadores: ent, sello: av.selloLocal({ dir: null }), ahora: ahora + 60_000 });
    assert.equal(log.length, n, `${nombre}: entregas`);
    assert.equal(r[0]?.motivo, motivo, nombre);
  }
});

test('A2 una propuesta guardada con fuente «modelo» que afirma correo no se entrega aunque el buzón tenga correo: nunca se ancló a la fuente', async () => {
  const ahora = Date.parse('2026-10-05T16:00:00Z');
  const c = correo();
  const vieja = propuesta({ ahora, tipo: 'ayuda', texto: 'Tienes tres correos sin leer. ¿Te resumo lo importante?', pedido: 'Revisa mi correo y resume lo importante', evidencia: { porQue: 'Hay tres', fuente: { tipo: 'modelo', visto: ahora }, paso: 'x', permiso: 'leer_correo', caduca: ahora + DIA } });
  const idea = propuesta({ ahora, tipo: 'ayuda', texto: '¿Te preparo la lista del súper?', pedido: 'Sí, prepárame la lista del súper.', evidencia: { porQue: 'idea', fuente: { tipo: 'modelo', visto: ahora }, paso: 'x', permiso: 'ninguno', caduca: ahora + DIA } });
  const f = { observaciones: { correo: { estado: 'vigente' as const, valor: 3 } } };
  assert.deepEqual(ini.revalidarPropuesta(vieja, f, ahora + 60_000), { vigente: false, motivo: 'sin_fuente' });
  assert.deepEqual(ini.revalidarPropuesta(idea, f, ahora + 60_000), { vigente: true }, 'control: una idea que no afirma hechos sigue valiendo');
  await av.encolarAviso(c, vieja, ahora);
  const { log, ent } = dobles();
  await av.procesarOutbox(c, { revalidar: (q) => ini.revalidarPropuesta(q, f, ahora + 60_000), entregadores: ent, sello: av.selloLocal({ dir: null }), ahora: ahora + 60_000 });
  assert.equal(log.length, 0);
});
