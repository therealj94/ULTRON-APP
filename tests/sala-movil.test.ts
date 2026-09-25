/**
 * La sala que va dentro de la APK es la misma que la de la web.
 *
 * mobile/src/sala/salaHtml.ts se genera desde src/11-sala; si alguien toca la sala y no lo regenera,
 * el teléfono se queda con la versión vieja sin que nada lo avise. Esto la vuelve a empaquetar y
 * compara. Y el reparto herramienta → gesto del teléfono (mobile/src/lib/tareas.ts, una copia porque
 * Metro no sale de mobile/) tiene que coincidir con el de la web.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { tareaDeHerramientas as web } from '../src/11-sala/tareas';
import { tareaDeHerramientas as movil } from '../mobile/src/lib/tareas';
import { DESTINO, generar } from '../scripts/sala-movil.mjs';

test('la sala del teléfono está al día con src/11-sala', async () => {
  const actual = fs.readFileSync(DESTINO, 'utf8');
  assert.ok(actual === (await generar()), 'mobile/src/sala/salaHtml.ts desactualizado: corre `node scripts/sala-movil.mjs`');
});

test('la sala del teléfono trae su puente y no depende de la red', () => {
  const actual = fs.readFileSync(DESTINO, 'utf8');
  assert.match(actual, /__aura/);
  assert.match(actual, /ReactNativeWebView/);
  assert.doesNotMatch(actual, /<script[^>]+src=/);
});

test('el teléfono y la web sacan el mismo gesto de cada herramienta', () => {
  const casos: string[][] = [
    [], ['web'], ['pagina'], ['oro'], ['plata', 'hnl'], ['metales'], ['fx'], ['pdf-leer'], ['pdf'], ['rag'],
    ['tareas'], ['memoria'], ['recordar'], ['vision'], ['escena'], ['foto'], ['enviar'], ['telegram'], ['whatsapp'],
    ['correo'], ['urgente'], ['llamada'], ['web', 'oro', 'telegram'], ['oro', 'web'], ['cerebro-genesis', 'cot'], [' WEB '],
  ];
  for (const c of casos) assert.equal(movil(c), web(c), c.join(','));
  assert.equal(movil(null), null);
});
