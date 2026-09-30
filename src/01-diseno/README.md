# 01 — Diseño

Paleta negro + cian `#05E1FF`. Tipografías Rajdhani (display) + IBM Plex Mono.
Tokens en `tokens.ts`. La cara define sus colores por modo en `src/02-cara/dibujo.ts` (`getThemeColors`).

AU-RA (web): tokens de color, tipografía, espacio y radios en `aura.ts`, en claro y oscuro, con la lista de pares que mide `tests/aura-web-tokens.test.ts` (≥ 4,5:1 texto, ≥ 3:1 bordes y foco). `useTema.ts` los pone como variables `--aura-*` en la raíz; `tema.css` no escribe colores.
