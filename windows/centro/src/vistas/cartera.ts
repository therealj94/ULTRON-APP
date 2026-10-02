/** La cartera de Veta Wallet: solo lectura (saldos de la cadena de Orden Global). Nunca mueve dinero. */
import { h, boton, tarjeta, avisar, botonIcono } from '../ui';
import { pedir } from '../puente';
import { T } from '../estado';
import { autoConectarCartera } from '../pulse/pagar';
import * as RELEVO from '../pulse/relevo';

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

  let vigia: number | undefined;
  const guardarDireccion = async (d: string) => {
    try { await pedir('cartera.direccion', { direccion: d }); avisar(T('Listo, ya veo tu cartera.', 'Done, I can see your wallet.'), 'ok'); cargar(true); }
    catch (e: any) { avisar(e.message, 'mal', 7000); }
  };

  function formularioDireccion(actual = '') {
    const input = h('input', { type: 'text', value: actual, placeholder: '0x…', spellcheck: 'false', 'aria-label': T('Dirección de Veta Wallet', 'Veta Wallet address') }) as HTMLInputElement;
    const paso = (n: string, t: string) => h('li', null, h('span', { class: 'mono', style: 'color:var(--oro-crudo);margin-right:10px' }, n), t);
    const tarj = tarjeta(T('Conecta tu cartera en 2 pasos', 'Connect your wallet in 2 steps'),
      h('ol', { class: 'nota', style: 'line-height:1.9;list-style:none;padding:0;margin:0 0 10px' },
        paso('01', RELEVO.quien()
        ? T('Tu cuenta de PULSE2CHAT todavía no muestra tu dirección: abre Veta Wallet (arriba) y entra una vez con tu cuenta.', 'Your PULSE2CHAT account doesn’t show your address yet: open Veta Wallet and sign in once.')
        : T('Conecta PULSE2CHAT (en su sección) y tu cartera aparece sola. O toca «Abrir Veta Wallet» (arriba) y entra como siempre.', 'Connect PULSE2CHAT and your wallet appears by itself. Or tap “Open Veta Wallet” and sign in.')),
        paso('02', T('Ve a Recibir → Copiar dirección. AURA la detecta sola en cuanto la copies; no tienes que pegar nada.', 'Go to Receive → Copy address. AURA picks it up automatically.'))),
      h('p', { class: 'nota' }, T('La dirección es pública (como un número de cuenta para recibir): con ella AURA solo puede VER saldos, nunca mover dinero.', 'The address is public: AURA can only READ balances.')),
      h('div', { class: 'fila' }, input, boton(T('Guardar', 'Save'), () => guardarDireccion(input.value), { tipo: 'acento' })));
    // Mientras falta la dirección, se mira lo copiado cada poco: al copiarla en la wallet, queda puesta sola.
    if (!actual) {
      window.clearInterval(vigia);
      vigia = window.setInterval(async () => {
        if (!tarj.isConnected) { window.clearInterval(vigia); return; }
        const d = await pedir<string>('cartera.portapapeles').catch(() => '');
        if (d) { window.clearInterval(vigia); input.value = d; await guardarDireccion(d); }
      }, 1500);
    }
    return tarj;
  }

  async function cargar(forzar = false) {
    try {
      const c = await pedir<any>('cartera.saldos', { forzar });
      if (!c?.direccion) {
        // Con PULSE2CHAT conectado, la dirección sale sola de tu ficha (la misma cuenta de Veta Wallet).
        if (RELEVO.quien()) {
          cuerpo.replaceChildren(tarjeta(null, h('span', { class: 'cargando' }), h('p', { class: 'tenue' }, T('Conectando tu cartera con tu cuenta de PULSE2CHAT…', 'Connecting your wallet from your PULSE2CHAT account…'))));
          if (await autoConectarCartera()) { avisar(T('Listo, ya veo tu cartera.', 'Done, I can see your wallet.'), 'ok'); return cargar(true); }
        }
        cuerpo.replaceChildren(formularioDireccion());
        return;
      }
      const saldos = (c.saldos as any[]);
      const conSaldo = saldos.filter((s) => s.cantidad > 0);
      const sinSaldo = saldos.filter((s) => s.cantidad <= 0);
      // El libro de saldos: el símbolo estampado en su sello, y las cifras en Mono, alineadas a la derecha.
      const libro = (filas: any[]) => h('table', { class: 'libro' },
        h('thead', null, h('tr', null, h('th', null, T('Moneda', 'Coin')), h('th', { class: 'num' }, T('Precio c/u', 'Unit price')), h('th', { class: 'num' }, T('Cantidad', 'Amount')), h('th', { class: 'num' }, 'USD'))),
        h('tbody', null, ...filas.map((s) => h('tr', null,
          h('td', null, h('span', { class: 'sello', title: s.simbolo }, String(s.simbolo).slice(0, 6))),
          h('td', { class: 'num tenue' }, s.precio == null ? T('sin precio', 'no price') : dinero(s.precio)),
          h('td', { class: 'num' }, cantidad(s.cantidad)),
          h('td', { class: 'num' }, dinero(s.usd))))));
      cuerpo.replaceChildren(
        h('section', { class: 'tarjeta cartera-total' }, h('span', { class: 'antetitulo' }, T('Valor aproximado', 'Approximate value')), h('div', { class: 'cifra' }, dinero(c.total), h('span', { class: 'moneda' }, 'USD')),
          h('small', { class: 'direccion' }, `${c.direccion.slice(0, 8)}…${c.direccion.slice(-6)}`, c.actualizado ? ` · ${T('actualizado', 'updated')} ${c.actualizado}` : ''),
          h('p', { class: 'nota' }, T('Precio de ORIGEN = oro por gramo ÷ 55 (1 ORIGEN = 1/55 g de oro en bóveda). AUKA sigue la onza de oro y AGKA la de plata.', 'ORIGEN price = gold per gram ÷ 55.'))),
        tarjeta(T('Tus monedas', 'Your coins'), conSaldo.length ? libro(conSaldo) : h('p', { class: 'tenue' }, T('Todavía no tienes saldo en esta dirección.', 'No balance yet.'))),
        ...(sinSaldo.length ? [h('details', { class: 'tarjeta' }, h('summary', { class: 'tenue' }, sinSaldo.length === 1 ? T('Otra moneda de la red, en cero', 'One other coin, at zero') : T(`Otras ${sinSaldo.length} monedas de la red, en cero`, `${sinSaldo.length} other coins, at zero`)), h('div', { style: 'margin-top:12px' }, libro(sinSaldo)))] : []),
        formularioDireccion(c.direccion));
    } catch (e: any) { cuerpo.replaceChildren(tarjeta(null, h('p', null, e.message), boton(T('Reintentar', 'Retry'), () => cargar(true)))); }
  }
  cargar();
  return vista;
}
