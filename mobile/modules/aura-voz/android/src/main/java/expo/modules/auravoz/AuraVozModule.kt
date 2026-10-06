package expo.modules.auravoz

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Módulo `AuraVoz` (Android): la voz de AU-RA sonando A MEDIDA QUE LLEGA (docs/adr/ADR-voz-en-streaming.md).
 *
 * JS (src/lib/sonidoVivo.ts) le pasa cada frase como una URL de /api/tts/pcm con las cabeceras de sesión; el
 * Reproductor la baja y la suena con AudioTrack en MODE_STREAM desde los primeros ~150 ms, encadenando la cola sin
 * hueco. Lo que JS le pide:
 *  · `encolar(id, url, cabeceras, opciones)` → empieza a bajarla. `opciones.esperar`: no sonarla hasta `soltar(id)`
 *    (la mesa la prepara mientras suena otra cosa). `opciones.prebufferMs`: cuánto juntar antes de sonar.
 *  · `soltar(id)` → ya puede sonar, detrás de lo que esté delante.
 *  · `cancelar(id)` → esa frase no suena (o se calla ya, si sonaba). `parar()` → todo se calla ya.
 *  · `disponible()` / `version()`: que JS sepa que este binario lo trae (una APK anterior que recibe este JS por OTA
 *    no lo tiene y sigue con expo-av).
 *
 * Avisa por `onVoz` ({ tipo, id, … }): «listo» (juntó el prebúfer), «sonando» (la pista avanzó dentro de la frase),
 * «posicion» (ms por los cuadros que sonaron + volumen ahí, ~30 por segundo), «bajado» (duración total), «termino»
 * (sonó; `cortada` / `truncada`) y «error» (falló ANTES de sonar: código red/http/formato/vacio/pista). Los revisa
 * src/lib/vozNativa.ts (eventoVozValido).
 */
class AuraVozModule : Module() {
  private var reproductor: Reproductor? = null

  private fun rep(): Reproductor {
    reproductor?.let { return it }
    val r = Reproductor(appContext.reactContext?.applicationContext) { evento -> sendEvent("onVoz", evento) }
    reproductor = r
    return r
  }

  override fun definition() = ModuleDefinition {
    Name("AuraVoz")

    Events("onVoz")

    Function("disponible") { true }
    Function("version") { 1 }

    Function("encolar") { id: String, url: String, cabeceras: Map<String, Any?>?, opciones: Map<String, Any?>? ->
      if (id.isEmpty() || id.length > 80 || !(url.startsWith("https://") || url.startsWith("http://"))) return@Function false
      val limpias = HashMap<String, String>()
      cabeceras?.forEach { (k, v) -> if (v is String && k.isNotEmpty() && !v.contains('\n') && !v.contains('\r')) limpias[k] = v }
      val esperar = opciones?.get("esperar") == true
      val prebufferMs = (opciones?.get("prebufferMs") as? Number)?.toInt() ?: 150
      rep().encolar(id, url, limpias, esperar, prebufferMs)
      true
    }

    Function("soltar") { id: String -> rep().soltar(id) }

    Function("cancelar") { id: String -> rep().cancelar(id) }

    Function("parar") { reproductor?.parar() }

    OnDestroy {
      reproductor?.cerrar()
      reproductor = null
    }
  }
}
