package __PAQUETE__.asistente

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ResolveInfo
import android.net.Uri
import android.os.Build
import android.provider.AlarmClock
import android.provider.CalendarContract
import android.util.Log
import com.facebook.react.BaseReactPackage
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.BaseActivityEventListener
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableMap
import com.facebook.react.module.model.ReactModuleInfo
import com.facebook.react.module.model.ReactModuleInfoProvider
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.io.File

/**
 * LAS MANOS DE AU-RA EN EL TELÉFONO (José, 10-oct, APK 5.7.1: «le pedí abrir una app, Spotify, en mi celular y no pudo»).
 *
 * Un módulo nativo de React Native (`AuraTelefono`), SOLO en la APK de AU-RA: lo copia plugins/asistente-digital.js con el
 * resto del asistente y lo registra en MainApplication (getPackages). Dr Electrum no lo tiene. JS lo usa por
 * src/telefono/nativo.ts; sin él (una APK anterior), JS contesta «actualiza a la 5.7.1».
 *
 * Todo con intents estándar del sistema, sin permisos peligrosos (ni QUERY_ALL_PACKAGES, ni CALL_PHONE, ni SEND_SMS):
 *  · listarApps: las apps que se pueden abrir (MAIN + LAUNCHER, visibles por el `<queries>` del manifiesto) con su nombre;
 *  · abrirApp(paquete): su intent de arranque, en tarea nueva;
 *  · abrirEnlace(uri): ACTION_VIEW, solo con los esquemas permitidos y si alguna app lo resuelve;
 *  · alarma / temporizador: AlarmClock.ACTION_SET_ALARM / ACTION_SET_TIMER con EXTRA_SKIP_UI (permiso normal SET_ALARM);
 *  · navegar(destino): google.navigation:q=…, si no Waze, si no geo:;
 *  · marcar(numero): ACTION_DIAL (el marcador con el número; la llamada la hace ella);
 *  · borradorSms(numero, texto): ACTION_SENDTO smsto: (un borrador: ella le da enviar);
 *  · eventoCalendario: CalendarContract ACTION_INSERT (la pantalla para que ELLA confirme: nunca «agendado»);
 *  · compartido: lo que otra app le compartió a AU-RA (ACTION_SEND texto, enlace o imagen), una vez.
 *
 * Cada mano contesta un RECIBO `{ ok, via, motivo? }`: `ok` solo si el sistema resolvió el intent y lo arrancó. JS lo
 * manda al servidor (POST /api/app/recibo): sin ese recibo nadie dice «abrí» ni «puse la alarma».
 *
 * Desde la burbuja (BurbujaActivity) la app se abre en su propia tarea: la burbuja deja de verse y se termina sola (onStop).
 */
class TelefonoAura(private val ctx: ReactApplicationContext) : ReactContextBaseJavaModule(ctx) {
  override fun getName(): String = NOMBRE

  /** Lo compartido que todavía no tomó JS (el intent de arranque o uno nuevo). */
  @Volatile private var compartido: WritableMap? = null
  @Volatile private var inicialVisto = false

