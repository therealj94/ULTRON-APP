/**
 * La página del motor de caras (la carga MotorCaras.tsx en una WebView escondida; la prueba
 * pruebas/caras/navegador.mjs la carga en Chromium, el mismo motor que la WebView de Android).
 *
 * face-api (@vladmandic/face-api, MIT) con TensorFlow.js dentro, fijado a una versión y con su huella
 * SRI: si el archivo del CDN cambiara un solo byte, el navegador no lo ejecuta. Los modelos (~7 MB:
 * detector chico, 68 puntos y la red de 128 números) salen de la misma versión fijada del paquete.
 *
 * Entrada:  window.__caras({ tipo: 'analizar', id, imagen: <jpeg en base64>, cajas?: [{x,y,w,h} (0..1)] })
 *           Con `cajas` (las de ML Kit de esa misma foto) se analiza un recorte agrandado de cada una: las
 *           caras chicas o lejanas salen mucho mejor que buscándolas en la foto entera. Sin `cajas`, la foto
 *           entera (detector chico a 416).
 * Salida:   { tipo: 'lista', motor, calentarMs } · { tipo: 'caras', id, caras: [{ caja:{x,y,w,h} (0..1), vector:[128], puntaje, indice? }], ms }
 *           · { tipo: 'error', id, motivo } · { tipo: 'fallo', motivo } (no cargó: sin WebGL, sin red)
 * La imagen no se guarda: se decodifica, se analiza y se suelta.
 *
 * Calentar (José, 6-oct: «tarda en reconocer»): antes de decir «lista», las tres redes corren una vez sobre un lienzo gris.
 * La PRIMERA vez que corre cada red, WebGL compila sus programas: en el Chromium de pruebas el primer análisis de quien
 * llegaba tardaba ~6,5 s y los siguientes ~1,7 s. Calentando al cargar (cuando se enciende la cámara, nadie espera), el
 * primer análisis de verdad tarda como los demás (~0,7 s en esa prueba). Decodificar la foto en base64 cuesta ~1-2 ms: no
 * hace falta pasarle el archivo.
 */
export const FACE_API_VERSION = '1.7.15';
export const FACE_API_URL = `https://cdn.jsdelivr.net/npm/@vladmandic/face-api@${FACE_API_VERSION}/dist/face-api.js`;
export const FACE_API_SRI = 'sha384-M5nePoB6/w/a9JhtegEibSLGiJy/+QMZZMfvcxjWVCQW/HPwrQ7i21V/Px/8AyVA';
export const MODELOS_URL = `https://cdn.jsdelivr.net/npm/@vladmandic/face-api@${FACE_API_VERSION}/model/`;

/**
 * DE LAS CARAS DE UN RECORTE, LA DE LA CAJA (va tal cual dentro de la página; la prueba la corre en Node:
 * pruebas/caras/vivo.prueba.mjs). `rs`: lo que encontró el detector en el lienzo ({ x, y, w, h } en px del lienzo);
 * `esperada`: dónde está la cara de la caja de ML Kit en ese mismo lienzo ({ cx, cy, lado } en px).
 *
 * José, 6-oct: «9 recortes: 4 sin cara» con dos personas en la mesa. Antes se elegía la cara más cercana al CENTRO del
 * lienzo y se descartaba si quedaba a más de 0,3 del ancho. Pero el recorte se recorta contra el borde de la foto (el
 * nativo y el motor, Cuadro.kt cuadradoConMargen y aquí): con la cara cerca de un borde —lo normal con el teléfono
 * sobre la mesa y dos personas, cada una hacia un lado o con la cabeza arriba del cuadro— la cara de la caja NO queda
 * en el centro: salía «sin cara» o, peor, ganaba la vecina que entraba en el margen (el voto de la otra persona). Ahora
 * se elige la más cercana a donde la caja dice que está, y solo si cae cerca (menos de `0,66 × lado`, lo mismo que
 * antes medido en tamaño de cara) y no es mucho más chica que la esperada (una cara del fondo no es la de la caja).
 */
export const ELEGIR_CARA_JS = `function elegirCara(rs, esperada) {
  var mejor = -1, dmin = Infinity;
  for (var i = 0; i < rs.length; i++) {
    var b = rs[i];
    var dd = Math.hypot(b.x + b.w / 2 - esperada.cx, b.y + b.h / 2 - esperada.cy);
    if (dd < dmin) { dmin = dd; mejor = i; }
  }
  if (mejor < 0 || dmin > esperada.lado * 0.66) return -1;
  if (Math.max(rs[mejor].w, rs[mejor].h) < esperada.lado * 0.35) return -1;
  return mejor;
}`;

