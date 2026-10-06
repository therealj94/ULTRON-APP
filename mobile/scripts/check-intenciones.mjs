#!/usr/bin/env node
/**
 * Comprobación del intérprete de órdenes (src/lib/intenciones.ts).
 * Transpila el .ts con el `typescript` del proyecto (sin tsx ni ts-node) y afirma que:
 *  - los secuestros detectados en la auditoría ya van al cerebro;
 *  - las órdenes locales legítimas siguen funcionando.
 *
 *   node scripts/check-intenciones.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const transpilar = (nombre) =>
  ts.transpileModule(fs.readFileSync(path.join(root, 'src', 'lib', `${nombre}.ts`), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'intenciones-'));
const file = path.join(tmp, 'intenciones.mjs');
// Callar y los controles los decide lib/controlesVoz.ts (AUR10): va al lado, con su extensión.
fs.writeFileSync(path.join(tmp, 'controlesVoz.mjs'), transpilar('controlesVoz'));
fs.writeFileSync(file, transpilar('intenciones').replace(/from '\.\/controlesVoz'/g, "from './controlesVoz.mjs'"));
const { interpretar } = await import(pathToFileURL(file).href);

let fails = 0;
const check = (frase, esperado, ctx = {}) => {
  const out = interpretar(frase, ctx);
  const ok = typeof esperado === 'string' ? out.tipo === esperado : esperado(out);
  const tag = ok ? 'ok ' : 'FAIL';
  if (!ok) fails += 1;
  console.log(`${tag}  ${JSON.stringify(frase).padEnd(58)} → ${JSON.stringify(out)}`);
};

console.log('\n— «Llámame»: la llamada del avatar suena ya (sin servidor); lo parecido, no —');
for (const f of ['llámame', 'Aura, llámame porfa', 'hazme una llamada', 'márcame un ratito', '¿me llamas?', 'quiero que me llames', 'call me', 'give me a call please', 'ponte en llamada conmigo']) check(f, 'llamame');
for (const f of ['llámame Chepe', 'llámame a Beto', 'llámame a las 5 para recordarme la pastilla', 'mi mamá me llamó ayer', '¿me llamaste?', 'call me crazy']) check(f, (o) => o.tipo !== 'llamame');
// LANG-03: negación, cita, discurso referido, apodo, «¿puedes llamar?» y una llamada ya viva: nunca llamada local.
for (const f of ['no me llames', 'no, no me llames', 'ya no me llames', 'mejor no me llames', 'dijo que me llames', 'me dijo que me llames', 'llámame José', 'call me Alex', 'call me later', "please don't call me", 'never call me', 'no, llama a Beto', '¿puedes llamar?', '"llámame"', '«llámame» dijo ella', "'call me'"]) check(f, (o) => o.tipo !== 'llamame');
// Cancelar durante una llamada nunca abre otra (y «cuelga» cuelga).
for (const f of ['cancela', 'cuelga', 'no me llames', 'no, no me llames']) check(f, (o) => o.tipo !== 'llamame', { llamada: true });
check('cuelga', (o) => o.tipo === 'control' && o.control === 'colgar', { llamada: true });

console.log('\n— Secuestros de la auditoría: deben ir al cerebro —');
check('para mañana recuérdame revisar el contrato de la mina', 'cerebro');
check('para mañana necesito el informe', 'cerebro');
check('cuéntame tu experiencia con la minería', 'cerebro');
check('experiencia', 'cerebro');
check('estoy encantado con el resultado', 'cerebro');
check('encantado', 'cerebro');
check('quiero saber más del oro', 'cerebro');
check('dame opciones para invertir', 'cerebro');
check('dame opciones', 'cerebro');
check('cuál es la visión de la empresa', 'cerebro');
check('la visión de la empresa', 'cerebro');
check('ahora', 'cerebro');
check('qué pasa ahora con el dólar', 'cerebro');
check('me encanta cantar en la ducha', 'cerebro');
check('explícame el modo guardián de la aplicación con detalle', 'cerebro');
check('cuánto cuesta un chiste de esos en la radio hondureña', 'cerebro');
check('la cámara del banco central grabó el robo', 'cerebro');
check('anotá que mañana hay junta', 'cerebro');
check('recuérdame mañana llamar a Medardo', 'cerebro');
check('qué opinás de abrir sociedad en Próspera', 'cerebro');
check('precio del oro hoy', 'cerebro');
check('busca noticias de Honduras hoy', 'cerebro');
check('decime algo con cariño', 'cerebro');
check('la oración de la junta es a las nueve de la mañana', 'cerebro');
check('ahora oramos o después de la junta', 'cerebro');
check('qué opinás de la oración en las escuelas', 'cerebro');
check('el orador estuvo bien', 'cerebro');

console.log('\n— Órdenes locales legítimas —');
check('canta', 'cantar');
check('canta salsa', (o) => o.tipo === 'cantar' && o.genero === 'salsa');
check('cántame una ranchera', (o) => o.tipo === 'cantar' && o.genero === 'ranchera');
check('canta 1', (o) => o.tipo === 'cantar' && o.cancion === 'bohemian');
check('canta quiero conocer a Jesús', (o) => o.tipo === 'cantar' && o.cancion === 'jesus');
check('cántame la de Bruno Mars', (o) => o.tipo === 'cantar' && o.cancion === 'bruno');
check('AU-RA, canta 3', (o) => o.tipo === 'cantar' && o.cancion === 'bittersweet');
check('canta way maker', (o) => o.tipo === 'cantar' && o.cancion === 'waymaker');
check('cantá way maker', (o) => o.tipo === 'cantar' && o.cancion === 'waymaker');
check('canta waymaker', (o) => o.tipo === 'cantar' && o.cancion === 'waymaker');
check('way maker', (o) => o.tipo === 'cantar' && o.cancion === 'waymaker');
check('cántame la de Sinach', (o) => o.tipo === 'cantar' && o.cancion === 'waymaker');
check('canta la de bienvenida', (o) => o.tipo === 'cantar' && o.cancion === 'bienvenida');
check('cántame feliz cumpleaños', (o) => o.tipo === 'cantar' && o.cancion === 'felizdia');
check('cantame feliz día', (o) => o.tipo === 'cantar' && o.cancion === 'felizdia');
check('canta una bendición', (o) => o.tipo === 'cantar' && o.cancion === 'bendicion');
check('cántame una canción de cuna', (o) => o.tipo === 'cantar' && o.cancion === 'cuna');
check('canta una nana', (o) => o.tipo === 'cantar' && o.cancion === 'cuna');
check('ora', (o) => o.tipo === 'orar' && !o.tema);
check('oración', (o) => o.tipo === 'orar' && !o.tema);
check('hacé una oración', (o) => o.tipo === 'orar' && !o.tema);
check('orá por el día', (o) => o.tipo === 'orar' && !o.tema);
check('bendice el día', (o) => o.tipo === 'orar' && !o.tema);
check('reza', (o) => o.tipo === 'orar' && !o.tema);
check('oremos', (o) => o.tipo === 'orar' && !o.tema);
check('AU-RA, ora por mi familia', (o) => o.tipo === 'orar' && o.tema === 'mi familia');
check('reza por la junta', (o) => o.tipo === 'orar' && !o.tema);
check('ríete', (o) => o.tipo === 'gag' && o.gag.id === 'laugh');
check('ponte triste', (o) => o.tipo === 'gag' && o.gag.id === 'sad');
check('guiña un ojo', (o) => o.tipo === 'gag' && o.gag.id === 'wink');
check('quiero conocerte', (o) => o.tipo === 'conocer' && o.mas === false);
check('conocer más', (o) => o.tipo === 'conocer' && o.mas === true);
check('luego', 'conocer_salir', { enConocer: true });
check('salir', 'conocer_salir', { enConocer: true });
check('ya', 'conocer_salir', { enConocer: true });
check('luego', 'cerebro', { enConocer: false });
check('menú', 'menu');
check('abre el menú', 'menu');
check('catálogo', 'catalogo');
check('qué puedes hacer', (o) => o.tipo === 'clip' && o.id === 'puedo');
check('quién eres', 'cerebro'); // se contesta en vivo: el clip grabado decía el nombre viejo
check('cuéntame un chiste', 'chiste');
check('hazme reír', 'chiste');
check('activa la cámara', 'vision_on');
check('visión activa', 'vision_on');
check('qué ves', (o) => o.tipo === 'que_ves' && !o.foco);
check('¿qué hay en la mesa?', 'que_ves');

console.log('\n— Lo que se le muestra a la cámara: leer, precio, qué es (lib/vistaCamara.ts) —');
for (const f of ['léeme esto', 'Aura, lee esto por favor', '¿qué dice este cartel?', 'qué dice aquí', 'léeme la etiqueta', 'me puedes leer esta hoja', 'read this for me']) check(f, (o) => o.tipo === 'que_ves' && o.foco === 'leer');
for (const f of ['¿cuánto dice el precio?', 'cuánto marca la etiqueta', 'dime el precio de esto', '¿qué precio tiene esto?', "what's the price"]) check(f, (o) => o.tipo === 'que_ves' && o.foco === 'precio');
for (const f of ['¿qué es esto?', 'qué tengo en la mano', 'qué es lo que te muestro', 'sabes qué es esto', 'what is this']) check(f, (o) => o.tipo === 'que_ves' && o.foco === 'que_es');
// Lo parecido que NO es la cámara: al cerebro.
for (const f of ['léeme el mensaje de Ana', 'lee mis mensajes', 'cuánto cuesta el oro', '¿qué es la minería artesanal?', 'qué dice el contrato de la mina sobre regalías', 'cuánto dice el informe que produjimos']) check(f, (o) => o.tipo !== 'que_ves');
check('qué hora es', 'hora');
check('hora', 'hora');
check('qué día es hoy', 'fecha');
check('cállate', 'callar');
check('para', 'callar');
check('silencio', 'callar');
check('duérmete', 'dormir');
check('despierta', 'despertar', { dormido: true });
check('hola', 'despertar', { dormido: true });
check('hola', 'saludo');
check('gracias', 'gracias');
check('modo gold', (o) => o.tipo === 'modo' && o.modo === 'GOLD');
check('ponte en modo explorador', (o) => o.tipo === 'modo' && o.modo === 'EXPLORER');
check('modo conocer', 'conocer');
check('recuerda que la villa va al setenta por ciento', (o) => o.tipo === 'recordar' && /villa va al setenta/.test(o.hecho));
check('olvida todo', 'olvidar');
check('qué recuerdas de mí', 'que_recuerdas');
check('dispara', 'blaster');
check('sable de luz', 'sable');
check('cerrar sesión', 'logout');
check('ayuda', 'ayuda');

fs.rmSync(tmp, { recursive: true, force: true });
console.log(fails ? `\n${fails} fallo(s)` : '\nTodo en orden.');
process.exit(fails ? 1 : 0);
