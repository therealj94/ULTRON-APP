/**
 * EL TELÉFONO CON LOS RECORDATORIOS DEL SERVIDOR Y EL MARCADOR (A-3 y A-4, todo JS: va por OTA):
 *
 *  · reconciliar sus alarmas (notifee) con el servidor (mobile/src/compa/recordatoriosServidor.ts): pone las que faltan,
 *    quita las que el servidor borró, marcó hechas o cambió, sube las que el servidor no conoce (nunca las quita a ciegas)
 *    y adopta las viejas del teléfono; no toca la que está por sonar;
 *  · el push de una vez cuya alarma ya estaba en este teléfono no se enseña (no suena dos veces) (push/logica.ts);
 *  · la alarma de un recordatorio del servidor lleva su id (`<rid>-<vez>`) y cancelarlo por voz quita sus alarmas
 *    (compa/recordatorios.ts, con un notifee de mentira);
 *  · el marcador: `tel:` con el número aprobado; por WhatsApp, el chat (y wa.me si no abre); nada raro se abre
 *    (compa/marcar.ts); el puente de acciones acepta `marcar` solo con un número E.164.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

// El código de la app se carga sin que tsc de la raíz lo siga (tiene su propio tsconfig).
const cargar = (r: string): Promise<any> => import(r);
const S = await cargar('../mobile/src/compa/recordatoriosServidor');
const Rec = await cargar('../mobile/src/compa/recordatorios');
const Push = await cargar('../mobile/src/push/logica');
const Marcar = await cargar('../mobile/src/compa/marcar');
const Acc = await cargar('../mobile/src/compa/acciones');

const AHORA = Date.UTC(2026, 9, 7, 18, 0);
const H = 3600_000;
const RID = 'aura-rec-sabc123def456';
const RID2 = 'aura-rec-s999888777666';
const srv = (o: Record<string, unknown>) => ({ id: RID, texto: 'La pastilla', proxima: AHORA + 2 * H, llamada: false, repetir: { tipo: 'diario' }, repeticion: 'todos los días', sonado: false, ...o });
const local = (id: string, cuando: number, o: Record<string, unknown> = {}) => ({ id, texto: 'La pastilla', cuando, llamada: false, ...o });

/* ── reconciliar ─────────────────────────────────────────────────────────────────────────── */

test('reconciliar: pone la alarma de la próxima vez que falta; con la suya puesta, nada', () => {
  const lista = { recordatorios: [srv({})], borrados: [] };
  const p = S.planReconciliar(lista, [], AHORA);
  assert.deepEqual(p.poner, [{ rid: RID, texto: 'La pastilla', cuando: AHORA + 2 * H, llamada: false }]);
  const base = S.baseServidor(RID, AHORA + 2 * H);
  assert.match(base, S.RE_BASE_SERVIDOR);
  assert.deepEqual(S.planReconciliar(lista, [local(base, AHORA + 2 * H)], AHORA), { poner: [], quitar: [], subir: [] });
});

test('reconciliar: quita la que el servidor borró, la de otra hora (ya sonó y toca la siguiente) y la de otro texto', () => {
  const vieja = S.baseServidor(RID, AHORA - H + 3 * H);
  const lista = { recordatorios: [srv({ proxima: AHORA + 26 * H })], borrados: [RID2] };
  const p = S.planReconciliar(lista, [local(vieja, AHORA + 2 * H), local(S.baseServidor(RID2, AHORA + 5 * H), AHORA + 5 * H)], AHORA);
  assert.deepEqual(p.quitar.sort(), [vieja, S.baseServidor(RID2, AHORA + 5 * H)].sort());
  assert.deepEqual(p.poner.map((x: any) => x.cuando), [AHORA + 26 * H]);
  // El texto cambió en el servidor (misma hora): se quita y se pone con el nuevo.
  const misma = S.baseServidor(RID, AHORA + 2 * H);
  const q = S.planReconciliar({ recordatorios: [srv({ texto: 'La pastilla azul' })], borrados: [] }, [local(misma, AHORA + 2 * H)], AHORA);
  assert.deepEqual(q.quitar, [misma]);
  assert.equal(q.poner[0].texto, 'La pastilla azul');
  // Hecho (sin próxima): su alarma sobra.
  assert.deepEqual(S.planReconciliar({ recordatorios: [srv({ proxima: null, sonado: true })], borrados: [] }, [local(misma, AHORA + 2 * H)], AHORA).quitar, [misma]);
});

