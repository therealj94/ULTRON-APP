// Las pestañas de los chats MONTADAS (auditoría visual del 7-oct, A1): whatsapp/ChatsConWhatsapp.tsx corre de verdad
// (estado, efectos, re-render) y la prueba mira las dos cosas que la persona ve: qué pestaña está marcada y en qué
// página quedó el deslizador. Tienen que ser SIEMPRE la misma.
//
//   · «Abre WhatsApp» con el estado de WhatsApp llegando después (la carrera del bug): la pestaña WhatsApp marcada
//     y el deslizador en la página de WhatsApp (antes: la pestaña verde y los chats de PULSE2CHAT debajo).
//   · Lo mismo cuando primero llega lo guardado en el teléfono (sin red) y después el servidor.
//   · Tocar una pestaña, deslizar con el dedo, girar el teléfono, que WhatsApp desaparezca estando en él y volver a
//     pedir «abre WhatsApp»: la pestaña y la página nunca se separan.
//
//   node construir.cjs && node pestanas.cjs
//   CHATS=/ruta/otro-paquete.cjs node pestanas.cjs     (el mismo arnés contra otro código: ver construir.cjs)
const assert = require('node:assert/strict');

const M = require(process.env.CHATS || './out/chats.cjs');
const { CHATS, MONTAR } = M;
const { React, montar, buscar, textoDe } = MONTAR;
const rn = globalThis.__rnChats;
const wa = globalThis.__wa;
const h = React.createElement;

async function vaciar() {
  for (let i = 0; i < 40; i++) await new Promise((r) => setImmediate(r));
}

const VINCULADO = { disponible: true, permitido: true, vinculado: true, numero: '+504 9999-0000' };

/** Monta los chats con props que la prueba puede cambiar después (`poner`). */
function escena(inicial, { guardado = null } = {}) {
  rn.ancho = 412;
  rn.desplazamientos = [];
  wa.pendientes = [];
  wa.guardado = guardado;
  globalThis.__paginas = {};
  let poner = null;
  function Raiz() {
    const [p, setP] = React.useState(inicial);
    poner = setP;
    return h(CHATS.ChatsConWhatsapp, { onAbrir() {}, ...p });
  }
  const m = montar(h(Raiz));
  const vista = {
    m,
    poner: (p) => poner((a) => ({ ...a, ...p })),
    /** Las pestañas que se ven (las de la primera página: todas dibujan el mismo cambio). */
    pestanas: () => {
      const pulse = buscar(m.raiz, (n) => n.props?.pagina === 'pulse')[0];
      return buscar(pulse, (n) => n.type === 'Pressable' && n.props.accessibilityRole === 'tab');
    },
    marcada: () => {
      const t = vista.pestanas().find((n) => n.props.accessibilityState?.selected);
      return t ? textoDe(t).replace(/\d+$/, '').trim() : null;
    },
    /** Las páginas del deslizador, en orden. */
    paginas: () => buscar(m.raiz, (n) => n.type === 'View' && typeof n.props?.pagina === 'string').map((n) => n.props.pagina),
    /** La página que quedó a la vista: la del último scrollTo (o la primera si nunca se movió). */
    aLaVista: () => {
      const u = rn.desplazamientos[rn.desplazamientos.length - 1];
      const i = u ? Math.round(u.x / rn.ancho) : 0;
      return vista.paginas()[i];
    },
    deslizador: () => buscar(m.raiz, (n) => n.type === 'ScrollView')[0],
    tocar: async (texto) => {
      const t = vista.pestanas().find((n) => textoDe(n).startsWith(texto));
      assert.ok(t, `la pestaña ${texto}`);
      t.props.onPress();
      await vaciar();
    },
    contestar: async (estado) => {
      await vaciar();
      const d = wa.pendientes.shift();
      assert.ok(d, 'había una pregunta por el estado de WhatsApp');
      d.ok(estado);
      await vaciar();
    },
  };
  return vista;
}

const NOMBRE = { pulse: 'PULSE2CHAT', whatsapp: 'WhatsApp', correos: 'Correos', cartera: 'Veta Wallet' };
function coinciden(v, donde) {
  const pagina = v.aLaVista();
  assert.equal(v.marcada(), NOMBRE[pagina], `${donde}: la pestaña marcada (${v.marcada()}) y la página a la vista (${pagina}) son la misma`);
  assert.equal(globalThis.__paginas[pagina]?.activa ?? pagina === 'pulse', true, `${donde}: la página a la vista es la activa`);
}

let fallos = 0;
const pruebas = [];
const prueba = (nombre, f) => pruebas.push([nombre, f]);

prueba('la vista sale de una sola fuente (vistaPaginas)', () => {
  assert.deepEqual(CHATS.vistaPaginas(false, 'whatsapp'), { paginas: ['pulse', 'correos', 'cartera'], pagina: 'pulse', indice: 0 }, 'sin WhatsApp todavía, se ve PULSE2CHAT');
  assert.deepEqual(CHATS.vistaPaginas(true, 'whatsapp'), { paginas: ['pulse', 'whatsapp', 'correos', 'cartera'], pagina: 'whatsapp', indice: 1 });
  assert.equal(CHATS.vistaPaginas(true, 'correos').indice, 2, 'al aparecer WhatsApp, Correos se corre un lugar');
});

