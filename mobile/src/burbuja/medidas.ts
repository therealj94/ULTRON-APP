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
  /** La línea de estado: distancia desde abajo y alto total (la píldora y, debajo, el renglón de detalle reservado). */
  estado: { abajo: number; alto: number; pildora: number };
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
  const estadoAlto = pildora + 6 + r(2 * 17 * k + 8);
  const estadoAbajo = abrirAbajo + abrirAlto + 14;
  const campoAlto = r(Math.max(TOQUE_MIN, 22 * k + 26));
  const campoAbajo = r(Math.max(e.abajo, 8) + 12 + Math.max(0, e.teclado ?? 0));

  // El espacio para el orbe y la transcripción: lo que queda sobre la línea de estado (o sobre el campo al escribir).
  const base = modo === 'escribir' ? campoAbajo + campoAlto + 14 + estadoAlto + 10 : estadoAbajo + estadoAlto + 14;
  const libre = Math.max(0, e.alto - e.arriba - 16 - base);
  // La transcripción quiere al menos ~3 renglones; el orbe cede si no cabe (letra grande, teléfono acostado).
  const minTexto = r(78 * k);
  const deseado = modo === 'escribir' ? Math.min(e.ancho * 0.24, 120) : Math.min(e.ancho * FRACCION_ORBE, 300);
  const lado = modo === 'camara' ? 0 : r(Math.max(72, Math.min(deseado, libre - minTexto - 16, libre * 0.62)));
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
    estado: { abajo: modo === 'escribir' ? campoAbajo + campoAlto + 10 : estadoAbajo, alto: estadoAlto, pildora },
    transcripcion: { abajo: transAbajo, altoMax },
    lados,
    campo: { abajo: campoAbajo, alto: campoAlto },
  };
}
