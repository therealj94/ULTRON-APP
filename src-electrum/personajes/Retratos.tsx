/**
 * LAS CARAS DE LOS PERSONAJES en un diálogo a varias voces.
 *
 * Dr Electrum sigue siendo la cara principal (el casco, arriba a la izquierda). Cuando se arma una
 * conversación con la ingeniera Tatiana, Don Chema o el narrador, aparece una mesa con la cara de
 * cada uno de los que participan: si son dos, dos; si son todos, todos.
 *
 * Tienen que sentirse PRESENTES, no ser íconos:
 *  · Quien habla pone la cara de CÓMO lo dice: la etiqueta de su línea ([laughs], [curious],
 *    [thoughtful], [serious]…, la misma que actúa la voz de Eleven v4) mueve cejas, ojos, sonrisa,
 *    inclinación y boca (expresion.ts). La boca abre con el volumen real de su voz, asiente en los
 *    golpes de voz y se sacude cuando se ríe.
 *  · Los que escuchan MIRAN a quien habla, se inclinan hacia él, asienten de vez en cuando y le
 *    devuelven la emoción a medias (sonríen si el otro se ríe, levantan las cejas si se sorprende).
 *  · Todos respiran, parpadean a destiempo y mueven los ojos: nadie queda congelado.
 *
 * Todo se anima en un solo requestAnimationFrame por cara tocando los atributos del SVG: la voz se
 * sigue a 60 Hz sin re-renderizar React. Quién habla y qué línea lo dice la escena de voz.ts, con
 * los tiempos por hablante que manda ElevenLabs.
 */
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { escucharEscena, nivelVoz, type Escena } from '../panel/voz';
import { METAS, expresionDeLinea, reaccionA, sinEtiquetas, type Expresion, type Metas } from './expresion';
import { abrirMesa, escucharMesa, mesaAbierta } from './mesa';

type Rasgos = { nombre: string; papel: string; color: string; piel: string; sombra: string; iris: string };

export const RETRATOS: Record<string, Rasgos> = {
  electrum: { nombre: 'Dr Electrum', papel: 'Geólogo sénior', color: '#FFAE3B', piel: '#E2AE86', sombra: '#B97F57', iris: '#6B4A2B' },
  tatiana: { nombre: 'Ing. Tatiana', papel: 'Ing. civil y ambiental', color: '#5CD6C4', piel: '#D9A07C', sombra: '#A86E4E', iris: '#2F6B5E' },
  chema: { nombre: 'Don Chema', papel: 'Metalurgista', color: '#E08A5A', piel: '#B97B55', sombra: '#86523A', iris: '#3B2616' },
  narrador: { nombre: 'Narrador', papel: 'Voz del recorrido', color: '#B39DFF', piel: '#2A2150', sombra: '#140F2C', iris: '#E6DEFF' },
};

/** Lo que una cara necesita saber de la mesa en cada cuadro (se lee por ref, sin re-render). */
type Mesa = { hablante: string | null; expresion: Expresion; orden: string[] };

/* ---------------------------------------------------------------- la cara */

const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
const f = (n: number) => n.toFixed(2);

type Partes = {
  cabeza: SVGGElement | null;
  ojoI: SVGGElement | null;
  ojoD: SVGGElement | null;
  irisI: SVGGElement | null;
  irisD: SVGGElement | null;
  cejaI: SVGPathElement | null;
  cejaD: SVGPathElement | null;
  boca: SVGPathElement | null;
  bocaClip: SVGPathElement | null;
  dientes: SVGRectElement | null;
  lengua: SVGEllipseElement | null;
  mejillas: SVGGElement | null;
  anillo: SVGCircleElement | null;
  halo: SVGCircleElement | null;
  extra: SVGGraphicsElement | null; // lo que se mueve aparte: aretes, lámpara, ondas
  bigote: SVGGElement | null; // sigue a la boca (el doctor y Don Chema)
};

const vacias = (): Partes => ({
  cabeza: null, ojoI: null, ojoD: null, irisI: null, irisD: null, cejaI: null, cejaD: null, boca: null,
  bocaClip: null, dientes: null, lengua: null, mejillas: null, anillo: null, halo: null, extra: null, bigote: null,
});

