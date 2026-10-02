/**
 * EL CUERPO DE CLAUDIO Y ANT-ONIO EN EL RECORRIDO: sus clips de video, los mismos del teléfono
 * (mobile/assets/avatares/video, copiados por build.mjs a recorrido/video), con el MISMO director que
 * decide qué clip va (mobile/src/avatares/video/guion.ts): fondo que se asienta antes de cambiar (así
 * no parpadea entre frase y frase) y golpes (saluda, señala, risa, sorpresa) que vuelven al fondo.
 *
 * Dos capas de <video>: el clip nuevo arranca en la de atrás y, cuando ya dibuja cuadros, entra ENCIMA
 * de la vieja (la imagen nunca baja de luz, igual que CuerpoVideo.tsx). Si el equipo no puede con el
 * video, queda su foto (la misma pose de la que salen los clips).
 */
import { DirectorVideo, VENTANAS, encuadrar, type ClipVideo, type Reproduccion } from '../../../../mobile/src/avatares/video/guion';
import { ESTADO_INICIAL, type EstadoAvatar, type ExpresionAvatar, type GestoAvatar } from '../../../../mobile/src/avatar3d/tipos';
import type { Anfitrion, CaraLinea, GestoLinea } from './guion';

/** Los clips que viajan con Windows (los de fondo y los golpes que usa el guion). */
export const CLIPS_RECORRIDO: readonly ClipVideo[] = ['reposo', 'escucha', 'habla', 'piensa', 'risa', 'saluda', 'senala', 'sorpresa'];
export const urlClip = (quien: Anfitrion, clip: ClipVideo) => `recorrido/video/${quien}-${clip}.mp4`;
export const urlFoto = (quien: Anfitrion) => `recorrido/${quien}.webp`;

/** Tiempo del fundido (igual al del teléfono) y cuánto se espera a que un clip dibuje antes de rendirse. */
const FUNDIDO_MS = 220;
const ESPERA_MAX_MS = 2500;
/** Lo que tiene que haber avanzado el clip para fundirlo (como DIBUJANDO_MS en el teléfono). */
const DIBUJANDO_S = 0.06;

export type ParaCuerpo = { hablando: boolean; alFrente: boolean; cara?: CaraLinea; gesto?: { nombre: GestoLinea; n: number } | null };

const EXPRESION: Record<CaraLinea, ExpresionAvatar> = { encantada: 'encantada', sorprendida: 'sorprendida', piensa: 'piensa' };

export function estadoDe(p: ParaCuerpo): EstadoAvatar {
  return {
    ...ESTADO_INICIAL,
    expresion: p.cara ? EXPRESION[p.cara] : 'tranquila',
    hablando: p.hablando,
    escuchando: !p.alFrente,
    gesto: p.gesto ? { nombre: p.gesto.nombre as GestoAvatar, n: p.gesto.n } : null,
  };
}

export class CuerpoVideo {
  readonly el: HTMLElement;
  private readonly capas: [HTMLVideoElement, HTMLVideoElement];
  private readonly foto: HTMLElement;
  private arriba = 0;
  private readonly director: DirectorVideo;
  private reloj: ReturnType<typeof setTimeout> | null = null;
  private fallos = 0;
  private vivo = true;
  private ultimo = '';

  constructor(private readonly quien: Anfitrion, reducido: boolean) {
    this.director = new DirectorVideo({ hay: CLIPS_RECORRIDO, reducido });
    this.el = document.createElement('div');
    this.el.className = 'cuerpo-video';
    this.foto = document.createElement('div');
    this.foto.className = 'cuerpo-foto';
    this.foto.style.backgroundImage = `url(${urlFoto(quien)})`;
    const capa = () => {
      const v = document.createElement('video');
      v.muted = true;
      v.playsInline = true;
      v.preload = 'auto';
      v.setAttribute('aria-hidden', 'true');
      v.disablePictureInPicture = true;
      return v;
    };
    this.capas = [capa(), capa()];
    this.el.append(this.foto, ...this.capas);
    for (const v of this.capas) {
      v.addEventListener('error', () => this.fallo());
      v.addEventListener('timeupdate', () => this.cercaDelFinal(v));
      v.addEventListener('ended', () => this.cercaDelFinal(v, true));
    }
    this.poner(this.director.reproduccion);
    this.encuadrar();
  }

