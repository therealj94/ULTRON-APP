/**
 * Ajustes del Centro: por secciones, cada opción con su explicación en palabras de persona. Los cambios
 * se guardan al tocarlos (sin botón «Guardar»); lo sensible (claves) viaja a AURA y se guarda cifrado.
 */
import { h, boton, tarjeta, interruptor, eleccion, avisar, icono } from '../ui';
import { pedir, al } from '../puente';
import { estado, cargar, aplicarAcento, T } from '../estado';
import { cerrarAura } from '../cerrar';
import { punzon, wordmark, firma } from '../marca';

type Aj = Record<string, any>;

export function vistaAjustes(): HTMLElement {
  const cuerpo = h('div', null, h('span', { class: 'cargando' }));
  const secciones = [
    ['cuenta', T('Cuenta', 'Account')], ['avatar', T('Avatar, idioma y notch', 'Avatar, language & notch')], ['voz', T('Voz y escucha', 'Voice & listening')],
    ['conexiones', T('Conexiones', 'Connections')], ['avisos', T('Notificaciones', 'Notifications')], ['cuentas', T('Correo y agenda', 'Email & calendar')],
    ['privacidad', T('Privacidad y diagnóstico', 'Privacy & diagnostics')], ['actualizar', T('Actualizaciones', 'Updates')], ['atajos', T('Atajos', 'Shortcuts')],
  ];
  // El menú de secciones: se queda arriba y marca la sección que estás leyendo.
  const pastillas = new Map<string, HTMLButtonElement>();
  const marcarSeccion = (id: string) => pastillas.forEach((b, k) => {
    b.classList.toggle('activa', k === id);
    if (k === id) b.setAttribute('aria-current', 'true'); else b.removeAttribute('aria-current');
  });
  const nav = h('nav', { class: 'aj-nav', 'aria-label': T('Secciones de ajustes', 'Settings sections') },
    ...secciones.map(([id, t]) => {
      const b = h('button', { class: 'pastilla', on: { click: () => {
        marcarSeccion(id);
        const reducir = matchMedia('(prefers-reduced-motion: reduce)').matches;
        document.getElementById('aj-' + id)?.scrollIntoView({ behavior: reducir ? 'auto' : 'smooth', block: 'start' });
      } } }, t) as HTMLButtonElement;
      pastillas.set(id, b);
      return b;
    }));
  let espia: IntersectionObserver | null = null;
  const espiar = () => {
    espia?.disconnect();
    const visibles = new Map<string, number>();
    espia = new IntersectionObserver((entradas) => {
      for (const en of entradas) visibles.set(en.target.id.slice(3), en.isIntersecting ? en.boundingClientRect.top : Infinity);
      let mejor = '', arriba = Infinity;
      visibles.forEach((top, id) => { if (top < arriba) { arriba = top; mejor = id; } });
      if (mejor) marcarSeccion(mejor);
    }, { root: vista.closest('.contenido'), rootMargin: '-80px 0px -55% 0px' });
    cuerpo.querySelectorAll('.aj-seccion').forEach((el) => espia!.observe(el));
  };
  const vista = h('div', { class: 'vista' },
    h('div', { class: 'cabeza' }, h('div', null, h('h1', null, T('Ajustes', 'Settings')), h('p', null, T('Todo se guarda al momento, sin botón «Guardar». Pasa el ratón sobre cualquier botón para ver qué hace.', 'Changes save instantly. Hover any button to see what it does.')))),
    nav, cuerpo);

  const guardar = async (parcial: Aj) => {
    try { await pedir('ajustes.guardar', parcial); } catch (e: any) { avisar(e.message, 'mal', 7000); }
  };
  // Cada sección con su número (en Mono, como el folio de un certificado) y su rótulo.
  const seccion = (id: string, titulo: string, ...hijos: any[]) => {
    const n = Math.max(0, secciones.findIndex(([k]) => k === id)) + 1;
    return h('section', { class: 'tarjeta aj-seccion', id: 'aj-' + id }, h('h3', null, h('span', { class: 'n', 'aria-hidden': 'true' }, String(n).padStart(2, '0')), titulo), ...hijos);
  };

  async function pintar() {
    const aj: Aj = await pedir('ajustes.leer');
    const e = estado();
    const con = e.conexiones;

    // ── Cuenta ──
    const cuenta = seccion('cuenta', T('Cuenta', 'Account'),
      e.sesion
        ? h('div', { class: 'fila', style: 'flex-wrap:wrap' }, h('span', { class: 'sello', style: 'min-width:40px;height:40px' }, (e.sesion.nombre || e.sesion.correo).split(' ').map((x: string) => x[0]).slice(0, 2).join('').toUpperCase()),
            h('div', { style: 'flex:1' }, h('strong', null, e.sesion.nombre || e.sesion.correo), h('br'),
              h('small', { class: 'tenue' }, `${e.sesion.correo} · ${e.sesion.rol || (e.sesion.nivel === 'junta' ? 'Junta' : T('Miembro · Genesis ID', 'Member · Genesis ID'))}`)),
            boton(T('Cerrar AURA por completo', 'Quit AURA'), () => void cerrarAura(), { titulo: T('Cierra el notch, el Centro, la voz y el ícono de la bandeja', 'Closes the notch, the Centro, voice and the tray icon') }),
            boton(T('Salir de la cuenta', 'Sign out'), async () => { if (confirm(T('¿Salir de AU-RA en esta computadora? Se borran de aquí tu sesión y las llaves de PULSE2CHAT.', 'Sign out of AU-RA on this computer?'))) await pedir('salir'); }, { tipo: 'peligro', titulo: T('Cierra la sesión en esta PC (la cuenta sigue existiendo)', 'Signs out on this PC') }))
        : h('p', null, T('No has entrado.', 'Not signed in.')),
      h('p', { class: 'nota' }, T('Tu sesión de AU-RA dura 14 días. Con Genesis ID no se guarda ninguna clave: al vencer, vuelves a entrar con Veta Wallet.', 'Your session lasts 14 days.')));

    // ── Transparencia del notch: 0.30 deja ver mucho el fondo; 1 es el negro sólido de antes. Se guarda al soltar (guardar repinta la vista). ──
    const vidrio = (valor: number) => {
      const cuanto = h('small', { class: 'tenue mono', style: 'min-width:120px;text-align:right' });
      const decir = (v: number) => { cuanto.textContent = v >= 1 ? T('Sólido', 'Solid') : T(`Transparencia ${Math.round((1 - v) * 100)} %`, `Transparency ${Math.round((1 - v) * 100)}%`); };
      decir(valor);
      const barra = h('input', { type: 'range', min: '30', max: '100', step: '1', value: String(Math.round(valor * 100)),
        'aria-label': T('Transparencia del notch', 'Notch transparency'), title: T('Izquierda: más transparente · derecha: negro sólido', 'Left: more transparent · right: solid black'),
        style: 'flex:1',
        on: { input: (ev: Event) => decir(+(ev.target as HTMLInputElement).value / 100), change: (ev: Event) => guardar({ transparencia: +(ev.target as HTMLInputElement).value / 100 }) } });
      return h('div', { class: 'campo', style: 'margin-top:12px' },
        h('strong', null, T('Transparencia del notch', 'Notch transparency')),
        h('div', { class: 'fila' }, h('small', { class: 'tenue' }, T('Más transparente', 'More see-through')), barra, h('small', { class: 'tenue' }, T('Sólido', 'Solid')), cuanto),
        h('small', null, T('Qué tanto se ve lo que hay detrás del notch en reposo, escuchando o con música. Al conversar, leer un aviso o pedir tu «sí» se vuelve casi opaco para que el texto se lea bien.', 'How much shows through the notch at rest, listening or with music. While chatting, showing a notice or asking for your “yes” it turns almost opaque so text stays readable.')));
    };

    // ── Posición del notch: el borde, el lado y el monitor. También se arrastra con el ratón. ──
    const notch = aj.notch ?? { borde: 'arriba', fraccion: 0.5, monitor: '', menosMovimiento: false };
    const monitores: { id: string; nombre: string; principal: boolean; actual: boolean }[] = (await pedir('notch.monitores').catch(() => null)) ?? [];
    const lado = notch.fraccion <= 0.001 ? 'izquierda' : notch.fraccion >= 0.999 ? 'derecha' : Math.abs(notch.fraccion - 0.5) < 0.001 ? 'centro' : 'libre';
    const mover = (cambio: Record<string, unknown>) => guardar({ notch: { borde: notch.borde, fraccion: notch.fraccion, ...cambio } });
    const elegirMonitor = monitores.length > 1
      ? h('div', { class: 'campo' }, h('strong', null, T('Monitor', 'Display')),
          h('select', { 'aria-label': T('Monitor del notch', 'Notch display'),
            on: { change: (ev: Event) => guardar({ notch: { monitor: (ev.target as HTMLSelectElement).value } }) } },
            ...monitores.map((m) => h('option', { value: m.id, selected: m.actual }, m.nombre))),
          h('small', null, T('También puedes arrastrarlo al otro monitor.', 'You can also drag it to the other display.')))
      : null;
    const posicion = h('div', { style: 'margin-top:6px' },
      h('strong', null, T('Posición del notch', 'Notch position')),
      eleccion(T('Borde', 'Edge'), [
        { valor: 'arriba', texto: T('Arriba', 'Top'), explica: T('Pegado al borde de arriba, como el de la cámara.', 'Attached to the top edge, like the camera notch.') },
        { valor: 'abajo', texto: T('Abajo', 'Bottom'), explica: T('Apoyado encima de la barra de tareas; crece hacia arriba.', 'Resting above the taskbar; it grows upwards.') },
      ], notch.borde === 'abajo' ? 'abajo' : 'arriba', (v) => mover({ borde: v })),
      eleccion(T('Lado', 'Side'), [
        { valor: 'izquierda', texto: T('Izquierda', 'Left'), explica: T('En la esquina izquierda.', 'In the left corner.') },
        { valor: 'centro', texto: T('Centro', 'Center'), explica: T('Al centro (arriba, con la cámara).', 'Centered (at the top, with the camera).') },
        { valor: 'derecha', texto: T('Derecha', 'Right'), explica: T('En la esquina derecha.', 'In the right corner.') },
      ], lado as 'izquierda' | 'centro' | 'derecha', (v) => mover({ fraccion: v === 'izquierda' ? 0 : v === 'derecha' ? 1 : 0.5 })),
      elegirMonitor,
      h('div', { class: 'fila', style: 'flex-wrap:wrap;margin-top:4px' },
        boton(T('Restablecer posición', 'Reset position'), async () => { try { await pedir('notch.restablecer'); } catch (err: any) { avisar(err.message, 'mal', 7000); } },
          { tipo: 'fantasma', titulo: T('Arriba al centro del monitor principal', 'Top center of the main display') })),
      h('p', { class: 'nota' }, T('Arrástralo desde la píldora por el borde de la pantalla: al soltarlo se pega a la izquierda, al centro o a la derecha, arriba o abajo. Nunca queda flotando en medio. Doble clic en la píldora: vuelve arriba al centro.', 'Drag it from the pill along the screen edge: it snaps left, center or right, top or bottom. It never floats mid-screen. Double-click the pill to send it back to the top center.')),
      interruptor(T('Menos movimiento', 'Reduce motion'), T('El avatar se queda quieto (sin mirar al cursor, parpadear ni saltar) y el notch cambia sin animar. Windows también lo activa con «Efectos de animación» apagado.', 'The avatar stays still and the notch changes without animating. Windows “Animation effects” off does this too.'), !!notch.menosMovimiento, (v) => guardar({ notch: { menosMovimiento: v } })));

    // ── Avatar e idioma ──
    const avatar = seccion('avatar', T('Avatar, idioma y notch', 'Avatar, language & notch'),
      eleccion(T('Avatar', 'Avatar'), [
        { valor: 'aura', texto: 'AU-RA', explica: T('Cálida y precisa.', 'Warm and precise.') },
        { valor: 'claudio', texto: 'Claudio', explica: T('Creativo: ideas, marketing y contenido.', 'Creative.') },
        { valor: 'antonio', texto: 'ANT-ONIO', explica: T('Directo y técnico.', 'Direct and technical.') },
        { valor: 'ojos', texto: 'Guardián', explica: T('Sereno; seguridad y cuidado del espacio.', 'Calm guardian.') },
      ], aj.avatar, (v) => { aplicarAcento(v); guardar({ avatar: v }); }),
      eleccion(T('Idioma', 'Language'), [
        { valor: 'es', texto: 'Español', explica: T('AURA te habla y te escucha en español.', 'Spanish.') },
        { valor: 'en', texto: 'English', explica: T('AURA habla y escucha en inglés.', 'AURA speaks and listens in English.') },
      ], aj.idioma, (v) => guardar({ idioma: v }).then(() => cargar())),
      vidrio(aj.transparencia ?? 0.5),
      posicion);

    // ── Voz y escucha ──
    const voz = seccion('voz', T('Voz y escucha', 'Voice & listening'),
      eleccion(T('Cómo te escucha', 'How it listens'), [
        { valor: 'palabra', texto: T('«Oye AURA»', '“Hey AURA”'), explica: T('Recomendado. Tu PC espera «Oye AURA»: la palabra se reconoce en el equipo y hasta oírla no se envía audio. Después lo que dices va al servidor para entenderlo, mientras conversan.', 'Recommended: your PC waits for “Hey AURA”, recognized on this PC; no audio is sent until it hears it. Then what you say goes to the server while you talk.') },
        { valor: 'siempre', texto: T('Siempre atenta', 'Always attentive'), explica: T('Micrófono abierto: atiende cuando la nombras o mientras conversan. Lo que dices se envía al servidor para entenderlo.', 'Mic open: answers when named.') },
        { valor: 'pedir', texto: T('Solo si lo pido', 'Only when asked'), explica: T('Solo con Ctrl+Alt+Espacio o tocando el micrófono del notch.', 'Only with Ctrl+Alt+Space.') },
      ], aj.escucha, (v) => guardar({ escucha: v })),
      eleccion(T('Cómo conversa', 'How it talks'), [
        { valor: 'agente', texto: T('En vivo', 'Live'), explica: T('Recomendado. Como la llamada del teléfono: te contesta más rápido y la puedes interrumpir. Usa la voz de ElevenLabs en tiempo real.', 'Recommended: like the phone call, faster and you can interrupt.') },
        { valor: 'local', texto: T('Frase por frase', 'Phrase by phrase'), explica: T('El oído de siempre: graba tu frase, la entiende y contesta. Se usa sola si la de en vivo no abre.', 'The classic ear: records, understands, answers.') },
      ], aj.vozMotor ?? 'agente', (v) => guardar({ vozMotor: v })),
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
        h('span', { class: 'foto dorada' }, icono(ico, 18)),
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
    const registro = h('pre', { class: 'aj-registro' });
    const privacidad = seccion('privacidad', T('Privacidad y diagnóstico', 'Privacy & diagnostics'),
      h('ul', { class: 'nota', style: 'line-height:1.8;padding-left:18px' },
        h('li', null, T('La pantalla se lee en tu PC (UI Automation y OCR de Windows): al cerebro va solo texto, nunca imágenes.', 'Screen is read locally.')),
        h('li', null, T('Tu sesión, tokens y llaves de PULSE2CHAT se guardan cifrados con Windows (DPAPI): solo tu usuario los abre.', 'Secrets encrypted with DPAPI.')),
        h('li', null, T('La cartera es solo lectura: AURA nunca mueve dinero.', 'Wallet is read-only.')),
        h('li', null, T('El registro guarda tiempos y tipos, no lo que dices: eso solo con «Registro detallado» (y aun así sin correos, enlaces con claves ni números largos).', 'The log keeps timings, not what you say, unless detailed logging is on.'))),
      interruptor(T('Registro detallado', 'Detailed log'), T('Para afinar el micrófono: guarda también lo que dijiste y las órdenes (recortado y saneado). Apágalo al terminar.', 'Also keeps what you said (trimmed and sanitized). Turn off when done.'),
        !!aj.registroDetallado, (v) => guardar({ registroDetallado: v })),
      h('div', { class: 'fila', style: 'flex-wrap:wrap' },
        boton(T('Ver registro', 'View log'), async () => { registro.textContent = await pedir('diagnostico.leer'); registro.style.display = 'block'; registro.scrollTop = registro.scrollHeight; }, { titulo: T('Qué hizo AURA y cuánto tardó cada paso (sin contraseñas ni tokens)', 'What AURA did and how long each step took') }),
        boton(T('Copiar registro', 'Copy log'), async () => { await navigator.clipboard.writeText(await pedir('diagnostico.leer')); avisar(T('Copiado. Pégalo en el chat para que lo revisemos.', 'Copied.'), 'ok'); }, { titulo: T('Para mandarlo si algo falla', 'To send if something fails') }),
        boton(T('Abrir carpeta', 'Open folder'), () => pedir('diagnostico.carpeta'), { tipo: 'fantasma', titulo: '%LOCALAPPDATA%\\AuraWindows' })),
      registro);

    // ── Actualizaciones (por el aire) ──
    const act: any = await pedir('actualizar.estado').catch(() => null);
    const estadoAct = h('p', { class: 'nota', role: 'status' },
      act?.lista ? T(`Hay una versión nueva lista (${act.nueva}).`, `A new version is ready (${act.nueva}).`) : T(`Tienes la versión ${act?.version ?? e.version}${act?.commit ? ' · ' + act.commit : ''}.`, `You have version ${act?.version ?? e.version}.`));
    const instalar = boton(T('Actualizar ahora', 'Update now'), async () => {
      instalar.disabled = true;
      estadoAct.textContent = T('Preparando la actualización… AURA se cerrará y volverá sola en unos segundos.', 'Preparing the update… AURA will close and come back.');
      const r: any = await pedir('actualizar.instalar', null, 600_000).catch((x: any) => ({ ok: false, motivo: x.message }));
      if (r && r.ok === false) { estadoAct.textContent = r.motivo || T('No se pudo actualizar.', 'Update failed.'); instalar.disabled = false; }
    }, { tipo: 'acento', icono: 'actualizar', titulo: T('Instala la versión nueva (ya verificada) y AURA vuelve sola en segundos', 'Installs the verified new version') });
    if (!act?.lista && !act?.nueva) instalar.style.display = 'none';
    const actualizar = seccion('actualizar', T('Actualizaciones', 'Updates'),
      h('p', { class: 'nota' }, T('AURA se actualiza por internet desde el GitHub del proyecto: baja la versión nueva, comprueba que sea la original (SHA-256) y se instala en segundos, sin volver a descargar nada a mano.', 'AURA updates over the air from the project GitHub, verified by SHA-256.')),
      interruptor(T('Instalar sola las versiones nuevas', 'Install new versions automatically'),
        T('Cuando llevas 10 minutos sin usar la PC y no hay nada en curso. Si lo apagas, te avisa en el notch y tú eliges cuándo.', 'When the PC has been idle for 10 minutes. Off: the notch asks you.'),
        !!aj.actualizarSolo, (v) => guardar({ actualizarSolo: v })),
      estadoAct,
      h('div', { class: 'fila', style: 'flex-wrap:wrap' },
        boton(T('Buscar ahora', 'Check now'), async () => {
          estadoAct.textContent = T('Buscando…', 'Checking…');
          const r: any = await pedir('actualizar.buscar', null, 600_000).catch((x: any) => ({ error: x.message }));
          estadoAct.textContent = r?.error ?? (r?.lista ? T(`Versión nueva lista (${r.nueva}).`, `New version ready (${r.nueva}).`) : T('Ya tienes la última versión.', 'You have the latest version.'));
          instalar.style.display = r?.lista || r?.nueva ? '' : 'none';
        }, { titulo: T('Mira si hay una versión nueva y la baja', 'Checks for and downloads a new version') }),
        instalar));

    // ── Atajos ──
    const tecla = (k: string, que: string) => h('div', { class: 'atajo' }, h('span', null, que), h('kbd', null, k));
    const atajos = seccion('atajos', T('Atajos', 'Shortcuts'),
      tecla('Ctrl+Alt+Espacio', T('Hablarle', 'Talk')), tecla('Ctrl+Alt+C', T('Abrir este Centro', 'Open this Center')), tecla('Ctrl+Alt+A', T('Chat rápido en el notch', 'Quick chat in the notch')),
      tecla('Ctrl+Alt+W', T('Elegir la ventana donde escribirá', 'Pick the window to type into')), tecla('Ctrl+Alt+Esc', T('Pausar todo (micrófono, voz y acciones)', 'Pause everything')),
      h('div', { style: 'margin-top:16px' }, boton(T('Ver el recorrido', 'Watch the tour'), () => window.dispatchEvent(new Event('centro:recorrido')), { icono: 'play', titulo: T('Claudio y ANT-ONIO te enseñan todo lo que hace AURA en tu computadora', 'Claudio and ANT-ONIO show you everything AURA does on your PC') })),
      // Acerca de: la marca, la versión y la firma.
      h('div', { class: 'acerca' },
        punzon(44, { chica: true }),
        h('div', null, wordmark(), h('dl', null,
          h('div', null, h('dt', null, T('Versión', 'Version')), h('dd', null, e.version)),
          act?.commit ? h('div', null, h('dt', null, 'Commit'), h('dd', null, act.commit)) : null)),
        firma()));

    cuerpo.replaceChildren(cuenta, avatar, voz, conexiones, avisos, cuentas, privacidad, actualizar, atajos);
    // El espía mira dentro de `.contenido`: hasta que la vista está montada no hay dónde mirar.
    requestAnimationFrame(() => { if (vista.isConnected) espiar(); });
  }
  pintar().catch((e) => cuerpo.replaceChildren(tarjeta(null, h('p', null, e.message))));
  al('estado', () => { if (vista.isConnected) pintar().catch(() => {}); });
  return vista;
}
