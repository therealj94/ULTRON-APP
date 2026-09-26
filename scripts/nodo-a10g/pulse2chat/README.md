# Laya en PULSE2CHAT (AU-RA, `aura.service` en el A10G)

Laya mira cada mensaje que llega a AU-RA **antes** de que conteste el modelo y la
política decide qué hacer: un mensaje de cuidado ante una crisis, una negativa firme
ante una estafa o insultos, silencio ante spam repetido, un aviso en el prompt ante un
intento de inyección, una línea de tono ante alguien molesto o triste, y un aviso al
equipo cuando hace falta una persona. Nunca bloquea cuentas ni borra mensajes.

**Si Laya está caída, lenta o sin configurar, AU-RA contesta exactamente como hoy.**

| Archivo | Qué es |
|---|---|
| `laya_cliente.py` | Cliente HTTP (solo biblioteca estándar). Plazo duro de 800 ms, cortacircuitos (5 s → 10 → … → 2 min; un acierto lo resetea). Nunca lanza: si falla, `None`. |
| `politica.py` | Umbrales → decisiones, textos fijos, avisos para el prompt, registro de moderación. |
| `integracion.diff` | Parche contra `/srv/aura/asistente.py` con md5 `e0a03fd52869f42b4ef95052b3deeb2b` (versión del 7-sep). |
| `test_politica.py` | 42 pruebas con un Laya de mentira en 127.0.0.1. |

## Qué cambia el parche (7 trozos, unas 150 líneas)

1. `import politica` con red debajo: si el archivo falta o no importa, AU-RA arranca sin Laya.
2. `_derivar_al_equipo` pasa a usar `_telefonos_del_equipo()` (lo mismo que ya hacía, sacado a una función para que Laya avise a los mismos admins del `AURA_ESCALAFON`).
3. Funciones nuevas: `_canal_de`, `_contacto`, `_avisar_al_equipo_laya` (WhatsApp, en su propio hilo) y `_laya_mira`.
4. En `_atender`, justo después de fijar el idioma y **antes** del guion, la puerta del idioma, el embudo y el freno de ráfaga: se pregunta a Laya (no a los botones tocados). Si la política contesta (crisis, estafa, abuso, spam), se manda esa respuesta y no se llama al modelo.
5. Después de oír una nota de voz: se pregunta a Laya por el texto transcrito.
6. El freno de ráfaga no se aplica a quien Laya ve en riesgo; y las líneas de Laya se pegan al **final** del prompt de sistema justo antes de `preguntar_motor` (la cabecera, el prompt y el saber siguen saliendo de la caché de Ollama).
7. Una línea en el arranque: `Laya encendida · modo …` o `Laya apagada`.

## Umbrales (probabilidad calibrada de Laya)

| Etiqueta | Umbral | Acción |
|---|---|---|
| crisis | ≥ 0.85 | Mensaje de cuidado fijo (911 en Honduras o emergencias local, alguien de confianza), sin modelo; aviso inmediato al equipo; 2 h con guía de cuidado en el prompt. |
| crisis | ≥ 0.50 | Contesta el modelo con guía de cuidado. |
| estafa | ≥ 0.90 | Negativa firme y corta, sin modelo; aviso al equipo. Si además es `urgente` (alguien que reporta), el modelo contesta con alerta de estafa y se avisa como urgente. |
| estafa | ≥ 0.60 | Alerta de estafa en el prompt. |
| abuso | ≥ 0.90 | Respuesta firme y corta, sin modelo; aviso al equipo. |
| abuso | ≥ 0.60 | Guía de calma en el prompt. |
| spam | ≥ 0.90 | Una línea mínima; si repite en 10 min, silencio (como la puerta del idioma). |
| ataque | ≥ 0.60 | `AVISO_INYECCION` al final del prompt. |
| urgente | ≥ 0.70 | Aviso al equipo; el modelo contesta igual. |
| molesto / triste | ≥ 0.60 | Una línea de tono en el prompt. |
| simple | razonar no pasa + `tarea_conversacion` + sin banderas | Solo se marca en el registro, y solo con `LAYA_SIMPLE=1`. |

