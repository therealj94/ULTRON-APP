/**
 * LA GUARDA DURA DE HONESTIDAD (lib/honestidad.ts; José, 6-oct: cuatro «Listo, mensaje enviado» sin envío). Sin red ni
 * modelo: qué frases dan por HECHO un efecto (voseo, tuteo, usted e inglés), qué recibo las respalda y cómo se dice la
 * verdad cuando no lo hay. También lo que NO se toca (negaciones, ofertas, lo citado, lo de otro, lo dicho de antes).
 * Datos inventados.
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { _olvidarEfectos, afirmacionesDeHecho, anotarEfectoReal, efectosRecientes, guardaDeHonestidad, reciboDeDecision, recibosDeAcciones, recibosDePasos, sinLoRespaldado, trozoAfirmaHecho, type ReciboEfecto } from '../lib/honestidad';

const NADA = { recibos: [] as ReciboEfecto[] };
const WA: ReciboEfecto = { canal: 'whatsapp', estado: 'confirmado', destino: 'Padrino +50488881111' };

describe('honestidad: lo que da por hecho un envío', () => {
  it('voseo, tuteo, usted e inglés: todas son afirmaciones de envío', () => {
    for (const t of [
      'Listo, mensaje enviado. ¿Algo más?',
      'Listo, mensaje enviado a Compadre. ¿Algo más?',
      'Listo, mensaje enviado a Rosa Mejía por WhatsApp. ¿Algo más?',
      '¡Listo! Mensaje enviado a Rosa por WhatsApp: "¿Cómo vamos?".',
      'Ya se lo mandé a tu compadre.',
      'Ya te lo mandé, fijate en tu WhatsApp.',
      'Listo, ya le escribí a Ana por WhatsApp.',
      'Ya le mandé el mensaje a Beto, quedate tranquilo.',
      'Mandé el WhatsApp a Rosa.',
      'Ya salió tu mensaje.',
      'Se envió el correo a Bruno.',
      'Listo, le contesté a Ana.',
      'Done, message sent to Ana.',
      "I've sent the email to Bruno.",
      'Your message was sent.',
      'Sent!',
    ]) {
      const a = afirmacionesDeHecho(t);
      assert.ok(a.some((x) => x.clase === 'envio'), `no la vio: ${t}`);
    }
  });

  it('agendar, recordar, guardar, llamar y el «ya quedó» suelto (por lo que se habló)', () => {
    assert.equal(afirmacionesDeHecho('Te lo agendé para mañana a las 9.')[0]?.clase, 'recordatorio');
    assert.equal(afirmacionesDeHecho('Listo, alarma programada para las 6.')[0]?.clase, 'recordatorio');
    assert.equal(afirmacionesDeHecho('Reminder set for 5 pm.')[0]?.clase, 'recordatorio');
    assert.equal(afirmacionesDeHecho('Anotado, lo guardé en tu perfil.')[0]?.clase, 'guardado');
    assert.equal(afirmacionesDeHecho('Ya le llamé a Beto.')[0]?.clase, 'llamada');
    assert.equal(afirmacionesDeHecho('Sí, ya quedó. Te llamo a las 3:19 para recordarte que te duches.')[0]?.clase, 'recordatorio');
    assert.equal(afirmacionesDeHecho('Listo, ya quedó.', { mensaje: 'mándale un WhatsApp a Beto' })[0]?.clase, 'envio');
    assert.equal(afirmacionesDeHecho('¡Hecho!', { anterior: '¿Te pongo la alarma a las 6?' })[0]?.clase, 'recordatorio');
  });

  it('lo que NO afirma: negaciones, ofertas, futuro, lo citado, lo de otro, lo de antes, la charla', () => {
    for (const t of [
      'Todavía no lo envié: no hay ningún mensaje listo para mandar.',
      'No le mandé nada.',
      'Nunca le escribí a Bruno.',
      '¿Quieres que le mande el mensaje?',
      '¿Lo envío?',
      'Va, le mando el mensaje a Compadre.',
      'El borrador está listo para ser enviado.',
      'Cuando me digas que sí, queda enviado.',
      'Ana dijo que ya le mandó la factura.',
      'Ana te escribió: "Ya te mandé la factura".',
      'Hace rato te mandé el correo.',
      '¡Listo! Hablamos después.',
      'Aquí estoy, lista. ¿En qué te ayudo?',
      "I haven't sent it yet.",
    ])
      assert.deepEqual(afirmacionesDeHecho(t), [], t);
    assert.equal(trozoAfirmaHecho('Listo, mensaje enviado.'), true);
    assert.equal(trozoAfirmaHecho('¿Le escribo esto?'), false);
  });
});

describe('honestidad: sin recibo se dice la verdad', () => {
  beforeEach(() => _olvidarEfectos());

  it('sin recibo ni borrador: «Todavía no lo envié» y el camino real (el borrador para aprobar)', () => {
    const g = guardaDeHonestidad('[EMO: feliz] Listo, mensaje enviado. ¿Algo más?', { ...NADA, mensaje: 'Bien, nada más.' });
    assert.equal(g.cambiada, true);
    assert.equal(g.texto, '[EMO: feliz] Todavía no lo envié: no hay ningún mensaje listo para mandar. Dime a quién y qué le escribo, y te muestro el borrador para que lo apruebes.');
    // Idempotente: la verdad no es una afirmación.
    assert.equal(guardaDeHonestidad(g.texto, NADA).cambiada, false);
  });

  it('con un borrador esperando: dónde espera (la tarjeta), sin «¡Listo!» que contradiga', () => {
    const g = guardaDeHonestidad('¡Listo! Mensaje enviado a Rosa por WhatsApp: "¿Cómo vamos?".', { ...NADA, mensaje: 'Sí.', borrador: { canal: 'whatsapp', para: 'Rosa Elena Mejía Paz' } });
    assert.equal(g.texto, 'Todavía no lo envié: el mensaje para Rosa Elena Mejía Paz está esperando tu aprobación en la tarjeta de confirmación.');
  });

  it('en inglés, en inglés', () => {
    const g = guardaDeHonestidad('Done, message sent to Ana.', { ...NADA, idioma: 'en' });
    assert.match(g.texto, /^I haven't sent it: there's no message ready to send\./);
  });

  it('un recordatorio, una llamada o algo guardado sin recibo, cada uno con su verdad', () => {
    assert.equal(guardaDeHonestidad('Te lo agendé para mañana a las 9.', NADA).texto, 'Todavía no quedó puesto ese recordatorio: dime la hora y lo pongo.');
    assert.equal(guardaDeHonestidad('Ya le llamé a Beto.', NADA).texto, 'Todavía no hice esa llamada.');
    assert.equal(guardaDeHonestidad('Anotado, lo guardé.', NADA).texto, 'Todavía no lo guardé.');
  });

  it('con el recibo del envío de ESTE turno, «enviado» queda; a OTRA persona, no', () => {
    assert.equal(guardaDeHonestidad('Listo, mensaje enviado a Padrino.', { recibos: [WA], mensaje: 'Sí, enviarlo.' }).cambiada, false);
    assert.equal(guardaDeHonestidad('Listo, mensaje enviado a Rosa.', { recibos: [WA], mensaje: 'Sí, enviarlo.' }).cambiada, true);
    // Un correo no respalda un «WhatsApp enviado».
    assert.equal(guardaDeHonestidad('Listo, tu WhatsApp quedó enviado.', { recibos: [{ canal: 'correo', estado: 'confirmado' }] }).cambiada, true);
  });

  it('dijo que sí y sale al confirmarse la voz: «Lo estoy mandando», no «enviado»', () => {
    const g = guardaDeHonestidad('Listo, enviado.', { recibos: [{ canal: 'whatsapp', estado: 'en-curso' }], mensaje: 'sí' });
    assert.equal(g.texto, 'Lo estoy mandando ahora; te confirmo en cuanto salga.');
  });

  it('un efecto real de un turno anterior no se desmiente si solo pregunta; si pide o aprueba ahora, sí cuenta este turno', () => {
    anotarEfectoReal('jose@x.test', { canal: 'recordatorio', estado: 'confirmado' });
    const previos = efectosRecientes('jose@x.test');
    assert.equal(guardaDeHonestidad('Sí, ya quedó. Te llamo a las 3:19.', { recibos: [], previos, mensaje: '¿Ya lo guardaste?' }).cambiada, false);
    anotarEfectoReal('jose@x.test', WA);
    const p2 = efectosRecientes('jose@x.test');
    assert.equal(guardaDeHonestidad('Sí, ya se lo mandé a Padrino.', { recibos: [], previos: p2, mensaje: '¿Ya se lo mandaste?' }).cambiada, false);
    // «Sí, enviarlo» pide ESTE envío: lo de antes no lo respalda.
    assert.equal(guardaDeHonestidad('Listo, mensaje enviado.', { recibos: [], previos: p2, mensaje: 'Sí, enviarlo.' }).cambiada, true);
    // Un borrador esperando prueba que lo de ahora no salió.
    assert.equal(guardaDeHonestidad('Listo, mensaje enviado.', { recibos: [], previos: p2, mensaje: '¿Y?', borrador: { canal: 'whatsapp', para: 'Rosa' } }).cambiada, true);
    // sinLoRespaldado quita solo lo que consta (para la corrección de «prometió sin herramienta»).
    assert.equal(sinLoRespaldado('Sí, ya se lo mandé a Padrino. Te llamo en 30 segundos.', { recibos: [], previos: p2, mensaje: '¿Ya se lo mandaste?' }).trim(), 'Te llamo en 30 segundos.');
  });
});

describe('honestidad: de dónde salen los recibos', () => {
  it('pasos del harness, acciones que salieron y el «sí» que resolvió el servidor', () => {
    assert.deepEqual(recibosDePasos([{ herramienta: 'whatsapp', estado: 'succeeded', recibo: { efecto: 'borrador' } }]), []);
    assert.deepEqual(recibosDePasos([{ herramienta: 'whatsapp', estado: 'failed', recibo: { efecto: 'ninguno' } }]), []);
    assert.deepEqual(recibosDePasos([{ herramienta: 'mision', estado: 'succeeded', recibo: { efecto: 'guardado' } }]), [{ canal: 'guardado', estado: 'confirmado' }]);
    assert.deepEqual(recibosDeAcciones([{ tipo: 'recordatorio' }, { tipo: 'redactar' }, { tipo: 'abrir' }]), [{ canal: 'recordatorio', estado: 'confirmado' }]);
    assert.deepEqual(reciboDeDecision('whatsapp', { estado: 'succeeded', recibo: { efecto: 'confirmado' } }, 'Padrino'), { canal: 'whatsapp', estado: 'confirmado', destino: 'Padrino' });
    assert.equal(reciboDeDecision('whatsapp', { estado: 'failed', recibo: { efecto: 'ninguno' } }), null);
    assert.deepEqual(reciboDeDecision('correo', { estado: 'succeeded', recibo: { efecto: 'borrador', codigo: 'pendiente-del-turno' } }), { canal: 'correo', estado: 'en-curso' });
  });
});
