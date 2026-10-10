/**
 * `ultronfp://hablar` EN LA APP ENTERA: llegar directo a la mesa con el micrófono escuchando.
 *
 * Lo pide «Abrir en AURA» de la burbuja (origen=burbuja) o cualquiera con el enlace. Con la app cerrada llega como el
 * enlace de arranque; con la app abierta, como un enlace nuevo (Linking «url»). Las dos vías terminan en el buzón
 * (src/entrada/enlace.ts `buzonHablar`):
 *
 *  · la intro lo ve y, con sesión, no hace la espera mínima de la apertura (1,15 s): a la mesa en cuanto carga;
 *  · sin sesión, la entrada de siempre (el pedido caduca a los 2 min: no abre el micrófono horas después);
 *  · la mesa (useHablarEnMesa, abajo) lo toma: calla a AURA si hablaba, abre el micrófono y mide hasta que el oído
 *    escucha DE VERDAD. Sin permiso del micrófono, lo pide con la salida a Ajustes; si el micrófono no abre (otra app lo
 *    tiene, sin foco de audio), lo dice. Revisión de fases: el silencio que la persona dejó puesto solo lo quita el pedido
 *    INTERNO de la burbuja (su «Abrir en AURA», mismo motor de JS); un enlace de fuera lo respeta (`oidoParaHablar`).
 *
 * Una segunda invocación dentro de 1,5 s se ignora (`guardiaHablar`, compartida con la burbuja: su «Abrir en AURA»
 * deja el pedido en el buzón Y abre el enlace; el enlace que llega después ya no cuenta otra vez).
 */
import { useEffect, useRef } from 'react';
import { Linking } from 'react-native';
import { miga } from '../lib/reporte';
import { oidoEscuchando } from '../lib/speech';
import { abrirRuta, rutaActual, RUTAS_DE_SESION } from '../app/rutas';
import { buzonHablar, guardiaHablar, leerEnlace, lineaEntrada, momentoInvocacion, TOPE_ESCUCHAR_MS, type OrigenEntrada, type PedidoHablar } from './enlace';

function atender(url: string | null, arranque: boolean) {
  const e = leerEnlace(url);
  if (!e || e.destino !== 'hablar') return;
  const ahora = Date.now();
  if (!guardiaHablar.aceptar(ahora)) {
    miga(`[entrada] origen=${e.origen}: segunda invocación en menos de 1,5 s, ignorada`);
    return;
  }
  // De fuera: nunca `interno` (no quita el silencio que la persona dejó puesto).
  buzonHablar.pedir(e.origen, momentoInvocacion(e.invocadaEn, ahora));
  miga(`[entrada] origen=${e.origen}: hablar (${arranque ? 'al abrir la app' : 'con la app abierta'})`);
  // Ya en la sesión pero en otra pantalla (Ajustes, un chat): a la mesa, que es la que oye.
  const r = rutaActual();
  if (r && r !== 'Mesa' && RUTAS_DE_SESION.includes(r)) abrirRuta('Mesa');
}

/** El oyente de los enlaces `hablar` de la app entera (AppAura lo monta una vez). */
export function useEnlacesHablar() {
  useEffect(() => {
    void Linking.getInitialURL()
      .then((u) => atender(u, true))
      .catch(() => undefined);
    const sub = Linking.addEventListener('url', ({ url }) => atender(url, false));
    return () => sub.remove();
  }, []);
}

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Espera a que un motor del oído escuche de verdad (con tope) y deja la línea de la medida. true si escuchó. `vigente`
 * corta la espera sin medir (se cerró la burbuja, llegó otro pedido).
 */
export async function medirHastaEscuchar(origen: OrigenEntrada, desde: number, o: { tope?: number; vigente?: () => boolean } = {}): Promise<boolean> {
  const tope = o.tope ?? TOPE_ESCUCHAR_MS;
  const inicio = Date.now();
  while (Date.now() - inicio < tope) {
    if (o.vigente && !o.vigente()) return false;
    if (oidoEscuchando()) {
      miga(lineaEntrada(origen, desde, Date.now()));
      return true;
    }
    await espera(80);
  }
  miga(lineaEntrada(origen, desde, null, `nadie escuchó en ${tope} ms`));
  return false;
}

export type DepsHablarMesa = {
  /** La mesa ya armó su oído (o decidió no hacerlo: silenciada, sin permiso). Hasta entonces el pedido espera. */
  lista: () => boolean;
  /** No es el momento: la conversación en vivo o una llamada tienen el audio. */
  ocupada: () => boolean;
  /** Calla a AURA si está hablando (la persona quiere hablar ya). */
  callar: () => void;
  /**
   * Abre el micrófono (sin decir nada: un reconocedor nuevo; quitar el silencio SOLO si el pedido es interno, ver
   * `oidoParaHablar`). false: sin permiso. 'silenciado': la persona lo dejó en silencio y el pedido no puede quitarlo.
   */
  abrirOido: (p: PedidoHablar) => Promise<boolean | 'silenciado'>;
  /** El micrófono no abrió: decirlo en la mesa. */
  avisarSinOido: () => void;
};

/** Cuánto espera un pedido a que la mesa termine de arrancar (permiso, oído). */
const ESPERA_MESA_MS = 15_000;

/** La mesa atiende los `hablar`: los que llegan con ella montada y el que la estaba esperando al montarse. */
export function useHablarEnMesa(deps: DepsHablarMesa) {
  const d = useRef(deps);
  d.current = deps;
  useEffect(() => {
    let vivo = true;
    let ultimo = 0;
    const atenderPedido = async (p: PedidoHablar) => {
      ultimo = p.n;
      const vigente = () => vivo && ultimo === p.n;
      const t0 = Date.now();
      while (vigente() && !d.current.lista() && Date.now() - t0 < ESPERA_MESA_MS) await espera(120);
      if (!vigente()) return;
      if (d.current.ocupada()) {
        miga(`[entrada] origen=${p.origen}: la conversación o una llamada tienen el audio; la mesa no abre su oído`);
        return;
      }
      d.current.callar();
      const ok = await d.current.abrirOido(p);
      if (!vigente()) return;
      if (ok === 'silenciado') {
        miga(lineaEntrada(p.origen, p.desde, null, 'micrófono silenciado por la persona: un enlace de fuera no lo abre'));
        return;
      }
      if (!ok) {
        miga(lineaEntrada(p.origen, p.desde, null, 'sin permiso del micrófono'));
        return;
      }
      const escucho = await medirHastaEscuchar(p.origen, p.desde, { vigente });
      if (!escucho && vigente()) d.current.avisarSinOido();
    };
    const pendiente = buzonHablar.tomar(Date.now());
    if (pendiente) void atenderPedido(pendiente);
    const quitar = buzonHablar.escuchar((p) => {
      if (buzonHablar.tomar(Date.now())) void atenderPedido(p);
    });
    return () => {
      vivo = false;
      quitar();
    };
  }, []);
}
