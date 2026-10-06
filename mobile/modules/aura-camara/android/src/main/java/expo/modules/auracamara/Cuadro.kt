package expo.modules.auracamara

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.ImageFormat
import android.graphics.Matrix
import android.graphics.Rect
import android.graphics.YuvImage
import androidx.camera.core.ImageProxy
import java.io.ByteArrayOutputStream
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/** Una cara de un cuadro, en píxeles del cuadro DERECHO (ya girado como lo analizó ML Kit), sin espejo. */
data class CaraCuadro(val id: Int, val x: Float, val y: Float, val w: Float, val h: Float)

/**
 * El último cuadro analizado, para recortar caras (`recorte`) o sacar la foto entera (`foto` sin la
 * cámara de fotos). Doble búfer: el analizador escribe en uno y lo publica con un cambio de referencia
 * bajo el candado; quien lee comprime a JPEG con el candado tomado (unos ms) y lo suelta. Nada se guarda
 * en disco hasta que JS lo pide.
 */
class AlmacenCuadros {
  private val candado = Any()
  private var frente: ByteArray? = null
  private var detras: ByteArray? = null
  private var ancho = 0
  private var alto = 0
  private var giro = 0
  private var caras: List<CaraCuadro> = emptyList()
  private var ts = 0L
  private var epoca = 0
  private var cuadro = 0
  private var lado = "frontal"

  /**
   * Copia el YUV del cuadro (NV21) y lo publica junto con sus caras. Llamar antes de cerrar el ImageProxy.
   * `cuando`: hora de CAPTURA (pared, ms); `epoca`/`cuadro`/`lado`: su origen (lo devuelven `recorte` y `foto`).
   */
  fun guardar(img: ImageProxy, rotacion: Int, lista: List<CaraCuadro>, cuando: Long, epocaCuadro: Int, numero: Int, ladoCuadro: String) {
    val w = img.width
    val h = img.height
    val buf = aNv21(img, detras)
    synchronized(candado) {
      detras = frente
      frente = buf
      ancho = w
      alto = h
      giro = rotacion
      caras = lista
      ts = cuando
      epoca = epocaCuadro
      cuadro = numero
      lado = ladoCuadro
    }
  }

  fun vaciar() {
    synchronized(candado) {
      frente = null
      detras = null
      caras = emptyList()
    }
  }

  /** El cuadro como JPEG (orientación del sensor) + lo necesario para enderezarlo. null si no hay. */
  private fun jpegDelCuadro(calidad: Int, idBuscado: Int?): Captura? {
    synchronized(candado) {
      val datos = frente ?: return null
      if (ancho <= 0 || alto <= 0) return null
      val cara = when {
        idBuscado == null -> null
        idBuscado < 0 -> caras.maxByOrNull { it.w * it.h } ?: return null
        else -> caras.firstOrNull { it.id == idBuscado } ?: return null
      }
      val salida = ByteArrayOutputStream(ancho * alto / 4)
      val yuv = YuvImage(datos, ImageFormat.NV21, ancho, alto, null)
      if (!yuv.compressToJpeg(Rect(0, 0, ancho, alto), calidad, salida)) return null
      return Captura(salida.toByteArray(), giro, cara, ts, epoca, cuadro, lado)
    }
  }

  private class Captura(val jpeg: ByteArray, val giro: Int, val cara: CaraCuadro?, val ts: Long, val epoca: Int, val cuadro: Int, val lado: String)

  /** El cuadro entero derecho, en JPEG. */
  fun foto(calidad: Int): Resultado? {
    val c = jpegDelCuadro(95, null) ?: return null
    val derecho = derecho(c.jpeg, c.giro) ?: return null
    try {
      return Resultado(comprimir(derecho, calidad), derecho.width, derecho.height, null, c.ts, null, c.epoca, c.cuadro, c.lado)
    } finally {
      derecho.recycle()
    }
  }

