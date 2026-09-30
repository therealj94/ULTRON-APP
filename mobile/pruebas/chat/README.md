# Pruebas del chat (PULSE2CHAT en AU-RA 5.0)

Corren en node el código REAL de `src/pulse` y `src/lib/genesis.ts` (empaquetado con esbuild y los
shims de Expo de `shims/`) contra el relevo REAL (`infra/mensajes/servidor.py`, con un Genesis de
mentira). No tocan la red de fuera.

    ./todas.sh                                   # construye y corre todo
    RELEVO_PY=/copia/servidor.py node voz.cjs    # una sola, contra otra copia del relevo
    SRC=/otra/copia/mobile/src node construir.cjs  # empaqueta otra copia (ver fallar el código de antes)

| prueba | qué demuestra |
|---|---|
| `llavero.cjs` | A1: un llavero que no se deja leer NO se pisa; par volátil sin publicar; vuelve solo |
| `carrera.cjs` | A2: ninguna señal se pierde ni se repite al ir y volver de segundo plano |
| `veneno.cjs` | A3: un mensaje mal formado no tumba la bandeja ni la lista |
| `rendimiento.cjs` | A6: lo ya abierto no se descifra otra vez; sin peticiones solapadas; nada en segundo plano |
| `nombre.cjs` | M1: el alta no pisa el nombre del chat; la cuenta nueva toma el de Genesis |
| `sso.cjs` | M2, B1, B2: enlaces rotos, prefijo exacto, enlace inicial gastado al salir, nada colgado |
| `vuelta.cjs` | La vuelta de la wallet por https (App Link) y por `ultronfp://`, el redirect https de la pestaña segura, la vuelta por intent de la página /sso y los códigos de error del contrato con la wallet |
| `cifrado.cjs` | B3, B4, B6, B7 y `azar.ts`: aparato impostor, tope de fotos, foto sin destinatario, emoji partido, >1024 bytes al azar |
| `senal.cjs` | `senalar` rechaza con el motivo real (403/413/429/400/401/red), en orden |
| `voz.cjs` | el contrato: `redactar`/`enviar`/`descartar` por el bus y `resolverContacto` |
| `formato.cjs` | horas, resúmenes y agrupación de burbujas de las pantallas |

Las pantallas se revisan aparte, en react-native-web (arnés del scratchpad), en claro y oscuro.
