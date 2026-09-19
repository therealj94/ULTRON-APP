import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { transcribirAudio, esAudioNombre, mimeDeAudio } from '../lib/oido';
import { parsearUpdateTelegram, ayudaTelegram } from '../lib/telegram-in';
import { pideNotaDeVoz } from '../lib/voz';

describe('Oír nota de voz en Telegram', () => {
  it('reconoce audio por nombre y mime', () => {
    assert.equal(esAudioNombre('nota.ogg', 'audio/ogg'), true);
    assert.equal(esAudioNombre('clip.m4a', ''), true);
    assert.equal(esAudioNombre('acta.pdf', 'application/pdf'), false);
    assert.equal(mimeDeAudio('nota.ogg', '', true), 'audio/ogg');
    assert.equal(mimeDeAudio('a.mp3', 'audio/mpeg'), 'audio/mpeg');
  });

  it('audio vacío no se finge transcripción', async () => {
    const r = await transcribirAudio({ audio: Buffer.alloc(0), mime: 'audio/ogg' });
    assert.equal(r.texto, '');
    assert.match(r.detalle, /vacío|oír/i);
  });

  it('Telegram parsea una nota de voz', async () => {
    const prev = process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_BOT_TOKEN;
    const p = await parsearUpdateTelegram({
      message: {
        chat: { id: 1 },
        from: { id: 1, first_name: 'José' },
        voice: { file_id: 'voz1', mime_type: 'audio/ogg', duration: 3 },
      },
    });
    if (prev !== undefined) process.env.TELEGRAM_BOT_TOKEN = prev;
    assert.equal(p?.audio?.mime, 'audio/ogg');
    assert.equal(p?.audio?.buffer.length, 0);
  });

  it('Telegram parsea un audio enviado como archivo', async () => {
    const prev = process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_BOT_TOKEN;
    const p = await parsearUpdateTelegram({
      message: {
        chat: { id: 1 },
        from: { id: 1, first_name: 'Medardo' },
        document: { file_name: 'junta.m4a', mime_type: 'audio/mp4', file_id: 'a1' },
      },
    });
    if (prev !== undefined) process.env.TELEGRAM_BOT_TOKEN = prev;
    assert.equal(p?.audio?.mime, 'audio/mp4');
    assert.equal(p?.documento, undefined);
  });

  it('la ayuda dice que la nota de voz se contesta por escrito', () => {
    assert.match(ayudaTelegram(), /por escrito/);
  });

  it('una nota de voz normal no pide audio de vuelta', () => {
    assert.equal(pideNotaDeVoz('cómo está el sistema'), false);
    assert.equal(pideNotaDeVoz('mándame audio del sistema'), true);
  });
});
