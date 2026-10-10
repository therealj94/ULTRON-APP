/**
 * Tanda A de la auditoría del 7-oct (sin red): las herramientas según lo que pide la frase hablada, ANT-ONIO en la
 * herramienta de la app, lo prometido que no suena antes de su recibo, el tope del pedido, la línea de cada envío y
 * dónde se va «preparado».
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { herramientasDelTurno, lineaDeHerramienta, type ManosDelTurno } from '../lib/cerebro-manos';
import { extraerAcciones, validarAccion } from '../lib/acciones-app';
import { HERRAMIENTAS_NUCLEO, herramientasSegunFrase } from '../lib/herramientas-turno';
import { promesaSinCumplir, trozoPrometeAccion } from '../lib/honestidad';
import { acotarPedido, TOPE_PEDIDO_TEXTO_CAR, TOPE_PEDIDO_VOZ_CAR } from '../lib/tope-pedido';
import { lineaDeEnvio } from '../lib/envios';
import { pasosDePreparar } from '../lib/tiempos-turno';

const COMPLETO: ManosDelTurno = {
  app: true,
  manos: ['llamar', 'leer', 'buscar', 'idioma', 'perfil', 'recordatorio', 'llamame', 'cartera', 'pagar'],
  sistema: true,
  computadora: true,
  correo: true,
  whatsapp: true,
  sesion: true,
  triaje: true,
  investigar: true,
  documentos: true,
};
const TODAS = herramientasDelTurno(COMPLETO);
const CONTACTOS = ['Ana', 'Beto', 'Mamá', 'Carlos Banco', 'Doctor Ríos'];
const elegir = (mensaje: string, extra: Partial<Parameters<typeof herramientasSegunFrase>[1]> = {}) => {
  const e = herramientasSegunFrase(TODAS, { mensaje, contactos: CONTACTOS, ...extra });
  return { ...e, nombres: e.herramientas.map((t) => String(t.toolSpec?.name)) };
};

/* ------------------------------------------------------------------ ANT-ONIO */

test('ANT-ONIO: «avatar_antonio» está en la herramienta de la app y se vuelve la acción que la app valida', () => {
  const ajustar = TODAS.find((t) => t.toolSpec?.name === 'ajustar_app')!;
  const cambios = (ajustar.toolSpec!.inputSchema!.json as any).properties.cambio.enum as string[];
  for (const c of ['avatar_guardian', 'avatar_aura', 'avatar_claudio', 'avatar_antonio']) assert.ok(cambios.includes(c), c);
  const linea = lineaDeHerramienta('ajustar_app', { cambio: 'avatar_antonio' });
  assert.equal(linea, 'ACCION_APP: {"tipo":"avatar","valor":"antonio"}');
  const { acciones } = extraerAcciones(`Va.\n${linea}`);
  assert.deepEqual(validarAccion(acciones[0]), { tipo: 'avatar', valor: 'antonio' });
  // Los de siempre, igual; uno que no existe no se inventa.
  assert.equal(lineaDeHerramienta('ajustar_app', { cambio: 'avatar_guardian' }), 'ACCION_APP: {"tipo":"avatar","valor":"ojos"}');
  assert.equal(lineaDeHerramienta('ajustar_app', { cambio: 'avatar_claudio' }), 'ACCION_APP: {"tipo":"avatar","valor":"claudio"}');
  assert.equal(lineaDeHerramienta('ajustar_app', { cambio: 'avatar_pepito' }), null);
});

/* ------------------------------------------------------------------ las herramientas según la frase */

test('la charla, un saludo o una pregunta simple: solo el núcleo (auditoría del 10-oct: antes, solo buscar_web)', () => {
  const nucleo = TODAS.map((t) => String(t.toolSpec?.name)).filter((n) => HERRAMIENTAS_NUCLEO.includes(n));
  for (const m of ['¿Qué opinas de la música de los noventa?', 'Estoy cansado, fue un día largo.', '¿Cuál es la capital de Francia?', 'Buenas noches, que descanses', '¿Te acuerdas de lo que hablamos?', 'Cuéntame un chiste']) {
    const e = elegir(m);
    assert.deepEqual(e.nombres, nucleo, `${m}: ${e.nombres.join(', ')}`);
    assert.equal(e.todas, false);
  }
});

