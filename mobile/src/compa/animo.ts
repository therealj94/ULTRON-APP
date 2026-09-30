/**
 * EL ÁNIMO DE LA COMPAÑERA: qué cara pone, qué dice en su globito y qué hace, momento a momento.
 *
 * Es una máquina pura (entra un evento y la hora, sale el ánimo nuevo y los efectos), así se prueba
 * en Node y el componente solo dibuja y ejecuta los efectos:
 *
 *  · tocarla → le gusta (ojos felices, brinquito, háptica suave; a veces una risita o una frase); si
 *    el cuerpo sabe dónde (avatar3d/contrato.ts), la mejilla la pone tímida y la panza, risueña;
 *  · acariciarla (arrastrar suave encima) → encantada, se le pasa el enojo;
 *  · muchos toques rápidos → se enoja (ceño, se sacude, «¡oye!») y se le pasa sola en unos segundos;
 *  · mantenerla → la levantas; soltarla → aterriza con un brinco;
 *  · doble toque → se duerme (silencio de verdad: micrófono y voz apagados vía VozProvider) y otro
 *    doble toque la despierta a escuchar;
 *  · la voz: escucha, habla con la emoción del turno, pone cara de «¡uy!» si le hablas encima;
 *  · un mensaje enviado → palomita ✔ (a mano o por voz); «¡Listo!» en voz alta solo cuando se lo
 *    pidieron a ella (el `hecho` de `enviar`); lo que no pudo hacer lo dice, y el agente se entera;
 *  · una llamada → se va; al colgar vuelve contenta.
 *
 * La cara final sale de `expresion()`, por prioridad: levantada, enojo, «¡uy!», dormida, las
 * reacciones al tacto, lo que siente mientras habla, pensando, escuchando y, si no, tranquila.
 */
import type { AccionApp } from '../nucleo/contrato';
import type { Emocion } from '../lib/emocion';
import type { EstadoVoz } from './sesion';
import type { ZonaToque } from '../avatar3d/tipos';
import { fraseCompa, textoCompa, type GrupoFrase } from './frases';

export type Expresion =
  | 'tranquila'
  | 'contenta'
  | 'encantada'
  | 'enojada'
  | 'dormida'
  | 'escucha'
  | 'piensa'
  | 'sorprendida'
  | 'triste'
  | 'uy'
  | 'levantada'
  /** Le tocaron la mejilla: sonríe y baja la mirada, con rubor. */
  | 'timida';

export const EXPRESIONES: readonly Expresion[] = ['tranquila', 'contenta', 'encantada', 'enojada', 'dormida', 'escucha', 'piensa', 'sorprendida', 'triste', 'uy', 'levantada', 'timida'];

export type VozVista = { estado: EstadoVoz; silenciada: boolean; dormida: boolean; suspendida: boolean };

export type Animo = {
  /** 0..1: sube con los toques seguidos, baja sola. */
  irritacion: number;
  /** Una cara que dura un rato (reacción al tacto, «¡uy!», enojo). */
  reaccion: { exp: Expresion; hasta: number } | null;
  voz: VozVista;
  /** La emoción de lo que está diciendo (conversación fluida o mesa). */
  sentir: Emocion;
  mesa: { hablando: boolean; pensando: boolean };
  levantada: boolean;
  /** En llamada: no se ve. */
  oculta: boolean;
  /** Cuántas veces reaccionó (elige la frase siguiente sin repetir). */
  cuenta: number;
  ultimoRonroneo: number;
  ultimaPalomita: number;
  /** Cuándo dijo «¡Listo!» por un envío (el mismo envío puede avisar dos veces). */
  ultimoListo: number;
};

export type Haptica = 'suave' | 'media' | 'fuerte' | 'exito' | 'aviso' | 'seleccion';
export type Sonido = 'giggle' | 'purr' | 'boing' | 'whoosh';

export type Efecto =
  | { tipo: 'globo'; texto: string; ms: number; prioridad: number }
  | { tipo: 'haptica'; fuerza: Haptica }
  | { tipo: 'sonido'; nombre: Sonido }
  | { tipo: 'brinco'; alto: number }
  | { tipo: 'sacudir' }
  /** Doble toque: la voz decide si duerme o despierta (VozProvider). */
  | { tipo: 'alternarVoz' }
  | { tipo: 'palomita' }
  /** Confirmar en voz alta (sin conversación abierta, la voz de la mesa; con ella, un aviso al agente). */
  | { tipo: 'confirmar'; ok: boolean; texto: string }
  | { tipo: 'aparecer' }
  | { tipo: 'desaparecer' };

