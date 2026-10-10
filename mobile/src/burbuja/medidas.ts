/**
 * LA BURBUJA, SUS MEDIDAS (José, 10-oct: «mira el círculo de asistente, necesitamos mejorar eso, se vea mejor»).
 *
 * De abajo hacia arriba, sin que nada se encime y respetando las zonas seguras:
 *   · la fila de controles grandes (escribir, cámara, micrófono, detener: 56 dp de botón y su palabra debajo);
 *   · «Abrir en AURA» (o «Abrir revisión»), compacta, de 48 dp de alto;
 *   · la línea de estado en su propia píldora, con fondo (nunca encima del texto de la app de atrás);
 *   · el orbe: el disco ~46 % del ancho, el orbe ENTERO y centrado, con su halo en un lienzo algo mayor;
 *   · arriba, la transcripción (lo que dijiste y lo que contesta AURA) en su tarjeta, con el alto que quede.
 * Con «escribir» el orbe se achica y sube; con la cámara se esconde (el visor ocupa abajo). Con letra grande del sistema
 * (`escalaTexto`) las alturas de texto crecen y el orbe cede espacio antes que la transcripción.
 *
 * Fase 0 (APK 5.7.1, revisión del diseño: teclado abierto, letra al 200 % y teléfono acostado). Antes el orbe nunca bajaba
 * de 72 dp aunque no cupiera: acostado y con letra grande quedaba por encima de la barra de estado (cortado) y la
 * transcripción se escondía; con el teclado abierto y acostado, la línea de estado se salía por arriba. Ahora, cuando no
 * cabe todo, se cede en este orden: primero el renglón reservado del detalle (`estado.conDetalle`), después el orbe entero
 * (`lado` 0: tocarlo para detener tiene su botón «Detener») y, si ni la línea de estado cabe, la línea (`estado.visible`).
 * Los controles, el campo de escribir y «Abrir en AURA» nunca ceden. La transcripción usa lo que queda (y se desplaza si
 * su texto no cabe: Burbuja.tsx).
 *
 * Sin React Native: se prueba en Node (tests/burbuja-v2.test.ts).
 */

export type ModoBurbuja = 'normal' | 'escribir' | 'camara';

export type EntradaMedidas = {
  ancho: number;
  alto: number;
  /** Zonas seguras (barra de estado arriba, gestos abajo). */
  arriba: number;
  abajo: number;
  modo?: ModoBurbuja;
  /** La escala de letra del sistema (PixelRatio.getFontScale), 1 = normal. */
  escalaTexto?: number;
  /** Lo que ocupa el teclado (con «escribir»), ya corregido por burbuja/sesionBurbuja.ts `margenTeclado`. */
  teclado?: number;
};

export type MedidasBurbuja = {
  /** Diámetro del disco del orbe (lo que se ve como «el círculo»). */
  lado: number;
  /** Lado del lienzo cuadrado del orbe (el disco + su halo, centrado sobre el disco). */
  lienzo: number;
  /** Radio de la cáscara del orbe y del disco, como fracción del lado del lienzo (para orbe.html `centro`). */
  radioOrbe: number;
  radioDisco: number;
  /** Esquina superior izquierda del disco y del lienzo. */
  orbe: { x: number; y: number };
  lienzoXY: { x: number; y: number };
  /** Fila de controles: distancia desde abajo y alto (botón + palabra). */
  controles: { abajo: number; alto: number; boton: number };
  /** «Abrir en AURA»: distancia desde abajo y alto. */
  abrir: { abajo: number; alto: number };
  /**
   * La línea de estado: distancia desde abajo y alto total (la píldora y, debajo, el renglón de detalle reservado si
   * `conDetalle`). Sin sitio ni para la píldora, `visible` false.
   */
  estado: { abajo: number; alto: number; pildora: number; conDetalle: boolean; visible: boolean };
  /** La tarjeta de la transcripción: distancia desde abajo y alto máximo (0 si no cabe). */
  transcripcion: { abajo: number; altoMax: number };
  /** Márgenes laterales. */
  lados: number;
  /** Con «escribir»: distancia desde abajo del campo. */
  campo: { abajo: number; alto: number };
};

/** Lo mínimo para un toque cómodo (Material: 48 dp). */
export const TOQUE_MIN = 48;
/** El disco del orbe respecto al ancho (José: «el círculo» ~46 % del ancho). */
export const FRACCION_ORBE = 0.46;
/** El lienzo del orbe respecto al disco: deja respirar el halo y el polvo sin cortarlos. */
export const LIENZO_SOBRE_DISCO = 1.36;
/** La cáscara de partículas respecto al disco (el orbe llena el círculo con un aire alrededor). */
export const CASCARA_SOBRE_DISCO = 0.78;
/** El orbe más chico que se dibuja; si ni eso cabe junto a la transcripción, se esconde. */
export const ORBE_MIN = 64;

