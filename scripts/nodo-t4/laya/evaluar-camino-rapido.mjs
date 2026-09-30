// Mide el CAMINO RÁPIDO de AU-RA de punta a punta (lo que de verdad se ejecuta sin el cerebro) sobre
// los JSONL del grupo `app` de Laya «comando», ANTES y DESPUÉS de Laya ligera, por etiqueta y por idioma.
//
//   cd scripts/nodo-t4/laya
//   npx tsx evaluar-camino-rapido.mjs                                  # test_app + test (Electrum) + bordes_aura
//   npx tsx evaluar-camino-rapido.mjs modelos/comando/datos/val_app.jsonl
//   JSON=/tmp/camino.json npx tsx evaluar-camino-rapido.mjs            # además guarda las cifras
//   FALLOS=1 …                                                         # lista lo que se hizo mal
//
//  · antes   = solo las reglas (ordenPorReglas): lo que había; el Laya del nodo solo sumaba callar/cerrar
//              y aquí no hay nodo (sin ULTRON_LAYA_URL no se consulta, igual que en producción si está caído);
//  · después = ordenRapida con Laya ligera (reglas → ligera → [nodo si estuviera] → cerebro).
//
// Lo que cuenta: «resuelto» = el camino rápido hizo (o propuso) la mano correcta sin el cerebro;
// «mano equivocada» = hizo OTRA cosa (lo grave); «falso positivo» = hizo algo con una frase que no era
// orden (lo más grave). Lo que no resuelve lo contesta el cerebro: más lento, pero no es un error.
// El idioma de la app se simula en español: una orden en inglés tiene que contestarse en inglés igual.
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

delete process.env.ULTRON_LAYA_URL
const AQUI = dirname(fileURLToPath(import.meta.url))
const LIB = resolve(process.env.LIB || resolve(AQUI, '../../../lib'))
const { ordenPorReglas, ordenRapida } = await import(pathToFileURL(resolve(LIB, 'acciones-app.ts')).href)
const { detectarIdioma } = await import(pathToFileURL(resolve(LIB, 'idioma-detectar.ts')).href)

// Los contactos del teléfono: los nombres que usan los datos, como se guardarían en la agenda.
const NOMBRES = ['Mamá', 'Papá', 'Beto', 'Ana', 'Esposa', 'Esposo', 'Hermano', 'Hermana', 'Don Chepe', 'Karla', 'Profe Carlos', 'Abuela', 'Medardo',
  'Jefe', 'Tía Rosa', 'José', 'Hija', 'Hijo', 'Licenciado', 'María José', 'Compadre', 'Prima', 'Primo', 'Doctor Ramírez', 'Vecina', 'Suegra',
  'Pastor', 'Lupita', 'Cuñado', 'Don Ramón', 'Seño Marta', 'Kevin', 'Doña Chayo', 'Carlos', 'Maria', 'Uncle Tony', 'Rosa', 'Pastor Mike', 'Landlord']
const contactos = NOMBRES.map((n, i) => ({ correo: `c${i}@prueba.hn`, nombre: n }))
const AHORA = Date.now()
const TEXTOS = ['tomar la pastilla', 'sacar la basura', 'pagar la luz', 'la reunión con el ingeniero', 'take my pills', 'buy bread', 'go to church']
const recordatorios = TEXTOS.map((t, i) => ({ id: `aura-rec-eval-${i}`, texto: t, cuando: AHORA + (6 + i) * 3600_000, llamada: i % 2 === 0 }))
const MANOS = ['llamar', 'leer', 'buscar', 'idioma', 'perfil', 'recordatorio', 'recordatorio_llamada', 'llamame']
const contexto = { pantalla: 'mesa', contactos, manos: MANOS, recordatorios }

