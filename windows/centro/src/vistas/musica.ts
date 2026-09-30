import { h, tarjeta } from '../ui';
export function vistaMusica(): HTMLElement {
  return h('div', { class: 'vista' }, h('div', { class: 'cabeza' }, h('h1', null, 'musica')), tarjeta(null, h('p', { class: 'tenue' }, '…')));
}
