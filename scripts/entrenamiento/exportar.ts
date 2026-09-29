/**
 * EXPORTA LO REVISADO: de las trazas de producción a los archivos con los que se entrenan Laya y Qwen.
 *
 *   EVAL_SESION=<sesión con mando en Dr Electrum> npx tsx scripts/entrenamiento/exportar.ts \
 *     [--url https://ultron-looi-desk.onrender.com] [--salida entrenamiento/salida]
 *
 * La credencial va por variable de entorno, nunca por argumento (queda en el historial). Escribe en
 * `--salida` (fuera del repositorio: son preguntas reales, aunque ya sin datos personales):
 *
 *   laya-electrum/train_reales.jsonl   {q, e}: a quién debió convocar la mesa (para el nodo T4)
 *   qwen-sft.jsonl                     conversaciones aprobadas o corregidas (para el ajuste LoRA)
 *   herramientas.json                  las definiciones de herramientas que usan esos ejemplos
 *   evals-candidatas.jsonl             casos para evals/electrum.jsonl (revisarlos antes de sumarlos)
 *   informe.json                       qué entró, qué no y por qué, y dónde falla hoy
 *
 * Con `--prueba-humo N` escribe ADEMÁS qwen-sft-PRUEBA-sin-revisar.jsonl: N respuestas reales de Qwen
 * con herramientas, SIN revisar, solo para probar de punta a punta el ajuste (entrenar_lora.py) con un
 * modelo chico. Nunca para entrenar el modelo de producción: no las aprobó nadie.
 *
 * Qué entra y qué no lo decide lib/entrenamiento/dataset.ts (con sus pruebas).
 */
import fs from 'node:fs';
import path from 'node:path';
import { ejemploQwen, esDeQwen, exportar, traerTodas, type EjemploQwen, type TrazaParaEntrenar } from '../../lib/entrenamiento/dataset';
import { herramientasNativas } from '../../lib/agente/protocolo';
import { TODAS } from '../../server/electrum/manos';

function arg(nombre: string, def: string) {
  const i = process.argv.indexOf(`--${nombre}`);
  return i >= 0 ? String(process.argv[i + 1]) : def;
}

/**
 * El system de los ejemplos. El de producción pasa de 39 000 caracteres y no entra en una secuencia
 * de entrenamiento; este dice lo esencial del oficio y el ajuste aprende el comportamiento (qué
 * herramienta, con qué argumentos, cómo contestar), que es lo que se lleva al system completo.
 */
export const SISTEMA_ENTRENAMIENTO = [
  'Sos Dr Electrum, geólogo sénior de la plataforma minera ELECTRUM en Honduras, con Don Chema (metalurgista) y la Ing. Tatiana (civil y ambiental).',
  'Todo dato del catastro, de un expediente, de la geología o de internet sale de tus herramientas: llamalas antes de contestar y no inventes concesiones, cifras ni fechas.',
  'Contestá en español de Honduras, claro y breve, citando de dónde sale cada dato. Si algo no está, decilo.',
].join(' ');

async function main() {
  const url = arg('url', 'https://ultron-looi-desk.onrender.com').replace(/\/$/, '');
  const salida = arg('salida', 'entrenamiento/salida');
  const limite = 500; // el tope del servidor por página; se recorren todas las páginas
  const sesion = process.env.EVAL_SESION;
  if (!sesion) throw new Error('Falta EVAL_SESION (una sesión con mando en Dr Electrum).');

  const trazas = await traerTodas(async (antes) => {
    const r = await fetch(`${url}/api/cognitivo/trazas?limite=${limite}${antes ? `&antes=${encodeURIComponent(antes)}` : ''}`, { headers: { 'x-ultron-sesion': sesion } });
    if (!r.ok) throw new Error(`El servidor contestó ${r.status}: ${(await r.text()).slice(0, 200)}`);
    return ((await r.json()) as { trazas: TrazaParaEntrenar[] }).trazas || [];
  });

  const reales = new Set(TODAS.map((h) => h.nombre));
  const x = exportar(trazas, reales, SISTEMA_ENTRENAMIENTO);

  const escribir = (archivo: string, filas: unknown[]) => {
    const ruta = path.join(salida, archivo);
    fs.mkdirSync(path.dirname(ruta), { recursive: true });
    fs.writeFileSync(ruta, filas.map((f) => JSON.stringify(f)).join('\n') + (filas.length ? '\n' : ''));
  };
  escribir('laya-electrum/train_reales.jsonl', x.laya.map(({ q, e }) => ({ q, e })));
  escribir('qwen-sft.jsonl', x.qwen);
  escribir('evals-candidatas.jsonl', x.evals);
  const humo = Number(arg('prueba-humo', '0'));
  let prueba: EjemploQwen[] = [];
  if (humo > 0) {
    prueba = trazas
      .filter((t) => esDeQwen(t) && !t.error && t.pasos.some((p) => p.ok && reales.has(p.herramienta) && p.args))
      .map((t) => ejemploQwen({ ...t, feedback: 1, feedback_nota: null }, reales, SISTEMA_ENTRENAMIENTO))
      .flatMap((r) => ('ejemplo' in r ? [r.ejemplo] : []))
      .slice(0, humo);
    escribir('qwen-sft-PRUEBA-sin-revisar.jsonl', prueba);
  }
  const usadas = new Set([...x.qwen, ...prueba].flatMap((e) => e.herramientas));
  fs.writeFileSync(path.join(salida, 'herramientas.json'), JSON.stringify(herramientasNativas(TODAS.filter((h) => usadas.has(h.nombre) || usadas.size === 0)), null, 1));
  fs.writeFileSync(path.join(salida, 'informe.json'), JSON.stringify({ desde: url, cuando: new Date().toISOString(), ...x.informe }, null, 1));

  const i = x.informe;
  console.log(`trazas ${i.trazas} · revisadas ${i.revisadas}`);
  console.log(`Laya electrum: ${i.laya} filas · Qwen: ${i.qwen.aprobadas} aprobadas + ${i.qwen.corregidas} corregidas · evals: ${i.evals}`);
  console.log(`excluidas: ${JSON.stringify(i.excluidas)}`);
  console.log(`señales: ${i.senales.llamadasIlegibles} turnos con llamadas ilegibles, ${i.senales.sinRondas} sin rondas, ${i.senales.errores} con error`);
  if (humo > 0) console.log(`prueba de humo: ${prueba.length} conversaciones SIN revisar en qwen-sft-PRUEBA-sin-revisar.jsonl (solo para probar el ajuste)`);
  console.log(`archivos en ${salida}/`);
}

main().catch((e) => {
  console.error(String(e?.message || e));
  process.exit(1);
});
