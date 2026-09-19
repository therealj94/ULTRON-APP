import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { BANCO, TEXTO_CLIP, bankKey, clipCanned, clipDeTexto, saludoHora } from '../src/03-voz/banco';

const VOZ = path.join(process.cwd(), 'public', 'voz');

describe('Banco de voz', () => {
  it('reproduce clips cortos por id o frase, no inventa TTS', () => {
    assert.equal(clipDeTexto('aqui')?.id, 'aqui');
    assert.equal(clipDeTexto('Aquí.')?.id, 'aqui');
    assert.equal(clipDeTexto('Listo.')?.id, 'listo_corto');
    assert.equal(clipDeTexto('Micrófono activado. Te escucho.')?.id, 'mic_on');
    assert.equal(clipDeTexto('Quedó en Genesis Core. La próxima pregunta ya lo usa.')?.id, 'genesis_ok');
    assert.equal(clipDeTexto('dias')?.id, 'dias');
    assert.equal(clipDeTexto('Buenos días, José. Aquí. ¿En qué te ayudo?')?.id, 'dias');
  });

  it('las canciones siguen por nombre; un párrafo con queen no gasta el banco en TTS', () => {
    assert.equal(clipDeTexto('bohemian')?.id, 'bohemian');
    assert.equal(clipDeTexto('canta 2')?.id, 'ligera');
    assert.equal(clipCanned('bohemian')?.id, 'bohemian');
    assert.equal(clipCanned('Queen Elizabeth visitó Tegucigalpa ayer con la junta.'), null);
    assert.equal(clipCanned('Aquí.')?.id, 'aqui');
  });

  it('saludo por hora y bankKey de la bienvenida nueva', () => {
    const manana = new Date(2026, 8, 19, 8, 0, 0);
    const tarde = new Date(2026, 8, 19, 15, 0, 0);
    const noche = new Date(2026, 8, 19, 21, 0, 0);
    assert.equal(saludoHora(manana).id, 'dias');
    assert.equal(saludoHora(tarde).id, 'tardes');
    assert.equal(saludoHora(noche).id, 'noches');
    assert.equal(bankKey(TEXTO_CLIP.dias), 'buenosdiasjoseaquienqueteayudo');
  });

  it('cada clip del banco existe en disco; Bohemian no se tocó', () => {
    for (const b of BANCO) {
      const p = path.join(VOZ, path.basename(b.file));
      assert.ok(fs.existsSync(p), b.file);
      assert.ok(fs.statSync(p).size > 800, b.file);
    }
    const boh = fs.statSync(path.join(VOZ, 'bohemian.mp3')).size;
    assert.ok(boh > 400000 && boh < 460000, `bohemian ${boh}`);
    for (const id of ['ligera', 'bittersweet', 'runaway', 'bruno']) {
      assert.ok(fs.statSync(path.join(VOZ, `${id}.mp3`)).size > 400000, id);
    }
  });
});
