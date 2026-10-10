package __PAQUETE__.asistente

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.speech.RecognitionListener
import android.speech.RecognitionService
import android.speech.RecognitionSupport
import android.speech.RecognitionSupportCallback
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.util.Log
import androidx.annotation.RequiresApi

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
 *
 * Revisión de fases: el orden. Un pedido normal va primero al reconocedor de la app de Google
 * (com.google.android.googlequicksearchbox: el de siempre, con la red y todos los idiomas); el del dispositivo
 * (com.google.android.as, Private Compute Services) va primero solo si el pedido prefiere sin red
 * (EXTRA_PREFER_OFFLINE). Si el elegido no se deja crear, se prueba el siguiente. Y en Android 13+ la consulta
 * «¿soportas este idioma?» (onCheckRecognitionSupport) también se le pasa al de verdad: antes contestaba la clase base
 * (sin soporte) y una app que pregunta antes de dictar creía que el teléfono no reconoce nada.
 */
class ReconocedorAura : RecognitionService() {
  private var delegado: SpeechRecognizer? = null

  override fun onStartListening(intent: Intent, callback: Callback) {
    soltar()
    val r = crearDelegado(this, intent)
    if (r == null) {
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

  /** Android 13+: «¿reconoces esto?» lo contesta el reconocedor de verdad (el mismo que dictaría). */
  @RequiresApi(Build.VERSION_CODES.TIRAMISU)
  override fun onCheckRecognitionSupport(recognizerIntent: Intent, supportCallback: SupportCallback) {
    val r = crearDelegado(this, recognizerIntent)
    if (r == null) {
      avisar { supportCallback.onError(SpeechRecognizer.ERROR_RECOGNIZER_BUSY) }
      return
    }
    try {
      r.checkRecognitionSupport(
        recognizerIntent,
        mainExecutor,
        object : RecognitionSupportCallback {
          override fun onSupportResult(recognitionSupport: RecognitionSupport) {
            avisar { supportCallback.onSupportResult(recognitionSupport) }
            destruir(r)
          }

          override fun onError(error: Int) {
            avisar { supportCallback.onError(error) }
            destruir(r)
          }
        }
      )
    } catch (e: Exception) {
      Log.w(TAG, "el reconocedor no contestó la consulta de soporte", e)
      destruir(r)
      avisar { supportCallback.onError(SpeechRecognizer.ERROR_CLIENT) }
    }
  }

  override fun onDestroy() {
    soltar()
    super.onDestroy()
  }

  private fun soltar() {
    delegado?.let { destruir(it) }
    delegado = null
  }

  private fun destruir(r: SpeechRecognizer) {
    try {
      r.destroy()
    } catch (_: Exception) {
    }
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

    private const val GOOGLE = "com.google.android.googlequicksearchbox"
    private const val EN_EL_TELEFONO = "com.google.android.as"

    /**
     * Los reconocedores de verdad, en orden de preferencia (los mismos que la app ya consulta en <queries>): para un
     * pedido normal, el de la app de Google y después el del dispositivo; para uno que prefiere sin red, al revés.
     */
    fun preferidos(sinRed: Boolean): List<String> = if (sinRed) listOf(EN_EL_TELEFONO, GOOGLE, "com.google.android.tts") else listOf(GOOGLE, EN_EL_TELEFONO, "com.google.android.tts")

    /** Los candidatos, en orden: los preferidos que haya y después los demás (nunca este mismo). */
    fun candidatos(context: Context, intent: Intent?): List<ComponentName> =
      try {
        val propios = context.packageName
        val servicios =
          context.packageManager
            .queryIntentServices(Intent(RecognitionService.SERVICE_INTERFACE), 0)
            .mapNotNull { it.serviceInfo }
            .filter { it.packageName != propios }
        val sinRed = intent?.getBooleanExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, false) == true
        val orden = preferidos(sinRed)
        servicios
          .sortedBy { s -> orden.indexOf(s.packageName).let { if (it < 0) orden.size else it } }
          .map { ComponentName(it.packageName, it.name) }
      } catch (e: Exception) {
        emptyList()
      }

    fun elegirDelegado(context: Context, intent: Intent? = null): ComponentName? = candidatos(context, intent).firstOrNull()

    /** El primero que se deja crear (si el preferido falla, el siguiente). null si ninguno. */
    fun crearDelegado(context: Context, intent: Intent?): SpeechRecognizer? {
      for (destino in candidatos(context, intent)) {
        try {
          return SpeechRecognizer.createSpeechRecognizer(context, destino)
        } catch (e: Exception) {
          Log.w(TAG, "no se pudo crear el reconocedor de ${destino.packageName}; pruebo el siguiente", e)
        }
      }
      return null
    }
  }
}
