/**
 * La pasada CON MODELO: cada caso de evals/*.jsonl contra un servidor vivo, y un informe.
 *
 * Es el paso «benchmark interno → comparar contra producción → aprobar o rechazar» antes de
 * desplegar un modelo nuevo, un prompt nuevo o un cambio en las herramientas:
 *
 *   EVAL_SESION=<token de sesión> npx tsx scripts/evals/correr.ts \
 *     --url https://ultron-looi-desk.onrender.com --plataforma ultron --nivel mando \
 *     --salida evals/informes --anterior evals/informes/ultron-ultimo.json
 *
 * Las credenciales van por variable de entorno (EVAL_SESION o EVAL_LLAVE), nunca por argumento:
 * los argumentos quedan en el historial de la terminal y en la lista de procesos.
 *
 * Sale con código 1 si el informe nuevo es peor que el anterior (ver `comparar` en
 * lib/cognitivo/evaluacion.ts): así se puede poner en un pipeline y frenar el despliegue.
 */
import fs from 'node:fs';
import path from 'node:path';
import { cargarCasos, comparar, informe, revisarRespuesta, type Caso, type Informe, type Resultado, type Salida } from '../../lib/cognitivo/evaluacion';

function arg(nombre: string, def?: string) {
  const i = process.argv.indexOf(`--${nombre}`);
  return i >= 0 ? process.argv[i + 1] : def;
}

const URL_BASE = String(arg('url', 'http://127.0.0.1:3000')).replace(/\/$/, '');
const PLATAFORMA = arg('plataforma', 'ultron') === 'electrum' ? 'electrum' : 'ultron';
const NIVEL = arg('nivel', 'mando');
const AREA = arg('area');
const SALIDA = arg('salida', 'evals/informes');
const ANTERIOR = arg('anterior');
const TOLERANCIA = Number(arg('tolerancia', '0.02'));
const ESPERA_MS = Number(arg('espera', '80000'));

const archivo = path.join(process.cwd(), 'evals', PLATAFORMA === 'electrum' ? 'electrum.jsonl' : 'aura.jsonl');

/** Tiene algo que revisar en la respuesta de verdad (no solo en el enrutado o las reglas). */
function revisableEnVivo(c: Caso) {
  const e = c.espera;
  return !!(e.contiene || e.alguno || e.no_contiene || e.herramientas || e.sin_herramientas || e.max_palabras || e.max_ms || (e.agente && PLATAFORMA === 'electrum'));
}

function cabeceras(): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (process.env.EVAL_SESION) h['x-ultron-sesion'] = process.env.EVAL_SESION;
  if (process.env.EVAL_LLAVE) h[PLATAFORMA === 'electrum' ? 'x-electrum-llave' : 'x-ultron-mesa'] = process.env.EVAL_LLAVE;
  return h;
}

async function preguntar(c: Caso): Promise<Salida> {
  const t0 = Date.now();
  const ruta = PLATAFORMA === 'electrum' ? '/api/electrum/turno' : '/api/turno';
  const cuerpo = PLATAFORMA === 'electrum' ? { mensaje: c.pregunta, hilo: [] } : { message: c.pregunta, historial: [], mode: 'EVAL' };
  try {
    const r = await fetch(`${URL_BASE}${ruta}`, { method: 'POST', headers: cabeceras(), body: JSON.stringify(cuerpo), signal: AbortSignal.timeout(ESPERA_MS) });
    const j: any = await r.json().catch(() => ({}));
    const ms = Date.now() - t0;
    if (PLATAFORMA === 'electrum') {
      return { texto: String(j.texto || ''), herramientas: (j.traza || []).map((t: any) => t.herramienta), panel: String(j.panel || ''), ms, error: r.ok ? undefined : j.error || `HTTP ${r.status}` };
    }
    return { texto: String(j.reply || ''), herramientas: j.herramientas || [], ms, error: r.ok ? undefined : j.error || `HTTP ${r.status}` };
  } catch (e: any) {
    return { texto: '', herramientas: [], ms: Date.now() - t0, error: String(e?.message || e) };
  }
}

async function main() {
  const todos = cargarCasos(archivo).filter((c) => !AREA || c.area === AREA);
  const casos = todos.filter(revisableEnVivo).filter((c) => !c.como || String(c.como.nivel) === String(NIVEL === 'ninguno' ? null : NIVEL));
  const omitidos = todos.length - casos.length;
  console.log(`${casos.length} casos contra ${URL_BASE} (${PLATAFORMA}, nivel ${NIVEL}); ${omitidos} omitidos (solo sin modelo, o piden otro nivel).`);

  const resultados: Resultado[] = [];
  for (const c of casos) {
    const s = await preguntar(c);
    const r = revisarRespuesta(c, s);
    resultados.push(r);
    console.log(`${r.ok ? '✓' : '✗'} ${c.id.padEnd(8)} ${String(s.ms).padStart(6)} ms  ${r.ok ? '' : r.fallos.join('; ')}`);
  }

  const inf = informe(PLATAFORMA, 'con-modelo', resultados, process.env.EVAL_VERSION || null);
  fs.mkdirSync(SALIDA!, { recursive: true });
  const sello = inf.t.replace(/[:.]/g, '-');
  const json = path.join(SALIDA!, `${PLATAFORMA}-${sello}.json`);
  fs.writeFileSync(json, JSON.stringify(inf, null, 2));
  fs.writeFileSync(path.join(SALIDA!, `${PLATAFORMA}-${sello}.md`), markdown(inf));
  console.log(`\n${inf.aciertos}/${inf.total} (${(inf.precision * 100).toFixed(1)} %) · p50 ${inf.msP50} ms · p95 ${inf.msP95} ms\nInforme: ${json}`);

  if (ANTERIOR && fs.existsSync(ANTERIOR)) {
    const antes = JSON.parse(fs.readFileSync(ANTERIOR, 'utf8')) as Informe;
    const c = comparar(inf, antes, TOLERANCIA);
    console.log(c.aprobado ? 'APROBADO frente al informe anterior.' : `RECHAZADO frente al informe anterior:\n- ${c.motivos.join('\n- ')}`);
    if (!c.aprobado) process.exitCode = 1;
  }
}

function markdown(inf: Informe): string {
  const filas = Object.entries(inf.porArea)
    .map(([a, x]) => `| ${a} | ${x.aciertos}/${x.total} | ${(x.precision * 100).toFixed(0)} % |`)
    .join('\n');
  const fallos = inf.resultados
    .filter((r) => !r.ok)
    .map((r) => `- **${r.id}** (${r.area}): ${r.fallos.join('; ')}`)
    .join('\n');
  return `# Evaluación ${inf.plataforma} · ${inf.t}\n\n${inf.aciertos}/${inf.total} (${(inf.precision * 100).toFixed(1)} %) · p50 ${inf.msP50} ms · p95 ${inf.msP95} ms\n\n| Área | Aciertos | Precisión |\n|---|---|---|\n${filas}\n\n## Fallos\n\n${fallos || 'Ninguno.'}\n`;
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
