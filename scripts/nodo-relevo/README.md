# Relevo de PULSE2CHAT: avisos de AU-RA

El relevo del chat corre en `ogb-testnet-2` (`/srv/mensajes/servidor.py`, servicio `mensajes`, detrás de
Caddy en `cerebro.ordenscan.com/mensajes`). Ya avisaba a navegadores (VAPID) y a la app Orden Global
(Expo). La app AU-RA avisa por Firebase desde su propio servidor, así que se le sumó un tercer tipo de
suscripción: `aura`.

- La app pide a AU-RA `GET /api/push/relevo/ref` (con su sesión) una referencia firmada (correo + HMAC)
  y la apunta en el relevo con `POST /suscribir {aura, aparato}` (con la llave de su cuenta del chat).
- Cuando llega un mensaje (o una llamada), el relevo hace `POST https://aura-fp.onrender.com/api/push/relevo`
  con `Authorization: Bearer <MENSAJES_AURA_CLAVE>` y `{ref, tipo}`. AU-RA avisa a los teléfonos de la persona.
  Ni una palabra del mensaje sale del relevo.
- 404 (referencia mala) o 410 (sin teléfonos) → el relevo poda esa suscripción; la app la vuelve a apuntar al entrar.

## Despliegue (hecho el 2-oct-2026)

1. `parche-aura.py actual.py nuevo.py` sobre una copia; `prueba-aura.py nuevo.py` contra un AU-RA falso local.
2. Respaldo `servidor.py.antes-aura-<fecha>`, instalar `nuevo.py`, clave en `/etc/mensajes-aura.env` (600) y
   `EnvironmentFile` en `/etc/systemd/system/mensajes.service.d/aura.conf`; reinicio y `/salud` 200 (si no,
   vuelve atrás solo).
3. La misma clave en Render (aura-fp) como `PUSH_RELEVO_CLAVE`.

Para volver atrás: copiar el respaldo sobre `servidor.py` y `systemctl restart mensajes`.
