/**
 * LA BARRERA QUE IMPIDE QUE LAS PRUEBAS VACÍEN UNA BASE DE VERDAD.
 *
 * Varias pruebas truncan tablas (TRUNCATE … CASCADE) de la base a la que apunte ELECTRUM_DB_URL, la
 * misma variable que usa producción. Hasta ahora lo único que lo impedía era un comentario de aviso.
 *
 * Esto lo impide por código: cuando el proceso corre bajo el corredor de pruebas de Node
 * (`node --test` / `tsx --test` ponen NODE_TEST_CONTEXT en cada archivo de prueba), solo se abre una
 * base cuyo nombre diga que es de pruebas («prueba(s)» o «test(s)», como `electrum_pruebas` del CI). Fuera
 * de las pruebas no hace nada. La marca tiene que ser una pieza del nombre, separada por «_», «-» o «.»:
 * `electrum_latest` contiene «test» pero no es una base de pruebas, y no se abre.
 *
 * Para usar a propósito otra base en pruebas: BASE_DE_PRUEBAS=si.
 */

export function exigirBaseDePrueba(url: string): void {
  if (!process.env.NODE_TEST_CONTEXT) return;
  if (process.env.BASE_DE_PRUEBAS === 'si') return;
  let nombre = '';
  try {
    nombre = decodeURIComponent(new URL(url).pathname.replace(/^\//, ''));
  } catch {
    // Una URL que no se entiende tampoco se abre en pruebas: no se puede saber a qué base apunta.
  }
  if (/(^|[_.-])(tests?|pruebas?)($|[_.-])/i.test(nombre)) return;
  throw new Error(
    `Las pruebas no abren la base «${nombre || '?'}»: su nombre no dice que sea de pruebas. ` +
      'Usa una base aparte (p. ej. electrum_pruebas) o, si es a propósito, BASE_DE_PRUEBAS=si.',
  );
}
