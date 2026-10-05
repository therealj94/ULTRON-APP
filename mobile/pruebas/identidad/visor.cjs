// Identidad · el visor de la computadora no pasa de A a B en el mismo teléfono (revisión 9, GRAVE-2).
//
//  app/visor.ts guarda en el módulo si el visor está abierto, de qué tarea, la sesión remota, el campo de escribir y el
//  lote de teclado que faltaba mandar. Antes solo la web lo olvidaba al cambiar de cuenta: en el teléfono, A abría el
//  visor, escribía algo sin mandarlo, salía, entraba B… y B veía el visor abierto en la tarea de A, el texto de A en el
//  campo y el lote de A listo para «Seguir», que salía con la tarea de A. Ahora el cambio de cuenta (fijarCuenta) lo
//  olvida en el acto, y lo que quede con la marca de otra cuenta no se lee, no se reanuda y no abre.
// Todo con envíos de mentira: nada sale del proceso.
const { ok, fin } = require('../chat/comun.cjs');

const espera = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const M = require(process.env.IDENTIDAD || './out/identidad.cjs');
  const { CUENTA, VISOR } = M;
  if (!VISOR) {
    ok('el paquete trae el visor (app/visor.ts)', false);
    return fin();
  }

  console.log('El visor de A no queda para B\n');

  const enviadas = [];
  const enviarDe = (quien) => async (e) => {
    enviadas.push({ quien, tarea: e.remoteSessionId, tipo: e.type, payload: e.payload });
    return { ok: true, frame_seq: 1 };
  };

  /* ── A abre el visor de su tarea, escribe y deja un lote pendiente ─────────────────────────── */
  CUENTA.fijarCuenta('ana@prueba.invalid', { nueva: true });
  // La marca que captura quien empieza a abrir el visor antes de un `await` (la web: abrirEscritorio).
  const marcaDeA = VISOR.marcaVisor?.();
  VISOR.abrirVisor('tarea_de_ana');
  const sesionA = VISOR.sesionDe('tarea_de_ana', enviarDe('A'));
  const { buffer: bufferA, lote: loteA } = VISOR.tecladoDe('tarea_de_ana');
  bufferA.cambiar('Hola Bruno, mi clave del banco es 4471', []);
  loteA.agregar([{ type: 'text_commit', payload: { texto: 'texto pendiente de Ana' } }]);
  ok('A: el visor está abierto en su tarea', VISOR.visorAhora().abierto && VISOR.visorAhora().tareaId === 'tarea_de_ana');
  ok('A: su lote tiene lo pendiente (sin control, no salió)', loteA.textoPendiente().texto.includes('pendiente de Ana') && enviadas.length === 0);

  /* ── A sale y entra B en el mismo teléfono ─────────────────────────────────────────────────── */
  CUENTA.fijarCuenta(null);
  CUENTA.fijarCuenta('bruno@prueba.invalid', { nueva: true });

  const v = VISOR.visorAhora();
  ok('B: el visor está cerrado', v.abierto === false && VISOR.visorAbierto() === false, JSON.stringify(v));
  ok('B: sin la tarea de A', v.tareaId == null, JSON.stringify(v));
  let tecladoSinSesion = null;
  try {
    tecladoSinSesion = VISOR.tecladoDe('tarea_de_ana');
  } catch {
    tecladoSinSesion = null;
  }
  ok('B: el campo y el lote de A no se pueden tomar sin abrir una sesión nueva', tecladoSinSesion === null, tecladoSinSesion ? JSON.stringify({ campo: tecladoSinSesion.buffer.texto, lote: tecladoSinSesion.lote.textoPendiente() }) : '');
  ok('B: la vista guardada de A no se devuelve', VISOR.vistaGuardada('tarea_de_ana') === null);

  // Aunque B llegara a montar un visor con el mismo id (una tarea vieja en pantalla), empieza de cero.
  VISOR.sesionDe('tarea_de_ana', enviarDe('B'));
  const { buffer: bufferB, lote: loteB } = VISOR.tecladoDe('tarea_de_ana');
  ok('B: el campo empieza vacío (nada de lo que escribió A)', bufferB.texto === '', JSON.stringify(bufferB.texto));
  ok('B: sin el lote pendiente de A', loteB.textoPendiente().texto === '' && !loteB.abierto(), JSON.stringify(loteB.textoPendiente()));
  ok('…y el lote de A quedó tirado (no queda para «Seguir»)', loteA.textoPendiente().texto === '', JSON.stringify(loteA.textoPendiente()));
  ok('…y el campo de A, vacío (una vista vieja no lo enseña)', bufferA.texto === '', JSON.stringify(bufferA.texto));

  // La sesión de A (la vista que se desmonta la tenía en la mano): aunque tuviera el control, no sale nada.
  sesionA.alControl(7);
  // Un texto (no espera imagen fresca: si la sesión dejara, saldría ya).
  const r1 = await sesionA.entrada('text_commit', { texto: 'directo de Ana' });
  loteA.agregar([{ type: 'text_commit', payload: { texto: 'otra cosa de Ana' } }]);
  const r2 = await loteA.reanudar().catch((e) => ({ ok: false, motivo: String(e) }));
  await espera(20);
  ok('ninguna entrada de la sesión de A salió después del cambio', enviadas.length === 0, JSON.stringify(enviadas));
  ok('…la sesión de A no da nada por hecho', r1.ok === false && r2.ok === false, JSON.stringify({ r1, r2 }));

  // Un `await` de A que vuelve tarde (abrir el visor tras buscar la tarea) no abre el visor de A para B.
  const abrio = marcaDeA ? VISOR.abrirVisor('tarea_de_ana', marcaDeA) : (VISOR.abrirVisor('tarea_de_ana'), true);
  ok('abrir con la marca de A, ya con B dentro, no abre', abrio === false && VISOR.visorAhora().abierto === false, JSON.stringify(VISOR.visorAhora()));

  /* ── A vuelve: tampoco recupera la sesión olvidada (empieza limpio) ─────────────────────────── */
  VISOR.cerrarVisor();
  CUENTA.fijarCuenta(null);
  CUENTA.fijarCuenta('ana@prueba.invalid', { nueva: true });
  ok('A → B → A: el visor sigue cerrado', VISOR.visorAhora().abierto === false && VISOR.visorAhora().tareaId == null, JSON.stringify(VISOR.visorAhora()));

  /* ── control: con la misma cuenta, cerrar y reabrir sí encuentra lo suyo ────────────────────── */
  VISOR.abrirVisor('tarea_2');
  VISOR.sesionDe('tarea_2', enviarDe('A2'));
  VISOR.tecladoDe('tarea_2').buffer.cambiar('sigo aquí', []);
  VISOR.cerrarVisor();
  VISOR.abrirVisor('tarea_2');
  VISOR.sesionDe('tarea_2', enviarDe('A2'));
  ok('control: la misma cuenta reabre y encuentra su campo', VISOR.tecladoDe('tarea_2').buffer.texto === 'sigo aquí' && VISOR.visorAhora().tareaId === 'tarea_2');

  fin();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
