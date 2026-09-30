import { h, tarjeta } from '../ui';
export function vistaChat(): HTMLElement {
  return h('div', { class: 'vista' }, h('div', { class: 'cabeza' }, h('h1', null, 'chat')), tarjeta(null, h('p', { class: 'tenue' }, '…')));
}
