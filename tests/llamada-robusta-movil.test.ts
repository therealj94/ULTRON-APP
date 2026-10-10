/**
 * LA LLAMADA DEL AVATAR NO SE CUELGA SOLA (José, 10-oct, APK 5.7.0 en el S26): desde la burbuja del botón lateral le
 * pidió a AURA que lo llamara; AURA llamó «y al contestar salió colgada la llamada». Las migas: `burbuja: cerrada
 * (fuera) · segundo plano · primer plano · voz: volvió del segundo plano a tiempo · segundo plano breve (11158 ms)` y
 * `llamada del avatar: cuelga (segundo_plano)`; y «JS bloqueado 67288 ms» / «75379 ms» con la app detrás.
 *
 * Se reproduce la secuencia con la máquina de la llamada (compa/llamadaCiclo.ts), la sesión (compa/sesion.ts) y la
 * guardia del segundo plano (compa/fondoLlamada.ts), con un reloj falso que se puede CONGELAR como Android congela los
 * timers de JS con la app detrás:
 *  · la burbuja abierta pide «llámame»: suena en la app (no se abre una sesión escondida) y la app viene delante;
 *  · los segundos planos de nuestras propias ventanas (la burbuja que se abre y se cierra, el aviso a pantalla completa,
 *    contestar) no cuelgan;
 *  · contestar abre una sesión NUEVA aunque quedara otra montada;
 *  · un reloj que llega congelado al volver no cuelga (espera el «active»); irse de verdad, pasada la gracia, sí;
 *  · el pulso del hilo de JS no cuenta el rato detrás (lib/pulsoJs.ts).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { CicloLlamada, type EfectoCiclo } from '../mobile/src/compa/llamadaCiclo';
import { ControlSesion } from '../mobile/src/compa/sesion';
import {
  ATRASO_CONGELADO_MS,
  FONDO_LARGO_MS,
  GRACIA_EN_LLAMADA_MS,
  GRACIA_FONDO_MS,
  GuardiaFondoLlamada,
  VENTANA_PROPIA_MS,
  VENTANA_TRAER_MS,
  comoAtenderLlamame,
} from '../mobile/src/compa/fondoLlamada';
import { AvisoBurbuja } from '../mobile/src/burbuja/logica';
import { PulsoJs, DetectorBloqueo } from '../mobile/src/lib/pulsoJs';

/** Un reloj falso con timers que se pueden congelar (la app detrás en Android). */
function relojFalso() {
  let ahora = 1_000_000;
  let congelado = false;
  let n = 0;
  const timers = new Map<number, { cuando: number; f: () => void }>();
  const correr = () => {
    for (;;) {
      if (congelado) return;
      const listos = [...timers.entries()].filter(([, t]) => t.cuando <= ahora).sort((a, b) => a[1].cuando - b[1].cuando);
      if (!listos.length) return;
      const [id, t] = listos[0];
      timers.delete(id);
      t.f();
    }
  };
  return {
    ahora: () => ahora,
    setTimeout: (f: () => void, ms: number) => {
      const id = ++n;
      timers.set(id, { cuando: ahora + ms, f });
      return id;
    },
    clearTimeout: (h: unknown) => void timers.delete(h as number),
    /** Pasa el tiempo; con los timers congelados, no corre nada. */
    pasar(ms: number) {
      const fin = ahora + ms;
      while (!congelado) {
        const prox = [...timers.values()].map((t) => t.cuando).filter((c) => c <= fin).sort((a, b) => a - b)[0];
        if (prox === undefined) break;
        ahora = Math.max(ahora, prox);
        correr();
      }
      ahora = fin;
    },
    congelar(si: boolean) {
      congelado = si;
      if (!si) correr();
    },
    pendientes: () => timers.size,
  };
}

/** El VozProvider en miniatura: el ciclo, la sesión, la guardia y el AppState, cableados como en la app. */
function montarLlamada() {
  const r = relojFalso();
  let appState = 'active';
  const burbuja = new AvisoBurbuja();
  const ciclo = new CicloLlamada({ reloj: r.ahora });
  const control = new ControlSesion('aura', 'es', { reloj: r.ahora });
  const migas: string[] = [];
  const cerrados: string[] = [];
  const ejecutar = (ef: EfectoCiclo[]) => {
    for (const e of ef) {
      if (e.tipo === 'abrir') control.iniciarNueva();
      if (e.tipo === 'cerrar') {
        cerrados.push(e.motivo);
        control.terminar();
      }
    }
  };
  const guardia = new GuardiaFondoLlamada({
    hayLlamada: () => ['sonando', 'conectando', 'en_llamada', 'silenciado'].includes(ciclo.estado()) || control.vista().montada,
    contestada: () => ciclo.estado() === 'en_llamada' || ciclo.estado() === 'silenciado',
    estadoApp: () => appState,
    burbuja: () => burbuja.abierta(),
    colgar: (d) => {
      migas.push(`cuelga: ${d}`);
      ejecutar(ciclo.apagar());
      control.segundoPlano();
    },
    miga: (t) => migas.push(t),
    ahora: r.ahora,
    setTimeout: r.setTimeout,
    clearTimeout: r.clearTimeout,
  });
  burbuja.suscribir(() => guardia.propia(burbuja.abierta() ? 'la burbuja se abrió' : 'la burbuja se cerró'));
  const app = (st: string) => {
    appState = st;
    guardia.estado(st);
  };
  /** La sesión conecta (ElevenLabs): el ciclo pasa a EN_LLAMADA. */
  const conecta = () => {
    control.alEstado(control.vista().gen, 'escuchando');
    ejecutar(ciclo.conectado());
  };
  return { r, ciclo, control, guardia, burbuja, app, ejecutar, conecta, migas, cerrados };
}

