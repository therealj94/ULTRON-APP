package __PAQUETE__.asistente

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.speech.RecognitionListener
import android.speech.RecognitionService
import android.speech.SpeechRecognizer
import android.util.Log

/**
 * EL RECONOCEDOR QUE EXIGE SER ASISTENTE, SIN ROMPERLE EL DICTADO AL TELÉFONO.
 *
 * Android no acepta un VoiceInteractionService sin `android:recognitionService` en su XML. Y hay una consecuencia que
 * no se ve en el código: al elegir AU-RA como asistente digital, Android pone ESTE servicio como el reconocimiento de
 * voz por omisión del teléfono (Settings.Secure.voice_recognition_service). Un trozo vacío que contestara siempre
 * «ocupado» dejaría sin dictado a toda app que use el reconocedor del sistema —incluido el oído «teléfono» de la propia
 * AU-RA (src/lib/speechNative.ts crea `SpeechRecognizer.createSpeechRecognizer(context)` sin componente).
 *
 * Por eso no inventa nada: le pasa el pedido, tal cual, al reconocedor de verdad que haya en el teléfono (el de Google
 * primero; si no, el primero que no sea este) y le devuelve a quien llamó lo que ese conteste. Si no hay ninguno,
 * contesta ERROR_RECOGNIZER_BUSY, que es lo que haría un teléfono sin reconocedor. El permiso del micrófono de quien
 * llama lo revisa Android antes de llegar aquí (RecognitionService lo exige).
 */
class ReconocedorAura : RecognitionService() {
  private var delegado: SpeechRecognizer? = null

  override fun onStartListening(intent: Intent, callback: Callback) {
    val destino = elegirDelegado(this)
    if (destino == null) {
      avisar { callback.error(SpeechRecognizer.ERROR_RECOGNIZER_BUSY) }
      return
    }
    soltar()
    val r =
      try {
        SpeechRecognizer.createSpeechRecognizer(this, destino)
      } catch (e: Exception) {
        Log.w(TAG, "no se pudo crear el reconocedor de ${destino.packageName}", e)
        avisar { callback.error(SpeechRecognizer.ERROR_RECOGNIZER_BUSY) }
        return
      }
    delegado = r
    r.setRecognitionListener(
      object : RecognitionListener {
        override fun onReadyForSpeech(params: Bundle?) = avisar { callback.readyForSpeech(params ?: Bundle()) }
        override fun onBeginningOfSpeech() = avisar { callback.beginningOfSpeech() }
        override fun onRmsChanged(rmsdB: Float) = avisar { callback.rmsChanged(rmsdB) }
        override fun onBufferReceived(buffer: ByteArray?) = avisar { if (buffer != null) callback.bufferReceived(buffer) }
        override fun onEndOfSpeech() = avisar { callback.endOfSpeech() }
        override fun onError(error: Int) = avisar { callback.error(error) }
        override fun onResults(results: Bundle?) = avisar { callback.results(results ?: Bundle()) }
        override fun onPartialResults(partialResults: Bundle?) = avisar { callback.partialResults(partialResults ?: Bundle()) }
        override fun onEvent(eventType: Int, params: Bundle?) {}
      }
    )
    r.startListening(intent)
  }

  override fun onStopListening(callback: Callback) {
    delegado?.stopListening()
  }

  override fun onCancel(callback: Callback) {
    delegado?.cancel()
  }

  override fun onDestroy() {
    soltar()
    super.onDestroy()
  }

  private fun soltar() {
    try {
      delegado?.destroy()
    } catch (_: Exception) {
    }
    delegado = null
  }

  /** Quien llamó pudo irse (RemoteException): no tumba el servicio. */
  private fun avisar(f: () -> Unit) {
    try {
      f()
    } catch (e: Exception) {
      Log.w(TAG, "quien pidió el reconocimiento ya no está", e)
    }
  }

  companion object {
    private const val TAG = "AuraReconocedor"

    /** Los reconocedores de verdad, en orden de preferencia (los mismos que la app ya consulta en <queries>). */
    private val PREFERIDOS = listOf("com.google.android.as", "com.google.android.googlequicksearchbox", "com.google.android.tts")

    fun elegirDelegado(context: Context): ComponentName? =
      try {
        val propios = context.packageName
        val servicios =
          context.packageManager
            .queryIntentServices(Intent(RecognitionService.SERVICE_INTERFACE), 0)
            .mapNotNull { it.serviceInfo }
            .filter { it.packageName != propios }
        val elegido = PREFERIDOS.firstNotNullOfOrNull { p -> servicios.firstOrNull { it.packageName == p } } ?: servicios.firstOrNull()
        elegido?.let { ComponentName(it.packageName, it.name) }
      } catch (e: Exception) {
        null
      }
  }
}
