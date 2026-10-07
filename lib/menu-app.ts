/**
 * EL MENÚ DE LA APP: dónde está cada cosa en AU-RA del teléfono, dicho con los nombres que la persona ve
 * en pantalla. José (2-oct): «tiene que conocer todo el menú para que pueda guiar a alguien en ajustes o
 * algo que ocupe cambiar o hacer… explicar cómo conectar».
 *
 * Es la fuente única: el prompt de la app la lleva (fichaMenuPrompt: completa en texto, corta en la voz,
 * porque cada ficha del system es tiempo antes de hablar) y el recorrido del teléfono enseña lo mismo
 * (mobile/src/recorrido/guion.ts). Cada lugar dice de dónde sale (`fuente`, archivos que EXISTEN: lo
 * vigila tests/menu-app.test.ts) y, si hay acción para abrirlo, cuál (`abrir`, las pantallas de
 * lib/acciones-app.ts): así AURA explica paso a paso y, si la persona quiere, la lleva.
 *
 * Si cambia una pantalla, se cambia aquí y en el recorrido; la prueba avisa si un archivo ya no está.
 */
import type { Pantalla } from './acciones-app';

type Texto = { es: string; en: string };

export type LugarApp = {
  id: string;
  nombre: Texto;
  /** Dónde se toca, con los nombres de la pantalla. */
  donde: Texto;
  /** Qué hay ahí o para qué sirve. */
  que: Texto;
  /** El paso a paso (conectar, dar un permiso). */
  pasos?: readonly Texto[];
  /** La pantalla que la acción «abrir» lleva (lib/acciones-app.ts). */
  abrir?: Pantalla;
  /** Lo que la voz necesita (va en la versión corta del prompt). */
  corto: Texto;
  /** De dónde sale (rutas desde la raíz del repo). */
  fuente: readonly string[];
};