/** Lo que hizo el camino rápido → la etiqueta del grupo `app` (app_ninguna = lo pasó al cerebro). */
function etiqueta(o, q = '') {
  if (!o) return 'app_ninguna'
  const p = o.propuesta
  if (p?.tipo === 'llamar') return p.video ? 'app_videollamar' : 'app_llamar'
  if (p?.tipo === 'recordatorio') return p.llamada ? 'app_llamar_recordar' : 'app_recordar'
  if (p?.tipo === 'cancelar_recordatorio') return 'app_cancelar_recordatorio'
  if (o.soloDecir) return /recordatorio|reminder/i.test(o.decir) && /encuentro|can't find/i.test(o.decir) ? 'app_cancelar_recordatorio' : 'app_listar_recordatorios'
  const a = o.accion
  switch (a?.tipo) {
    case 'atras': return 'app_atras'
    case 'abrir': return 'app_abrir'
    case 'tema': return 'app_tema'
    case 'avatar': return 'app_avatar'
    case 'silencio': return a.valor ? 'app_callar' : 'app_hablar'
    case 'presencia': return 'app_presencia'
    case 'idioma': return 'app_idioma'
    case 'perfil': return 'app_perfil'
    case 'leer': return 'app_leer'
    case 'buscar': return 'app_buscar_chats'
    case 'enviar': return 'app_enviar'
    case 'descartar': return 'app_descartar'
    case 'redactar': return 'app_redactar'
    case 'abrir_chat': return 'app_abrir_chat'
    case 'llamame': return 'app_llamame'
    // Con la mano `llamame` todo recordatorio se pone directo y llama: la etiqueta la decide cómo se pidió.
    case 'recordatorio': return /ll[aá]m|m[aá]rc|timbr|call|ring|phone|despi[eé]r|levant|wake|timer|temporizador|countdown|cuenta regresiva/i.test(q) ? 'app_llamar_recordar' : 'app_recordar'
    default: return 'app_ninguna'
  }
}

const enIngles = (s) => detectarIdioma(s) === 'en' || /^(Done|Okay|Sure|Here I am|I'll|Opening|Back to|Switching|AU-RA here|Should I|Let me|Got it|I'm here)/.test(s)

const args = process.argv.slice(2)
const D = (n) => resolve(AQUI, 'modelos/comando/datos', n)
const archivos = args.length ? args : [D('test_app.jsonl'), D('test.jsonl'), D('bordes_aura.jsonl')]

function medir(nombre, filas, fn) {
  const res = []
  const t0 = performance.now()
  for (const f of filas) res.push(fn(f))
  return { nombre, res, ms: (performance.now() - t0) / Math.max(1, filas.length) }
}

function resumen(filas, dichos) {
  const n = filas.length
  const pos = filas.map((f, i) => [f, dichos[i]]).filter(([f]) => f.oro !== 'app_ninguna')
  const neg = filas.map((f, i) => [f, dichos[i]]).filter(([f]) => f.oro === 'app_ninguna')
  const resueltas = pos.filter(([f, d]) => d.etiqueta === f.oro).length
  const equivocadas = pos.filter(([f, d]) => d.etiqueta !== 'app_ninguna' && d.etiqueta !== f.oro).length
  const fp = neg.filter(([, d]) => d.etiqueta !== 'app_ninguna').length
  const hechas = filas.map((f, i) => [f, dichos[i]]).filter(([, d]) => d.etiqueta !== 'app_ninguna')
  const bienHechas = hechas.filter(([f, d]) => d.etiqueta === f.oro).length
  const enEn = hechas.filter(([f]) => f.l === 'en')
  const idiomaBien = enEn.filter(([, d]) => enIngles(d.decir || '')).length
  return {
    n, ordenes: pos.length, negativos: neg.length,
    resueltas, cobertura: resueltas / Math.max(1, pos.length),
    mano_equivocada: equivocadas, falsos_positivos: fp,
    precision_de_lo_hecho: bienHechas / Math.max(1, hechas.length), hechas: hechas.length,
    respuestas_en_ingles_a_ordenes_en_ingles: enEn.length ? idiomaBien / enEn.length : null,
  }
}

function porEtiqueta(filas, dichos) {
  const out = {}
  const etiquetas = [...new Set(filas.map((f) => f.oro))].sort()
  for (const e of etiquetas) {
    const oro = filas.filter((f) => f.oro === e).length
    const pred = dichos.filter((d) => d.etiqueta === e).length
    const tp = filas.filter((f, i) => f.oro === e && dichos[i].etiqueta === e).length
    out[e] = { soporte: oro, resueltas: tp, recall: tp / Math.max(1, oro), precision: pred ? tp / pred : null }
  }
  return out
}

