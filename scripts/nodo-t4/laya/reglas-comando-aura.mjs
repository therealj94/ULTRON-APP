// Corre el CAMINO RÁPIDO de AU-RA (ordenPorReglas de lib/acciones-app.ts, las reglas que contestan en
// milisegundos antes que Laya y el cerebro) sobre los JSONL de AU-RA del modelo «comando» y lo traduce
// a las etiquetas del grupo `app`, para medir lo que ya cubren las reglas y compararlas con Laya.
//
//   cd scripts/nodo-t4/laya
//   npx tsx reglas-comando-aura.mjs modelos/comando/datos/test_aura.jsonl modelos/comando/datos/bordes_aura.jsonl
//   npx tsx reglas-comando-aura.mjs --anotar modelos/comando/datos/test_aura.jsonl > /tmp/test-aura-reglas.jsonl
//   python evaluar.py --modelo /opt/laya/modelo-comando --modelo-dir modelos/comando --evals /tmp/test-aura-reglas.jsonl
//
// Con --anotar escribe cada fila con `reglas` y `reglas_cubre` (lo que lee evaluar.py); sin él, imprime
// exactitud del grupo, precisión y recall por etiqueta, y los falsos positivos sobre los negativos.
// LIB=/otra/copia/lib mide otra versión de las reglas (p. ej. la de antes de las manos).
//
// Traducción: una acción o propuesta de las manos → su etiqueta (llamar con video → app_videollamar,
// recordatorio con llamada → app_llamar_recordar…); `presencia` → app_presencia; lo que solo se
// contesta (qué recordatorios tengo) → app_listar_recordatorios; las órdenes de siempre (atrás, tema,
// silencio…) y lo que las reglas no reconocen → app_ninguna (ahí contesta el cerebro).
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const AQUI = dirname(fileURLToPath(import.meta.url))
const LIB = resolve(process.env.LIB || resolve(AQUI, '../../../lib'))
const { ordenPorReglas } = await import(pathToFileURL(resolve(LIB, 'acciones-app.ts')).href)

const NOMBRES = ['Mamá', 'Beto Pérez', 'Ana López', 'Esposa', 'Hermano', 'Don Chepe', 'Karla', 'Profe Carlos', 'Papá', 'Abuela', 'Medardo', 'Jefe',
  'Tía Rosa', 'José', 'Hija', 'Licenciado', 'María José', 'Compadre', 'Prima', 'Doctor Ramírez', 'Vecina', 'Suegra', 'Pastor', 'Lupita', 'Cuñado', 'Don Ramón']
const contactos = NOMBRES.map((n, i) => ({ correo: `c${i}@prueba.hn`, nombre: n }))
// Un recordatorio por texto de los datos, cada uno a su hora (para «cancela el de las 5»).
const AHORA = Date.now()
const TEXTOS = ['tomar la pastilla', 'llamar a mi mamá', 'sacar la ropa', 'pagar la luz', 'la cita del doctor', 'ir al banco', 'llevar el carro al taller',
  'tomar la medicina', 'la misa', 'pagar la tarjeta', 'hacer la tarea con la niña', 'llamar al banco', 'la reunión con el ingeniero', 'regar las matas']
const hoy = new Date(AHORA - 6 * 3600_000)
const aLas = (h) => Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), hoy.getUTCDate() + 1, h + 6, 0)
const recordatorios = TEXTOS.map((t, i) => ({ id: `aura-rec-eval-${i}`, texto: t, cuando: aLas(6 + i), llamada: i % 2 === 0 }))
const MANOS = ['llamar', 'leer', 'buscar', 'idioma', 'perfil', 'recordatorio', 'recordatorio_llamada']
const contexto = { pantalla: 'mesa', contactos, manos: MANOS, recordatorios }
const CUBRE = ['app_ninguna', 'app_recordar', 'app_llamar_recordar', 'app_listar_recordatorios', 'app_cancelar_recordatorio', 'app_llamar', 'app_videollamar',
  'app_colgar', 'app_leer', 'app_responder', 'app_buscar_chats', 'app_silenciar_chat', 'app_idioma', 'app_perfil', 'app_presencia', 'app_buscar_internet']

