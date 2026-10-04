/**
 * PERMISOS EXACTOS, UNDÉCIMA RONDA (décima revisión independiente sobre 4d96b66).
 *
 *  GRAVE: un canal dicho («la computadora», «el recordatorio», «el mensaje», «la llamada»…) que aparece en el tema o el
 *  texto de OTRA decisión ya no la elige: se pregunta cuál (antes solo correo, WhatsApp y llamada lo hacían).
 *  MENOR: los números con guion, espacio o punto se juntan antes de comparar («44-55» es «4455»), y se comparan también
 *  por su final (al menos 4 dígitos).
 *  Uso normal: el «sí» suelto con una pendiente, «sí, el correo», «sí, el whatsapp», «yes, the email» y «sí, a ana» con
 *  Ana María siguen ejecutando.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const A = await import('../lib/afirmacion');
const correr = (filas: Array<[string, any[], string]>) => {
  const fallos: string[] = [];
  for (const [frase, ps, tipo] of filas) {
    const d: any = A.decidirPendiente(frase, ps);
    if (d.tipo !== tipo) fallos.push(`«${frase}» [${ps.map((p) => p.tipo).join(', ')}]: esperaba ${tipo}, dio ${d.tipo}${d.p ? ' ' + d.p.tipo : ''}`);
  }
  return fallos;
};

test('ronda 11 (grave): un canal dicho que aparece en el tema o el texto de OTRA decisión pregunta', () => {
  assert.deepEqual(
    correr([
      ['sí, el de la computadora', [{ tipo: 'computadora', texto: '¿Borro la carpeta Descargas?' }, { tipo: 'whatsapp', destino: 'Bruno 50477770001@s.whatsapp.net', tema: 'Ya arreglé la computadora, te la llevo' }], 'preguntar'],
      ['sí, la computadora', [{ tipo: 'computadora', texto: '¿Pago la factura de 500 en el banco?' }, { tipo: 'correo', destino: 'Bruno bruno@example.test', tema: 'Cotización de la computadora' }], 'preguntar'],
      ['sí, el del recordatorio', [{ tipo: 'recordatorio', destino: 'Llamar', texto: 'Llamar a mamá', cuando: Date.UTC(2026, 9, 5, 23, 0) }, { tipo: 'correo', destino: 'Banco banco@example.test', tema: 'Recordatorio de pago' }], 'preguntar'],
      ['sí, el recordatorio', [{ tipo: 'recordatorio', destino: 'Llamar', texto: 'Llamar a mamá', cuando: Date.UTC(2026, 9, 5, 23, 0) }, { tipo: 'whatsapp', destino: 'Ana 50499990002@s.whatsapp.net', tema: 'Te mando el recordatorio de la cita' }], 'preguntar'],
      ['sí, el whatsapp', [{ tipo: 'whatsapp', destino: 'Ana 50499990002@s.whatsapp.net', tema: 'Hola' }, { tipo: 'correo', destino: 'Bruno bruno@example.test', tema: 'Mi nuevo WhatsApp' }], 'preguntar'],
      ['sí, la llamada', [{ tipo: 'llamar', destino: 'Ana +50499990002' }, { tipo: 'correo', destino: 'Bruno bruno@example.test', tema: 'Resumen de la llamada' }], 'preguntar'],
      ['sí, el mensaje', [{ tipo: 'whatsapp', destino: 'Ana 50499990002@s.whatsapp.net', tema: 'Hola' }, { tipo: 'computadora', texto: '¿Le mando el mensaje a Bruno por LinkedIn?' }], 'preguntar'],
      ['yes, the computer one', [{ tipo: 'computadora', texto: '¿Borro la carpeta Descargas?' }, { tipo: 'correo', destino: 'Bruno bruno@example.test', tema: 'Your computer quote' }], 'preguntar'],
      ['sí, la compu', [{ tipo: 'computadora', texto: '¿Borro la carpeta Descargas?' }, { tipo: 'correo', destino: 'Bruno bruno@example.test', tema: 'La compu nueva' }], 'preguntar'],
    ]),
    []
  );
});

test('ronda 11 (menor): los números se juntan («44-55», «N.º 4455») y se comparan por su final', () => {
  assert.deepEqual(
    correr([
      ['sí, el 4455', [{ tipo: 'whatsapp', destino: 'Taller (+504 9999-4455)' }, { tipo: 'computadora', texto: '¿Pago la factura 44-55 del agua?' }], 'preguntar'],
      ['sí, el 4455', [{ tipo: 'whatsapp', destino: 'Taller (+504 9999-4455)' }, { tipo: 'computadora', texto: '¿Pago la factura N.º4455 del agua?' }], 'preguntar'],
      ['sí, el 44-55', [{ tipo: 'whatsapp', destino: 'Taller (+504 9999-4455)' }, { tipo: 'computadora', texto: '¿Pago la factura 4455 del agua?' }], 'preguntar'],
      ['sí, el 4455', [{ tipo: 'whatsapp', destino: 'Taller (+504 9999-4455)' }, { tipo: 'computadora', texto: '¿Pago la factura 99994455?' }], 'preguntar'],
      // Sin cruce, el número del destino sigue eligiendo.
      ['sí, el 4455', [{ tipo: 'whatsapp', destino: 'Taller (+504 9999-4455)' }, { tipo: 'computadora', texto: '¿Reservo la mesa?' }], 'ejecutar'],
      ['sí, al 9999 4455', [{ tipo: 'whatsapp', destino: 'Taller (+504 9999-4455)' }], 'ejecutar'],
    ]),
    []
  );
});

test('ronda 11 (uso normal): siguen ejecutando', () => {
  assert.deepEqual(
    correr([
      ['sí, a ana', [{ tipo: 'whatsapp', destino: 'Ana María 50499990002@s.whatsapp.net', tema: 'Llego a las 3' }], 'ejecutar'],
      ['sí', [{ tipo: 'correo', destino: 'Ana ana@example.test', tema: 'Informe Va el informe' }], 'ejecutar'],
      ['dale, mándalo', [{ tipo: 'correo', destino: 'Ana ana@example.test', tema: 'Informe' }], 'ejecutar'],
      ['sí, el correo', [{ tipo: 'correo', destino: 'Ana ana@example.test', tema: 'Informe' }, { tipo: 'whatsapp', destino: 'Bruno 504@s.whatsapp.net', tema: 'Hola' }], 'ejecutar'],
      ['sí, el whatsapp', [{ tipo: 'correo', destino: 'Ana ana@example.test', tema: 'Informe' }, { tipo: 'whatsapp', destino: 'Bruno 504@s.whatsapp.net', tema: 'Hola' }], 'ejecutar'],
      ['sí, a Bruno', [{ tipo: 'correo', destino: 'Ana ana@example.test', tema: 'Informe' }, { tipo: 'whatsapp', destino: 'Bruno 504@s.whatsapp.net', tema: 'Hola' }], 'ejecutar'],
      ['yes, the email', [{ tipo: 'correo', destino: 'Ana ana@example.test', tema: 'Report' }, { tipo: 'whatsapp', destino: 'Bruno 504@s.whatsapp.net', tema: 'Hi' }], 'ejecutar'],
      ['sí, la computadora', [{ tipo: 'correo', destino: 'Ana ana@example.test', tema: 'Informe' }, { tipo: 'computadora', texto: '¿Borro Descargas?' }], 'ejecutar'],
      ['sí, a las 5', [{ tipo: 'recordatorio', destino: 'Llamar', texto: 'Llamar a mamá', cuando: Date.UTC(2026, 9, 5, 23, 0) }], 'ejecutar'],
    ]),
    []
  );
});
