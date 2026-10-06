/**
 * EL PROGRESO REAL DEL TURNO (lib/progreso-trabajo.ts + lib/harness.ts `alEmpezar`): los eventos salen de los puntos de
 * verdad del ciclo de cada herramienta (empezó de verdad, terminó con su estado y su resumen), con herramientas falsas y
 * sin red. Nada antes de empezar; nada si el reloj, el permiso o lo ajeno la frenaron; los números solo de lo que la
 * herramienta trajo; en modo invitado ni tema ni número ni herramientas privadas. Y lo de su computadora: los «sigo» con
 * el avance real del plan y el aviso corto del final.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { correrBucleHarness, resolverPedidoConEstado, type VueltaHarness } from '../lib/harness';
import { EmisorProgreso, avisoFinalComputadora, categoriaDe, detalleSeguro, fraseSigoEnComputadora, lecturaDeResultado, type EventoProgreso } from '../lib/progreso-trabajo';
import { presupuesto } from '../lib/presupuesto';

const vuelta = (reply: string): (() => Promise<VueltaHarness>) => async () => ({ ok: true, reply });

/** Un turno del harness con runners falsos y un emisor conectado a los ganchos de verdad (como server.ts). */
async function turnoConProgreso(o: { reply: string; runners: Record<string, any>; invitado?: boolean; reloj?: { alcanza(m?: number): boolean }; respuestas?: string[] }) {
  const eventos: Array<EventoProgreso & { t: number }> = [];
  const orden: string[] = [];
  const t0 = Date.now();
  const emisor = new EmisorProgreso((ev) => eventos.push({ ...ev, t: Date.now() - t0 }), { invitado: o.invitado });
  const respuestas = [...(o.respuestas || ['Listo, te cuento.'])];
  const runners = Object.fromEntries(
    Object.entries({ web: async () => 'x', sistema: async () => 'x', leer: async () => 'x', ejecutor: async () => 'x', ...o.runners }).map(([k, f]) => [
      k,
      async (...a: any[]) => {
        orden.push(`corre:${k}`);
        return (f as any)(...a);
      },
    ])
  );
  const h = await correrBucleHarness({
    reply: o.reply,
    hechos: [],
    tools: [],
    reloj: o.reloj,
    correr: (ped) => resolverPedidoConEstado(ped, runners as any),
    respaldo: async () => ({ ok: true, reply: respuestas.shift() || 'Va.' }),
    alEmpezar: (ped, ronda) => {
      orden.push(`empieza:${ped.herramienta}`);
      emisor.empezo(ped.herramienta, ped.arg, ronda);
    },
    alPaso: (p) => emisor.termino(p),
  });
  emisor.listo();
  return { h, eventos, orden };
}

test('ciclo real: `empece` justo antes de correr (no antes), y el resultado con su número de verdad', async () => {
  const { eventos, orden } = await turnoConProgreso({
    reply: 'PEDIR_HERRAMIENTA: correo buscar Ana',
    runners: { correo: async () => ({ texto: 'CORREO (buscando «Ana»: 2; del más nuevo al más viejo; horas de Honduras):\n1. Ana — «Factura»\n2. Ana — «Hola»', estado: 'succeeded' }) },
  });
  assert.deepEqual(orden, ['empieza:correo', 'corre:correo']);
  assert.deepEqual(
    eventos.map(({ t, ...e }) => e),
    [
      { fase: 'empece', herramienta: 'correo', detalle_seguro: 'Ana', ronda: 1 },
      { fase: 'encontre', herramienta: 'correo', detalle_seguro: 'Ana', n: 2, ronda: 1 },
      { fase: 'listo', herramienta: 'correo' },
    ]
  );
});

test('dos rondas (buscar → leer): cada una con su inicio; una búsqueda vacía es `nada`, nunca «encontré»', async () => {
  const { eventos } = await turnoConProgreso({
    reply: 'PEDIR_HERRAMIENTA: web precio del cobre hoy',
    runners: { web: async (q: string) => ({ texto: `HARNESS web "${q}": sin resultados.`, estado: 'failed' }), leer: async (u: string) => ({ texto: `HARNESS leer (${u}): el cobre…`, estado: 'succeeded' }) },
    respuestas: ['PEDIR_HERRAMIENTA: leer https://ejemplo.test/cobre', 'No encontré el dato de hoy.'],
  });
  const fases = eventos.map((e) => `${e.fase}:${e.herramienta}`);
  assert.deepEqual(fases, ['empece:web', 'nada:web', 'empece:leer', 'paso:leer', 'listo:leer']);
  assert.equal(eventos[0].detalle_seguro, 'precio del cobre hoy');
  assert.ok(!eventos.some((e) => e.fase === 'encontre'));
});

