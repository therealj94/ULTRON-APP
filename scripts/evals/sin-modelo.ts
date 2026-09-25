/**
 * La pasada SIN MODELO de la evaluación: lo determinista de cada caso.
 *
 *  · `agente`   → a quién convoca el panel de Dr Electrum (server/electrum/especialistas.ts).
 *  · `taller`   → qué acción reconoce el taller de AU-RA (lib/taller.ts).
 *  · `decision` → qué decide el motor de reglas (lib/cognitivo/politica.ts).
 *
 * Lo usa la prueba tests/evals.test.ts, que falla si la precisión baja de evals/linea-base.json, y
 * se puede correr suelto: `npx tsx scripts/evals/sin-modelo.ts` imprime el informe.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cargarCasos, informe, type Caso, type Informe, type Resultado } from '../../lib/cognitivo/evaluacion';
import { convocar } from '../../server/electrum/especialistas';
import { parsePedido } from '../../lib/taller';
import { evaluar } from '../../lib/cognitivo/politica';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const ARCHIVOS = { ultron: path.join(RAIZ, 'evals/aura.jsonl'), electrum: path.join(RAIZ, 'evals/electrum.jsonl') } as const;

export function revisarSinModelo(c: Caso, plataforma: 'ultron' | 'electrum'): Resultado | null {
  const e = c.espera;
  const f: string[] = [];
  let aplica = false;
  if (e.agente) {
    aplica = true;
    const panel = convocar(c.pregunta).map((x) => x.id);
    if (panel[0] !== e.agente) f.push(`convocó ${panel.join('+') || 'a nadie'} y tocaba ${e.agente} primero`);
  }
  if (e.taller !== undefined) {
    aplica = true;
    const acc = parsePedido(c.pregunta).accion;
    if (acc !== e.taller) f.push(`el taller entendió ${acc ?? 'nada'} y era ${e.taller ?? 'nada'}`);
  }
  if (e.decision) {
    aplica = true;
    const d = e.decision;
    const r = evaluar({
      herramienta: d.herramienta,
      efecto: d.efecto,
      plataforma,
      args: {},
      quien: d.quien ?? null,
      nivel: d.nivel,
      prueba: d.prueba,
      riesgo: d.riesgo ?? null,
      destino: d.destino ?? null,
      hechos: d.hechos as any,
    });
    if (r.veredicto !== d.veredicto) f.push(`las reglas dijeron ${r.veredicto} (${r.regla}) y tocaba ${d.veredicto}`);
  }
  return aplica ? { id: c.id, area: c.area, ok: f.length === 0, fallos: f } : null;
}

export function pasadaSinModelo(plataforma: 'ultron' | 'electrum'): Informe {
  const casos = cargarCasos(ARCHIVOS[plataforma]);
  const rs = casos.map((c) => revisarSinModelo(c, plataforma)).filter((r): r is Resultado => !!r);
  return informe(plataforma, 'sin-modelo', rs);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  for (const p of ['ultron', 'electrum'] as const) {
    const inf = pasadaSinModelo(p);
    console.log(`\n${p}: ${inf.aciertos}/${inf.total} (${(inf.precision * 100).toFixed(1)} %)`);
    for (const [a, x] of Object.entries(inf.porArea)) console.log(`  ${a.padEnd(14)} ${x.aciertos}/${x.total}`);
    for (const r of inf.resultados.filter((x) => !x.ok)) console.log(`  ✗ ${r.id}: ${r.fallos.join('; ')}`);
  }
}
