/**
 * «A VECES EL MICRÓFONO FALLA» (José, 6-oct, APK 5.5.0 en su Samsung SM-S942B). Las migas de ese día al entrar a la mesa:
 *
 *   +2.6s segundo plano · oído de la mesa: lo suelta (nadie) · +2.7s primer plano
 *   +2.7s oído de la mesa: lo toma (mesa) (silenciado por la persona)
 *   +2.7s micrófono: arranca silenciado (la persona lo dejó así en otra sesión)
 *   +11.2s segundo plano · lo suelta · +11.3s primer plano · lo toma
 *
 * Dos causas, dos arreglos (mobile/src/lib/silencioMesa.ts y lib/appDelante.ts):
 *  · el silencio del micrófono se arrastraba de una sesión a otra: ahora vale solo en la sesión en que se puso (si la
 *    mesa se vuelve a montar sin cerrar la app sigue, y se ve y se dice);
 *  · un parpadeo de segundo plano de ~0,1 s soltaba y volvía a tomar el oído: ahora hay una gracia.
 * Lo de la mesa con el código real y lo nativo simulado: mobile/pruebas/sonidos (las dos últimas pruebas).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { HEREDAR_MS, SESION_APP, arranqueDelMicrofono, migaArranqueMic, sesionesDelSilencio } from '../mobile/src/lib/silencioMesa';
import { GRACIA_FONDO_MS, GraciaFondo } from '../mobile/src/lib/appDelante';

const desk = fs.readFileSync(new URL('../mobile/src/screens/DeskScreen.tsx', import.meta.url), 'utf8');

test('lo guardado por la 5.5.0 (micMuted sin sesión) ya no arranca silenciado: el micrófono abre y queda en la miga', () => {
  const a = arranqueDelMicrofono({ micMuted: true });
  assert.deepEqual(a, { silenciada: false, motivo: 'otra-sesion' });
  assert.equal(migaArranqueMic(a), 'micrófono: abierto (el silencio de una sesión anterior no se arrastra)');
});

test('silenciado en ESTA sesión (la mesa se volvió a montar sin cerrar la app): sigue silenciado, y se dice', () => {
  const a = arranqueDelMicrofono({ micMuted: true, micMutedSesion: SESION_APP });
  assert.deepEqual(a, { silenciada: true, motivo: 'misma-sesion' });
  assert.match(migaArranqueMic(a), /sigue silenciado/);
  assert.deepEqual(arranqueDelMicrofono({ micMuted: true, micMutedSesion: 'sesion-de-ayer' }), { silenciada: false, motivo: 'otra-sesion' });
  assert.deepEqual(arranqueDelMicrofono({ micMuted: false, micMutedSesion: null }), { silenciada: false, motivo: 'abierto' });
});

test('una recarga por OTA NO es una sesión nueva: la sesión apuntada antes de recargar se hereda si vuelve a tiempo', () => {
  const t = 5_000_000;
  assert.deepEqual(sesionesDelSilencio(null, t), [SESION_APP]);
  assert.deepEqual(sesionesDelSilencio({ sesion: 'antes-de-la-ota', en: t - 3_000 }, t), [SESION_APP, 'antes-de-la-ota']);
  assert.deepEqual(sesionesDelSilencio({ sesion: 'antes-de-la-ota', en: t - HEREDAR_MS }, t), [SESION_APP], 'tarde: ya es otra sesión');
  assert.deepEqual(sesionesDelSilencio({ sesion: 42, en: t } as any, t), [SESION_APP], 'basura: nada');
  const heredadas = sesionesDelSilencio({ sesion: 'antes-de-la-ota', en: t - 3_000 }, t);
  assert.deepEqual(arranqueDelMicrofono({ micMuted: true, micMutedSesion: 'antes-de-la-ota' }, heredadas), { silenciada: true, motivo: 'misma-sesion' });
  const ota = fs.readFileSync(new URL('../mobile/src/lib/silencioHeredado.ts', import.meta.url), 'utf8');
  assert.match(ota, /antesDeRecargar\('silencio-del-microfono', \(\) => AsyncStorage\.setItem\(CLAVE, JSON\.stringify\(\{ sesion: SESION_APP, en: Date\.now\(\) \}\)\)\);/);
});

test('DeskScreen: arranca con arranqueDelMicrofono, guarda la sesión al silenciar y limpia el silencio viejo', () => {
  assert.match(desk, /const arranqueMic = arranqueDelMicrofono\(s, await sesionesDeEsteArranque\(\)\);/);
  assert.match(desk, /micMutedRef\.current = silenciada;\s*setMicMuted\(silenciada\);/);
  assert.match(desk, /if \(arranqueMic\.motivo === 'otra-sesion'\) void saveSettings\(\{ micMuted: false, micMutedSesion: null \}\);/);
  assert.match(desk, /await saveSettings\(\{ micMuted: true, micMutedSesion: SESION_APP \}\);/);
  assert.match(desk, /await saveSettings\(\{ micMuted: false, micMutedSesion: null \}\);/);
  assert.match(desk, /saludoArranque\(conPresentacion, \{ micSilenciado: micOk && silenciada,/, 'el saludo lo dice si sigue silenciado');
  assert.doesNotMatch(desk, /if \(micOk && !s\.micMuted\)/, 'ya no abre según el silencio guardado de otra sesión');
  assert.doesNotMatch(desk, /arranca silenciado \(la persona lo dejó así en otra sesión\)/);
});

test('un parpadeo de segundo plano no suelta el oído; uno de verdad sí (y volver es inmediato)', () => {
  let ahora = 0;
  const relojes: { en: number; f: () => void; vivo: boolean }[] = [];
  const avanzar = (ms: number) => {
    const hasta = ahora + ms;
    for (const r of relojes.filter((x) => x.vivo && x.en <= hasta).sort((a, b) => a.en - b.en)) {
      r.vivo = false;
      ahora = r.en;
      r.f();
    }
    ahora = hasta;
  };
  const cambios: boolean[] = [];
  const migas: string[] = [];
  const g = new GraciaFondo({
    alCambiar: (v) => cambios.push(v),
    miga: (t) => migas.push(t),
    ahora: () => ahora,
    setTimeout: (f, ms) => {
      const r = { en: ahora + ms, f, vivo: true };
      relojes.push(r);
      return r;
    },
    clearTimeout: (h) => ((h as { vivo: boolean }).vivo = false),
  });
  // Las migas del 6-oct: 0,1 s detrás, dos veces.
  for (let i = 0; i < 2; i++) {
    g.estado('background');
    avanzar(100);
    g.estado('active');
    avanzar(8_000);
  }
  assert.deepEqual(cambios, []);
  assert.equal(migas.length, 2);
  g.estado('background');
  avanzar(GRACIA_FONDO_MS - 1);
  assert.deepEqual(cambios, []);
  avanzar(1);
  assert.deepEqual(cambios, [false]);
  assert.equal(g.esDelante, false);
  g.estado('active');
  assert.deepEqual(cambios, [false, true]);
});

test('DeskScreen: la app «delante» de la mesa pasa por la gracia (no por AppState a secas)', () => {
  assert.match(desk, /const gracia = new GraciaFondo\(\{ alCambiar: setAppActiva, miga \}, AppState\.currentState !== 'background'\);/);
  assert.match(desk, /AppState\.addEventListener\('change', \(st\) => gracia\.estado\(st\)\)/);
  assert.doesNotMatch(desk, /AppState\.addEventListener\('change', \(st\) => setAppActiva\(st !== 'background'\)\)/);
});