function etiqueta(o) {
  if (!o) return 'app_ninguna'
  const p = o.propuesta
  if (p?.tipo === 'llamar') return p.video ? 'app_videollamar' : 'app_llamar'
  if (p?.tipo === 'recordatorio') return p.llamada ? 'app_llamar_recordar' : 'app_recordar'
  if (p?.tipo === 'cancelar_recordatorio') return 'app_cancelar_recordatorio'
  if (o.soloDecir) return /encuentro ese recordatorio|can't find that reminder/i.test(o.decir) ? 'app_cancelar_recordatorio' : 'app_listar_recordatorios'
  const a = o.accion
  switch (a?.tipo) {
    case 'leer': return 'app_leer'
    case 'buscar': return 'app_buscar_chats'
    case 'idioma': return 'app_idioma'
    case 'perfil': return 'app_perfil'
    case 'presencia': return 'app_presencia'
    case 'redactar': return 'app_responder'
    default: return 'app_ninguna'
  }
}

const args = process.argv.slice(2)
const anotar = args[0] === '--anotar'
const archivos = anotar ? args.slice(1) : args
if (!archivos.length) {
  console.error('uso: npx tsx reglas-comando-aura.mjs [--anotar] archivo.jsonl […]')
  process.exit(2)
}
const filas = []
for (const archivo of archivos) {
  for (const l of readFileSync(archivo, 'utf8').split('\n')) {
    if (!l.trim()) continue
    const f = JSON.parse(l)
    const oro = f.e.find((x) => x.startsWith('app_')) || 'app_ninguna'
    // Inglés si trae palabras de inglés y ninguna de español (hay frases mezcladas: cuentan como español).
    const idioma = /\b(the|to|my|call|read|what|switch|speak|go|search|list|mute|hang|reply|cancel|remind|reminders|messages)\b/i.test(f.q) && !/\b(de|que|las|mi|el|la|los|no|ya|por|para|en)\b/i.test(f.q) ? 'en' : 'es'
    const dicho = etiqueta(ordenPorReglas(f.q, { contexto, idioma, ahora: AHORA }))
    filas.push({ ...f, oro, dicho })
    if (anotar) console.log(JSON.stringify({ ...f, reglas: [...f.e.filter((x) => !x.startsWith('app_')), dicho], reglas_cubre: CUBRE }))
  }
}
if (!anotar) {
  const n = filas.length
  const bien = filas.filter((f) => f.oro === f.dicho).length
  const negativos = filas.filter((f) => f.oro === 'app_ninguna')
  const fp = negativos.filter((f) => f.dicho !== 'app_ninguna')
  const positivos = filas.filter((f) => f.oro !== 'app_ninguna')
  const cubiertas = positivos.filter((f) => f.dicho === f.oro)
  const equivocadas = positivos.filter((f) => f.dicho !== 'app_ninguna' && f.dicho !== f.oro)
  console.log(`reglas de AU-RA (${LIB}) sobre ${archivos.map((a) => a.split('/').pop()).join(' + ')}: ${n} frases`)
  console.log(`  exactitud grupo app ${(bien / n).toFixed(3)} · órdenes resueltas por reglas ${cubiertas.length}/${positivos.length} (${(cubiertas.length / Math.max(1, positivos.length)).toFixed(3)}) · con la mano equivocada ${equivocadas.length} · falsos positivos en negativos ${fp.length}/${negativos.length}`)
  for (const e of CUBRE.slice(1)) {
    const oro = filas.filter((f) => f.oro === e).length
    const pred = filas.filter((f) => f.dicho === e).length
    const tp = filas.filter((f) => f.oro === e && f.dicho === e).length
    console.log(`  ${e.padEnd(28)} recall ${(tp / Math.max(1, oro)).toFixed(2)} (${tp}/${oro})  precisión ${pred ? (tp / pred).toFixed(2) : '  - '}`)
  }
  if (process.env.FALLOS) for (const f of filas.filter((x) => x.oro !== x.dicho)) console.log(`   ${f.oro} → ${f.dicho} · ${f.q}`)
}