export type EventoAnimo =
  /** `zona`: dónde la tocaron, si el cuerpo lo sabe (la mejilla la pone tímida; la panza, risueña). */
  | { tipo: 'toque'; zona?: ZonaToque }
  | { tipo: 'molestar' }
  | { tipo: 'caricia' }
  | { tipo: 'dobleToque' }
  | { tipo: 'levantar' }
  | { tipo: 'soltar' }
  | { tipo: 'voz'; voz: VozVista }
  /** AURA dijo algo. `mostrar`: si va en su globito (en la mesa ya lo muestra la burbuja grande). */
  | { tipo: 'dijo'; texto: string; emocion: Emocion; mostrar: boolean }
  | { tipo: 'mesa'; hablando: boolean; pensando: boolean; emocion: Emocion }
  | { tipo: 'interrupcion' }
  | { tipo: 'llamada'; activa: boolean }
  | { tipo: 'hecho'; ok: boolean; accion: AccionApp; detalle?: string }
  | { tipo: 'enviado'; para: string; nombre?: string }
  | { tipo: 'accion'; accion: AccionApp }
  | { tipo: 'tic' };

export const ANIMO_INICIAL: Animo = {
  irritacion: 0,
  reaccion: null,
  voz: { estado: 'cerrada', silenciada: false, dormida: false, suspendida: false },
  sentir: 'neutral',
  mesa: { hablando: false, pensando: false },
  levantada: false,
  oculta: false,
  cuenta: 0,
  ultimoRonroneo: 0,
  ultimaPalomita: -1e12,
  ultimoListo: -1e12,
};

/** Cuánto baja la irritación por segundo (se le pasa sola en unos 4 s). */
const CALMA_POR_S = 0.25;
const PASO_TOQUE = 0.18;
const PASO_MOLESTAR = 0.4;

/** Sesión abierta y sin silencio: la compañera no hace ruidos (el micrófono los oiría y cortaría a AURA). */
export function vozAbierta(v: VozVista): boolean {
  return !v.silenciada && (v.estado === 'conectando' || v.estado === 'escuchando' || v.estado === 'hablando');
}

export function estaDormida(v: VozVista): boolean {
  return v.silenciada || v.dormida;
}

/** ¿Está hablando (la boca sigue a la voz)? */
export function hablando(a: Animo): boolean {
  return (a.voz.estado === 'hablando' && !a.voz.silenciada) || a.mesa.hablando;
}

/** Lo que siente al hablar → la cara. Neutral es tranquila (la boca igual se mueve). */
export function expresionDeEmocion(e: Emocion): Expresion {
  switch (e) {
    case 'feliz':
    case 'carino':
    case 'orgullo':
    case 'travieso':
      return 'contenta';
    case 'risa':
      return 'encantada';
    case 'sorpresa':
      return 'sorprendida';
    case 'pensando':
      return 'piensa';
    case 'curioso':
      // Una pregunta se dice con la cara tranquila (los puntitos de pensar, hablando, confunden).
      return 'tranquila';
    case 'preocupado':
    case 'triste':
    case 'cansado':
      return 'triste';
    case 'molesto':
      return 'enojada';
    default:
      return 'tranquila';
  }
}

export function expresion(a: Animo, ahora: number): Expresion {
  const r = a.reaccion && a.reaccion.hasta > ahora ? a.reaccion.exp : null;
  if (a.levantada) return 'levantada';
  if (r === 'enojada' || r === 'uy') return r;
  if (estaDormida(a.voz)) return 'dormida';
  if (r) return r;
  if (hablando(a)) return expresionDeEmocion(a.sentir);
  if (a.mesa.pensando || a.voz.estado === 'conectando') return 'piensa';
  if (a.voz.estado === 'escuchando') return 'escucha';
  return 'tranquila';
}

/**
 * ¿Puede pasear? Libre o escuchando en silencio (la conversación puede durar todo el chat con los
 * amigos: no se queda tiesa). Se detiene si habla, piensa, conecta, duerme, la tienen en la mano o
 * pone una cara de reacción. Que la persona le hable lo decide el componente con el volumen del
 * micrófono (se detiene y la mira).
 */
export function puedeCaminar(a: Animo, ahora: number): boolean {
  if (a.oculta || a.levantada || estaDormida(a.voz) || hablando(a) || a.mesa.pensando) return false;
  if (a.voz.estado === 'conectando' || a.voz.estado === 'hablando') return false;
  const e = expresion(a, ahora);
  return e === 'tranquila' || e === 'contenta' || e === 'escucha';
}