export const MENU_APP: readonly LugarApp[] = [
  {
    id: 'mesa',
    nombre: { es: 'La mesa', en: 'The desk' },
    donde: { es: 'la pantalla principal al entrar', en: 'the main screen after signing in' },
    que: {
      es: 'el avatar al centro y abajo tres botones: Chat (sus chats), Hablar (el micrófono grande del centro: oye siempre, sin palabra clave; tocarlo lo silencia o lo abre) y Más (todo lo demás). Arriba salen tus propuestas',
      en: 'the avatar in the middle and three buttons below: Chat (their chats), Talk (the big mic in the middle: always listening, no wake word; tap to mute or unmute) and More (everything else). Your suggestions show at the top',
    },
    abrir: 'mesa',
    corto: { es: 'Mesa: Chat · Hablar (micrófono; tocar silencia) · Más', en: 'Desk: Chat · Talk (mic; tap mutes) · More' },
    fuente: ['mobile/src/components/BarraMesa.tsx', 'mobile/src/screens/DeskScreen.tsx'],
  },
  {
    id: 'mas',
    nombre: { es: 'Más', en: 'More' },
    donde: { es: 'botón Más (···), abajo a la derecha de la mesa', en: 'the More (···) button, bottom right of the desk' },
    que: {
      es: 'Que te llame (o Colgar), Escribir, Cámara, Caras, Avatar, Modo trabajo o charla, Misiones, Su computadora, Qué puedo hacer (el recorrido y contarte de ella) y Ajustes',
      en: 'Have her call you (or Hang up), Type, Camera, Faces, Avatar, Work or chat mode, Missions, Their computer, What I can do (the tour and telling her about you) and Settings',
    },
    corto: { es: 'Más: llamada, cámara, caras, avatar, misiones, su computadora, «Qué puedo hacer», Ajustes', en: 'More: call, camera, faces, avatar, missions, computer, “What I can do”, Settings' },
    fuente: ['mobile/src/components/HojaMas.tsx'],
  },
  {
    id: 'llamar',
    nombre: { es: 'Que te llame', en: 'Have her call you' },
    donde: { es: 'Más → «Que te llame», o decir «llámame»', en: 'More → “Have her call you”, or say “call me”' },
    que: { es: 'suena como una llamada; al contestar hablan de corrido, sin tocar nada, hasta que cuelgues', en: 'it rings like a call; once you answer you talk hands-free until you hang up' },
    corto: { es: 'Llamada: Más → «Que te llame»', en: 'Call: More → “Have her call you”' },
    fuente: ['mobile/src/compa/llamadaCiclo.ts', 'mobile/src/compa/LlamadaAvatar.tsx'],
  },
  {
    id: 'chats',
    nombre: { es: 'Chats (PULSE2CHAT)', en: 'Chats (PULSE2CHAT)' },
    donde: { es: 'botón Chat de la mesa', en: 'the Chat button on the desk' },
    que: {
      es: 'sus conversaciones y llamadas cifradas de PULSE2CHAT. Arriba, pestañas PULSE2CHAT, WhatsApp y Correos: se cambia deslizando de lado o tocando la pestaña',
      en: 'their encrypted PULSE2CHAT chats and calls. Tabs at the top: PULSE2CHAT, WhatsApp and Email; swipe sideways or tap a tab',
    },
    abrir: 'chats',
    corto: { es: 'Chat: pestañas PULSE2CHAT · WhatsApp · Correos', en: 'Chat: tabs PULSE2CHAT · WhatsApp · Email' },
    fuente: ['mobile/src/app/pantallas/Chats.tsx', 'mobile/src/whatsapp/ChatsConWhatsapp.tsx'],
  },
  {
    id: 'whatsapp',
    nombre: { es: 'WhatsApp', en: 'WhatsApp' },
    donde: { es: 'Chat → pestaña WhatsApp (sale si su cuenta lo tiene activado)', en: 'Chat → WhatsApp tab (shows if their account has it enabled)' },
    que: { es: 'su WhatsApp personal: leer, buscar y contestar con su «sí»', en: 'their personal WhatsApp: read, search and reply with their “yes”' },
    pasos: [
      { es: 'en la pestaña WhatsApp, «Con un código»', en: 'on the WhatsApp tab, “With a code”' },
      { es: 'su número con código de país (504…) y «Pedir el código»', en: 'their number with country code (504…) and “Get the code”' },
      { es: 'en su WhatsApp del teléfono: ⋮ → Dispositivos vinculados → Vincular un dispositivo → «Vincular con el número de teléfono»', en: 'in WhatsApp on the phone: ⋮ → Linked devices → Link a device → “Link with phone number instead”' },
      { es: 'escribir el código; la pantalla cambia sola al quedar (también «Con QR»). Desvincular: ⋮ arriba', en: 'type the code; the screen changes by itself (or “With QR”). Unlink: ⋮ at the top' },
    ],
    abrir: 'whatsapp',
    corto: { es: 'WhatsApp: pestaña WhatsApp → «Con un código» y su número; en WhatsApp ⋮ → Dispositivos vinculados → Vincular con el número', en: 'WhatsApp: WhatsApp tab → “With a code” and number; in WhatsApp ⋮ → Linked devices → Link with phone number' },
    fuente: ['mobile/src/whatsapp/PantallaWhatsapp.tsx', 'server/whatsapp.ts'],
  },
  {
    id: 'correos',
    nombre: { es: 'Correos', en: 'Email' },
    donde: { es: 'Chat → pestaña Correos (al lado de WhatsApp); se conectan en Ajustes → AURA → «Tus correos» (o «abre mis correos»)', en: 'Chat → Email tab (next to WhatsApp); connect them in Settings → AURA → “Your email” (or “open my email”)' },
    que: { es: 'Gmail, Outlook, Yahoo, iCloud o el de su empresa: los revisa, los lee y contesta solo con su «sí»', en: 'Gmail, Outlook, Yahoo, iCloud or work email: checks, reads and replies only with their “yes”' },
    pasos: [
      { es: 'escribir su dirección → Continuar', en: 'type the address → Continue' },
      { es: 'Gmail, Yahoo o iCloud: una «contraseña de aplicación» (se crea en la seguridad de esa cuenta); el de su empresa: su clave', en: 'Gmail, Yahoo or iCloud: an “app password” (made in that account’s security page); work email: its password' },
      { es: 'Outlook o Hotmail: «Entrar con Microsoft», abrir microsoft.com/devicelogin y escribir el código', en: 'Outlook or Hotmail: “Sign in with Microsoft”, open microsoft.com/devicelogin and type the code' },
      { es: '«Conectar»: prueba que puede leer y mandar; si falla, dice por qué. «Quitar» lo desconecta', en: '“Connect” tests reading and sending; if it fails it says why. “Remove” disconnects it' },
    ],
    abrir: 'correos',
    corto: { es: 'Correos: conectar en Ajustes → «Tus correos» (contraseña de aplicación; Outlook: «Entrar con Microsoft»)', en: 'Email: connect in Settings → “Your email” (app password; Outlook: “Sign in with Microsoft”)' },
    fuente: ['mobile/src/ajustes/Correos.tsx', 'mobile/src/correo/PantallaCorreos.tsx', 'server/correo.ts'],
  },
  {
    id: 'calendario',
    nombre: { es: 'Calendario', en: 'Calendar' },
    donde: { es: 'Ajustes → «Calendario»; el día: Más → «Hoy»', en: 'Settings → “Calendar”; the day: More → “Today”' },
    que: { es: 'Outlook o Google: AURA lee su agenda y propone eventos (se crean con su «sí»)', en: 'Outlook or Google: AURA reads the schedule and proposes events (created after a yes)' },
    corto: { es: 'Calendario: Ajustes → «Calendario»; Más → «Hoy»', en: 'Calendar: Settings → “Calendar”; More → “Today”' },
    fuente: ['mobile/src/ajustes/Calendario.tsx', 'mobile/src/agenda/HojaHoy.tsx', 'server/calendario.ts'],
  },
  {
    id: 'cartera',
    nombre: { es: 'Veta Wallet (cartera)', en: 'Veta Wallet (wallet)' },
    donde: { es: 'Ajustes → AURA → «Veta Wallet», o el menú de la mesa → Cartera, o decir «enséñame mi wallet»; para pagar: en un chat de PULSE2CHAT, la moneda de arriba («Enviar dinero») o «mándale 5 ORIGEN a Ana»', en: 'Settings → AURA → “Veta Wallet”, or the desk menu → Wallet, or say “show me my wallet”; to pay: in a PULSE2CHAT chat, the coin at the top (“Send money”) or “send Ana 5 ORIGEN”' },
    que: { es: 'sus saldos de Veta Wallet (tokens y ORIGEN), que solo se leen; su tarjeta Visa, que AURA sí puede mostrar y recargar con su contraseña de Veta (con huella o bloqueo del teléfono). Al pagar, AURA prepara el envío y la persona lo firma en Veta Wallet con su contraseña de siempre; luego sale el comprobante en el chat («Verificado en la cadena»)', en: 'their Veta Wallet balances (tokens and ORIGEN), which are only read; their Visa card, which AURA can show and top up with their Veta password (with fingerprint or phone lock). To pay, AURA prepares it and they sign in Veta Wallet with their usual password; then the receipt shows in the chat (“Verified on chain”)' },
    pasos: [
      { es: 'si tiene PULSE2CHAT, se conecta sola con su cuenta; si no, «Conecta tu cartera en 2 pasos»', en: 'with PULSE2CHAT it connects by itself from their account; otherwise “Connect your wallet in 2 steps”' },
      { es: 'en Veta Wallet: Recibir → Copiar dirección, y pegarla en «Tu dirección de Veta Wallet» → Guardar', en: 'in Veta Wallet: Receive → Copy address, and paste it in “Your Veta Wallet address” → Save' },
      { es: 'pagar: abrir el chat de la persona, tocar la moneda, elegir moneda y cantidad, revisar y confirmar; firma en Veta Wallet y vuelve sola', en: 'pay: open that person’s chat, tap the coin, pick coin and amount, review and confirm; sign in Veta Wallet and it comes back by itself' },
    ],
    corto: { es: 'Cartera: Ajustes → «Veta Wallet» (saldos y tarjeta); pagar en un chat → la moneda, se firma en Veta Wallet', en: 'Wallet: Settings → “Veta Wallet” (balances and card); pay in a chat → the coin, signed in Veta Wallet' },
    fuente: ['mobile/src/cartera/HojaCartera.tsx', 'mobile/src/cartera/HojaPagar.tsx', 'lib/cartera.ts'],
  },
  {
    id: 'computadora',
    nombre: { es: 'Su computadora', en: 'Their computer' },
    donde: { es: 'Más → «Su computadora», o «abre tu computadora»; el motor en Ajustes → Su computadora (Gratis o Claude)', en: 'More → “Their computer”, or “open your computer”; engine in Settings → Their computer (Free or Claude)' },
    que: { es: 'la computadora en la nube del avatar: se ve en vivo cómo trabaja y se le encarga algo. Nunca paga ni pone contraseñas', en: 'the avatar’s cloud computer: watch it work live and give it tasks. It never pays or enters passwords' },
    abrir: 'computadora',
    corto: { es: 'Su computadora: Más → «Su computadora»', en: 'Computer: More → “Their computer”' },
    fuente: ['mobile/src/ajustes/Computadora.tsx', 'mobile/src/app/ComputadoraEnVivo.tsx'],
  },
  {
    id: 'misiones',
    nombre: { es: 'Misiones', en: 'Missions' },
    donde: { es: 'Más → Misiones, o Ajustes → AURA → Misiones', en: 'More → Missions, or Settings → AURA → Missions' },
    que: { es: 'las metas que AURA le ayuda a cumplir, paso a paso', en: 'the goals AURA helps them reach, step by step' },
    abrir: 'misiones',
    corto: { es: 'Misiones: Más → Misiones', en: 'Missions: More → Missions' },
    fuente: ['mobile/src/ajustes/Misiones.tsx'],
  },
  {
    id: 'conocer',
    nombre: { es: 'Lo que sé de ti', en: 'What I know about you' },
    donde: { es: 'Ajustes → AURA → «Lo que sé de ti»; lo que contó en la encuesta: Ajustes → AURA → «Lo que AURA sabe de ti»', en: 'Settings → AURA → “What I know about you”; survey answers: Settings → AURA → “What AURA knows about you”' },
    que: { es: 'lo que AURA aprendió hablando y lo que quedó a medias; cada dato se puede corregir o borrar', en: 'what AURA learned from talking and what was left halfway; each item can be fixed or erased' },
    abrir: 'conocer',
    corto: { es: 'Lo que sé de ti: Ajustes → AURA', en: 'What I know: Settings → AURA' },
    fuente: ['mobile/src/ajustes/LoQueSeDeTi.tsx', 'mobile/src/ajustes/LoQueSabe.tsx'],
  },
  {
    id: 'circulo',
    nombre: { es: 'Mi círculo', en: 'My circle' },
    donde: { es: 'Ajustes → AURA → «Mi círculo»', en: 'Settings → AURA → “My circle”' },
    que: { es: 'su gente cercana (familia, amigos) y qué puede hacer AURA por ellos, como recordarles algo', en: 'their close people and what AURA can do for them, like reminding them of something' },
    abrir: 'circulo',
    corto: { es: 'Mi círculo: Ajustes → AURA', en: 'My circle: Settings → AURA' },
    fuente: ['mobile/src/ajustes/Circulo.tsx'],
  },
  {
    id: 'propuestas',
    nombre: { es: 'Propuestas de AURA', en: 'AURA’s suggestions' },
    donde: { es: 'una tarjeta arriba en la mesa (o un aviso con la app cerrada); cuántas: Ajustes → «Iniciativa de AURA»', en: 'a card at the top of the desk (or a notification with the app closed); how many: Settings → “AURA’s initiative”' },
    que: { es: 'botones «Sí, hazlo», «Luego» y «No» (la ✕ es Luego). Iniciativa: Alta (cada 2 h, hasta 6 al día), Media (cada 4 h, hasta 3), Baja (1 al día) o Apagada; nunca de noche', en: 'buttons “Yes, do it”, “Later” and “No” (✕ is Later). Initiative: High (every 2 h, up to 6 a day), Medium (every 4 h, up to 3), Low (1 a day) or Off; never at night' },
    corto: { es: 'Propuestas: tarjeta Sí/Luego/No; cuántas en Ajustes → Iniciativa de AURA', en: 'Suggestions: Yes/Later/No card; how many in Settings → AURA’s initiative' },
    fuente: ['mobile/src/components/TarjetaPropuesta.tsx', 'server/iniciativa.ts'],
  },
  {
    id: 'avisos',
    nombre: { es: 'Avisos con la app cerrada', en: 'Notifications with the app closed' },
    donde: { es: 'permiso: Ajustes → Privacidad → Permisos del teléfono → Avisos; a la hora exacta: Ajustes → Privacidad → «Alarmas y recordatorios»', en: 'permission: Settings → Privacy → Phone permissions → Notifications; on time: Settings → Privacy → “Alarms & reminders”' },
    que: { es: 'AURA escribe y llama aunque la app esté cerrada (recordatorios, propuestas). Si no llegan: esos dos permisos y que el ahorro de batería no cierre la app', en: 'AURA messages and calls even with the app closed (reminders, suggestions). If they don’t arrive: those two permissions and battery saver not closing the app' },
    corto: { es: 'Avisos: Ajustes → Privacidad → Permisos del teléfono y «Alarmas y recordatorios»', en: 'Notifications: Settings → Privacy → Phone permissions and “Alarms & reminders”' },
    fuente: ['mobile/src/push/nativo.ts', 'mobile/src/primeravez/permisos.ts'],
  },
  {
    id: 'recordatorios',
    nombre: { es: 'Recordatorios y «llámame»', en: 'Reminders and “call me”' },
    donde: { es: 'se piden hablando: «recuérdame a las 5…», «llámame mañana a las 6», «ponme un timer de 10 minutos»', en: 'just ask: “remind me at 5…”, “call me tomorrow at 6”, “set a 10-minute timer”' },
    que: { es: 'a la hora le llama con su voz, aunque tenga la app cerrada; «¿qué recordatorios tengo?» y «cancela el de las 5»', en: 'at that time she calls with her voice, even with the app closed; “what reminders do I have?” and “cancel the 5 o’clock one”' },
    corto: { es: 'Recordatorios: se piden hablando', en: 'Reminders: just ask' },
    fuente: ['mobile/src/compa/recordatorios.ts', 'lib/manos-app.ts'],
  },
  {
    id: 'camara',
    nombre: { es: 'Cámara', en: 'Camera' },
    donde: { es: 'Más → Cámara: Apagada, Solo ahora o Siempre (empieza apagada); «¿qué ves?» la prende solo ahora. «Comenta lo que ve» (que comente sola): Más → Ajustes. Caras: Más → Caras', en: 'More → Camera: Off, Just now or Always (starts off); “what do you see?” turns it on just now. “Comments on what it sees” (unprompted remarks): More → Settings. Faces: More → Faces' },
    que: { es: 've y dice qué hay, lee papeles y reconoce a quien le presente, con permiso', en: 'sees and says what is there, reads papers and recognizes people introduced, with permission' },
    corto: { es: 'Cámara: Más → Cámara (Apagada, Solo ahora, Siempre)', en: 'Camera: More → Camera (Off, Just now, Always)' },
    fuente: ['mobile/src/lib/camaraModo.ts', 'mobile/src/components/HojaMas.tsx'],
  },
  {
    id: 'ajustes',
    nombre: { es: 'Ajustes', en: 'Settings' },
    donde: { es: 'Más → Ajustes, o decir «abre ajustes»', en: 'More → Settings, or say “open settings”' },
    que: {
      es: 'Tu perfil (Apodo, Avatar, Cumpleaños) · Apariencia (Oscuro, Claro, Sistema) · Idioma (Español, English) · AURA (Lo que AURA sabe de ti, Lo que sé de ti, Mi círculo, Misiones, Tus correos, Veta Wallet, Repetir el recorrido, Vibración) · Voz y oído · La mesa («Comenta lo que ve», Efectos de sonido, su cara) · Memoria (Memoria de largo plazo, Olvidar lo que recuerda de ti) · Iniciativa de AURA · Su computadora · Privacidad (Permisos del teléfono, Alarmas y recordatorios) · Cerrar sesión',
      en: 'Your profile (Nickname, Avatar, Birthday) · Appearance (Dark, Light, System) · Language · AURA (What AURA knows about you, What I know about you, My circle, Missions, Your email, Veta Wallet, Replay the tour, Vibration) · Voice and hearing · The desk (“Comments on what it sees”, Sound effects, her face) · Memory (Long-term memory, Forget what it remembers about you) · AURA’s initiative · Their computer · Privacy (Phone permissions, Alarms & reminders) · Sign out',
    },
    abrir: 'ajustes',
    corto: { es: 'Ajustes: Más → Ajustes o «abre ajustes»', en: 'Settings: More → Settings or “open settings”' },
    fuente: ['mobile/src/ajustes/Ajustes.tsx'],
  },
  {
    id: 'permisos',
    nombre: { es: 'Permisos', en: 'Permissions' },
    donde: { es: 'Ajustes → Privacidad → «Permisos del teléfono»', en: 'Settings → Privacy → “Phone permissions”' },
    que: { es: 'Micrófono, Cámara, Audífonos Bluetooth y Avisos: tocar uno lo pide; si se bloqueó, lleva a los ajustes del teléfono', en: 'Microphone, Camera, Bluetooth headphones and Notifications: tap one to allow it; if blocked, it opens phone settings' },
    corto: { es: 'Permisos: Ajustes → Privacidad', en: 'Permissions: Settings → Privacy' },
    fuente: ['mobile/src/primeravez/ListaPermisos.tsx'],
  },
  {
    id: 'genesis',
    nombre: { es: 'Genesis ID', en: 'Genesis ID' },
    donde: { es: 'la entrada: «Entrar con Genesis ID» (lo confirma su wallet Orden Global); sin él, «No tengo Genesis ID» → «Crea tu Genesis ID»', en: 'sign-in: “Sign in with Genesis ID” (confirmed by the Orden Global wallet); without one, “I don’t have a Genesis ID” → “Create your Genesis ID”' },
    que: { es: 'su identidad para entrar; comparte su nombre y cumpleaños con su permiso. Salir: Ajustes → Cerrar sesión (su perfil se queda en su cuenta)', en: 'their identity to sign in; shares name and birthday with permission. Sign out: Settings → Sign out (the profile stays in the account)' },
    corto: { es: 'Genesis ID: salir en Ajustes → Cerrar sesión', en: 'Genesis ID: sign out in Settings' },
    fuente: ['mobile/src/app/pantallas/Entrar.tsx', 'mobile/src/app/pantallas/CrearGenesis.tsx'],
  },
  {
    id: 'recorrido',
    nombre: { es: 'Recorrido', en: 'Tour' },
    donde: { es: 'Más → «Qué puedo hacer», o Ajustes → AURA → «Repetir el recorrido»', en: 'More → “What I can do”, or Settings → AURA → “Replay the tour”' },
    que: { es: 'el recorrido de todo lo que hace AURA y las preguntas para conocerle (por voz, eligiendo o escribiendo)', en: 'the tour of everything AURA does and the questions to get to know them (by voice, picking or typing)' },
    corto: { es: 'Recorrido: Más → «Qué puedo hacer»', en: 'Tour: More → “What I can do”' },
    fuente: ['mobile/src/recorrido/guion.ts', 'mobile/src/bienvenida/VentanaBienvenida.tsx'],
  },
];

