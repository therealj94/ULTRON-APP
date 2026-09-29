/**
 * AIR TOUCH: leer la mano en la cámara y convertirla en gestos. Aquí no hay cámara ni DOM: entra
 * la lista de puntos de cada mano (los 21 de MediaPipe, en 0..1 del cuadro) y salen eventos. Así se
 * prueba sin navegador.
 *
 * Los gestos, pensados para que se aprendan en diez segundos:
 *  · SEÑALAR: el cursor sigue el punto medio entre el pulgar y el índice.
 *  · PELLIZCAR (pulgar con índice) y soltar rápido = tocar.
 *  · PELLIZCAR Y MOVER = arrastrar: mueve el mapa, desplaza una lista o corre una ventana.
 *  · LAS DOS MANOS PELLIZCANDO, abrir o cerrar = zoom.
 *  · PUÑO sostenido = cerrar la ventana.
 *  · PALMA ABIERTA barriendo de lado = siguiente.
 *
 * La cámara del frente se ve como espejo: la mano derecha de la persona sale a la izquierda del
 * cuadro. Todo lo que va a la pantalla se voltea en X para que el cursor vaya hacia donde va la mano.
 */

export type Punto = { x: number; y: number; z?: number };

/* Índices de MediaPipe Hands. */
const MUNECA = 0;
const PULGAR = 4;
const INDICE_BASE = 5;
const INDICE_MEDIO = 6;
const INDICE = 8;
const MEDIO_BASE = 9;
const MEDIO_MEDIO = 10;
const MEDIO = 12;
const ANULAR_MEDIO = 14;
const ANULAR = 16;
const MENIQUE_MEDIO = 18;
const MENIQUE = 20;

/** Pellizco con histéresis: cuesta más empezarlo que mantenerlo, para que no parpadee. */
export const PINZA_ENTRA = 0.3;
export const PINZA_SALE = 0.42;

const dist = (a: Punto, b: Punto) => Math.hypot(a.x - b.x, a.y - b.y);

export type LecturaMano = {
  /** Pulgar tocando el índice. */
  pinza: boolean;
  /** Distancia pulgar–índice relativa al tamaño de la mano (0 = tocándose). */
  apertura: number;
  /** Los cuatro dedos cerrados. */
  puno: boolean;
  /** Los cuatro dedos estirados y el pulgar separado. */
  palma: boolean;
  /** Dónde apunta, en 0..1 del cuadro (sin voltear). */
  puntero: Punto;
  /** Centro de la palma, en 0..1 del cuadro. */
  centro: Punto;
  /** Tamaño de la mano en el cuadro (muñeca a nudillo del medio). */
  tam: number;
};

function estirado(lm: Punto[], punta: number, medio: number): boolean {
  return dist(lm[punta], lm[MUNECA]) > dist(lm[medio], lm[MUNECA]) * 1.12;
}

/** Lo que está haciendo UNA mano. `pinzaAntes` da la histéresis. */
export function leerMano(lm: Punto[], pinzaAntes = false): LecturaMano | null {
  if (!Array.isArray(lm) || lm.length < 21) return null;
  const tam = Math.max(1e-4, dist(lm[MUNECA], lm[MEDIO_BASE]));
  const apertura = dist(lm[PULGAR], lm[INDICE]) / tam;
  const dedos = [
    estirado(lm, INDICE, INDICE_MEDIO),
    estirado(lm, MEDIO, MEDIO_MEDIO),
    estirado(lm, ANULAR, ANULAR_MEDIO),
    estirado(lm, MENIQUE, MENIQUE_MEDIO),
  ];
  const cerrados = dedos.filter((d) => !d).length;
  /*
   * En un puño el pulgar queda cerca del índice, y al pellizcar mucha gente encoge los otros dedos:
   * los dos casos tienen «cuatro dedos cerrados». Los separa la punta del pulgar: pellizcando TOCA la
   * punta del índice; en un puño queda encima de los nudillos, más lejos.
   */
  const puno = cerrados === 4 && apertura > 0.2;
  const pinza = !puno && apertura < (pinzaAntes ? PINZA_SALE : PINZA_ENTRA);
  const palma = cerrados === 0 && apertura > 0.55;
  const puntero = { x: (lm[PULGAR].x + lm[INDICE].x) / 2, y: (lm[PULGAR].y + lm[INDICE].y) / 2 };
  const centro = { x: (lm[MUNECA].x + lm[INDICE_BASE].x + lm[MEDIO_BASE].x) / 3, y: (lm[MUNECA].y + lm[INDICE_BASE].y + lm[MEDIO_BASE].y) / 3 };
  return { pinza, apertura, puno, palma, puntero, centro, tam };
}

