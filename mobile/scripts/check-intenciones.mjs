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
const src = fs.readFileSync(path.join(root, 'src', 'lib', 'intenciones.ts'), 'utf8');
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'intenciones-'));
const file = path.join(tmp, 'intenciones.mjs');
fs.writeFileSync(file, js);
const { interpretar } = await import(pathToFileURL(file).href);

let fails = 0;
const check = (frase, esperado, ctx = {}) => {
  const out = interpretar(frase, ctx);
  const ok = typeof esperado === 'string' ? out.tipo === esperado : esperado(out);
  const tag = ok ? 'ok ' : 'FAIL';
  if (!ok) fails += 1;
  console.log(`${tag}  ${JSON.stringify(frase).padEnd(58)} → ${JSON.stringify(out)}`);
};

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
check('ULTRON, canta 3', (o) => o.tipo === 'cantar' && o.cancion === 'bittersweet');
check('canta way maker', (o) => o.tipo === 'cantar' && o.cancion === 'waymaker');
check('cantá way maker', (o) => o.tipo === 'cantar' && o.cancion === 'waymaker');
check('canta waymaker', (o) => o.tipo === 'cantar' && o.cancion === 'waymaker');
check('way maker', (o) => o.tipo === 'cantar' && o.cancion === 'waymaker');
check('cántame la de Sinach', (o) => o.tipo === 'cantar' && o.cancion === 'waymaker');
check('ora', (o) => o.tipo === 'orar' && !o.tema);
check('oración', (o) => o.tipo === 'orar' && !o.tema);
check('hacé una oración', (o) => o.tipo === 'orar' && !o.tema);
check('orá por el día', (o) => o.tipo === 'orar' && !o.tema);
check('bendice el día', (o) => o.tipo === 'orar' && !o.tema);
check('reza', (o) => o.tipo === 'orar' && !o.tema);
check('oremos', (o) => o.tipo === 'orar' && !o.tema);
check('ULTRON, ora por mi familia', (o) => o.tipo === 'orar' && o.tema === 'mi familia');
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
check('quién eres', (o) => o.tipo === 'clip' && o.id === 'quien');
check('cuéntame un chiste', 'chiste');
check('hazme reír', 'chiste');
check('activa la cámara', 'vision_on');
check('visión activa', 'vision_on');
check('qué ves', 'que_ves');
check('¿qué hay en la mesa?', 'que_ves');
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
