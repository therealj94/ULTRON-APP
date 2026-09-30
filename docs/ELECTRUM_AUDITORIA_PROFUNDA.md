# Auditoría profunda de Dr Electrum — versión 2, con estado verificado

Fecha: 30 de septiembre de 2026, Honduras. Base: la auditoría de Medardo sobre `25d6591`
(«DR_ELECTRUM_AUDITORIA_PROFUNDA_PARA_CLAUDE.md»). Esta versión la contrasta, hallazgo por
hallazgo, con el código actual de la rama `ccr-732a8335-3t1xol` (PR #84), corrige lo que la
primera versión dijo mal, agrega lo que apareció al verificar y deja resuelta la etapa 1.

**Resultado:** de los 18 hallazgos, 16 seguían vigentes y 1 estaba corregido en parte (H17).
H18 partía de una premisa errónea. En esta versión quedan **resueltos con prueba** H01, H02, H03,
H04, H05, H07 y H10, y en parte H11 y H12; los demás tienen corrección concreta propuesta. Al verificar aparecieron
**3 errores nuevos**, ya corregidos (N1–N3).

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
| H06 | La demo recibe el PDF completo | **Decisión** | `server.ts` ruta `/api/electrum/informe/:id` | — |
| H07 | «Sin datos» pintado como prospectividad «muy baja» | **Resuelto** | `server/electrum/prospectividad.ts`, `src-electrum/mapa/prospectividad.ts`, `Mapa.tsx`, `Tarjeta.tsx` | `tests/electrum-prospectividad.test.ts` |
| H08 | Presupuesto de 50 s no cubre el turno entero | Vigente | `server/electrum/turno.ts`, `lib/agente/bucle.ts` | — |
| H09 | Timeout y desconexión no cancelan lo iniciado | Vigente | `lib/agente/bucle.ts` `conTope`, `server.ts` rutas de turno | — |
| H10 | Cálculos aceptan valores fuera de dominio; supuestos sin etiqueta | **Resuelto** | `lib/minas/calculos.ts` | `tests/minas.test.ts` |
| H11 | Transcripción de fotos entra como texto original | **Parcial** | `server/electrum/aprender.ts` (`meta.origen`, `meta.revisado`) | `tests/electrum-ingesta-atomica.test.ts` |
| H12 | Repetir la carga pierde los avisos | **Resuelto** | `server/electrum/aprender.ts` (`meta.avisos`) | `tests/electrum-ingesta-atomica.test.ts` |
| H13 | Citas sin localizador verificable | Vigente | `server/electrum/turno.ts`, `expedientes-previos.ts` | — |
| H14 | Sin aislamiento por organización o proyecto | **Decisión** | esquema completo | — |
| H15 | Prospectividad sin versión ni invalidación | Vigente | `server/electrum/prospectividad.ts` | — |
| H16 | La app salta al final del hilo aunque se lea atrás | Vigente | `mobile/src/electrum/CampoScreen.tsx` | — |
| H17 | Conversación sin persistencia ni separación por proyecto | Parcial (antes) | `server/electrum/hilo.ts` | — |
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

## Lo que queda: etapa 2

| # | Corrección propuesta | Esfuerzo |
|---|---|---|
| H08 | Un plazo único desde la entrada HTTP. `correrAgente` recibe lo que resta; las herramientas reciben `min(su tope, lo que resta)`; se quita el mínimo de 8 s de la llamada al modelo | Medio |
| H09 | Un `AbortController` por petición, abortado en `res.on('close')`, pasado a `fetchNodo` y a `h.ejecutar`. La ruta no streaming también escucha el cierre | Medio |
| H11 | Leer `meta.origen`/`meta.revisado` en búsqueda y citas; revisión humana de campos críticos | Medio |
| H13 | Evidencias con identificador estable (`doc:<id>#p<pág>#f<frag>`, `web:<hash>`) en un bloque aparte, y validar después que cada cita esté entre lo recuperado | Alto |
| H15 | `version_algoritmo` en `prospectividad_concesion`; lo de otra versión cuenta como pendiente; invalidar al cambiar geología, muestras o satélite | Bajo |
| H16 | En la app, seguir el final solo si ya se estaba abajo; si no, mostrar «respuesta nueva» | Bajo |
| H17 | Persistir también la conversación de la mesa y permitir conversaciones separadas por proyecto | Medio |

**Decisiones que corresponden a José y Medardo, no al código:**

- **H06 — ¿la demo puede ver informes con datos reales?**
  - Si no: la demo usa datos de demostración o recibe una vista previa, y el servidor niega el PDF.
  - Si sí: se dice claramente que se puede guardar; `inline` no lo impide.
- **H14 — ¿Dr Electrum recibirá expedientes de clientes distintos?**
  - Si sí: antes hay que añadir organización y proyecto a documentos, capas, índices e informes.
  - Si sigue siendo interno: documentar el repositorio común y limitar la demo.

## Pruebas de esta versión

- **Suite completa** (`npm test`) contra PostGIS local con datos sintéticos. El resultado exacto está en la descripción del PR #84.
- **Pruebas nuevas:**
  - `tests/normas.test.ts`
  - `tests/electrum-ingesta-atomica.test.ts`
  - `tests/electrum-traslapes-clase.test.ts`
- **Pruebas ampliadas:**
  - `tests/minas.test.ts`
  - `tests/electrum-prospectividad.test.ts`
  - `tests/informe.test.ts`
  - `tests/electrum-hilo.test.ts`
- **No se probó:**
  - la web autenticada en producción;
  - la APK en un dispositivo;
  - la cancelación real (H08/H09, pendiente);
  - los documentos reales.

## Prompt para la etapa 2

```text
Trabaja en therealj94/ULTRON-APP (Dr Electrum). Lee docs/ELECTRUM_AUDITORIA_PROFUNDA.md.
La etapa 1 (H01–H05, H07, H10, H12 y parte de H11) está resuelta con pruebas: no la deshagas.
Empieza por H08 y H09 juntos (plazo único y cancelación real), después H15, H16, H11 y H13.
No toques H06 ni H14 sin la decisión escrita de José o Medardo.
Para cada hallazgo: reprodúcelo con una prueba que falle, corrige lo mínimo, comprueba que la
prueba pasa y que falla con el código anterior, y actualiza la tabla de estado de este documento.
Ejecuta tsc, npm test con PostGIS local (datos sintéticos) y vite build. No uses documentos
reales ni toques la base de producción.
```
