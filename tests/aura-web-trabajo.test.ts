/**
 * LA SUPERFICIE DE TRABAJO DE LA WEB (auditoría A28, y A22 en los textos).
 *
 *  · Lo que sale del sistema (mandar por Telegram, WhatsApp o correo, avisar urgente, nota de voz,
 *    llamar) se reconoce igual que en el taller del servidor y se propone en una tarjeta: nada sale
 *    sin Confirmar. La tarjeta dice a quién, qué y cuándo, y el resultado solo es «hecho» si el canal
 *    lo confirmó.
 *  · La conversación en pantalla se guarda por cuenta y un turno que quedó a medias no se enseña
 *    como terminado.
 *  · El inicio propone tres tareas reales del catálogo, y el catálogo no promete absolutos.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { parsePedido } from '../lib/taller';
import { catalogoCapacidades } from '../lib/capacidades';
import { accionSensibleDe, cuerpoDe, resultadoDe } from '../src/13-trabajo/accionSensible';
import { claveDe, guardar, leerGuardada, type Entrada } from '../src/13-trabajo/conversacion';
import { TarjetaAccion, textoDeEstado, nombresDeHerramientas } from '../src/13-trabajo/Conversacion';
import { EJEMPLOS_INICIO } from '../src/13-trabajo/Inicio';

/** Lo que el taller haría con la frase, en los términos de la tarjeta (o null si no sale nada). */
function delTaller(frase: string): string | null {
  const p = parsePedido(frase);
  if (p.accion === 'enviar' || (p.accion === 'pdf' && p.canal)) return p.canal ? `enviar:${p.canal}` : null;
  if (p.accion === 'urgente') return 'urgente:telegram';
  if (p.accion === 'voz') return 'nota-voz:telegram';
  if (p.accion === 'llamar') return 'llamar:telefono';
  return null;
}

const FRASES = [
  'manda por telegram que la junta es mañana a las 9',
  'envía por correo el resumen de hoy',
  'mándame un pdf por whatsapp',
  'envía por telegram un pdf: faltan whatsapp, correo, llamada',
  'avisame urgente que se cayó el nodo',
  'urgente: llamen a Medardo',
  'llámame y dime hola',
  'haz una llamada',
  'mándame audio del sistema',
  'nota de voz del estado',
  // Lo que NO sale del sistema:
  'cómo está el sistema',
  'estado del sistema por telegram',
  'abre la bóveda',
  'redespliega la mesa',
  'haz un pdf del resumen',
  '¿quién manda en Honduras?',
  'precio del oro hoy',
  'hola',
  'mantenimiento de los nodos',
  'anota que mañana hay junta',
];

test('la tarjeta aparece exactamente cuando el taller del servidor mandaría algo', () => {
  for (const f of FRASES) {
    const a = accionSensibleDe(f);
    assert.equal(a ? `${a.tipo}:${a.canal}` : null, delTaller(f), f);
  }
});

test('la tarjeta dice a quién, qué y lo que se va a mandar', () => {
  const a = accionSensibleDe('manda por telegram que la junta es mañana a las 9')!;
  assert.equal(a.tipo, 'enviar');
  assert.match(a.destinatario, /Telegram de la junta/);
  assert.equal(a.contenido, 'que la junta es mañana a las 9');
  assert.equal(cuerpoDe('envía por correo el resumen'), 'el resumen');
  assert.match(accionSensibleDe('haz una llamada')!.destinatario, /Twilio/);
});

test('el resultado solo es «hecho» si el canal lo confirmó', () => {
  assert.equal(resultadoDe('Mensaje enviado a chat -100123.').estado, 'hecha');
  assert.equal(resultadoDe('WhatsApp aceptado (SM123).').estado, 'hecha');
  assert.equal(resultadoDe('Llamada iniciada a +504… (CA1).').estado, 'hecha');
  assert.equal(resultadoDe('Falta TELEGRAM_BOT_TOKEN o TELEGRAM_CHAT_ID. No envié nada.').estado, 'fallida');
  assert.equal(resultadoDe('Telegram 403: {"ok":false}').estado, 'fallida');
  assert.equal(resultadoDe('NO EJECUTADO (regla x): motivo').estado, 'fallida');
  assert.equal(resultadoDe('EN ESPERA DE APROBACIÓN (regla y, solicitud ab12): …').estado, 'espera');
  assert.equal(resultadoDe('Claro, ya está todo listo.').estado, 'sin-confirmar', 'una frase amable no es un recibo');
  assert.equal(resultadoDe('').estado, 'sin-confirmar', 'sin respuesta no se sabe si se hizo');
  assert.equal(resultadoDe('', 'interrumpido').estado, 'sin-confirmar');
  assert.equal(resultadoDe('', 'sesión requerida').estado, 'fallida');
});

