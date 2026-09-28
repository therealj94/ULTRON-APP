/**
 * Alertas por Telegram: una vez por umbral y por medición, sin repetir tras un reinicio; los
 * textos dicen qué vence y cuándo, y qué midió el satélite.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const { textoVencimientos, textoSatelite, suscribir, desuscribir, suscrito, revisarAlertas } = await import('../server/electrum/alertas');
const { consulta, hayBase } = await import('../server/electrum/db');

test('textos: cuándo vence y qué midió el satélite', () => {
  const t = textoVencimientos(
    [
      { nombre: 'La Esperanza', expediente: 'EXP-9', vence: '01/10/2026', dias: 0 },
      { nombre: 'Cerro Viejo', expediente: null, vence: '02/10/2026', dias: 1 },
      { nombre: 'Río Frío', expediente: null, vence: '28/10/2026', dias: 30 },
    ],
    'Vencimientos:'
  );
  assert.match(t, /La Esperanza \(EXP-9\): vence HOY — 01\/10\/2026/);
  assert.match(t, /Cerro Viejo: vence mañana/);
  assert.match(t, /Río Frío: vence en 30 días/);
  assert.equal(textoVencimientos([], 'x'), '');
  const s = textoSatelite([{ nombre: 'Guasucarán', ha: 12.5, pct: 3.2 }], 'ene–mar 2025 → 2026');
  assert.match(s, /1 concesión/);
  assert.match(s, /Guasucarán: 12\.5 ha \(3\.2 % de lo comparable\)/);
  assert.match(s, /quema, sequía o cosecha/);
});

test('reloj: avisa una vez por umbral y por medición, y nada después', { skip: hayBase() ? false : 'sin ELECTRUM_DB_URL' }, async (t) => {
  const CHAT = 'chat-prueba-alertas';
  await consulta(`DELETE FROM concesion WHERE nombre LIKE 'prueba-alerta-%'`);
  const [{ id }] = await consulta<{ id: string }>(
    `INSERT INTO concesion (nombre, vence, geom) VALUES ('prueba-alerta-30', (now() AT TIME ZONE 'America/Tegucigalpa')::date + 30,
       ST_Multi(ST_GeomFromText('POLYGON((-83.6 17.1, -83.59 17.1, -83.59 17.11, -83.6 17.11, -83.6 17.1))', 4326))) RETURNING id::text`
  );
  await consulta(
    `INSERT INTO concesion (nombre, vence, geom) VALUES ('prueba-alerta-31', (now() AT TIME ZONE 'America/Tegucigalpa')::date + 31,
       ST_Multi(ST_GeomFromText('POLYGON((-83.62 17.1, -83.61 17.1, -83.61 17.11, -83.62 17.11, -83.62 17.1))', 4326)))`
  );
  await desuscribir(CHAT);
  await suscribir(CHAT, 'persona-prueba');
  assert.equal(await suscrito(CHAT), true);
  t.after(async () => {
    await desuscribir(CHAT);
    await consulta(`DELETE FROM concesion WHERE nombre LIKE 'prueba-alerta-%'`);
  });

  // Mediodía de hoy en Honduras (UTC−6): pasado el umbral de las 7.
  const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Tegucigalpa' }).format(new Date());
  const mediodia = new Date(`${hoy}T18:00:00Z`);
  const lunes = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Tegucigalpa', weekday: 'short' }).format(mediodia) === 'Mon';
  const enviados: Array<{ chat: string; texto: string }> = [];
  const enviar = async (chat: string, texto: string) => {
    if (chat === CHAT) enviados.push({ chat, texto });
    return { ok: true };
  };

  await revisarAlertas(enviar, mediodia);
  const umbral = enviados.find((m) => /umbral hoy/.test(m.texto));
  assert.ok(umbral, JSON.stringify(enviados).slice(0, 300));
  assert.match(umbral!.texto, /prueba-alerta-30: vence en 30 días/);
  assert.doesNotMatch(umbral!.texto, /prueba-alerta-31/);
  assert.equal(enviados.some((m) => /Resumen del lunes/.test(m.texto)), lunes);

  // Otra vuelta el mismo día: nada nuevo.
  enviados.length = 0;
  await revisarAlertas(enviar, mediodia);
  assert.equal(enviados.length, 0);

  // Llega una medición nueva del satélite: un aviso, una sola vez.
  await consulta(
    `INSERT INTO satelite_concesion (concesion_id, datos, periodo, fuente, cargado)
     VALUES ($1, '{"ha":100,"ha_comparable":90,"veg":[1,3000,2000],"ha_expuesto":0,"arc":[0,0,0],"fe":[0,0,0]}', 'prueba', 'prueba', now() + interval '1 second')
     ON CONFLICT (concesion_id) DO UPDATE SET datos = EXCLUDED.datos, cargado = EXCLUDED.cargado`,
    [id]
  );
  await revisarAlertas(enviar, mediodia);
  assert.equal(enviados.length, 1);
  assert.match(enviados[0].texto, /Nueva medición de Sentinel-2/);
  assert.match(enviados[0].texto, /• prueba-alerta-30: 5[.,]?000 ha/);
  enviados.length = 0;
  await revisarAlertas(enviar, mediodia);
  assert.equal(enviados.length, 0);

  // Antes de las 7 no sale el diario (otro chat recién suscrito).
  await desuscribir(CHAT);
  await suscribir(CHAT, 'persona-prueba');
  await revisarAlertas(enviar, new Date(`${hoy}T11:00:00Z`));
  assert.equal(enviados.length, 0);
});