test('lo que pide una acción lleva su herramienta, también sin el verbo de siempre', () => {
  const casos: Array<[string, string[]]> = [
    ['Mándale un WhatsApp a Ana que llego tarde', ['whatsapp']],
    ['Contéstale a Beto que sí voy', ['whatsapp', 'correo', 'chat_aura', 'circulo']],
    ['Revisa mi correo', ['correo']],
    ['Recuérdame mañana a las 8 llamar al banco', ['recordatorio', 'llamarme']],
    ['El jueves tengo cita con el dentista, que no se me pase', ['recordatorio']],
    ['Llámame en diez minutos', ['llamarme']],
    ['Márcale a Beto', ['llamar_contacto']],
    ['Necesito hablar con Ana', ['llamar_contacto', 'whatsapp']],
    ['Usa tu computadora para comparar vuelos en Kayak', ['computadora']],
    ['Hazme un informe en Word sobre la mina', ['crear_documento']],
    ['Prepárame una cotización para el cliente', ['crear_documento']],
    ['Investiga a fondo la minera de Copán', ['investigar']],
    ['Ponme a ANT-ONIO', ['ajustar_app']],
    ['Me gustaría que te vieras como Claudio', ['ajustar_app']],
    ['Ponlo en modo oscuro', ['ajustar_app']],
    ['Abre mis misiones', ['abrir_pantalla']],
    ['Háblame en inglés', ['cambiar_idioma']],
    ['¿Cuánto tengo en mi wallet?', ['cartera_saldo']],
    ['Dime Chepe', ['recordar_de_mi']],
    ['¿Qué tengo pendiente?', ['ordenar_mensajes']],
    ['¿Qué me dijo Marisol?', ['whatsapp']],
    ['Lee esta página https://www.bch.hn', ['leer_pagina']],
    ['¿Cómo está el sistema?', ['estado_sistema']],
  ];
  for (const [m, necesita] of casos) {
    const e = elegir(m);
    for (const n of necesita) assert.ok(e.nombres.includes(n), `${m}: falta ${n} (lleva ${e.nombres.join(', ')})`);
    assert.ok(e.nombres.includes('buscar_web'), `${m}: buscar_web siempre`);
  }
});

test('José, 7-oct 00:30: WhatsApp solo si la frase o la decisión pendiente es de un mensaje', () => {
  const anterior = 'Te quedó pendiente enviarle un WhatsApp a Marisol sobre la reunión.';
  // WhatsApp va en el núcleo (auditoría del 10-oct); lo que no se arrastra es el GRUPO de mensajes (la intención). Que no
  // se corra fuera de tema lo cuida herramientaFueraDeTema (lib/cerebro-manos.ts).
  const deMensajes = (e: { grupos: string[] }) => e.grupos.includes('whatsapp') || e.grupos.includes('mensajes');
  for (const m of ['Cámbiame el tema a oscuro', '¿Y qué más hay para hoy?', 'Cuéntame algo bonito', 'Ponme a Claudio', '¿Qué hora es en Madrid?', 'Ana estaba contenta ayer con lo de la mina de Danlí']) {
    const e = elegir(m, { anterior });
    assert.ok(!deMensajes(e), `${m}: lleva el grupo de mensajes (${e.grupos.join(', ')})`);
  }
  // Un «sí» a «¿Le escribo a Marisol…?», o lo que contesta a «¿A quién le escribo?»: sí.
  assert.ok(deMensajes(elegir('Sí, dale', { anterior: '¿Le escribo a Marisol que la reunión pasa a las 3?' })));
  assert.ok(deMensajes(elegir('a Marisol', { anterior: '¿A quién le mando el WhatsApp?' })));
  // Cambiar de tema después de una propuesta no arrastra la herramienta de la propuesta.
  assert.ok(!deMensajes(elegir('¿Y tú cómo pasaste la semana?', { anterior: '¿Le escribo a Marisol que la reunión pasa a las 3?' })));
  // Un borrador de WhatsApp que espera su decisión: sí (puede pedir cambiarlo o releerlo).
  assert.ok(elegir('ponlo más formal', { esperaWhatsapp: true }).grupos.includes('whatsapp'));
});

