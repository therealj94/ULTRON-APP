// B3, B4, B6, B7 y el azar · Contra el relevo real: un aparato que se hace pasar por el mío, la
// caché de fotos con tope que se vacía al salir, la foto que no sube si no hay a quién cerrársela,
// el emoji partido y los bytes al azar de más de 1024.
const { ok, fin, arrancarRelevo, movil, entrarComo } = require('./comun.cjs');
const nc = require('node:crypto');

(async () => {
  const R = await arrancarRelevo();
  const M = movil();
  const { RELEVO, CANDADO, AZAR } = M;

  console.log('B3 · aparato ajeno con el id del mío\n');
  const V = await R.cuenta('Vera');
  const X = await R.cuenta('Xavi');
  await R.amigos(X, V);
  await entrarComo(M, V);
  const mia = await CANDADO.miLlave();
  const { publicKey } = nc.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const j = publicKey.export({ format: 'jwk' });
  const pubX = Buffer.concat([Buffer.from([4]), Buffer.from(j.x, 'base64url'), Buffer.from(j.y, 'base64url')]).toString('base64url');
  const idX = CANDADO.idDeAparato(pubX);
  await R.post('/llaves/publicar', { ...X, id: idX, pub: pubX });
  const falso = await R.post('/llaves/publicar', { ...X, id: mia.id, pub: pubX });
  console.log(`        (el relevo ${falso.st === 200 ? 'ACEPTÓ' : 'rechazó (' + falso.st + ')'} el aparato con el id ajeno; el teléfono no debe depender de eso)`);
  const r = await RELEVO.enviar(X.correo, 'secreto de Vera');
  const b = await RELEVO.bandeja(X.correo);
  const propio = b.mensajes.find((m) => m.de === V.correo);
  ok('sale cifrado', r.e2e === true);
  ok('Vera relee lo que acaba de mandar (su sobre es para SU llave)', propio && !propio.cerrado && propio.texto === 'secreto de Vera', propio && JSON.stringify(propio.texto));
  // Directo en el candado: la lista trae un impostor con mi id ANTES que el mío, y uno con id inventado.
  const bulto = await CANDADO.cerrar('hola', [{ id: mia.id, pub: pubX }, { id: 'inventado0000000000000', pub: pubX }, { id: idX, pub: pubX }]);
  const ids = bulto.s.map((s) => s.a);
  ok('dedup: el propio primero, una vez', ids[0] === mia.id && ids.filter((x) => x === mia.id).length === 1, ids.join(','));
  ok('dedup: fuera el id que no es b64url(sha256(pub))[:22]', !ids.includes('inventado0000000000000') && ids.includes(idX));
  ok('y el bulto abre aquí', (await CANDADO.abrir(bulto, [{ id: mia.id, pub: mia.pub, fir: mia.fir }]))?.texto === 'hola');

  console.log('\nB6 · la foto no sube si no hay a quién cerrársela\n');
  const N = await R.cuenta('Nadia');
  await R.amigos(N, V);
  let subidas = 0;
  const fetchReal = globalThis.fetch;
  globalThis.fetch = (u, o) => {
    if (String(u).endsWith('/subir')) subidas++;
    return fetchReal(u, o);
  };
  const foto = nc.randomBytes(3000).toString('base64');
  let motivo = '';
  try {
    await RELEVO.enviarFoto(N.correo, foto);
  } catch (e) {
    motivo = e.motivo || e.message;
  }
  ok('sin aparatos del otro lado: no sale, y dice por qué', motivo === 'sin-aparatos', motivo);
  ok('…y NO se subieron bytes al relevo', subidas === 0, String(subidas));
  const envio = await RELEVO.enviarFoto(X.correo, foto, 'image/jpeg', 'mira');
  ok('con aparatos: sube una vez y sale cifrada', envio.e2e === true && subidas === 1, String(subidas));
  const conFoto = (await RELEVO.bandeja(X.correo)).mensajes.find((m) => m.tipo === 'imagen');
  ok('el mensaje trae la llave de la foto por dentro', !!(conFoto && conFoto.llaveArchivo && conFoto.ivArchivo && conFoto.texto === 'mira'));
  const uri = await RELEVO.archivoAbierto(conFoto.archivo, conFoto.llaveArchivo, conFoto.ivArchivo);
  ok('y la foto abre igual a la que salió', uri && Buffer.from(uri.split(',')[1], 'base64').equals(Buffer.from(foto, 'base64')));
  globalThis.fetch = fetchReal;

  console.log('\nB4 · las fotos abiertas: tope y salida\n');
  const ids45 = [];
  for (let i = 0; i < 45; i++) {
    const c = CANDADO.cerrarBytes(nc.randomBytes(200));
    const s = await R.post('/subir', { ...X, nombre: 'f.jpg', tipo: 'imagen', mime: 'image/jpeg', datos: Buffer.from(c.bytes).toString('base64') });
    if (s.id) ids45.push({ id: s.id, llave: c.llave, iv: c.iv });
  }
  ok('el relevo guardó las 45 de prueba', ids45.length === 45, String(ids45.length));
  for (const f of ids45) await RELEVO.archivoAbierto(f.id, f.llave, f.iv);
  ok('en memoria quedan como mucho 40 (se va la más vieja)', RELEVO._fotosEnMemoria() === 40, String(RELEVO._fotosEnMemoria()));
  await RELEVO.salir();
  ok('al salir de la cuenta no queda ninguna foto de esa persona', RELEVO._fotosEnMemoria() === 0);

  console.log('\nB7 · el emoji partido\n');
  const roto = '🎉'.slice(0, 1) + 'hola' + '🎉'.slice(1);
  ok('surrogate suelto → U+FFFD', CANDADO.sanearTexto(roto) === '�hola�');
  ok('un emoji entero no se toca', CANDADO.sanearTexto('ñandú 🎉') === 'ñandú 🎉');
  let lanzo = false;
  let abierto = null;
  try {
    const bb = await CANDADO.cerrar(roto, []);
    const m2 = await CANDADO.miLlave();
    abierto = await CANDADO.abrir(bb, [{ id: m2.id, pub: m2.pub, fir: m2.fir }]);
  } catch {
    lanzo = true;
  }
  ok('cerrar con un emoji partido no lanza y abre con «�»', !lanzo && abierto?.texto === '�hola�', abierto && JSON.stringify(abierto.texto));

  console.log('\nazar · getRandomValues con más de 1024 bytes\n');
  const antes = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  Object.defineProperty(globalThis, 'crypto', { value: {}, configurable: true, writable: true });
  AZAR.ponerElAzar();
  let errAzar = '';
  const grande = new Uint8Array(5000);
  const u32 = new Uint32Array(700);
  try {
    globalThis.crypto.getRandomValues(grande);
    globalThis.crypto.getRandomValues(u32);
  } catch (e) {
    errAzar = e.message;
  }
  ok('5000 bytes y un Uint32Array de 700 sin lanzar (expo-crypto da 1024 por vez)', !errAzar, errAzar);
  ok('…y no quedan ceros al final', grande.subarray(4900).some((x) => x !== 0) && u32.subarray(650).some((x) => x !== 0));
  let tope = false;
  try {
    globalThis.crypto.getRandomValues(new Uint8Array(70000));
  } catch {
    tope = true;
  }
  ok('más de 65536 lanza, como en el navegador', tope);
  if (antes) Object.defineProperty(globalThis, 'crypto', antes);
  fin();
})().catch((e) => {
  console.error('ERR', e);
  process.exit(1);
});
