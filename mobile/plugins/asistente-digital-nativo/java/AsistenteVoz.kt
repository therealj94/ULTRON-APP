package __PAQUETE__.asistente

import android.content.Context
import android.os.Build
import android.os.Bundle
import android.service.voice.VoiceInteractionService
import android.service.voice.VoiceInteractionSession
import android.service.voice.VoiceInteractionSessionService
import android.util.Log

/**
 * AU-RA COMO ASISTENTE DIGITAL DEL TELÉFONO (el rol ASSISTANT de Android).
 *
 * En el Samsung de José (One UI 7+): Ajustes → Funciones avanzadas → Botón lateral → Mantener pulsado → Asistente
 * digital → AU-RA. Para que AU-RA salga en esa lista tiene que poder ser el asistente del sistema: un
 * VoiceInteractionService con su descripción (res/xml/aura_interaccion_voz.xml: la sesión, el reconocedor y
 * supportsAssist) o, como segunda vía, una actividad con ASSIST (BurbujaActivity la declara también).
 *
 * Lo que hace cada pieza, y nada más:
 *  · ServicioAura: existe mientras AU-RA sea el asistente elegido. No escucha nada por su cuenta (sin palabra clave ni
 *    micrófono en segundo plano) y le dice al sistema que NO le pase la pantalla de delante ni una captura: AURA no lee
 *    lo que la persona tiene abierto (privacidad) y así la invocación no espera a que el sistema la junte.
 *  · SesionAura: el sistema la muestra al mantener el botón. En onShow abre la burbuja (BurbujaActivity) y se esconde
 *    en el acto: aquí no se carga React, ni audio, ni nada lento. Todo lo demás pasa en la burbuja.
 *
 * Con el teléfono bloqueado: `supportsLaunchVoiceAssistFromKeyguard="false"` y la burbuja sin showWhenLocked: Android
 * pide desbloquear primero (decisión de privacidad del plan).
 */
class ServicioAura : VoiceInteractionService() {
  override fun onReady() {
    super.onReady()
    try {
      setDisabledShowContext(VoiceInteractionSession.SHOW_WITH_ASSIST or VoiceInteractionSession.SHOW_WITH_SCREENSHOT)
    } catch (e: Exception) {
      Log.w(TAG, "no se pudo apagar el contexto de pantalla", e)
    }
  }
}

class SesionAuraServicio : VoiceInteractionSessionService() {
  override fun onNewSession(args: Bundle?): VoiceInteractionSession = SesionAura(this)
}

class SesionAura(context: Context) : VoiceInteractionSession(context) {
  override fun onShow(args: Bundle?, showFlags: Int) {
    super.onShow(args, showFlags)
    val intento = Invocacion.burbuja(context, Invocacion.ASISTENTE)
    /*
     * Desde Android 10, la vía del sistema para la interfaz de un asistente: la burbuja sale ENCIMA de la app de delante
     * (en la capa del asistente), que es lo que José pidió. Si el sistema la rechaza, como actividad normal: mientras la
     * sesión se muestra, la app tiene una ventana visible y Android deja abrirla desde aquí.
     */
    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) startAssistantActivity(intento) else context.startActivity(intento)
    } catch (e: Exception) {
      Log.w(TAG, "startAssistantActivity falló; se abre como actividad normal", e)
      try {
        context.startActivity(intento)
      } catch (e2: Exception) {
        Log.e(TAG, "no se pudo abrir la burbuja", e2)
      }
    }
    hide()
  }
}

private const val TAG = "AuraAsistente"
