import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import zlib from 'node:zlib';
import { textoAPdf } from '../lib/pdf';
import {
  extraerPdf,
  esPdfNombre,
  esImagenNombre,
  pngDePixeles,
  dataUrlDeImagen,
  bufferDeCualquier,
} from '../lib/leer-pdf';
import { parsearUpdateTelegram } from '../lib/telegram-in';

describe('Leer PDF e imágenes subidas', () => {
  it('extrae el texto de un PDF generado por AU-RA', () => {
    const buf = textoAPdf({ titulo: 'Junta', cuerpo: 'Precio del oro pendiente.\nCafé de la mesa.' });
    const r = extraerPdf(buf);
    assert.match(r.texto, /Junta/);
    assert.match(r.texto, /Precio del oro pendiente/);
    assert.match(r.detalle, /caracteres/);
  });

  it('infla un stream FlateDecode y saca el Tj', () => {
    const inner = 'BT /F1 12 Tf 72 720 Td (Contrato Medardo 5550) Tj ET';
    const defl = zlib.deflateSync(Buffer.from(inner, 'latin1'));
    const stream = Buffer.concat([
      Buffer.from('%PDF-1.4\n1 0 obj\n<< /Length ' + defl.length + ' /Filter /FlateDecode >>\nstream\n', 'latin1'),
      defl,
      Buffer.from('\nendstream\nendobj\n%%EOF', 'latin1'),
    ]);
    const r = extraerPdf(stream);
    assert.match(r.texto, /Contrato Medardo 5550/);
  });

  it('no finge un archivo que no es PDF', () => {
    const r = extraerPdf(Buffer.from('hola esto no es pdf'));
    assert.equal(r.texto, '');
    assert.match(r.detalle, /No es un PDF/);
  });

  it('reconoce nombres de PDF e imagen', () => {
    assert.equal(esPdfNombre('acta.pdf', 'application/pdf'), true);
    assert.equal(esImagenNombre('foto.PNG', 'image/png'), true);
    assert.equal(esPdfNombre('foto.jpg', 'image/jpeg'), false);
  });

  it('saca un JPEG DCTDecode embebido', () => {
    const jpeg = Buffer.concat([
      Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]),
      Buffer.alloc(220, 0x41),
      Buffer.from([0xff, 0xd9]),
    ]);
    const pdf = Buffer.concat([
      Buffer.from(
        '%PDF-1.4\n1 0 obj\n<< /Subtype /Image /Width 8 /Height 8 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' +
          jpeg.length +
          ' >>\nstream\n',
        'latin1'
      ),
      jpeg,
      Buffer.from('\nendstream\nendobj\n%%EOF', 'latin1'),
    ]);
    const r = extraerPdf(pdf);
    assert.equal(r.imagenes.length, 1);
    assert.equal(r.imagenes[0][0], 0xff);
    assert.equal(r.imagenes[0][1], 0xd8);
    assert.match(r.detalle, /imagen/);
  });

  it('convierte un escaneo RGB FlateDecode a PNG', () => {
    const pixels = Buffer.from([255, 0, 0, 0, 0, 255]);
    const defl = zlib.deflateSync(pixels);
    const pdf = Buffer.concat([
      Buffer.from(
        '%PDF-1.4\n1 0 obj\n<< /Type /XObject /Subtype /Image /Width 2 /Height 1 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /Length ' +
          defl.length +
          ' >>\nstream\n',
        'latin1'
      ),
      defl,
      Buffer.from('\nendstream\nendobj\n%%EOF', 'latin1'),
    ]);
    const r = extraerPdf(pdf);
    assert.equal(r.imagenes.length, 1);
    assert.equal(r.imagenes[0].subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    assert.match(dataUrlDeImagen(r.imagenes[0]), /^data:image\/png;base64,/);
  });

  it('pngDePixeles arma un PNG válido', () => {
    const png = pngDePixeles(1, 1, 3, Buffer.from([10, 20, 30]));
    assert.ok(png);
    assert.equal(png![0], 0x89);
    assert.equal(png![1], 0x50);
  });

  it('bufferDeCualquier acepta data URL y Buffer JSON', () => {
    const raw = Buffer.alloc(100, 7);
    assert.deepEqual(bufferDeCualquier(raw), raw);
    assert.ok(bufferDeCualquier(`data:application/pdf;base64,${raw.toString('base64')}`)?.length);
    assert.ok(bufferDeCualquier({ type: 'Buffer', data: [...raw] })?.length);
    assert.equal(bufferDeCualquier('corto'), null);
  });

  it('Telegram parsea un documento PDF aunque no se pueda bajar', async () => {
    const prev = process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_BOT_TOKEN;
    const p = await parsearUpdateTelegram({
      message: {
        chat: { id: 1 },
        from: { id: 1, first_name: 'Medardo' },
        caption: 'mira esto',
        document: { file_name: 'acta.pdf', mime_type: 'application/pdf', file_id: 'x' },
      },
    });
    if (prev !== undefined) process.env.TELEGRAM_BOT_TOKEN = prev;
    assert.equal(p?.documento?.filename, 'acta.pdf');
    assert.equal(p?.texto, 'mira esto');
  });

  it('Telegram parsea una foto enviada como archivo', async () => {
    const prev = process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_BOT_TOKEN;
    const p = await parsearUpdateTelegram({
      message: {
        chat: { id: 1 },
        from: { id: 1, first_name: 'José' },
        document: { file_name: 'recibo.jpg', mime_type: 'image/jpeg', file_id: 'y' },
      },
    });
    if (prev !== undefined) process.env.TELEGRAM_BOT_TOKEN = prev;
    assert.equal(p?.documento?.filename, 'recibo.jpg');
    assert.equal(esImagenNombre(p!.documento!.filename, p!.documento!.mime), true);
  });
});