test('reconciliar: la que el servidor NO conoce (su guardado falló) se sube, no se quita; la que suena en segundos se deja', () => {
  const desconocida = S.baseServidor(RID2, AHORA + 3 * H);
  const p = S.planReconciliar({ recordatorios: [], borrados: [] }, [local(desconocida, AHORA + 3 * H)], AHORA);
  assert.deepEqual(p.quitar, []);
  assert.deepEqual(p.subir, [{ id: RID2, texto: 'La pastilla', cuando: AHORA + 3 * H, llamada: false }]);
  const yaSuena = S.baseServidor(RID, AHORA + 10_000);
  assert.deepEqual(S.planReconciliar({ recordatorios: [srv({ proxima: AHORA + 10_000 })], borrados: [] }, [local(yaSuena, AHORA + 10_000)], AHORA), { poner: [], quitar: [], subir: [] });
});

test('reconciliar: las alarmas viejas del teléfono se suben a la lista; ya adoptadas, la vieja se quita y queda la suya', () => {
  const vieja = local('aura-rec-mg1x2-9k3', AHORA + 4 * H, { texto: 'Llamar al banco' });
  const sube = S.planReconciliar({ recordatorios: [], borrados: [] }, [vieja], AHORA, { adoptar: true });
  assert.deepEqual(sube.subir, [{ local: 'aura-rec-mg1x2-9k3', texto: 'Llamar al banco', cuando: AHORA + 4 * H, llamada: false }]);
  assert.deepEqual(S.planReconciliar({ recordatorios: [], borrados: [] }, [vieja], AHORA).subir, [], 'sin adoptar, no se toca');
  const adoptada = S.planReconciliar({ recordatorios: [srv({ id: RID2, texto: 'Llamar al banco', proxima: AHORA + 4 * H, local: 'aura-rec-mg1x2-9k3' })], borrados: [] }, [vieja], AHORA, { adoptar: true });
  assert.deepEqual(adoptada.quitar, ['aura-rec-mg1x2-9k3']);
  assert.deepEqual(adoptada.poner.map((x: any) => x.rid), [RID2]);
});

test('la lista del servidor, sana: sin ids raros, sin los hechos', () => {
  const l = S.listaDelServidor({ recordatorios: [srv({}), srv({ id: '../x' }), srv({ id: RID2, hecho: true })], borrados: [RID2, 'nada'] });
  assert.deepEqual(l.recordatorios.map((r: any) => r.id), [RID]);
  assert.deepEqual(l.borrados, [RID2]);
  assert.equal(S.lineaDeRecordatorio({ proxima: null, repeticion: '', llamada: false }, AHORA), 'Ya sonó');
  assert.match(S.lineaDeRecordatorio({ proxima: AHORA + 26 * H, repeticion: 'todos los días', llamada: true }, AHORA), /· todos los días · te llamo$/);
});

/* ── el push de esa vez ──────────────────────────────────────────────────────────────────── */

