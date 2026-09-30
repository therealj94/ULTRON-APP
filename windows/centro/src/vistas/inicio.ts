import { h, tarjeta } from '../ui';
export function vistaInicio(): HTMLElement {
  return h('div', { class: 'vista' }, h('div', { class: 'cabeza' }, h('h1', null, 'inicio')), tarjeta(null, h('p', { class: 'tenue' }, '…')));
}