type Salida = { animo: Animo; efectos: Efecto[] };

const globo = (texto: string, ms = 2600, prioridad = 1): Efecto => ({ tipo: 'globo', texto, ms, prioridad });

/** Cuánto se lee un globo: ~60 ms por letra, entre 2,2 y 7 s. */
export function msLectura(texto: string): number {
  return Math.max(2200, Math.min(7000, 900 + texto.length * 60));
}

/** Para el globito: una sola línea corta; lo largo se corta en una palabra con «…». */
export function recortar(texto: string, max = 90): string {
  const t = texto.replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const corte = t.lastIndexOf(' ', max - 1);
  return `${t.slice(0, corte > max * 0.6 ? corte : max - 1).replace(/[,;:.\s]+$/, '')}…`;
}

export function reducir(a: Animo, ev: EventoAnimo, ahora: number, azar: () => number = Math.random): Salida {
  const efectos: Efecto[] = [];
  const reaccion = (exp: Expresion, ms: number) => ({ exp, hasta: ahora + ms });
  const frase = (g: GrupoFrase, n: Animo) => fraseCompa(g, n.cuenta);
  switch (ev.tipo) {
    case 'tic': {
      const irritacion = Math.max(0, a.irritacion - CALMA_POR_S * 0.5);
      const reaccionViva = a.reaccion && a.reaccion.hasta > ahora ? a.reaccion : null;
      if (irritacion === a.irritacion && reaccionViva === a.reaccion) return { animo: a, efectos };
      return { animo: { ...a, irritacion, reaccion: reaccionViva }, efectos };
    }

    case 'toque': {
      if (a.oculta) return { animo: a, efectos };
      const n = { ...a, cuenta: a.cuenta + 1, irritacion: Math.min(1, a.irritacion + PASO_TOQUE) };
      if (estaDormida(a.voz)) {
        // Dormida: se remueve y avisa cómo despertarla.
        efectos.push({ tipo: 'haptica', fuerza: 'suave' }, { tipo: 'brinco', alto: 3 }, globo(frase('dormidaToque', n), 2200));
        return { animo: n, efectos };
      }
      if (n.irritacion >= 0.9) return enojarse(n, ahora, efectos, azar);
      // La mejilla la pone tímida; la panza le da cosquillas (más risa); la cabeza, contenta.
      n.reaccion = ev.zona === 'mejilla' ? reaccion('timida', 1600) : ev.zona === 'panza' ? reaccion('encantada', 1400) : reaccion('contenta', 1400);
      efectos.push({ tipo: 'haptica', fuerza: 'suave' }, { tipo: 'brinco', alto: ev.zona === 'mejilla' ? 5 : 10 });
      // A veces una risita (nunca con la conversación abierta: el micrófono la oiría) y a veces una frase.
      if (!vozAbierta(a.voz) && azar() < (ev.zona === 'panza' ? 0.8 : 0.45)) efectos.push({ tipo: 'sonido', nombre: 'giggle' });
      if (n.cuenta % 3 === 1) efectos.push(globo(frase('toque', n), 1800));
      return { animo: n, efectos };
    }

    case 'molestar': {
      if (a.oculta) return { animo: a, efectos };
      const n = { ...a, cuenta: a.cuenta + 1, irritacion: Math.min(1, a.irritacion + PASO_MOLESTAR) };
      return enojarse(n, ahora, efectos, azar);
    }

    case 'caricia': {
      if (a.oculta || a.levantada) return { animo: a, efectos };
      const n = { ...a, cuenta: a.cuenta + 1, irritacion: 0, reaccion: reaccion('encantada', 2400) };
      efectos.push({ tipo: 'haptica', fuerza: 'seleccion' });
      if (!vozAbierta(a.voz) && ahora - a.ultimoRonroneo > 3000) {
        efectos.push({ tipo: 'sonido', nombre: 'purr' });
        n.ultimoRonroneo = ahora;
      }
      if (n.cuenta % 2 === 1) efectos.push(globo(frase('caricia', n), 1900));
      return { animo: n, efectos };
    }

    case 'dobleToque': {
      if (a.oculta || a.voz.suspendida) return { animo: a, efectos };
      const n = { ...a, cuenta: a.cuenta + 1 };
      efectos.push({ tipo: 'alternarVoz' });
      // Lo mismo que decide ControlSesion.despertarOSilenciar: abierta y sin silencio → se duerme.
      const seDuerme = vozAbierta(a.voz);
      if (seDuerme) {
        n.reaccion = null;
        efectos.push({ tipo: 'haptica', fuerza: 'suave' }, globo(frase('dormir', n), 2600, 2));
      } else {
        n.reaccion = reaccion('sorprendida', 700);
        n.irritacion = 0;
        efectos.push({ tipo: 'haptica', fuerza: 'media' }, { tipo: 'brinco', alto: 14 }, globo(frase('despertar', n), 2400, 2));
      }
      return { animo: n, efectos };
    }

    case 'levantar': {
      if (a.oculta) return { animo: a, efectos };
      const n = { ...a, cuenta: a.cuenta + 1, levantada: true, reaccion: null };
      efectos.push({ tipo: 'haptica', fuerza: 'media' }, globo(frase('levantar', n), 1600));
      return { animo: n, efectos };
    }

    case 'soltar': {
      if (!a.levantada) return { animo: a, efectos };
      const n = { ...a, cuenta: a.cuenta + 1, levantada: false, reaccion: reaccion('contenta', 1200) };
      efectos.push({ tipo: 'brinco', alto: 12 }, { tipo: 'haptica', fuerza: 'suave' });
      if (!vozAbierta(a.voz)) efectos.push({ tipo: 'sonido', nombre: 'boing' });
      if (azar() < 0.5) efectos.push(globo(frase('soltar', n), 1500));
      return { animo: n, efectos };
    }

    case 'voz': {
      const antes = a.voz;
      const v = ev.voz;
      const n = { ...a, voz: v };
      // La voz quedó suspendida (hay una llamada) y la compañera seguía a la vista: se va. Pasa si se
      // montó con la llamada ya en curso y no oyó el evento `llamada`.
      if (v.suspendida && !a.oculta) {
        efectos.push({ tipo: 'desaparecer' });
        return { animo: { ...n, oculta: true, levantada: false, reaccion: null, irritacion: 0 }, efectos };
      }
      if (v.silenciada && !antes.silenciada) efectos.push(globo('Zzz…', 2000));
      else if (v.estado === 'escuchando' && (antes.estado === 'conectando' || (antes.silenciada && !v.silenciada))) {
        efectos.push(globo(textoCompa.escuchando(), 1800));
      } else if (v.estado === 'conectando' && antes.estado !== 'conectando') efectos.push(globo(textoCompa.conectando(), 1500));
      else if (v.estado === 'error' && antes.estado !== 'error') {
        n.reaccion = reaccion('triste', 1800);
        efectos.push(globo(textoCompa.noAbrio(), 4200, 2));
      }
      if (v.estado !== 'hablando' && !a.mesa.hablando) n.sentir = 'neutral';
      return { animo: n, efectos };
    }

    case 'dijo': {
      const n = { ...a, sentir: ev.emocion };
      if (ev.mostrar && ev.texto.trim()) {
        const t = recortar(ev.texto);
        efectos.push(globo(t, msLectura(t), 1));
      }
      return { animo: n, efectos };
    }

    case 'mesa': {
      const n = { ...a, mesa: { hablando: ev.hablando, pensando: ev.pensando } };
      // Empezó a pensar (la mesa espera al cerebro): lo dice en su globito, cortito y sin repetir.
      if (ev.pensando && !a.mesa.pensando && !a.oculta && !estaDormida(a.voz)) efectos.push(globo(textoCompa.pensando(), 1600));
      if (ev.hablando) n.sentir = ev.emocion;
      else if (a.voz.estado !== 'hablando') n.sentir = 'neutral';
      return { animo: n, efectos };
    }

    case 'interrupcion': {
      if (a.oculta) return { animo: a, efectos };
      // Le hablaron encima: se calla (lo hace ElevenLabs) y pone cara de «¡uy!».
      const n = { ...a, reaccion: reaccion('uy', 1700), sentir: 'neutral' as Emocion };
      efectos.push({ tipo: 'haptica', fuerza: 'suave' }, globo(textoCompa.perdon(), 2800, 3));
      return { animo: n, efectos };
    }

    case 'llamada': {
      if (ev.activa === a.oculta) return { animo: a, efectos };
      if (ev.activa) {
        efectos.push({ tipo: 'desaparecer' });
        return { animo: { ...a, oculta: true, levantada: false, reaccion: null, irritacion: 0 }, efectos };
      }
      const n = { ...a, oculta: false, cuenta: a.cuenta + 1, reaccion: reaccion('contenta', 1600) };
      efectos.push({ tipo: 'aparecer' }, { tipo: 'brinco', alto: 16 }, globo(frase('volver', n), 2200));
      return { animo: n, efectos };
    }

    case 'hecho': {
      if (ev.accion.tipo === 'enviar') return envioPedido(a, ev.ok, ahora, efectos, ev.accion.para, ev.detalle);
      if (ev.accion.tipo === 'silencio') return { animo: a, efectos };
      // Leer y buscar dicen su resultado (o su fallo) con la lectura: aquí no se repite en voz.
      if (ev.accion.tipo === 'leer' || ev.accion.tipo === 'buscar') {
        if (ev.ok) return { animo: a, efectos: [...efectos, { tipo: 'brinco', alto: 6 }] };
        efectos.push({ tipo: 'haptica', fuerza: 'aviso' }, globo(ev.detalle ? recortar(ev.detalle, 70) : textoCompa.noPude(), 2600, 2));
        return { animo: { ...a, reaccion: reaccion('triste', 1500) }, efectos };
      }
      if (!ev.ok) {
        // Lo dice (en voz alta o al agente, que así no se queda diciendo «listo») y lo muestra.
        const texto = ev.detalle ? recortar(ev.detalle, 70) : textoCompa.noPude();
        efectos.push({ tipo: 'haptica', fuerza: 'aviso' }, globo(texto, 2600, 2), { tipo: 'confirmar', ok: false, texto: ev.detalle || textoCompa.noPude() });
        return { animo: { ...a, reaccion: reaccion('triste', 1500) }, efectos };
      }
      efectos.push({ tipo: 'brinco', alto: 6 });
      return { animo: a, efectos };
    }

    case 'enviado':
      return palomita(a, ahora, efectos, ev.nombre || ev.para);

    case 'accion': {
      if (ev.accion.tipo === 'redactar') efectos.push(globo(textoCompa.borrador(recortar(ev.accion.para, 30)), 2600, 1));
      return { animo: a, efectos };
    }
  }
  return { animo: a, efectos };
}

