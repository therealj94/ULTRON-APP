/**
 * EL RECORRIDO DE AURA EN WINDOWS, a pantalla completa dentro del Centro: Claudio a la izquierda,
 * ANT-ONIO a la derecha, y en medio el escritorio de Windows donde pasa cada ejemplo (escritorio.ts).
 *
 *  · Cada línea la dice uno con su voz (voz.ts); su video habla (cuerpo.ts) y el otro lo escucha.
 *  · Cine: cada escena abre con su capítulo (bandas negras y número), un destello cruza el escenario,
 *    la cámara se acerca a donde pasa lo importante, suenan sus efectos y al que habla le sale lo que
 *    cuenta (coreografia.ts → efectos).
 *  · Claudio se hace chiquito y VUELA al notch («me meto ahí») y habla desde ahí; luego vuelve.
 *  · Tres interacciones: tocar las teclas, el «Sí» y «Contestar». Si nadie toca, sigue solo.
 *  · Controles: atrás, pausa, voz, siguiente, cerrar; teclado: ←/→, Espacio, M, Esc.
 *
 * Mientras está abierto, AURA no escucha (recorrido.abierto: el recorrido dice «Oye AURA» por el
 * altavoz) y al cerrar todo vuelve como estaba.
 */
import './recorrido.css';
import { h, icono } from '../ui';
import { al, pedir } from '../puente';
import { ESCENAS, OPCIONES_FINAL, pasoEn, siguientes, textoDe, duracionLectura, type Anfitrion, type PruebaId } from './guion';
import { INICIO, reducir, lineaDe, progreso, type AccionRecorrido, type EstadoRecorrido } from './motor';
import { momentoDe, enNotch, type EfectoId, type Golpe } from './coreografia';
import { crearEscritorio, type Ctx } from './escritorio';
import { CuerpoVideo, type ParaCuerpo } from './cuerpo';
import { narradorAura, type Narrador } from './voz';
import { sonidosRecorrido } from './sonidos';
import { ico } from './iconos';

const NOMBRE: Record<Anfitrion, string> = { claudio: 'Claudio', antonio: 'ANT-ONIO' };
const ACENTO: Record<Anfitrion, string> = { claudio: '#f4ad72', antonio: '#45c9de' };
const CAPITULO_MS = 1500;

export type OpcionesRecorrido = { nombre: string; idioma: 'es' | 'en'; narrador?: Narrador; alProbar?: (id: PruebaId) => void };

let abierto: Promise<void> | null = null;

/** Abre el recorrido (si ya está abierto, devuelve el mismo). Resuelve al cerrarse. */
export function abrirRecorrido(o: OpcionesRecorrido): Promise<void> {
  abierto ??= montar(o).finally(() => { abierto = null; });
  return abierto;
}