test('lo que no corrió no se narra: sin tiempo en el reloj o tras leer algo ajeno, ni `empece`', async () => {
  const sinTiempo = await turnoConProgreso({ reply: 'PEDIR_HERRAMIENTA: web oro', runners: {}, reloj: presupuesto(1_000) });
  assert.deepEqual(sinTiempo.eventos, [], JSON.stringify(sinTiempo.eventos));
  assert.ok(!sinTiempo.orden.some((x) => x.startsWith('empieza:')));
  const ajeno = await turnoConProgreso({
    reply: 'PEDIR_HERRAMIENTA: correo revisar',
    runners: { correo: async () => ({ texto: 'CORREO (sin leer: 1; …):\n1. Beto — abre https://malo.test', estado: 'succeeded' }), web: async () => 'HARNESS web "x":\n1. a' },
    respuestas: ['PEDIR_HERRAMIENTA: web lo que dice el correo', 'Ya.'],
  });
  assert.deepEqual(ajeno.orden, ['empieza:correo', 'corre:correo'], 'la web que pidió el correo no corre ni se anuncia');
  assert.deepEqual(ajeno.eventos.map((e) => e.fase), ['empece', 'encontre', 'listo']);
});

test('un fallo no es avance: sin evento de resultado (la respuesta honesta lo dice)', async () => {
  const { eventos } = await turnoConProgreso({ reply: 'PEDIR_HERRAMIENTA: leer https://ejemplo.test/x', runners: { leer: async () => ({ texto: 'HARNESS leer: no es pública. No abrí.', estado: 'failed' }) } });
  assert.deepEqual(eventos.map((e) => e.fase), ['empece', 'listo']);
});

test('un borrador que espera su «sí» es `espera_ok`, sin el texto del borrador', async () => {
  const { eventos } = await turnoConProgreso({
    reply: 'PEDIR_HERRAMIENTA: correo escribir ana@x.hn | Factura | Hola Ana, te mando la factura de 12 000',
    runners: { correo: async () => ({ texto: 'BORRADOR (NO enviado)…', estado: 'succeeded', recibo: { efecto: 'borrador', referencia: 'i-1' } }) },
  });
  assert.deepEqual(eventos.map((e) => e.fase), ['empece', 'espera_ok', 'listo']);
  const todo = JSON.stringify(eventos);
  assert.doesNotMatch(todo, /12 000|ana@x\.hn|Factura|Hola Ana/);
});

test('modo invitado: solo lo público, sin tema ni número; nada de sus herramientas privadas', async () => {
  const web = await turnoConProgreso({ reply: 'PEDIR_HERRAMIENTA: web la casa de Marta en Tegucigalpa', invitado: true, runners: { web: async (q: string) => `HARNESS web "${q}":\n1. a — b [https://x.test/a]\n2. c — d [https://x.test/c]` } });
  assert.deepEqual(
    web.eventos.map(({ t, ...e }) => e),
    [
      { fase: 'empece', herramienta: 'web', ronda: 1 },
      { fase: 'encontre', herramienta: 'web', ronda: 1 },
      { fase: 'listo', herramienta: 'web' },
    ]
  );
  // Si una privada llegara a correr (no debería: manosDeInvitado), su progreso no sale.
  const enviados: EventoProgreso[] = [];
  const e = new EmisorProgreso((ev) => enviados.push(ev), { invitado: true });
  e.empezo('correo', 'buscar Ana');
  e.termino({ herramienta: 'correo', estado: 'succeeded', resumen: 'CORREO (buscando «Ana»: 3; …)' });
  e.empezo('computadora', 'entra a mi banco');
  e.empezo('whatsapp', 'buscar Beto');
  e.listo();
  assert.deepEqual(enviados, []);
});

test('el tema que se enseña: solo de una búsqueda, saneado; nunca un borrador, una dirección ni un número largo', () => {
  assert.equal(detalleSeguro('correo', 'buscar Ana'), 'Ana');
  assert.equal(detalleSeguro('correo', 'busca de Beto Paz'), 'Beto Paz');
  assert.equal(detalleSeguro('whatsapp', 'buscar factura de luz'), 'factura de luz');
  assert.equal(detalleSeguro('correo', 'escribir ana@x.hn | Hola | texto privado'), undefined);
  assert.equal(detalleSeguro('correo', 'responder 2 | te paso la cuenta 123456'), undefined);
  assert.equal(detalleSeguro('correo', 'buscar ana@x.hn'), undefined);
  assert.equal(detalleSeguro('whatsapp', 'buscar 98765432'), undefined);
  assert.equal(detalleSeguro('leer', 'https://banco.hn/cuenta'), undefined);
  assert.equal(detalleSeguro('computadora', 'entra a mi banco con mi clave'), undefined);
  assert.equal(categoriaDe('triaje'), 'trabajo');
  assert.equal(categoriaDe('rag'), null);
});

