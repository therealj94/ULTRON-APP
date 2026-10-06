package expo.modules.auravoz

import android.media.AudioTrack
import java.util.Collections
import kotlin.math.abs
import kotlin.math.sin
import kotlin.system.exitProcess

/**
 * Reproductor.kt (modules/aura-voz) corriendo DE VERDAD en la JVM, sin teléfono: el mismo código Kotlin, con un
 * AudioTrack de mentira que se porta como el de Android en MODE_STREAM (falsos/android/media/AudioTrack.java) y un
 * /api/tts/pcm local que suelta el PCM despacio. Mide y comprueba lo que JS espera del módulo:
 *
 *  · empieza a sonar con el prebúfer (no con la frase entera) y avisa listo → sonando → posicion… → bajado → termino;
 *  · dos frases encadenadas suenan SIN HUECO en la misma pista;
 *  · `esperar` no suena hasta `soltar`; cancelar la que suena la calla ya y sigue la de detrás; parar() calla todo;
 *  · fallar antes de sonar (404, sin PCM, red cortada antes del prebúfer) → «error»; la red cortada a media frase →
 *    suena lo que llegó y «termino» truncada; el volumen por bloques sale del audio real (la boca).
 *
 *   sh mobile/pruebas/voz/jvm/correr.sh   (necesita kotlinc y un android.jar: ver correr.sh)
 */

private const val HZ = 22050
private var fallos = 0
private var n = 0

private fun ok(nombre: String, cond: Boolean, detalle: Any? = null) {
  n++
  if (cond) println("ok    $nombre")
  else {
    fallos++
    println("FALLA $nombre${if (detalle != null) "\n      $detalle" else ""}")
  }
}

/** PCM de `ms` milisegundos: un tono a media escala, o silencio. */
private fun pcm(ms: Int, amplitud: Int = 8000): ByteArray {
  val muestras = HZ * ms / 1000
  val b = ByteArray(muestras * 2)
  for (i in 0 until muestras) {
    val s = (sin(i * 2 * Math.PI * 220 / HZ) * amplitud).toInt()
    b[i * 2] = (s and 0xFF).toByte()
    b[i * 2 + 1] = ((s shr 8) and 0xFF).toByte()
  }
  return b
}

/**
 * El servidor, HTTP/1.1 a mano (para poder ROMPER la conexión a media frase, como hace res.destroy() en el servidor de
 * verdad): /pcm?ms=&ttfb=&vel=&corta=&amp= (chunked, `vel` veces más rápido que lo que dura; `corta`: a los N bytes se
 * cierra el socket sin el trozo final) ; /404 ; /sinpcm (un servidor viejo que contesta HTML).
 */
private class Servidor {
  val socket = java.net.ServerSocket(0, 50, java.net.InetAddress.getByName("127.0.0.1"))
  val puerto get() = socket.localPort
  @Volatile var vivo = true

  init {
    Thread {
      while (vivo) {
        val c = try {
          socket.accept()
        } catch (_: Exception) {
          break
        }
        // Un cliente que corta (cancelar, parar) deja al servidor escribiendo a un socket cerrado: no es un fallo.
        Thread { try { atender(c) } catch (_: java.io.IOException) { } }.apply { isDaemon = true }.start()
      }
    }.apply { isDaemon = true }.start()
  }

  fun cerrar() {
    vivo = false
    socket.close()
  }

