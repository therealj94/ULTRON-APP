// Identidad · los recordatorios en un teléfono compartido (auditoría A04, A13) y la barrera de la
// actualización por aire (A24).
//
//  R4  Un aviso de A aparecía en el listado genérico: B lo listaba, lo cancelaba y AURA se lo leía.
//      Ahora cada aviso lleva el seudónimo de su dueño; B no ve, no cancela ni oye los de A; los viejos
//      sin dueño no se le atribuyen a nadie; bloqueado, el aviso es privado.
//  R5  Si falla el segundo aviso de una llamada, antes contestaba «no pude» con la primera llamada ya
//      agendada. Ahora se quita lo puesto (o se dice que quedó a medias).
//  A24 Con llamada, conversación, borrador o recordatorio sonando, la OTA no recarga: se pospone.
const { ok, fin } = require('../chat/comun.cjs');

const K = {
  TriggerType: { TIMESTAMP: 0 },
  AlarmType: { SET_AND_ALLOW_WHILE_IDLE: 2, SET_EXACT_AND_ALLOW_WHILE_IDLE: 3 },
  AuthorizationStatus: { DENIED: 0, AUTHORIZED: 1 },
  AndroidImportance: { HIGH: 4 },
  AndroidCategory: { CALL: 'call' },
  AndroidVisibility: { PRIVATE: 0, PUBLIC: 1 },
  EventType: { DISMISSED: 0, PRESS: 1, ACTION_PRESS: 2, DELIVERED: 3 },
};

/** Un notifee de mentira: guarda lo agendado; `fallarEn` hace fallar la n-ésima creación. */
function notifeeFalso(o = {}) {
  const f = { puestos: new Map(), creaciones: 0, cancelados: [] };
  f.m = {
    requestPermission: async () => ({ authorizationStatus: 1 }),
    createChannel: async () => 'canal',
    createTriggerNotification: async (n) => {
      f.creaciones++;
      if (o.fallarEn && f.creaciones === o.fallarEn) throw new Error('falla simulada');
      f.puestos.set(n.id, n);
      return n.id;
    },
    getTriggerNotifications: async () => [...f.puestos.values()].map((notification) => ({ notification })),
    ...(o.sinCancelar
      ? {}
      : {
          cancelTriggerNotifications: async (ids) => {
            f.cancelados.push(...ids);
            for (const id of ids) f.puestos.delete(id);
          },
        }),
  };
  return f;
}