test('la secuencia de José: burbuja abierta → «llámame» → suena → la app viene delante → contesta → la llamada sigue', () => {
  const m = montarLlamada();
  // Estaba en AURA y abrió la burbuja (botón lateral): MainActivity se pausa (segundo plano) y la burbuja se pone delante.
  m.app('background');
  m.burbuja.fijar(true);
  m.app('active');
  // «Llámame» llega por el canal de acciones con la burbuja abierta: suena en la app, no se abre una sesión escondida.
  assert.equal(comoAtenderLlamame({ estadoApp: 'active', burbuja: m.burbuja.abierta() }), 'sonar-y-traer');
  m.ejecutar(m.ciclo.llamar({ tipo: 'llamame' }));
  assert.equal(m.ciclo.estado(), 'sonando');
  assert.equal(m.control.vista().montada, false, 'nada de ElevenLabs hasta que conteste');
  m.guardia.propia('la llamada suena: la app viene delante', VENTANA_TRAER_MS);
  // La app viene delante: la burbuja se pausa (segundo plano) unos cientos de ms y MainActivity vuelve; la burbuja se cierra.
  m.app('background');
  m.r.pasar(400);
  m.app('active');
  m.burbuja.fijar(false);
  // Contesta en la pantalla «te está llamando».
  m.ejecutar(m.ciclo.contestar());
  assert.equal(m.ciclo.estado(), 'conectando');
  m.conecta();
  assert.equal(m.ciclo.estado(), 'en_llamada');
  // Un parpadeo más (el S26 pausa la actividad ~0,1 s al bloquear la orientación) y pasa el tiempo: sigue.
  m.app('background');
  m.r.pasar(150);
  m.app('active');
  m.r.pasar(60_000);
  assert.equal(m.ciclo.estado(), 'en_llamada', `la llamada sigue (${m.migas.join(' | ')})`);
  assert.deepEqual(m.cerrados, []);
});

test('la burbuja que tarda en arrancar (11 s detrás) no cuelga la llamada; tampoco abrirla en plena llamada', () => {
  const m = montarLlamada();
  m.ejecutar(m.ciclo.hablarYa());
  m.conecta();
  // Abre la burbuja en plena llamada: segundo plano largo hasta que React avisa (el «segundo plano breve (11158 ms)»).
  m.burbuja.fijar(true);
  m.app('background');
  m.r.pasar(11_158);
  m.app('active');
  assert.equal(m.ciclo.estado(), 'en_llamada');
  // Se cierra la burbuja (fuera): otro segundo plano y vuelve AURA.
  m.app('background');
  m.r.pasar(300);
  m.app('active');
  m.burbuja.fijar(false);
  assert.equal(m.ciclo.estado(), 'en_llamada', m.migas.join(' | '));
});

test('el reloj congelado de Android: el «cuelga en 3 s» que corre AL VOLVER ya no cuelga (espera el «active»)', () => {
  const m = montarLlamada();
  m.ejecutar(m.ciclo.hablarYa());
  // Todavía conectando (gracia corta): se va detrás y Android congela los relojes de JS 75 s.
  m.app('background');
  m.r.congelar(true);
  m.r.pasar(75_379);
  // Vuelve: los relojes corren ANTES de que llegue el «active» (el orden que colgaba la llamada al contestar).
  m.r.congelar(false);
  assert.equal(m.ciclo.estado(), 'conectando', 'el tic congelado no cuelga: espera a ver si vuelve');
  assert.ok(m.migas.some((x) => /estuvo congelado/.test(x)), m.migas.join(' | '));
  m.app('active');
  m.r.pasar(5_000);
  assert.equal(m.ciclo.estado(), 'conectando', 'volvió: la llamada sigue');
  assert.deepEqual(m.cerrados, []);
});

test('el 10-oct exacto: en llamada, la burbuja se cierra y el JS queda congelado 75 s; al volver la llamada sigue', () => {
  const m = montarLlamada();
  m.burbuja.fijar(true);
  m.ejecutar(m.ciclo.hablarYa());
  m.conecta();
  // «burbuja: cerrada (fuera)» → segundo plano, y los relojes de JS congelados 75 s (el «JS bloqueado 75379 ms»).
  m.app('background');
  m.r.congelar(true);
  m.r.pasar(75_379);
  m.r.congelar(false);
  m.app('active');
  m.burbuja.fijar(false);
  m.r.pasar(10_000);
  assert.equal(m.ciclo.estado(), 'en_llamada', m.migas.join(' | '));
  assert.deepEqual(m.cerrados, []);
});