  private fun atender(c: java.net.Socket) {
    c.use { s ->
      val entrada = s.getInputStream().bufferedReader(Charsets.ISO_8859_1)
      val linea = entrada.readLine() ?: return
      while (true) {
        val h = entrada.readLine() ?: return
        if (h.isEmpty()) break
      }
      val ruta = linea.split(" ").getOrNull(1) ?: "/"
      val camino = ruta.substringBefore("?")
      val q = ruta.substringAfter("?", "").split("&").mapNotNull { p -> p.split("=").takeIf { it.size == 2 }?.let { it[0] to it[1] } }.toMap()
      val salida = s.getOutputStream()
      fun cabeceras(texto: String) = salida.write(texto.replace("\n", "\r\n").toByteArray(Charsets.ISO_8859_1))
      when (camino) {
        "/404" -> cabeceras("HTTP/1.1 404 Not Found\nContent-Length: 0\nConnection: close\n\n")
        "/sinpcm" -> {
          val b = "<html>viejo</html>"
          cabeceras("HTTP/1.1 200 OK\nContent-Type: text/html\nContent-Length: ${b.length}\nConnection: close\n\n$b")
        }
        else -> {
          val ms = q["ms"]?.toInt() ?: 500
          val vel = q["vel"]?.toDouble() ?: 4.0
          val corta = q["corta"]?.toInt() ?: -1
          val datos = pcm(ms, q["amp"]?.toInt() ?: 8000)
          Thread.sleep(q["ttfb"]?.toLong() ?: 150)
          cabeceras("HTTP/1.1 200 OK\nContent-Type: audio/pcm\nX-Ultron-Pcm-Hz: $HZ\nTransfer-Encoding: chunked\nConnection: close\n\n")
          // Trozos de 50 ms y un byte: las muestras llegan partidas entre dos lecturas, a propósito.
          val trozo = 2205
          var i = 0
          while (i < datos.size) {
            if (corta in 0..i) {
              salida.flush()
              s.setSoLinger(true, 0)
              return // se cierra el socket sin el trozo final: el cliente ve la conexión rota
            }
            val k = minOf(trozo, datos.size - i)
            salida.write("${Integer.toHexString(k)}\r\n".toByteArray())
            salida.write(datos, i, k)
            salida.write("\r\n".toByteArray())
            salida.flush()
            i += k
            Thread.sleep((k / 2 * 1000.0 / HZ / vel).toLong())
          }
          salida.write("0\r\n\r\n".toByteArray())
          salida.flush()
        }
      }
    }
  }
}

private class Registro {
  val t0 = System.nanoTime()
  val eventos: MutableList<Pair<Long, Map<String, Any?>>> = Collections.synchronizedList(ArrayList())
  fun anotar(e: Map<String, Any?>) {
    eventos.add((System.nanoTime() - t0) / 1_000_000 to e)
  }
  fun de(id: String, tipo: String) = synchronized(eventos) { eventos.filter { it.second["id"] == id && it.second["tipo"] == tipo } }
  fun primero(id: String, tipo: String): Long = de(id, tipo).firstOrNull()?.first ?: -1
  fun espera(ms: Long, hasta: () -> Boolean = { false }) {
    val fin = System.currentTimeMillis() + ms
    while (System.currentTimeMillis() < fin && !hasta()) Thread.sleep(10)
  }
}

