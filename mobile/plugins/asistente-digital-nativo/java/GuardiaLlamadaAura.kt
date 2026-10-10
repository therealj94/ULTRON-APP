package __PAQUETE__.asistente

import android.os.Handler
import android.os.Looper
import android.util.Log
import com.facebook.react.bridge.LifecycleEventListener
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.common.LifecycleState
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.net.HttpURLConnection
import java.net.URL

/**
 * LA GUARDIA NATIVA DE LA LLAMADA DEL AVATAR (APK 5.7.1). Con la app detrás, Android congela los relojes de JS: una
 * llamada contestada que se quedó detrás solo se colgaba AL VOLVER, y los minutos de ElevenLabs seguían corriendo.
 *
 * Un módulo nativo de React Native (`AuraGuardiaLlamada`), SOLO en la APK de AU-RA: lo copia plugins/asistente-digital.js
 * con el resto del asistente y lo sirve TelefonoAuraPaquete (MainApplication, getPackages). JS lo usa por
 * src/compa/guardiaNativa.ts; la decisión (cuándo y con qué plazo) es de src/compa/fondoLlamada.ts.
 *
 *  · armar(ms, cierre): un Runnable en el Handler del hilo principal (que no se congela como los relojes de JS). Los
 *    plazos son los de fondoLlamada.ts: 3 s sonando, 30 s contestada (más la ventana de una transición propia). Sin
 *    servicio en primer plano nuevo ni WorkManager: es un reloj corto mientras el proceso sigue vivo. Si Android llega a
 *    congelar el proceso entero, también se congela el WebRTC de la llamada y el otro lado la suelta por su cuenta.
 *  · Volver delante antes del plazo lo cancela (onHostResume, además del desarmar de JS). Con la app delante no se arma.
 *  · Al vencer con la app detrás: emite `auraGuardiaLlamada` a JS (su hilo sigue vivo: cuelga en el acto y desmonta la
 *    sesión de ElevenLabs), anota el momento para `tomarDisparo` (JS lo toma al volver si no lo oyó) y, con `cierre`, hace
 *    él mismo el POST /api/voz/agente/cerrar con el pase de la sesión: el servidor lo invalida y el siguiente turno que
 *    pida ElevenLabs recibe 401 (ElevenLabs cuelga). El WebRTC de LiveKit no es de este módulo: no lo toca.
 *  · Solo https (la URL la arma JS con API_BASE); sin permisos nuevos (INTERNET ya está).
 */
class GuardiaLlamadaAura(private val ctx: ReactApplicationContext) : ReactContextBaseJavaModule(ctx), LifecycleEventListener {
  override fun getName(): String = NOMBRE

  private val principal = Handler(Looper.getMainLooper())

  /** El plazo pendiente. Solo se toca en el hilo principal. */
  private var plazo: Runnable? = null

  /** ¿La app (la mesa o la burbuja, el mismo motor) está delante? Solo se toca en el hilo principal. */
  private var delante = ctx.lifecycleState == LifecycleState.RESUMED

  /** Cuándo venció con la app detrás y JS todavía no lo tomó (0: nada). */
  @Volatile private var disparadaEn = 0L

  private class Cierre(val url: String, val cuerpo: String, val cabeceras: Map<String, String>)

  init {
    ctx.addLifecycleEventListener(this)
  }

  @ReactMethod
  fun armar(ms: Double, cierre: ReadableMap?) {
    val espera = ms.toLong().coerceIn(MIN_MS, MAX_MS)
    val c = cierre?.let { leerCierre(it) }
    principal.post {
      cancelar()
      if (delante) return@post
      val r = Runnable { disparar(c) }
      plazo = r
      principal.postDelayed(r, espera)
    }
  }

  @ReactMethod
  fun desarmar() {
    principal.post { cancelar() }
  }

  @ReactMethod
  fun tomarDisparo(promesa: Promise) {
    val en = disparadaEn
    disparadaEn = 0L
    promesa.resolve(if (en > 0L) en.toDouble() else null)
  }

  override fun onHostResume() {
    delante = true
    cancelar()
  }

  override fun onHostPause() {
    delante = false
  }

  override fun onHostDestroy() {
    delante = false
  }

  override fun invalidate() {
    principal.post { cancelar() }
    ctx.removeLifecycleEventListener(this)
    super.invalidate()
  }

  private fun cancelar() {
    plazo?.let { principal.removeCallbacks(it) }
    plazo = null
  }

  private fun disparar(c: Cierre?) {
    plazo = null
    if (delante) return
    disparadaEn = System.currentTimeMillis()
    Log.i(TAG, "la llamada del avatar siguió detrás pasado el plazo: se cuelga")
    try {
      ctx.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java).emit(EVENTO, null)
    } catch (e: Exception) {
      Log.w(TAG, "no pude avisar a JS de la guardia", e)
    }
    if (c != null) Thread({ avisarCierre(c) }, "aura-guardia-cierre").start()
  }

  private fun leerCierre(m: ReadableMap): Cierre? {
    val url = if (m.hasKey("url")) m.getString("url") else null
    val cuerpo = if (m.hasKey("cuerpo")) m.getString("cuerpo") else null
    if (url == null || cuerpo == null || !url.startsWith("https://")) return null
    val cabeceras = HashMap<String, String>()
    val h = if (m.hasKey("cabeceras")) m.getMap("cabeceras") else null
    if (h != null) {
      for ((k, v) in h.toHashMap()) if (v is String) cabeceras[k] = v
    }
    return Cierre(url, cuerpo, cabeceras)
  }

  /** POST /api/voz/agente/cerrar, fuera del hilo principal. Si falla, el pase vence solo en el servidor. */
  private fun avisarCierre(c: Cierre) {
    var con: HttpURLConnection? = null
    try {
      con = URL(c.url).openConnection() as HttpURLConnection
      con.requestMethod = "POST"
      con.connectTimeout = TIEMPO_RED_MS
      con.readTimeout = TIEMPO_RED_MS
      con.doOutput = true
      for ((k, v) in c.cabeceras) con.setRequestProperty(k, v)
      con.outputStream.use { it.write(c.cuerpo.toByteArray(Charsets.UTF_8)) }
      Log.i(TAG, "cierre de la conversación avisado al servidor: ${con.responseCode}")
    } catch (e: Exception) {
      Log.w(TAG, "no pude avisar el cierre al servidor", e)
    } finally {
      con?.disconnect()
    }
  }

  companion object {
    const val NOMBRE = "AuraGuardiaLlamada"
    /** El mismo nombre que src/compa/guardiaNativa.ts EVENTO_GUARDIA_LLAMADA. */
    const val EVENTO = "auraGuardiaLlamada"
    private const val TAG = "AuraGuardiaLlamada"
    private const val MIN_MS = 50L
    private const val MAX_MS = 10L * 60_000
    private const val TIEMPO_RED_MS = 8_000
  }
}