prueba('«abre WhatsApp» y el estado llega después: pestaña WhatsApp y página de WhatsApp (el bug A1)', async () => {
  const v = escena({ enWhatsapp: true });
  await vaciar();
  coinciden(v, 'sin estado todavía');
  await v.contestar(VINCULADO);
  assert.equal(v.marcada(), 'WhatsApp', 'la pestaña WhatsApp queda marcada');
  assert.equal(v.aLaVista(), 'whatsapp', 'y debajo están los chats de WhatsApp, no los de PULSE2CHAT');
  coinciden(v, 'con el estado');
  v.m.desmontar();
});

prueba('sin red: llega primero lo guardado en el teléfono y después el servidor; siempre WhatsApp', async () => {
  const v = escena({ enWhatsapp: true }, { guardado: { estado: VINCULADO, chats: [] } });
  await vaciar();
  assert.equal(v.marcada(), 'WhatsApp', 'con lo guardado (sin red), la pestaña WhatsApp sigue ahí y marcada');
  assert.equal(v.aLaVista(), 'whatsapp');
  await v.contestar(VINCULADO);
  assert.equal(v.aLaVista(), 'whatsapp', 'el servidor contesta y sigue en WhatsApp');
  coinciden(v, 'después del servidor');
  v.m.desmontar();
});

prueba('tocar una pestaña: se desliza (con animación) a esa página', async () => {
  const v = escena({});
  await v.contestar(VINCULADO);
  coinciden(v, 'al abrir');
  assert.equal(v.marcada(), 'PULSE2CHAT');
  await v.tocar('Correos');
  assert.equal(v.aLaVista(), 'correos');
  assert.equal(rn.desplazamientos[rn.desplazamientos.length - 1].animado, true, 'al tocar, con animación');
  coinciden(v, 'Correos');
  await v.tocar('WhatsApp');
  coinciden(v, 'WhatsApp');
  v.m.desmontar();
});

prueba('deslizar con el dedo: la pestaña sigue a la página donde se soltó', async () => {
  const v = escena({});
  await v.contestar(VINCULADO);
  rn.desplazamientos.push({ x: 3 * rn.ancho, animado: true }); // el dedo la dejó en la cuarta página
  v.deslizador().props.onMomentumScrollEnd({ nativeEvent: { contentOffset: { x: 3 * rn.ancho } } });
  await vaciar();
  assert.equal(v.marcada(), 'Veta Wallet');
  coinciden(v, 'tras deslizar');
  v.m.desmontar();
});

prueba('girar el teléfono: el deslizador se acomoda al ancho nuevo sin cambiar de página', async () => {
  const v = escena({ enWhatsapp: true });
  await v.contestar(VINCULADO);
  rn.ancho = 915;
  for (const f of [...rn.oyentes]) f();
  await vaciar();
  const u = rn.desplazamientos[rn.desplazamientos.length - 1];
  assert.equal(u.x, 915, 'la página de WhatsApp en el ancho nuevo');
  assert.equal(u.animado, false, 'sin animación al girar');
  coinciden(v, 'acostado');
  v.m.desmontar();
});

prueba('WhatsApp desaparece estando en él: PULSE2CHAT marcada y a la vista (nunca una pestaña fantasma)', async () => {
  const v = escena({ enWhatsapp: true });
  await v.contestar(VINCULADO);
  globalThis.__paginas.whatsapp.onEstado({ disponible: true, permitido: false, vinculado: false });
  await vaciar();
  assert.deepEqual(v.paginas(), ['pulse', 'correos', 'cartera']);
  assert.equal(v.marcada(), 'PULSE2CHAT');
  coinciden(v, 'sin WhatsApp');
  v.m.desmontar();
});

prueba('volver a pedir «abre WhatsApp» después de irse a PULSE2CHAT: vuelve a WhatsApp', async () => {
  const v = escena({ enWhatsapp: true });
  await v.contestar(VINCULADO);
  await v.tocar('PULSE2CHAT');
  coinciden(v, 'en PULSE2CHAT');
  v.poner({ enWhatsapp: false });
  await vaciar();
  v.poner({ enWhatsapp: true });
  await vaciar();
  assert.equal(v.aLaVista(), 'whatsapp');
  coinciden(v, 'pedido otra vez');
  v.m.desmontar();
});

(async () => {
  for (const [nombre, f] of pruebas) {
    try {
      await f();
      console.log('  ✓', nombre);
    } catch (e) {
      fallos++;
      console.log('  ✗', nombre, '\n     ', String(e?.message || e).split('\n').join('\n      '));
    }
  }
  console.log(`\n${pruebas.length - fallos}/${pruebas.length} bien`);
  process.exit(fallos ? 1 : 0);
})();