  /**
   * Un recorte cuadrado alrededor de la cara `id` (-1 = la más grande) con `margen` de su tamaño a cada
   * lado, llevado a `lado` px como mucho (y como mucho 2× de agrandado). `caja`: dónde quedó la cara dentro
   * del recorte (fracciones), para que el motor de caras sepa cuál mirar. `tam`: alto de la cara / alto
   * del cuadro.
   */
  fun recorte(id: Int, margen: Float, lado: Int, calidad: Int): Resultado? {
    val c = jpegDelCuadro(95, id) ?: return null
    val cara = c.cara ?: return null
    val derecho = derecho(c.jpeg, c.giro) ?: return null
    try {
      val W = derecho.width
      val H = derecho.height
      val r = Geometria.cuadradoConMargen(cara.x, cara.y, cara.w, cara.h, margen, W, H) ?: return null
      val sx = r[0]
      val sy = r[1]
      val sw = r[2]
      val sh = r[3]
      val esc = min(2f, lado.toFloat() / max(sw, sh).toFloat())
      val ow = max(8, (sw * esc).roundToInt())
      val oh = max(8, (sh * esc).roundToInt())
      val trozo = Bitmap.createBitmap(derecho, sx, sy, sw, sh)
      val final = if (ow != sw || oh != sh) Bitmap.createScaledBitmap(trozo, ow, oh, true) else trozo
      try {
        val caja = floatArrayOf((cara.x - sx) / sw, (cara.y - sy) / sh, cara.w / sw, cara.h / sh)
        return Resultado(comprimir(final, calidad), ow, oh, caja, c.ts, cara.h / H, c.epoca, c.cuadro, c.lado)
      } finally {
        if (final !== trozo) final.recycle()
        trozo.recycle()
      }
    } finally {
      derecho.recycle()
    }
  }

  class Resultado(
    val jpeg: ByteArray,
    val w: Int,
    val h: Int,
    val caja: FloatArray?,
    val ts: Long,
    val tam: Float?,
    val epoca: Int,
    val cuadro: Int,
    val lado: String
  )

  companion object {
    fun comprimir(b: Bitmap, calidad: Int): ByteArray {
      val s = ByteArrayOutputStream(b.width * b.height / 6)
      b.compress(Bitmap.CompressFormat.JPEG, calidad.coerceIn(30, 100), s)
      return s.toByteArray()
    }

    /** JPEG del sensor → Bitmap derecho (girado `giro` grados en el sentido del reloj). */
    fun derecho(jpeg: ByteArray, giro: Int): Bitmap? {
      val b = BitmapFactory.decodeByteArray(jpeg, 0, jpeg.size) ?: return null
      if (giro % 360 == 0) return b
      val m = Matrix().apply { postRotate(giro.toFloat()) }
      val g = Bitmap.createBitmap(b, 0, 0, b.width, b.height, m, true)
      if (g !== b) b.recycle()
      return g
    }

    /** YUV_420_888 (con cualquier paso de fila y de píxel) → NV21. Reusa `destino` si tiene el tamaño justo. */
    fun aNv21(img: ImageProxy, destino: ByteArray?): ByteArray {
      val w = img.width
      val h = img.height
      val cw = w / 2
      val ch = h / 2
      val total = w * h + 2 * cw * ch
      val out = if (destino != null && destino.size == total) destino else ByteArray(total)
      val planos = img.planes
      val py = planos[0]
      val yb = py.buffer
      val yFila = py.rowStride
      val yPaso = py.pixelStride
      var pos = 0
      if (yPaso == 1) {
        for (fila in 0 until h) {
          yb.position(fila * yFila)
          yb.get(out, pos, w)
          pos += w
        }
      } else {
        for (fila in 0 until h) {
          val base = fila * yFila
          for (col in 0 until w) out[pos++] = yb.get(base + col * yPaso)
        }
      }
      val pu = planos[1]
      val pv = planos[2]
      val ub = pu.buffer
      val vb = pv.buffer
      val uFila = pu.rowStride
      val uPaso = pu.pixelStride
      val vFila = pv.rowStride
      val vPaso = pv.pixelStride
      for (fila in 0 until ch) {
        val bu = fila * uFila
        val bv = fila * vFila
        for (col in 0 until cw) {
          out[pos++] = vb.get(bv + col * vPaso)
          out[pos++] = ub.get(bu + col * uPaso)
        }
      }
      yb.rewind()
      return out
    }
  }
}