/** La boca como curva: comisuras que suben con la sonrisa, labio de abajo que baja con la voz. */
function trazoBoca(abre: number, sonrisa: number, redonda: number) {
  const w = 12 * (1 - 0.42 * redonda) + sonrisa * 2.2;
  const yc = 86 - sonrisa * 4.2;
  const arriba = 86 - abre * 0.32 + sonrisa * 1.4 - redonda * abre * 0.25;
  const abajo = 86 + abre + Math.max(0, sonrisa) * 5.5 - Math.min(0, sonrisa) * -2.5;
  return `M${f(60 - w)} ${f(yc)} Q60 ${f(arriba)} ${f(60 + w)} ${f(yc)} Q60 ${f(abajo)} ${f(60 - w)} ${f(yc)} Z`;
}

function Cara({ quien, mesa }: { quien: string; mesa: { current: Mesa } }) {
  const r = RETRATOS[quien] || RETRATOS.narrador;
  const p = useRef<Partes>(vacias());
  const set = <K extends keyof Partes>(k: K) => (el: Partes[K]) => {
    p.current[k] = el;
  };

  useEffect(() => {
    let vivo = true;
    let antes = performance.now();
    const t0 = antes + Math.random() * 5000; // cada uno respira a su ritmo
    const cur: Metas = { ...METAS.neutral };
    let voz = 0; // nivel suavizado de la voz (0..1)
    let parpadeo = 0; // 0 abierto … 1 cerrado
    let proximoParpadeo = antes + 800 + Math.random() * 2500;
    let finParpadeo = 0;
    const mirada = { x: 0, y: 0 };
    let metaMirada = { x: 0, y: 0 };
    let proximaMirada = antes;
    let cabeceo = 0; // resorte del asentir
    let velCabeceo = 0;
    let proximoAsentir = antes + 1500 + Math.random() * 2500;
    let bajo = true; // para detectar golpes de voz
    let hablabaAntes = false;
    let enfasis = 0; // cejas que suben en los golpes de voz

    const paso = (ahora: number) => {
      if (!vivo) return;
      const dt = Math.min(0.05, (ahora - antes) / 1000);
      antes = ahora;
      const t = (ahora - t0) / 1000;
      const m = mesa.current;
      const habla = m.hablante === quien;
      const otro = m.hablante && !habla ? m.hablante : null;

      // 1 · A qué expresión va: la de su línea si habla; la reacción a la del otro si escucha.
      const meta = METAS[habla ? m.expresion : otro ? reaccionA(m.expresion) : 'neutral'];
      const k = 1 - Math.exp(-dt * (habla ? 7 : 4));
      (Object.keys(cur) as Array<keyof Metas>).forEach((c) => {
        cur[c] += (meta[c] - cur[c]) * k;
      });

      // 2 · La voz: sube rápido, baja suave (como se abre y se cierra una boca de verdad).
      let crudo = 0;
      if (habla) {
        const medido = nivelVoz();
        crudo = medido >= 0 ? medido : 0.3 + 0.28 * Math.abs(Math.sin(t * 9.5)) * (0.6 + 0.4 * Math.sin(t * 2.3));
      }
      voz += (crudo - voz) * (crudo > voz ? 0.55 : 0.18);
      if (habla && !hablabaAntes) {
        // Empieza a hablar: un parpadeo y un pequeño impulso, como quien toma la palabra.
        proximoParpadeo = ahora;
        velCabeceo -= 18;
      }
      hablabaAntes = habla;

      // 3 · Golpes de voz → asiente y levanta las cejas (el énfasis de quien explica).
      if (habla) {
        if (bajo && voz > 0.5) {
          bajo = false;
          velCabeceo += 26 + Math.random() * 18;
          enfasis = 1;
        } else if (voz < 0.22) bajo = true;
      }
      enfasis *= Math.exp(-dt * 4);
      // Quien escucha asiente de vez en cuando: «ajá, te sigo».
      if (otro && ahora > proximoAsentir) {
        velCabeceo += 34;
        proximoAsentir = ahora + 2200 + Math.random() * 3500;
      }
      velCabeceo += (-cabeceo * 90 - velCabeceo * 11) * dt;
      cabeceo += velCabeceo * dt;

      // 4 · Parpadeo a destiempo (y más lento cuando se ríe).
      if (ahora >= proximoParpadeo && !finParpadeo) finParpadeo = ahora + 150;
      if (finParpadeo) {
        const x = 1 - (finParpadeo - ahora) / 150;
        parpadeo = x < 0.5 ? x * 2 : (1 - x) * 2;
        if (ahora >= finParpadeo) {
          finParpadeo = 0;
          parpadeo = 0;
          proximoParpadeo = ahora + 1800 + Math.random() * 3800 * (Math.random() < 0.15 ? 0.15 : 1);
        }
      }

      // 5 · La mirada: quien escucha mira a quien habla; quien habla mira al frente y a veces a
      //     los que lo escuchan; pensando, arriba. Con sacadas chicas para que el ojo esté vivo.
      if (ahora > proximaMirada) {
        const yo = m.orden.indexOf(quien);
        let x = (Math.random() - 0.5) * 0.5;
        if (otro) x = clamp((m.orden.indexOf(otro) - yo) * 0.9, -1, 1) + (Math.random() - 0.5) * 0.2;
        else if (habla && m.orden.length > 1 && Math.random() < 0.35) x = yo === 0 ? 0.8 : -0.8;
        metaMirada = { x, y: (Math.random() - 0.5) * 0.3 };
        proximaMirada = ahora + (habla ? 700 : 1100) + Math.random() * 1800;
      }
      mirada.x += (metaMirada.x - mirada.x) * Math.min(1, dt * 14);
      mirada.y += (metaMirada.y + cur.miradaY - mirada.y) * Math.min(1, dt * 14);

      const P = p.current;
      // Cabeza: respira, se inclina con la expresión y hacia quien habla, rebota con la risa.
      const respira = Math.sin(t * 1.7) * 0.9;
      const inclina = cur.inclinacion + (otro ? clamp(m.orden.indexOf(otro) - m.orden.indexOf(quien), -1, 1) * 4 : 0) + Math.sin(t * 0.6) * 1.2;
      const rebote = cur.rebote * Math.abs(Math.sin(t * 15)) * (habla ? 2.4 : 0.8);
      const dy = respira * 0.6 - rebote + cabeceo * 0.06 - voz * 1.2;
      const escala = 1 + Math.sin(t * 1.7) * 0.008;
      P.cabeza?.setAttribute('transform', `translate(0 ${f(dy)}) rotate(${f(inclina + cabeceo * 0.12)} 60 70) translate(60 70) scale(${f(escala)}) translate(-60 -70)`);

      // Ojos: abiertos según la expresión, cerrados en el parpadeo. Iris siguiendo la mirada.
      const abre = clamp(cur.ojos * (1 - parpadeo) + enfasis * 0.08, 0.06, 1.35);
      P.ojoI?.setAttribute('transform', `translate(44 58) scale(1 ${f(abre)})`);
      P.ojoD?.setAttribute('transform', `translate(76 58) scale(1 ${f(abre)})`);
      const ix = mirada.x * 3;
      const iy = clamp(mirada.y, -1, 1) * 2.6;
      P.irisI?.setAttribute('transform', `translate(${f(ix)} ${f(iy)})`);
      P.irisD?.setAttribute('transform', `translate(${f(ix)} ${f(iy)})`);

      // Cejas: suben, se juntan (ceño), se levantan por dentro (preocupación), una más que otra (duda).
      const sube = (cur.ceja > 0 ? cur.ceja * 5.5 : cur.ceja * 2) + enfasis * 2.2;
      const interior = Math.max(0, -cur.ceja) * 13 - cur.cejaInterior * 14;
      P.cejaI?.setAttribute('transform', `translate(0 ${f(-sube - cur.cejaAsim * 3.5)}) rotate(${f(interior)} 36 45)`);
      P.cejaD?.setAttribute('transform', `translate(0 ${f(-sube + cur.cejaAsim * 1.2)}) rotate(${f(-interior)} 84 45)`);

      // Boca: la voz la abre; la expresión le da la forma (sonrisa, redonda de sorpresa).
      const redonda = clamp(cur.bocaO + (habla ? Math.max(0, Math.sin(t * 5.3)) * 0.25 : 0), 0, 1);
      const abreBoca = voz * 11 + cur.bocaO * 3.2 + (cur.rebote > 0.5 && habla ? 3 : 0);
      const d = trazoBoca(abreBoca, cur.sonrisa, redonda);
      P.boca?.setAttribute('d', d);
      P.bocaClip?.setAttribute('d', d);
      P.dientes?.setAttribute('opacity', f(clamp((abreBoca - 2) / 4, 0, 0.95)));
      P.lengua?.setAttribute('cy', f(86 + abreBoca * 0.85));
      P.lengua?.setAttribute('opacity', f(clamp((abreBoca - 4) / 5, 0, 0.9)));
      P.mejillas?.setAttribute('opacity', f(0.16 + Math.max(0, cur.sonrisa) * 0.42));

      // El anillo de su color late con la voz; el halo se enciende al hablar.
      P.anillo?.setAttribute('stroke-opacity', f(habla ? 0.55 + voz * 0.45 : otro ? 0.28 : 0.4));
      P.anillo?.setAttribute('r', f(55 + (habla ? voz * 2.5 : 0)));
      P.halo?.setAttribute('opacity', f(habla ? 0.35 + voz * 0.5 : 0));

      // Lo propio de cada uno.
      P.bigote?.setAttribute('transform', `translate(0 ${f(abreBoca * 0.28 - cur.sonrisa * 1.2)})`);
      if (P.extra) {
        if (quien === 'tatiana') P.extra.setAttribute('transform', `rotate(${f(-inclina * 0.8 + Math.sin(t * 2.1) * 2)} 60 60)`);
        else if (quien === 'electrum') P.extra.setAttribute('opacity', f(0.55 + (habla ? voz * 0.45 : 0.1 + Math.sin(t * 1.3) * 0.05)));
        else if (quien === 'narrador') P.extra.setAttribute('transform', `rotate(${f(t * 14)} 60 60)`);
      }
      requestAnimationFrame(paso);
    };
    requestAnimationFrame(paso);
    return () => {
      vivo = false;
    };
  }, [quien, mesa]);

  const id = `retrato-${quien}`;
  const esNarrador = quien === 'narrador';
  const ojo = (lado: 'I' | 'D') => (
    <g ref={set(lado === 'I' ? 'ojoI' : 'ojoD')} transform={`translate(${lado === 'I' ? 44 : 76} 58)`}>
      <ellipse rx="7.2" ry="8" fill={esNarrador ? '#0E0A20' : '#FBF7F2'} />
      <g clipPath={`url(#${id}-ojo)`}>
        <g ref={set(lado === 'I' ? 'irisI' : 'irisD')}>
          <circle r="4.6" fill={`url(#${id}-iris)`} />
          <circle r="2.1" fill={esNarrador ? r.color : '#120A05'} />
          <circle cx="1.6" cy="-1.8" r="1.35" fill="#fff" opacity=".95" />
          <circle cx="-1.4" cy="1.5" r=".6" fill="#fff" opacity=".6" />
        </g>
      </g>
      {/* línea del párpado: define el ojo sin pestañas pintadas */}
      <path d="M-7.6 -1.5 Q0 -9.6 7.6 -1.5" fill="none" stroke={esNarrador ? r.color : '#3A2418'} strokeWidth="1.5" strokeLinecap="round" opacity=".85" />
    </g>
  );
  const ceja = (lado: 'I' | 'D') => (
    <path
      ref={set(lado === 'I' ? 'cejaI' : 'cejaD')}
      d={lado === 'I' ? 'M35 46 Q43 40.5 51 44.5' : 'M69 44.5 Q77 40.5 85 46'}
      fill="none"
      stroke={quien === 'chema' ? '#E8E0D4' : quien === 'electrum' ? '#D9D3C9' : esNarrador ? r.color : '#3A2418'}
      strokeWidth={quien === 'chema' || quien === 'electrum' ? 3.4 : 2.6}
      strokeLinecap="round"
    />
  );

  return (
    <svg viewBox="0 0 120 120" className="h-full w-full overflow-visible" aria-hidden="true">
      <defs>
        <radialGradient id={`${id}-piel`} cx="42%" cy="36%" r="70%">
          <stop offset="0%" stopColor={r.piel} />
          <stop offset="70%" stopColor={r.piel} />
          <stop offset="100%" stopColor={r.sombra} />
        </radialGradient>
        <radialGradient id={`${id}-iris`} cx="40%" cy="35%" r="70%">
          <stop offset="0%" stopColor={esNarrador ? '#fff' : r.color} />
          <stop offset="55%" stopColor={r.iris} />
          <stop offset="100%" stopColor="#0B0604" />
        </radialGradient>
        <radialGradient id={`${id}-fondo`} cx="50%" cy="40%" r="60%">
          <stop offset="0%" stopColor={r.color} stopOpacity=".28" />
          <stop offset="100%" stopColor="#05080B" stopOpacity="0" />
        </radialGradient>
        <clipPath id={`${id}-marco`}>
          <circle cx="60" cy="60" r="55" />
        </clipPath>
        <clipPath id={`${id}-ojo`}>
          <ellipse rx="7.2" ry="8" />
        </clipPath>
        <clipPath id={`${id}-boca`}>
          <path ref={set('bocaClip')} d={trazoBoca(0, 0.15, 0)} />
        </clipPath>
      </defs>

      {/* halo y anillo del color de cada uno */}
      <circle ref={set('halo')} cx="60" cy="60" r="58" fill={`url(#${id}-fondo)`} opacity="0" />
      <circle cx="60" cy="60" r="55" fill="#0A1015" />
      <circle ref={set('anillo')} cx="60" cy="60" r="55" fill="none" stroke={r.color} strokeWidth="2.2" strokeOpacity=".4" />

      <g clipPath={`url(#${id}-marco)`}>
        <g ref={set('cabeza')}>
          {esNarrador ? (
            <>
              {/* el narrador es una presencia: un orbe con anillos que giran */}
              <circle cx="60" cy="64" r="36" fill={`url(#${id}-piel)`} stroke={r.color} strokeWidth="1.5" strokeOpacity=".7" />
              <g ref={set('extra')}>
                <ellipse cx="60" cy="64" rx="46" ry="12" fill="none" stroke={r.color} strokeOpacity=".35" strokeWidth="1" strokeDasharray="3 5" />
                <ellipse cx="60" cy="64" rx="12" ry="46" fill="none" stroke={r.color} strokeOpacity=".2" strokeWidth="1" strokeDasharray="2 6" />
              </g>
            </>
          ) : (
            <>
              {/* cuello y hombros */}
              <path d="M44 100 L46 90 L74 90 L76 100 Z" fill={r.sombra} />
              <path d="M14 122 C18 104 36 98 60 98 C84 98 102 104 106 122 Z" fill={quien === 'tatiana' ? '#3F6E8C' : quien === 'chema' ? '#5A4630' : '#4A5236'} />
              {quien === 'tatiana' && (
                <>
                  {/* cabello recogido detrás y chaleco reflectivo de obra */}
                  <path d="M24 50 C20 80 26 98 34 102 L86 102 C94 98 100 80 96 50 Z" fill="#2B1A12" />
                  <path d="M14 122 C17 107 28 101 45 99 L52 122 Z" fill="#FF8A1F" />
                  <path d="M106 122 C103 107 92 101 75 99 L68 122 Z" fill="#FF8A1F" />
                  <path d="M17 110 L49 106 L50.5 111 L16 115 Z" fill="#E9F2F4" opacity=".9" />
                  <path d="M103 110 L71 106 L69.5 111 L104 115 Z" fill="#E9F2F4" opacity=".9" />
                </>
              )}
              {quien === 'electrum' && (
                <>
                  {/* camisa de campo con cuello */}
                  <path d="M46 98 L60 110 L74 98 L70 96 L60 104 L50 96 Z" fill="#6B7250" />
                </>
              )}
              {/* orejas */}
              <ellipse cx="27" cy="64" rx="5" ry="7.5" fill={r.sombra} />
              <ellipse cx="93" cy="64" rx="5" ry="7.5" fill={r.sombra} />
              {/* cara */}
              <path d="M60 24 C82 24 94 40 94 62 C94 84 80 98 60 98 C40 98 26 84 26 62 C26 40 38 24 60 24 Z" fill={`url(#${id}-piel)`} />
              {/* nariz */}
              <path d="M60 60 Q57 72 55.5 74 Q60 77 64.5 74" fill="none" stroke={r.sombra} strokeWidth="1.6" strokeLinecap="round" opacity=".8" />
              {quien === 'electrum' && (
                <>
                  {/* los años de campo: canas en las sienes, patas de gallo y surcos */}
                  <path d="M26 40 C25 50 26 60 29 68 L33 66 C31 58 30 48 31 40 Z" fill="#CFC9BF" />
                  <path d="M94 40 C95 50 94 60 91 68 L87 66 C89 58 90 48 89 40 Z" fill="#CFC9BF" />
                  {/* barba corta: va debajo de la boca, que se abre encima */}
                  <path d="M29 66 C29 88 43 101 60 101 C77 101 91 88 91 66 C88 79 79 92 60 92 C41 92 32 79 29 66 Z" fill="#CFC9BF" />
                  <path d="M52 92.5 Q60 95.5 68 92.5 Q60 98 52 92.5 Z" fill="#B9B2A7" />
                  <g fill="none" stroke={r.sombra} strokeWidth="1" strokeLinecap="round" opacity=".7">
                    <path d="M33 57 L29.5 55.5 M33 60 L29 60 M33 63 L29.5 64.5" />
                    <path d="M87 57 L90.5 55.5 M87 60 L91 60 M87 63 L90.5 64.5" />
                    <path d="M50 73 Q46 79 47.5 86" />
                    <path d="M70 73 Q74 79 72.5 86" />
                    <path d="M49 41 Q60 39 71 41" opacity=".6" />
                  </g>
                </>
              )}
            </>
          )}

          <g ref={set('mejillas')} opacity=".2">
            <ellipse cx="38" cy="75" rx="6.5" ry="3.8" fill={esNarrador ? r.color : '#E0645A'} />
            <ellipse cx="82" cy="75" rx="6.5" ry="3.8" fill={esNarrador ? r.color : '#E0645A'} />
          </g>

          {ojo('I')}
          {ojo('D')}
          {ceja('I')}
          {ceja('D')}

          {/* boca: el hueco oscuro, dientes y lengua dentro, labio encima */}
          <g clipPath={`url(#${id}-boca)`}>
            <rect x="40" y="70" width="40" height="40" fill="#2A0E0C" />
            <rect ref={set('dientes')} x="46" y="80" width="28" height="5.2" rx="2" fill="#F6F1EA" opacity="0" />
            <ellipse ref={set('lengua')} cx="60" cy="92" rx="8" ry="4.5" fill="#C9575A" opacity="0" />
          </g>
          <path ref={set('boca')} d={trazoBoca(0, 0.15, 0)} fill="none" stroke={esNarrador ? r.color : '#8E3F3A'} strokeWidth="1.8" strokeLinejoin="round" />

          {quien === 'tatiana' && (
            <>
              {/* cabello a los lados, bajo el casco */}
              <path d="M26 38 C23 50 24 62 28 72 L32 70 C29 60 29 48 31 38 Z" fill="#3A2317" />
              <path d="M94 38 C97 50 96 62 92 72 L88 70 C91 60 91 48 89 38 Z" fill="#3A2317" />
              {/* casco blanco de ingeniera, con su calcomanía */}
              <path d="M25 36 C25 7 95 7 95 36 Z" fill="#F3F5F7" />
              <path d="M25 36 C25 22 32 13 44 9.5 C36 16 33 26 33 36 Z" fill="#D5DCE2" />
              <path d="M57 8.5 L63 8.5 L63 35 L57 35 Z" fill="#DCE2E7" />
              <path d="M17 36.5 Q60 31 103 36.5 Q104 40.5 99 41.5 Q60 36.5 21 41.5 Q16 40.5 17 36.5 Z" fill="#E6EBEF" />
              <circle cx="76" cy="24" r="4.2" fill={r.color} />
              <path d="M74 24 L75.6 25.8 L78.4 22.4" fill="none" stroke="#0B1E1B" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M38 22 C42 16 49 12.5 55 11.5" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" opacity=".8" />
              {/* lentes de seguridad */}
              <rect x="34" y="50" width="20" height="15" rx="6" fill={r.color} fillOpacity=".08" stroke={r.color} strokeWidth="1.8" />
              <rect x="66" y="50" width="20" height="15" rx="6" fill={r.color} fillOpacity=".08" stroke={r.color} strokeWidth="1.8" />
              <path d="M54 56 Q60 53 66 56" fill="none" stroke={r.color} strokeWidth="1.8" />
              <path d="M36 52 L42 58" stroke="#fff" strokeOpacity=".35" strokeWidth="1.4" strokeLinecap="round" />
              <path d="M68 52 L74 58" stroke="#fff" strokeOpacity=".35" strokeWidth="1.4" strokeLinecap="round" />
              {/* aretes que se mecen con la cabeza */}
              <g ref={set('extra')}>
                <circle cx="27" cy="74" r="2.6" fill={r.color} />
                <circle cx="93" cy="74" r="2.6" fill={r.color} />
              </g>
            </>
          )}
          {quien === 'chema' && (
            <>
              {/* bigote que sigue la boca */}
              <g ref={set('bigote')}>
                <path d="M42 80 C48 74 55 76 60 78 C65 76 72 74 78 80 C72 84 65 82 60 81 C55 82 48 84 42 80 Z" fill="#E8E0D4" />
              </g>
              {/* sombrero de ala ancha, con su cinta */}
              <ellipse cx="60" cy="30" rx="50" ry="9" fill="#C98D5E" />
              <ellipse cx="60" cy="28.5" rx="50" ry="7" fill="#DDA474" />
              <path d="M36 29 C36 4 84 4 84 29 Z" fill="#DDA474" />
              <path d="M37 23 C44 26 76 26 83 23 L84 29 C76 32 44 32 36 29 Z" fill="#7A3E24" />
              <path d="M45 20 C50 15 55 13.5 59 13.5" fill="none" stroke="#fff" strokeOpacity=".25" strokeWidth="2" strokeLinecap="round" />
            </>
          )}
          {quien === 'electrum' && (
            <>
              {/* bigote canoso: sigue a la boca */}
              <g ref={set('bigote')}>
                <path d="M45 81 C50 76.5 56 77.5 60 79.5 C64 77.5 70 76.5 75 81 C70 83.5 64.5 82.5 60 81.2 C55.5 82.5 50 83.5 45 81 Z" fill="#DDD7CD" />
              </g>
              {/* casco minero con lámpara */}
              <path d="M24 34 C24 4 96 4 96 34 Z" fill={r.color} />
              <path d="M36 24 C43 18 50 15.5 56 15" fill="none" stroke="#fff" strokeOpacity=".35" strokeWidth="2.5" strokeLinecap="round" />
              <path d="M57.5 11 L62.5 11 L62.5 33 L57.5 33 Z" fill="#E0901F" />
              <rect x="18" y="31" width="84" height="6.5" rx="3.25" fill="#E0901F" />
              <circle cx="60" cy="21" r="7.5" fill="#3A2A12" />
              <circle cx="60" cy="21" r="5.5" fill="#FFF3C4" />
              <circle ref={set('extra')} cx="60" cy="21" r="12" fill="#FFF3C4" opacity=".55" style={{ filter: 'blur(3px)' }} />
            </>
          )}
        </g>
      </g>
    </svg>
  );
}