test('el push de una vez cuya alarma ya estaba aquí no se enseña (no suena dos veces); si no estaba, sí', () => {
  const vez = AHORA + 2 * H;
  const puestas = S.anotarPuesta({}, S.baseServidor(RID, vez), vez, AHORA);
  assert.equal(S.pushYaSonoAqui({ rid: RID, cuando: vez }, puestas), true);
  assert.equal(S.pushYaSonoAqui({ rid: RID, cuando: vez + 24 * H }, puestas), false, 'otra vez del mismo recordatorio');
  assert.equal(S.pushYaSonoAqui({ cuando: vez }, puestas), false, 'un aviso sin rid');
  // Lo viejo se olvida.
  assert.deepEqual(S.anotarPuesta({ viejo: AHORA - 8 * 24 * H }, 'nuevo', AHORA, AHORA), { nuevo: AHORA });
  const datos = Push.leerDatos({ aura: 'push', tipo: 'recordatorio', id: 'rec-abc', para: 'u0123456789abcdef', enviado: String(vez), texto: 'La pastilla', rid: RID, cuando: String(vez) });
  assert.equal(datos.rid, RID);
  assert.equal(datos.cuando, vez);
  const K = { TriggerType: { TIMESTAMP: 0 }, AlarmType: { SET_AND_ALLOW_WHILE_IDLE: 2 }, AuthorizationStatus: { DENIED: 0 }, AndroidImportance: { HIGH: 4 } };
  assert.deepEqual(Push.planear(datos, { dueno: 'u0123456789abcdef', ahora: vez, k: K, yaSonoAqui: true }), { que: 'ignorar', porque: 'ya_sono' });
  assert.equal(Push.planear(datos, { dueno: 'u0123456789abcdef', ahora: vez, k: K, yaSonoAqui: false }).que, 'mostrar', 'otro aparato sin la alarma: el aviso suena');
  assert.equal(Push.leerDatos({ aura: 'push', tipo: 'mensaje', id: 'm1', para: 'u0123456789abcdef', rid: '../x' }).rid, '');
});

/* ── las alarmas del teléfono ────────────────────────────────────────────────────────────── */

function notifeeFalso() {
  const puestos = new Map<string, any>();
  return {
    puestos,
    m: {
      requestPermission: async () => ({ authorizationStatus: 1 }),
      createChannel: async () => 'canal',
      createTriggerNotification: async (n: any) => {
        puestos.set(n.id, n);
        return n.id;
      },
      getTriggerNotifications: async () => [...puestos.values()].map((notification) => ({ notification })),
      cancelTriggerNotifications: async (ids: string[]) => {
        for (const id of ids) puestos.delete(id);
      },
    },
  };
}
const K = { TriggerType: { TIMESTAMP: 0 }, AlarmType: { SET_AND_ALLOW_WHILE_IDLE: 2 }, AuthorizationStatus: { DENIED: 0, AUTHORIZED: 1 }, AndroidImportance: { HIGH: 4 } };

test('la alarma de un recordatorio del servidor lleva su id; cancelarlo por voz (su id) quita sus alarmas', async () => {
  Rec._olvidarRecordatorios();
  const f = notifeeFalso();
  const deps = { notifee: () => ({ m: f.m, k: K }), ahora: () => AHORA, dueno: () => 'u0123456789abcdef' };
  const r = await Rec.programarRecordatorio({ texto: 'La pastilla', cuando: AHORA + 2 * H, rid: RID }, deps);
  assert.equal(r.ok, true);
  assert.equal(r.id, S.baseServidor(RID, AHORA + 2 * H));
  assert.equal([...f.puestos.values()][0].data.rid, RID);
  const sin = await Rec.programarRecordatorio({ texto: 'Vieja', cuando: AHORA + 3 * H }, deps);
  assert.doesNotMatch(sin.id, S.RE_BASE_SERVIDOR, 'sin rid, la de siempre');
  const c = await Rec.cancelarRecordatorio(RID, deps);
  assert.equal(c.ok, true);
  assert.deepEqual([...f.puestos.keys()], [sin.id], 'solo quedan las que no son de ese recordatorio');
});

/* ── el marcador ─────────────────────────────────────────────────────────────────────────── */

