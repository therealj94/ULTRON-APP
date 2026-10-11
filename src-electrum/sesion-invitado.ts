/**
 * ¿Quien usa la pantalla entró con un código temporal? Lo dice el servidor (/api/ultron/sesion →
 * `invitado`) y App.tsx lo fija aquí; los componentes que ofrecen llevarse un archivo lo miran para
 * mostrarlo en el visor en lugar de bajarlo. El servidor decide de verdad (esInvitado): esto es para
 * que la pantalla no ofrezca lo que no corresponde.
 */
let invitado = false;

export function fijarInvitado(v: boolean) {
  invitado = v;
}

export function esInvitadoAhora(): boolean {
  return invitado;
}

/** El aviso que se muestra en la entrada después de cerrar por vencimiento (sobrevive a recargar). */
export const AVISO_ENTRADA = 'electrum:aviso-entrada';