/**
 * La hora de CAPTURA de un cuadro (master §25.5, CAM-C). `ImageInfo.getTimestamp()` está en NANOSEGUNDOS del reloj
 * del sensor: con SENSOR_INFO_TIMESTAMP_SOURCE_REALTIME es elapsedRealtimeNanos; con _UNKNOWN suele ser el monótono
 * (System.nanoTime, sin el tiempo dormido). Se toma la edad en el reloj que quede más cerca y se pasa a
 * elapsedRealtime. null si ninguno da una edad creíble (de −5 ms a `maxEdadNs`): entonces vale la hora de llegada.
 */
object Reloj {
  fun capturaRealtimeNs(sensorNs: Long, realtimeNs: Long, monoNs: Long, maxEdadNs: Long = 2_000_000_000L): Long? {
    if (sensorNs <= 0L) return null
    val edadRt = realtimeNs - sensorNs
    val edadMono = monoNs - sensorNs
    val edad = if (abs(edadRt) <= abs(edadMono)) edadRt else edadMono
    if (edad < -5_000_000L || edad > maxEdadNs) return null
    return realtimeNs - max(0L, edad)
  }

  /** elapsedRealtime (ms) de una captura → hora de pared (ms), con los dos relojes leídos ahora. */
  fun aPared(capturaRealtimeMs: Long, paredAhoraMs: Long, realtimeAhoraMs: Long): Long = paredAhoraMs - max(0L, realtimeAhoraMs - capturaRealtimeMs)
}

/**
 * Las cuentas de coordenadas (el MISMO contrato que mobile/src/lib/camaraNativa.ts, probado en Node):
 *  · el cuadro DERECHO es el que analizó ML Kit (rotationDegrees aplicado), sin espejo;
 *  · la vista previa (PreviewView en FILL_CENTER) lo muestra llenando la vista y recortando lo que sobre,
 *    y con la cámara frontal ESPEJADO. `aVista` lleva una caja del cuadro (fracciones) a fracciones de la
 *    vista tal como se ve: JS la dibuja directo.
 */
object Geometria {
  /** [x, y, w, h] en fracciones de la vista, recortada a lo visible; null si queda fuera o no hay vista. */
  fun aVista(fx: Float, fy: Float, fw: Float, fh: Float, iw: Int, ih: Int, vw: Int, vh: Int, espejo: Boolean): FloatArray? {
    if (iw <= 0 || ih <= 0 || vw <= 0 || vh <= 0) return null
    val s = max(vw.toFloat() / iw, vh.toFloat() / ih)
    val W = iw * s
    val H = ih * s
    val ox = (vw - W) / 2f
    val oy = (vh - H) / 2f
    val x = if (espejo) 1f - fx - fw else fx
    val izq = max(0f, ox + x * W)
    val arr = max(0f, oy + fy * H)
    val der = min(vw.toFloat(), ox + (x + fw) * W)
    val aba = min(vh.toFloat(), oy + (fy + fh) * H)
    if (der - izq < 1f || aba - arr < 1f) return null
    return floatArrayOf(izq / vw, arr / vh, (der - izq) / vw, (aba - arr) / vh)
  }

  /** Cuadrado centrado en la caja, de lado max(w,h)·(1+2·margen), recortado a la imagen. [x, y, w, h] en px. */
  fun cuadradoConMargen(x: Float, y: Float, w: Float, h: Float, margen: Float, W: Int, H: Int): IntArray? {
    if (w <= 0f || h <= 0f || W <= 0 || H <= 0) return null
    val lado = max(w, h) * (1f + 2f * margen.coerceIn(0f, 2f))
    val cx = x + w / 2f
    val cy = y + h / 2f
    val sx = max(0, (cx - lado / 2f).roundToInt())
    val sy = max(0, (cy - lado / 2f).roundToInt())
    val sw = min(W - sx, lado.roundToInt())
    val sh = min(H - sy, lado.roundToInt())
    if (sw < 8 || sh < 8) return null
    return intArrayOf(sx, sy, sw, sh)
  }
}