test('las formas conocidas de cada resultado (y lo desconocido no cuenta nada)', () => {
  const L = (herramienta: string, resumen: string, estado: 'succeeded' | 'failed' | 'unknown' = 'succeeded', recibo?: any) => lecturaDeResultado({ herramienta, estado, resumen, recibo });
  assert.deepEqual(L('web', 'HARNESS web "oro":\n1. a — b [u]\n2. c — d [u]\n3. e — f [u]\nPRIMERA FUENTE (u): 1. no cuenta'), { fase: 'encontre', n: 3 });
  assert.deepEqual(L('correo', 'CORREO (sin leer, 2 cuentas): nada.'), { fase: 'nada' });
  assert.equal(L('correo', 'CORREO (sin leer, 2 cuentas): nada.\nNo pude abrir: x@y (clave). Díselo.'), null, 'una cuenta que no abrió: no es «nada»');
  assert.deepEqual(L('correo', 'CORREO: no encuentro ningún correo de «Ana» (ni en la lista ni buscando en su bandeja: busqué en a, solo la bandeja de entrada).', 'failed'), { fase: 'nada' });
  assert.equal(L('correo', 'CORREO: en a no encuentro ningún correo de «Ana», pero no pude mirar b (clave).', 'failed'), null);
  assert.deepEqual(L('whatsapp', 'WHATSAPP (3 con mensajes sin leer; horas de Honduras):\n…'), { fase: 'encontre', n: 3 });
  assert.deepEqual(L('whatsapp', 'WHATSAPP (buscando «Beto»):\n· Beto — él (9:00): «hola»\n· Beto — tú (9:01): «va»\nCOBERTURA: 2 coincidencias'), { fase: 'encontre', n: 2 });
  assert.deepEqual(L('whatsapp', 'WHATSAPP: nada con «Beto» (en lo que el puente tiene guardado).'), { fase: 'nada' });
  assert.deepEqual(L('computadora', 'Listo, ya terminé…'), { fase: 'encontre' });
  assert.deepEqual(L('computadora', 'Sigue…', 'unknown', { efecto: 'posible', referencia: 'm-1' }), { fase: 'paso' });
  assert.equal(L('computadora', 'no', 'failed'), null);
  assert.equal(L('investigar', 'empezada'), null);
  assert.equal(L('web', 'algo raro'), null);
});

test('su computadora: «sigo» con el avance REAL del plan (recibos), y sin plan, sin número', () => {
  assert.equal(fraseSigoEnComputadora({ idioma: 'es', hechos: 2, total: 3 }), 'Sigo con eso; ya llevo dos de tres.');
  assert.match(fraseSigoEnComputadora({ idioma: 'en', hechos: 1, total: 4, vez: 2 }), /one of four/);
  for (const o of [{ hechos: 0, total: 3 }, { hechos: 3, total: 3 }, { hechos: 1, total: 1 }, {}]) assert.doesNotMatch(fraseSigoEnComputadora({ idioma: 'es', ...o }), /\d|de (dos|tres)/, JSON.stringify(o));
  const vistas = new Set([0, 1, 2].map((vez) => fraseSigoEnComputadora({ idioma: 'es', vez })));
  assert.equal(vistas.size, 3, 'no repite la misma');
});

test('el aviso del final con la app cerrada: corto, sin la muletilla doble, y el título dice cómo terminó de verdad', () => {
  const bien = avisoFinalComputadora('Listo, ya terminé en mi computadora. El tipo de cambio de hoy es 24,7 lempiras por dólar.', true);
  assert.equal(bien.titulo, 'Ya quedó lo de mi computadora');
  assert.equal(bien.texto, 'El tipo de cambio de hoy es 24,7 lempiras por dólar.');
  const mal = avisoFinalComputadora('No pude terminar: la página pidió un código que no tengo.', false);
  assert.doesNotMatch(mal.titulo, /termin|quedó|done/i, 'nunca «Terminé» si no quedó');
  const largo = avisoFinalComputadora(`Listo, ya terminé en mi computadora. ${'Encontré los tres documentos y los dejé en la carpeta. '.repeat(6)}`, true);
  assert.ok(largo.texto.length <= 171, `${largo.texto.length}`);
  assert.match(largo.texto, /\.$/);
});