/* ---------------------------------------------------------------- la mesa */

/** Tres barritas que bailan mientras habla; un punto que respira mientras escucha. */
function Estado({ habla, color }: { habla: boolean; color: string }) {
  return (
    <span className="retrato-estado mt-1 flex h-3 items-center gap-[3px]" aria-hidden="true">
      {habla ? (
        [0, 1, 2].map((i) => <span key={i} className="retrato-barra w-[3px] rounded-full" style={{ background: color, animationDelay: `${i * 0.13}s` }} />)
      ) : (
        <span className="retrato-punto h-[5px] w-[5px] rounded-full" style={{ background: color }} />
      )}
    </span>
  );
}

function Retrato({ quien, habla, alguien, orden, mesa }: { quien: string; habla: boolean; alguien: boolean; orden: number; mesa: { current: Mesa } }) {
  const r = RETRATOS[quien] || RETRATOS.narrador;
  return (
    <div className="retrato-entra flex flex-col items-center" style={{ animationDelay: `${orden * 110}ms` }}>
      <div
        className="relative h-[68px] w-[68px] transition-[transform,filter,opacity] duration-500 ease-[cubic-bezier(.2,.9,.25,1.15)] md:h-[92px] md:w-[92px]"
        style={{
          transform: habla ? 'scale(1.14) translateY(-4px)' : 'scale(1)',
          filter: habla ? `drop-shadow(0 6px 18px ${r.color}66)` : alguien ? 'saturate(.8) brightness(.86)' : 'none',
        }}
      >
        <Cara quien={quien} mesa={mesa} />
      </div>
      <span className="mt-2 whitespace-nowrap font-mono text-[10px] tracking-[0.12em] uppercase transition-opacity duration-300" style={{ color: r.color, opacity: habla || !alguien ? 1 : 0.7 }}>
        {r.nombre}
      </span>
      <span className="hidden whitespace-nowrap text-[9.5px] text-[#8FA2AC] md:block">{habla ? 'habla' : alguien ? 'escucha' : r.papel}</span>
      <Estado habla={habla} color={r.color} />
    </div>
  );
}

