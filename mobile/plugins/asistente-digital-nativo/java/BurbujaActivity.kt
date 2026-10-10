package __PAQUETE__.asistente

import android.app.Activity
import android.app.ActivityManager
import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.util.Log
import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.bridge.ReactContext
import java.lang.ref.WeakReference
import java.util.concurrent.atomic.AtomicReference
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
 *
 * Revisión de fases (el ciclo de ReactActivityDelegate, sin descargar la app):
 *  · si el motor YA es de MainActivity (su onResume hizo onHostResume: «Abrir en AURA», o la persona volvió a la app),
 *    el onDestroy normal es lo correcto: `onHostDestroy(burbuja)` no toca al motor (no es su actividad) y solo desmonta
 *    la superficie de la burbuja;
 *  · si el motor todavía apunta a la burbuja (se cerró encima de otra app, con AURA viva detrás), se desmonta su
 *    superficie y el motor la OLVIDA (su actividad actual queda vacía, en pausa) sin el ciclo de destrucción. Antes se
 *    saltaba todo y el motor seguía apuntando a una actividad destruida (los módulos que piden la actividad actual
 *    recibían esa; y la retenía en memoria). Cuando MainActivity vuelva delante, su onHostResume la pone de nuevo.
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
          // Sin la app detrás: el ciclo normal (el motor se queda sin actividad y se apaga como siempre).
          if (!actividad.laAppSigueAbierta()) return super.onDestroy()
          val host = reactHost
          val contexto = host?.currentReactContext
          // El motor ya es de MainActivity (o todavía no hay contexto): el ciclo normal no toca el motor.
          if (contexto == null || contexto.currentActivity !== actividad) return super.onDestroy()
          // Todavía apunta a la burbuja: solo su superficie, y que el motor la olvide (sin avisar a los módulos).
          reactDelegate?.unloadApp()
          if (!MotorReact.olvidarActividad(host, contexto, actividad)) Log.w(TAG, "el motor de React no soltó la burbuja (la retoma MainActivity al volver)")
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

  private companion object {
    const val TAG = "AuraBurbuja"
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

/**
 * Que el motor de React (ReactHost y su ReactContext) deje de apuntar a una actividad que se destruyó, SIN el ciclo de
 * destrucción (`onHostDestroy` avisaría a todos los módulos y apagaría lo de la mesa). React Native no tiene una forma
 * pública de vaciar la actividad actual sin ese ciclo: se vacían sus dos referencias (la del host y la del contexto),
 * solo si siguen siendo ESA actividad. Si una versión nueva de React Native las cambia de nombre, no se toca nada
 * (false) y queda como antes: MainActivity la reemplaza en su próximo onHostResume.
 */
internal object MotorReact {
  fun olvidarActividad(host: Any?, contexto: ReactContext?, actividad: Activity): Boolean {
    val enHost = host == null || vaciar(host, "activity", actividad)
    val enContexto = contexto == null || vaciar(contexto, "mCurrentActivity", actividad)
    return enHost && enContexto
  }

  private fun vaciar(dueno: Any, campo: String, actividad: Activity): Boolean {
    var clase: Class<*>? = dueno.javaClass
    while (clase != null) {
      try {
        val f = clase.getDeclaredField(campo)
        f.isAccessible = true
        when (val v = f.get(dueno)) {
          is AtomicReference<*> -> {
            @Suppress("UNCHECKED_CAST")
            (v as AtomicReference<Any?>).compareAndSet(actividad, null)
          }
          is WeakReference<*> -> if (v.get() === actividad) f.set(dueno, null)
          null -> Unit
          else -> return false
        }
        return true
      } catch (e: NoSuchFieldException) {
        clase = clase.superclass
      } catch (e: Exception) {
        return false
      }
    }
    return false
  }
}