test('el marcador: tel: con el número; por WhatsApp el chat y, si no abre, wa.me; un número raro no abre nada', async () => {
  assert.deepEqual(Marcar.enlacesDeMarcar({ numero: '+50498765432', via: 'telefono' }), ['tel:+50498765432']);
  assert.deepEqual(Marcar.enlacesDeMarcar({ numero: '+50498765432', via: 'whatsapp' }), ['whatsapp://send?phone=50498765432', 'https://wa.me/50498765432']);
  for (const n of ['98765432', '+504 9876', 'tel:+504', 'javascript:alert(1)', '']) assert.deepEqual(Marcar.enlacesDeMarcar({ numero: n, via: 'telefono' }), [], n);
  const abiertos: string[] = [];
  const ok = await Marcar.abrirMarcador({ numero: '+50498765432', via: 'telefono' }, async (u: string) => void abiertos.push(u));
  assert.equal(ok.ok, true);
  assert.equal(ok.detalle, 'Abrí el marcador: toca llamar.');
  assert.deepEqual(abiertos, ['tel:+50498765432']);
  // WhatsApp que no abre por su esquema: el enlace web.
  const wa = await Marcar.abrirMarcador({ numero: '+50498765432', via: 'whatsapp' }, async (u: string) => {
    if (u.startsWith('whatsapp:')) throw new Error('sin WhatsApp');
    abiertos.push(u);
  });
  assert.equal(wa.ok, true);
  assert.equal(wa.enlace, 'https://wa.me/50498765432');
  const nada = await Marcar.abrirMarcador({ numero: '+50498765432', via: 'telefono' }, async () => {
    throw new Error('no');
  });
  assert.deepEqual(nada, { ok: false, detalle: 'No pude abrir el marcador en este teléfono.' }, 'si no abrió, no se dice que abrió');
  assert.doesNotMatch(ok.detalle + wa.detalle, /habl|llam[eé]\b/, 'nunca «ya hablé con él»');
});

test('el puente de acciones: `marcar` solo con un número E.164 y su vía; `recordatorio` acepta el rid del servidor', () => {
  assert.equal(Acc.esAccionApp({ tipo: 'marcar', a: 'Carlos', via: 'telefono', numero: '+50498765432', nombre: 'Carlos' }), true);
  assert.equal(Acc.esAccionApp({ tipo: 'marcar', a: 'Carlos', via: 'telefono' }), false, 'sin número (lo que pidió el modelo) no se marca');
  assert.equal(Acc.esAccionApp({ tipo: 'marcar', a: 'x', via: 'sms', numero: '+50498765432' }), false);
  assert.equal(Acc.esAccionApp({ tipo: 'recordatorio', texto: 'x', cuando: AHORA, rid: RID }), true);
  assert.equal(Acc.esAccionApp({ tipo: 'recordatorio', texto: 'x', cuando: AHORA, rid: '../x' }), false);
});

test('reconciliar (revisión tanda E, B3): la alarma de la vez que el servidor ACABA de entregar no se quita aunque no haya sonado', () => {
  // El servidor reclamó la vez T (ultimaEntrega = T) y movió la próxima a T + 24 h; el push llega y reconcilia. El reloj
  // del teléfono va 3 s detrás (o Doze atrasó la alarma): la de T sigue puesta y es la única que va a sonar (su push se calla).
  const T = AHORA + 3_000;
  const deT = S.baseServidor(RID, T);
  const diario = { recordatorios: [srv({ proxima: T + 24 * H, ultimaEntrega: T })], borrados: [] };
  const p = S.planReconciliar(diario, [local(deT, T)], AHORA);
  assert.deepEqual(p.quitar, [], 'la de T se queda');
  assert.deepEqual(p.poner.map((x: any) => x.cuando), [T + 24 * H]);
  // De una vez (ya sin próxima): tampoco se quita la que acaba de entregar.
  const unaVez = { recordatorios: [srv({ proxima: null, sonado: true, ultimaEntrega: T })], borrados: [] };
  assert.deepEqual(S.planReconciliar(unaVez, [local(deT, T)], AHORA).quitar, []);
  // Borrado en el servidor: esa sí se quita.
  assert.deepEqual(S.planReconciliar({ recordatorios: [], borrados: [RID] }, [local(deT, T)], AHORA).quitar, [deT]);
  // listaDelServidor conserva ultimaEntrega.
  const leida = S.listaDelServidor({ recordatorios: [{ id: RID, texto: 'x', proxima: null, llamada: false, repetir: { tipo: 'una' }, sonado: true, ultimaEntrega: T }], borrados: [] });
  assert.equal(leida.recordatorios[0]?.ultimaEntrega, T);
});
