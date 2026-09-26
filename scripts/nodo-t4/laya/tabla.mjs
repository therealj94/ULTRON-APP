// Corre la tabla de disparo actual (server/electrum/especialistas.ts) sobre un JSONL.
import { readFileSync } from 'node:fs'
const { convocar, pedidosExplicitos } = await import(process.argv[2])
const filas = readFileSync(process.argv[3], 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l))
for (const f of filas) console.log(JSON.stringify({ q: f.q, e: f.e, tabla: convocar(f.q).map(e => e.id), explicitos: pedidosExplicitos(f.q) }))
