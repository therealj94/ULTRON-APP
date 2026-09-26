// Corre la tabla de disparo actual (server/electrum/especialistas.ts) sobre un JSONL.
// Conserva los campos de cada fila (c, acepta…) y añade lo que decide la tabla y a quién nombró el usuario.
//   npx tsx tabla.mjs ../../../server/electrum/especialistas.ts datos/test.jsonl > datos/test-tabla.jsonl
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
const { convocar, pedidosExplicitos } = await import(pathToFileURL(resolve(process.argv[2])).href)
const filas = readFileSync(process.argv[3], 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l))
for (const f of filas) console.log(JSON.stringify({ ...f, tabla: convocar(f.q).map(e => e.id), explicitos: pedidosExplicitos(f.q) }))