function enojarse(n: Animo, ahora: number, efectos: Efecto[], _azar: () => number): Salida {
  n.reaccion = { exp: 'enojada', hasta: ahora + 2400 };
  efectos.push({ tipo: 'haptica', fuerza: 'fuerte' }, { tipo: 'sacudir' }, globo(fraseCompa('enojo', n.cuenta), 1800, 2));
  return { animo: n, efectos };
}

/** Dentro de este rato, otro «envío hecho» es el mismo pedido repetido: no se dice «¡Listo!» otra vez. */
const LISTO_UNA_VEZ_MS = 5_000;

/** Un mensaje salió (a mano o por voz): la palomita ✔ y «Enviado a …», una sola vez por envío. Muda. */
function palomita(a: Animo, ahora: number, efectos: Efecto[], para?: string): Salida {
  if (ahora - a.ultimaPalomita < 2500) return { animo: a, efectos };
  efectos.push({ tipo: 'palomita' }, { tipo: 'haptica', fuerza: 'exito' }, { tipo: 'brinco', alto: 12 }, globo(textoCompa.enviado(para ? recortar(para, 24) : undefined), 2600, 3));
  return { animo: { ...a, ultimaPalomita: ahora, reaccion: { exp: 'encantada', hasta: ahora + 1800 } }, efectos };
}

