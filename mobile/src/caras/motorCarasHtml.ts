/**
 * La página del motor de caras (la carga MotorCaras.tsx en una WebView escondida; la prueba
 * pruebas/caras/navegador.mjs la carga en Chromium, el mismo motor que la WebView de Android).
 *
 * face-api (@vladmandic/face-api, MIT) con TensorFlow.js dentro, fijado a una versión y con su huella
 * SRI: si el archivo del CDN cambiara un solo byte, el navegador no lo ejecuta. Los modelos (~7 MB:
 * detector chico, 68 puntos y la red de 128 números) salen de la misma versión fijada del paquete.
 *
 * Entrada:  window.__caras({ tipo: 'analizar', id, imagen: <jpeg en base64> })
 * Salida:   { tipo: 'lista' } · { tipo: 'caras', id, caras: [{ caja:{x,y,w,h} (0..1), vector:[128], puntaje }], ms }
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
        var r = await faceapi
          .detectAllFaces(img, new faceapi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.5 }))
          .withFaceLandmarks()
          .withFaceDescriptors();
        img.src = '';
        var caras = r.map(function (d) {
          var b = d.detection.box;
          return {
            caja: { x: b.x / W, y: b.y / H, w: b.width / W, h: b.height / H },
            vector: Array.prototype.map.call(d.descriptor, function (v) { return Math.round(v * 1e4) / 1e4; }),
            puntaje: Math.round(d.detection.score * 100) / 100,
          };
        });
        enviar({ tipo: 'caras', id: m.id, caras: caras, ms: Date.now() - t0 });
      } catch (e) {
        enviar({ tipo: 'error', id: m.id, motivo: String((e && e.message) || e).slice(0, 160) });
      }
    });
  };
  cargar().then(function () { enviar({ tipo: 'lista', motor: faceapi.tf.getBackend() }); }, function (e) { enviar({ tipo: 'fallo', motivo: String((e && e.message) || e).slice(0, 160) }); });
})();
</script></body></html>`;