test('ante la duda, todas: un verbo de acción sin grupo, o un «sí» a algo que no se sabe qué es', () => {
  const dudosa = elegir('Encárgate de eso que te dije');
  assert.equal(dudosa.todas, true);
  assert.equal(dudosa.nombres.length, TODAS.length);
  // El «sí» a algo pendiente lleva lo de mensajes, llamadas y recordatorios.
  const si = elegir('Sí', { esperaSi: true });
  for (const n of ['whatsapp', 'correo', 'chat_aura', 'llamar_contacto', 'llamarme', 'recordatorio']) assert.ok(si.nombres.includes(n), `${n}: ${si.nombres.join(', ')}`);
  // Un «sí» a una oferta que no se reconoce: todas.
  assert.equal(elegir('Sí, hazlo', { anterior: '¿Quieres que lo organice por ti?' }).todas, true);
  // Lo que solo hace el teléfono (la cámara, la música) no pide herramientas del cerebro.
  assert.equal(elegir('Pon la cámara de atrás').todas, false);
  // Con una tarea en curso, la herramienta de la tarea va siempre.
  assert.ok(elegir('ya está', { conTarea: true }).nombres.includes('tarea'));
});

test('en el orden de siempre y solo de las que el turno tiene (un invitado sin manos privadas sigue sin ellas)', () => {
  const e = elegir('Mándale un WhatsApp a Ana y revisa mi correo');
  const orden = TODAS.map((t) => String(t.toolSpec?.name)).filter((n) => e.nombres.includes(n));
  assert.deepEqual(e.nombres, orden);
  const sinPrivadas = herramientasDelTurno({ ...COMPLETO, whatsapp: false, correo: false, triaje: false });
  const inv = herramientasSegunFrase(sinPrivadas, { mensaje: 'Mándale un WhatsApp a Ana' }).herramientas.map((t) => String(t.toolSpec?.name));
  assert.ok(!inv.includes('whatsapp') && !inv.includes('correo'));
});

/* ------------------------------------------------------------------ lo prometido no suena antes de su recibo */

test('el stream retiene la promesa de una acción («ya te lo mando», «te llamo en 30 segundos»); la charla no', () => {
  for (const t of ['Va, ya te lo mando.', '¡Va, te llamo en 30 segundos!', 'Ahí te marco a Beto.', 'Listo, te pongo el recordatorio para las 8.', 'Ya le escribo a Ana.']) assert.equal(trozoPrometeAccion(t), true, t);
  for (const t of ['París es la capital de Francia.', 'No le mandé nada todavía.', 'Ana dijo que te llama mañana.', '¿Quieres que le mande la factura?', 'Ayer te mandé el informe.']) assert.equal(trozoPrometeAccion(t), false, t);
  // Con un borrador esperando su «sí», lo que se dice de ESE borrador sale (es verdad mientras espera).
  assert.equal(trozoPrometeAccion('Si me dices que sí, lo mando.', { borradorPendiente: true }), false);
  assert.equal(trozoPrometeAccion('Si me dices que sí, lo mando.'), true);
});

test('la promesa de lo que pidió, sin herramienta ni recibo, se corrige aunque la re-pregunta diga «NADA»; «te mando un abrazo» no', () => {
  assert.equal(promesaSinCumplir({ dicho: 'Va, te lo mando.', mensaje: 'mándale a Ana que llego tarde' }), true);
  assert.equal(promesaSinCumplir({ dicho: '¡Va, te llamo en un minuto!', mensaje: 'qué tranquila está la tarde' }), true, 'llamarla es concreto');
  assert.equal(promesaSinCumplir({ dicho: 'Te mando un abrazo, descansa.', mensaje: 'buenas noches' }), false);
  assert.equal(promesaSinCumplir({ dicho: '¡Hola! Te llamo para recordarte la pastilla.', mensaje: '[[recordatorio]] La pastilla' }), false, 'la llamada que está pasando');
  assert.equal(promesaSinCumplir({ dicho: 'Te pongo la cámara trasera.', mensaje: 'cámara de atrás' }), false, 'lo del teléfono lo corrige su propia guarda');
  assert.equal(promesaSinCumplir({ dicho: 'Si me dices que sí, lo mando.', mensaje: '¿qué pasó con lo de Ana?', borradorPendiente: true }), false);
});

