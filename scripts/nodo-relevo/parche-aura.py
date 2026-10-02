import re, sys
ruta_in, ruta_out = sys.argv[1], sys.argv[2]
s = open(ruta_in).read()
def rep(a, b, n=1):
    global s
    c = s.count(a)
    if c != n:
        sys.exit(f'ANCLA {c}x (esperaba {n}): {a[:70]!r}')
    s = s.replace(a, b)

rep("""RE_EXPO = re.compile(r'^Expo(nent)?PushToken\\[[A-Za-z0-9._\\-]{1,120}\\]$')
""", """RE_EXPO = re.compile(r'^Expo(nent)?PushToken\\[[A-Za-z0-9._\\-]{1,120}\\]$')

# ── AU-RA: EL AVISO VA POR SU PROPIO SERVIDOR ─────────────────────────────────
# La app AU-RA no tiene testigo de Expo: avisa por Firebase desde su servidor
# (aura-fp), que es el que tiene la cuenta de Google. La app apunta aqui una
# REFERENCIA que firma AU-RA (correo + HMAC); cuando llega algo, se le devuelve
# a AU-RA con la clave compartida y AU-RA avisa a los telefonos de esa persona.
# Igual que con Expo: ni una palabra del mensaje sale de aqui, solo «hay algo».
AURA_AVISOS = os.environ.get('MENSAJES_AURA_URL', 'https://aura-fp.onrender.com/api/push/relevo')
AURA_CLAVE = os.environ.get('MENSAJES_AURA_CLAVE', '').strip()
RE_AURA = re.compile(r'^[A-Za-z0-9_\\-]{4,200}\\.[A-Za-z0-9_\\-]{32}$')


def _empujar_aura(sus, urgencia):
    \"\"\"El aviso a un telefono de AU-RA, por su servidor. False si AU-RA dice
    que esa referencia ya no vale (404) o que la persona no tiene telefonos (410):
    se poda, y la app la vuelve a apuntar al entrar.\"\"\"
    ref = sus.get('aura') or ''
    if not RE_AURA.match(ref):
        return False
    if not AURA_CLAVE:
        return True                          # sin clave no se avisa, pero tampoco se poda
    cuerpo = json.dumps({'ref': ref, 'tipo': 'llamada' if urgencia == 'high' else 'mensaje'}).encode()
    pet = urllib.request.Request(AURA_AVISOS, data=cuerpo, method='POST', headers={
        'Content-Type': 'application/json', 'Authorization': 'Bearer ' + AURA_CLAVE,
    })
    try:
        with urllib.request.urlopen(pet, timeout=10):
            return True
    except urllib.error.HTTPError as e:
        return e.code not in (404, 410)
    except Exception:
        return True                          # un fallo de red no es una baja
""")

rep("""    if sus.get('expo'):
        return _empujar_expo(sus, urgencia)
    from urllib.parse import urlsplit""", """    if sus.get('aura'):
        return _empujar_aura(sus, urgencia)
    if sus.get('expo'):
        return _empujar_expo(sus, urgencia)
    from urllib.parse import urlsplit""")

rep("""            if not sus.get('expo') and not hay_vapid:
                continue""", """            if not sus.get('expo') and not sus.get('aura') and not hay_vapid:
                continue""")

rep("""                muertos.append((c, sus.get('expo') or '', sus.get('endpoint') or ''))""",
    """                muertos.append((c, sus.get('expo') or '', sus.get('endpoint') or '', sus.get('aura') or ''))""")
rep("""                for c, expo, punto in muertos:""", """                for c, expo, punto, ref in muertos:""")
rep("""                                  if (x.get('expo') or '') != expo
                                  or (x.get('endpoint') or '') != punto]""",
    """                                  if (x.get('expo') or '') != expo
                                  or (x.get('endpoint') or '') != punto
                                  or (x.get('aura') or '') != ref]""")

rep("""                expo = str(b.get('expo', '') or '').strip()
                if expo:
                    if not RE_EXPO.match(expo):""", """                aura = str(b.get('aura', '') or '').strip()
                if aura:
                    # Un telefono con AU-RA: la referencia que firma su servidor.
                    # Un aparato, una referencia (se reemplaza la de ese aparato).
                    if not RE_AURA.match(aura):
                        return self._json(400, {'error': 'referencia inválida'})
                    ap = aparato_de(b)
                    lista = [x for x in f.setdefault('push', [])
                             if x.get('aura') != aura and not (ap and x.get('aura') and x.get('aparato') == ap)]
                    nuevo = {'aura': aura, 'desde': int(time.time() * 1000)}
                    if ap:
                        nuevo['aparato'] = ap
                    lista.append(nuevo)
                    f['push'] = lista[-TOPE_PUSH:]
                    guardar(d)
                    return self._json(200, {'ok': True, 'dispositivos': len(f['push'])})
                expo = str(b.get('expo', '') or '').strip()
                if expo:
                    if not RE_EXPO.match(expo):""")

rep("""            if ruta == '/desuscribir':
                expo = str(b.get('expo', '') or '').strip()""", """            if ruta == '/desuscribir':
                aura = str(b.get('aura', '') or '').strip()
                if aura:
                    f['push'] = [x for x in f.get('push', []) if x.get('aura') != aura]
                    guardar(d)
                    return self._json(200, {'ok': True})
                expo = str(b.get('expo', '') or '').strip()""")
open(ruta_out, 'w').write(s)
print('PARCHE OK')
