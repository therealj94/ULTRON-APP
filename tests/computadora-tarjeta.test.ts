/**
 * La tarjeta de la tarea de su computadora en la app (mobile/src/compa/computadora.ts + ajustes/Computadora.tsx) —
 * auditoría del 7-oct (José: «no me ha convencido»). Lo que la auditoría vio en las capturas (scripts/qa/computadora-movil):
 *  · «● en vivo» encima de la captura del último paso, aun sin noticias de la computadora;
 *  · la ruedita de «En fila» y la frase de AURA girando al mismo tiempo que «no me llega lo que hace»;
 *  · Pausar y Tomar el control ofrecidos sin noticias (fallarían);
 *  · la etiqueta de arriba «Lista para trabajar» con la tarea recién terminada, y el resultado debajo del plan.
 * Aquí, la lógica pura que decide qué se dice (sin React Native) y unas marcas del código de la hoja.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  FALLOS_SIN_NOTICIAS,
  VIVA_FRESCA_MS,
  avisoSinNoticias,
  chipPc,
  controlesPc,
  fotoPc,
  pasoAhoraPc,
  tareaEnPalabras,
  textoApagadaPc,
  type PasoPc,
} from '../mobile/src/compa/computadora';

const AHORA = 1_000_000;
const pasos: PasoPc[] = [
  { n: 1, t: 3, accion: 'escritorio_limpio', texto: 'Abrió un escritorio limpio', miniatura: null },
  { n: 2, t: 8, accion: 'open_url', texto: 'Abrió x.hn', miniatura: 'P2' },
  { n: 3, t: 14, accion: 'click', texto: 'Tocó «Horarios»', miniatura: 'P3' },
];

test('la pantalla: «EN VIVO» solo con la imagen de ahora fresca y con noticias; lo demás, dicho como es', () => {
  const viva = { imagen: 'V', llegada: AHORA - 1000, edadMs: 500 };
  const fresca = fotoPc({ estado: 'trabajando', viva, pasos, ahora: AHORA });
  assert.deepEqual(fresca, { imagen: 'V', fuente: 'viva', etiqueta: 'EN VIVO', enVivo: true });
  assert.equal(fotoPc({ estado: 'control', viva, pasos, ahora: AHORA })?.etiqueta, 'EN VIVO · tienes el control');

  // Vieja (llegó hace 7 s): la imagen sigue, pero no es «en vivo».
  const vieja = fotoPc({ estado: 'trabajando', viva: { ...viva, llegada: AHORA - 7000, edadMs: 0 }, pasos, ahora: AHORA });
  assert.equal(vieja?.enVivo, false);
  assert.equal(vieja?.etiqueta, 'Imagen de hace 7 s');
  // La edad que trae del nodo cuenta: llegó recién pero salió del nodo hace más de VIVA_FRESCA_MS.
  assert.equal(fotoPc({ estado: 'trabajando', viva: { imagen: 'V', llegada: AHORA, edadMs: VIVA_FRESCA_MS + 1 }, pasos, ahora: AHORA })?.enVivo, false);

  // Sin noticias, aunque la imagen sea de hace 1 s: nunca «en vivo».
  assert.equal(fotoPc({ estado: 'trabajando', viva, pasos, sinNoticias: true, ahora: AHORA })?.enVivo, false);

  // Sin la pantalla de ahora (un servicio que no la da): la del último paso, como «Paso 3» (antes decía «● en vivo»).
  assert.deepEqual(fotoPc({ estado: 'trabajando', pasos, ahora: AHORA }), { imagen: 'P3', fuente: 'paso', etiqueta: 'Paso 3', enVivo: false });
  assert.equal(fotoPc({ estado: 'trabajando', pasos, sinNoticias: true, ahora: AHORA })?.etiqueta, 'Paso 3 · la última que llegó');
  assert.equal(fotoPc({ estado: 'trabajando', pasos, ahora: AHORA }, 'en')?.etiqueta, 'Step 3');

  // En fila: todavía no hay pantalla de esta tarea (la de otro dueño nunca se muestra).
  assert.equal(fotoPc({ estado: 'en_cola', viva, pasos: [], ahora: AHORA }), null);

  // El paso que tocó la persona manda; terminada, la evidencia es la pantalla al terminar.
  assert.deepEqual(fotoPc({ estado: 'trabajando', viva, pasos, verPaso: { n: 2, imagen: 'P2' }, ahora: AHORA }), { imagen: 'P2', fuente: 'paso', etiqueta: 'Paso 2', enVivo: false });
  assert.deepEqual(fotoPc({ estado: 'hecha', viva, pasos, finalCaptura: 'F', ahora: AHORA }), { imagen: 'F', fuente: 'final', etiqueta: 'Pantalla al terminar', enVivo: false });
  assert.equal(fotoPc({ estado: 'fallo', pasos, ahora: AHORA })?.etiqueta, 'Paso 3 (la última imagen)');
  for (const estado of ['hecha', 'parada', 'fallo', 'sin_pasos'] as const) assert.equal(fotoPc({ estado, viva, pasos, finalCaptura: 'F', ahora: AHORA })?.enVivo, false, `${estado}: nunca en vivo`);
});

test('la etiqueta de la tarea: cómo va ESTA tarea, «Sin noticias» sin noticias, y cómo terminó (no «Lista para trabajar»)', () => {
  assert.deepEqual(chipPc('trabajando', null, false), { texto: 'Trabajando', tono: 'trabaja' });
  assert.deepEqual(chipPc('trabajando', null, true), { texto: 'Sin noticias', tono: 'mal' });
  assert.deepEqual(chipPc('en_cola', null, false), { texto: 'En fila', tono: 'trabaja' });
  assert.deepEqual(chipPc('confirmar', null, false), { texto: 'Espera tu sí', tono: 'espera' });
  assert.deepEqual(chipPc('control', null, false), { texto: 'Tienes el control', tono: 'espera' });
  assert.deepEqual(chipPc('pausada', null, false), { texto: 'En pausa', tono: 'espera' });
  const fin = (o: object) => ({ estado: 'hecha' as const, ok: false, ...o });
  assert.deepEqual(chipPc('hecha', fin({ ok: true }), false), { texto: 'Listo', tono: 'bien' });
  assert.deepEqual(chipPc('hecha', fin({ respondida: true }), false), { texto: 'Respondida (sin comprobar)', tono: 'espera' });
  assert.deepEqual(chipPc('fallo', fin({ estado: 'fallo' }), false), { texto: 'Falló', tono: 'mal' });
  assert.deepEqual(chipPc('parada', fin({ estado: 'parada' }), false), { texto: 'Detenida', tono: 'neutro' });
  // Terminada: «sin noticias» ya no aplica (el final manda).
  assert.equal(chipPc('hecha', fin({ ok: true }), true).texto, 'Listo');
  assert.equal(chipPc('trabajando', null, true, 'en').texto, 'No updates');
});

test('«Ahora: …» sin noticias es la última noticia, dicha así; y los mandos que fallarían no se ofrecen', () => {
  const t = { estado: 'trabajando' as const, pasos, error: null };
  assert.equal(pasoAhoraPc(t, false), tareaEnPalabras(t));
  assert.equal(pasoAhoraPc(t, true), 'Última noticia: paso 3 · Tocó «Horarios»');
  assert.equal(pasoAhoraPc({ ...t, pasos: [] }, true), 'Todavía no llegó ningún paso');
  assert.equal(pasoAhoraPc({ ...t, estado: 'hecha' }, true), tareaEnPalabras({ ...t, estado: 'hecha' }), 'terminada: su final, no «última noticia»');

  const caps = ['pausar', 'confirmar', 'control'];
  assert.deepEqual(controlesPc(caps, 'trabajando'), { detener: true, pausar: true, seguir: false, tomar: true, devolver: false, contestar: false, faltaActualizar: false });
  const sin = controlesPc(caps, 'trabajando', true);
  assert.equal(sin.detener, true, 'Detener siempre');
  assert.equal(sin.pausar || sin.tomar || sin.seguir || sin.devolver, false, 'sin noticias: ni pausar ni tomar el control');
  assert.equal(sin.faltaActualizar, false, 'no se dice «falta actualizar» por no tener noticias');
  assert.equal(controlesPc(caps, 'confirmar', true).contestar, true, 'su sí se puede mandar igual');
  assert.equal(controlesPc([], 'trabajando').faltaActualizar, true);
  assert.equal(FALLOS_SIN_NOTICIAS, 3);
});

test('lo que se dice sin noticias y con la computadora apagada: cuánto hace, que no se sabe, y qué hacer', () => {
  assert.equal(avisoSinNoticias(25_400), 'No me llega nada de tu computadora desde hace 25 s. No sé si sigue trabajando o se detuvo; sigo intentando. Puedes detenerla.');
  assert.match(avisoSinNoticias(180_000), /desde hace 3 min/);
  assert.match(avisoSinNoticias(10_000, 'en'), /for 10 s\. I don’t know whether/);
  assert.match(textoApagadaPc(true), /no contesta\. Puede estar apagada para ahorrar \(corre en una GPU que se paga por hora\) o caída/);
  assert.match(textoApagadaPc(true), /lo busco en la web/);
  assert.equal(textoApagadaPc(false), 'La computadora todavía no está conectada en el servidor.');
});

test('la hoja: usa la lógica de arriba, pide la pantalla de ahora y no deja el «en vivo» fijo ni la imagen más ancha que su tarjeta', () => {
  const src = fs.readFileSync(path.join(import.meta.dirname, '../mobile/src/ajustes/Computadora.tsx'), 'utf8');
  assert.doesNotMatch(src, /tr\('en vivo', 'live'\)/, 'la etiqueta «en vivo» ya no va escrita a mano');
  assert.match(src, /fotoPc\(/);
  assert.match(src, /chipPc\(/);
  assert.match(src, /controlesPc\(estado\?\.capacidades, tarea\?\.estado, sinNoticias\)/);
  assert.match(src, /\/pantalla\?ancho=/, 'la pantalla de ahora mientras AURA trabaja (no solo con el control)');
  assert.match(src, /width - 2 \* MEDIDA\.espacio\.xl - 2 \* MEDIDA\.espacio\.m/, 'la imagen resta el relleno de la tarjeta');
  assert.match(src, /EVIDENCIA · LA PANTALLA AL TERMINAR/);
  assert.match(src, /Pedir otra vez/);
  // Su sí va antes de la pantalla en la tarjeta (arriba, a la vista), no debajo de la captura y la frase.
  assert.ok(src.indexOf('ANTES DE SEGUIR NECESITO TU SÍ') < src.indexOf('5 · La pantalla'), 'la pregunta va antes de la pantalla');
});
