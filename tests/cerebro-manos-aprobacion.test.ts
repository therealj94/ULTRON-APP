/**
 * Revisión 7 (M1, M2): promesas falsas que pasaban sin corregir (lib/cerebro-manos.ts).
 *
 *  · M1: los patrones de «algo espera su sí» perdonaban la frase ENTERA hasta el punto, y con eso pasaban promesas falsas
 *    («Ya le respondí a Bruno, si me dices que sí le mando otro»). Ahora solo se perdona la cláusula de la aprobación; el
 *    resto pasa por el detector completo, que además reconoce «le respondí / le contesté / le escribí / le avisé / le
 *    pasé tu mensaje / ya le llegó / ya hice la reservación».
 *  · M2: nombrar la cámara apagaba la re-pregunta de un pedido de mensaje de verdad («prende la cámara y avísale a Bruno
 *    que llego tarde» → «Le voy a escribir a Bruno»), y la corrección decía «Eso no lo hice yo: lo hace tu teléfono…».
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { corregirPromesaSinHerramienta, herramientasQueCumplen, cumplirLoDicho, debeCorregirSinHerramienta } from '../lib/cerebro-manos';

const DISPONIBLES = ['whatsapp', 'correo', 'chat_aura', 'recordatorio', 'llamar_contacto', 'circulo'];
const MENSAJE = 'contéstale a Bruno';

test('M1: con un borrador esperando, una promesa falsa junto a la cláusula de aprobación se re-pregunta y se corrige', async () => {
  const falsas = [
    'Ya le respondí a Bruno, si me dices que sí le mando otro.',
    'Listo, ya hice la reservación; si me dices que sí lo mando.',
    'Ya le pasé tu mensaje a Bruno, toca sí si quieres otro.',
    'Ya le llegó tu mensaje a Bruno; está en tu ventana de decisión.',
    'Listo, ya le avisé a Bruno, cuando me digas sí te mando otro.',
    'Ya quedó: le contesté a Bruno. Dale sí si quieres otro.',
    'Ya le escribí a Bruno; está en tu ventana de decisión por si quieres verlo.',
    'Ya se lo reenvié a Bruno, si me dices que sí te lo leo.',
  ];
  for (const f of falsas) {
    const c = corregirPromesaSinHerramienta(f, 'es', { borradorPendiente: true, mensaje: MENSAJE });
    assert.equal(c.cambiada, true, `no se corrigió: ${f}`);
    assert.doesNotMatch(c.texto, /lo hace tu teléfono/, f);
    const hs = herramientasQueCumplen(f, DISPONIBLES, { mensaje: MENSAJE, borradorPendiente: true });
    assert.ok(hs.length > 0, `no se re-preguntó: ${f}`);
    let vueltas = 0;
    const p = await cumplirLoDicho({
      dicho: f,
      disponibles: DISPONIBLES,
      mensaje: MENSAJE,
      borradorPendiente: true,
      repreguntar: () =>
        (async function* () {
          vueltas++;
          yield { texto: '' };
        })(),
      usar: () => false,
    });
    assert.equal(p.correccion, 'repregunta', f);
    assert.equal(vueltas, 1, f);
    assert.equal(debeCorregirSinHerramienta({ promesa: p, usoManos: false, borradorPendiente: true, pasos: [], dicho: f, mensaje: MENSAJE }), true, f);
  }
});

test('M1: lo que se dice de verdad del borrador que espera sigue sin re-pregunta ni corrección', () => {
  const legitimas = [
    'Sigue esperando el correo para Ana. ¿Lo envío?',
    'Está en tu ventana de decisión: tócale Sí y lo mando.',
    'Si me dices que sí, te lo mando.',
    'Si me dices que sí, lo mando.',
    'En cuanto me confirmes, lo envío.',
    'Tócale Sí y sale.',
    'Quedó pendiente el WhatsApp para Beto; lo tienes en tu ventana de decisión para que lo apruebes ahí.',
    'Te lo leo otra vez: «Llego a las 5». ¿Lo mando?',
    'Ahí está el borrador para Bruno. Cuando me digas que sí, se lo mando.',
    'When you say yes, I will send it.',
  ];
  for (const f of legitimas) {
    assert.deepEqual(herramientasQueCumplen(f, DISPONIBLES, { mensaje: '¿qué pasó con lo de Ana?', borradorPendiente: true }), [], f);
    assert.equal(corregirPromesaSinHerramienta(f, 'es', { borradorPendiente: true, mensaje: '¿qué pasó con lo de Ana?' }).cambiada, false, f);
  }
});

test('M1: sin borrador, «le respondí / le contesté / ya le llegó» también son promesas falsas', () => {
  for (const f of ['Ya le contesté a Ana por correo.', 'Listo, Bruno ya lo recibió.', 'Ya está, se fue el mensaje a Bruno.', 'Listo, Ana ya tiene tu correo.', 'Ya despaché el correo.']) {
    assert.equal(corregirPromesaSinHerramienta(f, 'es', { mensaje: MENSAJE }).cambiada, true, f);
    assert.ok(herramientasQueCumplen(f, DISPONIBLES, { mensaje: MENSAJE }).length > 0, f);
  }
  // Charla con ella misma («ya te avisé», «te escribí ayer») no es una promesa de mandar algo.
  for (const f of ['Como ya te avisé, mañana llueve.', 'Ya te escribí la lista arriba.']) {
    assert.equal(corregirPromesaSinHerramienta(f, 'es', { mensaje: '¿y el clima?' }).cambiada, false, f);
  }
});

test('M2: con la cámara en el pedido, un mensaje prometido se re-pregunta con herramientas; nunca «lo hace tu teléfono»', () => {
  const casos: Array<[string, string]> = [
    ['prende la cámara y avísale a Bruno que llego tarde', 'Va. Le voy a escribir a Bruno que llegas tarde.'],
    ['prende la cámara y avísale a Bruno que llego tarde', 'Listo, ya le avisé a Bruno que llegas tarde.'],
    ['mira mi cara y dime si me veo bien para la reunión con Ana, y avísale que voy', 'Te ves bien. Ya le avisé a Ana que vas.'],
    ['enciende la cámara y mándale a Ana que ya salí', 'Va, le mando a Ana que ya saliste.'],
  ];
  for (const [mensaje, dicho] of casos) {
    const hs = herramientasQueCumplen(dicho, DISPONIBLES, { mensaje });
    assert.ok(hs.includes('whatsapp') || hs.includes('chat_aura'), `${dicho} → ${JSON.stringify(hs)}`);
    const c = corregirPromesaSinHerramienta(dicho, 'es', { mensaje });
    assert.equal(c.cambiada, true, dicho);
    assert.doesNotMatch(c.texto, /lo hace tu teléfono/, c.texto);
  }
  // Lo que de verdad hace solo el teléfono sigue igual: sin segunda vuelta y con la frase que sirve.
  assert.deepEqual(herramientasQueCumplen('Listo, te pongo la cámara trasera.', DISPONIBLES, { mensaje: 'cambia a la cámara de atrás' }), []);
  assert.match(corregirPromesaSinHerramienta('Listo, te pongo la cámara trasera.', 'es', { mensaje: 'cambia a la cámara de atrás' }).texto, /lo hace tu teléfono/);
});
