/**
 * El system de Dr Electrum tiene que caber ENTERO en lo que el nodo le pasa al modelo.
 *
 * El proxy del A10G (scripts/nodo-a10g/ollama-proxy-ndjson.py) cortaba el system a 4500
 * caracteres. El de Dr Electrum pasa de 27.000: el modelo se quedaba con la personalidad y perdía
 * el oficio, el conocimiento minero y —al final— la instrucción de herramientas. Contestaba de
 * memoria: «no tengo el padrón delante» con el catastro vivo, y una ley de corte de 24 g/t donde la
 * cuenta daba 0,56. Ahora el proxy deja pasar 60.000 caracteres (llama-server con --ctx-size 24576);
 * esto avisa si el prompt crece hasta no dejar sitio a la pregunta, a un extracto de documento y a lo
 * que devuelven las herramientas.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { personalidadElectrum } from '../server/electrum/personalidad';
import { ESPECIALISTAS, herramientasDe, promptPanel } from '../server/electrum/especialistas';
import { CONOCIMIENTO_MINAS } from '../src/08-cerebro-minas/conocimiento';
import { instruccionHermes } from '../lib/agente/protocolo';
import { manosDe, TODAS } from '../server/electrum/manos';
import { MEMORIA_ESTRUCTURADA } from '../lib/manos/memoria';

const PROXY = fs.readFileSync('scripts/nodo-a10g/ollama-proxy-ndjson.py', 'utf8');
const MAX_PROXY = Number(PROXY.match(/PROXY_MAX_CHARS", "(\d+)"/)?.[1]);
/**
 * Lo que se deja libre: un extracto de documento de Telegram (hasta 12.000 caracteres, ver
 * server/electrum/telegram.ts), la pregunta, las líneas del cerebro y las fichas.
 */
const HOLGURA = 20000;

test('el system de Dr Electrum cabe entero en el proxy del nodo, con cualquier panel', () => {
  assert.ok(MAX_PROXY >= 30000, `el proxy recorta a ${MAX_PROXY}`);
  assert.doesNotMatch(PROXY, /\[:4500\]/, 'el recorte viejo del system no puede volver');
  const E = ESPECIALISTAS;
  const paneles: (typeof E)[] = [[]];
  for (let i = 0; i < E.length; i++) {
    paneles.push([E[i]]);
    for (let j = i + 1; j < E.length; j++) {
      paneles.push([E[i], E[j]]);
      for (let k = j + 1; k < E.length; k++) paneles.push([E[i], E[j], E[k]]);
    }
  }
  for (const panel of paneles) {
    const herramientas = [...(panel.length ? manosDe(herramientasDe(panel)) : TODAS), ...MEMORIA_ESTRUCTURADA];
    const system = [
      personalidadElectrum({ nombre: 'José', nivel: 'mando', canal: 'mesa' }),
      promptPanel(panel),
      'CEREBRO DE MINAS:',
      CONOCIMIENTO_MINAS,
      instruccionHermes(herramientas),
    ].join('\n\n');
    const nombre = panel.map((e) => e.nombre).join(' + ') || 'sin panel';
    assert.ok(system.length + HOLGURA <= MAX_PROXY, `${nombre}: ${system.length} caracteres no dejan sitio en ${MAX_PROXY}`);
  }
});