Por qué esos números: lo que **quita** la respuesta del modelo pide precisión (0.85–0.90);
lo que solo **añade** una línea al prompt cuesta casi nada si sobra (0.60); lo que molesta
a una persona del equipo va en medio (0.70) y con freno por persona (crisis 15 min,
lo demás 30 min). Se cambian sin tocar código con `LAYA_UMBRALES` y se deberían revisar
con el registro de moderación después de las primeras semanas.

## Antes de empezar

- El servicio Laya tiene que contestar `POST /laya/v1/mensaje`. Hoy (26-sep) el A10G llega a `https://35-175-175-203.sslip.io/laya/salud` (200, TLS verificado) pero `/v1/mensaje` todavía da **404**.
- Hace falta la clave (`LAYA_CLAVE`) que configure quien despliega Laya.
- Hacerlo a una hora tranquila: el reinicio templa el modelo (unos segundos).

## Despliegue paso a paso (en el A10G, como root)

```bash
# 0 · El parche se hizo contra ESTA versión. Si el md5 no coincide, NO aplicar:
#     hay que regenerar el parche contra la versión que haya.
md5sum /srv/aura/asistente.py      # esperado: e0a03fd52869f42b4ef95052b3deeb2b

# 1 · Copiar los archivos (desde donde esté el repo en la máquina, o subidos a /tmp/laya-p2c)
install -o root -g root -m 644 laya_cliente.py politica.py /srv/aura/
install -d -o root -g root -m 700 /root/laya-p2c
install -o root -g root -m 644 integracion.diff test_politica.py /root/laya-p2c/

# 2 · El EnvironmentFile, root y 600 (lleva la clave). Empezar en modo sombra.
install -o root -g root -m 600 /dev/null /etc/aura-laya.env
cat > /etc/aura-laya.env <<'EOF'
LAYA_URL=https://35-175-175-203.sslip.io/laya
LAYA_CLAVE=<la clave de Laya>
LAYA_TIMEOUT_MS=800
# sombra: clasifica y registra, pero AU-RA no cambia nada. Pasar a «activo» tras revisar.
LAYA_MODO=sombra
# Opcionales:
# LAYA_UMBRALES=crisis=0.85,estafa=0.9,abuso=0.9,spam=0.9,ataque=0.6,urgente=0.7
# LAYA_SIMPLE=1
# LAYA_REGISTRO_DIR=/srv/aura/moderacion
# LAYA_RETENCION_DIAS=30
# LAYA_SAL=<si no se pone, se crea /srv/aura/moderacion/.sal con 600>
EOF
chmod 600 /etc/aura-laya.env

# 3 · El drop-in de systemd (con guion: si el archivo falta, arranca igual, sin Laya)
cat > /etc/systemd/system/aura.service.d/laya.conf <<'EOF'
# Laya: el clasificador que mira cada mensaje antes del modelo. Ver politica.py.
# Para volver atras: borrar este archivo, daemon-reload y restart.
[Service]
EnvironmentFile=-/etc/aura-laya.env
EOF

# 4 · Respaldo con el mismo estilo de nombre que los demás, y parche
cp -p /srv/aura/asistente.py /srv/aura/asistente.py.antes-laya.$(date +%s)
cd /srv/aura
patch --dry-run -p1 < /root/laya-p2c/integracion.diff     # tiene que decir solo «checking file asistente.py»
patch -p1 < /root/laya-p2c/integracion.diff
python3 -m py_compile /srv/aura/asistente.py && echo COMPILA

# 5 · (Recomendado) Las pruebas, contra el archivo ya parchado. No tocan /srv/aura:
#     el registro va a una carpeta temporal y Laya es uno de mentira en 127.0.0.1.
cp /srv/aura/laya_cliente.py /srv/aura/politica.py /root/laya-p2c/
cd /root/laya-p2c && AURA_ASISTENTE_PY=/srv/aura/asistente.py python3 -m unittest test_politica.py
rm -rf /root/laya-p2c/__pycache__

# 6 · Reiniciar
systemctl daemon-reload
systemctl restart aura.service
```

### Verificar

