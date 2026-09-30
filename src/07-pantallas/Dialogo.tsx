/**
 * Un diálogo de AU-RA: Ajustes, Escribir, Entrar, Bóveda, Fotos, Cámara y el menú «Más».
 *
 *  · Cerrado, no existe: ni Tab ni el lector de pantalla lo encuentran (antes se escondía con
 *    transform y seguía en el árbol accesible).
 *  · Abierto: `role="dialog"` con `aria-modal` y su título, el foco entra (al campo que se indique
 *    o al primer control), Tab no se escapa, Escape cierra y el foco vuelve a quien lo abrió.
 *  · El fondo lo vuelve `inert` la app (App.tsx) mientras haya un diálogo: no se puede tocar ni
 *    recorrer lo que está detrás.
 *
 * Si hay dos abiertos a la vez (Ajustes → Entrar), Escape y Tab los maneja el de arriba.
 */
import React, { useEffect, useRef } from 'react';
import { enfocables, recordarDisparador, saltoDeTab } from './foco';

type Props = {
  abierto: boolean;
  onCerrar: () => void;
  /** id del título visible dentro del diálogo (aria-labelledby). */
  idTitulo?: string;
  /** Nombre accesible cuando no hay título visible. */
  etiqueta?: string;
  /** El control que recibe el foco al abrir (el campo de Escribir); si no, el primer control. */
  inicial?: { current: HTMLElement | null };
  /** A quién devolver el foco al cerrar; si no se dice, al último control que se usó. */
  volverA?: { current: HTMLElement | null };
  /** Clases de la capa que ocupa la pantalla (posición del diálogo). */
  claseCapa?: string;
  /** Clases de la caja del diálogo. */
  clase?: string;
  id?: string;
  /** Tocar fuera cierra (por defecto sí). */
  cerrarFuera?: boolean;
  /** Velo transparente (el menú «Más»): bloquea el fondo sin oscurecerlo. */
  veloClaro?: boolean;
  children?: React.ReactNode;
};

/** Pila de diálogos abiertos: solo el de arriba atiende Escape y Tab. */
const pila: number[] = [];
let siguienteId = 1;

/**
 * El último control de la app (fuera de un diálogo) que tuvo el foco o se tocó. Hace falta porque
 * al abrir, el fondo se vuelve inert y el navegador suelta el foco antes de que el diálogo pregunte
 * quién lo tenía; y Safari ni siquiera enfoca un botón al hacer clic.
 */
let ultimoControl: HTMLElement | null = null;
if (typeof document !== 'undefined') {
  const anotar = (t: EventTarget | null) => {
    const el = t instanceof Element ? t.closest('button, a[href], input, textarea, select, [tabindex]') : null;
    if (el instanceof HTMLElement && !el.closest('[role="dialog"]')) ultimoControl = el;
  };
  document.addEventListener('focusin', (e) => anotar(e.target), true);
  document.addEventListener('pointerdown', (e) => anotar(e.target), true);
}

function Abierto(p: Props) {
  const caja = useRef<HTMLDivElement>(null);
  const cb = useRef(p);
  cb.current = p;

  useEffect(() => {
    const yo = siguienteId++;
    pila.push(yo);
    const activo = document.activeElement instanceof HTMLElement && document.activeElement !== document.body && !caja.current?.contains(document.activeElement) ? document.activeElement : null;
    const memoria = recordarDisparador(cb.current.volverA?.current || activo || ultimoControl);
    // Después del pintado: el diálogo ya está en el DOM y el fondo ya es inert.
    const entrar = requestAnimationFrame(() => {
      const el = cb.current.inicial?.current || (caja.current ? enfocables(caja.current)[0] : null) || caja.current;
      el?.focus({ preventScroll: true });
    });
    const alTeclear = (e: KeyboardEvent) => {
      if (pila[pila.length - 1] !== yo || !caja.current) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        cb.current.onCerrar();
        return;
      }
      if (e.key !== 'Tab') return;
      const lista = enfocables(caja.current);
      const activo = document.activeElement instanceof HTMLElement && caja.current.contains(document.activeElement) ? document.activeElement : null;
      const destino = saltoDeTab(lista, activo, e.shiftKey);
      if (destino) {
        e.preventDefault();
        destino.focus();
      } else if (!lista.length) {
        e.preventDefault();
      }
    };
    document.addEventListener('keydown', alTeclear, true);
    return () => {
      cancelAnimationFrame(entrar);
      document.removeEventListener('keydown', alTeclear, true);
      const i = pila.indexOf(yo);
      if (i !== -1) pila.splice(i, 1);
      // El fondo deja de ser inert en el mismo cambio; por si el navegador aún no lo soltó, un
      // segundo intento en el cuadro siguiente.
      const esta = (x: unknown) => x instanceof HTMLElement && x.isConnected;
      memoria.devolver(esta);
      if (memoria.disparador && (document.activeElement as unknown) !== memoria.disparador) requestAnimationFrame(() => memoria.devolver(esta));
    };
  }, []);

  return (
    <div className={`aura-capa ${p.claseCapa || ''}`}>
      <div className={`aura-velo ${p.veloClaro ? 'claro' : ''}`} aria-hidden="true" onClick={p.cerrarFuera === false ? undefined : () => p.onCerrar()} />
      <div
        ref={caja}
        id={p.id}
        role="dialog"
        aria-modal="true"
        aria-labelledby={p.idTitulo}
        aria-label={p.idTitulo ? undefined : p.etiqueta}
        tabIndex={-1}
        className={`aura-dialogo ${p.clase || ''}`}
      >
        {p.children}
      </div>
    </div>
  );
}

export function Dialogo(p: Props) {
  if (!p.abierto) return null;
  return <Abierto {...p} />;
}
