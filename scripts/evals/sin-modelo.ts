/**
 * La pasada SIN MODELO de la evaluación: lo determinista de cada caso.
 *
 *  · `agente`   → a quién convoca el panel de Dr Electrum (server/electrum/especialistas.ts).
 *  · `taller`   → qué acción reconoce el taller de AU-RA (lib/taller.ts).
 *  · `decision` → qué decide el motor de reglas (lib/cognitivo/politica.ts).
 *
 * Y aparte, el CLASIFICADOR contra `clasificacion` de cada caso: con reglas siempre, y con Laya si
 * se pide (`--laya`, con LAYA_URL puesta). Es la medida que dice si Laya decide mejor que las reglas
 * antes de pasar CLASIFICADOR_MODO de `sombra` a `laya`.
 *
 * Con `--laya-panel` (y ULTRON_LAYA_URL/ULTRON_LAYA_CLAVE puestas) repite el enrutado de Electrum con lo
 * que corre en producción, decidirPanel(): los nombrados primero y el resto lo decide Laya en la T4.
 * Esa pasada no entra en la línea base: depende de un nodo en red.
 *
 * Lo usa la prueba tests/evals.test.ts, que falla si la precisión baja de evals/linea-base.json, y
 * se puede correr suelto: `npx tsx scripts/evals/sin-modelo.ts [--laya]` imprime el informe.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cargarCasos, informe, revisarClasificacion, type Caso, type Informe, type Resultado } from '../../lib/cognitivo/evaluacion';
import { clasificarConLaya, clasificarConReglas } from '../../lib/cognitivo/clasificador';
import { convocar, decidirPanel } from '../../server/electrum/especialistas';
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

/** El clasificador contra lo que espera cada caso. `laya` necesita LAYA_URL; sin ella devuelve null. */
export async function pasadaClasificador(plataforma: 'ultron' | 'electrum', motor: 'reglas' | 'laya'): Promise<Informe | null> {
  const casos = cargarCasos(ARCHIVOS[plataforma]).filter((c) => c.clasificacion);
  const rs: Resultado[] = [];
  for (const c of casos) {
    const t0 = Date.now();
    const cl = motor === 'reglas' ? clasificarConReglas(c.pregunta, plataforma) : await clasificarConLaya(c.pregunta, plataforma);
    if (!cl) return null;
    const f = revisarClasificacion(c.clasificacion!, cl as any);
    rs.push({ id: c.id, area: c.area, ok: f.length === 0, fallos: f, ms: Date.now() - t0 });
  }
  return informe(plataforma, 'sin-modelo', rs);
}

/**
 * El enrutado de Electrum decidido como en producción (decidirPanel: nombrados, Laya, y la tabla si
 * Laya no pone a nadie). Si Laya no contesta, el caso cuenta como fallo con el motivo, para que la
 * cifra no se confunda con la de la tabla sola. Devuelve null si Laya no está configurado.
 */
export async function pasadaPanelLaya(): Promise<Informe | null> {
  const casos = cargarCasos(ARCHIVOS.electrum).filter((c) => c.espera.agente);
  const rs: Resultado[] = [];
  for (const c of casos) {
    const { panel, fuente, motivo, ms } = await decidirPanel(c.pregunta);
    if (motivo === 'sin configurar') return null;
    const ids = panel.map((e) => e.id);
    const f =
      motivo !== 'ok'
        ? [`Laya no contestó (${motivo})`]
        : ids[0] !== c.espera.agente
          ? [`${fuente} convocó ${ids.join('+') || 'a nadie'} y tocaba ${c.espera.agente} primero`]
          : [];
    rs.push({ id: c.id, area: c.area, ok: f.length === 0, fallos: f, ms });
  }
  return informe('electrum', 'sin-modelo', rs);
}

function imprimir(titulo: string, inf: Informe) {
  console.log(`\n${titulo}: ${inf.aciertos}/${inf.total} (${(inf.precision * 100).toFixed(1)} %)`);
  for (const [a, x] of Object.entries(inf.porArea)) console.log(`  ${a.padEnd(14)} ${x.aciertos}/${x.total}`);
  for (const r of inf.resultados.filter((x) => !x.ok)) console.log(`  ✗ ${r.id}: ${r.fallos.join('; ')}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  for (const p of ['ultron', 'electrum'] as const) {
    imprimir(`${p} · enrutado, taller y reglas`, pasadaSinModelo(p));
    imprimir(`${p} · clasificador (reglas)`, (await pasadaClasificador(p, 'reglas'))!);
    if (process.argv.includes('--laya')) {
      const l = await pasadaClasificador(p, 'laya');
      if (l) imprimir(`${p} · clasificador (Laya)`, l);
      else console.log(`\n${p} · clasificador (Laya): sin respuesta (¿LAYA_URL?)`);
    }
  }
  if (process.argv.includes('--laya-panel')) {
    const l = await pasadaPanelLaya();
    if (l) imprimir('electrum · panel decidido por Laya (producción)', l);
    else console.log('\nelectrum · panel por Laya: sin ULTRON_LAYA_URL');
  }
}
