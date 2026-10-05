/**
 * PERMISOS EXACTOS, DUODÉCIMA RONDA (revisión 11 sobre ae08d10).
 *
 *  1. Los montos con coma de miles («L 4,455», «1,250,000», «4,455.00», «4.455,00») se juntan para comparar: «sí, el
 *     4455» con un WhatsApp al …4455 y su computadora preguntando por L 4,455 pregunta.
 *  2. Las horas no se juntan: «a las 10.30», «a las 10 30», «at 10:30» siguen siendo las 10 y 30 (y ejecutan el
 *     recordatorio de las 10:30).
 *  3. Lo que se dijo vuelve ambigua a OTRA decisión solo si TODO lo dicho podría ser de ella: «sí, el correo a Ana» con
 *     su computadora preguntando por «el correo de Bruno» manda el correo a Ana.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const A = await import('../lib/afirmacion');
const correr = (filas: Array<[string, any[], string]>) => {
  const fallos: string[] = [];
  for (const [frase, ps, espera] of filas) {
    const d: any = A.decidirPendiente(frase, ps);
    const [tipo, de] = espera.split(':');
    if (d.tipo !== tipo || (de && d.p?.tipo !== de)) fallos.push(`«${frase}» [${ps.map((p) => p.tipo).join(', ')}]: esperaba ${espera}, dio ${d.tipo}${d.p ? ':' + d.p.tipo : ''}`);
  }
  return fallos;
};
const TALLER = { tipo: 'whatsapp', destino: 'Taller (+504 9999-4455)' };
const compu = (texto: string) => ({ tipo: 'computadora', texto });
const REC_1030 = { tipo: 'recordatorio', destino: 'Llamar', texto: 'Llamar a mamá', cuando: 1791217800000 };
const REC_1130 = { tipo: 'recordatorio', destino: 'Pagar', texto: 'Pagar luz', cuando: 1791221400000 };

test('ronda 12 (1): los montos con coma de miles o decimales se juntan para comparar', () => {
  assert.deepEqual(
    correr([
      ['sí, el 4455', [TALLER, compu('¿Pago la factura de L 4,455 del agua?')], 'preguntar'],
      ['sí, el 4455', [TALLER, compu('¿Pago la factura del agua de L 4,455.00?')], 'preguntar'],
      ['sí, el 4455', [TALLER, compu('¿Pago la factura del agua de L 4.455,00?')], 'preguntar'],
      ['sí, el 4,455', [TALLER, compu('¿Pago la factura 4455 del agua?')], 'preguntar'],
      ['sí, el 4455', [TALLER, compu('¿Pago la factura 4 455 del agua?')], 'preguntar'],
      ['sí, el 4455', [TALLER, compu('¿Pago la factura 4/455 del agua?')], 'preguntar'],
      ['sí, el 4455', [TALLER, compu('¿Pago la factura 44554 del agua?')], 'preguntar'],
      ['sí, el 1250000', [{ tipo: 'whatsapp', destino: 'Banco (+504 2125-0000)' }, compu('¿Transfiero L 1,250,000?')], 'preguntar'],
      // Sin cruce, el número del destino sigue eligiendo.
      ['sí, el 4455', [TALLER, compu('¿Reservo la mesa?')], 'ejecutar:whatsapp'],
      ['si al 99994455', [TALLER, { tipo: 'whatsapp', destino: 'Otro (+504 8888-4455)' }], 'ejecutar:whatsapp'],
      ['si al 4455', [TALLER, { tipo: 'whatsapp', destino: 'Otro (+504 8888-4455)' }], 'preguntar'],
    ]),
    []
  );
});

test('ronda 12 (2): las horas no se juntan («a las 10.30», «a las 10 30», «at 10:30»)', () => {
  assert.deepEqual(
    correr([
      ['sí, a las 10:30', [REC_1030], 'ejecutar'],
      ['sí, a las 10.30', [REC_1030], 'ejecutar'],
      ['sí, a las 10 30', [REC_1030], 'ejecutar'],
      ['yes, at 10:30', [REC_1030], 'ejecutar'],
      ['sí, a las 10.30 am', [REC_1030], 'ejecutar'],
      ['sí, el de las 10.30', [REC_1030, REC_1130], 'ejecutar'],
      ['sí, el de las 10:30', [REC_1030, REC_1130], 'ejecutar'],
      ['sí, el de las 11 30', [REC_1030, REC_1130], 'ejecutar'],
      ['sí, a las 10.45', [REC_1030], 'preguntar'],
    ]),
    []
  );
});

test('ronda 12 (3): solo es ambiguo si TODO lo dicho podría ser de la otra decisión', () => {
  assert.deepEqual(
    correr([
      ['sí, mándale el whatsapp a Ana', [{ tipo: 'whatsapp', destino: 'Ana 50499990002@s.whatsapp.net', tema: 'Hola' }, { tipo: 'correo', destino: 'Bruno bruno@example.test', tema: 'Te escribo por whatsapp mejor' }], 'ejecutar:whatsapp'],
      ['sí, el correo a Ana', [{ tipo: 'correo', destino: 'Ana ana@example.test', tema: 'Informe' }, compu('¿Archivo el correo de Bruno?')], 'ejecutar:correo'],
      // Lo que podría ser de las dos sigue preguntando.
      ['sí, el correo', [{ tipo: 'correo', destino: 'Ana ana@example.test', tema: 'Informe' }, compu('¿Archivo el correo de Bruno?')], 'preguntar'],
      ['sí, el de la computadora', [compu('¿Borro la carpeta Descargas?'), { tipo: 'whatsapp', destino: 'Bruno 50477770001@s.whatsapp.net', tema: 'Ya arreglé la computadora, te la llevo' }], 'preguntar'],
      ['sí, a Bo', [{ tipo: 'correo', destino: 'Bo bo@example.test', tema: 'Hola' }, compu('¿Le mando el archivo a Bo por Drive?')], 'preguntar'],
      ['sí, el de la luz', [{ tipo: 'correo', destino: 'luz@example.test', tema: 'Hola Luz' }, { tipo: 'whatsapp', destino: 'Paz (+50477770003)', tema: 'Mañana cortan la luz' }], 'preguntar'],
      ['sí, la computadora', [compu('¿Borro Descargas?'), { tipo: 'recordatorio', destino: 'Apagar', texto: 'Apagar la computadora', cuando: 1791217800000 }], 'preguntar'],
    ]),
    []
  );
});

test('ronda 12 (uso normal): siguen ejecutando', () => {
  assert.deepEqual(
    correr([
      ['sí, a ana', [{ tipo: 'whatsapp', destino: 'Ana María 50499990002@s.whatsapp.net', tema: 'Llego a las 3' }], 'ejecutar'],
      ['sí', [{ tipo: 'correo', destino: 'Ana ana@example.test', tema: 'Informe Va el informe' }], 'ejecutar'],
      ['sí, el correo', [{ tipo: 'correo', destino: 'Ana ana@example.test', tema: 'Informe' }, { tipo: 'whatsapp', destino: 'Bruno 504@s.whatsapp.net', tema: 'Hola' }], 'ejecutar:correo'],
      ['sí, el whatsapp', [{ tipo: 'correo', destino: 'Ana ana@example.test', tema: 'Informe' }, { tipo: 'whatsapp', destino: 'Bruno 504@s.whatsapp.net', tema: 'Hola' }], 'ejecutar:whatsapp'],
      ['yes, the email', [{ tipo: 'correo', destino: 'Ana ana@example.test', tema: 'Report' }, { tipo: 'whatsapp', destino: 'Bruno 504@s.whatsapp.net', tema: 'Hi' }], 'ejecutar:correo'],
      ['sí, el correo', [{ tipo: 'correo', destino: 'Ana ana@example.test', tema: 'Te reenvío el correo de Bruno' }], 'ejecutar:correo'],
      ['sí, el whatsapp', [{ tipo: 'whatsapp', destino: 'Ana 50499990002@s.whatsapp.net', tema: 'Te paso mi whatsapp nuevo' }], 'ejecutar:whatsapp'],
    ]),
    []
  );
});
