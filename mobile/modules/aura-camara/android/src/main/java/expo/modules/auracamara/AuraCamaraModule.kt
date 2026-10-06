package expo.modules.auracamara

import android.app.ActivityManager
import android.content.Context
import android.os.Build
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File

/**
 * Módulo `AuraCamara` (Android): la vista `AuraCamaraView` (CameraX + ML Kit en flujo con seguimiento) y
 * lo que JS le pide a la vista montada:
 *  · `recorte(id, margen?, lado?, archivo?)` → { b64 | uri, caja, w, h, ts, tam } de la cara `id` del último
 *    cuadro (-1 = la más grande), o null. Por omisión en base64 (unos 15 KB): la WebView del motor de caras
 *    no puede leer archivos locales sin abrirle el acceso a file:// (ver src/lib/auraCamara.ts).
 *  · `foto(calidad?, alta?, archivo?)` → { b64 | uri, w, h, origen } la foto entera (con la cámara de fotos
 *    si `alta`), o null. Reemplaza a takePictureAsync de expo-camera para «qué ves» y el servidor.
 *  · `disponible()` / `version()`: para que JS sepa que este binario lo trae (una APK anterior que reciba
 *    este JS por OTA no lo tiene y se queda con la cámara de fotos).
 */
class AuraCamaraModule : Module() {
  private val cache: File
    get() = appContext.cacheDirectory

  /** ApplicationExitInfo.REASON_* en palabras (los números por si el SDK de compilación no trae alguno). */
  private fun motivoDeSalida(r: Int): String =
    when (r) {
      1 -> "salio-sola"
      2 -> "senal"
      3 -> "memoria"
      4 -> "crash"
      5 -> "crash-nativo"
      6 -> "anr"
      7 -> "fallo-al-iniciar"
      8 -> "permiso-cambiado"
      9 -> "exceso-de-recursos"
      10 -> "la-persona"
      11 -> "detenida-por-la-persona"
      12 -> "dependencia"
      13 -> "otro"
      14 -> "congelada"
      15, 16 -> "actualizada"
      else -> "desconocido-$r"
    }

  override fun definition() = ModuleDefinition {
    Name("AuraCamara")

    Function("disponible") { true }
    // 2: `salidas()` y el vigía del hilo principal (evento onEstado «lento»).
    Function("version") { 2 }

    AsyncFunction("recorte") { id: Int, margen: Double?, lado: Int?, archivo: Boolean? ->
      val v = AuraCamaraView.actual?.get() ?: return@AsyncFunction null
      try {
        v.recorte(id, margen ?: 0.6, lado ?: 288, 90, archivo == true, cache)
      } catch (_: Throwable) {
        null
      }
    }

    AsyncFunction("foto") { calidad: Double?, alta: Boolean?, archivo: Boolean?, promesa: Promise ->
      val v = AuraCamaraView.actual?.get()
      if (v == null) {
        promesa.resolve(null)
        return@AsyncFunction
      }
      val q = ((calidad ?: 0.7) * 100).toInt().coerceIn(30, 100)
      // La cámara de fotos de CameraX se dispara desde el hilo principal.
      val ok = v.post {
        try {
          v.foto(q, alta != false, archivo == true, cache, promesa)
        } catch (_: Throwable) {
          promesa.resolve(null)
        }
      }
      if (!ok) promesa.resolve(null)
    }

    /**
     * Cómo terminaron las últimas veces que Android cerró la app (Android 11+, ApplicationExitInfo): «anr» (no respondía
     * y se cerró, p. ej. al tocar la pantalla), «crash», «crash-nativo», «memoria»… Sin esto, una app trabada que
     * Android mata no deja rastro: no es un crash de JS y la marca de «viva» no distingue (José, 6-oct: «hasta tocar la
     * pantalla se cierra»). Lo lee src/lib/reporte.ts al arrancar. Una lista vacía si el sistema no lo da.
     */
    Function("salidas") { max: Int? ->
      try {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) return@Function emptyList<Map<String, Any>>()
        val ctx = appContext.reactContext ?: return@Function emptyList<Map<String, Any>>()
        val am = ctx.getSystemService(Context.ACTIVITY_SERVICE) as? ActivityManager ?: return@Function emptyList<Map<String, Any>>()
        am.getHistoricalProcessExitReasons(ctx.packageName, 0, (max ?: 5).coerceIn(1, 16)).map { i ->
          mapOf(
            "motivo" to motivoDeSalida(i.reason),
            "codigo" to i.reason,
            "ts" to i.timestamp.toDouble(),
            "descripcion" to (i.description ?: "").take(160),
            "importancia" to i.importance,
            "rssKb" to i.rss.toDouble()
          )
        }
      } catch (_: Throwable) {
        emptyList<Map<String, Any>>()
      }
    }

    /** Borra los archivos que dejó `archivo: true` (al salir de la mesa). */
    Function("limpiar") {
      try {
        File(cache, "aura-camara").listFiles()?.forEach { it.delete() }
      } catch (_: Throwable) {
      }
      true
    }

    View(AuraCamaraView::class) {
      Events("onCaras", "onEstado")

      Prop("lado") { view: AuraCamaraView, v: String? -> view.ponerLado(v) }
      Prop("activa") { view: AuraCamaraView, v: Boolean? -> view.ponerActiva(v) }
      Prop("hz") { view: AuraCamaraView, v: Double? -> view.ponerHz(v) }
      Prop("fps") { view: AuraCamaraView, v: Double? -> view.ponerFps(v) }
      Prop("ladoCorto") { view: AuraCamaraView, v: Int? -> view.ponerLadoCorto(v) }
      Prop("minCara") { view: AuraCamaraView, v: Double? -> view.ponerMinCara(v) }

      OnViewDidUpdateProps { view -> view.aplicar() }
      OnViewDestroys { view -> view.liberar() }
    }
  }
}