const CSS = `
@keyframes retrato-entra{0%{opacity:0;transform:translateY(14px) scale(.86)}60%{opacity:1;transform:translateY(-3px) scale(1.03)}100%{opacity:1;transform:none}}
.retrato-entra{animation:retrato-entra .6s cubic-bezier(.2,.9,.25,1) both}
@keyframes retrato-mesa{from{opacity:0;transform:translateY(-10px) scale(.97)}to{opacity:1;transform:none}}
@keyframes retrato-sale{to{opacity:0;transform:translateY(-10px) scale(.97)}}
.retrato-mesa{animation:retrato-mesa .45s cubic-bezier(.2,.9,.25,1) both}
.retrato-mesa.saliendo{animation:retrato-sale .35s ease-in both}
@keyframes retrato-barra{0%,100%{height:3px}50%{height:11px}}
.retrato-barra{height:3px;animation:retrato-barra .7s ease-in-out infinite}
@keyframes retrato-punto{0%,100%{opacity:.35;transform:scale(.8)}50%{opacity:.9;transform:scale(1.1)}}
.retrato-punto{animation:retrato-punto 2.4s ease-in-out infinite}
@keyframes retrato-linea{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}
.retrato-linea{animation:retrato-linea .35s ease-out both}
@media (prefers-reduced-motion: reduce){.retrato-entra,.retrato-mesa,.retrato-barra,.retrato-punto,.retrato-linea{animation:none}}
`;