export const MOTOR_CARAS_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<script src="${FACE_API_URL}" integrity="${FACE_API_SRI}" crossorigin="anonymous"></script>
</head><body style="margin:0;background:transparent">
<script>
(function () {
  var MODELOS = ${JSON.stringify(MODELOS_URL)};
  window.__carasSalida = [];
  function enviar(m) {
    window.__carasSalida.push(m);
    try { if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(m)); } catch (e) {}
  }
  var listo = null;
  function cargar() {
    if (listo) return listo;
    listo = (async function () {
      if (typeof faceapi === 'undefined') throw new Error('no cargó face-api (sin red o huella distinta)');
      try { await faceapi.tf.setBackend('webgl'); } catch (e) { await faceapi.tf.setBackend('cpu'); }
      await faceapi.tf.ready();
      await Promise.all([
        faceapi.nets.tinyFaceDetector.loadFromUri(MODELOS),
        faceapi.nets.faceLandmark68Net.loadFromUri(MODELOS),
        faceapi.nets.faceRecognitionNet.loadFromUri(MODELOS),
      ]);
    })();
    return listo;
  }
  var MAX_CAJAS = 4, LADO_RECORTE = 320, MARGEN_RECORTE = 2.2;
  ${ELEGIR_CARA_JS}
  var lienzo = document.createElement('canvas');
  function cara(d, x, y, w, h, indice) {
    var o = {
      caja: { x: x, y: y, w: w, h: h },
      vector: Array.prototype.map.call(d.descriptor, function (v) { return Math.round(v * 1e4) / 1e4; }),
      puntaje: Math.round(d.detection.score * 100) / 100,
    };
    if (typeof indice === 'number') o.indice = indice;
    return o;
  }
  var cola = Promise.resolve();
  window.__caras = function (m) {
    if (!m || m.tipo !== 'analizar') return;
    cola = cola.then(async function () {
      var t0 = Date.now();
      try {
        await cargar();
        var img = new Image();
        img.src = 'data:image/jpeg;base64,' + m.imagen;
        await img.decode();
        var W = img.naturalWidth, H = img.naturalHeight;
        var caras = [];
        var cajas = Array.isArray(m.cajas) ? m.cajas.slice(0, MAX_CAJAS) : [];
        if (cajas.length) {
          // Con las cajas de ML Kit: cada cara se recorta con margen y se agranda a ~LADO_RECORTE px. Una
          // cara lejana (40 px en la foto entera, que el detector chico a 416 no ve) ocupa la mitad del
          // recorte y sale con sus puntos bien puestos. 'indice' dice de qué caja es cada vector.
          for (var i = 0; i < cajas.length; i++) {
            var c = cajas[i];
            if (!c || !(c.w > 0) || !(c.h > 0)) continue;
            var lado = Math.max(c.w * W, c.h * H) * MARGEN_RECORTE;
            var sx = Math.max(0, (c.x + c.w / 2) * W - lado / 2), sy = Math.max(0, (c.y + c.h / 2) * H - lado / 2);
            var sw = Math.min(W - sx, lado), sh = Math.min(H - sy, lado);
            if (sw < 8 || sh < 8) continue;
            var esc = Math.min(4, LADO_RECORTE / Math.max(sw, sh));
            lienzo.width = Math.round(sw * esc);
            lienzo.height = Math.round(sh * esc);
            lienzo.getContext('2d').drawImage(img, sx, sy, sw, sh, 0, 0, lienzo.width, lienzo.height);
            var rs = await faceapi
              .detectAllFaces(lienzo, new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.3 }))
              .withFaceLandmarks()
              .withFaceDescriptors();
            // La de la caja (donde ML Kit dijo que está, en el lienzo), no una vecina que entró en el margen: con la cara
            // contra el borde de la foto el recorte no la deja en el centro (ELEGIR_CARA_JS).
            var esperada = {
              cx: ((c.x + c.w / 2) * W - sx) * esc,
              cy: ((c.y + c.h / 2) * H - sy) * esc,
              lado: Math.max(c.w * W, c.h * H) * esc,
            };
            var k = elegirCara(rs.map(function (d) { var bb = d.detection.box; return { x: bb.x, y: bb.y, w: bb.width, h: bb.height }; }), esperada);
            if (k < 0) continue;
            var mejor = rs[k];
            var b = mejor.detection.box;
            caras.push(cara(mejor, (sx + b.x / esc) / W, (sy + b.y / esc) / H, b.width / esc / W, b.height / esc / H, i));
          }
        } else {
          var r = await faceapi
            .detectAllFaces(img, new faceapi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.5 }))
            .withFaceLandmarks()
            .withFaceDescriptors();
          caras = r.map(function (d) {
            var b = d.detection.box;
            return cara(d, b.x / W, b.y / H, b.width / W, b.height / H);
          });
        }
        img.src = '';
        lienzo.width = lienzo.height = 1;
        enviar({ tipo: 'caras', id: m.id, caras: caras, ms: Date.now() - t0 });
      } catch (e) {
        enviar({ tipo: 'error', id: m.id, motivo: String((e && e.message) || e).slice(0, 160) });
      }
    });
  };
  async function calentar() {
    var t = Date.now();
    try {
      var c = document.createElement('canvas');
      c.width = c.height = LADO_RECORTE;
      var g = c.getContext('2d');
      g.fillStyle = '#808080';
      g.fillRect(0, 0, LADO_RECORTE, LADO_RECORTE);
      await faceapi.detectAllFaces(c, new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.3 }));
      var cara150 = document.createElement('canvas');
      cara150.width = cara150.height = 150;
      cara150.getContext('2d').drawImage(c, 0, 0, 150, 150);
      await faceapi.detectFaceLandmarks(cara150);
      await faceapi.computeFaceDescriptor(cara150);
    } catch (e) {
      /* calentar es solo para ganar tiempo: si falla, el primer análisis compila como antes */
    }
    return Date.now() - t;
  }
  cargar().then(calentar).then(function (ms) { enviar({ tipo: 'lista', motor: faceapi.tf.getBackend(), calentarMs: ms }); }, function (e) { enviar({ tipo: 'fallo', motivo: String((e && e.message) || e).slice(0, 160) }); });
})();
</script></body></html>`;
