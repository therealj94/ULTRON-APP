/**
 * Una marca y una entrada (auditoría visual del 7-oct, A5, A6, B1, B2): lo que se ve antes de entrar.
 *   · Un solo botón principal, «Entrar con Genesis ID»; correo y contraseña de Veta Wallet debajo, en secundario.
 *   · La marca visible es «AU-RA» (no «AURA» ni «PULSE 2CHAT × AURA»).
 *   · «Otras formas de entrar» NO enseña las cuentas de la junta (nombres y correos): solo la usada en este teléfono.
 *   · Lo que los flujos del emulador (pruebas/emulador/flujos) tocan sigue ahí: textos y testID.
 *   · De tú, no de vos.
 *
 *   cd mobile && npx tsx src/app/pantallas/pruebas/entrada.prueba.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(AQUI, '../../..');
const leer = (r) => fs.readFileSync(path.join(SRC, r), 'utf8');
/** Solo lo que se le dice a la persona: los textos de tr('…', '…') y los de JSX, sin comentarios. */
const textos = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

let fallos = 0;
let n = 0;
function prueba(nombre, f) {
  n++;
  try {
    f();
    console.log('ok -', nombre);
  } catch (e) {
    fallos++;
    console.log('FALLA -', nombre, '\n ', String(e?.message || e).slice(0, 400));
  }
}

const ENTRAR = leer('app/pantallas/Entrar.tsx');
const LOGIN = leer('screens/LoginScreen.tsx');

prueba('Entrar: un solo botón principal y es «Entrar con Genesis ID»; los demás, secundarios o de texto', () => {
  const botones = [...textos(ENTRAR).matchAll(/<Boton\b([\s\S]*?)\/>/g)].map((m) => m[1]);
  const principales = botones.filter((b) => !/variante=/.test(b));
  assert.equal(principales.length, 1, `un solo <Boton> sin variante (principal); hay ${principales.length}`);
  assert.match(principales[0], /tr\('Entrar con Genesis ID', 'Sign in with Genesis ID'\)/);
  assert.match(principales[0], /onPress=\{\(\) => void entrarGenesis\(\)\}/, 'abre la wallet');
  const clave = botones.find((b) => /entrarClave\(\)/.test(b) && /titulo=\{tr\('Entrar', 'Sign in'\)\}/.test(b));
  assert.match(clave, /variante="secundario"/, 'el de correo y contraseña, secundario');
  assert.ok(ENTRAR.indexOf("tr('Entrar con Genesis ID'") < ENTRAR.indexOf("tr('Tu cuenta de Veta Wallet'"), 'Genesis ID va primero, el formulario debajo');
});

prueba('una marca: «AU-RA» en lo que se ve (no «AURA», ni «PULSE 2CHAT × AURA»)', () => {
  for (const r of ['app/pantallas/Entrar.tsx', 'app/pantallas/Bienvenida.tsx', 'app/pantallas/CrearGenesis.tsx', 'app/pantallas/OtrasFormas.tsx', 'screens/LoginScreen.tsx', 'whatsapp/PantallaWhatsapp.tsx', 'pulse/PantallaConversacion.tsx']) {
    const t = textos(leer(r));
    assert.ok(!/['"`][^'"`\n]*\bAURA\b[^'"`\n]*['"`]/.test(t.replace(/import[^\n]*\n/g, '')), `${r}: «AURA» suelto en un texto`);
    assert.ok(!/PULSE 2CHAT × AURA/.test(t), r);
  }
  assert.match(ENTRAR, />\s*AU-RA\s*<\/Texto>/, 'la marca de la entrada');
});

prueba('«Otras formas de entrar» no enseña a la junta: ni sus nombres ni sus correos; solo la cuenta usada en este teléfono', () => {
  assert.doesNotMatch(LOGIN, /DESK_USERS/, 'la lista de la junta ya no se recorre');
  assert.doesNotMatch(textos(LOGIN), /ordonez|Medardo|José/, 'ningún nombre ni correo de la junta escrito en la pantalla');
  assert.doesNotMatch(LOGIN, /Cuentas de la junta/);
  assert.match(LOGIN, /useState<DeskUser>\(OTRO_TEMPLATE\)/, 'sin cuenta elegida por omisión (antes, la de José)');
  assert.match(LOGIN, /setUsada\(match\)/, 'la guardada en este teléfono sí se ofrece');
  assert.match(LOGIN, /tr\('En este teléfono', 'On this phone'\)/);
});

prueba('los flujos del emulador siguen encontrando lo suyo (textos y testID)', () => {
  assert.match(ENTRAR, /tr\('Entra con tu identidad'/, 'abrir.yaml');
  assert.match(ENTRAR, /tr\('Otras formas de entrar'/, 'entrar-correo.yaml');
  assert.match(LOGIN, /tr\('Otra cuenta', 'Another account'\)/);
  assert.match(LOGIN, /placeholder="correo@ordenglobal\.org"/);
  assert.match(LOGIN, /testID="entrar-correo"/);
  assert.match(LOGIN, /testID="entrar-clave"/);
  assert.match(LOGIN, /tr\('Entrar con clave', 'Sign in with password'\)/);
  assert.match(LOGIN, /tr\('Entrar solo al escritorio'/);
  assert.match(LOGIN, /etiqueta=\{tr\('Clave', 'Password'\)\}/);
});

prueba('los avatares de «te esperan adentro» salen del catálogo (antes faltaba ANT-ONIO)', () => {
  assert.doesNotMatch(LOGIN, /Guardián, AU-RA y Claudio te esperan/);
  assert.match(LOGIN, /enLista\(AVATARES\.map\(\(a\) => de\(a\.nombre\)\), 'y'\)/);
  assert.doesNotMatch(leer('app/pantallas/Intro.tsx'), /a AU-RA y a Claudio/);
});

prueba('de tú, no de vos, en lo que se ve al entrar y en los chats', () => {
  const VOS = /(?<![\p{L}])(entrá|tocá|probá|escribí|elegí|mirá|podés|tenés|querés|revisá|volvé|intentá|usá|pedí|confirmá|decime|permití|conectá|creá|poné)(?![\p{L}])/iu;
  for (const r of ['app/pantallas/Entrar.tsx', 'app/pantallas/Bienvenida.tsx', 'app/pantallas/CrearGenesis.tsx', 'app/pantallas/OtrasFormas.tsx', 'screens/LoginScreen.tsx', 'pulse/PantallaChats.tsx', 'pulse/PantallaConversacion.tsx', 'whatsapp/PantallaWhatsapp.tsx', 'whatsapp/ConversacionWA.tsx', 'correo/PantallaCorreos.tsx']) {
    const m = VOS.exec(textos(leer(r)));
    assert.equal(m, null, `${r}: «${m?.[0]}»`);
  }
});

console.log(`\n${n - fallos}/${n} pruebas de la entrada`);
process.exit(fallos ? 1 : 0);
