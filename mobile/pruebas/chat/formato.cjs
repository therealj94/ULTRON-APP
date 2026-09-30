// Pantallas · Lo que se dice en la lista y en el hilo: horas relativas, resumen del último mensaje
// y cómo se agrupan las burbujas (colas, separadores de día, doble palomita).
const { ok, fin, movil } = require('./comun.cjs');
const { FORMATO: F } = movil();

console.log('formato · lista e hilo\n');
const ahora = new Date(2026, 8, 30, 15, 0).getTime();
const h = (d, hh, mm) => new Date(2026, 8, d, hh, mm).getTime();
ok('hoy: la hora', /^0?3:00|^15:00/.test(F.cuandoLista(h(30, 15, 0), ahora)), F.cuandoLista(h(30, 15, 0), ahora));
ok('ayer: «Ayer»', F.cuandoLista(h(29, 23, 59), ahora) === 'Ayer');
ok('esta semana: el día', /lunes|domingo|sábado|viernes/.test(F.cuandoLista(h(27, 10, 0), ahora)), F.cuandoLista(h(27, 10, 0), ahora));
ok('más atrás: la fecha', /sept?|sep/.test(F.cuandoLista(h(2, 10, 0), ahora)), F.cuandoLista(h(2, 10, 0), ahora));
ok('separador: «Hoy»/«Ayer»', F.etiquetaDia(h(30, 1, 0), ahora) === 'Hoy' && F.etiquetaDia(h(29, 1, 0), ahora) === 'Ayer');
ok('recortar no parte un emoji', F.recortar('ab🎉cd', 4) === 'ab🎉…', F.recortar('ab🎉cd', 4));
ok('recortar junta renglones', F.recortar('hola\n\n  mundo') === 'hola mundo');
ok('iniciales', F.iniciales('María José Núñez') === 'MN' && F.iniciales('beto') === 'B' && F.iniciales('') === '?');
const yo = 'yo@x.hn';
ok('resumen: lo mío va con «Tú:»', F.resumen({ de: yo, texto: 'hola', cuando: 1 }, yo) === 'Tú: hola');
ok('resumen: foto', F.resumen({ de: 'b@x.hn', tipo: 'imagen', texto: '', cuando: 1 }, yo) === '📷 Foto');
ok('resumen: cerrado para otro aparato', F.resumen({ de: 'b@x.hn', cerrado: true, texto: '', cuando: 1 }, yo) === 'Cifrado para otro de tus aparatos');

const m = (id, de, cuando, extra = {}) => ({ id, de, para: '', cuando, texto: id, ...extra });
const hilo = [
  m('a1', 'b@x.hn', h(29, 9, 0)),
  m('a2', 'b@x.hn', h(29, 9, 2)),
  m('y1', yo, h(29, 9, 3)),
  m('y2', yo, h(30, 9, 0)),
  m('y3', yo, h(30, 9, 1)),
  m('y4', yo, h(30, 9, 20), { pendiente: true }),
];
const filas = F.filasDelHilo(hilo, yo, h(30, 9, 0), ahora);
const orden = filas.map((f) => (f.tipo === 'dia' ? '[' + f.texto + ']' : f.clave));
ok('invertidas (lo nuevo primero) con separadores de día', orden.join(' ') === 'y4 y3 y2 [Hoy] y1 a2 a1 [Ayer]', orden.join(' '));
const f = Object.fromEntries(filas.filter((x) => x.tipo === 'msg').map((x) => [x.clave, x]));
ok('pegadas del mismo remitente: solo la última lleva cola', !f.a1.ultima && f.a2.ultima && f.a1.primera && !f.a2.primera);
ok('otro día corta el grupo aunque sea el mismo remitente', f.y1.ultima && f.y2.primera);
ok('más de 5 minutos corta el grupo', f.y3.ultima && f.y4.primera);
ok('doble palomita solo hasta donde leyó la otra persona', f.y1.leido && f.y2.leido && !f.y3.leido && !f.y4.leido);
ok('lo ajeno nunca lleva palomitas', !f.a1.leido);
fin();
