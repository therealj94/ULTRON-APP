package __PAQUETE__.asistente

import android.app.ActivityManager
import android.content.Context
import android.content.Intent
import android.os.Bundle
import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate
import expo.modules.ReactActivityDelegateWrapper
import __PAQUETE__.BuildConfig

/**
 * LA BURBUJA DE AURA: la ventana translúcida que sale ENCIMA de lo que haya en pantalla al mantener el botón lateral
 * (José, 10-oct, con ChatGPT como asistente en su S26: la pantalla de atrás se queda, oscurecida, con el orbe abajo).
 *
 * Es la misma app de React (el mismo componente `main`, el mismo motor de JS que MainActivity: la cuenta, la sesión y el
 * hilo son los mismos) con otras props de arranque: `{ modo: 'burbuja', origen, invocadaEn }`. App.tsx lee `modo` y
 * dibuja src/burbuja/Burbuja.tsx sobre fondo transparente; todo lo que se ve se ajusta por OTA.
 *
 *  · Tema Theme.AuraBurbuja (res/values/aura_asistente.xml): translúcida, sin título, con el atenuado del sistema
 *    (se oscurece al instante, antes de que React dibuje nada).
 *  · Su propia tarea (taskAffinity aparte, singleTask, fuera de Recientes): no arrastra a MainActivity al frente ni
 *    aparece como otra app en Recientes.
 *  · Sin showWhenLocked: con el teléfono bloqueado Android pide desbloquear antes (decisión de privacidad, plan Fase 1).
 *  · «Atrás» o tocar fuera (JS → BackHandler.exitApp → invokeDefaultOnBackPressed) la TERMINA a ella, nunca a la app:
 *    React entrega ese «atrás» a la actividad que está delante, y la que está delante es esta.
 *  · Si deja de verse (la persona se fue a otra app, abrió AURA entera con «Abrir en AURA», apagó la pantalla) también
 *    termina: una burbuja no se queda viva detrás con el micrófono. JS suelta el micrófono al desmontarse.
 *
 * Y al terminar NO apaga el motor de React si MainActivity sigue viva detrás: `onHostDestroy` avisa a todos los módulos
 * (expo-av suelta TODOS sus reproductores, también los de la mesa) y deja al motor sin actividad. Con la app abierta
 * detrás solo se desmonta la superficie de la burbuja; el motor sigue con la de la mesa.
 */
class BurbujaActivity : ReactActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    // ASSIST, VOICE_COMMAND o un atajo sin hora: a la forma de siempre (VIEW + enlace + momento) antes de que React lo lea.
    intent = Invocacion.normalizar(this, intent)
    // null igual que MainActivity: tras una muerte del proceso no se restaura una burbuja vieja.
    super.onCreate(null)
  }

  override fun onNewIntent(intent: Intent) {
    // La llamaron otra vez con la burbuja abierta (otra pulsación del botón, el mosaico): JS lo recibe como enlace
    // (Linking «url») y decide si es una doble pulsación o una invocación nueva (src/entrada/enlace.ts).
    val normal = Invocacion.normalizar(this, intent)
    setIntent(normal)
    super.onNewIntent(normal)
  }

  override fun getMainComponentName(): String = "main"

  override fun createReactActivityDelegate(): ReactActivityDelegate {
    val actividad = this
    return ReactActivityDelegateWrapper(
      this,
      BuildConfig.IS_NEW_ARCHITECTURE_ENABLED,
      object : DefaultReactActivityDelegate(this, mainComponentName, fabricEnabled) {
        override fun getLaunchOptions(): Bundle =
          Bundle().apply {
            putString("modo", "burbuja")
            putString("origen", Invocacion.origen(actividad.intent))
            putDouble("invocadaEn", Invocacion.momento(actividad.intent).toDouble())
          }

        override fun onDestroy() {
          if (actividad.laAppSigueAbierta()) reactDelegate?.unloadApp() else super.onDestroy()
        }
      }
    )
  }

  /** «Atrás» (o `BackHandler.exitApp()` desde la burbuja): se cierra ella; nunca se manda la tarea atrás. */
  override fun invokeDefaultOnBackPressed() {
    finish()
  }

  override fun onStop() {
    super.onStop()
    if (!isChangingConfigurations && !isFinishing) finish()
  }

  override fun finish() {
    super.finish()
    // Sin animación de salida larga: se esfuma como un diálogo.
    @Suppress("DEPRECATION")
    overridePendingTransition(0, android.R.anim.fade_out)
  }

  /** ¿MainActivity está viva en su tarea? (la mesa sigue montada detrás y usa el mismo motor de React). */
  internal fun laAppSigueAbierta(): Boolean =
    try {
      val am = getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
      am.appTasks.any { tarea ->
        val info = tarea.taskInfo
        info.numActivities > 0 && info.baseActivity?.className?.endsWith(".MainActivity") == true
      }
    } catch (e: Exception) {
      false
    }
}
