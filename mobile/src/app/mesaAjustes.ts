/**
 * LOS AJUSTES DE LA MESA, VISTOS DESDE AJUSTES. José (2-oct, con captura): el menú de la mesa traía al
 * final una columna angosta con la voz, el oído, «comenta lo que ve», los efectos, la memoria (con
 * «Olvidar» cortado fuera de la pantalla) y cerrar sesión: «debe abrir todo eso en Ajustes, no así; se
 * mira mal». Ahora viven en la pantalla de Ajustes, ordenados por secciones.
 *
 * La lógica sigue en la mesa (screens/DeskScreen.tsx): cambiar el oído reabre el reconocedor, «olvidar»
 * pregunta y borra aquí y en el servidor, apagar los efectos silencia la mesa al instante. La mesa
 * publica aquí lo que hay y cómo cambiarlo; Ajustes lo lee (useSyncExternalStore) y llama a lo mismo
 * que llamaba el menú. Ajustes siempre se abre encima de la mesa (app/rutas.ts, abrirRuta), así que la
 * mesa está montada debajo; sin ella, la sección no se dibuja.
 *
 * Sin React Native: un dato de módulo con oyentes (como app/hojas.ts).
 */
import type { SttEngine } from '../lib/storage';
import type { AvatarId } from '../avatares/catalogo';

export type DatosMesa = {
  avatar: AvatarId;
  sttEngine: SttEngine;
  proactive: boolean;
  sfx: boolean;
  /** Cuántos hechos guarda la memoria de largo plazo de quien está en la mesa. */
  memoria: number;
  /** La cara de AU-RA: el orbe o los anillos. */
  cara: 'orbe' | 'anillos';
};

export type AccionesMesa = {
  fijarOido: (e: SttEngine) => void;
  alternarComentarios: () => void;
  alternarEfectos: () => void;
  /** Pregunta antes (es irreversible) y borra en el teléfono y en el servidor. */
  olvidar: () => void;
  fijarCara: (c: 'orbe' | 'anillos') => void;
};

export type MesaAjustes = { datos: DatosMesa; acciones: AccionesMesa };

let actual: MesaAjustes | null = null;
const oyentes = new Set<() => void>();

const iguales = (a: DatosMesa, b: DatosMesa) => (Object.keys(a) as (keyof DatosMesa)[]).every((k) => a[k] === b[k]);

function avisar() {
  for (const f of [...oyentes]) {
    try {
      f();
    } catch {
      /* un oyente roto no rompe nada */
    }
  }
}

/**
 * La mesa publica lo que hay. Solo avisa si cambió algún dato (la mesa se dibuja muy seguido); las
 * acciones se renuevan siempre sin avisar (son las de su último dibujo).
 */
export function publicarMesa(datos: DatosMesa, acciones: AccionesMesa) {
  if (actual && iguales(actual.datos, datos)) {
    actual.acciones = acciones;
    return;
  }
  actual = { datos: { ...datos }, acciones };
  avisar();
}

/** La mesa se desmonta (se cerró la sesión): Ajustes deja de mostrar la sección. */
export function retirarMesa() {
  if (!actual) return;
  actual = null;
  avisar();
}

export function mesaAjustes(): MesaAjustes | null {
  return actual;
}

export function suscribirMesa(f: () => void): () => void {
  oyentes.add(f);
  return () => {
    oyentes.delete(f);
  };
}