/* ------------------------------------------------------------------ el tope del pedido */

test('el pedido con tope: primero lo viejo del hilo, después el HECHO más largo; el system nunca', () => {
  const system = 'S'.repeat(9_000);
  const hilo = Array.from({ length: 16 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `${i}:${'h'.repeat(1_700)}` }));
  const hechos = ['corto', `LARGO ${'x'.repeat(20_000)}`];
  const a = acotarPedido({ system, hechos, hilo, mensaje: 'hola' }, { voz: false });
  assert.ok(a.despues <= TOPE_PEDIDO_TEXTO_CAR, `${a.despues}`);
  assert.equal(a.hechos[0], 'corto');
  assert.match(a.hechos[1], /^LARGO x+ …\(recortado\)$/);
  assert.ok(a.hilo.length >= 2 && a.hilo[0].role === 'user', 'el hilo empieza por la persona');
  assert.equal(a.hilo.at(-1)!.content, hilo.at(-1)!.content, 'lo último del hilo queda');
  assert.equal(a.mensaje, 'hola');
  assert.ok(a.recortes.some((r) => r.startsWith('hilo')) && a.recortes.some((r) => r.startsWith('hechos')));
  // Hablando, más corto; uno que ya cabe no se toca.
  assert.ok(acotarPedido({ system, hechos, hilo, mensaje: 'hola' }, { voz: true }).despues <= TOPE_PEDIDO_VOZ_CAR);
  const chico = acotarPedido({ system: 'S', hechos: ['h'], hilo: [{ role: 'user', content: 'a' }], mensaje: 'hola' }, { voz: true });
  assert.deepEqual(chico.recortes, []);
});

/* ------------------------------------------------------------------ la línea de cada envío */

test('cada envío deja su línea: resultado, origen, ms y hashes; nunca el contenido, el chat ni la cuenta', () => {
  const ok = lineaDeEnvio('whatsapp', 'jose@ordenglobal.org', { estado: 'succeeded', entrega: 'aceptado', operacion: 'envio-whatsapp-abc123', repetido: false, referencia: '3EB0ABCDEF+50499998888' }, 812.4);
  assert.match(ok, /^\[envio\] whatsapp ok origen=borrador ms=812 entrega=aceptado recibo=[0-9a-f]{10} op=[0-9a-f]{10} cuenta=[0-9a-f]{10}$/);
  assert.doesNotMatch(ok, /jose|ordenglobal|50499998888|3EB0/);
  assert.match(lineaDeEnvio('correo', 'a@b.c', { estado: 'unknown', entrega: 'incierto', operacion: 'envio-correo-app-xyz', repetido: false }, 5), /^\[envio\] correo incierto origen=app ms=5 entrega=incierto recibo=- /);
  assert.match(lineaDeEnvio('correo', 'a@b.c', { estado: 'failed', operacion: 'envio-correo-1', repetido: false, motivo: 'aprobacion-no-coincide' }, 1), /^\[envio\] correo no-intentado .*motivo=aprobacion-no-coincide/);
  assert.match(lineaDeEnvio('whatsapp', 'a@b.c', { estado: 'failed', entrega: 'fallido', operacion: 'envio-whatsapp-1', repetido: false }, 1), /^\[envio\] whatsapp error /);
});

/* ------------------------------------------------------------------ el catálogo dice la verdad */

