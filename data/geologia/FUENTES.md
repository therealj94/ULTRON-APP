# Geología abierta para Dr Electrum

Paquete armado por `scripts/electrum/geologia/preparar.py` y cargado en el catastro con
`POST /api/electrum/geologia/cargar` (solo quien manda) o `cargarGeologia()` de
`server/electrum/geologia-datos.ts`. Cada archivo es una capa; su nombre decide el rol (esquema v8).

| Archivo | Capa y rol | Fuente | Licencia | Escala / precisión |
|---|---|---|---|---|
| `geologia-usgs.geojson.gz` | Geología superficial (litologia) | USGS OFR 97-470-K, French y Schenk (2004), sobre Case y Holcombe (1980) | Dominio público | 1:2 500 000, RMS ≈ 1,6 km |
| `fallas-usgs.geojson.gz` | Fallas geológicas (falla) | USGS OFR 97-470-K | Dominio público | 1:2 500 000 |
| `provincias-usgs.geojson.gz` | Provincias geológicas (provincia_geologica) | USGS OFR 97-470-K | Dominio público | regional |
| `fallas-activas-gem.geojson.gz` | Fallas activas (falla, `ACTIVA = sí`) | GEM Global Active Faults, catálogo Centroamérica y Caribe (Styron y Pagani, 2020) | CC BY-SA 4.0 | regional |
| `placas-pb2002.geojson.gz` | Límites de placa (placa) | PB2002, Bird (2003); conversión de H. Ahlenius | ODC-BY 1.0 | global |
| `tractos-porfido-usgs.geojson.gz` | Tractos permisivos pórfido de cobre (tracto_permisivo) | USGS SIR 2010-5090-I, Gray y otros (2014) | Dominio público | 1:1 000 000 aprox. |
| `yacimientos-porfido-usgs.geojson.gz` | Depósitos y prospectos de pórfido (ocurrencia) | USGS SIR 2010-5090-I | Dominio público | puntual |
| `yacimientos-mrds-usgs.geojson.gz` | Yacimientos MRDS (ocurrencia) | USGS Mineral Resources Data System, servicio WFS | Dominio público | puntual, calidad variable |
| `paises-natural-earth.geojson.gz` | Fondo del mapa geotectónico (no va a la base) | Natural Earth 1:50 m | Dominio público | 1:50 000 000 |

Lo que NO es: un mapa para decidir dentro de una concesión. El mapa geológico es regional; Dr
Electrum lo dice en cada respuesta, mapa e informe, y trata sus cruces como indicios, no como
recursos. La cartografía de detalle (1:50 000, 1:100 000 de las misiones japonesas en Olancho,
hojas del IHCIT) se sube como capa propia y entra con el mismo rol si su nombre lo dice.
