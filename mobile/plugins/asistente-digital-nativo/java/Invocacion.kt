package __PAQUETE__.asistente

import android.content.Context
import android.content.Intent
import android.net.Uri

/**
 * CÓMO SE ABRE LA BURBUJA DE AURA, desde cualquier entrada (plugins/asistente-digital.js).
 *
 * Todas las entradas —el botón lateral (la sesión del asistente), ASSIST / VOICE_COMMAND, el mosaico de Ajustes
 * rápidos y el atajo del ícono— terminan aquí: un intent EXPLÍCITO a BurbujaActivity con
 * `__ESQUEMA__://burbuja?origen=…&t=…`. Explícito para que nunca lo tome MainActivity (que también declara el esquema);
 * con ACTION_VIEW y el dato para que, si la burbuja ya está abierta, React Native lo entregue a JS como un enlace nuevo
 * (Linking «url»: solo reenvía los VIEW con dato). `t` es el momento de la invocación en el reloj de pared: la burbuja
 * mide con él «invocación → escuchando» aunque React tarde en arrancar (src/entrada/enlace.ts).
 *
 * Los orígenes son los mismos que entiende JS (`ORIGENES` en src/entrada/enlace.ts); uno desconocido allá cuenta como
 * «enlace».
 */
object Invocacion {
  const val ASISTENTE = "asistente"
  const val COMANDO = "comando"
  const val MOSAICO = "mosaico"
  const val ATAJO = "atajo"

  private const val ESQUEMA = "__ESQUEMA__"

  fun burbuja(context: Context, origen: String, momento: Long = System.currentTimeMillis()): Intent =
    Intent(context, BurbujaActivity::class.java)
      .setAction(Intent.ACTION_VIEW)
      .setData(Uri.parse("$ESQUEMA://burbuja?origen=${Uri.encode(origen)}&t=$momento"))
      .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)

  /** El origen de un intent que llegó a la burbuja: el de su enlace, o el de la acción del sistema que la abrió. */
  fun origen(intent: Intent?): String {
    val delEnlace = intent?.data?.takeIf { it.scheme == ESQUEMA }?.getQueryParameter("origen")
    if (!delEnlace.isNullOrBlank()) return delEnlace
    return when (intent?.action) {
      Intent.ACTION_ASSIST -> ASISTENTE
      Intent.ACTION_VOICE_COMMAND -> COMANDO
      else -> "enlace"
    }
  }

  /** Cuándo se invocó: el `t` del enlace si es creíble (ni del futuro ni de hace más de un minuto); si no, ahora. */
  fun momento(intent: Intent?, ahora: Long = System.currentTimeMillis()): Long {
    val t = intent?.data?.getQueryParameter("t")?.toLongOrNull() ?: return ahora
    return if (t <= ahora + 1_000 && ahora - t <= 60_000) t else ahora
  }

  /**
   * El intent de una entrada del sistema (ASSIST, VOICE_COMMAND, o un atajo sin `t`) con la forma de siempre: VIEW con
   * el enlace y su momento. Así JS ve igual una burbuja que se abre que una que ya estaba abierta y la vuelven a llamar.
   */
  fun normalizar(context: Context, intent: Intent?): Intent {
    val dato = intent?.data
    if (intent != null && intent.action == Intent.ACTION_VIEW && dato?.scheme == ESQUEMA && dato.getQueryParameter("t") != null) return intent
    return burbuja(context, origen(intent), momento(intent))
  }
}
