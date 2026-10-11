/**
 * Una marca y una entrada (auditoría visual del 7-oct, A5, A6, B1, B2): lo que se ve antes de entrar.
 *   · LA CUENTA DE AU-RA PRIMERO (José, 10-oct): correo, contraseña y el ÚNICO botón principal, «Entrar»; «Crear
 *     cuenta» bien a la vista (su pantalla, con la confirmación por código); debajo, las opciones «Entrar con Veta
 *     Wallet», «Abrir Orden Global» y «Crear cuenta en Veta Wallet».
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

prueba('Entrar: un solo botón principal y es «Entrar» de la cuenta de AU-RA; los demás, secundarios o de texto', () => {
  const botones = [...textos(ENTRAR).matchAll(/<Boton\b([\s\S]*?)\/>/g)].map((m) => m[1]);
  const principales = botones.filter((b) => !/variante=/.test(b));
  assert.equal(principales.length, 1, `un solo <Boton> sin variante (principal); hay ${principales.length}`);
  assert.match(principales[0], /titulo=\{tr\('Entrar', 'Sign in'\)\}/);
  assert.match(principales[0], /onPress=\{\(\) => void entrarCuenta\(\)\}/, 'entra con la cuenta de AU-RA');
  assert.match(ENTRAR, /loginClave\(c, clave, i\)/, 'por /api/ultron/entrar, con su intento');
  assert.match(ENTRAR, /entrarCon\(u, null, i\)/, 'y la sesión de siempre (app/sesion.ts entrarCon)');
});

prueba('«Crear cuenta» a la vista, antes de las opciones; las opciones: Veta Wallet, Orden Global y crear cuenta en Veta Wallet', () => {
  const t = textos(ENTRAR);
  const crear = t.indexOf("tr('Crear cuenta', 'Create account')");
  const veta = t.indexOf("tr('Entrar con Veta Wallet', 'Sign in with Veta Wallet')");
  const og = t.indexOf("tr('Abrir Orden Global', 'Open Orden Global')");
  const crearVeta = t.indexOf("tr('Crear cuenta en Veta Wallet', 'Create a Veta Wallet account')");
  assert.ok(crear > 0 && veta > crear && og > veta && crearVeta > og, 'cuenta de AU-RA → Veta Wallet → Orden Global → crear en Veta Wallet');
  assert.match(t, /navigation\.navigate\('CrearCuenta'/, '«Crear cuenta» abre su pantalla');
  assert.match(t, /onPress=\{\(\) => void entrarGenesis\(\)\}/, '«Abrir Orden Global» es el botón de Genesis de siempre');
  assert.match(t, /entrarConVetaWallet\(c, clave\)/, 'Veta Wallet sigue por lib/genesis.ts (con su respaldo sin Genesis)');
  assert.match(t, /void entrarGenesis\(\{ web: true \}\)/, 'crear en Veta Wallet: la web con la vuelta de siempre');
});

prueba('errores precisos debajo del formulario: contraseña mala ≠ sin conexión (lib/cuentaPropia.ts)', () => {
  assert.match(ENTRAR, /setErrorA\(ec\)/);
  assert.match(ENTRAR, /errorDeEntrada\(err\)/);
  assert.match(ENTRAR, /error=\{errorA\?\.campo === 'clave' \? errorA\.mensaje : undefined\}/, 'la contraseña mala, debajo de su campo');
  const CUENTA = leer('lib/cuentaPropia.ts');
  assert.match(CUENTA, /if \(!status\) return sinConexion\(\)/, 'sin respuesta es la red, nunca «contraseña incorrecta»');
});

prueba('«Crear cuenta»: nombre, correo, contraseña y confirmarla; después el código con «Reenviar»; SIN «Confirmar después»', () => {
  const CREAR = textos(leer('app/pantallas/CrearCuenta.tsx'));
  for (const t of ["tr('Nombre', 'Name')", "tr('Correo', 'Email')", "tr('Contraseña', 'Password')", "tr('Confirmar contraseña', 'Confirm password')", "tr('Código', 'Code')", "tr('Reenviar código', 'Resend code')", "tr('Volver a entrar', 'Back to sign in')"]) {
    assert.ok(CREAR.includes(t), t);
  }
  assert.ok(!CREAR.includes('Confirmar después'), 'sin el código no se entra: no hay «Confirmar después»');
  const botones = [...CREAR.matchAll(/<Boton\b([\s\S]*?)\/>/g)].map((m) => m[1]);
  assert.equal(botones.filter((b) => !/variante=/.test(b)).length, 2, 'un principal por paso («Crear cuenta» y «Confirmar»)');
  // Crear NO da sesión: ni intento ni entrarCon en ese paso; solo el código la da.
  assert.match(CREAR, /await crearCuenta\(nombre, correo, clave\);\s*if \(!vivo\.current\) return;[\s\S]*?setPaso\('codigo'\)/, 'después de crear, al código');
  const crear = CREAR.slice(CREAR.indexOf('const crear = async'), CREAR.indexOf('const confirmarCodigo = async'));
  assert.doesNotMatch(crear, /entrarCon|empezarIntento/, 'crear la cuenta no entra');
  assert.match(CREAR, /confirmarCodigoCorreo\(correo, clave, k, i\)/, 'el código, con el correo y la contraseña, abre la sesión');
  assert.match(CREAR, /entrarCon\(\{ name: r\.miembro\.nombre/, 'y la sesión de siempre (app/sesion.ts entrarCon)');
  assert.match(leer('app/AppAura.tsx'), /<Pila\.Screen name="CrearCuenta" component=\{CrearCuenta\} \/>/);
});

prueba('Entrar con una cuenta sin confirmar (CORREO_SIN_CONFIRMAR): a la pantalla del código, sin sesión', () => {
  assert.match(ENTRAR, /err\?\.data\?\.codigo === 'CORREO_SIN_CONFIRMAR'/);
  assert.match(ENTRAR, /pedirCodigoPara\(c, clave\);\s*navigation\.navigate\('CrearCuenta', \{ correo: c, paso: 'codigo' \}\)/, 'correo y clave en memoria, nunca en la navegación');
  assert.match(ENTRAR, /cancelarIntento\(i\)/, 'ese intento no deja nada guardado');
});

prueba('una marca: «AU-RA» en lo que se ve (no «AURA», ni «PULSE 2CHAT × AURA»)', () => {
  for (const r of ['app/pantallas/Entrar.tsx', 'app/pantallas/CrearCuenta.tsx', 'app/pantallas/Bienvenida.tsx', 'app/pantallas/CrearGenesis.tsx', 'app/pantallas/OtrasFormas.tsx', 'screens/LoginScreen.tsx', 'whatsapp/PantallaWhatsapp.tsx', 'pulse/PantallaConversacion.tsx']) {
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
  assert.match(ENTRAR, /tr\('Entra a AU-RA'/, 'abrir.yaml');
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
  for (const r of ['app/pantallas/Entrar.tsx', 'app/pantallas/CrearCuenta.tsx', 'lib/cuentaPropia.ts', 'app/pantallas/Bienvenida.tsx', 'app/pantallas/CrearGenesis.tsx', 'app/pantallas/OtrasFormas.tsx', 'screens/LoginScreen.tsx', 'pulse/PantallaChats.tsx', 'pulse/PantallaConversacion.tsx', 'whatsapp/PantallaWhatsapp.tsx', 'whatsapp/ConversacionWA.tsx', 'correo/PantallaCorreos.tsx']) {
    const m = VOS.exec(textos(leer(r)));
    assert.equal(m, null, `${r}: «${m?.[0]}»`);
  }
});

console.log(`\n${n - fallos}/${n} pruebas de la entrada`);
process.exit(fallos ? 1 : 0);
