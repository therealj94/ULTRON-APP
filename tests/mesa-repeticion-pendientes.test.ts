/**
 * «ESTÁ LOCO REPITIENDO LAS COSAS» (José, 7-oct, 00:31–00:33 UTC, mesa de AU-RA). Las piezas sin servidor (el turno entero:
 * tests/mesa-avatar-repeticion-servidor.test.ts). Frases, nombres y pendientes inventados.
 *
 *  1. lib/conversacion.ts fusionarHilo: sus frases del final que quedaron sin respuesta (las respuestas de esos turnos no
 *     se guardaron) ya no se le juntan a la de ahora en UN mensaje (Bedrock junta los seguidos): van marcadas como de
 *     antes. Así el modelo contestaba «Ahí va, ya me pongo en Claudio» a la frase de un minuto antes.
 *  2. lib/repeticion.ts: la respuesta que repite en gran parte una de las últimas pierde lo repetido (o queda vacía para
 *     una segunda vuelta); pedir que repita, o volver a preguntar lo mismo, no cuenta.
 *  3. lib/abiertos.ts: un pendiente se menciona una vez por sesión (salvo que pregunte por sus pendientes).
 *  4. lib/cerebro-manos.ts herramientaFueraDeTema: la herramienta de WhatsApp no corre en un turno que no habla de mensajes.
 *
 * Con main (2cfc26f) falla: no existían la nota, la guarda, la sesión de los pendientes ni el filtro de la herramienta.
 */
