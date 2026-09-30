/** Lo que recibe cada paso de la primera vez. */
import type { Perfil } from '../../nucleo/contrato';
import type { Borrador } from '../flujo';

export type PropsPaso = {
  perfil: Perfil | null;
  borrador: Borrador;
  cambiar: (c: Partial<Borrador>) => void;
  /** Avanza al paso siguiente (p. ej. al elegir con doble toque o al terminar de escribir). */
  avanzar: () => void;
  horizontal: boolean;
};
