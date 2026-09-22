# De ULTRON FP a AU-RA FP

**Por qué:** «Ultron» es una marca de un tercero. El producto pasa a llamarse **AU-RA FP** (*Financial Protocol*).

**Qué es AU-RA FP ahora:** el operador del protocolo SFSP para todo el ecosistema. Presta los servicios a cada empresa (Orden Global, AuCorp, DBNX) y vigila que se cumplan las reglas. **Opera y comprueba; no aprueba nada monetario.** Esta app es su cara: la asistente de la junta (servicio S13). El diseño completo está en el monorepo, en `sfsp/operador/AU-RA-FP.md` y `sfsp/adr/ADR-014-au-ra-fp-operador-del-protocolo.md`.

---

## 1 · Lo que ya cambió

Todo lo que una persona **ve u oye**:

| Dónde | Antes | Ahora |
|---|---|---|
| Cómo se presenta la asistente (perfiles Genesis y Minas, bienvenida, prompts) | «Eres ULTRON…» | «Eres AU-RA…» |
| Nombre de la app en el teléfono, textos de permisos de cámara y micrófono | ULTRON FP | AU-RA FP |
| Título de la web, manifiesto, pantallas, menú, login | ULTRON FP / Ultron | AU-RA FP |
| Telegram: leyendas y nombres de archivo | `ULTRON`, `ultron.mp3` | `AU-RA`, `aura-fp.mp3` |
| PDF generados | ULTRON FP | AU-RA FP |
| Pronunciación | — | la voz dice «Aura» y «Aura efe pe»; no deletrea |
| Cómo se la llama por voz | «ultron» | «aura» **y** «ultron» (la junta la lleva meses llamando así) |
| Documentación | ULTRON FP | AU-RA FP |

Pruebas: 188 en verde (`npm test`), tipos limpios en web y APK, comprobaciones de intenciones y escena de la APK en orden. `tests/nombre-au-ra.test.ts` fija la pronunciación y que responda a los dos nombres; `tests/junta.test.ts` exige que la bienvenida ya no diga «Ultron».

---

## 2 · Lo que NO cambió, a propósito

Cambiarlo hoy rompería algo que ya funciona:

| Qué | Por qué se queda | Qué pasaría si se cambiara |
|---|---|---|
| Paquete de la APK `link.ordenglobal.ultronfp` | Es la identidad de la app para Android | Sería **otra app**: la instalada no se actualiza y la gente pierde su sesión y su memoria local. **No se cambia nunca.** |
| Claves locales `ultron_fp_*_v2` | Guardan sesión, memoria y ajustes en cada teléfono | Todos quedarían deslogueados y sin memoria |
| Rutas `/api/ultron/*` y encabezados `X-Ultron-*` | Las llaman las APK ya instaladas | Las APK en la calle dejarían de entrar |
| Variables `ULTRON_*` | Están configuradas así en Render | El servicio arrancaría sin cerebro, sin voz y sin memoria |
| Dominio `ultron.ordenglobal.link`, servicio `ultron-looi-desk` | Es donde vive hoy | Caída hasta que se reconfigure todo |
| `rol: 'ultron'` y la clave S3 `ultron/memoria-junta.json` | Son datos ya guardados | La memoria de la junta dejaría de leerse |
| Nombres internos (`UltronFace`, `logUltron`…) y comentarios | Nadie de fuera los ve | Nada; se pueden cambiar poco a poco |

---

## 3 · Lo que falta, y quién lo hace

**Antes de nada: D20.** «AU-RA» también necesita revisión de marca. Pasar de un nombre ajeno a otro sin revisarlo sería repetir el problema.

1. **Regrabar `public/voz/bienvenida.mp3`.** Su audio dice «ULTRON, en línea». Mientras tanto la web no lo usa (está fuera del banco). El guion ya tiene el texto nuevo. Hace falta la clave de ElevenLabs, que es de José:
   `ELEVENLABS_API_KEY=… node scripts/grabar-banco.mjs bienvenida --force`
   (sin `--force` el script no sobreescribe un archivo que ya existe). Después, volver a poner la entrada `bienvenida` en `src/03-voz/banco.ts`, que está comentada con este mismo motivo.
   La APK descarga ese archivo del servidor, así que regrabarlo arregla también la APK, sin publicar una nueva.
2. **Escuchar `public/voz/quien.mp3` y `public/voz/discurso.mp3`.** No tienen guion en el repositorio y no se puede saber desde el código si dicen el nombre viejo.
3. **Rutas con nombre nuevo.** Añadir `/api/aura/*` como alias de `/api/ultron/*`; publicar una APK que use las nuevas; retirar las viejas sólo cuando ninguna APK instalada las llame.
4. **Variables `AURA_FP_*`.** La bóveda (`lib/boveda.ts`) ya acepta varios nombres por clave: añadir el nuevo delante del viejo, cambiar Render, y retirar el viejo después.
5. **Dominio y servicio.** Crear el dominio y el servicio nuevos, dejar el viejo redirigiendo hasta que no quede tráfico.
6. **El nombre del repositorio** (`ULTRON-APP`) lo decide su dueño; GitHub redirige solo.

Los pasos 3 a 5 son despliegues: se hacen con accesos y con la regla de siempre, **producción igual al repositorio**.

---

## 4 · Dos cosas para decidir

- **AU-RA ya existe como la asistente de WhatsApp y de la app.** Se asume que las dos pasan a ser la misma familia: AU-RA FP es la plataforma, y la asistente es su canal público. Si no es eso lo que se quiere, uno de los dos nombres tiene que cambiar.
- **El género de la persona.** Los textos de la junta dicen «el asistente privado»; la AU-RA pública es «la asistente», y la voz es femenina (Gabriela). Conviene decidir uno y ajustar los textos de la persona.
