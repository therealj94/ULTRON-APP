/**
 * BOTÓN ANIMADO (app): @rcaferati/react-native-awesome-button con el tema de Dr Electrum.
 *
 * Misma API que la web (src-electrum/ui/BotonAnimado.tsx): texto, tipo, tamano, disabled, loading,
 * onPress, etiqueta, icono, completo. Diferencias con la web:
 *  · No hay ripple: en el teléfono el efecto es la cara que se hunde sobre su canto, más una
 *    vibración suave. `enviar` no existe (no hay formularios).
 *  · La fuente es la del sistema: IBM Plex Mono no está cargada en la app.
 *  · «Reducir movimiento» lo respeta la propia librería (useReducedMotion).
 */
import type { ReactNode } from 'react';
import { ActivityIndicator } from 'react-native';
import AwesomeButton, { type AwesomeButtonStyle } from '@rcaferati/react-native-awesome-button';
import * as Haptics from 'expo-haptics';
import { TEMA_BOTON, type ColoresBoton, type TamanoBoton, type TipoBoton } from './temaBoton';

export type BotonAnimadoProps = {
  texto: string;
  tipo?: TipoBoton;
  tamano?: TamanoBoton;
  disabled?: boolean;
  /** Muestra un giro, anuncia «ocupado» y no acepta más toques. */
  loading?: boolean;
  onPress?: () => void;
  /** Nombre para lectores de pantalla cuando el texto no basta. */
  etiqueta?: string;
  icono?: ReactNode;
  /** Ocupa todo el ancho disponible. */
  completo?: boolean;
};

/** «1px solid rgba(…)» del tema web → ancho y color de borde nativos. */
function borde(c: ColoresBoton): { borderWidth: number; borderColor: string } {
  const m = /^(\d+(?:\.\d+)?)px\s+solid\s+(.+)$/.exec(c.borde);
  return m ? { borderWidth: Number(m[1]), borderColor: m[2] } : { borderWidth: 0, borderColor: 'transparent' };
}

function estiloDe(tipo: TipoBoton, tamano: TamanoBoton, loading: boolean): AwesomeButtonStyle {
  const t = TEMA_BOTON;
  const c = t.tipos[tipo];
  // Cargando: bloqueado pero con sus colores, no con los de deshabilitado.
  const d = loading ? c : t.deshabilitado;
  const plano = tipo === 'link';
  return {
    backgroundColor: c.fondo,
    backgroundActive: c.fondoActivo,
    depthColor: c.profundidad,
    shadowColor: plano ? 'transparent' : t.sombra,
    foregroundColor: c.texto,
    activityColor: c.texto,
    disabledBackgroundColor: d.fondo,
    disabledDepthColor: d.profundidad,
    disabledShadowColor: plano ? 'transparent' : t.sombra,
    disabledForegroundColor: d.texto,
    disabledBorderColor: borde(d).borderColor,
    ...borde(c),
    borderRadius: t.radio,
    raiseAmount: plano ? 0 : t.relieve,
    textSize: t.letra[tamano],
    paddingHorizontal: t.relleno[tamano],
    animationDuration: t.duracionMs,
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
}: BotonAnimadoProps) {
  const bloqueado = disabled || loading;
  return (
    <AwesomeButton
      buttonStyle={estiloDe(tipo, tamano, loading)}
      // En el teléfono ningún botón baja de 44 de alto.
      faceHeight={Math.max(44, TEMA_BOTON.alto[tamano])}
      stretch={completo}
      width={completo ? null : 'auto'}
      disabled={bloqueado}
      onPress={() => onPress?.()}
      onPressedIn={() => void Haptics.selectionAsync().catch(() => {})}
      accessibilityLabel={etiqueta || texto}
      dangerouslySetPressableProps={{ accessibilityState: { disabled: bloqueado, busy: loading } }}
      before={loading ? <ActivityIndicator color={TEMA_BOTON.tipos[tipo].texto} /> : icono}
    >
      {texto}
    </AwesomeButton>
  );
}

export default BotonAnimado;
