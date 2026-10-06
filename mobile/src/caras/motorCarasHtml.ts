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
 * Salida:   { tipo: 'lista' } · { tipo: 'caras', id, caras: [{ caja:{x,y,w,h} (0..1), vector:[128], puntaje, indice? }], ms }
 *           · { tipo: 'error', id, motivo } · { tipo: 'fallo', motivo } (no cargó: sin WebGL, sin red)
 * La imagen no se guarda: se decodifica, se analiza y se suelta.
 */
export const FACE_API_VERSION = '1.7.15';
export const FACE_API_URL = `https://cdn.jsdelivr.net/npm/@vladmandic/face-api@${FACE_API_VERSION}/dist/face-api.js`;
export const FACE_API_SRI = 'sha384-M5nePoB6/w/a9JhtegEibSLGiJy/+QMZZMfvcxjWVCQW/HPwrQ7i21V/Px/8AyVA';
export const MODELOS_URL = `https://cdn.jsdelivr.net/npm/@vladmandic/face-api@${FACE_API_VERSION}/model/`;

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
            // La del centro del recorte (la de la caja), no una vecina que entró en el margen.
            var mejor = null, dmin = Infinity;
            rs.forEach(function (d) {
              var b = d.detection.box;
              var dd = Math.hypot(b.x + b.width / 2 - lienzo.width / 2, b.y + b.height / 2 - lienzo.height / 2);
              if (dd < dmin) { dmin = dd; mejor = d; }
            });
            if (!mejor || dmin > lienzo.width * 0.3) continue;
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
  cargar().then(function () { enviar({ tipo: 'lista', motor: faceapi.tf.getBackend() }); }, function (e) { enviar({ tipo: 'fallo', motivo: String((e && e.message) || e).slice(0, 160) }); });
})();
</script></body></html>`;