  /** Acomoda el video en su caja (la cabeza y el pecho, como el retrato del teléfono). */
  encuadrar() {
    const W = this.el.clientWidth || 180;
    const H = this.el.clientHeight || 240;
    const e = encuadrar(W, H, VENTANAS[this.quien].retrato);
    for (const v of this.capas) Object.assign(v.style, { left: `${e.left}px`, top: `${e.top}px`, width: `${e.width}px`, height: `${e.height}px` });
    Object.assign(this.foto.style, { left: `${e.left}px`, top: `${e.top}px`, width: `${e.width}px`, height: `${e.height}px` });
  }

  /** El estado nuevo (habla, escucha, gesto, cara): el director decide si cambia el clip. */
  estado(p: ParaCuerpo) {
    const llave = JSON.stringify(p);
    if (llave === this.ultimo) return;
    this.ultimo = llave;
    const r = this.director.estado(estadoDe(p));
    if (r) this.poner(r);
    this.programar();
  }

  /** Para las pruebas del CI: si el video está dibujando de verdad. */
  get dibuja(): boolean {
    const v = this.capas[this.arriba];
    return v.readyState >= 2 && v.videoWidth > 0 && !v.paused;
  }

  soltar() {
    this.vivo = false;
    if (this.reloj) clearTimeout(this.reloj);
    for (const v of this.capas) {
      v.pause();
      v.removeAttribute('src');
      v.load();
    }
  }

  private programar() {
    if (this.reloj) clearTimeout(this.reloj);
    this.reloj = null;
    const ms = this.director.msParaHablar() ?? this.director.msParaFondo();
    if (ms == null) return;
    this.reloj = setTimeout(() => {
      this.reloj = null;
      const r = this.director.revisar();
      if (r) this.poner(r);
      this.programar();
    }, ms + 5);
  }

  private cercaDelFinal(v: HTMLVideoElement, termino = false) {
    if (v !== this.capas[this.arriba] || v.loop) return;
    // El golpe está por terminar: vuelve al fondo un poco antes, para fundir sin quedarse quieto.
    if (termino || (v.duration > 0 && v.currentTime >= v.duration - 0.25)) {
      const n = Number(v.dataset.n);
      const r = this.director.termino(n);
      if (r) this.poner(r);
      this.programar();
    }
  }

  private poner(r: Reproduccion) {
    if (!this.vivo || this.fallos >= 3) return;
    const vieja = this.capas[this.arriba];
    const nueva = this.capas[1 - this.arriba];
    nueva.loop = r.bucle;
    nueva.dataset.n = String(r.n);
    nueva.style.transition = 'none';
    nueva.style.opacity = '0';
    nueva.style.zIndex = '2';
    vieja.style.zIndex = '1';
    const src = urlClip(this.quien, r.clip);
    if (!nueva.src.endsWith(src)) nueva.src = src;
    nueva.currentTime = 0;
    let listo = false;
    const fundir = () => {
      if (listo || nueva.dataset.n !== String(r.n)) return;
      listo = true;
      this.fallos = 0;
      this.arriba = 1 - this.arriba;
      // La nueva entra encima; la vieja se queda debajo hasta que la nueva ya tapa todo, y entonces se
      // pausa, salvo que mientras tanto la hayan vuelto a pedir para otro clip (su `n` cambió).
      const nVieja = vieja.dataset.n;
      nueva.style.transition = `opacity ${FUNDIDO_MS}ms ease-out`;
      nueva.style.opacity = '1';
      this.foto.style.opacity = '0';
      setTimeout(() => { if (vieja.dataset.n === nVieja && this.capas[this.arriba] !== vieja) vieja.pause(); }, FUNDIDO_MS + 40);
    };
    // Funde solo cuando el clip ya avanza de verdad (hay cuadros pintados; si no, entraría una capa negra).
    // No se espera al «cuadro presentado» del navegador: con la capa invisible, Chromium no lo anuncia.
    const desde = performance.now();
    const mirar = () => {
      if (listo || nueva.dataset.n !== String(r.n) || !this.vivo) return;
      if (nueva.readyState >= 2 && !nueva.paused && nueva.currentTime >= DIBUJANDO_S) return fundir();
      if (performance.now() - desde > ESPERA_MAX_MS) return this.fallo();
      requestAnimationFrame(mirar);
    };
    requestAnimationFrame(mirar);
    nueva.play().catch(() => { /* el error lo cuenta el evento */ });
  }

  private fallo() {
    this.fallos++;
    if (this.fallos >= 3) {
      // Este equipo no puede con el video: su foto, quieta pero respirando (CSS).
      this.foto.style.opacity = '1';
      for (const v of this.capas) v.style.opacity = '0';
      this.el.classList.add('sin-video');
    }
  }
}
