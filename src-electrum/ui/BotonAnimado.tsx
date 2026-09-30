/**
 * BOTÓN ANIMADO (web): react-awesome-button con el tema de Dr Electrum.
 *
 * Misma API que la versión de la app (mobile/src/electrum/BotonAnimado.tsx):
 *   texto, tipo, tamano, disabled, loading, onPress, etiqueta, icono, completo, enviar.
 *
 * Tres cosas que la librería no hace sola y aquí se arreglan:
 *  · Teclado. Solo dispara `onPress` al soltar el ratón o el dedo; Enter y Espacio no hacían nada.
 *  · Ratón en pantallas táctiles. Si el equipo tiene pantalla táctil escucha solo eventos táctiles,
 *    y un clic con ratón en ese mismo portátil se perdía.
 *  · Foco y movimiento. Quita el outline de foco y anima aunque el sistema pida menos movimiento
 *    (lo resuelve botonAnimado.css).
 * Los dos primeros se cubren con el `click` nativo del <button>, sin disparar dos veces.
 */
import { forwardRef, useEffect, useMemo, useRef, useState, type ButtonHTMLAttributes, type CSSProperties, type ReactNode } from 'react';
// La versión compilada del paquete (dist/) trae el runtime de React 18 y revienta con React 19
// («ReactCurrentOwner»); su propio código fuente, compilado con nuestro React, funciona igual.
import AwesomeButton from 'react-awesome-button/src/components/AwesomeButton';
import 'react-awesome-button/dist/styles.css';
import './botonAnimado.css';
import { TEMA_BOTON, type ColoresBoton, type TamanoBoton, type TipoBoton } from './temaBoton';

export type BotonAnimadoProps = {
  texto: string;
  tipo?: TipoBoton;
  tamano?: TamanoBoton;
  disabled?: boolean;
  /** Muestra un giro, anuncia «ocupado» y no acepta más toques. */
  loading?: boolean;
  onPress?: () => void;
  /** Nombre para lectores de pantalla cuando el texto no basta (p. ej. solo un icono). */
  etiqueta?: string;
  icono?: ReactNode;
  /** Ocupa todo el ancho disponible. */
  completo?: boolean;
  /** Botón de formulario: envía el <form> que lo contiene (Enter en un campo también). */
  enviar?: boolean;
  className?: string;
};

/** Entre un disparo por puntero y el `click` que el navegador manda después, en ms. */
const VENTANA_DOBLE_DISPARO = 600;

/** Las variables CSS del tipo «link» se llaman «anchor» en la librería. */
const CLASE_LIBRERIA: Record<TipoBoton, string> = { primary: 'primary', secondary: 'secondary', danger: 'danger', link: 'anchor' };

function useSinMovimiento(): boolean {
  const consulta = '(prefers-reduced-motion: reduce)';
  const [sin, setSin] = useState(() => typeof window !== 'undefined' && !!window.matchMedia?.(consulta).matches);
  useEffect(() => {
    const mq = window.matchMedia?.(consulta);
    if (!mq) return;
    const cambio = () => setSin(mq.matches);
    mq.addEventListener('change', cambio);
    return () => mq.removeEventListener('change', cambio);
  }, []);
  return sin;
}

function variablesDe(tipo: TipoBoton, tamano: TamanoBoton): CSSProperties {
  const t = TEMA_BOTON;
  const c: ColoresBoton = t.tipos[tipo];
  const d: ColoresBoton = t.deshabilitado;
  const clase = CLASE_LIBRERIA[tipo];
  return {
    ['--electrum-alto' as string]: `${t.alto[tamano]}px`,
    ['--electrum-velocidad' as string]: `${t.duracionMs / 1000}s`,
    ['--electrum-foco' as string]: t.foco,
    ['--button-default-font-size' as string]: `${t.letra[tamano]}px`,
    ['--button-horizontal-padding' as string]: `${t.relleno[tamano]}px`,
    ['--button-default-border-radius' as string]: `${t.radio}px`,
    ['--button-raise-level' as string]: tipo === 'link' ? '0px' : `${t.relieve}px`,
    ['--button-font-family' as string]: t.fuente,
    ['--button-font-weight' as string]: String(t.pesoLetra),
    ['--button-letter-spacing' as string]: `${t.espaciadoLetra}px`,
    ['--button-shadow-color' as string]: tipo === 'link' ? 'transparent' : t.sombra,
    [`--button-${clase}-color` as string]: c.fondo,
    [`--button-${clase}-color-hover` as string]: c.fondoHover,
    [`--button-${clase}-color-active` as string]: c.fondoActivo,
    [`--button-${clase}-color-dark` as string]: c.profundidad,
    [`--button-${clase}-color-light` as string]: c.texto,
    [`--button-${clase}-border` as string]: c.borde,
    ['--button-disabled-color' as string]: d.fondo,
    ['--button-disabled-color-hover' as string]: d.fondoHover,
    ['--button-disabled-color-active' as string]: d.fondoActivo,
    ['--button-disabled-color-dark' as string]: d.profundidad,
    ['--button-disabled-color-light' as string]: d.texto,
    ['--button-disabled-border' as string]: d.borde,
  };
}

export function BotonAnimado({
  texto,
  tipo = 'primary',
  tamano = 'md',
  disabled = false,
  loading = false,
  onPress,
  etiqueta,
  icono,
  completo = false,
  enviar = false,
  className,
}: BotonAnimadoProps) {
  const sinMovimiento = useSinMovimiento();
  const bloqueado = disabled || loading;

  // La última versión de lo que hay que hacer, para que el elemento (creado una sola vez) no quede viejo.
  const ultimoDisparo = useRef(0);
  const estado = useRef({ bloqueado, onPress, enviar });
  estado.current = { bloqueado, onPress, enviar };

  const disparar = () => {
    const { bloqueado: b, onPress: accion, enviar: esEnvio } = estado.current;
    if (b || esEnvio) return;
    ultimoDisparo.current = Date.now();
    accion?.();
  };

  // El <button> de la librería, con un `click` que cubre teclado y ratón en equipos táctiles.
  const Elemento = useMemo(
    () =>
      forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement>>(function ElementoBoton(props, ref) {
        const { onClick, ...resto } = props;
        return (
          <button
            ref={ref}
            {...resto}
            onClick={(e) => {
              onClick?.(e);
              if (estado.current.bloqueado) {
                e.preventDefault(); // un envío ocupado tampoco manda el formulario
                return;
              }
              if (Date.now() - ultimoDisparo.current > VENTANA_DOBLE_DISPARO) disparar();
            }}
          />
        );
      }),
    [] // eslint-disable-line react-hooks/exhaustive-deps -- lee todo de refs a propósito
  );

  return (
    <AwesomeButton
      element={Elemento as never}
      type={tipo}
      disabled={disabled}
      ripple={!sinMovimiento}
      onPress={disparar}
      className={['electrum-btn', completo && 'electrum-btn--completo', className].filter(Boolean).join(' ')}
      style={variablesDe(tipo, tamano)}
      containerProps={{
        type: enviar ? 'submit' : 'button',
        'aria-label': etiqueta,
        'aria-disabled': bloqueado || undefined,
        'aria-busy': loading || undefined,
      }}
    >
      <span className="electrum-btn__contenido">
        {loading ? <span className="electrum-btn__giro" aria-hidden="true" /> : icono}
        <span>{texto}</span>
      </span>
    </AwesomeButton>
  );
}

export default BotonAnimado;
