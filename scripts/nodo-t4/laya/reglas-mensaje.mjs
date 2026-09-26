// Corre las reglas actuales de AU-RA (clasificarConReglas de lib/cognitivo/clasificador.ts, plataforma
// 'ultron') sobre uno o varios JSONL del modelo `mensaje` y las traduce a sus etiquetas, para que
// evaluar.py las compare con el modelo etiqueta por etiqueta. Conserva los campos de cada fila y añade:
//   reglas        las etiquetas que dirían las reglas
//   reglas_cubre  las etiquetas sobre las que las reglas opinan en ESA fila (las demás no tienen regla)
//
//   cd scripts/nodo-t4/laya
//   npx tsx reglas-mensaje.mjs modelos/mensaje/datos/test_*.jsonl > /tmp/test-reglas.jsonl
//   python evaluar.py --modelo /opt/laya/modelo-mensaje --modelo-dir modelos/mensaje --test /tmp/test-reglas.jsonl
//
// Traducción (lo que hay; spam, abuso, estafa, crisis, urgente, molesto y triste no tienen regla):
//   tarea_*       ← tarea (conversacion → tarea_conversacion, dato_mercado → tarea_mercado, …)
//   razonar       ← requiereQwen
//   mueve_valor   ← riesgo 90 (solo lo da MUEVE_VALOR)
//   toca_sistema  ← riesgo 85 sin inyección (lo da TOCA_SISTEMA). Con inyección el 85 puede venir de
//                   cualquiera de las dos, así que en esa fila las reglas no opinan de toca_sistema.
//   ataque        ← inyeccion
import { readFileSync } from 'node:fs'
import { basename, dirname, extname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const AQUI = dirname(fileURLToPath(import.meta.url))
const { clasificarConReglas } = await import(pathToFileURL(resolve(AQUI, '../../../lib/cognitivo/clasificador.ts')).href)

const TAREA = {
  conversacion: 'tarea_conversacion',
  dato_mercado: 'tarea_mercado',
  conocimiento_empresa: 'tarea_empresa',
  accion_taller: 'tarea_accion',
  documento: 'tarea_documento',
  investigacion_web: 'tarea_web',
  sistema: 'tarea_sistema',
  transaccion_valor: 'tarea_transaccion',
}
const CUBRE = [...Object.values(TAREA), 'razonar', 'mueve_valor', 'toca_sistema', 'ataque']

if (process.argv.length < 3) {
  console.error('uso: npx tsx reglas-mensaje.mjs archivo.jsonl [más.jsonl…] > salida.jsonl')
  process.exit(2)
}
for (const archivo of process.argv.slice(2)) {
  const filas = readFileSync(archivo, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l))
  for (const f of filas) {
    const c = clasificarConReglas(f.q, 'ultron')
    const inyeccion = !!c.inyeccion
    const reglas = [TAREA[c.tarea] || 'tarea_conversacion']
    if (c.requiereQwen) reglas.push('razonar')
    if (c.riesgo === 90) reglas.push('mueve_valor')
    if (c.riesgo === 85 && !inyeccion) reglas.push('toca_sistema')
    if (inyeccion) reglas.push('ataque')
    const cubre = CUBRE.filter((e) => !(e === 'toca_sistema' && inyeccion && c.riesgo === 85))
    // _archivo: de dónde vino, para que evaluar.py agrupe los bordes aunque se concatenen varios archivos.
    console.log(JSON.stringify({ _archivo: basename(archivo, extname(archivo)), ...f, reglas, reglas_cubre: cubre }))
  }
}
