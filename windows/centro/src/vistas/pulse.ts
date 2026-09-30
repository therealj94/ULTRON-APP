/** PULSE2CHAT en el Centro. (Lo arma el módulo src/pulse/: chats, hilo, llamadas y videollamadas.) */
import { h, tarjeta } from '../ui';

export function vistaPulse(): HTMLElement {
  return h('div', { class: 'vista' },
    h('div', { class: 'cabeza' }, h('div', null, h('h1', null, 'PULSE2CHAT'), h('p', null, 'Tus chats, llamadas y videollamadas, cifrados de punta a punta.'))),
    tarjeta(null, h('p', { class: 'tenue' }, 'Preparando PULSE2CHAT…')));
}