/**
 * El resultado de «envíalo» (la acción `enviar`): se lo pidieron a ella, así que lo dice. Bien →
 * «¡Listo!» (una vez aunque el mismo envío avise dos veces: el `hecho` repetido de un «envíalo» que
 * llegó por el SSE y por el turno puede venir hasta 5 s después) y la palomita si `enviado` no la puso
 * ya. Mal →
 * «no pude» con el motivo, que también le llega al agente de voz.
 */
function envioPedido(a: Animo, ok: boolean, ahora: number, efectos: Efecto[], para?: string, detalle?: string): Salida {
  if (!ok) {
    efectos.push(
      { tipo: 'haptica', fuerza: 'aviso' },
      globo(detalle ? recortar(detalle, 70) : textoCompa.noEnviado(), 2600, 3),
      { tipo: 'confirmar', ok: false, texto: detalle || textoCompa.noEnviado() }
    );
    return { animo: { ...a, reaccion: { exp: 'triste', hasta: ahora + 1800 } }, efectos };
  }
  const r = palomita(a, ahora, efectos, para);
  if (ahora - a.ultimoListo < LISTO_UNA_VEZ_MS) return r;
  efectos.push({ tipo: 'confirmar', ok: true, texto: textoCompa.listo() });
  return { animo: { ...r.animo, ultimoListo: ahora }, efectos };
}
