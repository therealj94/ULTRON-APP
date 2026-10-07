/**
 * La hoja «Cartera» (se abre desde la voz, Ajustes o el menú): el mismo cuerpo que la pestaña Veta Wallet
 * de los chats (CuerpoCartera.tsx), dentro de una hoja.
 */
import { tr } from '../i18n';
import { Hoja } from '../ui';
import { CuerpoCartera } from './CuerpoCartera';

type Props = { visible: boolean; onCerrar: () => void };

export function HojaCartera({ visible, onCerrar }: Props) {
  return (
    <Hoja
      visible={visible}
      onCerrar={onCerrar}
      titulo={tr('Cartera', 'Wallet')}
      subtitulo={tr('Tus saldos de Veta Wallet, leídos de la red de Orden Global. Pagos: se firman en Veta Wallet. Tarjeta: AU-RA puede mostrar sus datos y recargarla con tu contraseña.', 'Your Veta Wallet balances, read from the Orden Global network. Payments: signed in Veta Wallet. Card: AU-RA can show its details and top it up with your password.')}
    >
      <CuerpoCartera activo={visible} />
    </Hoja>
  );
}
