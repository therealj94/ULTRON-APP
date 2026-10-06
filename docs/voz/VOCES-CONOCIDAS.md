# Voces conocidas: quién habla (dueño y círculo cercano)

Código: `lib/voces-motor.ts` (motor en un proceso hijo, sherpa-onnx-node, modelo 3D-Speaker CAM++ fijado por sha256),
`lib/voces-miembro.ts` (lo guardado, por cuenta), `server/voces-rutas.ts` (rutas), `mobile/src/voces/*` (teléfono).

## Qué se guarda

Solo números (hasta 8 juegos de 192 por persona), la relación y la frase de consentimiento. Nunca audio: se procesa en
memoria y se descarta. Todo es por cuenta (el correo sale de la sesión firmada). «Olvida la voz de Ana», «olvida mi voz»
y «olvida todas las voces» borran de verdad.

## Cómo se usa en el turno

- El teléfono (oído **Turbo**) entrega el audio de cada frase al cerrarse; la identificación corre en paralelo y el turno
  de ESA frase la espera como mucho 350 ms. Si no llega, el turno no dice nada del hablante (nunca usa el de la frase
  anterior para dar permiso).
- Cuando la voz es de alguien del círculo (no del dueño), el turno lleva `quienHabla` (validado en el servidor contra las
  voces guardadas de esa cuenta). Solo **frena**: el cerebro no le lee las cosas privadas del dueño, y su «sí» o «no» no
  envía ni descarta borradores (se pide la confirmación del dueño).
- Frase corta («sí», «dale»): no alcanza para identificar. Si en los últimos 15 s habló alguien del círculo y desde
  entonces no se reconoció al dueño, el turno lleva `quienHabla` con `reciente: true` y se frena igual.

## Límites conocidos (decisión de producto)

- **Una voz que no está guardada no frena nada.** Si habla un invitado cuya voz nadie presentó, el resultado es «no sé
  quién es» y el turno se trata como siempre. Frenar a toda voz desconocida bloquearía al dueño cada vez que el micrófono
  lo oye mal. La protección cubre a las personas del círculo que se presentaron.
- Solo con el oído Turbo: el reconocedor de Google del teléfono no entrega audio y la conversación en vivo (WebRTC con
  ElevenLabs) tampoco.
- El umbral (0,6) y el margen (0,1) se ajustan con `ULTRON_VOCES_UMBRAL` y `ULTRON_VOCES_MARGEN` si en el teléfono real
  confunde voces parecidas. `ULTRON_VOCES=0` lo apaga.
