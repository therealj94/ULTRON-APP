#!/usr/bin/env python3
"""
¿QUÉ JS CORRE LA APP EN EL EMULADOR? Lee la copia de la base de expo-updates (updates.db, con su -wal y -shm al lado)
que correr.sh saca del emulador y dice qué actualización LANZÓ la app: la OTA (con su updateId y runtime) o el JS
embebido en la APK.

Por qué la base y no el logcat: expo-updates no escribe en el logcat qué actualización lanza. La línea «Stored update
found: ID = …» que usaba correr.sh sale de CheckForUpdateProcedure cuando ESA actualización es MÁS NUEVA que la lanzada
y ya está bajada: dice lo contrario de «la carga» (bajada y pendiente, no corriendo).

La regla (expo-updates 29, android/.../db): `updates` guarda cada actualización con `status` (1 = READY: una OTA bajada;
5 = EMBEDDED: el JS de la APK; 3 = PENDING; 6 = DEVELOPMENT), `last_accessed` (DatabaseLauncher lo marca al lanzarla,
pero una OTA recién bajada también lo trae con la hora en que se guardó) y `successful_launch_count` /
`failed_launch_count` (suben solo cuando se lanzó de verdad). Lanzada = la de `last_accessed` más reciente entre las
que se lanzaron alguna vez. Una READY sin lanzamientos es «bajada, sin lanzar todavía».

Uso: python3 -I ota-cargada.py <ruta/updates.db>  →  JSON por stdout. Nunca falla: sin base legible, `leida: false`.
"""
import json
import os
import sqlite3
import sys
import uuid

FUENTE = {1: "ota", 3: "pendiente", 5: "embebido", 6: "desarrollo"}
LANZABLES = (1, 5, 6)


def id_de(valor):
    """El id es un UUID de 16 bytes (dos long big-endian, Converters.uuidToBytes): en texto, el updateId de EAS."""
    if isinstance(valor, (bytes, bytearray)) and len(valor) == 16:
        return str(uuid.UUID(bytes=bytes(valor)))
    return str(valor or "")


def leer(ruta):
    salida = {"leida": False, "lanzada": None, "embebida": None, "descargadas": [], "filas": 0}
    if not ruta or not os.path.isfile(ruta) or os.path.getsize(ruta) == 0:
        salida["motivo"] = "No se pudo sacar updates.db del emulador (sin su o sin la base)."
        return salida
    try:
        # Es una copia nuestra: se abre normal para que SQLite aplique el -wal que vino con ella.
        con = sqlite3.connect(ruta)
        filas = con.execute(
            "SELECT id, runtime_version, status, last_accessed, successful_launch_count, failed_launch_count"
            " FROM updates ORDER BY last_accessed DESC"
        ).fetchall()
        con.close()
    except Exception as e:  # base rara o de otra versión: no se adivina
        salida["motivo"] = f"No se pudo leer updates.db ({type(e).__name__})."
        return salida
    salida["leida"] = True
    salida["filas"] = len(filas)
    lanzada = None
    embebida = None
    for (bid, runtime, estado, accedida, buenos, malos) in filas:
        fila = {
            "fuente": FUENTE.get(estado, f"estado-{estado}"),
            "updateId": id_de(bid),
            "runtime": runtime or "",
            "lanzamientos": int(buenos or 0),
            "fallos": int(malos or 0),
            "accedida": int(accedida or 0),
        }
        if estado == 5 and embebida is None:
            embebida = fila
            salida["embebida"] = fila["updateId"]
        if estado == 1 and fila["lanzamientos"] + fila["fallos"] == 0:
            salida["descargadas"].append(fila["updateId"])
        if lanzada is None and estado in LANZABLES and fila["lanzamientos"] + fila["fallos"] > 0:
            lanzada = fila
    if lanzada is None and embebida is not None:
        # Nada lanzado contado todavía (el contador sube unos segundos después de pintar): lo que hay es la APK.
        lanzada = embebida
    salida["lanzada"] = lanzada
    if lanzada is None:
        salida["motivo"] = "La base no tiene ninguna actualización lanzada."
    return salida


if __name__ == "__main__":
    print(json.dumps(leer(sys.argv[1] if len(sys.argv) > 1 else ""), ensure_ascii=False))
