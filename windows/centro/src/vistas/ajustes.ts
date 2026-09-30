/**
 * Ajustes del Centro: por secciones, cada opción con su explicación en palabras de persona. Los cambios
 * se guardan al tocarlos (sin botón «Guardar»); lo sensible (claves) viaja a AURA y se guarda cifrado.
 */
import { h, boton, tarjeta, interruptor, eleccion, avisar, icono } from '../ui';
import { pedir, al } from '../puente';
import { estado, cargar, aplicarAcento, T } from '../estado';

type Aj = Record<string, any>;

export function vistaAjustes(): HTMLElement {
  const cuerpo = h('div', null, h('span', { class: 'cargando' }));
  const secciones = [
    ['cuenta', T('Cuenta', 'Account')], ['avatar', T('Avatar e idioma', 'Avatar & language')], ['voz', T('Voz y escucha', 'Voice & listening')],
    ['conexiones', T('Conexiones', 'Connections')], ['avisos', T('Notificaciones', 'Notifications')], ['cuentas', T('Correo y agenda', 'Email & calendar')],
    ['privacidad', T('Privacidad y diagnóstico', 'Privacy & diagnostics')], ['atajos', T('Atajos', 'Shortcuts')],
  ];
  const nav = h('div', { class: 'pastillas', style: 'margin-bottom:18px;position:sticky;top:-28px;background:var(--fondo);padding:10px 0;z-index:2' },
    ...secciones.map(([id, t]) => h('button', { class: 'pastilla', on: { click: () => document.getElementById('aj-' + id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }) } }, t)));
  const vista = h('div', { class: 'vista' },
    h('div', { class: 'cabeza' }, h('div', null, h('h1', null, T('Ajustes', 'Settings')), h('p', null, T('Todo se guarda al momento. Pasa el ratón sobre cualquier botón para ver qué hace.', 'Changes save instantly. Hover any button to see what it does.')))),
    nav, cuerpo);

  const guardar = async (parcial: Aj) => {
    try { await pedir('ajustes.guardar', parcial); } catch (e: any) { avisar(e.message, 'mal', 7000); }
  };
  const seccion = (id: string, titulo: string, ...hijos: any[]) => h('section', { class: 'tarjeta', id: 'aj-' + id, style: 'scroll-margin-top:60px' }, h('h3', null, titulo), ...hijos);

  async function pintar() {
    const aj: Aj = await pedir('ajustes.leer');
    const e = estado();
    const con = e.conexiones;

    // ── Cuenta ──
    const cuenta = seccion('cuenta', T('Cuenta', 'Account'),
      e.sesion
        ? h('div', { class: 'fila' }, h('span', { class: 'foto', style: 'background:var(--acento-suave);color:var(--acento)' }, (e.sesion.nombre || e.sesion.correo).slice(0, 1).toUpperCase()),
            h('div', { style: 'flex:1' }, h('strong', null, e.sesion.nombre || e.sesion.correo), h('br'),
              h('small', { class: 'tenue' }, `${e.sesion.correo} · ${e.sesion.rol || (e.sesion.nivel === 'junta' ? 'Junta' : T('Miembro · Genesis ID', 'Member · Genesis ID'))}`)),
            boton(T('Salir de la cuenta', 'Sign out'), async () => { if (confirm(T('¿Salir de AU-RA en esta computadora? Se borran de aquí tu sesión y las llaves de PULSE2CHAT.', 'Sign out of AU-RA on this computer?'))) await pedir('salir'); }, { tipo: 'peligro', titulo: T('Cierra la sesión en esta PC (la cuenta sigue existiendo)', 'Signs out on this PC') }))
        : h('p', null, T('No has entrado.', 'Not signed in.')),
      h('p', { class: 'nota' }, T('Tu sesión de AU-RA dura 14 días. Con Genesis ID no se guarda ninguna clave: al vencer, vuelves a entrar con Veta Wallet.', 'Your session lasts 14 days.')));

    // ── Avatar e idioma ──
    const avatar = seccion('avatar', T('Avatar e idioma', 'Avatar & language'),
      eleccion(T('Avatar', 'Avatar'), [
        { valor: 'aura', texto: 'AU-RA', explica: T('Cálida y precisa. Acento dorado.', 'Warm and precise.') },
        { valor: 'claudio', texto: 'Claudio', explica: T('Creativo: ideas, marketing y contenido. Acento naranja.', 'Creative.') },
        { valor: 'antonio', texto: 'ANT-ONIO', explica: T('Directo y técnico. Acento cian.', 'Direct and technical.') },
        { valor: 'ojos', texto: 'Guardián', explica: T('Sereno; seguridad y cuidado del espacio.', 'Calm guardian.') },
      ], aj.avatar, (v) => { aplicarAcento(v); guardar({ avatar: v }); }),
      eleccion(T('Idioma', 'Language'), [
        { valor: 'es', texto: 'Español', explica: T('AURA te habla y te escucha en español.', 'Spanish.') },
        { valor: 'en', texto: 'English', explica: T('AURA habla y escucha en inglés.', 'AURA speaks and listens in English.') },
      ], aj.idioma, (v) => guardar({ idioma: v }).then(() => cargar())));

    // ── Voz y escucha ──
    const voz = seccion('voz', T('Voz y escucha', 'Voice & listening'),
      eleccion(T('Cómo te escucha', 'How it listens'), [
        { valor: 'palabra', texto: T('«Oye AURA»', '“Hey AURA”'), explica: T('Recomendado. Tu PC espera «Oye AURA» (se reconoce en el equipo, sin enviar audio). Luego conversa hasta que te callas.', 'Recommended: your PC waits for “Hey AURA”.') },
        { valor: 'siempre', texto: T('Siempre atenta', 'Always attentive'), explica: T('Micrófono abierto: atiende cuando la nombras o mientras conversan. Lo que dices se envía al servidor para entenderlo.', 'Mic open: answers when named.') },
        { valor: 'pedir', texto: T('Solo si lo pido', 'Only when asked'), explica: T('Solo con Ctrl+Alt+Espacio o tocando el micrófono del notch.', 'Only with Ctrl+Alt+Space.') },
      ], aj.escucha, (v) => guardar({ escucha: v })),
      interruptor(T('Contestar con voz', 'Answer with voice'), T('Habla con la voz de su avatar (ElevenLabs, la misma de la app). Si lo apagas, contesta solo por escrito en el notch.', 'Speaks with the avatar voice.'), aj.responderConVoz, (v) => guardar({ responderConVoz: v })),
      interruptor(T('Conversación continua', 'Continuous conversation'), T('Después de contestar vuelve a escucharte sola, sin tocar nada.', 'Listens again after answering.'), aj.manosLibres, (v) => guardar({ manosLibres: v })),
      interruptor(T('Interrumpirla hablándole', 'Interrupt by talking'), T('Si le hablas mientras habla, se calla y te escucha.', 'Talk over her to interrupt.'), aj.interrumpir, (v) => guardar({ interrumpir: v })),
      interruptor(T('Voz de Windows (sin internet)', 'Windows voice (offline)'), T('Habla siempre con la voz de Windows. Si está apagado, la usa sola cuando el servidor no contesta.', 'Always use the Windows voice.'), aj.vozDeWindows, (v) => guardar({ vozDeWindows: v })),
      interruptor(T('Oído de Windows (sin internet)', 'Windows hearing (offline)'), T('Entiende tu voz con el dictado de Windows. Es más rápido pero entiende peor; si está apagado, solo de respaldo.', 'Use Windows dictation.'), aj.oidoDeWindows, (v) => guardar({ oidoDeWindows: v })),
      interruptor(T('Apartarse en pantalla completa', 'Hide in full screen'), T('Con juegos o videos a pantalla completa, el notch se esconde.', 'Hides during full-screen apps.'), aj.ocultarEnPantallaCompleta, (v) => guardar({ ocultarEnPantallaCompleta: v })));

    // ── Conexiones ──
    const filaConexion = (id: 'spotify' | 'google' | 'microsoft', nombre: string, para: string, ico: string) => {
      const cuentaTxt = con[id];
      const b = boton(cuentaTxt ? T('Desconectar', 'Disconnect') : T('Conectar ', 'Connect ') + nombre, async () => {
        b.disabled = true;
        try {
          if (cuentaTxt) { await pedir('desconectar', { servicio: id }); avisar(nombre + T(' desconectado.', ' disconnected.')); }
          else { avisar(T(`Abrí ${nombre} en tu navegador: acepta y vuelve.`, `Opened ${nombre}: accept and come back.`)); await pedir('conectar', { servicio: id }, 330_000); avisar(nombre + T(' conectado.', ' connected.'), 'ok'); }
          await cargar(); pintar();
        } catch (err: any) { avisar(err.message, 'mal', 10_000); b.disabled = false; }
      }, { tipo: cuentaTxt ? 'fantasma' : 'acento', titulo: para });
      return h('div', { class: 'opcion', style: 'cursor:default' },
        h('span', { class: 'foto', style: 'background:var(--superficie2)' }, icono(ico, 20)),
        h('div', { class: 'opcion-texto' }, h('strong', null, nombre, ' ', cuentaTxt ? h('span', { class: 'etiqueta ok' }, T('conectado', 'connected')) : null),
          h('small', null, cuentaTxt && cuentaTxt !== 'conectado' ? `${cuentaTxt} · ${para}` : para)), b);
    };
    const avanzado = h('details', { style: 'margin-top:12px' }, h('summary', { class: 'tenue', style: 'cursor:pointer' }, T('Avanzado: Client ID propios', 'Advanced: own Client IDs')),
      h('p', { class: 'nota' }, T('Normalmente los pone AU-RA. Si registras tus propias apps, en cada servicio la dirección de vuelta es http://127.0.0.1:43821/callback', 'Return address: http://127.0.0.1:43821/callback')),
      ...(['spotify', 'google', 'microsoft'] as const).map((k) => h('div', { class: 'campo' }, h('small', null, k + ' Client ID'),
        h('input', { type: 'text', value: aj.clientes?.[k] ?? '', spellcheck: 'false', on: { change: (ev: Event) => guardar({ clientes: { ...aj.clientes, [k]: (ev.target as HTMLInputElement).value } }) } }))));
    const conexiones = seccion('conexiones', T('Conexiones', 'Connections'),
      h('p', { class: 'nota' }, T('Se entra en la página del propio servicio: AURA nunca ve tu contraseña. El permiso queda cifrado en esta PC.', 'You sign in on the service’s own page.')),
      filaConexion('spotify', 'Spotify', T('Poner la canción, artista o playlist que pidas; reproductor en Música (control: Premium).', 'Play exactly what you ask.'), 'musica'),
      filaConexion('google', 'Google', T('Gmail y Google Calendar (solo leer) con avisos, y YouTube Music.', 'Gmail, Calendar, YouTube Music.'), 'campana'),
      filaConexion('microsoft', 'Microsoft', T('Outlook, Hotmail y Microsoft 365: correo y calendario (solo leer).', 'Outlook mail and calendar.'), 'campana'),
      avanzado);

    // ── Notificaciones ──
    const silenciadas = h('div', { class: 'pastillas', style: 'margin-top:8px' });
    const pintarSilenciadas = () => silenciadas.replaceChildren(...((aj.appsSilenciadas ?? []) as string[]).map((app) =>
      h('button', { class: 'pastilla activa', title: T('Quitar el silencio de ', 'Unmute ') + app, on: { click: () => { aj.appsSilenciadas = aj.appsSilenciadas.filter((x: string) => x !== app); guardar({ appsSilenciadas: aj.appsSilenciadas }); pintarSilenciadas(); } } }, app + ' ✕')),
      ...(aj.appsSilenciadas?.length ? [] : [h('small', { class: 'tenue' }, T('Ninguna. Di «silencia las notificaciones de WhatsApp».', 'None. Say “mute WhatsApp notifications”.'))]));
    pintarSilenciadas();
    const avisos = seccion('avisos', T('Notificaciones', 'Notifications'),
      interruptor(T('Mostrar las de otras apps en el notch', 'Show other apps in the notch'), T('WhatsApp, Teams, Outlook, Chrome… salen arriba como en el iPhone, con «Abrir». AURA las lee de Windows, solo para mostrarlas.', 'Like the iPhone island.'), aj.avisosDeApps, (v) => guardar({ avisosDeApps: v })),
      interruptor(T('Modo privado', 'Private mode'), T('Solo dice de qué app es, sin el texto (para cuando alguien mira tu pantalla).', 'Only the app name.'), aj.avisosPrivados, (v) => guardar({ avisosPrivados: v })),
      interruptor(T('Leerlas en voz alta', 'Read them aloud'), T('Al llegar, AURA te dice de quién es y qué dice.', 'AURA reads them to you.'), aj.avisosEnVoz, (v) => guardar({ avisosEnVoz: v })),
      interruptor(T('Avisarme de correos nuevos', 'Notify new emails'), T('Con Google, Outlook o el correo IMAP de abajo.', 'With Google, Outlook or IMAP.'), aj.avisarCorreos, (v) => guardar({ avisarCorreos: v })),
      interruptor(T('Mostrar lo que suena', 'Show what’s playing'), T('Portada y barras en el notch con Spotify, YouTube Music o el navegador.', 'Cover and bars in the notch.'), aj.mostrarMusica, (v) => guardar({ mostrarMusica: v })),
      h('div', { style: 'margin-top:10px' }, h('strong', null, T('Apps en silencio', 'Muted apps')), silenciadas));

    // ── Correo y agenda sin cuenta ──
    const campo = (etiqueta: string, ayuda: string, props: Aj, clave: string) => h('div', { class: 'campo' }, h('strong', null, etiqueta),
      h('input', { ...props, on: { change: (ev: Event) => guardar({ [clave]: (ev.target as HTMLInputElement).value }) } }), h('small', null, ayuda));
    const cuentas = seccion('cuentas', T('Correo y agenda sin conectar cuenta', 'Email & calendar without an account'),
      h('p', { class: 'nota' }, T('Si ya conectaste Google o Microsoft arriba, esto no hace falta.', 'Not needed if you connected Google or Microsoft.')),
      campo(T('Correo (IMAP)', 'Email (IMAP)'), T('Gmail, Yahoo, iCloud…', 'Gmail, Yahoo, iCloud…'), { type: 'email', value: aj.correoDireccion ?? '' }, 'correoDireccion'),
      campo(T('Contraseña de aplicación', 'App password'), aj.tieneClaveCorreo ? T('Guardada (cifrada). Escribe otra para cambiarla.', 'Saved (encrypted).') : T('En Gmail: Cuenta de Google → Seguridad → Contraseñas de aplicaciones.', 'Gmail: Google Account → Security → App passwords.'), { type: 'password', placeholder: aj.tieneClaveCorreo ? '••••••••' : '' }, 'correoClave'),
      campo(T('Calendario (dirección iCal secreta)', 'Calendar (secret iCal address)'), T('Google Calendar → Configuración del calendario → «Dirección secreta en formato iCal».', 'Google Calendar → Settings → Secret iCal address.'), { type: 'text', value: aj.agendaUrl ?? '', spellcheck: 'false' }, 'agendaUrl'));

    // ── Privacidad y diagnóstico ──
    const registro = h('pre', { style: 'display:none;max-height:260px;overflow:auto;background:var(--superficie2);padding:12px;border-radius:12px;font-size:11.5px;white-space:pre-wrap' });
    const privacidad = seccion('privacidad', T('Privacidad y diagnóstico', 'Privacy & diagnostics'),
      h('ul', { class: 'nota', style: 'line-height:1.8;padding-left:18px' },
        h('li', null, T('La pantalla se lee en tu PC (UI Automation y OCR de Windows): al cerebro va solo texto, nunca imágenes.', 'Screen is read locally.')),
        h('li', null, T('Tu sesión, tokens y llaves de PULSE2CHAT se guardan cifrados con Windows (DPAPI): solo tu usuario los abre.', 'Secrets encrypted with DPAPI.')),
        h('li', null, T('La cartera es solo lectura: AURA nunca mueve dinero.', 'Wallet is read-only.'))),
      h('div', { class: 'fila', style: 'flex-wrap:wrap' },
        boton(T('Ver registro', 'View log'), async () => { registro.textContent = await pedir('diagnostico.leer'); registro.style.display = 'block'; registro.scrollTop = registro.scrollHeight; }, { titulo: T('Qué hizo AURA y cuánto tardó cada paso (sin contraseñas ni tokens)', 'What AURA did and how long each step took') }),
        boton(T('Copiar registro', 'Copy log'), async () => { await navigator.clipboard.writeText(await pedir('diagnostico.leer')); avisar(T('Copiado. Pégalo en el chat para que lo revisemos.', 'Copied.'), 'ok'); }, { titulo: T('Para mandarlo si algo falla', 'To send if something fails') }),
        boton(T('Abrir carpeta', 'Open folder'), () => pedir('diagnostico.carpeta'), { tipo: 'fantasma', titulo: '%LOCALAPPDATA%\\AuraWindows' })),
      registro);

    // ── Atajos ──
    const tecla = (k: string, que: string) => h('div', { class: 'fila', style: 'justify-content:space-between;padding:6px 0;border-top:1px solid var(--linea)' }, h('span', null, que), h('span', { class: 'etiqueta' }, k));
    const atajos = seccion('atajos', T('Atajos', 'Shortcuts'),
      tecla('Ctrl+Alt+Espacio', T('Hablarle', 'Talk')), tecla('Ctrl+Alt+C', T('Abrir este Centro', 'Open this Center')), tecla('Ctrl+Alt+A', T('Chat rápido en el notch', 'Quick chat in the notch')),
      tecla('Ctrl+Alt+W', T('Elegir la ventana donde escribirá', 'Pick the window to type into')), tecla('Ctrl+Alt+Esc', T('Pausar todo (micrófono, voz y acciones)', 'Pause everything')),
      h('p', { class: 'nota' }, T(`Versión ${e.version}`, `Version ${e.version}`)));

    cuerpo.replaceChildren(cuenta, avatar, voz, conexiones, avisos, cuentas, privacidad, atajos);
  }
  pintar().catch((e) => cuerpo.replaceChildren(tarjeta(null, h('p', null, e.message))));
  al('estado', () => { if (vista.isConnected) pintar().catch(() => {}); });
  return vista;
}