const r = Math.round;

export function medidasBurbuja(e: EntradaMedidas): MedidasBurbuja {
  const modo = e.modo ?? 'normal';
  const k = Math.max(1, Math.min(2, e.escalaTexto ?? 1));
  const lados = e.ancho >= 600 ? 32 : 16;
  const boton = 56;
  const controlesAlto = r(boton + 6 + 16 * k);
  const controlesAbajo = r(Math.max(e.abajo, 8) + 16);
  const abrirAlto = r(Math.max(TOQUE_MIN, 40 * k));
  const abrirAbajo = controlesAbajo + controlesAlto + 12;
  const pildora = r(Math.max(36, 20 * k + 16));
  // El detalle («No te oigo mientras hablo…») tiene su sitio reservado: aparecer no empuja la píldora contra el orbe.
  const estadoConDetalle = pildora + 6 + r(2 * 17 * k + 8);
  const estadoAbajoNormal = abrirAbajo + abrirAlto + 14;
  const campoAlto = r(Math.max(TOQUE_MIN, 22 * k + 26));
  const campoAbajo = r(Math.max(e.abajo, 8) + 12 + Math.max(0, e.teclado ?? 0));
  const estadoAbajo = modo === 'escribir' ? campoAbajo + campoAlto + 10 : estadoAbajoNormal;
  const techo = e.alto - e.arriba;

  // El espacio para el orbe y la transcripción: lo que queda sobre la línea de estado (o sobre el campo al escribir).
  const baseCon = (altoEstado: number) => (modo === 'escribir' ? campoAbajo + campoAlto + 14 + altoEstado + 10 : estadoAbajoNormal + altoEstado + 14);
  const libreCon = (altoEstado: number) => Math.max(0, techo - 16 - baseCon(altoEstado));
  // La transcripción quiere al menos ~3 renglones; el orbe cede si no cabe (letra grande, teléfono acostado).
  const minTexto = r(78 * k);
  const cabeOrbe = (altoEstado: number) => modo !== 'camara' && libreCon(altoEstado) >= ORBE_MIN + 16 + minTexto;
  // Lo que cede primero: el renglón reservado del detalle; después, el orbe.
  const conDetalle = modo === 'camara' || cabeOrbe(estadoConDetalle) || (!cabeOrbe(pildora) && libreCon(estadoConDetalle) >= minTexto);
  const estadoAlto = conDetalle ? estadoConDetalle : pildora;
  // Ni la píldora cabe bajo la barra de estado (teclado abierto y acostado, con letra grande): no se dibuja.
  const visible = estadoAbajo + estadoAlto <= techo;
  const base = baseCon(estadoAlto);
  const libre = libreCon(estadoAlto);
  const deseado = modo === 'escribir' ? Math.min(e.ancho * 0.24, 120) : Math.min(e.ancho * FRACCION_ORBE, 300);
  const lado = !cabeOrbe(estadoAlto) ? 0 : r(Math.max(ORBE_MIN, Math.min(deseado, libre - minTexto - 16, libre * 0.62)));
  const lienzo = r(lado * LIENZO_SOBRE_DISCO);
  const orbeAbajo = base;
  const orbe = { x: r((e.ancho - lado) / 2), y: r(e.alto - orbeAbajo - lado) };
  const lienzoXY = { x: r(orbe.x - (lienzo - lado) / 2), y: r(orbe.y - (lienzo - lado) / 2) };
  const transAbajo = orbeAbajo + lado + (lado ? 16 : 0);
  const altoMax = Math.max(0, r(e.alto - e.arriba - 16 - transAbajo));
  return {
    lado,
    lienzo,
    radioDisco: lado ? 0.5 / LIENZO_SOBRE_DISCO : 0,
    radioOrbe: lado ? (0.5 * CASCARA_SOBRE_DISCO) / LIENZO_SOBRE_DISCO : 0,
    orbe,
    lienzoXY,
    controles: { abajo: controlesAbajo, alto: controlesAlto, boton },
    abrir: { abajo: abrirAbajo, alto: abrirAlto },
    estado: { abajo: estadoAbajo, alto: visible ? estadoAlto : 0, pildora, conDetalle: conDetalle && visible, visible },
    transcripcion: { abajo: transAbajo, altoMax },
    lados,
    campo: { abajo: campoAbajo, alto: campoAlto },
  };
}
