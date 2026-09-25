/**
 * Qué app es esta.
 *
 * Un binario, dos aplicaciones. La variante se fija al construir (`ULTRON_APP=electrum`) y llega
 * por `extra` del manifiesto, así que en tiempo de ejecución es un dato, no una suposición.
 *
 * Por qué importa que esté en un archivo y no esparcido: el día que alguien lea el acento o la URL
 * «a mano» en una pantalla, las dos apps empiezan a divergir por donde nadie mira.
 */
import Constants from 'expo-constants';

export type Variante = 'ultron' | 'electrum';

const extra = (Constants.expoConfig?.extra || {}) as { variante?: string; acento?: string; ultronUrl?: string };

export const VARIANTE: Variante = extra.variante === 'electrum' ? 'electrum' : 'ultron';
export const ES_ELECTRUM = VARIANTE === 'electrum';

/** Acento de la plataforma. Dorado del anillo para AU-RA, ámbar de mineral para la mina. */
export const ACENTO = ES_ELECTRUM ? extra.acento || '#FFAE3B' : '#D6B56C';

export const MARCA = ES_ELECTRUM ? 'DR ELECTRUM FP' : 'AU-RA FP';
export const LEMA = ES_ELECTRUM ? 'ESTACIÓN DE TRABAJO MINERA' : 'POWERED BY ORDEN GLOBAL';