const informe = {}
for (const archivo of archivos) {
  const filas = readFileSync(archivo, 'utf8').split('\n').filter((l) => l.trim()).map((l) => {
    const f = JSON.parse(l)
    return { ...f, oro: f.e.find((x) => x.startsWith('app_')) || 'app_ninguna', l: f.l || (detectarIdioma(f.q) === 'en' ? 'en' : 'es') }
  })
  const opts = (f) => ({ contexto, idioma: detectarIdioma(f.q) ?? 'es', ahora: AHORA })
  const antes = medir('antes (reglas)', filas, (f) => {
    const o = ordenPorReglas(f.q, opts(f))
    return { etiqueta: etiqueta(o, f.q), decir: o?.decir, via: o?.via }
  })
  const despuesRes = []
  const t0 = performance.now()
  for (const f of filas) {
    const o = await ordenRapida(f.q, opts(f))
    despuesRes.push({ etiqueta: etiqueta(o, f.q), decir: o?.decir, via: o?.via })
  }
  const despues = { nombre: 'después (reglas + Laya ligera)', res: despuesRes, ms: (performance.now() - t0) / Math.max(1, filas.length) }
  const nombre = archivo.split('/').pop()
  const bloque = { n: filas.length }
  console.log(`\n== ${nombre}: ${filas.length} frases (${filas.filter((f) => f.l === 'es').length} es · ${filas.filter((f) => f.l === 'en').length} en)`)
  for (const m of [antes, despues]) {
    const r = resumen(filas, m.res)
    const idi = {}
    for (const l of ['es', 'en']) {
      const sel = filas.map((f, i) => [f, i]).filter(([f]) => f.l === l)
      if (sel.length) idi[l] = resumen(sel.map(([f]) => f), sel.map(([, i]) => m.res[i]))
    }
    const vias = {}
    for (const d of m.res) if (d.via) vias[d.via] = (vias[d.via] || 0) + 1
    bloque[m === antes ? 'antes' : 'despues'] = { ...r, ms_por_frase: m.ms, por_idioma: idi, por_etiqueta: porEtiqueta(filas, m.res), via: vias }
    const pct = (x) => (x == null ? '  -  ' : (100 * x).toFixed(1) + '%')
    console.log(`${m.nombre.padEnd(34)} resueltas sin cerebro ${r.resueltas}/${r.ordenes} (${pct(r.cobertura)}) · mano equivocada ${r.mano_equivocada} · falsos positivos ${r.falsos_positivos}/${r.negativos} · precisión de lo hecho ${pct(r.precision_de_lo_hecho)} · ${m.ms.toFixed(3)} ms/frase`)
    for (const [l, x] of Object.entries(idi)) console.log(`   ${l}: resueltas ${x.resueltas}/${x.ordenes} (${pct(x.cobertura)}) · equivocadas ${x.mano_equivocada} · falsos positivos ${x.falsos_positivos}/${x.negativos}${l === 'en' ? ` · contestadas en inglés ${pct(x.respuestas_en_ingles_a_ordenes_en_ingles)}` : ''}`)
    console.log(`   por vía: ${JSON.stringify(vias)}`)
  }
  console.log('   por etiqueta (resueltas antes → después / soporte):')
  for (const [e, x] of Object.entries(bloque.despues.por_etiqueta)) {
    const a = bloque.antes.por_etiqueta[e]
    console.log(`     ${e.padEnd(28)} ${String(a.resueltas).padStart(3)} → ${String(x.resueltas).padStart(3)} / ${x.soporte}`)
  }
  if (process.env.FALLOS) {
    filas.forEach((f, i) => {
      const d = despues.res[i]
      if (d.etiqueta !== 'app_ninguna' && d.etiqueta !== f.oro) console.log(`   MAL ${f.oro} → ${d.etiqueta} (${d.via}) · ${f.q}`)
    })
  }
  informe[nombre] = bloque
}
if (process.env.JSON) writeFileSync(process.env.JSON, JSON.stringify(informe, null, 1) + '\n')