test('el catálogo: el cerebro es el de Bedrock con su respaldo, la voz es ElevenLabs, y están las manos con su salud', async () => {
  const { catalogoCapacidades, VOZ_OFICIAL } = await import('../lib/capacidades');
  const base = { qwen: false, ojo: true, voz: false, memoriaS3: true, telegram: true, telegramIn: true, ejecutor: false, vision: true, oido: true };
  const real = {
    ...base,
    cerebro: { activo: true, modelo: 'zai.glm-5', respaldo: 'moonshotai.kimi-k2.5', degradados: [] },
    eleven: true,
    whatsapp: { configurado: true, vivo: true },
    correo: true,
    computadora: { configurada: true, vivo: false },
    documentos: true,
  };
  const cat = catalogoCapacidades(real);
  const de = (id: string) => cat.find((c) => c.id === id)!;
  // El cerebro: GLM-5 en Bedrock con Kimi de respaldo; vivo aunque el nodo Qwen no conteste (antes: «caído»).
  assert.match(de('chat').detalle, /GLM-5 \(Z\.ai\) en Amazon Bedrock, con Kimi K2\.5 \(Moonshot\) de respaldo/);
  assert.doesNotMatch(de('chat').detalle, /Qwen 3\.8 27B en nodo propio\./);
  assert.equal(de('chat').vivo, true);
  // Bedrock en pausa por fallos: lo dice, y contesta el nodo.
  const pausa = catalogoCapacidades({ ...real, qwen: true, cerebro: { activo: false, pausado: true, modelo: 'zai.glm-5', respaldo: null } }).find((c) => c.id === 'chat')!;
  assert.match(pausa.detalle, /en pausa por fallos seguidos: contesta el Qwen 27B del nodo propio/);
  assert.equal(pausa.vivo, true);
  // La voz: ElevenLabs viva aunque Voicebox no conteste (antes: «voz caída» mientras hablaba).
  assert.equal(de('voz').vivo, true);
  assert.match(de('voz').detalle, /ElevenLabs/);
  assert.match(de('voz').detalle, /Ahora habla con ElevenLabs/);
  assert.match(VOZ_OFICIAL.motor, /^ElevenLabs/);
  assert.equal(catalogoCapacidades({ ...real, eleven: false, voz: false }).find((c) => c.id === 'voz')!.vivo, false);
  // Las manos que faltaban, con su salud real.
  assert.equal(de('whatsapp').vivo, true);
  assert.equal(de('correo').vivo, null, 'cada buzón no se mide aquí');
  assert.equal(de('computadora').vivo, false);
  assert.match(String(de('computadora').falta), /no contesta/);
  assert.equal(de('recordatorios').donde, 'apk');
  assert.match(de('recordatorios').detalle, /Viven en ese teléfono/);
  assert.equal(de('documentos').vivo, true);
  assert.equal(catalogoCapacidades({ ...real, whatsapp: { configurado: false, vivo: false } }).find((c) => c.id === 'whatsapp')!.vivo, false);
  // «Puedes interrumpirla» solo con el interruptor encendido (viene apagado: en prueba, por el eco).
  assert.doesNotMatch(de('oido').detalle, /interrumpirla hablando/);
  assert.match(de('oido').detalle, /dile «calla»/);
  assert.match(catalogoCapacidades({ ...real, interrumpir: true }).find((c) => c.id === 'oido')!.detalle, /Puedes interrumpirla hablando/);
  // En tú, no en vos.
  const textos = cat.map((c) => `${c.titulo} ${c.detalle} ${c.ejemplos.join(' ')}`).join('\n');
  assert.doesNotMatch(textos, /\b(podés|tenés|querés|decime|contame|hablá|leé|hacé|orá|mandá|anotá|recordá|sabés|sos|opinás|resumime|corré|abrí|ponete|redesplegá|vos)\b/i);
});

test('la bienvenida de Telegram: sin «Cerebro Qwen 3.8 27B en nodo propio» ni Voicebox, y en tú', async () => {
  const { mensajeBienvenidaUltron } = await import('../lib/bienvenida');
  const m = mensajeBienvenidaUltron({ nombre: 'Mayra', quien: 'mayra' });
  assert.match(m, /Amazon Bedrock/);
  assert.doesNotMatch(m, /Cerebro Qwen 3\.8 27B en nodo propio/);
  assert.doesNotMatch(m, /Voicebox/);
  assert.doesNotMatch(m, /\b(vos|podés|pedís|usás|decime|subí|mandame|pedime|escribime)\b/i);
});

/* ------------------------------------------------------------------ dónde se va «preparado» */

test('preparar lento deja una línea con lo que tardó cada paso (nada si fue rápido)', () => {
  const p = pasosDePreparar(1_000);
  p.marca('memoria', 1_200);
  p.marca('decisiones', 9_200);
  p.marca('prompt', 9_400);
  assert.equal(p.linea(9_500), '[turno] preparar lento: 8500 ms (memoria 200 ms · decisiones 8000 ms · prompt 200 ms · resto 100 ms)');
  assert.equal(pasosDePreparar(0).linea(1_000), '');
});
