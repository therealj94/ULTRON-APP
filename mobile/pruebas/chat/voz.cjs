// Contrato · Lo que AURA pide sobre el chat por el bus: redactar (borrador + abrir_chat), enviar
// (sale cifrado, avisa `enviado` y `hecho`), descartar; y a quién se refiere «con» (resolverContacto).
const { ok, fin, espera, arrancarRelevo, movil, entrarComo } = require('./comun.cjs');

(async () => {
  const R = await arrancarRelevo();
  const M = movil();
  const { RELEVO, CHATS, BORRADORES, CONTRATO } = M;
  console.log('contrato · redactar, enviar y descartar por voz\n');
  const A = await R.cuenta('José');
  const B = await R.cuenta('María José Núñez');
  const C = await R.cuenta('Roberto Castillo');
  await R.amigos(A, B);
  await R.amigos(A, C);
  await entrarComo(M, A);

  const eventos = [];
  for (const t of ['accion', 'hecho', 'enviado']) CONTRATO.escuchar(t, (d) => eventos.push({ t, d }));
  const esperar = async (f, ms = 4000) => {
    for (let i = 0; i < ms / 50; i++) {
      const e = eventos.find(f);
      if (e) return e;
      await espera(50);
    }
    return null;
  };

  // Sin haber abierto la lista todavía: redactar la trae sola para encontrar a quién.
  CONTRATO.emitir('accion', { tipo: 'redactar', para: 'maria jose', texto: 'Llego en veinte minutos' });
  const abrir = await esperar((e) => e.t === 'accion' && e.d.tipo === 'abrir_chat');
  const hechoR = await esperar((e) => e.t === 'hecho' && e.d.accion.tipo === 'redactar');
  ok('«maria jose» (sin acentos) es María José Núñez', abrir && abrir.d.con === B.correo, abrir && abrir.d.con);
  ok('redactar: hecho ok', hechoR && hechoR.d.ok === true, hechoR && hechoR.d.detalle);
  const bor = BORRADORES.borradorDe(B.correo);
  ok('queda el borrador, marcado como de voz (brillo dorado)', bor && bor.texto === 'Llego en veinte minutos' && bor.deVoz === true);
  ok('contactosConocidos trae a los dos', RELEVO.contactosConocidos().map((c) => c.correo).sort().join() === [B.correo, C.correo].sort().join());

  // La persona toca el borrador: deja de ser de voz.
  BORRADORES.escribirBorrador(B.correo, 'Llego en veinte minutos!');
  ok('editado a mano: se apaga el brillo', BORRADORES.borradorDe(B.correo).deVoz === false);

  // «Envíalo» con el chat abierto.
  BORRADORES.fijarChatAbierto({ correo: B.correo, nombre: 'María José Núñez' });
  ok('contextoChat: chat abierto y borrador', BORRADORES.contextoChat().chatAbierto?.correo === B.correo && BORRADORES.contextoChat().borrador === 'Llego en veinte minutos!');
  CONTRATO.emitir('accion', { tipo: 'enviar' });
  const hechoE = await esperar((e) => e.t === 'hecho' && e.d.accion.tipo === 'enviar');
  const env = eventos.find((e) => e.t === 'enviado');
  ok('enviar: hecho ok', hechoE && hechoE.d.ok === true, hechoE && hechoE.d.detalle);
  ok('enviar: avisa `enviado` con el id del relevo', env && env.d.para === B.correo && !!env.d.id);
  ok('el borrador se va al enviar', BORRADORES.borradorDe(B.correo) === null);
  const enRelevo = (await R.post('/bandeja', { ...B, desde: A.correo })).mensajes || [];
  ok('llegó al relevo (en claro solo si María no tiene aparato)', enRelevo.some((m) => m.id === env.d.id));
  const hilo = CHATS.estadoHilo(B.correo).mensajes || [];
  ok('y aparece en el hilo abierto sin recargar', hilo.some((m) => m.texto === 'Llego en veinte minutos!' && !m.pendiente));

  // Enviar a alguien por nombre parecido (una letra mal oída).
  CONTRATO.emitir('accion', { tipo: 'redactar', para: 'Roverto', texto: 'Mañana te llamo' });
  const abrir2 = await esperar((e) => e.t === 'accion' && e.d.tipo === 'abrir_chat' && e.d.con === C.correo);
  ok('«Roverto» es Roberto Castillo (letra mal oída)', !!abrir2);
  CONTRATO.emitir('accion', { tipo: 'descartar' });
  const hechoD = await esperar((e) => e.t === 'hecho' && e.d.accion.tipo === 'descartar');
  ok('descartar: sin chat abierto con borrador, borra el último que redactó AURA', hechoD && hechoD.d.ok && BORRADORES.borradorDe(C.correo) === null, hechoD && hechoD.d.detalle);

  // A quién no hay.
  CONTRATO.emitir('accion', { tipo: 'redactar', para: 'Zacarías', texto: 'hola' });
  const noEsta = await esperar((e) => e.t === 'hecho' && e.d.accion.tipo === 'redactar' && e.d.ok === false);
  ok('un nombre que no está: hecho ok:false y lo dice', !!noEsta, noEsta && noEsta.d.detalle);
  // A María se le acaba de enviar: un «envíalo» repetido en seguida es el mismo pedido (llegó por el SSE
  // y por el turno) y contesta lo mismo, sin mandar nada otra vez. A Roberto no se le envió nada.
  const antesRep = eventos.length;
  CONTRATO.emitir('accion', { tipo: 'enviar', para: B.correo });
  const rep = await esperar((e) => eventos.indexOf(e) >= antesRep && e.t === 'hecho' && e.d.accion.tipo === 'enviar');
  const enRelevo2 = (await R.post('/bandeja', { ...B, desde: A.correo })).mensajes || [];
  ok('«envíalo» repetido en seguida: el mismo resultado, sin mandar otro', rep && rep.d.ok === true && enRelevo2.length === enRelevo.length, rep && rep.d.detalle);
  CONTRATO.emitir('accion', { tipo: 'enviar', para: C.correo });
  const nada = await esperar((e) => e.t === 'hecho' && e.d.accion.tipo === 'enviar' && e.d.ok === false);
  ok('enviar sin borrador: hecho ok:false', !!nada, nada && nada.d.detalle);

  console.log('\nresolverContacto\n');
  ok('correo exacto', RELEVO.resolverContacto(C.correo.toUpperCase())?.correo === C.correo);
  ok('nombre exacto con acentos', RELEVO.resolverContacto('María José Núñez')?.correo === B.correo);
  ok('una palabra del nombre', RELEVO.resolverContacto('castillo')?.correo === C.correo);
  ok('el principio del nombre', RELEVO.resolverContacto('Rob')?.correo === C.correo);
  ok('nadie parecido → null', RELEVO.resolverContacto('Xy') === null);

  // Al salir se van los borradores con la cuenta.
  BORRADORES.escribirBorrador(C.correo, 'algo');
  await RELEVO.salir();
  ok('al salir no queda ningún borrador ni chat abierto', BORRADORES.borradorDe(C.correo) === null && BORRADORES.chatAbierto() === null);
  fin();
})().catch((e) => {
  console.error('ERR', e);
  process.exit(1);
});