(async () => {
  const M = require(process.env.IDENTIDAD || './out/identidad.cjs');
  const { RECORDATORIOS: R, CUENTA, BARRERA, CONTRATO } = M;
  console.log('identidad · los recordatorios\n');
  const ahora = Date.now();
  const f = notifeeFalso();
  const seud = (c) => (CUENTA ? CUENTA.seudonimoDe(c) : '');
  const deps = (quien) => ({ notifee: () => ({ m: f.m, k: K }), ahora: () => ahora, dueno: () => seud(quien) });

  /* ── R4: de quién es cada aviso ────────────────────────────────────────────────────── */
  const a = await R.programarRecordatorio({ texto: 'privado A: la pastilla', cuando: ahora + 3600_000 }, deps('a@prueba.local'));
  ok('A pone su recordatorio', a.ok === true, a.detalle);
  const aviso = [...f.puestos.values()][0];
  ok('el aviso lleva un dueño seudónimo (no el correo)', !!aviso?.data?.dueno && !JSON.stringify(aviso.data).includes('a@prueba.local'), JSON.stringify(aviso?.data));
  ok('bloqueado, el aviso es privado', aviso?.android?.visibility === K.AndroidVisibility.PRIVATE, String(aviso?.android?.visibility));
  const deB = await R.listarRecordatorios(deps('b@prueba.local'));
  ok('R4: B NO lista los recordatorios de A', deB.length === 0, JSON.stringify(deB));
  ok('sin nadie dentro no se lista ninguno', (await R.listarRecordatorios(deps(''))).length === 0);
  ok('A sí ve el suyo', (await R.listarRecordatorios(deps('a@prueba.local'))).map((x) => x.texto).join() === 'privado A: la pastilla');
  const cancelB = await R.cancelarRecordatorio(a.id, deps('b@prueba.local'));
  ok('B no puede cancelar el de A', cancelB.ok === false && f.puestos.size === 1, cancelB.detalle);
  // Un aviso viejo, de antes del dueño: no se le atribuye a quien esté.
  f.puestos.set('aura-rec-viejo', { id: 'aura-rec-viejo', data: { aura: 'recordatorio', base: 'aura-rec-viejo', texto: 'de nadie', cuando: String(ahora + 7200_000), paso: 'aviso', llamada: '0' } });
  ok('un aviso viejo sin dueño no se le atribuye a nadie', !(await R.listarRecordatorios(deps('a@prueba.local'))).some((x) => x.texto === 'de nadie'));
  f.puestos.delete('aura-rec-viejo');
  const sinDueno = await R.programarRecordatorio({ texto: 'algo', cuando: ahora + 3600_000 }, { notifee: () => ({ m: f.m, k: K }), ahora: () => ahora });
  ok('sin nadie dentro no se pone un aviso de nadie', sinDueno.ok === false, sinDueno.detalle);
  // La misma orden de dos personas son dos avisos: uno no pisa al otro.
  const b = await R.programarRecordatorio({ texto: 'privado A: la pastilla', cuando: ahora + 3600_000 }, deps('b@prueba.local'));
  ok('la misma orden de B no pisa la de A', b.ok && b.id !== a.id && f.puestos.size === 2, `${a.id} / ${b.id}`);
  // Lo que suena: solo para su dueño.
  if (R.esDeQuienEsta) {
    const llamadaA = await R.programarRecordatorio({ texto: 'llamada de A', cuando: ahora + 5400_000, llamada: true }, deps('a@prueba.local'));
    const l1 = f.puestos.get(`${llamadaA.id}-l1`);
    const ev = R.interpretarEvento({ type: K.EventType.DELIVERED, detail: { notification: l1 } }, K);
    ok('la llamada de A no es «de quien está» si está B', R.esDeQuienEsta(ev.llamada, deps('b@prueba.local')) === false && R.esDeQuienEsta(ev.llamada, deps('a@prueba.local')) === true);
    ok('la llamada también es privada bloqueado', l1?.android?.visibility === K.AndroidVisibility.PRIVATE);
  }

  /* ── R5: todo o nada ───────────────────────────────────────────────────────────────── */
  const g = notifeeFalso({ fallarEn: 2 });
  const r5 = await R.programarRecordatorio({ texto: 'prueba parcial', cuando: ahora + 120_000, llamada: true }, { notifee: () => ({ m: g.m, k: K }), ahora: () => ahora, dueno: () => seud('a@prueba.local') });
  ok('R5: falla el segundo aviso → ok:false', r5.ok === false, r5.detalle);
  ok('R5: …y NO queda ninguna llamada agendada (se quitó la primera)', g.puestos.size === 0, [...g.puestos.keys()].join());
  const h = notifeeFalso({ fallarEn: 2, sinCancelar: true });
  const r5b = await R.programarRecordatorio({ texto: 'prueba parcial', cuando: ahora + 120_000, llamada: true }, { notifee: () => ({ m: h.m, k: K }), ahora: () => ahora, dueno: () => seud('a@prueba.local') });
  ok('si no se puede quitar lo puesto, se dice que quedó a medias', r5b.ok === false && r5b.parcial === true && /medias|partly/.test(r5b.detalle), r5b.detalle);

  /* ── A24: la OTA no recarga con trabajo activo ─────────────────────────────────────── */
  if (!BARRERA) {
    ok('A24: hay barrera para la OTA', false, 'no existe lib/barreraOta');
  } else {
    const fuera = 11 * 60_000;
    ok('sin trabajo, vuelve tras 11 min: aplica', BARRERA.decidirAlVolver({ pendiente: true, fueraMs: fuera }) === 'aplicar');
    ok('vuelve tras 20 s: nada', BARRERA.decidirAlVolver({ pendiente: true, fueraMs: 20_000 }) === 'nada');
    CONTRATO.emitir('llamada', { activa: true, video: false });
    ok('A24: con llamada activa, se pospone', BARRERA.decidirAlVolver({ pendiente: true, fueraMs: fuera }) === 'posponer', BARRERA.motivosParaNoRecargar().join());
    CONTRATO.emitir('llamada', { activa: false, video: false });
    CONTRATO.emitir('voz', { libre: false });
    ok('A24: con la conversación de AURA abierta, se pospone', BARRERA.decidirAlVolver({ pendiente: true, fueraMs: fuera }) === 'posponer');
    CONTRATO.emitir('voz', { libre: true });
    let borrador = 'hola Beto';
    const quitar = BARRERA.registrarTrabajoActivo('borrador-prueba', () => !!borrador);
    ok('A24: con un borrador escrito, se pospone', BARRERA.decidirAlVolver({ pendiente: true, fueraMs: fuera }) === 'posponer');
    borrador = '';
    ok('sin el borrador, aplica', BARRERA.decidirAlVolver({ pendiente: true, fueraMs: fuera }) === 'aplicar');
    BARRERA.registrarTrabajoActivo('roto', () => {
      throw new Error('x');
    });
    ok('un comprobador que falla cuenta como ocupado', BARRERA.decidirAlVolver({ pendiente: true, fueraMs: fuera }) === 'posponer');
    quitar();
  }

  fin();
})();
