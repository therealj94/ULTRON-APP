/**
 * Las opciones del orbe (src/14-orbe/orbe.html) puestas DENTRO de la página, antes de su guion. Antes iban por
 * `injectedJavaScriptBeforeContentLoaded`, pero en Android con html propio ese guion llega tarde y el orbe salía con su
 * panel de prueba entero (José, 3-oct: «REPOSO, ESCUCHA… WEBGL2 · 60 FPS» en la mesa). Así no depende de la WebView.
 *
 * Sin React Native (lo usan components/OrbeAura.tsx, burbuja/OrbeBurbuja.tsx y la prueba visual en Chromium).
 */
export type OpcionesOrbe = {
  /** Efectos de sonido (Ajustes → La mesa). */
  sonidos: boolean;
  /** Lo que la app tapa arriba y abajo, en dp (la mesa). */
  margen?: { arriba: number; abajo: number };
  /**
   * Encuadre «centro» (la burbuja): el orbe entero y centrado en un cuadro, con su disco de fondo y transparente
   * alrededor. `radio` y `disco` son fracciones del lado menor del lienzo.
   */
  centro?: { radio: number; disco: number };
  /** «Reducir movimiento» ya al arrancar. */
  quieto?: boolean;
};

export function orbeConOpciones(html: string, sonidos: boolean | OpcionesOrbe, margen?: { arriba: number; abajo: number }): string {
  const o: OpcionesOrbe = typeof sonidos === 'object' ? sonidos : { sonidos, ...(margen ? { margen } : {}) };
  const opc = {
    clean: true,
    tts: false,
    sfx: o.sonidos,
    ...(o.margen ? { margen: o.margen } : {}),
    ...(o.centro ? { centro: o.centro } : {}),
    ...(o.quieto ? { quieto: true } : {}),
  };
  // Transparente desde el primer cuadro (sin el destello del fondo oscuro): el esquema «dark» de la página pintaría el
  // lienzo de la WebView aunque el fondo sea transparente.
  const estilo = o.centro ? '<style>:root{color-scheme:normal}html,body{background:transparent!important}</style>' : '';
  const guion = `${estilo}<script>window.__orbeOpciones=${JSON.stringify(opc)};</script>`;
  return html.includes('<head>') ? html.replace('<head>', `<head>${guion}`) : guion + html;
}
