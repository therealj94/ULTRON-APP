# Iniciativa y misiones de AU-RA

José (2-oct): «Necesito le des personalidad al avatar, que no tenga yo que decirle qué hacer, me proponga
hacer cosas, me ayude, que quiera cumplir misiones, que se quiera involucrar, conocer a la persona, que no
espere un prompt… que entienda bien el rol de servir y darme cosas por hacer.»

Tres piezas:

| Pieza | Dónde | Qué hace |
|---|---|---|
| Personalidad | `server/desk.ts` (`SERVIR_CON_INICIATIVA`, `SERVIR_CON_INICIATIVA_CORTO`), `lib/perfiles/genesis*.ts` (`TU ROL`) | En la conversación: cierra con UNA oferta concreta, sigue misiones, una pregunta personal por conversación, con frenos. |
| Misiones | `lib/misiones.ts` | Metas por persona con pasos, próximo paso y estado. Herramienta `mision` del harness. |
| Iniciativa | `lib/iniciativa.ts`, `server/iniciativa.ts` | Fuera de la conversación: 1–3 propuestas pensadas por el modelo (o fijas si está caído), con ritmo, horas quietas y backoff. |

## Frenos

- Una propuesta por respuesta. Si la persona está triste, con prisa o en riesgo: solo empatía.
- Si dice que no o «deja de proponer», no insiste (`pideDejarDeProponer` + `frenarIniciativa` para el ritmo).
- Nunca dice que hizo algo que no consta en HECHOS; las propuestas que lo digan se descartan (`sanearPropuestas`).
- Enviar, comprar o pagar sigue esperando su «sí» explícito; una propuesta cuyo `pedido` pague, compre o pida claves se descarta.
- Horas quietas: 21:00–07:00 en Honduras (`America/Tegucigalpa`).
- Ajuste por persona en el perfil, `iniciativa`: `alta` (cada 2 h, hasta 6 al día), `media` (por omisión: cada 4 h, hasta 3), `baja` (1 al día), `apagada`.
- Un «no» duplica el intervalo (×2, ×4, ×8 como máximo); un «sí» lo devuelve a ×1; «luego» no lo cambia.
- La misma idea no se repite en 4 días (`DIAS_SIN_REPETIR`, parecido ≥ 0,5). Una pendiente a la vez; caduca a las 8 h.

## Almacenamiento

Igual que el perfil y la memoria de miembros: caché → disco → S3, por huella sha256 del correo.

- Misiones: `ultron/misiones/<huella>.json` (disco: `ULTRON_MISIONES_DIR` o `data/misiones/`).
- Estado de la iniciativa: `ultron/iniciativa/<huella>.json` (disco: `ULTRON_INICIATIVA_DIR` o `data/iniciativa/`).
- Si S3 no se pudo LEER, nunca se escribe encima: lanza `AlmacenNoDisponible` y las rutas contestan 503.

## Contrato con la app

Todas las rutas van con `exigirMesa` y la sesión firmada. La persona sale **solo** de la sesión; un
`?correo=` o un cuerpo con otro correo se ignoran.

### `GET /api/iniciativa`

```json
{ "propuesta": { "id": "p_1a2b3c4d5e6f", "texto": "¿Cómo vas con «Vender el carro»? Lo siguiente era «Tomar fotos». ¿Lo avanzamos juntos ahora?",
                 "tipo": "seguimiento", "pedido": "Sí, ayúdame con el siguiente paso de mi misión «Vender el carro»: Tomar fotos.",
                 "prioridad": 1, "creada": 1790960000000, "misionId": "m_abc123def456" },
  "motivo": "nueva", "iniciativa": "media", "honesto": true }
```

- `propuesta: null` con `motivo`: `apagada`, `horas_quietas`, `muy_pronto`, `tope_del_dia`, `sin_ideas`.
- `motivo: "pendiente"`: es la misma de antes, sin contestar (no se cuenta otra vez). La app puede llamar seguido.
- `tipo`: `mision` | `conocer` | `ayuda` | `seguimiento` | `dia`.
- Si toca pensar una nueva puede tardar hasta ~15 s (el modelo); sin modelo, al instante.
- 401 sin sesión; 503 `code: "almacen_no_disponible"` si S3 no se pudo leer.

### `POST /api/iniciativa/responder`

Cuerpo `{ "id": "p_…", "respuesta": "si" | "no" | "luego" }` (`"sí"` también vale).

```json
{ "ok": true, "pedido": "Sí, búscame las tres mejores opciones de…", "honesto": true }
```

Con «sí», la app manda `pedido` como turno normal de la persona (`/api/turno` o la voz). Con «no» o
«luego», `pedido: null`. 404 si esa propuesta ya no está pendiente (contestada, caducada o de otra persona).

### `GET /api/misiones[?todas=1]`

```json
{ "misiones": [ { "id": "m_…", "numero": 1, "titulo": "Vender el carro", "objetivo": "…", "porque": "…",
                  "pasos": [ { "texto": "Tomar fotos", "hecho": true, "t": 0 } ], "proximoPaso": "Poner precio",
                  "estado": "activa", "notas": [ { "texto": "…", "t": 0 } ], "creada": 0, "actualizada": 0, "vence": 0 } ],
  "honesto": true }
```

Sin `todas`: las abiertas (activas y pausadas), numeradas como las nombra AURA («la misión 2»). Con
`todas=1`, después también las cerradas (sin `numero`).

