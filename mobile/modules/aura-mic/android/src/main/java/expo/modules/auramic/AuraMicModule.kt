package expo.modules.auramic

import android.Manifest
import android.content.pm.PackageManager
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import android.media.audiofx.AcousticEchoCanceler
import android.media.audiofx.NoiseSuppressor
import android.util.Base64
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlin.math.log10
import kotlin.math.max
import kotlin.math.sqrt

/**
 * El micrófono crudo para el oído Turbo de AU-RA (José, 2-oct: «opción 2… que sea tan fluido»).
 *
 * expo-av solo graba archivos comprimidos (m4a) y el tiempo real de Scribe pide PCM: este módulo lee el
 * micrófono con AudioRecord (16 kHz, mono, 16 bits) y entrega trozos de `trozoMs` en base64 con su
 * volumen en dBFS, para que el teléfono decida cuándo hay voz y se los vaya pasando a Scribe mientras
 * la persona habla. Nada se guarda en disco.
 *
 * Fuente: «reconocimiento» (VOICE_RECOGNITION, la que Android afina para dictado) o «llamada»
 * (VOICE_COMMUNICATION, con cancelación de eco del propio teléfono: para oír mientras suena la voz).
 */
class AuraMicModule : Module() {
  private var grabador: AudioRecord? = null
  private var hilo: Thread? = null
  private var eco: AcousticEchoCanceler? = null
  private var ruido: NoiseSuppressor? = null

  @Volatile private var vuelta = 0

  override fun definition() = ModuleDefinition {
    Name("AuraMic")

    Events("onTrozo", "onFallo")

    Function("disponible") { true }

    AsyncFunction("empezar") { frecuencia: Int, trozoMs: Int, fuente: String ->
      empezar(frecuencia, trozoMs, fuente)
    }

    Function("parar") { parar() }

    OnDestroy { parar() }
  }

  private fun tienePermiso(): Boolean {
    val ctx = appContext.reactContext ?: return false
    return ctx.checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED
  }

  @Synchronized
  private fun empezar(frecuencia: Int, trozoMs: Int, fuente: String): Boolean {
    parar()
    if (!tienePermiso()) {
      sendEvent("onFallo", mapOf("motivo" to "sin permiso de micrófono"))
      return false
    }
    val muestrasTrozo = max(160, frecuencia * trozoMs / 1000)
    val minimo = AudioRecord.getMinBufferSize(frecuencia, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT)
    if (minimo <= 0) {
      sendEvent("onFallo", mapOf("motivo" to "el teléfono no graba a $frecuencia Hz"))
      return false
    }
    val origen = if (fuente == "llamada") MediaRecorder.AudioSource.VOICE_COMMUNICATION else MediaRecorder.AudioSource.VOICE_RECOGNITION
    val g = try {
      AudioRecord(origen, frecuencia, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, max(minimo * 2, muestrasTrozo * 2 * 4))
    } catch (e: Exception) {
      sendEvent("onFallo", mapOf("motivo" to "no se pudo abrir el micrófono: ${e.message}"))
      return false
    }
    if (g.state != AudioRecord.STATE_INITIALIZED) {
      g.release()
      sendEvent("onFallo", mapOf("motivo" to "el micrófono está ocupado"))
      return false
    }
    if (fuente == "llamada") {
      try {
        if (AcousticEchoCanceler.isAvailable()) eco = AcousticEchoCanceler.create(g.audioSessionId)?.also { it.setEnabled(true) }
        if (NoiseSuppressor.isAvailable()) ruido = NoiseSuppressor.create(g.audioSessionId)?.also { it.setEnabled(true) }
      } catch (e: Exception) {
      }
    }
    try {
      g.startRecording()
    } catch (e: Exception) {
      g.release()
      sendEvent("onFallo", mapOf("motivo" to "no arrancó la grabación: ${e.message}"))
      return false
    }
    if (g.recordingState != AudioRecord.RECORDSTATE_RECORDING) {
      g.release()
      sendEvent("onFallo", mapOf("motivo" to "otra app tiene el micrófono"))
      return false
    }
    grabador = g
    val mia = ++vuelta
    hilo = Thread({ leer(g, muestrasTrozo, mia) }, "AuraMic").also {
      it.priority = Thread.MAX_PRIORITY
      it.start()
    }
    return true
  }

  private fun leer(g: AudioRecord, muestrasTrozo: Int, mia: Int) {
    val muestras = ShortArray(muestrasTrozo)
    val bytes = ByteArray(muestrasTrozo * 2)
    while (vuelta == mia) {
      var leidas = 0
      while (leidas < muestrasTrozo && vuelta == mia) {
        val n = try {
          g.read(muestras, leidas, muestrasTrozo - leidas)
        } catch (e: Exception) {
          -1
        }
        if (n < 0) {
          if (vuelta == mia) sendEvent("onFallo", mapOf("motivo" to "el micrófono dejó de entregar audio ($n)"))
          return
        }
        leidas += n
      }
      if (vuelta != mia || leidas == 0) return
      var suma = 0.0
      for (i in 0 until leidas) {
        val s = muestras[i].toInt()
        suma += (s * s).toDouble()
        bytes[i * 2] = (s and 0xFF).toByte()
        bytes[i * 2 + 1] = ((s shr 8) and 0xFF).toByte()
      }
      val rms = sqrt(suma / leidas)
      val db = if (rms < 1.0) -100.0 else 20.0 * log10(rms / 32768.0)
      val audio = Base64.encodeToString(bytes, 0, leidas * 2, Base64.NO_WRAP)
      sendEvent("onTrozo", mapOf("audio" to audio, "db" to db))
    }
  }

  @Synchronized
  private fun parar() {
    vuelta++
    val g = grabador
    grabador = null
    try {
      g?.stop()
    } catch (e: Exception) {
    }
    try {
      hilo?.join(300)
    } catch (e: Exception) {
    }
    hilo = null
    try {
      eco?.release()
      ruido?.release()
    } catch (e: Exception) {
    }
    eco = null
    ruido = null
    try {
      g?.release()
    } catch (e: Exception) {
    }
  }
}