export type EventoGesto =
  | { tipo: 'cursor'; x: number; y: number; pinza: boolean; manos: number }
  | { tipo: 'bajar'; x: number; y: number }
  | { tipo: 'arrastrar'; x: number; y: number; dx: number; dy: number }
  | { tipo: 'soltar'; x: number; y: number; clic: boolean }
  | { tipo: 'zoom'; factor: number; x: number; y: number }
  | { tipo: 'cerrar' }
  | { tipo: 'deslizar'; dir: 'izquierda' | 'derecha' }
  | { tipo: 'sin-manos' };

/** Tiempos y umbrales (ms y px de pantalla). */
export const CLIC_MS = 450;
export const CLIC_PX = 22;
export const PUNO_MS = 700;
const BARRIDO_MS = 380;
const BARRIDO_FRACCION = 0.26;
const BARRIDO_PAUSA_MS = 1100;
/** Margen del cuadro que no se usa: con la mano cómoda frente al pecho se llega a las esquinas. */
const MARGEN = 0.14;

/**
 * La máquina de gestos. `procesar` recibe las manos de un cuadro y devuelve lo que pasó.
 * `ancho` y `alto` son los de la pantalla, para dar coordenadas en píxeles.
 */
export function crearGestos() {
  let pinzas: boolean[] = [];
  let cursor: { x: number; y: number } | null = null;
  let bajada: { t: number; x: number; y: number; recorrido: number } | null = null;
  let zoomDist: number | null = null;
  let punoDesde = 0;
  let punoDado = false;
  let barrido: Array<{ t: number; x: number; y: number }> = [];
  let ultimoBarrido = -1e9;
  let sinManosDesde = 0;

  const aPantalla = (p: Punto, ancho: number, alto: number) => {
    const u = Math.min(1, Math.max(0, (1 - p.x - MARGEN) / (1 - 2 * MARGEN)));
    const v = Math.min(1, Math.max(0, (p.y - MARGEN) / (1 - 2 * MARGEN)));
    return { x: u * ancho, y: v * alto };
  };

  function soltarSiHace(ev: EventoGesto[], clicPosible: boolean) {
    if (!bajada || !cursor) {
      bajada = null;
      return;
    }
    ev.push({ tipo: 'soltar', x: cursor.x, y: cursor.y, clic: clicPosible });
    bajada = null;
  }

  return {
    procesar(manos: Punto[][], t: number, ancho: number, alto: number): EventoGesto[] {
      const ev: EventoGesto[] = [];
      const lecturas = manos.slice(0, 2).map((lm, k) => leerMano(lm, pinzas[k] || false)).filter((x): x is LecturaMano => !!x);
      pinzas = lecturas.map((l) => l.pinza);

      if (!lecturas.length) {
        if (!sinManosDesde) sinManosDesde = t;
        // Una mano que sale del cuadro a medio arrastre suelta sin tocar nada.
        if (bajada) soltarSiHace(ev, false);
        zoomDist = null;
        punoDesde = 0;
        punoDado = false;
        barrido = [];
        if (t - sinManosDesde > 250 && cursor) {
          cursor = null;
          ev.push({ tipo: 'sin-manos' });
        }
        return ev;
      }
      sinManosDesde = 0;

      // ── dos manos pellizcando: zoom ──
      if (lecturas.length === 2 && lecturas[0].pinza && lecturas[1].pinza) {
        if (bajada) soltarSiHace(ev, false);
        const a = aPantalla(lecturas[0].puntero, ancho, alto);
        const b = aPantalla(lecturas[1].puntero, ancho, alto);
        const d = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
        const medio = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        if (zoomDist != null) {
          const factor = d / zoomDist;
          // Temblor de la mano: por debajo de 1,5 % no es un gesto.
          if (Math.abs(factor - 1) > 0.015) {
            ev.push({ tipo: 'zoom', factor, x: medio.x, y: medio.y });
            zoomDist = d;
          }
        } else zoomDist = d;
        cursor = medio;
        ev.push({ tipo: 'cursor', x: medio.x, y: medio.y, pinza: true, manos: 2 });
        return ev;
      }
      zoomDist = null;

      // ── una mano (la primera que se ve) ──
      const m = lecturas[0];
      const crudo = aPantalla(m.puntero, ancho, alto);
      // Suavizado que se afloja cuando la mano va rápido: quieto no tiembla, rápido no se arrastra.
      if (!cursor) cursor = crudo;
      else {
        const vel = Math.hypot(crudo.x - cursor.x, crudo.y - cursor.y);
        const alfa = Math.min(0.85, 0.28 + vel / 260);
        cursor = { x: cursor.x + (crudo.x - cursor.x) * alfa, y: cursor.y + (crudo.y - cursor.y) * alfa };
      }
      ev.push({ tipo: 'cursor', x: cursor.x, y: cursor.y, pinza: m.pinza, manos: lecturas.length });

      if (m.pinza && !bajada) {
        bajada = { t, x: cursor.x, y: cursor.y, recorrido: 0 };
        ev.push({ tipo: 'bajar', x: cursor.x, y: cursor.y });
      } else if (m.pinza && bajada) {
        const dx = cursor.x - bajada.x;
        const dy = cursor.y - bajada.y;
        if (dx || dy) {
          bajada.recorrido += Math.hypot(dx, dy);
          // Hasta pasar el umbral de clic no se arrastra: un pellizco tembloroso sigue siendo un toque.
          if (bajada.recorrido > CLIC_PX / 2) ev.push({ tipo: 'arrastrar', x: cursor.x, y: cursor.y, dx, dy });
          bajada.x = cursor.x;
          bajada.y = cursor.y;
        }
      } else if (!m.pinza && bajada) {
        soltarSiHace(ev, t - bajada.t < CLIC_MS && bajada.recorrido < CLIC_PX);
      }

      // ── puño sostenido: cerrar ──
      if (m.puno) {
        if (!punoDesde) punoDesde = t;
        if (!punoDado && t - punoDesde >= PUNO_MS) {
          punoDado = true;
          ev.push({ tipo: 'cerrar' });
        }
      } else {
        punoDesde = 0;
        punoDado = false;
      }

      // ── palma barriendo de lado: siguiente ──
      if (m.palma) {
        const c = aPantalla(m.centro, ancho, alto);
        barrido.push({ t, x: c.x, y: c.y });
        barrido = barrido.filter((p) => t - p.t <= BARRIDO_MS);
        const primero = barrido[0];
        const dx = c.x - primero.x;
        const dy = c.y - primero.y;
        if (t - ultimoBarrido > BARRIDO_PAUSA_MS && Math.abs(dx) > ancho * BARRIDO_FRACCION && Math.abs(dy) < Math.abs(dx) * 0.5) {
          ultimoBarrido = t;
          barrido = [];
          ev.push({ tipo: 'deslizar', dir: dx < 0 ? 'izquierda' : 'derecha' });
        }
      } else barrido = [];

      return ev;
    },
    /** Olvida todo (al apagar la cámara). */
    reiniciar() {
      pinzas = [];
      cursor = null;
      bajada = null;
      zoomDist = null;
      punoDesde = 0;
      punoDado = false;
      barrido = [];
      sinManosDesde = 0;
    },
  };
}
