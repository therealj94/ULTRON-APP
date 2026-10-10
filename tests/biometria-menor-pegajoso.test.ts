/**
 * EL «POSIBLE MENOR» NO SE PIERDE AL VOLVER A PRESENTAR A ALGUIEN (caras y voces).
 *
 * Reproducción sobre 01a1359: lib/biometria-consentimiento.ts unirConsentimiento tomaba la constancia NUEVA tal cual. Si
 * la dueña presentaba a «Nora» como «mi hija» (posible menor → por confirmar, no se reconoce) y después volvía a
 * presentarla sin decir el parentesco, el alta nueva no traía `menor` y Nora quedaba reconocible sin que la dueña la
 * confirmara en su pantalla. Contrato: la marca y su «por confirmar» son pegajosos; solo los quita la confirmación
 * explícita de la dueña (POST /api/caras|voces/:id/confirmar → confirmarConsentimiento*).
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'biometria-menor-'));
process.env.ULTRON_CARAS_DIR = path.join(dir, 'caras');
process.env.ULTRON_VOCES_DIR = path.join(dir, 'voces');
process.env.ULTRON_MEMORIA_BUCKET = '';
after(() => fs.rmSync(dir, { recursive: true, force: true }));

const caras = await import('../lib/caras-miembro');
const voces = await import('../lib/voces-miembro');
const consent = await import('../lib/biometria-consentimiento');

const vector = (k: number) => Array.from({ length: caras.LARGO_VECTOR }, (_, i) => Math.round(Math.sin(i * 0.37 + k) * 1e4) / 1e5);
const huella = (k: number) => Array.from({ length: voces.LARGO_HUELLA }, (_, i) => Math.round(Math.cos(i * 0.21 + k) * 1e4) / 1e5);
const permiso = { como: 'voz', frase: 'sí, puedes recordarme' };

test('unirConsentimiento: la marca de menor y su «por confirmar» sobreviven a un alta sin parentesco', () => {
  const hija = consent.consentimientoDeAlta({ relacion: 'conocido', crudo: permiso, nombre: 'Nora', nombreSesion: 'Ana', parentesco: 'hija', ahora: 1 });
  const otraVez = consent.consentimientoDeAlta({ relacion: 'conocido', crudo: permiso, nombre: 'Nora', nombreSesion: 'Ana', ahora: 2 });
  assert.equal(otraVez.menor, undefined, 'el alta nueva, sola, no dice menor');
  const unida = consent.unirConsentimiento(hija, otraVez);
  assert.equal(unida.menor, true, 'sigue siendo posible menor');
  assert.equal(consent.pendienteDeConfirmar(unida), true, 'y sigue por confirmar');
  assert.equal(consent.reconocible(unida), false);
  // Confirmada por la dueña: un alta posterior sin parentesco no la des-confirma ni le quita la marca.
  const confirmada = { ...hija, confirmadoEnPantalla: 5 };
  const despues = consent.unirConsentimiento(confirmada, otraVez);
  assert.equal(despues.menor, true);
  assert.equal(despues.confirmadoEnPantalla, 5);
  assert.equal(consent.reconocible(despues), true);
});

test('caras: «mi hija Nora» y luego «Nora» sin parentesco → sigue sin vectores para reconocer hasta que la dueña confirme', async () => {
  const correo = 'ana.caras@ejemplo.org';
  const a1 = caras.validarAlta({ nombre: 'Nora', relacion: 'conocido', parentesco: 'hija', vectores: [vector(1)], consentimiento: permiso }, 'Ana');
  assert.ok(a1.ok);
  const p1 = await caras.agregarCara(correo, a1 as any);
  assert.equal(consent.pendienteDeConfirmar(p1.consentimiento), true);
  const a2 = caras.validarAlta({ nombre: 'Nora', relacion: 'conocido', vectores: [vector(2)], consentimiento: permiso }, 'Ana');
  assert.ok(a2.ok);
  const p2 = await caras.agregarCara(correo, a2 as any);
  assert.equal(p2.id, p1.id, 'la misma persona');
  assert.equal(p2.consentimiento.menor, true);
  assert.deepEqual(caras.vectoresParaReconocer(p2), [], 'no se reconoce sin la confirmación de la dueña');
  caras._olvidarCacheCaras();
  const leida = (await caras.cargarCaras(correo)).personas.find((p) => p.id === p1.id)!;
  assert.equal(consent.pendienteDeConfirmar(leida.consentimiento), true, 'también tras releer del disco');
  const conf = await caras.confirmarConsentimientoCara(correo, p1.id);
  assert.ok(conf && caras.vectoresParaReconocer(conf).length > 0, 'confirmada por la dueña: ya se reconoce');
});

test('voces: lo mismo — el segundo alta sin «hija» no la vuelve reconocible', async () => {
  const correo = 'ana.voces@ejemplo.org';
  const a1 = voces.validarAltaVoz({ nombre: 'Nora', relacion: 'conocido', parentesco: 'hija', consentimiento: permiso }, 'Ana');
  assert.ok(a1.ok);
  const p1 = await voces.agregarVoz(correo, a1 as any, [huella(1)]);
  assert.equal(consent.pendienteDeConfirmar(p1.consentimiento), true);
  const a2 = voces.validarAltaVoz({ nombre: 'Nora', relacion: 'conocido', consentimiento: permiso }, 'Ana');
  assert.ok(a2.ok);
  const p2 = await voces.agregarVoz(correo, a2 as any, [huella(2)]);
  assert.equal(p2.id, p1.id);
  assert.equal(p2.consentimiento.menor, true);
  assert.equal(consent.reconocible(p2.consentimiento), false);
  const conf = await voces.confirmarConsentimientoVoz(correo, p1.id);
  assert.equal(consent.reconocible(conf!.consentimiento), true);
});