import { after, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mesa-repeticion-'));
Object.assign(process.env, { ULTRON_ABIERTOS_DIR: path.join(dir, 'ab'), ULTRON_MEMORIA_BUCKET: '' });
after(() => fs.rmSync(dir, { recursive: true, force: true }));

const { fusionarHilo } = await import('../lib/conversacion');
const { aBedrock } = await import('../lib/cerebro-rapido');
const R = await import('../lib/repeticion');
const A = await import('../lib/abiertos');
const { herramientaFueraDeTema } = await import('../lib/cerebro-manos');

/** El párrafo que se repitió, con datos inventados (largo, con el pendiente adentro). */
const PARRAFO =
  'Je, sí, me cambié de ropa. Era Aura, ahora soy Claudio, el mismo cerebro con otro traje. ¿Qué tenemos pendiente? Ah, sí: te quedó pendiente mandarle un WhatsApp a Marisol sobre la reunión del jueves. Lo prometí hace unos minutos y todavía no lo hice.';

describe('1) las frases sin respuesta no se juntan con la de ahora', () => {
  it('fusionarHilo las marca como de antes; Bedrock recibe la de ahora clara, al final', () => {
    const durable = [
      { rol: 'user', texto: 'Hola, ¿cómo vas?' },
      { rol: 'ultron', texto: 'Bien, aquí contigo.' },
      // Turnos cuya respuesta no quedó en la memoria (una herramienta sin dato seguro, AUR07).
      { rol: 'user', texto: 'Necesito que cambies a Claudio.' },
      { rol: 'user', texto: '¿Qué tenemos pendiente?' },
      { rol: 'user', texto: '¿Qué cambiaste, Claudio? Si yo no-' },
    ];
    const hilo = fusionarHilo({ durable, mensaje: '¿Qué cambiaste, Claudio? Si yo no-' });
    assert.equal(hilo.length, 3);
    assert.equal(hilo[1].role, 'assistant');
    assert.match(hilo[2].content, /^\(Antes dijo esto y no quedó respuesta tuya: «Necesito que cambies a Claudio\.» · «¿Qué tenemos pendiente\?»\. Ya pasó: no lo contestes/);
    // Lo que llega al modelo: el último mensaje de la persona termina con lo de ahora, después de la nota.
    const { messages } = aBedrock([{ role: 'system', content: 's' }, ...hilo, { role: 'user', content: '¿Qué cambiaste, Claudio? Si yo no-' }]);
    const ultimo = String((messages.at(-1)!.content![0] as { text: string }).text);
    assert.match(ultimo, /^\(Antes dijo esto/);
    assert.match(ultimo, /\n\n¿Qué cambiaste, Claudio\? Si yo no-$/);
    assert.doesNotMatch(ultimo, /^Necesito que cambies a Claudio\./, 'antes el mensaje empezaba por la frase vieja y el modelo contestaba a esa');
  });

  it('con respuesta en medio, o sin mensaje de ahora, el hilo queda como siempre', () => {
    const durable = [
      { rol: 'user', texto: 'uno' },
      { rol: 'ultron', texto: 'dos' },
      { rol: 'user', texto: 'tres' },
    ];
    assert.deepEqual(fusionarHilo({ durable, mensaje: 'tres' }).map((m) => m.content), ['uno', 'dos']);
    assert.deepEqual(fusionarHilo({ durable, mensaje: '' }).map((m) => m.content), ['uno', 'dos', 'tres']);
  });
});

describe('2) la guarda de repetición', () => {
  it('el mismo párrafo a otra frase: todo lo repetido se quita y queda vacía (segunda vuelta o breve)', () => {
    const g = R.guardaRepeticion(PARRAFO, ['Perdón, ya volví.', PARRAFO], { mensaje: 'Me cambió a Claudio.' });
    assert.equal(g.repite, true);
    assert.equal(g.vacia, true);
    assert.equal(g.texto, '');
    assert.ok(g.quitadas.length >= 4);
  });

  it('repetido en gran parte con algo nuevo: queda solo lo nuevo', () => {
    const nuevo = `${PARRAFO} Por cierto, el oro subió dos por ciento esta mañana en Nueva York.`;
    const g = R.guardaRepeticion(nuevo, [PARRAFO]);
    assert.equal(g.repite, true);
    assert.equal(g.texto, 'Por cierto, el oro subió dos por ciento esta mañana en Nueva York.');
    // Y en el stream, el trozo repetido se retiene; el nuevo no.
    assert.equal(R.trozoRepite('Ah, sí: te quedó pendiente mandarle un WhatsApp a Marisol sobre la reunión del jueves.', [PARRAFO]), true);
    assert.equal(R.trozoRepite('Por cierto, el oro subió dos por ciento esta mañana.', [PARRAFO]), false);
  });

  it('una frase parecida de varias no es repetirse; lo corto tampoco', () => {
    const anterior = 'El oro está a tres mil cuatrocientos dólares la onza. Subió un poco esta semana. La plata se quedó igual.';
    const g = R.guardaRepeticion('El oro está a tres mil cuatrocientos dólares la onza. Mañana te digo cómo abre Londres y si conviene vender el lote. También reviso cómo cerró el cobre ayer en Chicago.', [anterior]);
    assert.equal(g.repite, false, 'una de tres frases no es «en gran parte»');
    assert.equal(R.guardaRepeticion('Claro, te cuento del proyecto.', ['Claro, te cuento del proyecto.']).repite, false, 'corta: no cuenta');
  });

  it('si pide que repita, o vuelve a preguntar lo mismo, no se toca', () => {
    assert.equal(R.guardaRepeticion(PARRAFO, [PARRAFO], { mensaje: '¿Qué dijiste? No te oí.' }).repite, false);
    assert.equal(R.pideRepetir('repítemelo, por favor'), true);
    assert.equal(R.pideRepetir('Me cambió a Claudio.'), false);
    const hilo = [
      { role: 'user', content: '¿Cómo va el oro hoy en los mercados?' },
      { role: 'assistant', content: PARRAFO },
    ];
    assert.equal(R.mismaPreguntaQue('¿cómo va el oro hoy en los mercados?', hilo), true);
    assert.equal(R.mismaPreguntaQue('Me cambió a Claudio.', hilo), false);
    assert.deepEqual(R.previasDe(hilo), [PARRAFO]);
  });
});

describe('3) un pendiente, una vez por sesión', () => {
  const quien = 'persona.pendientes@prueba.hn';
  beforeEach(() => A._olvidarCacheAbiertos());

  it('mencionado una vez, ya no vuelve al turno; si pregunta por sus pendientes, sí', async () => {
    const ahora = Date.now();
    await A.incorporarAbiertos(quien, [{ texto: 'Mandarle un WhatsApp a Marisol sobre la reunión del jueves', tipo: 'promesa_aura' }], { ahora: ahora - 60_000 });
    assert.match(A.bloqueAbiertos(quien, true, ahora, { mensaje: 'cuéntame un chiste' }), /Marisol/);
    // AU-RA lo dijo en su respuesta: queda mencionado en esta sesión.
    assert.equal(A.anotarMencionesAbiertos(quien, 'Ah, y te quedó pendiente mandarle un WhatsApp a Marisol por lo del jueves.', ahora).length, 1);
    assert.equal(A.bloqueAbiertos(quien, true, ahora + 1_000, { mensaje: 'Me cambió a Claudio.' }), '', 'antes volvía en cada turno');
    // Pregunta por sus pendientes: ahí sí, todos.
    assert.equal(A.preguntaPorPendientes('¿Qué tenemos pendiente?'), true);
    assert.match(A.bloqueAbiertos(quien, true, ahora + 2_000, { mensaje: '¿Qué tenemos pendiente?' }), /te pregunta por sus pendientes[\s\S]*Marisol/);
    // Pasada la sesión, puede volver a salir (una vez).
    assert.match(A.bloqueAbiertos(quien, true, ahora + A.SESION_ABIERTOS_MS + 5_000, { mensaje: 'hola' }), /Marisol/);
    // Una respuesta que no lo nombra no lo marca.
    assert.equal(A.anotarMencionesAbiertos(quien, 'El oro subió hoy.', ahora).length, 0);
  });
});

describe('4) WhatsApp solo cuando el turno habla de mensajes', () => {
  it('fuera de tema no corre; con mensajes, el nombre, un «sí» a su pregunta o un borrador esperando, sí', () => {
    const leer = { accion: 'leer', chat: 'Marisol' };
    for (const m of ['Necesito que cambies a Claudio.', '¿Qué tenemos pendiente?', 'Me cambió a Claudio.']) {
      assert.ok(herramientaFueraDeTema('whatsapp', leer, { mensaje: m }), m);
    }
    assert.equal(herramientaFueraDeTema('whatsapp', leer, { mensaje: '¿Qué me escribió Marisol?' }), null);
    assert.equal(herramientaFueraDeTema('whatsapp', leer, { mensaje: '¿y lo de Marisol?' }), null, 'nombra a quién');
    assert.equal(herramientaFueraDeTema('whatsapp', { accion: 'revisar' }, { mensaje: 'revisa mis whatsapps' }), null);
    assert.equal(herramientaFueraDeTema('whatsapp', leer, { mensaje: 'Sí.', anterior: '¿Le escribo a Marisol por WhatsApp?', afirma: true }), null);
    assert.equal(herramientaFueraDeTema('whatsapp', leer, { mensaje: 'Sí.', esperaWhatsapp: true }), null);
    // Las demás herramientas no se tocan.
    assert.equal(herramientaFueraDeTema('buscar_web', { q: 'oro' }, { mensaje: 'Me cambió a Claudio.' }), null);
  });
});
