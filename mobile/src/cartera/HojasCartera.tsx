/**
 * LAS HOJAS DE LA CARTERA EN TODA LA APP (Cartera y Enviar dinero). Se montan una vez en la raíz (AppAura,
 * con la sesión abierta) y además:
 *
 *   · retoman un pago a medias (Android cerró AU-RA mientras la persona firmaba en Veta Wallet);
 *   · al volver a AU-RA desde la wallet, le dicen al vigía que mire la cadena YA;
 *   · atienden lo que AURA pide por voz (las manos de lib/manos-app.ts):
 *       {"tipo":"cartera"}                                   → abre la hoja Cartera
 *       {"tipo":"pagar","con":"Ana","monto":"5","moneda":"ORIGEN"} → abre el chat con Ana y la hoja de enviar,
 *                                                             llenada, para que la persona revise, confirme
 *                                                             y firme en Veta Wallet. AURA nunca paga sola.
 */
import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { tr } from '../i18n';
import { emitir, escuchar, type AccionApp } from '../nucleo/contrato';
import { resolverContacto } from '../pulse/relevo';
import { abrirConversacion } from '../app/rutas';
import { HojaCartera as HojaCarteraVista } from './HojaCartera';
import { HojaPagar } from './HojaPagar';
import { abrirCartera, abrirPagar, anunciarHojasCartera, cerrarHojaCartera, retomarPago, useHojaCartera, vigia, type HojaCartera } from './estado';
import { montoValido, simbolo } from './logica';

/** Lo que AURA pide por voz para la cartera. Devuelve si la atendió (las demás acciones no son de aquí). */
export function atenderAccionCartera(a: AccionApp): boolean {
  if (a.tipo === 'cartera') {
    abrirCartera();
    emitir('hecho', { accion: a, ok: true });
    return true;
  }
  if (a.tipo === 'pagar') {
    const c = resolverContacto(a.con);
    const correo = c?.correo || (/^[^@\s]+@[^@\s]+$/.test(a.con.trim()) ? a.con.trim().toLowerCase() : '');
    if (!correo) {
      emitir('hecho', { accion: a, ok: false, detalle: tr(`No encuentro a «${a.con}» entre tus contactos de PULSE2CHAT.`, `I can’t find “${a.con}” among your PULSE2CHAT contacts.`) });
      return true;
    }
    const nombre = c?.nombre || correo.split('@')[0];
    // El hilo de esa persona debajo: ahí queda el comprobante cuando la cadena confirme el envío.
    abrirConversacion(correo, nombre);
    abrirPagar({ correo, nombre, monto: montoValido(a.monto) || undefined, moneda: simbolo(a.moneda) || undefined, deVoz: true });
    emitir('hecho', { accion: a, ok: true });
    return true;
  }
  return false;
}

export function HojasCartera() {
  const hoja = useHojaCartera();

  useEffect(() => anunciarHojasCartera(), []);
  useEffect(() => {
    void retomarPago();
    const sub = AppState.addEventListener('change', (st) => {
      if (st === 'active') vigia.alVolver();
    });
    return () => sub.remove();
  }, []);
  useEffect(
    () =>
      escuchar('accion', (a) => {
        atenderAccionCartera(a);
      }),
    [],
  );

  // La última hoja de enviar se recuerda: al cerrarse baja con su contenido, no vacía.
  const ultimaPagar = useRef<Extract<HojaCartera, { tipo: 'pagar' }> | null>(null);
  if (hoja?.tipo === 'pagar') ultimaPagar.current = hoja;
  const pg = ultimaPagar.current;

  return (
    <>
      <HojaCarteraVista visible={hoja?.tipo === 'cartera'} onCerrar={cerrarHojaCartera} />
      <HojaPagar
        visible={hoja?.tipo === 'pagar'}
        onCerrar={cerrarHojaCartera}
        correo={pg?.correo || ''}
        nombre={pg?.nombre || ''}
        monto={pg?.monto}
        moneda={pg?.moneda}
        deVoz={pg?.deVoz}
      />
    </>
  );
}
