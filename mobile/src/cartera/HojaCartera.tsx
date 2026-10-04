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
      subtitulo={tr('Tus saldos de Veta Wallet, leídos de la red de Orden Global. Solo lectura: AURA nunca mueve tu dinero.', 'Your Veta Wallet balances, read from the Orden Global network. Read-only: AURA never moves your money.')}
    >
      <CuerpoCartera activo={visible} />
    </Hoja>
  );
}
