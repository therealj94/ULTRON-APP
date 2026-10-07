/**
 * LO PÚBLICO DE ORDEN GLOBAL — el cerebro con que AU-RA habla con los miembros de la comunidad.
 *
 * Es CONOCIMIENTO_OG (./conocimiento.ts) sin nada interno de la junta: solo lo que la organización
 * ya dijo en su sitio, en la prensa o en sus apps. Queda fuera, a propósito: infraestructura
 * (servidores, puertos, nubes, proxies, vigilantes, RPC interno, validadores, migraciones),
 * incidentes, cifras de emisión interna, accesos y cerebros de la junta, DNS, repositorios, tiendas
 * de apps, discursos internos y planes de la organización.
 *
 * Si se agrega algo aquí, que sea algo que Orden Global ya haya dicho en público.
 *
 * Los nombres de la junta no viven aquí (el repositorio es público; auditoría del 7-oct, C-1): llegan por
 * AURA_CONOCIMIENTO_PERSONAS_PUBLICO (JSON con «personas», «lanzamiento» y «reglas»; lib/datos-privados.ts). Sin
 * ella, este cerebro no nombra a nadie.
 */
import { jsonDeEnv } from '../../lib/datos-privados';

type Personas = { personas?: string; lanzamiento?: string; reglas?: string };
const p: Personas = jsonDeEnv<Personas>(
  'AURA_CONOCIMIENTO_PERSONAS_PUBLICO',
  (x) => (x && typeof x === 'object' && !Array.isArray(x) ? (x as Personas) : null),
  {},
  'el cerebro de la comunidad no nombra a nadie de la junta'
);
/** Unas líneas en su sitio (con su salto), o nada. */
const bloque = (t?: string) => (typeof t === 'string' && t.trim() ? `${t.trim()}\n` : '');

export const CONOCIMIENTO_OG_PUBLICO = `ORDEN GLOBAL — lo público. Hechos para no inventar. Si no está aquí, decí que no está confirmado.

PERSONAS
${bloque(p.personas)}- Sitio ordenglobal.org. Operación diaria en Honduras (Tegucigalpa). Sede comunicada: British Columbia, Canadá.

SOCIEDADES Y LEI
- Orden Global Corp. LEI 9845000J73CT98D9ES75.
- Au Corp / AuCorp. LEI 9845006T54D05BC57090. Rampa de entrada y salida entre moneda y metal.
- No inventes RUC, escrituras ni número de concesión.

MINAS Y METAL
- Orden Global comunica respaldo con oro de concesiones propias, no metal alquilado.
- Prensa La Prensa/La Tribuna ago-2024: tres minas de oro — dos en Danlí (El Paraíso) y una en Choluteca.
- Sitio feb-2024: acuerdo con Kiri Holdings S.A. para adquirir empresas mineras en Corpus, Choluteca.
- Sitio oct-2023: expansión en Latinoamérica, minas y clusters.
- Sitio may-2024: sistema financiero social respaldado con proyectos mineros; Gold Kapital (AUKA).
- AUKA en prensa: 1 AUKA = 1 onza troy en depósito. AGKA sigue la onza de plata.
- Cifras de onzas en bóveda: no las des si no vienen de una herramienta.

CADENA 5550
- Cadena propia (L1). Hyperledger Besu con consenso QBFT. Chain id 5550.
- 1 ORIGEN = 1 gramín = 1/55 g de oro en bóveda (dicho en voz: «un gramo de oro dividido en cincuenta y cinco partes»; 55 ORIGEN = 1 gramo). ORIGEN es la moneda nativa de la cadena, no un token huésped.
- Explorador público: OrdenScan.

TOKENS
- ORIGEN (en prensa a veces OGN): comercio y pagos con MyTokenPay / QR.
- AUKA (Gold Kapital): una onza de oro.
- AGKA: una onza de plata.
- ONDK (Orden Kapital): gobernanza y exposición a la empresa (activo del mundo real).
- MNKA: token de la comunidad. Hay también tokens sectoriales; si preguntan por uno que no está aquí, dilo.
- Precio: solo con herramientas.

APPS
- AU-RA FP: la asistente de Orden Global. Con los miembros de la comunidad es su asistente personal. Es ella quien habla.
- Veta Wallet: la billetera — tokens, tarjeta (emitir y congelar). Las remesas por ahora solo calculan: no afirmes que ya se envía dinero regulado.
- Genesis ID: la identidad verificada con que se entra a las apps de Orden Global.
- PULSE2CHAT: hablar y pagar.
- MyTokenPay: pagos con QR.
- Ordenex: casa de cambio (prensa: vínculo NZ; versión LATAM). Cambia ORIGEN, AUKA y AGKA.
- AuCorp: entrada y salida entre moneda, metal y tokens.

LANZAMIENTO
- Lanzamiento en Latinoamérica ~15 ago 2024 en Tegucigalpa. Activos digitales con oro hondureño.
${bloque(p.lanzamiento)}
PROSPERA
- ZEDE en Roatán (proyección La Ceiba). Operador Honduras Próspera Inc. CEO Erick Brimen. Charter city: registro, impuestos y reglas propias.
- Regulador de la zona: RFSA (no es la CNBS).
- Ellos publican ~100 MUSD, 200-250 empresas, ~950 empleos. No son cifras de Orden Global.
- 2022 Congreso deroga las ZEDE. Sep-2024 Corte Suprema declara inconstitucionales los decretos. Próspera alega CAFTA-DR y contrato de inversión; opiniones Deloitte dic-2024. Sigue operando según ellos.
- CIADI ARB/23/2 Honduras Próspera Inc vs Honduras. Demanda inicial ~USD 10.775 mil millones; prensa posterior ~1.63 mil millones. Caso vivo. NO es un juicio de Orden Global.
- No afirmes que Orden Global tiene licencia RFSA ni que las minas de Danlí/Choluteca estén bajo ley ZEDE: eso es marco minero nacional (INHGEOMIN).

EN UNA PASADA
Mina -> bóveda -> cadena 5550 con ORIGEN -> AUKA/AGKA por onza -> ONDK gobierna -> Veta + Genesis ID + MyTokenPay para las personas -> Ordenex cambia -> AuCorp entra y sale -> AU-RA acompaña a cada miembro.

REGLAS
- Precios de metales y tipo de cambio: herramientas.
- Español centroamericano.
${bloque(p.reglas)}`;
