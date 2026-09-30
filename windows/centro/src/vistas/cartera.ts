/** La cartera de Veta Wallet: solo lectura (saldos de la cadena de Orden Global). Nunca mueve dinero. */
import { h, boton, tarjeta, avisar, botonIcono } from '../ui';
import { pedir } from '../puente';
import { T } from '../estado';

const dinero = (n: number | null) => n == null ? '—' : n.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: n < 1 ? 4 : 2 });
const cantidad = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: n < 1 ? 6 : 4 });

export function vistaCartera(): HTMLElement {
  const cuerpo = h('div', null, h('span', { class: 'cargando' }));
  const vista = h('div', { class: 'vista' },
    h('div', { class: 'cabeza' },
      h('div', null, h('h1', null, T('Cartera', 'Wallet')), h('p', null, T('Tus saldos de Veta Wallet, leídos de la red de Orden Global. Solo lectura: AURA nunca mueve tu dinero.', 'Your Veta Wallet balances, read from the Orden Global network. Read-only.'))),
      h('div', { class: 'acciones' },
        botonIcono('actualizar', T('Actualizar saldos', 'Refresh balances'), () => cargar(true)),
        boton(T('Abrir Veta Wallet', 'Open Veta Wallet'), () => pedir('cartera.abrirWallet'), { icono: 'enlace', titulo: T('Para enviar o recibir, se hace en Veta Wallet con tu contraseña.', 'Send or receive in Veta Wallet.') }))),
    cuerpo);

  function formularioDireccion(actual = '') {
    const input = h('input', { type: 'text', value: actual, placeholder: '0x…', spellcheck: 'false', 'aria-label': T('Dirección de Veta Wallet', 'Veta Wallet address') }) as HTMLInputElement;
    return tarjeta(T('Tu dirección', 'Your address'),
      h('p', { class: 'nota' }, T('En Veta Wallet: Recibir → Copiar dirección. Es pública (como un número de cuenta para recibir): con ella solo se pueden VER saldos.', 'In Veta Wallet: Receive → Copy address. It’s public: it only lets AURA READ balances.')),
      h('div', { class: 'fila' }, input, boton(T('Guardar', 'Save'), async () => {
        try { await pedir('cartera.direccion', { direccion: input.value }); avisar(T('Listo, ya veo tu cartera.', 'Done.'), 'ok'); cargar(true); }
        catch (e: any) { avisar(e.message, 'mal', 7000); }
      }, { tipo: 'acento' })));
  }

  async function cargar(forzar = false) {
    try {
      const c = await pedir<any>('cartera.saldos', { forzar });
      if (!c?.direccion) { cuerpo.replaceChildren(formularioDireccion()); return; }
      const saldos = (c.saldos as any[]);
      const conSaldo = saldos.filter((s) => s.cantidad > 0);
      const sinSaldo = saldos.filter((s) => s.cantidad <= 0);
      const fila = (s: any) => h('div', { class: 'item', style: 'cursor:default' },
        h('span', { class: 'foto', style: 'background:var(--acento-suave);color:var(--acento);font-size:11px' }, s.simbolo.slice(0, 4)),
        h('div', { style: 'flex:1' }, h('strong', null, s.simbolo), h('br'), h('small', { class: 'tenue' }, s.precio == null ? T('sin precio de mercado', 'no market price') : dinero(s.precio) + ' ' + T('c/u', 'each'))),
        h('div', { style: 'text-align:right' }, h('strong', null, cantidad(s.cantidad)), h('br'), h('small', { class: 'tenue' }, dinero(s.usd))));
      cuerpo.replaceChildren(
        tarjeta(null, h('small', { class: 'tenue' }, T('Valor aproximado', 'Approximate value')), h('div', { class: 'cifra', style: 'margin:6px 0' }, dinero(c.total)),
          h('small', { class: 'tenue' }, `${c.direccion.slice(0, 8)}…${c.direccion.slice(-6)} · ${T('actualizado', 'updated')} ${c.actualizado}`),
          h('p', { class: 'nota' }, T('Precio de ORIGEN = oro por gramo ÷ 55 (1 ORIGEN = 1/55 g de oro en bóveda). AUKA sigue la onza de oro y AGKA la de plata.', 'ORIGEN price = gold per gram ÷ 55.'))),
        tarjeta(T('Tus monedas', 'Your coins'), h('div', { class: 'lista' }, ...(conSaldo.length ? conSaldo.map(fila) : [h('p', { class: 'tenue' }, T('Todavía no tienes saldo en esta dirección.', 'No balance yet.'))]))),
        ...(sinSaldo.length ? [h('details', { class: 'tarjeta' }, h('summary', { class: 'tenue', style: 'cursor:pointer' }, T(`Otras ${sinSaldo.length} monedas de la red (en cero)`, `${sinSaldo.length} other coins (zero)`)), h('div', { class: 'lista' }, ...sinSaldo.map(fila)))] : []),
        formularioDireccion(c.direccion));
    } catch (e: any) { cuerpo.replaceChildren(tarjeta(null, h('p', null, e.message), boton(T('Reintentar', 'Retry'), () => cargar(true)))); }
  }
  cargar();
  return vista;
}