```bash
systemctl status aura.service --no-pager | head -5
journalctl -u aura.service -n 60 --no-pager | grep -E 'Laya|AU-RA de pie'
#   esperado:  «Laya encendida · modo sombra»  y  «AU-RA de pie · …»
#   si dice «Laya no se pudo cargar» → faltan laya_cliente.py/politica.py en /srv/aura

# Tras el primer mensaje de alguien:
ls -la /srv/aura/moderacion/                 # carpeta 700, archivos 600, .sal 600
python3 - <<'EOF'
import json, glob, collections
c = collections.Counter()
for f in glob.glob('/srv/aura/moderacion/moderacion-*.jsonl'):
    for l in open(f, encoding='utf-8'):
        c[json.loads(l)['accion']] += 1
print(dict(c))       # p. ej. {'ninguna': 12, 'sin_laya': 0, 'tono_molesto': 1}
EOF
journalctl -u aura.service --since '1 hour ago' --no-pager | grep -E 'Laya (no contesta|volvió)'
```

`sin_laya` alto o líneas «Laya no contesta» → revisar `LAYA_URL`/`LAYA_CLAVE` (un 401 sale
como `HTTP 401`) o el servicio en la T4. AU-RA sigue contestando igual mientras tanto.

### Pasar de sombra a activo

Tras uno o dos días revisando el registro (qué habría hecho Laya, `"sombra": true`):

```bash
sed -i 's/^LAYA_MODO=.*/LAYA_MODO=activo/' /etc/aura-laya.env
systemctl restart aura.service
journalctl -u aura.service -n 30 --no-pager | grep 'Laya encendida'   # «modo activo»
```

## Avisos al equipo

Salen por **WhatsApp** a un teléfono por cada admin de `AURA_ESCALAFON` (hoy 2 admins con
teléfono; `AURA_PARTE_PARA` de respaldo), igual que `_derivar_al_equipo`, venga el mensaje
del chat de la casa, de WhatsApp o de la web. Nunca por el `rel` de la web: el `Recado`
de `portal.py` pega en la respuesta al visitante todo lo que se le «envía».

Mismas limitaciones que el aviso que ya existe: el proveedor necesita una conversación
abierta con ese admin, y Meta solo deja texto libre dentro de las 24 h desde el último
mensaje del admin. Si el aviso no sale queda en el journal («el aviso de Laya al equipo
no salio» / «sin hilo para»); el registro de moderación lo guarda igual (`aviso_equipo`).
`AURA_AVISAR_A` (aviso del guardia) no está puesto en el nodo.

## El registro de moderación

`/srv/aura/moderacion/moderacion-AAAA-MM-DD.jsonl`, carpeta 700, archivos 600, borrado a
los 30 días. Por línea: `fecha`, `huella` (HMAC-SHA256 con sal del correo/teléfono, 16 hex;
nunca el correo), `canal` (`chat`/`whatsapp`/`web`), `etiquetas`, `p`, `accion`,
`acciones`, `ms`, y `texto` (300 caracteres, con correos, números largos y claves tapados)
**solo** si la acción es de crisis, estafa, abuso o urgente. De un mensaje normal no se
guarda ni una palabra. El texto nunca va al journal.

## Volver atrás

**Rápido, sin tocar código** (el parche queda inerte: sin `LAYA_URL` no se llama a nadie):

```bash
rm /etc/systemd/system/aura.service.d/laya.conf
systemctl daemon-reload && systemctl restart aura.service
journalctl -u aura.service -n 30 --no-pager | grep 'Laya apagada'
```

**Completo:**

```bash
cp -p /srv/aura/asistente.py.antes-laya.<epoca> /srv/aura/asistente.py
md5sum /srv/aura/asistente.py              # e0a03fd52869f42b4ef95052b3deeb2b
rm -f /etc/systemd/system/aura.service.d/laya.conf /etc/aura-laya.env
rm -f /srv/aura/laya_cliente.py /srv/aura/politica.py
systemctl daemon-reload && systemctl restart aura.service
# El registro de moderación tiene extractos sensibles: borrarlo solo si se decide así.
# rm -rf /srv/aura/moderacion
```