/** La mesa del diálogo: aparece con las caras de quienes participan y se va al terminar. */
export function Retratos() {
  const [escena, setEscena] = useState<Escena>({ hablante: null, participantes: null, linea: null });
  // Al terminar, la mesa se queda un momento para salir con animación (no desaparece de golpe).
  const [ultimos, setUltimos] = useState<string[] | null>(null);
  const mesa = useRef<Mesa>({ hablante: null, expresion: 'neutral', orden: [] });
  useEffect(() => escucharEscena(setEscena), []);
  // La mesa técnica abierta: los tres quedan en pantalla escuchando entre una pregunta y otra.
  const [abierta, setAbierta] = useState(mesaAbierta());
  useEffect(() => escucharMesa(setAbierta), []);

  const enDialogo = escena.participantes && escena.participantes.length >= 2 ? escena.participantes : null;
  const participantes = enDialogo || (abierta ? ['electrum', 'chema', 'tatiana'] : null);
  useEffect(() => {
    if (participantes) {
      setUltimos(participantes);
      return;
    }
    const t = window.setTimeout(() => setUltimos(null), 360);
    return () => clearTimeout(t);
  }, [participantes?.join()]); // eslint-disable-line react-hooks/exhaustive-deps

  const orden = participantes || ultimos;
  mesa.current = { hablante: escena.hablante, expresion: expresionDeLinea(escena.linea), orden: orden || [] };
  if (!orden) return null;
  const hablante = participantes ? escena.hablante : null;
  const dicho = hablante ? sinEtiquetas(escena.linea) : '';
  const color = hablante ? (RETRATOS[hablante] || RETRATOS.narrador).color : '#8FA2AC';

  return createPortal(
    <div
      className="pointer-events-none fixed inset-x-0 top-16 z-[60] flex justify-center pl-3 pr-14 md:px-3"
      role="status"
      aria-label={`En conversación: ${orden.map((q) => RETRATOS[q]?.nombre || q).join(', ')}${hablante ? `. Habla ${RETRATOS[hablante]?.nombre || hablante}` : ''}`}
      data-retratos={participantes ? 'abierta' : 'saliendo'}
    >
      <div className={`retrato-mesa ${participantes ? '' : 'saliendo'} relative flex max-w-[min(92vw,640px)] flex-col items-center overflow-hidden rounded-[22px] border border-white/10 bg-[linear-gradient(180deg,rgba(14,20,26,.86),rgba(6,9,12,.9))] px-4 pb-3 pt-4 shadow-[0_18px_50px_rgba(0,0,0,.6),inset_0_1px_0_rgba(255,255,255,.06)] backdrop-blur-md md:px-6`}>
        {/* la luz de quien habla tiñe la mesa */}
        <div className="pointer-events-none absolute inset-0 transition-[background] duration-700" style={{ background: `radial-gradient(120% 90% at 50% 0%, ${color}22, transparent 65%)` }} />
        <div className="relative flex items-end gap-4 md:gap-7">
          {orden.map((q, i) => (
            <div key={q}>
              <Retrato quien={q} habla={hablante === q} alguien={!!hablante} orden={i} mesa={mesa} />
            </div>
          ))}
        </div>
        {abierta && (
          <button
            type="button"
            onClick={() => abrirMesa(false)}
            className="pointer-events-auto absolute right-2 top-2 rounded-full px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.1em] text-[#9FB0B8] hover:bg-white/10 hover:text-white cursor-pointer"
            title="Cerrar la mesa técnica"
            aria-label="Cerrar la mesa técnica"
          >
            ✕
          </button>
        )}
        <div className="relative mt-2 min-h-[18px] w-full max-w-[520px] text-center text-[12.5px] leading-snug md:text-[13px]">
          {!dicho && abierta && !enDialogo && (
            <p className="retrato-linea text-[#9FB0B8]" data-mesa-escucha>
              <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-[#5CD6C4]">Mesa técnica · </span>
              Le escuchamos: pregunte y lo discutimos entre los tres.
            </p>
          )}
          {dicho && (
            <p key={dicho} className="retrato-linea line-clamp-2 text-[#E6EEF2]" data-retrato-linea>
              <span className="font-semibold" style={{ color }}>
                {(RETRATOS[hablante!] || RETRATOS.narrador).nombre}:
              </span>{' '}
              {dicho}
            </p>
          )}
        </div>
      </div>
      <style>{CSS}</style>
    </div>,
    document.body
  );
}
