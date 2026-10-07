/**
 * EL AVATAR NO CAMBIA POR UNA FRASE OÍDA (José, 7-oct, 00:31 UTC, mesa de AU-RA, APK 5.6.0): el oído entendió
 * «Necesito que cambies a Claudio» (él no lo dijo) y la app pasó de AU-RA a Claudio sin preguntar; luego «Me cambió a
 * Claudio» no lo devolvía. lib/acciones-app.ts (ordenDeAvatar, prepararAcciones). Frases y nombres inventados.
 *
 *  · una orden de cambiar (por reglas, por Laya o pedida por el modelo) solo PREGUNTA «¿Te paso con Claudio?»;
 *  · el «sí» claro del turno SIGUIENTE la cumple; un «no» la suelta; otra frase en medio la deja vieja (no se cumple);
 *  · la queja («me cambió», «¿qué cambiaste?», «yo estaba hablando con Aura», «regresa») vuelve al de antes al instante
 *    y lo dice en una frase; «me cambió el turno en el trabajo» no es del avatar.
 *
 * Con main (2cfc26f) falla: «cambia a Claudio» cambiaba al momento, «Necesito que cambies a Claudio» iba al modelo (que lo
 * cambiaba sin preguntar), y no había ni la pregunta ni la vuelta por queja.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  abrirTurnoApp,
  anotarAvatarPropuesto,
  anotarCambioAvatar,
  avatarPropuestoAnterior,
  cambioAvatarReciente,
  ordenDeEtiqueta,
  ordenPorReglas,
  prepararAcciones,
  quejaDeAvatar,
  sinFraseDeAvatar,
  soltarCambioAvatar,
  turnoAppVigente,
  VENTANA_QUEJA_AVATAR_MS,
  type AccionApp,
} from '../lib/acciones-app';

const AMB = 'persona.avatar@prueba.hn#tel-1';

describe('el avatar por voz: preguntar, cumplir con «sí», volver con la queja', () => {
  it('«Necesito que cambies a Claudio» (lo que oyó mal el oído) no cambia nada: pregunta «¿Te paso con Claudio?»', () => {
    const r = ordenPorReglas('Necesito que cambies a Claudio.', { avatarActual: 'aura' });
    assert.ok(r, 'antes iba al modelo, que lo cambiaba sin preguntar');
    assert.equal(r.accion, null);
    assert.equal(r.avatarPropuesto, 'claudio');
    assert.equal(r.decir, '¿Te paso con Claudio?');
    for (const t of ['cambia a Claudio', 'pásame con Claudio', 'quiero hablar con Claudio', 'switch me to claudio']) {
      const o = ordenPorReglas(t, { avatarActual: 'aura', idioma: /switch/.test(t) ? 'en' : 'es' });
      assert.equal(o?.accion ?? null, null, `${t}: no cambia sin preguntar`);
      assert.equal(o?.avatarPropuesto, 'claudio', t);
    }
    // Ya está con ese: no hay nada que preguntar.
    assert.equal(ordenPorReglas('cambia a Claudio', { avatarActual: 'claudio' })?.decir, 'Ya estás con Claudio.');
    // Laya (la etiqueta del nodo o la ligera) tampoco lo cambia: pregunta.
    const laya = ordenDeEtiqueta('app_avatar', 'necesito que cambies a claudio', 'laya', { avatarActual: 'aura' });
    assert.equal(laya?.accion, null);
    assert.equal(laya?.avatarPropuesto, 'claudio');
  });

  it('el «sí» claro del turno siguiente lo cumple; «no» lo suelta; otra frase en medio lo deja viejo', () => {
    // Turno n: se pregunta.
    abrirTurnoApp(AMB);
    anotarAvatarPropuesto(AMB, 'claudio', 'aura');
    // Turno n+1: «sí».
    abrirTurnoApp(AMB);
    const prop = avatarPropuestoAnterior(AMB);
    assert.deepEqual(prop, { valor: 'claudio', antes: 'aura' });
    const si = ordenPorReglas('Sí.', { avatarActual: 'aura', avatarPropuesto: prop });
    assert.deepEqual(si?.accion, { tipo: 'avatar', valor: 'claudio' });
    assert.deepEqual(si?.cambioAvatar, { antes: 'aura', ahora: 'claudio' });
    assert.equal(si?.soltarAvatar, true);
    // «No»: no cambia y se suelta.
    const no = ordenPorReglas('No.', { avatarActual: 'aura', avatarPropuesto: prop });
    assert.equal(no?.accion, null);
    assert.equal(no?.soltarAvatar, true);
    // Un «sí» que contesta otra cosa (con otra frase en medio): la pregunta ya venció.
    abrirTurnoApp(AMB);
    anotarAvatarPropuesto(AMB, 'claudio', 'aura');
    abrirTurnoApp(AMB); // otra frase («¿Qué tenemos pendiente?»)
    abrirTurnoApp(AMB); // y ahora el «sí»
    assert.equal(avatarPropuestoAnterior(AMB), null, 'la orden que llega tarde se descarta');
    assert.equal(ordenPorReglas('Sí.', { avatarActual: 'aura', avatarPropuesto: avatarPropuestoAnterior(AMB) }), null);
    // Con otra cosa esperando su «sí» (un mensaje), el «sí» suelto no decide: pregunta cuál.
    const ambiguo = ordenPorReglas('sí', { avatarActual: 'aura', avatarPropuesto: { valor: 'claudio', antes: 'aura' }, pendiente: { para: 'ana@prueba.hn', texto: 'llego a las 5' } });
    assert.equal(ambiguo?.accion, null);
    assert.match(ambiguo?.decir || '', /^¿Cuál: pasarte con Claudio, o el mensaje para/);
  });

  it('el turno viejo deja de valer cuando llega otra frase (turnoAppVigente)', () => {
    const n = abrirTurnoApp(AMB);
    assert.equal(turnoAppVigente(AMB, n), true);
    abrirTurnoApp(AMB);
    assert.equal(turnoAppVigente(AMB, n), false);
  });

  it('la queja vuelve al avatar de antes al instante, en una frase y sin bromas (las frases del 7-oct)', () => {
    const cambio = { antes: 'aura' as const, ahora: 'claudio' as const, t: Date.now() - 60_000 };
    for (const t of ['Me cambió a Claudio.', '¿Qué cambiaste, Claudio? Si yo no-', 'Sí, pero yo estaba hablando con Aura y- Avatar y de repen-', 'Yo no te pedí eso', 'regresa', 'Vuelve a Aura']) {
      const r = ordenPorReglas(t, { avatarActual: 'claudio', cambioAvatar: cambio });
      assert.deepEqual(r?.accion, { tipo: 'avatar', valor: 'aura' }, t);
      assert.equal(r?.decir, 'Perdón, ya volví: soy AU-RA otra vez.', t);
      assert.equal(r?.avatarDevuelto, true, t);
    }
    // Con el cambio reciente, lo que habla de otra cosa no lo deshace.
    for (const t of ['¿Qué cambiaste en el documento?', 'Me cambió el horario el jefe.']) assert.equal(ordenPorReglas(t, { avatarActual: 'claudio', cambioAvatar: cambio }), null, t);
    // Una queja que no dice de qué («yo no te pedí eso») solo justo después del cambio.
    assert.equal(ordenPorReglas('Yo no te pedí eso', { avatarActual: 'claudio', cambioAvatar: { ...cambio, t: Date.now() - 10 * 60_000 } }), null);
    // Sin un cambio reciente, «regresa» es atrás (como siempre) y «me cambió el turno en el trabajo» no es del avatar.
    assert.deepEqual(ordenPorReglas('regresa', {})?.accion, { tipo: 'atras' });
    assert.equal(quejaDeAvatar('me cambio el turno en el trabajo', { hayCambio: false }), null);
    assert.equal(ordenPorReglas('Me cambió el turno en el trabajo.', { avatarActual: 'aura' }), null);
    // Pasada la ventana, la queja ya no deshace un cambio viejo; nombrar a dónde volver sí vale.
    const viejo = { ...cambio, t: Date.now() - VENTANA_QUEJA_AVATAR_MS - 1_000 };
    assert.deepEqual(ordenPorReglas('Vuelve a Aura', { avatarActual: 'claudio', cambioAvatar: viejo })?.accion, { tipo: 'avatar', valor: 'aura' });
    // Se queja sin que este servidor sepa del cambio: no se adivina a cuál volver, se pregunta.
    const sinDato = ordenPorReglas('Me cambió a Claudio.', { avatarActual: 'claudio' });
    assert.equal(sinDato?.accion, null);
    assert.match(sinDato?.decir || '', /^¿Con quién quieres seguir: /);
  });

  it('el cambio guardado vale en su ventana y se suelta al volver', () => {
    anotarCambioAvatar(AMB, 'aura', 'claudio');
    assert.equal(cambioAvatarReciente(AMB)?.antes, 'aura');
    soltarCambioAvatar(AMB);
    assert.equal(cambioAvatarReciente(AMB), null);
  });

  it('el modelo pide el avatar: no sale en este turno (se pregunta); con el «sí» a esa pregunta, sí', () => {
    let preguntado: string | null = null;
    const sale = prepararAcciones([{ tipo: 'avatar', valor: 'claudio' } as AccionApp], { mensaje: 'Necesito que cambies a Claudio.', avatarActual: 'aura', alProponerAvatar: (v) => (preguntado = v) });
    assert.deepEqual(sale, [], 'antes salía [{ tipo: avatar, valor: claudio }] y la app cambiaba sola');
    assert.equal(preguntado, 'claudio');
    let cambio: unknown = null;
    const conSi = prepararAcciones([{ tipo: 'avatar', valor: 'claudio' } as AccionApp], {
      mensaje: 'Sí.',
      avatarActual: 'aura',
      avatarPropuesto: { valor: 'claudio', antes: 'aura' },
      alCambioAvatar: (c) => (cambio = c),
    });
    assert.deepEqual(conSi, [{ tipo: 'avatar', valor: 'claudio' }]);
    assert.deepEqual(cambio, { antes: 'aura', ahora: 'claudio' });
    // Lo que el modelo dio por hecho («ya me pongo en Claudio») se quita: no cambió nada.
    assert.equal(sinFraseDeAvatar('Ahí va, ya me pongo en Claudio. ¿Algo más?'), '¿Algo más?');
    assert.equal(sinFraseDeAvatar('Je, sí, me cambié de ropa. Era Aura, ahora soy Claudio. El oro subió hoy.'), 'El oro subió hoy.');
  });
});