test('la tarjeta pendiente tiene Confirmar y Cancelar; la resuelta, su resultado y ya no los botones', () => {
  const accion = accionSensibleDe('manda por telegram que la junta es mañana a las 9')!;
  const base = { id: 'x1', tipo: 'accion' as const, ts: Date.now(), accion, pedido: 'manda por telegram…' };
  const pendiente = renderToStaticMarkup(React.createElement(TarjetaAccion, { e: { ...base, estado: 'propuesta' }, onConfirmar: () => {}, onCancelar: () => {} } as any));
  for (const t of ['Para', 'Contenido', 'Cuándo', 'Confirmar y enviar', 'Cancelar', 'Esperando tu confirmación', 'que la junta es mañana a las 9']) assert.ok(pendiente.includes(t), t);
  const hecha = renderToStaticMarkup(
    React.createElement(TarjetaAccion, { e: { ...base, estado: 'hecha', resultado: 'Mensaje enviado a chat -100123.', tsResultado: Date.now() }, onConfirmar: () => {}, onCancelar: () => {} } as any)
  );
  assert.ok(hecha.includes('Mensaje enviado a chat -100123.'));
  assert.ok(!hecha.includes('Confirmar y enviar'));
  assert.ok(hecha.includes('el canal lo confirmó'));
});

test('el estado del turno se dice en palabras (y las herramientas internas no se enseñan)', () => {
  const ts = new Date(2026, 8, 30, 14, 5).getTime();
  assert.equal(textoDeEstado({ estado: 'pensando', herramientas: [], ts }), 'Pensando…');
  assert.equal(textoDeEstado({ estado: 'usando', herramientas: ['oro', 'cot'], ts }), 'Usando precio del oro…');
  assert.match(textoDeEstado({ estado: 'lista', herramientas: ['web'], ts, tsFin: ts, ms: 1840 }), /^Respondida a las 14:05 · 1,8 s · usó búsqueda en internet$/);
  assert.match(textoDeEstado({ estado: 'error', herramientas: [], ts }), /Sin respuesta/);
  assert.deepEqual(nombresDeHerramientas(['harness', 'rag', 'cerebro-genesis']), ['documentos', 'conocimiento de la plataforma']);
});

function almacen() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), m };
}

test('la conversación se guarda por cuenta y un turno a medias vuelve como interrumpido', () => {
  const a = almacen();
  const xs: Entrada[] = [
    { id: '1', tipo: 'persona', texto: 'hola', ts: 1 },
    { id: '2', tipo: 'aura', texto: 'Hola, José.', ts: 2, estado: 'lista', herramientas: [] },
    { id: '3', tipo: 'aura', texto: 'Busc', ts: 3, estado: 'respondiendo', herramientas: ['web'] },
  ];
  guardar('José', xs, a);
  assert.notEqual(claveDe('José'), claveDe('Carlos'));
  assert.notEqual(claveDe('José'), claveDe(null));
  assert.deepEqual(leerGuardada('Carlos', a), [], 'otra cuenta no lee la conversación de José');
  assert.deepEqual(leerGuardada(null, a), [], 'sin sesión tampoco');
  const vuelta = leerGuardada('josé', a);
  assert.equal(vuelta.length, 3);
  assert.equal((vuelta[2] as any).estado, 'interrumpida');
  guardar('José', [], a);
  assert.equal(a.m.size, 0, 'vaciar borra la clave');
});

test('el inicio propone tres tareas reales del catálogo', () => {
  assert.equal(EJEMPLOS_INICIO.length, 3);
  const nodos = { qwen: true, ojo: true, voz: true, memoriaS3: true, telegram: true, telegramIn: true, ejecutor: true, vision: true, oido: true };
  const ejemplos = catalogoCapacidades(nodos).flatMap((c) => c.ejemplos);
  for (const e of EJEMPLOS_INICIO) assert.ok(ejemplos.includes(e.pedido), `«${e.pedido}» está en el catálogo`);
});

test('el catálogo no promete absolutos («no inventa», «nadie más lo ve»)', () => {
  const nodos = { qwen: true, ojo: true, voz: true, memoriaS3: true, telegram: true, telegramIn: true, ejecutor: true, vision: true, oido: true };
  const textos = catalogoCapacidades(nodos)
    .map((c) => `${c.titulo} ${c.detalle}`)
    .join('\n');
  assert.doesNotMatch(textos, /no inventa/i);
  assert.doesNotMatch(textos, /nadie m[aá]s lo ve/i);
  assert.match(textos, /Puede equivocarse/);
  assert.match(textos, /Scribe v2 Realtime Turbo/, 'la web dice quién transcribe de verdad');
  assert.match(textos, /reconocimiento de voz del navegador/, 'y cuál es el respaldo');
});
