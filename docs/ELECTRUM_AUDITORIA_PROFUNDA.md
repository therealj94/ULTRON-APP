# Auditoría profunda de Dr Electrum — versión 3, etapas 1 y 2 cerradas

Fecha: 30 de septiembre de 2026, Honduras. Base: la auditoría de Medardo sobre `25d6591`
(«DR_ELECTRUM_AUDITORIA_PROFUNDA_PARA_CLAUDE.md»). Esta versión la contrasta, hallazgo por
hallazgo, con el código actual de la rama `ccr-732a8335-3t1xol` (PR #84), corrige lo que la
primera versión dijo mal, agrega lo que apareció al verificar y deja resuelta la etapa 1.

**Resultado:** de los 18 hallazgos, 16 seguían vigentes y 1 estaba corregido en parte (H17).
H18 partía de una premisa errónea. La etapa 1 (PR #84) resolvió con prueba H01–H05, H07, H10 y
H12. La etapa 2 (esta versión) resuelve H08, H09, H11, H13, H15, H16 y H17, y aplica las dos
decisiones de José del 30-sep-2026: **la demo ve datos reales (H06)** y **los clientes se separan
(H14)**. Al verificar aparecieron **3 errores nuevos**, ya corregidos (N1–N3), y un cuarto en la
etapa 2 (N4: la cartera tomaba «sin datos» como puntaje de prospectividad).

## Cómo leer los estados

| Estado | Qué quiere decir |
|---|---|
| **Resuelto** | Corregido en código, con una prueba que falla con el defecto y pasa con la corrección |
| **Parcial** | Corregida la parte de mayor riesgo; queda trabajo nombrado |
| **Vigente** | Sigue igual que en la primera versión; corrección propuesta |
| **Decisión** | No es un defecto técnico: falta decidir una política |

Evidencia: *código* (leído), *prueba aislada* (función o base PostGIS local con datos sintéticos),
*producción* (consultado con las herramientas de solo lectura de Dr Electrum). Nada se probó
con documentos reales ni en la base de producción.

## Tabla de estado H01–H18

| # | Hallazgo | Estado | Dónde | Prueba |
|---|---|---|---|---|
| H01 | JORC 2024 presentado como vigente | **Resuelto** | `src/08-cerebro-minas/conocimiento.ts`, `normas.ts`, `docs/ELECTRUM.md` | `tests/normas.test.ts` |
| H02 | `0.560 g/t` leído como 560 | **Resuelto** | `lib/minas/calculos.ts` `leerNumero`, `numerosAmbiguos` | `tests/minas.test.ts` |
| H03 | Importación documental no atómica | **Resuelto** | `server/electrum/aprender.ts` | `tests/electrum-ingesta-atomica.test.ts` (fallo inyectado) |
| H04 | Visitantes identificados por IP y navegador | **Resuelto** | `server/electrum/hilo.ts` `quienDelHilo`, `src-electrum/acceso.ts` | `tests/electrum-hilo.test.ts` |
| H05 | Informes sin dueño recogibles por cualquiera | **Resuelto** | `server/electrum/informe.ts`, rutas en `server.ts`, `area.ts`, `manos.ts` | `tests/informe.test.ts` |
| H06 | La demo recibe el PDF completo | **Decidido y aplicado** | `server.ts` ruta `/api/electrum/informe/:id` | — (bitácora `informe_demo`) |
| H07 | «Sin datos» pintado como prospectividad «muy baja» | **Resuelto** | `server/electrum/prospectividad.ts`, `src-electrum/mapa/prospectividad.ts`, `Mapa.tsx`, `Tarjeta.tsx` | `tests/electrum-prospectividad.test.ts` |
| H08 | Presupuesto de 50 s no cubre el turno entero | **Resuelto** | `server/electrum/turno.ts` (`msRestanteDelTurno`), `lib/agente/bucle.ts` | `tests/agente.test.ts` |
| H09 | Timeout y desconexión no cancelan lo iniciado | **Resuelto** | `lib/agente/bucle.ts` `conTope`, `server.ts` rutas de turno | `tests/agente.test.ts` |
| H10 | Cálculos aceptan valores fuera de dominio; supuestos sin etiqueta | **Resuelto** | `lib/minas/calculos.ts` | `tests/minas.test.ts` |
| H11 | Transcripción de fotos entra como texto original | **Resuelto** (falta revisión humana de campos) | `aprender.ts`, `db.ts` búsqueda, `evidencias.ts` | `tests/electrum-evidencias.test.ts` |
| H12 | Repetir la carga pierde los avisos | **Resuelto** | `server/electrum/aprender.ts` (`meta.avisos`) | `tests/electrum-ingesta-atomica.test.ts` |
| H13 | Citas sin localizador verificable | **Resuelto** | `server/electrum/evidencias.ts`, `turno.ts`, `manos.ts` | `tests/electrum-evidencias.test.ts` |
| H14 | Sin aislamiento por organización o proyecto | **Decidido y resuelto** | `server/electrum/organizacion.ts` y las consultas de documentos, capas y carteras | `tests/electrum-organizacion.test.ts` |
| H15 | Prospectividad sin versión ni invalidación | **Resuelto** | `server/electrum/prospectividad.ts` (`selloInsumos`), `cartera.ts` | `tests/electrum-prospectividad-sello.test.ts` |
| H16 | La app salta al final del hilo aunque se lea atrás | **Resuelto** | `mobile/src/electrum/campo.ts`, `CampoScreen.tsx` | `tests/electrum-movil-campo.test.ts` |
| H17 | Conversación sin persistencia ni separación por proyecto | **Resuelto** | `server/electrum/hilo.ts`, `GET /api/electrum/hilo`, `Panel.tsx` | `tests/electrum-conversacion-telegram.test.ts` |
| H18 | Legibilidad; «voz activa en móvil, apagada en web» | Premisa corregida | `src-electrum/panel/voz.ts`, `CampoScreen.tsx` | — |

## Lo resuelto en esta versión

### H01 JORC — resuelto

- **Verificado en la fuente oficial** ([jorc.org](https://jorc.org/), 30-sep-2026): la edición
  vigente es la **2012**, obligatoria desde el 1 de diciembre de 2013. La de 2024 es un borrador que
  estuvo en consulta pública del 1 de agosto al 31 de octubre de 2024.
- **Corregido** el conocimiento que lee el modelo y `docs/ELECTRUM.md`.
- **Registro de normas** nuevo (`src/08-cerebro-minas/normas.ts`): edición vigente, propuesta,
  fuente y fecha de revisión. Pasado un año sin revisar, o con una duda anotada, la norma queda
  «a revalidar».
- **NI 43-101 a revalidar:** no se pudo abrir la fuente oficial canadiense (bloquea el acceso
  automático). El registro lo dice así, en vez de afirmar su estado.
- **Prueba:** falla si el conocimiento vuelve a afirmar que una propuesta sustituyó a la norma.

### H02 Números — resuelto

- Un cero delante del separador siempre es decimal: `0.560` y `0,560` son 0,56.
- En leyes y porcentajes, `1.234` y `1,234` son decimales (1,234 g/t): una ley de mil gramos por
  tonelada no es plausible.
- En tonelajes, `250.000` y `250,000` siguen siendo miles. Si un tonelaje admite dos lecturas
  (`1.234 t`), la respuesta dice cómo lo leyó: «Ojo: leí «1.234» como 1234; si era un decimal,
  dímelo y lo rehago».
- **Prueba:** los casos que pide la auditoría (`0.560 g/t`, `0,560 g/t`, `1.234 t`, `1,234 t`,
  `250.000 t`, `250,000 t`), comprobando el valor leído y el cálculo final.

### H03 Importación atómica — resuelto

- El documento y todos sus fragmentos entran en **una transacción**: o entra entero o no entra.
- En `documento.meta` se guardan los fragmentos esperados. La deduplicación ya no se fía de la
  huella sola: si un documento tiene menos fragmentos de los esperados (o ninguno), se borra y se
  vuelve a cargar entero en vez de responder «ya estaba».
- **Prueba con fallo inyectado:** un trigger de PostgreSQL rompe el segundo lote de fragmentos.
  - Tras el fallo no queda ni el documento ni el primer lote.
  - El reintento carga todo y el último fragmento es buscable.
  - Un documento cortado de antes se recarga sin duplicarse.
- **La prueba detecta el defecto real:** con el código anterior falla 5 de 5; con el nuevo pasa 5 de 5.

### H04 Visitante opaco — resuelto

- El navegador genera una vez un identificador de 128 bits al azar (`crypto.getRandomValues`) y lo
  manda en `x-electrum-visita`. El servidor lo usa hasheado como dueño del hilo y de los informes.
- Dos visitantes en la misma red y con el mismo navegador ya no comparten conversación ni borrado.
- La huella de IP y navegador queda solo de respaldo, para clientes que no lo mandan (la oficina
  por voz y versiones viejas).

### H05 Informes — resuelto

- **Identificadores:** `crypto.randomBytes(16)` en base64url, 128 bits. Antes eran la hora más
  `Math.random`.
- **Dueño en todas las rutas web:** la persona o, con la llave de la demo, su visitante opaco. El
  turno web también pasa ese dueño (`ctx.duenio`) a los informes que arma el chat.
- **Dueño siempre comparado:** un informe sin dueño ya no lo recoge ni lo comparte una petición
  web. Solo lo recoge el envío interno de Telegram, que también llega sin dueño.
- Se reescribió la prueba que fijaba el comportamiento anterior («un informe sin autor no se le
  reserva a nadie»): era justo el hueco.

### H07 Prospectividad sin datos — resuelto

- Tres estados, `sin_datos`, `insuficiente` (menos de 50 de los 100 puntos mirables) y `evaluado`,
  guardados en `estado`.
- Sin datos: nivel «sin datos», no «muy baja». En el mapa se pinta casi transparente, con leyenda
  propia («no es «baja»: no está estudiada»). La ficha lo explica.
- El ranking excluye las que no tienen datos y pone las evaluadas antes que las de evidencia
  insuficiente.
- Las filas ya guardadas se corrigen al leerlas (por su cobertura), sin recalcular nada.

### H10 Dominio de los cálculos — resuelto

- **Fuera de dominio da `NaN`**, que se muestra como «sin dato». Aplica a recuperación fuera de
  0–100, costo negativo, ley de cobre sobre 100 %, tonelaje negativo, infinito o NaN. La
  validación está dentro de cada función, así que ninguna ruta se la salta.
- **Ley de corte sin recuperación:** usa 90 % y lo dice como supuesto («supuesto: no me la diste;
  dímela y la rehago»). También queda marcado en `valores.recuperacionSupuesta`.
- **Recuperación imposible:** con una de 150 % no se calcula; se pide la correcta.
- **AISC:** sigue siendo costo entre onzas. Pendiente: exigir y mostrar sus componentes antes de
  llamarlo AISC.

### H11 y H12 — H12 resuelto, H11 en parte

- **H12:** los avisos de la lectura (foto transcrita, páginas aproximadas) se guardan en
  `documento.meta.avisos` y se devuelven cuando se repite la carga.
- **H11:** una foto queda marcada con `meta.origen = 'foto_transcrita'` y `meta.revisado = false`.
- **Falta en H11:** que la búsqueda y las citas lean esa marca y digan «transcripción sin revisar»;
  y un paso de revisión para los datos críticos: expediente, coordenadas, ley, titular y fecha.

## Errores nuevos encontrados al verificar (ya corregidos)

| # | Qué pasaba | Corrección | Prueba |
|---|---|---|---|
| N1 | En «cuánto oro hay en 250.000 t a 3,4 g/t», el tonelaje se tomaba como **precio de la onza** («a 250.000 dólares la onza»): bastaba la palabra «oro» antes de un número | El precio exige estar pegado a «precio» o «oro a», y una cifra seguida de toneladas nunca es precio | `tests/minas.test.ts` |
| N2 | Los traslapes del padrón oficial se contaban como pleitos. Los mayores eran el mismo derecho repetido («Monte Redondo (Embargo)», 3 veces, expediente 98): unas 8.000 de las 11.865 ha | Clasificación única: repetido / mismo titular / sin titular / entre titulares; solo el último se cuenta «a verificar» | `tests/electrum-traslapes-clase.test.ts` |
| N3 | Un traslape donde falta el titular se contaba como «entre titulares distintos» | Clase `sin_titular`, aparte | Misma prueba |

## Correcciones a la primera versión

- **H18:** decía que la voz arranca activa en móvil y apagada en web. En el código actual arranca
  **activa en los dos** (`voz.ts`: la preferencia por defecto es `true`).
- **H17:** no estaba igual que en la revisión anterior. La conversación de Telegram ya persiste en
  base; la de la mesa web sigue solo en memoria del servidor y en `sessionStorage`.
- **H04:** además de la mezcla de contexto, el mismo mecanismo decidía el dueño de los informes de
  la demo (H05). Por eso se resolvieron juntos.

## Etapa 2: lo resuelto

### H08 y H09 — un reloj y cancelación de verdad

- **Un solo reloj:** el turno cuenta sus 50 s desde que llega la petición (`msRestanteDelTurno`),
  no desde que empieza el bucle. Clasificar, buscar en expedientes y en internet gastan del mismo
  presupuesto.
- **Herramientas acotadas:** cada una recibe `min(su tope, lo que le queda al turno)`. Antes, una
  de 20 s lanzada a 45 s del inicio llevaba el turno a 65 s.
- **Sin mínimo artificial:** se quitó el mínimo de 8 s por llamada al modelo. Con menos de 1,5 s,
  no se llama y el bucle cierra con lo que tiene.
- **Cancelación real:** cada petición tiene su `AbortController`, que se dispara con
  `res.on('close')` en las dos rutas. Corta la llamada al modelo (`AbortSignal.any` en el `fetch`)
  y deja de esperar la herramienta en curso. `conTope` ya no deja relojes vivos.
- **Pruebas:** con una herramienta de 3 s y un turno de 1,2 s, antes tardaba 3 s y ahora corta a
  tiempo. Con la señal disparada a los 150 ms, termina en «abandonado» antes de 1 s. Las dos fallan
  con el código anterior.

### H13 y H11 — citas que se pueden comprobar

- **Código por trozo:** cada trozo que llega al modelo lleva un código estable, `[D12-p5]`
  (documento 12, página 5), y queda como evidencia del turno (`evidencias.ts`, en un
  `AsyncLocalStorage`). La búsqueda, la búsqueda previa del turno y `expediente_leer` lo anotan.
- **Verificación al terminar:** el código se cambia por «(documento, p. 5)» si esa página se leyó
  en el turno. Si no, se quita y la respuesta dice «Quité una cita que no correspondía a lo que
  leí». La respuesta trae `citas` con documento y página para abrirlas.
- **Fotos sin revisar (H11):** lo que viene de una foto transcrita sin revisar llega al modelo
  marcado `[FOTO TRANSCRITA, SIN REVISAR]`, y la cita dice «transcripción de foto sin revisar».
- **Falta:** una pantalla para que una persona revise los campos críticos de una foto (expediente,
  coordenadas, ley, titular, fecha) y la marque revisada.

### H15 — prospectividad con sello

- **Sello:** cada puntaje guarda el sello de sus insumos: versión del algoritmo, capas geológicas
  (cantidad, rasgos, última carga) y muestras (cantidad, última carga).
- **Vencidos:** un puntaje con otro sello no se pinta, no entra al ranking ni a la cartera, y se
  cuenta como «pendiente de recalcular». El lote de «faltantes» también los recalcula.
- **N4:** la cartera leía los puntajes sin filtro, así que «sin datos» contaba como puntaje bajo
  (H07 también se escapaba por ahí). Ahora solo cuenta lo evaluado y vigente.

### H16 — la app no arrastra a quien relee

- El hilo solo sigue el final si ya se estaba abajo (`alFinalDelHilo`). Si no, aparece un botón
  «↓ RESPUESTA NUEVA». Lo que envía la persona siempre baja el hilo.

### H17 — la conversación de la mesa se guarda

- **Guardado:** se guarda en `cognitivo.hilo` como la de Telegram: por persona, seis horas, con
  los secretos tapados.
- **Retomar:** `GET /api/electrum/hilo` la devuelve, y la pantalla la retoma si arranca en blanco
  (otra pestaña u otro aparato).
- **Por proyecto:** la separación la da H14, porque cada organización ve solo lo suyo.

### H06 — decidido: la demo ve datos reales

- José decidió (30-sep-2026) que la demo muestra informes reales. `inline` no es protección y no
  se presenta como tal. Lo que hay es rastro: cada entrega a un invitado queda en la bitácora
  (`informe_demo`), con su visitante opaco hasheado, el nombre del informe y la hora.

### H14 — decidido: los clientes se separan

- **Organización de cada persona:**
  - la que diga el padrón (`organizacion`, o sexta columna en `ULTRON_PADRON`);
  - si no, la casa, cuando el correo es de Orden Global o no hay correo;
  - si no, el dominio del correo;
  - con un correo público (gmail…), la persona sola.
- **Ámbito de la petición:** un middleware abre el ámbito de la organización para todo
  `/api/electrum`; también se abre en MCP y en Telegram. Documentos, capas y carteras filtran
  solos. Los invitados de la demo miran lo de la casa (H06).
- **Documentos:** cada uno es de su organización; lo cargado antes es de la casa. El mismo PDF
  subido por un cliente entra como suyo, porque el índice de duplicados ahora incluye la
  organización.
- **Capas:** las de la casa son comunes (catastro nacional, geología, JICA, áreas protegidas). Las
  de un cliente entran como capa de proyecto suya, nunca como concesiones: si no, se sumarían al
  padrón nacional de todos.
- **Cambios:** mover, renombrar, borrar y releer se limitan a lo propio. Un cliente no toca las
  capas comunes.
- **Falla cerrado:** si las columnas no están listas, un cliente no ve nada; la casa sigue como
  antes.
- **Migración:** solo agrega columnas nulas e índices, y cambia el índice de duplicados de
  documentos (crea el nuevo y después quita el viejo). No reescribe ninguna fila. La aplicación la
  corre sola al arrancar; también está en `scripts/electrum/esquema.sql` v11.

## Lo que queda

- **H11:** pantalla de revisión humana de fotos transcritas.
- **H14:** la organización de las cuentas aprobadas desde la web sale del correo. Si un cliente usa
  gmail, hay que ponerle la organización en el padrón.
- **H18:** legibilidad en exteriores (contraste y tamaños) sin medir en un teléfono al sol.

## Pruebas de esta versión

- **Suite completa** (`npm test`) contra PostGIS local con datos sintéticos, más `tsc` y
  `npm run build`. El resultado exacto está en la descripción del PR.
- **Nuevas en la etapa 2:**
  - `tests/electrum-organizacion.test.ts`
  - `tests/electrum-evidencias.test.ts`
  - `tests/electrum-prospectividad-sello.test.ts`
  - `tests/electrum-preferencias.test.ts`
- **Ampliadas en la etapa 2:**
  - `tests/agente.test.ts` (H08/H09)
  - `tests/electrum-movil-campo.test.ts` (H16)
  - `tests/electrum-conversacion-telegram.test.ts` (H17)
- **No se probó:**
  - la web autenticada en producción;
  - la APK en un dispositivo;
  - documentos reales.

## Prompt para lo que queda

```text
Trabaja en therealj94/ULTRON-APP (Dr Electrum). Lee docs/ELECTRUM_AUDITORIA_PROFUNDA.md.
Las etapas 1 y 2 están resueltas con pruebas: no las deshagas. Lo que queda: la pantalla de
revisión humana de fotos transcritas (H11) y la legibilidad en exteriores (H18).
Toda consulta nueva de documentos, capas o carteras tiene que usar los filtros de
server/electrum/organizacion.ts (H14). Para cada cambio: prueba que falle, corrección mínima,
prueba que pase. tsc, npm test con PostGIS local (datos sintéticos) y npm run build. Sin
documentos reales ni la base de producción.
```
