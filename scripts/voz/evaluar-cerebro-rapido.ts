/**
 * ¿Sirve Nova para la voz de AU-RA? Arma el prompt REAL de un turno hablado de la app (el mismo
 * camino que server.ts prepararTurno: piezasDelTurno compacto + reglas de la app + manos + harness) y le
 * pide a Bedrock una docena de cosas típicas de José. Mide la primera palabra y enseña lo que escribió,
 * para revisar que las acciones (ACCION_APP, PEDIR_HERRAMIENTA) salen con la forma que la app entiende.
 *
 *   npx tsx scripts/voz/evaluar-cerebro-rapido.ts [modelo]
 *
 * Usa las credenciales de AWS del entorno (AWS_PROFILE o AWS_ACCESS_KEY_ID…).
 */
import { piezasDelTurno } from '../../server/prompt-turno';
import { construirMensajes } from '../../lib/qwen';
import { reglasAcciones, estadoAcciones, type ContextoApp } from '../../lib/acciones-app';
import { MANOS } from '../../lib/manos-app';
import { fichaManosPrompt } from '../../lib/manos-ficha';
import { fichaMenuPrompt } from '../../lib/menu-app';
import { lineaAvatar } from '../../server/eleven';
import { esPaso, esSoloConversacion, hablarRapido, SOLO_CONVERSAR_ES } from '../../lib/cerebro-rapido';
import { extraerAcciones } from '../../lib/acciones-app';

const modelo = process.argv[2];
if (modelo) process.env.CEREBRO_VOZ_MODELO = modelo;

const ctx: ContextoApp = {
  pantalla: 'mesa',
  contactos: [
    { nombre: 'Mamá', correo: 'mama@x.hn' },
    { nombre: 'Beto', correo: 'beto@x.hn' },
    { nombre: 'Ana López', correo: 'ana@x.hn' },
  ] as any,
  manos: [...MANOS] as any,
  recordatorios: [],
};

const reglasApp = [fichaManosPrompt('app', 'es'), fichaMenuPrompt('es', { compacto: true, conAbrir: true }), reglasAcciones(ctx)].join('\n');
const piezas = piezasDelTurno({
  nivel: 'junta',
  nombre: 'José',
  canal: 'mesa',
  modo: 'GUARDIAN',
  mando: true,
  quien: 'jose' as any,
  quienMem: 'jose' as any,
  bloqueApp: estadoAcciones(ctx),
  reglasApp,
  lineaAvatar: lineaAvatar('aura', 'es'),
  hechos: [],
  hiloEnMensajes: false,
  compacto: true,
});
const PEDIDOS = [
  '¿Qué hora es en Tokio si aquí son las ocho de la noche?',
  'Cuéntame un chiste corto.',
  '¿Cuál es la capital de Australia?',
  'Ponme un recordatorio en tres minutos para sacar la comida del horno.',
  'Llámame en diez minutos.',
  'Abre mis correos.',
  'Escríbele a Beto que llego tarde.',
  'Mándale un WhatsApp a mi mamá que ya voy.',
  '¿A cómo está el oro hoy?',
  'Busca en internet quién ganó el partido de Olimpia anoche.',
  'Ponlo en modo oscuro.',
  '¿Qué me recomiendas cenar?',
  '¿Cuántos días tiene febrero en un año bisiesto?',
  'Explícame en una frase qué es la inflación.',
  'Oye, ¿tú me entiendes bien cuando hablo rápido?',
  'Necesito que me digas algo motivador para empezar el día.',
  'Hazme el favor de ponerme música de Marco Antonio Solís.',
];

const SOLO = process.env.SOLO_ACCIONES ? PEDIDOS.slice(3) : PEDIDOS;
(async () => {
  for (const pedido of SOLO) {
    const compuesto = construirMensajes({ personalidad: piezas.fijo, user: pedido, canal: 'mesa', historial: [], nivel: 'junta', harness: true, cot: false, whatsapp: true, sesion: true });
    const system = compuesto.messages[0].content;
    const ruteo = !!process.env.RUTEO;
    if (ruteo && !esSoloConversacion(pedido)) {
      console.log(`↪ ${pedido}\n   → Qwen (pide hacer algo)`);
      continue;
    }
    const user = `${piezas.contexto}\n\nHECHOS DE ESTE TURNO:\n(ninguno)\n\nJunta: ${pedido}${ruteo ? `\n\n${SOLO_CONVERSAR_ES}` : ''}`;
    const t0 = Date.now();
    let primera = 0;
    let texto = '';
    try {
      for await (const t of hablarRapido([{ role: 'system', content: system }, { role: 'user', content: user }])) {
        if (!primera) primera = Date.now() - t0;
        texto += t;
      }
    } catch (e: any) {
      console.log(`✗ ${pedido}\n   ERROR ${String(e?.message || e).slice(0, 200)}`);
      continue;
    }
    if (esPaso(texto)) {
      console.log(`↪ ${pedido}\n   Nova dijo PASO en ${primera} ms → Qwen`);
      continue;
    }
    const acciones = extraerAcciones(texto).acciones;
    console.log(`• ${pedido}\n   1ª palabra ${primera} ms · total ${Date.now() - t0} ms · fichas system ≈ ${Math.round(system.length / 3.6)}`);
    console.log(`   ${texto.replace(/\n/g, ' ⏎ ').slice(0, 400)}`);
    if (acciones.length) console.log(`   → acciones: ${JSON.stringify(acciones)}`);
  }
})();