function montar(o: OpcionesRecorrido): Promise<void> {
  return new Promise<void>((cerrado) => {
    const T = (es: string, en: string) => (o.idioma === 'en' ? en : es);
    const reducido = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const narrador = o.narrador ?? narradorAura();
    const sonidos = sonidosRecorrido();
    let conVoz = true;
    let s: EstadoRecorrido = INICIO;
    let pintado = '';
    let escenaVista = -1;
    let gestoN = 0;
    let relojes: ReturnType<typeof setTimeout>[] = [];
    let relojesLinea: ReturnType<typeof setTimeout>[] = [];
    let terminado = false;

    void pedir('recorrido.abierto', { si: true }).catch(() => {});

    // ── anfitriones ──
    const cuerpos = { claudio: new CuerpoVideo('claudio', reducido), antonio: new CuerpoVideo('antonio', reducido) };
    const anfitriones = {} as Record<Anfitrion, { col: HTMLElement; vuela: HTMLElement; fx: HTMLElement; halo: HTMLElement }>;
    function anfitrion(q: Anfitrion) {
      const halo = h('div', { class: 'r-halo' });
      const fx = h('div', { class: 'r-fx' });
      const marco = h('div', { class: 'r-marco' }, cuerpos[q].el);
      const vuela = h('div', { class: 'r-vuela' }, halo, marco);
      const ausente = h('div', { class: 'r-ausente', 'aria-hidden': 'true' }, T('↗ Estoy en el notch', '↗ I’m in the notch'));
      const col = h('div', { class: `r-anfitrion ${q}`, style: `--acento-a:${ACENTO[q]}` }, ausente, vuela, fx, h('div', { class: 'r-nombre' }, NOMBRE[q]));
      anfitriones[q] = { col, vuela, fx, halo };
      return col;
    }

    // ── escenario ──
    const esc = crearEscritorio();
    const barrido = h('div', { class: 'r-barrido' });
    const camara = h('div', { class: 'r-camara' }, esc.el, barrido);
    const opciones = h('div', { class: 'r-opciones' },
      h('strong', null, T('¿Por dónde empezamos?', 'Where do we start?')),
      h('div', { class: 'r-opciones-fila' }, ...OPCIONES_FINAL.map((op) => h('button', { class: 'btn ' + (op.id === 'hablar' ? 'acento' : 'suave'), on: { click: () => probar(op.id) } }, icono(op.icono, 16), h('span', null, op.etiqueta[o.idioma])))),
      h('button', { class: 'btn fantasma r-otra-vez', on: { click: () => despachar({ tipo: 'ir', e: 0 }) } }, icono('actualizar', 15), h('span', null, T('Verlo otra vez', 'Watch again'))));
    const escenario = h('div', { class: 'r-escenario' }, camara, opciones);

    // ── arriba: capítulo, progreso por escena y cerrar ──
    const etiqueta = h('span', { class: 'r-etiqueta' });
    const segmentos = ESCENAS.map((e, k) => h('button', { class: 'r-seg', title: e.titulo[o.idioma], 'aria-label': e.titulo[o.idioma], on: { click: () => despachar({ tipo: 'ir', e: k }) } }, h('i')));
    const cerrarBtn = h('button', { class: 'btn-ico r-cerrar', title: T('Cerrar el recorrido (Esc)', 'Close the tour (Esc)'), 'aria-label': T('Cerrar el recorrido', 'Close the tour'), on: { click: () => cerrar() } }, icono('cerrar', 18));
    const arriba = h('div', { class: 'r-arriba' }, h('span', { class: 'r-marca' }, 'AURA · Windows'), etiqueta, h('div', { class: 'r-segmentos' }, ...segmentos), cerrarBtn);

    // ── abajo: subtítulo, indicación y controles ──
    const quienSub = h('span', { class: 'r-quien' });
    const textoSub = h('span', { class: 'r-texto' });
    const subtitulo = h('div', { class: 'r-subtitulo', 'aria-live': 'polite' }, quienSub, textoSub);
    const indicacion = h('div', { class: 'r-indicacion', role: 'status' });
    const btn = (nombre: string, titulo: string, f: () => void, clase = '') => h('button', { class: `btn-ico r-ctrl ${clase}`, title: titulo, 'aria-label': titulo, on: { click: f } }, icono(nombre, 18));
    const bPausa = btn('pausa', T('Pausa (Espacio)', 'Pause (Space)'), () => despachar({ tipo: s.pausado ? 'sigue' : 'pausa' }), 'grande');
    const bVoz = h('button', { class: 'btn-ico r-ctrl', title: T('Quitar el sonido (M)', 'Mute (M)'), 'aria-label': T('Sonido', 'Sound'), on: { click: () => alternarVoz() } }, ico('altavoz', 18));
    const controles = h('div', { class: 'r-controles' },
      btn('anterior', T('Atrás (←)', 'Back (←)'), () => despachar({ tipo: 'anterior' })), bPausa,
      btn('siguiente', T('Siguiente escena (→)', 'Next scene (→)'), () => despachar({ tipo: 'siguiente' })), bVoz);
    const abajo = h('div', { class: 'r-abajo' }, subtitulo, h('div', { class: 'r-abajo-fila' }, indicacion, controles));

    const capitulo = h('div', { class: 'r-capitulo' }, h('i', { class: 'banda arriba' }), h('i', { class: 'banda abajo' }), h('div', { class: 'r-capitulo-texto' }, h('span', { class: 'num' }), h('strong', null)));
    const medio = h('div', { class: 'r-medio' }, anfitrion('claudio'), escenario, anfitrion('antonio'));
    const raiz = h('div', { class: 'recorrido' + (reducido ? ' reducido' : ''), role: 'dialog', 'aria-modal': 'true', 'aria-label': T('Recorrido de AURA en Windows', 'AURA for Windows tour') }, arriba, medio, abajo, capitulo);
    document.body.appendChild(raiz);
    // El Centro de abajo se esconde (sin cerrarse: PULSE2CHAT sigue escuchando). Su avatar 3D seguía
    // dibujando detrás y le robaba el hilo a la página: los relojes del recorrido se atrasaban.
    document.body.classList.add('con-recorrido');
    requestAnimationFrame(() => raiz.classList.add('visible'));

    const encuadrar = () => { cuerpos.claudio.encuadrar(); cuerpos.antonio.encuadrar(); };
    const ro = new ResizeObserver(encuadrar);
    // Al volar, el marco pasa a círculo: el video se vuelve a encuadrar en cada cambio de tamaño.
    ro.observe(cuerpos.claudio.el);
    ro.observe(cuerpos.antonio.el);

    // ── el estado de cada cuerpo ──
    const paraCuerpo: Record<Anfitrion, ParaCuerpo> = { claudio: { hablando: false, alFrente: true }, antonio: { hablando: false, alFrente: false } };
    function cuerpo(q: Anfitrion, p: Partial<ParaCuerpo>) {
      paraCuerpo[q] = { ...paraCuerpo[q], ...p };
      cuerpos[q].estado(paraCuerpo[q]);
      anfitriones[q].col.classList.toggle('habla', paraCuerpo[q].hablando);
      anfitriones[q].col.classList.toggle('frente', paraCuerpo[q].alFrente);
    }
    function nivel(q: Anfitrion, n: number) { anfitriones[q].halo.style.setProperty('--nivel', n.toFixed(3)); }

    // ── efectos del anfitrión ──
    function efecto(q: Anfitrion, id: EfectoId) {
      if (reducido) return;
      const fx = h('div', { class: `r-efecto fx-${id}` });
      const n = { chispas: 8, ventanas: 5, ondas: 3, teclas: 6, notas: 7, sobres: 5, monedas: 9, confeti: 26 }[id as string] ?? 1;
      const icos: Partial<Record<EfectoId, string>> = { chispas: 'chispa', ventanas: 'ventana', notas: 'nota', sobres: 'sobre', monedas: 'moneda', microfono: 'mic', lapiz: 'lapiz', sol: 'sol', luna: 'luna', campana: 'campana', calendario: 'calendario', reloj: 'reloj', telefono: 'telefono', avion: 'avion', escudo: 'escudo' };
      const teclas = ['Ctrl', 'Alt', 'C', 'V', 'S', 'Esc'];
      for (let k = 0; k < n; k++) {
        const ang = (k / n) * Math.PI * 2;
        const p = h('span', { class: 'p', style: `--k:${k};--n:${n};--dx:${Math.cos(ang).toFixed(3)};--dy:${Math.sin(ang).toFixed(3)};--x:${((k * 41) % 100)}%` });
        if (id === 'teclas') p.textContent = teclas[k % teclas.length];
        else if (id === 'ondas' || id === 'confeti') { /* forma con CSS */ }
        else p.appendChild(ico(icos[id] ?? 'chispa', n > 1 ? 18 : 44));
        fx.appendChild(p);
      }
      anfitriones[q].fx.appendChild(fx);
      setTimeout(() => fx.remove(), 3200);
    }

    // ── el vuelo al notch ──
    let enElNotch: Anfitrion | null = null;
    let seguir = 0;
    function volar(q: Anfitrion | null) {
      if (q === enElNotch) return;
      const antes = enElNotch;
      enElNotch = q;
      cancelAnimationFrame(seguir);
      if (antes) {
        // De vuelta a su lugar, con resorte.
        const v = anfitriones[antes].vuela;
        v.classList.add('volando');
        v.classList.remove('en-notch');
        v.style.transform = '';
        anfitriones[antes].col.classList.remove('fuera');
        setTimeout(() => v.classList.remove('volando'), 950);
      }
      if (!q) return;
      const v = anfitriones[q].vuela;
      anfitriones[q].col.classList.add('fuera');
      v.classList.add('volando', 'en-notch');
      const t0 = performance.now();
      const paso = () => {
        if (enElNotch !== q) return;
        const col = anfitriones[q].col.getBoundingClientRect();
        const cx = col.left + v.offsetLeft + v.offsetWidth / 2;
        const cy = col.top + v.offsetTop + v.offsetHeight / 2;
        const l = esc.lugar.getBoundingClientRect();
        // En el notch el marco es un círculo del ancho del anfitrión (recorrido.css: .en-notch).
        const k = Math.max(0.05, l.height / v.offsetWidth);
        v.style.transform = `translate(${(l.left + l.width / 2 - cx).toFixed(1)}px, ${(l.top + l.height / 2 - cy).toFixed(1)}px) scale(${k.toFixed(4)})`;
        // El primer tramo lo anima la transición (el vuelo); después lo sigue cuadro a cuadro (el notch crece).
        if (performance.now() - t0 > 950) v.classList.remove('volando');
        seguir = requestAnimationFrame(paso);
      };
      paso();
    }

    // ── cámara y destello ──
    function golpe(g: Golpe) {
      if (reducido) return;
      camara.dataset.golpe = g;
      camara.classList.remove('golpe');
      void camara.offsetWidth;
      camara.classList.add('golpe');
    }
    function destello() {
      if (reducido) return;
      barrido.classList.remove('pasa');
      void barrido.offsetWidth;
      barrido.classList.add('pasa');
    }
    function mostrarCapitulo(e: number): Promise<void> {
      const t = capitulo.querySelector('.num')!;
      t.textContent = String(e + 1).padStart(2, '0');
      capitulo.querySelector('strong')!.textContent = ESCENAS[e].titulo[o.idioma];
      capitulo.classList.remove('on');
      void capitulo.offsetWidth;
      capitulo.classList.add('on');
      sonidos.sonar('capitulo');
      return new Promise((r) => tras(reducido ? 500 : CAPITULO_MS, r));
    }

    // ── relojes ──
    function tras(ms: number, f: () => void) { relojes.push(setTimeout(f, ms)); }
    function trasLinea(ms: number, f: () => void) { relojesLinea.push(setTimeout(f, ms)); }
    function limpiarLinea() { relojesLinea.forEach(clearTimeout); relojesLinea = []; }
    function limpiarEscena() { relojes.forEach(clearTimeout); relojes = []; }

    // ── subtítulo: las palabras se encienden con la voz ──
    function ponerSubtitulo(q: Anfitrion, texto: string) {
      quienSub.textContent = NOMBRE[q];
      quienSub.style.color = ACENTO[q];
      textoSub.replaceChildren(...texto.split(/(\s+)/).map((p) => (p.trim() ? h('span', { class: 'pal' }, p) : document.createTextNode(p))));
      subtitulo.classList.remove('entra');
      void subtitulo.offsetWidth;
      subtitulo.classList.add('entra');
    }
    function encender(ms: number) {
      const pals = [...textoSub.querySelectorAll<HTMLElement>('.pal')];
      const total = pals.reduce((n, p) => n + p.textContent!.length + 1, 0);
      let acum = 0;
      for (const p of pals) {
        const t = (acum / total) * ms * 0.94;
        acum += p.textContent!.length + 1;
        trasLinea(t, () => p.classList.add('on'));
      }
    }

    // ── contexto de la escena ──
    const ctx = (): Ctx => ({
      t: T,
      tocado: s.tocado,
      tocar: () => despachar({ tipo: 'toque' }),
      sonar: (x) => sonidos.sonar(x),
      despues: (ms, f) => tras(ms, f),
      reducido,
    });

    // ── la línea en curso ──
    async function arrancarLinea() {
      const v = s.vuelta;
      const escena = ESCENAS[s.e];
      const linea = lineaDe(s, ESCENAS);
      const paso = pasoEn(escena, s.l);
      const llave = `${s.e}|${paso}`;
      limpiarLinea();
      opciones.classList.toggle('on', escena.id === 'final' && paso === 'opciones');
      actualizarArriba();

      const nuevaEscena = s.e !== escenaVista;
      if (llave !== pintado) {
        pintado = llave;
        limpiarEscena();
        if (nuevaEscena) {
          quienSub.textContent = '';
          textoSub.replaceChildren();
          // El capítulo primero, y la escena después: su animación no corre escondida detrás del título.
          escenaVista = s.e;
          volar(null);
          await mostrarCapitulo(s.e);
          if (v !== s.vuelta) return;
          destello();
        }
        const idx = Math.max(0, escena.pasos.indexOf(paso));
        esc.pintar(escena.id, idx, ctx());
        const m = momentoDe(escena.id, paso);
        volar(enNotch(escena.id, escena.pasos, paso));
        if (m.sonido) sonidos.sonar(m.sonido);
        if (m.golpe) golpe(m.golpe);
        if (m.efecto) efecto(linea.quien, m.efecto);
      }

      // Quién habla y quién escucha.
      const otro: Anfitrion = linea.quien === 'claudio' ? 'antonio' : 'claudio';
      cuerpo(otro, { hablando: false, alFrente: false, cara: undefined, gesto: null });
      cuerpo(linea.quien, { hablando: false, alFrente: true, cara: linea.cara, gesto: linea.gesto ? { nombre: linea.gesto, n: ++gestoN } : null });
      const texto = textoDe(linea, o.idioma, o.nombre);
      ponerSubtitulo(linea.quien, texto);
      indicacion.classList.remove('on');

      // La frase que sigue se prepara mientras suena esta.
      if (conVoz) for (const x of siguientes(s.e, s.l, 2, ESCENAS)) {
        const l2 = ESCENAS[x.e].lineas[x.l];
        narrador.preparar(textoDe(l2, o.idioma, o.nombre), l2.quien, l2.emocion ?? 'neutral');
      }

      if (s.pausado) return;
      let sono = false;
      if (conVoz) {
        sono = await narrador.hablar(texto, linea.quien, linea.emocion ?? 'neutral', {
          sono: (ms) => { if (v !== s.vuelta) return; cuerpo(linea.quien, { hablando: true }); encender(ms || duracionLectura(texto)); },
          nivel: (n) => nivel(linea.quien, n),
        });
        if (v !== s.vuelta || s.pausado || terminado) return;
      }
      if (!sono) {
        // Sin voz: se lee con su tiempo, con la boca moviéndose igual.
        const ms = duracionLectura(texto);
        cuerpo(linea.quien, { hablando: true });
        encender(ms);
        await new Promise<void>((r) => trasLinea(ms, r));
        if (v !== s.vuelta || s.pausado || terminado) return;
      }
      cuerpo(linea.quien, { hablando: false });
      nivel(linea.quien, 0);
      await new Promise<void>((r) => trasLinea(380, r));
      if (v !== s.vuelta || s.pausado || terminado) return;
      despachar({ tipo: 'termino', vuelta: v });
    }

    function mostrarEspera() {
      const linea = lineaDe(s, ESCENAS);
      if (!linea.espera) return;
      const v = s.vuelta;
      indicacion.replaceChildren(h('span', { class: 'r-mano' }, '👆'), h('span', null, linea.espera.etiqueta[o.idioma]), h('i', { class: 'r-cuenta', style: `animation-duration:${linea.espera.ms}ms` }));
      indicacion.classList.add('on');
      esc.objetivo()?.classList.add('llama');
      if (linea.espera.ms > 0 && !s.pausado) trasLinea(linea.espera.ms, () => despachar({ tipo: 'esperaVencio', vuelta: v }));
    }

    function actualizarArriba() {
      const e = ESCENAS[Math.min(s.e, ESCENAS.length - 1)];
      etiqueta.textContent = `${String(s.e + 1).padStart(2, '0')} · ${e.titulo[o.idioma]}`;
      const pr = progreso(s, ESCENAS);
      segmentos.forEach((b, k) => {
        b.classList.toggle('hecho', k < s.e || s.fase === 'fin');
        b.classList.toggle('actual', k === s.e && s.fase !== 'fin');
        const tot = ESCENAS[k].lineas.length;
        (b.firstChild as HTMLElement).style.width = k < s.e || s.fase === 'fin' ? '100%' : k === s.e ? `${Math.round(((s.l + (s.fase === 'espera' ? 1 : 0.5)) / tot) * 100)}%` : '0%';
      });
      raiz.style.setProperty('--progreso', pr.toFixed(3));
      bPausa.replaceChildren(icono(s.pausado ? 'play' : 'pausa', 20));
      bPausa.title = s.pausado ? T('Seguir (Espacio)', 'Resume (Space)') : T('Pausa (Espacio)', 'Pause (Space)');
      raiz.classList.toggle('pausado', s.pausado);
    }

    function despachar(a: AccionRecorrido) {
      if (terminado) return;
      const antes = s;
      const n = reducir(s, a, ESCENAS);
      if (n === s) return;
      s = n;
      if (s.pausado && !antes.pausado) {
        narrador.callar();
        limpiarLinea();
        cuerpo('claudio', { hablando: false });
        cuerpo('antonio', { hablando: false });
        actualizarArriba();
        return;
      }
      if (s.fase === 'fin') {
        limpiarLinea();
        indicacion.classList.remove('on');
        opciones.classList.add('on');
        actualizarArriba();
        return;
      }
      if (s.vuelta !== antes.vuelta) {
        if (s.fase === 'espera') { actualizarArriba(); mostrarEspera(); }
        else void arrancarLinea();
        return;
      }
      if (s.fase === 'espera' && antes.fase !== 'espera') { actualizarArriba(); mostrarEspera(); }
    }

    function alternarVoz() {
      conVoz = !conVoz;
      bVoz.classList.toggle('apagado', !conVoz);
      bVoz.replaceChildren(ico(conVoz ? 'altavoz' : 'altavozNo', 18));
      bVoz.title = conVoz ? T('Quitar el sonido (M)', 'Mute (M)') : T('Poner el sonido (M)', 'Unmute (M)');
      sonidos.activos = conVoz;
      if (!conVoz) narrador.callar();
      // La línea vuelve a empezar con el modo nuevo (con voz o leída).
      if (s.fase === 'habla' && !s.pausado) { s = { ...s, vuelta: s.vuelta + 1 }; void arrancarLinea(); }
    }

    // ── probar de verdad al final ──
    async function probar(id: PruebaId) {
      await cerrar();
      if (o.alProbar) return o.alProbar(id);
      if (id === 'hablar') void pedir('chat.hablar').catch(() => {});
      else window.dispatchEvent(new CustomEvent('centro:ir', { detail: id }));
    }

    // ── teclado ──
    function tecla(ev: KeyboardEvent) {
      if (ev.key === 'Escape') { ev.preventDefault(); void cerrar(); }
      else if (ev.key === ' ' && !(ev.target instanceof HTMLButtonElement)) { ev.preventDefault(); despachar({ tipo: s.pausado ? 'sigue' : 'pausa' }); }
      else if (ev.key === 'ArrowRight') despachar({ tipo: 'siguiente' });
      else if (ev.key === 'ArrowLeft') despachar({ tipo: 'anterior' });
      else if (ev.key.toLowerCase() === 'm') alternarVoz();
    }
    document.addEventListener('keydown', tecla);
    // Minimizada: en pausa. Escondida (cerró la ventana del Centro): se cierra.
    const alVer = () => { if (document.visibilityState === 'hidden') despachar({ tipo: 'pausa' }); };
    document.addEventListener('visibilitychange', alVer);
    // Una llamada que empieza a sonar (pulse/index.ts) cierra el recorrido: AURA tiene que oír el «sí».
    const alLlamar = () => void cerrar();
    window.addEventListener('centro:llamada', alLlamar);
    // Escondió la ventana, entra una llamada o AURA lleva a una sección: el recorrido se cierra.
    const dejar = [al('ventana.escondida', () => void cerrar()), al('ir', () => void cerrar()), al('llamada.accion', () => void cerrar())];

    let cerrando: Promise<void> | null = null;
    function cerrar(): Promise<void> {
      cerrando ??= (async () => {
        terminado = true;
        limpiarLinea();
        limpiarEscena();
        cancelAnimationFrame(seguir);
        narrador.soltar();
        sonidos.callar();
        document.removeEventListener('keydown', tecla);
        document.removeEventListener('visibilitychange', alVer);
        window.removeEventListener('centro:llamada', alLlamar);
        dejar.forEach((f) => f());
        ro.disconnect();
        delete (window as any).__recorrido;
        await pedir('recorrido.abierto', { si: false }).catch(() => {});
        raiz.classList.remove('visible');
        await new Promise((r) => setTimeout(r, reducido ? 0 : 380));
        cuerpos.claudio.soltar();
        cuerpos.antonio.soltar();
        raiz.remove();
        document.body.classList.remove('con-recorrido');
        cerrado();
      })();
      return cerrando;
    }

    // Para las pruebas (CI y vista previa): ver el estado y saltar a una escena.
    (window as any).__recorrido = {
      estado: () => ({ ...s, escena: ESCENAS[Math.min(s.e, ESCENAS.length - 1)].id, paso: pasoEn(ESCENAS[Math.min(s.e, ESCENAS.length - 1)], s.l), enNotch: enElNotch }),
      ir: (e: number) => despachar({ tipo: 'ir', e }),
      siguiente: () => despachar({ tipo: 'siguiente' }),
      tocar: () => despachar({ tipo: 'toque' }),
      video: () => ({ claudio: cuerpos.claudio.dibuja, antonio: cuerpos.antonio.dibuja }),
      cerrar: () => cerrar(),
    };

    cuerpo('claudio', paraCuerpo.claudio);
    cuerpo('antonio', paraCuerpo.antonio);
    tras(reducido ? 0 : 420, () => void arrancarLinea());
  });
}
