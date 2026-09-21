/**
 * Silenciar tiene que silenciar YA.
 *
 * Dos fallos que la auditoría encontró y que no se ven leyendo el botón: silenciar solo cambiaba un
 * booleano —ni paraba lo que sonaba ni invalidaba la petición que venía en camino— y el turno leía
 * la preferencia de voz desde un cierre viejo, así que respondía hablando después de silenciar.
 *
 * Aquí se prueba el mecanismo, no la interfaz: el contador de generación es lo que decide si una
 * voz que llega tarde suena o se descarta.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

/**
 * Copia fiel del mecanismo de `Panel.tsx`. Se replica en vez de importar porque el módulo real
 * arrastra React, MapLibre y el DOM entero; lo que hay que fijar es la REGLA, y si algún día se
 * cambia allí sin cambiarla aquí, esta prueba deja de proteger nada. Por eso comparte nombres.
 */
function crearVoz() {
  let generacion = 0;
  let sonando: { parado: boolean } | null = null;
  const sonaron: string[] = [];
  return {
    sonaron,
    callar() {
      generacion++;
      if (sonando) {
        sonando.parado = true;
        sonando = null;
      }
    },
    async decir(texto: string, tardaMs: number) {
      const mia = ++generacion;
      await new Promise((ok) => setTimeout(ok, tardaMs));
      if (mia !== generacion) return; // silenciaron mientras venía
      sonando = { parado: false };
      sonaron.push(texto);
    },
  };
}

test('la voz obedece al silencio', async (t) => {
  await t.test('silenciar mientras la voz viene en camino la descarta', async () => {
    const v = crearVoz();
    const p = v.decir('hola', 30);
    v.callar();
    await p;
    assert.deepEqual(v.sonaron, [], 'no debía sonar nada');
  });

  await t.test('sin silenciar, suena', async () => {
    const v = crearVoz();
    await v.decir('hola', 5);
    assert.deepEqual(v.sonaron, ['hola']);
  });

  await t.test('pedir otra voz corta la anterior, no las superpone', async () => {
    const v = crearVoz();
    const a = v.decir('primera', 30);
    const b = v.decir('segunda', 5);
    await Promise.all([a, b]);
    assert.deepEqual(v.sonaron, ['segunda'], 'la primera llegó tarde y ya no valía');
  });

  await t.test('callar sin nada sonando no rompe', () => {
    const v = crearVoz();
    v.callar();
    v.callar();
    assert.deepEqual(v.sonaron, []);
  });
});