  init {
    ctx.addActivityEventListener(
      object : BaseActivityEventListener() {
        override fun onNewIntent(intent: Intent) {
          val c = leerCompartido(intent) ?: return
          compartido = c
          try {
            ctx.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java).emit(EVENTO_COMPARTIDO, null)
          } catch (e: Exception) {
            Log.w(TAG, "no pude avisar de lo compartido", e)
          }
        }
      }
    )
  }

  private fun recibo(ok: Boolean, via: String, motivo: String? = null): WritableMap =
    Arguments.createMap().apply {
      putBoolean("ok", ok)
      putString("via", via)
      if (motivo != null) putString("motivo", motivo)
    }

  private fun resuelve(intent: Intent): Boolean {
    val pm = ctx.packageManager
    return if (Build.VERSION.SDK_INT >= 33) pm.resolveActivity(intent, PackageManager.ResolveInfoFlags.of(0)) != null
    else @Suppress("DEPRECATION") pm.resolveActivity(intent, 0) != null
  }

  /** Arranca el intent desde la actividad de delante (la burbuja o la mesa) o, sin ella, desde la app, en tarea nueva. */
  private fun arrancar(intent: Intent): Boolean {
    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    return try {
      val actividad: Activity? = ctx.currentActivity
      if (actividad != null) actividad.startActivity(intent) else ctx.startActivity(intent)
      true
    } catch (e: ActivityNotFoundException) {
      false
    } catch (e: SecurityException) {
      Log.w(TAG, "el sistema no dejó abrir ${intent.action}", e)
      false
    }
  }

  /** Resuelve y arranca: el recibo de una mano. */
  private fun hacer(intent: Intent, via: String): WritableMap {
    if (!resuelve(intent)) return recibo(false, via, "sin-app")
    return if (arrancar(intent)) recibo(true, via) else recibo(false, via, "no-arranco")
  }

  @ReactMethod
  fun listarApps(promesa: Promise) {
    try {
      val pm = ctx.packageManager
      val lanzables = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
      val lista: List<ResolveInfo> =
        if (Build.VERSION.SDK_INT >= 33) pm.queryIntentActivities(lanzables, PackageManager.ResolveInfoFlags.of(0))
        else @Suppress("DEPRECATION") pm.queryIntentActivities(lanzables, 0)
      val vistos = HashSet<String>()
      val salida = Arguments.createArray()
      for (ri in lista) {
        val paquete = ri.activityInfo?.packageName ?: continue
        if (!vistos.add(paquete)) continue
        salida.pushMap(
          Arguments.createMap().apply {
            putString("paquete", paquete)
            putString("nombre", ri.loadLabel(pm)?.toString() ?: paquete)
          }
        )
      }
      promesa.resolve(salida)
    } catch (e: Exception) {
      promesa.reject("E_APPS", e.message, e)
    }
  }

  @ReactMethod
  fun abrirApp(paquete: String, promesa: Promise) {
    val intent = ctx.packageManager.getLaunchIntentForPackage(paquete)
    if (intent == null) return promesa.resolve(false)
    promesa.resolve(arrancar(intent))
  }

  @ReactMethod
  fun abrirEnlace(uri: String, promesa: Promise) {
    val u = Uri.parse(uri)
    if (u.scheme?.lowercase() !in ESQUEMAS) return promesa.resolve(false)
    val intent = Intent(Intent.ACTION_VIEW, u)
    promesa.resolve(resuelve(intent) && arrancar(intent))
  }

  @ReactMethod
  fun alarma(hora: Int, minutos: Int, etiqueta: String?, promesa: Promise) {
    if (hora !in 0..23 || minutos !in 0..59) return promesa.resolve(recibo(false, "alarma", "hora-invalida"))
    val intent =
      Intent(AlarmClock.ACTION_SET_ALARM)
        .putExtra(AlarmClock.EXTRA_HOUR, hora)
        .putExtra(AlarmClock.EXTRA_MINUTES, minutos)
        .putExtra(AlarmClock.EXTRA_SKIP_UI, true)
    if (!etiqueta.isNullOrBlank()) intent.putExtra(AlarmClock.EXTRA_MESSAGE, etiqueta.take(80))
    promesa.resolve(hacer(intent, "alarma"))
  }

  @ReactMethod
  fun temporizador(segundos: Int, etiqueta: String?, promesa: Promise) {
    if (segundos !in 1..86_400) return promesa.resolve(recibo(false, "temporizador", "duracion-invalida"))
    val intent =
      Intent(AlarmClock.ACTION_SET_TIMER)
        .putExtra(AlarmClock.EXTRA_LENGTH, segundos)
        .putExtra(AlarmClock.EXTRA_SKIP_UI, true)
    if (!etiqueta.isNullOrBlank()) intent.putExtra(AlarmClock.EXTRA_MESSAGE, etiqueta.take(80))
    promesa.resolve(hacer(intent, "temporizador"))
  }

  @ReactMethod
  fun navegar(destino: String, promesa: Promise) {
    val q = Uri.encode(destino.take(200))
    val google = Intent(Intent.ACTION_VIEW, Uri.parse("google.navigation:q=$q"))
    if (resuelve(google) && arrancar(google)) return promesa.resolve(recibo(true, "google"))
    val waze = Intent(Intent.ACTION_VIEW, Uri.parse("https://waze.com/ul?q=$q&navigate=yes")).setPackage(PAQUETE_WAZE)
    if (resuelve(waze) && arrancar(waze)) return promesa.resolve(recibo(true, "waze"))
    promesa.resolve(hacer(Intent(Intent.ACTION_VIEW, Uri.parse("geo:0,0?q=$q")), "geo"))
  }

  @ReactMethod
  fun marcar(numero: String, promesa: Promise) {
    if (!RE_NUMERO.matches(numero)) return promesa.resolve(recibo(false, "marcador", "numero-invalido"))
    promesa.resolve(hacer(Intent(Intent.ACTION_DIAL, Uri.parse("tel:${Uri.encode(numero)}")), "marcador"))
  }

  @ReactMethod
  fun borradorSms(numero: String, texto: String, promesa: Promise) {
    if (!RE_NUMERO.matches(numero)) return promesa.resolve(recibo(false, "sms", "numero-invalido"))
    val intent = Intent(Intent.ACTION_SENDTO, Uri.parse("smsto:${Uri.encode(numero)}")).putExtra("sms_body", texto.take(1000))
    promesa.resolve(hacer(intent, "sms"))
  }

  @ReactMethod
  fun eventoCalendario(titulo: String, inicio: Double, fin: Double, promesa: Promise) {
    if (titulo.isBlank() || !(fin > inicio)) return promesa.resolve(recibo(false, "calendario", "datos-invalidos"))
    val intent =
      Intent(Intent.ACTION_INSERT)
        .setData(CalendarContract.Events.CONTENT_URI)
        .putExtra(CalendarContract.Events.TITLE, titulo.take(200))
        .putExtra(CalendarContract.EXTRA_EVENT_BEGIN_TIME, inicio.toLong())
        .putExtra(CalendarContract.EXTRA_EVENT_END_TIME, fin.toLong())
    promesa.resolve(hacer(intent, "calendario"))
  }

  /** Lo compartido con AU-RA (una sola vez): el intent con que se abrió la app, o el último que llegó. */
  @ReactMethod
  fun tomarCompartido(promesa: Promise) {
    if (!inicialVisto) {
      inicialVisto = true
      val actividad = ctx.currentActivity
      val inicial = actividad?.intent?.let { leerCompartido(it) }
      if (inicial != null) {
        // Que no se vuelva a tomar al recrearse la actividad.
        actividad.intent = Intent(actividad.intent).setAction(Intent.ACTION_MAIN)
        if (compartido == null) compartido = inicial
      }
    }
    val c = compartido
    compartido = null
    promesa.resolve(c)
  }

  private fun leerCompartido(intent: Intent): WritableMap? {
    if (intent.action != Intent.ACTION_SEND) return null
    val tipo = intent.type ?: return null
    val texto = intent.getStringExtra(Intent.EXTRA_TEXT)?.take(4000)
    val asunto = intent.getStringExtra(Intent.EXTRA_SUBJECT)?.take(300)
    var imagen: String? = null
    if (tipo.startsWith("image/")) {
      val uri: Uri? =
        if (Build.VERSION.SDK_INT >= 33) intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri::class.java)
        else @Suppress("DEPRECATION") intent.getParcelableExtra(Intent.EXTRA_STREAM)
      imagen = uri?.let { copiarImagen(it) }
    }
    if (texto.isNullOrBlank() && imagen == null) return null
    return Arguments.createMap().apply {
      putString("tipo", tipo)
      if (!texto.isNullOrBlank()) putString("texto", texto)
      if (!asunto.isNullOrBlank()) putString("asunto", asunto)
      if (imagen != null) putString("imagen", imagen)
    }
  }

  /** La imagen compartida, copiada a la caché de la app (el permiso de leer la de la otra app no dura): su file://. */
  private fun copiarImagen(uri: Uri): String? =
    try {
      val destino = File(ctx.cacheDir, "compartido-${System.currentTimeMillis()}.jpg")
      ctx.contentResolver.openInputStream(uri)?.use { entrada ->
        destino.outputStream().use { salida ->
          val buf = ByteArray(64 * 1024)
          var total = 0L
          while (true) {
            val n = entrada.read(buf)
            if (n < 0) break
            total += n
            if (total > MAX_IMAGEN) return null
            salida.write(buf, 0, n)
          }
        }
      } ?: return null
      Uri.fromFile(destino).toString()
    } catch (e: Exception) {
      Log.w(TAG, "no pude copiar la imagen compartida", e)
      null
    }

  companion object {
    const val NOMBRE = "AuraTelefono"
    const val EVENTO_COMPARTIDO = "auraCompartido"
    private const val TAG = "AuraTelefono"
    private const val PAQUETE_WAZE = "com.waze"
    // 8 MiB: en base64 crece un tercio (≈10,7 MiB) y el turno (/api/turno) admite 12 MiB de JSON (revisión del PR #173).
    private const val MAX_IMAGEN = 8L * 1024 * 1024
    /** Los mismos esquemas que el `<queries>` del manifiesto y lib/telefono-apps.ts ESQUEMAS_ENLACE. */
    private val ESQUEMAS = setOf("spotify", "whatsapp", "geo", "https", "tel", "mailto")
    private val RE_NUMERO = Regex("^\\+?[0-9 ()-]{3,20}$")
  }
}

/**
 * El paquete que registra los módulos (MainApplication, getPackages): las manos del teléfono y la guardia nativa de la
 * llamada del avatar (GuardiaLlamadaAura.kt). Módulos clásicos: los sirve la interop de la nueva arquitectura.
 */
class TelefonoAuraPaquete : BaseReactPackage() {
  override fun getModule(name: String, reactContext: ReactApplicationContext): NativeModule? =
    when (name) {
      TelefonoAura.NOMBRE -> TelefonoAura(reactContext)
      GuardiaLlamadaAura.NOMBRE -> GuardiaLlamadaAura(reactContext)
      else -> null
    }

  override fun getReactModuleInfoProvider(): ReactModuleInfoProvider = ReactModuleInfoProvider {
    mapOf(
      TelefonoAura.NOMBRE to ReactModuleInfo(TelefonoAura.NOMBRE, TelefonoAura::class.java.name, false, false, false, false),
      GuardiaLlamadaAura.NOMBRE to ReactModuleInfo(GuardiaLlamadaAura.NOMBRE, GuardiaLlamadaAura::class.java.name, false, false, false, false),
    )
  }
}
