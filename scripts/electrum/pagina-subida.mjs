/**
 * Genera una página HTML suelta para subir expedientes al bucket de trasvase.
 *
 *   AWS_ACCESS_KEY_ID=… AWS_SECRET_ACCESS_KEY=… node scripts/electrum/pagina-subida.mjs
 *
 * Se abre en el navegador, se arrastra la carpeta y sube. No necesita servidor, ni la CLI de AWS,
 * ni que quien la usa maneje ninguna credencial.
 *
 * Por qué una política POST firmada y no una clave metida en la página: una clave en el HTML es una
 * clave regalada a cualquiera que abra el archivo. Una política firmada es un permiso de un solo
 * uso concreto —subir a ESTE bucket, bajo ESTE prefijo, hasta ESTA fecha— del que no se puede
 * deducir el secreto que la firmó ni usarla para nada más. Si la página se filtra, lo peor que
 * puede hacer quien la tenga es dejar archivos en un bucket que caduca solo.
 *
 * El límite de AWS para estas firmas es de siete días; se piden seis para no apurar el borde.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const BUCKET = process.env.BUCKET || 'electrum-expedientes-548380372606';
const REGION = process.env.REGION || 'us-east-1';
const PREFIJO = process.env.PREFIJO || 'entrada/';
const DIAS = Number(process.env.DIAS || 6);
const SALIDA = process.env.SALIDA || path.join(process.cwd(), 'subir-expedientes.html');

const ID = process.env.AWS_ACCESS_KEY_ID;
const SECRETO = process.env.AWS_SECRET_ACCESS_KEY;
if (!ID || !SECRETO) {
  console.error('Faltan AWS_ACCESS_KEY_ID y AWS_SECRET_ACCESS_KEY.');
  process.exit(1);
}

const ahora = new Date();
const amz = ahora.toISOString().replace(/[:-]|\.\d{3}/g, '');
const dia = amz.slice(0, 8);
const alcance = `${dia}/${REGION}/s3/aws4_request`;
const caduca = new Date(ahora.getTime() + DIAS * 864e5).toISOString().replace(/\.\d{3}/, '');

const politica = {
  expiration: caduca,
  conditions: [
    { bucket: BUCKET },
    ['starts-with', '$key', PREFIJO],
    { 'x-amz-algorithm': 'AWS4-HMAC-SHA256' },
    { 'x-amz-credential': `${ID}/${alcance}` },
    { 'x-amz-date': amz },
    ['starts-with', '$Content-Type', ''],
    ['content-length-range', 1, 5 * 1024 ** 3],
  ],
};
const politicaB64 = Buffer.from(JSON.stringify(politica)).toString('base64');

const hmac = (clave, dato) => crypto.createHmac('sha256', clave).update(dato, 'utf8').digest();
const firma = hmac(
  hmac(hmac(hmac(hmac(`AWS4${SECRETO}`, dia), REGION), 's3'), 'aws4_request'),
  politicaB64
).toString('hex');

const datos = {
  url: `https://${BUCKET}.s3.${REGION}.amazonaws.com/`,
  prefijo: PREFIJO,
  caduca,
  campos: {
    'x-amz-algorithm': 'AWS4-HMAC-SHA256',
    'x-amz-credential': `${ID}/${alcance}`,
    'x-amz-date': amz,
    policy: politicaB64,
    'x-amz-signature': firma,
  },
};

const html = fs.readFileSync(path.join(import.meta.dirname, 'subida.plantilla.html'), 'utf8')
  .replace('/*DATOS*/null', JSON.stringify(datos, null, 2));

fs.writeFileSync(SALIDA, html);
console.log(`Página escrita en ${SALIDA}`);
console.log(`Sube a s3://${BUCKET}/${PREFIJO} y caduca el ${caduca}.`);
