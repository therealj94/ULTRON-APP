/**
 * «A VECES EL MICRÓFONO FALLA» (José, 6-oct, APK 5.5.0 en su Samsung SM-S942B). Las migas de ese día al entrar a la mesa:
 *
 *   +2.6s segundo plano · oído de la mesa: lo suelta (nadie) · +2.7s primer plano
 *   +2.7s oído de la mesa: lo toma (mesa) (silenciado por la persona)
 *   +2.7s micrófono: arranca silenciado (la persona lo dejó así en otra sesión)
 *   +11.2s segundo plano · lo suelta · +11.3s primer plano · lo toma
 *
 * Dos causas, dos arreglos (mobile/src/lib/silencioMesa.ts y lib/appDelante.ts):
 *  · el silencio del micrófono se arrastraba de una sesión a otra para siempre. La 5.6.0 lo dejó valer solo en su
 *    proceso, y si Android mataba la app volvía con el micrófono ABIERTO (revisión del 6-oct). Ahora caduca por tiempo:
 *    8 h desde que se puso (vigente: arranca silenciada y lo dice; vencido: abre y también lo dice);
 *  · un parpadeo de segundo plano de ~0,1 s soltaba y volvía a tomar el oído: ahora hay una gracia.
 * Lo de la mesa con el código real y lo nativo simulado: mobile/pruebas/sonidos (las dos últimas pruebas).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { SILENCIO_VIGENCIA_MS, arranqueDelMicrofono, migaArranqueMic } from '../mobile/src/lib/silencioMesa';
import { GRACIA_FONDO_MS, GraciaFondo } from '../mobile/src/lib/appDelante';

const desk = fs.readFileSync(new URL('../mobile/src/screens/DeskScreen.tsx', import.meta.url), 'utf8');

test('lo guardado por la 5.5.0 (micMuted sin hora) ya no arranca silenciado: el micrófono abre y queda en la miga', () => {
  const a = arranqueDelMicrofono({ micMuted: true });
  assert.deepEqual(a, { silenciada: false, motivo: 'otra-sesion' });
  assert.match(migaArranqueMic(a), /^micrófono: abierto \(el silencio guardado venció/);
});

test('privacidad (revisión 6-oct a la 5.6.0): silenciado hace minutos y Android mató la app → la mesa vuelve SILENCIADA', () => {
  const t = 90_000_000;
  // Samsung mata la app en segundo plano, un ANR la cierra o una OTA monta tarde: es otro proceso, el silencio sigue.
  for (const hace of [3 * 60_000, 2 * 60_000 + 1, 45 * 60_000, SILENCIO_VIGENCIA_MS - 1]) {
    const a = arranqueDelMicrofono({ micMuted: true, micMutedEn: t - hace }, t);
    assert.deepEqual(a, { silenciada: true, motivo: 'vigente', desde: t - hace }, `silenciado hace ${hace} ms`);
  }
  assert.match(migaArranqueMic(arranqueDelMicrofono({ micMuted: true, micMutedEn: t - 3 * 60_000 }, t), t), /sigue silenciado \(lo silenciaste hace 3 min; el silencio vale 8 h\)/);
  // La 5.6.0 guardaba la sesión sin hora y la apuntaba antes de recargar por OTA: si llega esta OTA, cuenta desde ahí.
  const heredado = { sesion: 'sesion-5.6.0', en: t - 20_000 };
  assert.deepEqual(arranqueDelMicrofono({ micMuted: true, micMutedSesion: 'sesion-5.6.0' }, t, heredado), { silenciada: true, motivo: 'vigente', desde: t - 20_000 });
  assert.deepEqual(arranqueDelMicrofono({ micMuted: true, micMutedSesion: 'otra' }, t, heredado), { silenciada: false, motivo: 'otra-sesion' });
});

test('el silencio de ayer no deja sordo hoy: pasadas 8 h arranca abierto (motivo otra-sesion) y se dice', () => {
  const t = 90_000_000;
  assert.equal(SILENCIO_VIGENCIA_MS, 8 * 60 * 60_000, 'el plazo documentado');
  assert.deepEqual(arranqueDelMicrofono({ micMuted: true, micMutedEn: t - SILENCIO_VIGENCIA_MS }, t), { silenciada: false, motivo: 'otra-sesion' });
  assert.deepEqual(arranqueDelMicrofono({ micMuted: true, micMutedEn: t - 26 * 3_600_000 }, t), { silenciada: false, motivo: 'otra-sesion' });
  assert.deepEqual(arranqueDelMicrofono({ micMuted: true, micMutedEn: t + 10 * 60_000 }, t).silenciada, true, 'reloj movido atrás un rato: no se abre');
  assert.deepEqual(arranqueDelMicrofono({ micMuted: true, micMutedEn: t + 30 * 3_600_000 }, t).silenciada, false, 'una hora absurda no vale');
  assert.deepEqual(arranqueDelMicrofono({ micMuted: false, micMutedEn: t }, t), { silenciada: false, motivo: 'abierto' });
  assert.equal(migaArranqueMic({ silenciada: false, motivo: 'abierto' }), '');
});

test('DeskScreen: arranca con la hora del silencio, guarda la hora al silenciar, limpia el vencido y lo dice', () => {
  assert.match(desk, /const arranqueMic = arranqueDelMicrofono\(s, Date\.now\(\), await silencioHeredado\(\)\);/);
  assert.match(desk, /micMutedRef\.current = silenciada;\s*setMicMuted\(silenciada\);/);
  assert.match(desk, /if \(arranqueMic\.motivo === 'otra-sesion'\) void saveSettings\(\{ micMuted: false, micMutedEn: null, micMutedSesion: null \}\);/);
  assert.match(desk, /await saveSettings\(\{ micMuted: true, micMutedEn: Date\.now\(\), micMutedSesion: null \}\);/);
  assert.match(desk, /await saveSettings\(\{ micMuted: false, micMutedEn: null, micMutedSesion: null \}\);/);
  assert.match(desk, /const micReabierto = micOk && arranqueMic\.motivo === 'otra-sesion';/);
  assert.match(desk, /saludoArranque\(conPresentacion, \{ micSilenciado: micOk && silenciada, micReabierto,/, 'el saludo lo dice (silenciado o vencido)');
  assert.doesNotMatch(desk, /SESION_APP|sesionesDeEsteArranque/, 'ya no depende del proceso');
  assert.doesNotMatch(desk, /if \(micOk && !s\.micMuted\)/);
  const her = fs.readFileSync(new URL('../mobile/src/lib/silencioHeredado.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(her, /antesDeRecargar\(/, 'el silencio lleva su hora: ya no se apunta nada antes de una OTA');
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

test('CI: los sonidos de trabajo y el silencio del micrófono (mobile/pruebas/sonidos) corren con los otros arneses de la app', () => {
  const flujo = fs.readFileSync(new URL('../.github/workflows/calidad-movil.yml', import.meta.url), 'utf8');
  const arneses = flujo.slice(flujo.indexOf('- name: Arneses de la app'));
  assert.match(arneses, /working-directory: mobile/);
  assert.match(arneses, /\n\s+sh pruebas\/muletillas\/todas\.sh\n\s+sh pruebas\/sonidos\/todas\.sh\n/, 'con set -e, junto a oído y muletillas');
});
