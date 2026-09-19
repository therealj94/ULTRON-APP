/** Clips remotos v3 (Render /voz). El banco viejo de otra voz se retiró. */

export function bankKey(t: string): string {
  return String(t)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9ñ]+/g, '');
}

export const REMOTE_CLIPS: Record<string, string> = {
  buenosdiasjoseestoylistoenqueteayudo: '/voz/dias.mp3',
  buenastardesjoseestoylistoenqueteayudo: '/voz/tardes.mp3',
  buenasnochesjoseestoylistoenqueteayudo: '/voz/noches.mp3',
  buenosdiasjoseaquienqueteayudo: '/voz/dias.mp3',
  buenastardesjoseaquienqueteayudo: '/voz/tardes.mp3',
  buenasnochesjoseaquienqueteayudo: '/voz/noches.mp3',
  dejamever: '/voz/espera.mp3',
  jeje: '/voz/je.mp3',
  entendido: '/voz/entendido.mp3',
  valejefe: '/voz/vale.mp3',
  uy: '/voz/uy.mp3',
  aqui: '/voz/aqui.mp3',
  hola: '/voz/hola.mp3',
  listo: '/voz/listo_corto.mp3',
  foto: '/voz/foto.mp3',
  salud: '/voz/salud.mp3',
  blaster: '/voz/blaster.mp3',
  teescucho: '/voz/te_escucho.mp3',
  microfonoactivadoteescucho: '/voz/mic_on.mp3',
  quedoengenesiscorelaproximapreguntayalousa: '/voz/genesis_ok.mp3',
  loactualizoenelcerebrogenesiscore: '/voz/genesis_preg.mp3',
  decimeelhechoydespuesactualizaelcerebro: '/voz/genesis_pide.mp3',
  ultronesprivadoentracontusesiondejunta: '/voz/privado.mp3',
  noalcanzoalcerebroremotoesossiconsta: '/voz/sin_cerebro.mp3',
  gafaspuestas: '/voz/gafas_on.mp3',
  gafasguardadas: '/voz/gafas_off.mp3',
  sablelisto: '/voz/sable.mp3',
  voy: '/voz/voy.mp3',
  unsegundo: '/voz/un_segundo.mp3',
  aver: '/voz/a_ver.mp3',
  calentandoelmotor: '/voz/calenta.mp3',
  estamoslistos: '/voz/listos.mp3',
  enqueteayudo: '/voz/en_que.mp3',
  dime: '/voz/dime.mp3',
  seguimos: '/voz/seguimos.mp3',
  loguardoenelcerebro: '/voz/lo_guardo.mp3',
  confirmas: '/voz/confirmas.mp3',
  sinautorizacionexpresadelajuntanopuedodespachar: '/voz/despacho_no.mp3',
  autorizadoporeldirectoriodespachoejecutado: '/voz/despacho_ok.mp3',
  enlaceconcerebroexteriorestablecido: '/voz/enlace.mp3',
  enojado: '/voz/enojado.mp3',
  furia: '/voz/furia.mp3',
  feliz: '/voz/feliz.mp3',
  preocupado: '/voz/preocupado.mp3',
  curioso: '/voz/curioso.mp3',
  guino: '/voz/guino.mp3',
  asi: '/voz/asi.mp3',
  susto: '/voz/susto.mp3',
  pensando: '/voz/pensando.mp3',
};

export const VOICE_BANK: Record<string, never> = {};