fun main() {
  val srv = Servidor()
  val base = "http://127.0.0.1:${srv.puerto}"

  println("[aura-voz en la JVM] empieza con el prebúfer y avisa en orden\n")
  run {
    val r = Registro()
    val rep = Reproductor(null) { r.anotar(it) }
    rep.encolar("a", "$base/pcm?ms=800&ttfb=150&vel=3", mapOf("Accept" to "audio/pcm"), false, 150)
    r.espera(3000) { r.primero("a", "termino") >= 0 }
    val listo = r.primero("a", "listo")
    val suena = r.primero("a", "sonando")
    val bajado = r.primero("a", "bajado")
    val fin = r.primero("a", "termino")
    println("  [medida] listo ${listo} ms · sonando ${suena} ms · bajada entera ${bajado} ms · termino ${fin} ms")
    ok("suena ANTES de bajarla entera (con el prebúfer)", suena in 1 until bajado, "sonando=$suena bajado=$bajado")
    ok("listo → sonando → bajado → termino, en orden", listo in 1..suena && bajado < fin, r.eventos.map { it.second["tipo"] }.distinct())
    val pos = r.de("a", "posicion").map { (it.second["ms"] as Int) }
    ok("posición ~30 por segundo, siempre hacia adelante", pos.size >= 15 && pos.zipWithNext().all { (x, y) -> y >= x }, pos.take(10))
    val dur = (r.de("a", "termino").first().second["ms"] as Int)
    ok("termino dice lo que sonó (800 ms por los cuadros de la pista)", abs(dur - 800) <= 2, dur)
    ok("y dura lo que dura: termino ≈ sonando + 800 ms", abs((fin - suena) - 800) <= 120, fin - suena)
    val niveles = r.de("a", "posicion").map { (it.second["nivel"] as Double) }
    ok("el volumen por bloques sale del audio (tono a 8000/32768 ≈ RMS 0,17)", niveles.isNotEmpty() && niveles.all { abs(it - 0.1726) < 0.02 }, niveles.take(5))
    val t = AudioTrack.creadas.last()
    ok("la pista se suelta al terminar (drenada)", t.liberada)
    rep.cerrar()
  }

  println("\n[aura-voz en la JVM] la cola sin hueco\n")
  run {
    val r = Registro()
    val rep = Reproductor(null) { r.anotar(it) }
    val antes = AudioTrack.creadas.size
    rep.encolar("b1", "$base/pcm?ms=600&ttfb=100&vel=4", emptyMap(), false, 150)
    rep.encolar("b2", "$base/pcm?ms=600&ttfb=100&vel=4", emptyMap(), false, 150)
    r.espera(4000) { r.primero("b2", "termino") >= 0 }
    val fin1 = r.primero("b1", "termino")
    val ini2 = r.primero("b2", "sonando")
    val fin2 = r.primero("b2", "termino")
    println("  [medida] b1 termina ${fin1} ms · b2 suena ${ini2} ms · b2 termina ${fin2} ms")
    ok("las dos en UNA pista (la segunda se escribe detrás de la primera)", AudioTrack.creadas.size - antes == 1, AudioTrack.creadas.size - antes)
    ok("sin hueco: la segunda suena en el mismo aviso en que termina la primera", ini2 >= 0 && abs(ini2 - fin1) <= 40, "fin1=$fin1 ini2=$ini2")
    ok("y entre las dos duran 1,2 s seguidos", abs((fin2 - r.primero("b1", "sonando")) - 1200) <= 150, fin2 - r.primero("b1", "sonando"))
    rep.cerrar()
  }

  println("\n[aura-voz en la JVM] esperar, soltar, cancelar, parar\n")
  run {
    val r = Registro()
    val rep = Reproductor(null) { r.anotar(it) }
    rep.encolar("c", "$base/pcm?ms=500&ttfb=50&vel=8", emptyMap(), true, 150)
    r.espera(600)
    ok("con `esperar`: se baja (listo) pero NO suena", r.primero("c", "listo") >= 0 && r.primero("c", "sonando") < 0)
    rep.soltar("c")
    r.espera(1500) { r.primero("c", "termino") >= 0 }
    ok("al soltarla suena y termina", r.primero("c", "sonando") > 600 && r.primero("c", "termino") > 0)

    rep.encolar("d1", "$base/pcm?ms=1500&ttfb=50&vel=6", emptyMap(), false, 150)
    rep.encolar("d2", "$base/pcm?ms=400&ttfb=50&vel=6", emptyMap(), false, 150)
    r.espera(2000) { r.primero("d1", "sonando") >= 0 }
    r.espera(300)
    val antesDeCancelar = r.de("d1", "posicion").size
    val tCancel = (System.nanoTime() - r.t0) / 1_000_000
    rep.cancelar("d1")
    r.espera(2000) { r.primero("d2", "termino") >= 0 }
    val tarde = r.de("d1", "posicion").filter { it.first > tCancel + 40 }
    ok("cancelar la que suena: deja de avisar YA (se calló)", antesDeCancelar > 0 && tarde.isEmpty(), tarde.size)
    ok("… y la de detrás suena entera después", r.primero("d2", "sonando") > tCancel && r.primero("d2", "termino") > 0)

    rep.encolar("e1", "$base/pcm?ms=1500&ttfb=50&vel=6", emptyMap(), false, 150)
    rep.encolar("e2", "$base/pcm?ms=1500&ttfb=50&vel=6", emptyMap(), false, 150)
    r.espera(2000) { r.primero("e1", "sonando") >= 0 }
    val tParar = (System.nanoTime() - r.t0) / 1_000_000
    rep.parar()
    r.espera(1500)
    val despues = synchronized(r.eventos) { r.eventos.filter { it.first > tParar + 40 && (it.second["id"] == "e1" || it.second["id"] == "e2") } }
    ok("parar(): nada más suena ni avisa (ni la que sonaba ni la de detrás)", despues.isEmpty(), despues.map { it.second })
    ok("… y la pista quedó suelta", AudioTrack.creadas.last().liberada)
    rep.cerrar()
  }

  println("\n[aura-voz en la JVM] fallas: antes de sonar → error; a media frase → truncada\n")
  run {
    val r = Registro()
    val rep = Reproductor(null) { r.anotar(it) }
    rep.encolar("f404", "$base/404", emptyMap(), false, 150)
    rep.encolar("fhtml", "$base/sinpcm", emptyMap(), false, 150)
    rep.encolar("fcorta", "$base/pcm?ms=2000&ttfb=50&vel=1&corta=2000", emptyMap(), false, 300)
    r.espera(2000) { r.de("fcorta", "error").isNotEmpty() || r.de("fcorta", "termino").isNotEmpty() }
    val e404 = r.de("f404", "error").firstOrNull()?.second
    ok("404: «error» http 404 antes de sonar", e404?.get("codigo") == "http" && e404["status"] == 404 && r.primero("f404", "sonando") < 0, e404)
    val ehtml = r.de("fhtml", "error").firstOrNull()?.second
    ok("un servidor viejo que no manda PCM: «error» formato", ehtml?.get("codigo") == "formato", ehtml)
    val ecorta = r.de("fcorta", "error").firstOrNull()?.second
    ok("red cortada antes de juntar el prebúfer: «error» red, nada sonó", ecorta?.get("codigo") == "red" && r.primero("fcorta", "sonando") < 0, r.de("fcorta", "error"))

    rep.encolar("g", "$base/pcm?ms=2000&ttfb=50&vel=1&corta=22050", emptyMap(), false, 150)
    r.espera(3000) { r.primero("g", "termino") >= 0 }
    val tg = r.de("g", "termino").firstOrNull()?.second
    ok("red cortada A MEDIA frase (ya sonando): suena lo que llegó y «termino» truncada", r.primero("g", "sonando") >= 0 && tg?.get("truncada") == true && (tg["ms"] as Int) in 300..700, tg)
    ok("… sin «error» (ya sonaba: no se repite por el camino de siempre)", r.de("g", "error").isEmpty())
    rep.cerrar()
  }

  println("\n[aura-voz en la JVM] teléfonos que ponen la cabeza en 0 al drenar\n")
  run {
    AudioTrack.cabezaACeroAlDrenar = true
    val r = Registro()
    val rep = Reproductor(null) { r.anotar(it) }
    rep.encolar("h", "$base/pcm?ms=400&ttfb=50&vel=8", emptyMap(), false, 150)
    r.espera(2000) { r.primero("h", "termino") >= 0 }
    val th = r.de("h", "termino").firstOrNull()?.second
    ok("la cabeza vuelve a 0 al final: igual avisa «termino» con lo que sonó", th != null && (th["ms"] as Int) == 400, th)
    AudioTrack.cabezaACeroAlDrenar = false
    rep.cerrar()
  }

  srv.cerrar()
  println("\n${n - fallos}/$n del reproductor nativo bien")
  exitProcess(if (fallos > 0) 1 else 0)
}