export function lugarDe(id: string): LugarApp | undefined {
  return MENU_APP.find((l) => l.id === id);
}

const mayus = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/** El paso a paso de un lugar, como se dice: «1) …; 2) …». '' si no tiene pasos. */
export function pasosDe(l: LugarApp, idioma: 'es' | 'en' = 'es'): string {
  return (l.pasos || []).map((p, i) => `${i + 1}) ${p[idioma]}`).join('; ');
}

/**
 * El bloque del prompt. Va en el system (igual turno a turno: el nodo no lo relee). En la voz, la versión
 * corta (una línea por lugar, sin el paso a paso fino); en texto, completa. `conAbrir`: el teléfono está
 * conectado y puede abrir pantallas (ACCION_APP abrir).
 */
export function fichaMenuPrompt(idioma: 'es' | 'en' = 'es', o: { compacto?: boolean; conAbrir?: boolean } = {}): string {
  const en = idioma === 'en';
  if (o.compacto) {
    const lineas = MENU_APP.map((l) => l.corto[idioma]).join(' · ');
    const cierre = en
      ? `To guide: say it in short steps with the on-screen names${o.conAbrir ? '; offer to open it and, if they want, open it (ACCION_APP abrir)' : ''}.`
      : `Para guiar: dilo en pasos cortos con los nombres de la pantalla${o.conAbrir ? '; ofrece abrirla y, si quiere, ábrela (ACCION_APP abrir)' : ''}.`;
    return `${en ? 'APP MENU' : 'MENÚ DE LA APP'}: ${lineas}. ${cierre}`;
  }
  const cabeza = en
    ? `APP MENU (where everything is in the phone app; use it to guide the person step by step with the exact on-screen names, one step at a time if they are doing it now${o.conAbrir ? '. When there is an [open: …] screen, offer to take them there and, if they say yes or ask, open it with ACCION_APP abrir' : ''}):`
    : `MENÚ DE LA APP (dónde está cada cosa en la app del teléfono; úsalo para guiar paso a paso con los nombres exactos de la pantalla, un paso a la vez si lo está haciendo ahora${o.conAbrir ? '. Si hay [abrir: …], ofrece llevarle y, si dice que sí o lo pide, ábrela con ACCION_APP abrir' : ''}):`;
  const lineas = MENU_APP.map((l) => {
    const pasos = pasosDe(l, idioma);
    const abrir = o.conAbrir && l.abrir ? ` [${en ? 'open' : 'abrir'}: ${l.abrir}]` : '';
    return `· ${l.nombre[idioma]} — ${mayus(l.donde[idioma])}: ${l.que[idioma]}.${pasos ? ` ${en ? 'Steps' : 'Pasos'}: ${pasos}.` : ''}${abrir}`;
  });
  return [cabeza, ...lineas].join('\n');
}
