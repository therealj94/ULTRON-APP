# Glifos e íconos del mapa base

Los usa el fondo «calles» (Protomaps) y los nombres de las concesiones en los dos fondos.

- `fuentes/`: glifos SDF de **Noto Sans** (Regular, Medium, Italic), solo los rangos que usa el
  mapa (latín, latín extendido, puntuación). Noto Sans es de Google, con licencia SIL Open Font
  License 1.1.
- `sprites/`: íconos del sabor `dark` de Protomaps Basemaps (con la licencia que indica el
  repositorio `protomaps/basemaps-assets`).

Bajados de `https://protomaps.github.io/basemaps-assets/`. El mapa base en sí (`honduras.pmtiles`,
datos © colaboradores de OpenStreetMap, ODbL) vive en el cubo, en `biblioteca/teselas/`, y lo
sirve `server/electrum/teselas.ts`.
