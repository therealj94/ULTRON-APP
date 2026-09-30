import { h, tarjeta } from '../ui';
export function vistaAjustes(): HTMLElement {
  return h('div', { class: 'vista' }, h('div', { class: 'cabeza' }, h('h1', null, 'ajustes')), tarjeta(null, h('p', { class: 'tenue' }, '…')));
}