test('irse de verdad sí cuelga: pasada la gracia (3 s conectando, 30 s contestada), o al volver tras más de 2 min', () => {
  const a = montarLlamada();
  a.ejecutar(a.ciclo.hablarYa());
  a.app('background');
  a.r.pasar(GRACIA_FONDO_MS + 100);
  assert.deepEqual(a.cerrados, ['segundo_plano'], 'conectando: a los 3 s');

  const b = montarLlamada();
  b.ejecutar(b.ciclo.hablarYa());
  b.conecta();
  b.app('background');
  b.r.pasar(GRACIA_FONDO_MS + 100);
  assert.equal(b.ciclo.estado(), 'en_llamada', 'contestada: un vistazo a otra app no la corta');
  b.r.pasar(GRACIA_EN_LLAMADA_MS);
  assert.deepEqual(b.cerrados, ['segundo_plano'], 'contestada: pasados 30 s detrás, sí');

  // Detrás con los relojes congelados más de 2 minutos sin que fuera cosa nuestra: al volver ya no servía.
  const c = montarLlamada();
  c.ejecutar(c.ciclo.hablarYa());
  c.conecta();
  c.app('background');
  c.r.congelar(true);
  c.r.pasar(FONDO_LARGO_MS + 1_000);
  c.app('active');
  c.r.congelar(false);
  assert.deepEqual(c.cerrados, ['segundo_plano']);
  assert.ok(c.migas.some((x) => /ya no servía/.test(x)));
});

test('una transición propia (contestar desde el aviso a pantalla completa) no cuelga; su ventana se acaba', () => {
  const m = montarLlamada();
  m.ejecutar(m.ciclo.llamar({ tipo: 'recordatorio', texto: 'la medicina', base: 'b1', paso: 'l1', cuando: 0 }));
  m.guardia.propia('contestó desde el aviso');
  m.ejecutar(m.ciclo.contestar());
  m.app('background');
  m.r.pasar(VENTANA_PROPIA_MS - 500);
  assert.equal(m.ciclo.estado(), 'conectando', 'dentro de la ventana propia');
  m.app('active');
  m.conecta();
  assert.equal(m.ciclo.estado(), 'en_llamada');
  // Pasada la ventana, irse sí cuenta (con la gracia de la contestada).
  m.r.pasar(VENTANA_PROPIA_MS);
  m.app('background');
  m.r.pasar(GRACIA_EN_LLAMADA_MS + 100);
  assert.deepEqual(m.cerrados, ['segundo_plano']);
});

test('contestar abre una sesión NUEVA aunque quedara otra montada de antes', () => {
  const control = new ControlSesion('aura', 'es');
  control.iniciar();
  const vieja = control.vista().gen;
  assert.equal(control.iniciar(), true);
  assert.equal(control.vista().gen, vieja, 'iniciar reutiliza la montada (lo de siempre)');
  control.iniciarNueva();
  assert.equal(control.vista().gen, vieja + 1, 'contestar: generación nueva');
  assert.equal(control.vista().estado, 'conectando');
  // En una llamada de PULSE no se abre: queda anotada para cuando cuelgue.
  control.llamada(true);
  assert.equal(control.iniciarNueva(), false);
});

test('«llámame» según dónde está la persona', () => {
  assert.equal(comoAtenderLlamame({ estadoApp: 'active', burbuja: false }), 'al-instante');
  assert.equal(comoAtenderLlamame({ estadoApp: 'active', burbuja: true }), 'sonar-y-traer');
  assert.equal(comoAtenderLlamame({ estadoApp: 'background', burbuja: true }), 'sonar-y-traer');
  assert.equal(comoAtenderLlamame({ estadoApp: 'background', burbuja: false }), 'sonar');
});

test('«JS bloqueado N ms»: el rato con la app detrás no cuenta como bloqueo (lib/pulsoJs.ts)', () => {
  const p = new PulsoJs(200);
  const d = new DetectorBloqueo();
  let t = 0;
  p.tic(t);
  t += 200;
  assert.equal(p.tic(t), 0);
  // Se va detrás; Android congela el reloj 67 s y el primer tic llega al volver (antes o después del «active»).
  p.estadoApp('background');
  t += 67_288;
  assert.equal(p.tic(t), 0, 'detrás no se mide');
  p.estadoApp('active');
  t += 200;
  assert.equal(p.tic(t), 0, 'el primer tic al volver empieza de cero');
  t += 200;
  assert.equal(d.revisar(p.tic(t), t), null);
  // Un bloqueo de verdad con la app delante se sigue viendo.
  t += 3_000;
  assert.ok((d.revisar(p.tic(t), t)?.ms ?? 0) >= 2_000);
  assert.ok(ATRASO_CONGELADO_MS < GRACIA_FONDO_MS);
});
