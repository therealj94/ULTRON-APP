import { h, tarjeta } from '../ui';
export function vistaCartera(): HTMLElement {
  return h('div', { class: 'vista' }, h('div', { class: 'cabeza' }, h('h1', null, 'cartera')), tarjeta(null, h('p', { class: 'tenue' }, '…')));
}