### `POST /api/misiones`

| `accion` | Cuerpo | Respuesta |
|---|---|---|
| `crear` | `titulo`, `objetivo?`, `porque?`, `pasos?` (arreglo o «a; b»), `vence?` (ms o `AAAA-MM-DD`) | `{ mision (con numero), durable }` |
| `avanzar` | `id`, y al menos uno de `pasoHecho` (número 1… o texto), `proximoPaso`, `agregarPaso`, `nota` | `{ mision, efecto, durable }` |
| `cerrar` | `id`, `estado?: "descartada"` | `{ mision, durable }` |
| `pausar` / `reanudar` / `descartar` | `id` | `{ mision, durable }` |

`id` acepta el id o el número entre las abiertas. 400 con `error` legible; 404 «No encuentro esa misión.»;
503 si S3 no se pudo leer.

### Ajuste

`PUT /api/perfil` con `{ "iniciativa": "alta" | "media" | "baja" | "apagada" }` (lo valida
`lib/perfil-persona.ts`); `GET /api/perfil` lo devuelve (sin el campo: `media`).

### Empuje (pendiente de conectar)

El reloj (`arrancarIniciativa`) entrega cada propuesta NUEVA a `alProponer(correo, propuesta)`. Acción
propuesta para el canal de acciones del teléfono (lib/acciones-app.ts, como `AccionComputadora`: solo la
empuja el servidor, el modelo no puede pedirla). Se llama `iniciativa` para no chocar con la «propuesta»
de las manos (lib/manos-app.ts), que es otra cosa (una acción que espera el «sí» del turno siguiente):

```json
{ "tipo": "iniciativa", "id": "p_…", "texto": "…", "pedido": "…", "clase": "ayuda", "prioridad": 1, "creada": 0, "misionId": "m_… (opcional)" }
```

La app la muestra como tarjeta (o AURA la dice si está en la pantalla del avatar y no hay conversación en
curso) con «Sí» / «Ahora no» / «Luego», y contesta con `POST /api/iniciativa/responder`. Si el teléfono
no estaba escuchando, la misma propuesta sigue pendiente y sale en el próximo `GET /api/iniciativa`
(al abrir la app). Sondeo sugerido de la app: al abrir y cada 15–30 min en primer plano.

## Conexión en el servidor

1. **Rutas** (server.ts, junto a `montarRutasComputadora`):

   ```ts
   import { montarRutasIniciativa, arrancarIniciativa, correrMisionTurno, bloqueIniciativaTurno, duenoMisiones, accionIniciativa } from './server/iniciativa';
   import { pideDejarDeProponer, frenarIniciativa } from './lib/iniciativa';
   montarRutasIniciativa(app, { exigirMesa, limitar, sesionDe: (req) => sesionDe(req), nivelDe: (c) => nivelDeCorreo(c) });
   ```

2. **Herramienta `mision`** (lib/harness.ts):
   - `HerramientaHarness`: sumar `'mision'`; `RE`: `(web|sistema|ejecutor|leer|computadora|correo|whatsapp|mision)`.
   - `instruccionHarness(nivel, conComputadora, conWhatsapp, conMisiones = true)`: sumar
     `conMisiones ? INSTRUCCION_MISIONES : ''` (`import { INSTRUCCION_MISIONES } from './misiones'`; no hay ciclo).
     Va para junta y miembros (es de cada persona). Pasar `false` en turnos sin sesión.
   - `resolverPedido`: runner opcional `mision?: (arg: string) => Promise<string>` y
     `if (ped.herramienta === 'mision') return runners.mision ? runners.mision(ped.arg.trim() || 'listar') : 'HARNESS mision: no está disponible aquí. No la usé.';`
   - server.ts `correrHerramientaPedida`: `mision: (arg) => correrMisionTurno(dueno, arg),`
     (`dueno` es `correoApp || quienMem`; un id del padrón se lleva a su correo).

3. **Lo del turno** (server.ts `prepararTurno`, junto a `avisosPendientes`):

   ```ts
   if (duenoComputadora) {
     const ini = await bloqueIniciativaTurno(duenoComputadora, perfilDelTurno /* o undefined: lo lee */);
     if (ini) hechos.push(ini);
     if (pideDejarDeProponer(message)) void frenarIniciativa(duenoMisiones(duenoComputadora)).catch(() => {});
   }
   ```

4. **Voz corta** (server/prompt-turno.ts `piezasDelTurno`): `buildPersonality({ …, conHora: false, compacto: p.compacto })`.
   Sin esto la voz lleva la versión larga (funciona, pero ~600 caracteres más).

5. **Reloj** (server.ts, una vez después de `listen`):

   ```ts
   arrancarIniciativa({
     personas: () => personasRecientes(),           // quien usó la app en las últimas ~48 h (un Map que prepararTurno actualiza)
     alProponer: (correo, p) => empujarAccion(correo, accionIniciativa(p) as any).entregada, // sumar AccionIniciativa a AccionApp
     nivelDe: (c) => nivelDeCorreo(c),
     contadores: async (c) => ({ correoSinLeer: /* server/correo */ undefined, whatsappSinLeer: /* server/whatsapp */ undefined }),
   });
   ```

   Telegram como respaldo, solo al chat PRIVADO de la persona (su id del padrón), nunca al de la organización.
