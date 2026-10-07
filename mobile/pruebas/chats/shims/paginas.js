// Las cuatro páginas de los chats, de mentira: cada una dibuja el cambio de pestañas que le pasan (`cambio`) y anota
// si está a la vista (`activa`). Lo que se prueba aquí es el envoltorio (whatsapp/ChatsConWhatsapp.tsx), no ellas.
const React = require('react');

const h = React.createElement;
const pagina = (nombre) =>
  function Pagina(props) {
    const vivo = (globalThis.__paginas = globalThis.__paginas || {});
    vivo[nombre] = props;
    return h('View', { pagina: nombre, activa: props.activa }, props.cambio || null);
  };

module.exports = {
  PantallaChats: pagina('pulse'),
  PantallaWhatsapp: pagina('whatsapp'),
  PantallaCorreos: pagina('correos'),
  PantallaCartera: pagina('cartera'),
  Letra: (props) => h('Text', props),
};
