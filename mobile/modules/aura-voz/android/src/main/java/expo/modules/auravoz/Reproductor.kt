package expo.modules.auravoz

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioTrack
import android.os.Build
import android.os.SystemClock
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledExecutorService
import java.util.concurrent.TimeUnit
import java.util.concurrent.locks.ReentrantLock
import kotlin.concurrent.withLock
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sqrt

/**
 * Una frase de la cola: su descarga (crece mientras llega) y lo que ya se escribió en la pista.
 * Todo se toca con el candado del reproductor.
 */
internal class Frase(
  val id: String,
  val url: String,
  val cabeceras: Map<String, String>,
  var soltada: Boolean,
  val prebufferMs: Int
) {
  var datos = ByteArray(32 * 1024)
  var largo = 0
  var hz = 0
  var bajada = false
  var truncada = false
  var cancelada = false
  var conexion: HttpURLConnection? = null
  var listoAvisado = false

  /** Volumen RMS (0..1) de cada bloque de 20 ms, para la boca. */
  var niveles = FloatArray(64)
  var nNiveles = 0
  var sumaBloque = 0.0
  var muestrasBloque = 0
  /** El primer byte de una muestra que quedó partida entre dos lecturas de la red. */
  var byteSuelto = -1

  var enPista = false
  var pistaGen = 0
  /** Bytes de `datos` ya escritos en la pista. */
  var escritos = 0
  /** Cuadro de la pista donde empieza y donde termina (-1 hasta que se escribió entera). */
  var inicio = 0L
  var fin = -1L
  var sono = false
  var termino = false

  fun prebufferBytes(): Int = max(2, (prebufferMs.toLong() * hz / 1000).toInt() * 2)
}

/**
 * El reproductor en streaming de AU-RA: baja el PCM de /api/tts/pcm y lo escribe en UN AudioTrack (MODE_STREAM)
 * mientras llega. Suena con los primeros ~150 ms (no espera el archivo entero) y encadena las frases de la cola sin
 * hueco: la siguiente se escribe detrás de la anterior en la misma pista.
 *
 * Hilos: uno por descarga (la red bloquea), un escritor (escrituras NO bloqueantes: un corte nunca queda trabado
 * dentro de AudioTrack.write) y un reloj a 30 Hz que lee la cabeza de la pista (los cuadros que DE VERDAD sonaron) y
 * avisa a JS: «sonando», «posicion» (ms y volumen ahí, para la boca), «termino». Un solo candado para todo, sin
 * candados anidados.
 *
 * Atributos de audio: USAGE_MEDIA + CONTENT_TYPE_SPEECH, el mismo flujo (STREAM_MUSIC) por el que suena hoy expo-av.
 * Así el volumen, la salida (altavoz/auriculares) y la cancelación de eco del oído Turbo (aura-mic con
 * VOICE_COMMUNICATION + AcousticEchoCanceler) ven la voz igual que antes. USAGE_VOICE_COMMUNICATION la mandaría por la
 * ruta de llamada (auricular de oreja, volumen de llamada): un cambio aparte, que habría que medir en teléfono.
 */
internal class Reproductor(private val contexto: Context?, private val avisar: (Map<String, Any?>) -> Unit) {
  private val candado = ReentrantLock()
  private val cambio = candado.newCondition()
  private val cola = ArrayList<Frase>()
  private val red: ExecutorService = Executors.newCachedThreadPool { r -> Thread(r, "AuraVoz-red").apply { isDaemon = true } }
  private val reloj: ScheduledExecutorService = Executors.newSingleThreadScheduledExecutor { r -> Thread(r, "AuraVoz-reloj").apply { isDaemon = true } }
  private var escritor: Thread? = null
  @Volatile private var vivo = true

  private var pista: AudioTrack? = null
  private var pistaHz = 0
  private var pistaGen = 0
  private var cuadrosEscritos = 0L
  private var drenando = false
  private var drenarDesde = 0L
  private var ultimaCabeza = -1L
  private var cabezaQuietaDesde = 0L
  private var foco: AudioFocusRequest? = null

  init {
    reloj.scheduleAtFixedRate({ mirar() }, 33, 33, TimeUnit.MILLISECONDS)
  }

  /** Pone una frase en la cola y empieza a bajarla. `esperar`: bajarla ya pero no sonarla hasta `soltar`. */
  fun encolar(id: String, url: String, cabeceras: Map<String, String>, esperar: Boolean, prebufferMs: Int) {
    val f = Frase(id, url, cabeceras, !esperar, prebufferMs.coerceIn(40, 1000))
    candado.withLock {
      if (!vivo) return
      cola.removeAll { it.id == id && quitar(it) }
      cola.add(f)
      if (escritor == null) {
        escritor = Thread({ bucleEscritor() }, "AuraVoz-escritor").also {
          it.isDaemon = true
          it.priority = Thread.MAX_PRIORITY
          it.start()
        }
      }
      cambio.signalAll()
    }
    red.execute { bajar(f) }
  }

  /** Ya puede sonar (en cuanto termine lo de delante: sin hueco si ya está bajada). */
  fun soltar(id: String) {
    candado.withLock {
      cola.find { it.id == id }?.soltada = true
      cambio.signalAll()
    }
  }

  /**
   * Cancela una frase. Si todavía no está en la pista, sale de la cola y no suena. Si ya está (sonando, o escrita
   * detrás de la que suena), la pista se calla YA: lo que sonaba termina «cortada» (pierde como mucho el último
   * búfer, ~100 ms, que suele ser el silencio del final) y lo demás de la cola se reescribe en una pista nueva.
   */
  fun cancelar(id: String) {
    candado.withLock {
      val f = cola.find { it.id == id } ?: return
      val enEsta = f.enPista && f.pistaGen == pistaGen && pista != null && !f.termino
      cola.remove(f)
      quitar(f)
      if (enEsta) cortarPista(avisarCortadas = true)
      cambio.signalAll()
    }
  }

  /** Calla todo en el acto y vacía la cola (stopSpeaking de JS). Sin avisos: quien para ya lo sabe. */
  fun parar() {
    candado.withLock {
      for (f in cola) quitar(f)
      cola.clear()
      cortarPista(avisarCortadas = false)
      cambio.signalAll()
    }
  }

  fun cerrar() {
    parar()
    candado.withLock {
      vivo = false
      cambio.signalAll()
    }
    try {
      reloj.shutdownNow()
      red.shutdownNow()
    } catch (_: Exception) {
    }
  }

  /* ── la red ─────────────────────────────────────────────────────────────────────────────── */

  private fun bajar(f: Frase) {
    var c: HttpURLConnection? = null
    try {
      c = URL(f.url).openConnection() as HttpURLConnection
      c.connectTimeout = 8000
      c.readTimeout = 15000
      c.requestMethod = "GET"
      c.instanceFollowRedirects = true
      for ((k, v) in f.cabeceras) c.setRequestProperty(k, v)
      candado.withLock {
        if (f.cancelada) return
        f.conexion = c
      }
      val estado = c.responseCode
      if (estado != 200) return falloAntes(f, "http", "el servidor contestó $estado", estado)
      val tipo = (c.contentType ?: "").lowercase()
      val hz = c.getHeaderField("X-Ultron-Pcm-Hz")?.trim()?.toIntOrNull() ?: 0
      if (!tipo.startsWith("audio/pcm") || hz < 8000 || hz > 48000) return falloAntes(f, "formato", "no es PCM ($tipo, $hz Hz)", estado)
      candado.withLock {
        if (f.cancelada) return
        f.hz = hz
      }
      val entrada = c.inputStream
      val buf = ByteArray(8192)
      while (true) {
        val n = entrada.read(buf)
        if (n < 0) break
        if (n == 0) continue
        var listo = false
        candado.withLock {
          if (f.cancelada) return
          agregar(f, buf, n)
          if (!f.listoAvisado && f.largo >= f.prebufferBytes()) {
            f.listoAvisado = true
            listo = true
          }
          cambio.signalAll()
        }
        if (listo) avisar(mapOf("tipo" to "listo", "id" to f.id, "hz" to hz))
      }
      var vacia = false
      var listo = false
      var ms = 0
      candado.withLock {
        if (f.cancelada) return
        cerrarBloque(f)
        vacia = f.largo < 2
        if (!vacia) {
          f.bajada = true
          if (!f.listoAvisado) {
            f.listoAvisado = true
            listo = true
          }
          ms = ((f.largo / 2).toLong() * 1000 / f.hz).toInt()
        }
        cambio.signalAll()
      }
      if (vacia) return falloAntes(f, "formato", "llegó sin audio", estado)
      if (listo) avisar(mapOf("tipo" to "listo", "id" to f.id, "hz" to hz))
      avisar(mapOf("tipo" to "bajado", "id" to f.id, "ms" to ms))
    } catch (e: Exception) {
      // Se cortó la red. Si nada de la frase llegó a la pista, falla ANTES de sonar (JS la dice por el camino de
      // siempre); si ya estaba en la pista, suena lo que llegó y termina «truncada».
      var antes = false
      candado.withLock {
        if (f.cancelada) return
        if (f.enPista) {
          cerrarBloque(f)
          f.bajada = true
          f.truncada = true
          cambio.signalAll()
        } else antes = true
      }
      if (antes) falloAntes(f, "red", e.message ?: e.javaClass.simpleName, 0)
    } finally {
      try {
        c?.disconnect()
      } catch (_: Exception) {
      }
    }
  }

  private fun agregar(f: Frase, b: ByteArray, n: Int) {
    if (f.largo + n > f.datos.size) f.datos = f.datos.copyOf(max(f.datos.size * 2, f.largo + n))
    System.arraycopy(b, 0, f.datos, f.largo, n)
    f.largo += n
    // El volumen por bloques de 20 ms (la boca): muestras de 16 bits little-endian, aunque lleguen partidas.
    val porBloque = max(1, f.hz / 50)
    var i = 0
    while (i < n) {
      val lo: Int
      val hi: Int
      if (f.byteSuelto >= 0) {
        lo = f.byteSuelto
        hi = b[i].toInt() and 0xFF
        f.byteSuelto = -1
        i += 1
      } else if (i + 1 < n) {
        lo = b[i].toInt() and 0xFF
        hi = b[i + 1].toInt() and 0xFF
        i += 2
      } else {
        f.byteSuelto = b[i].toInt() and 0xFF
        i += 1
        continue
      }
      val s = ((hi shl 8) or lo).toShort().toDouble()
      f.sumaBloque += s * s
      f.muestrasBloque += 1
      if (f.muestrasBloque >= porBloque) cerrarBloque(f)
    }
  }

  private fun cerrarBloque(f: Frase) {
    if (f.muestrasBloque == 0) return
    if (f.nNiveles >= f.niveles.size) f.niveles = f.niveles.copyOf(f.niveles.size * 2)
    f.niveles[f.nNiveles++] = (sqrt(f.sumaBloque / f.muestrasBloque) / 32768.0).toFloat().coerceIn(0f, 1f)
    f.sumaBloque = 0.0
    f.muestrasBloque = 0
  }

  private fun falloAntes(f: Frase, codigo: String, motivo: String, estado: Int) {
    candado.withLock {
      if (f.cancelada) return
      cola.remove(f)
      quitar(f)
      cambio.signalAll()
    }
    avisar(mapOf("tipo" to "error", "id" to f.id, "codigo" to codigo, "status" to estado, "motivo" to motivo.take(160)))
  }

  /** Marca la frase como cancelada y corta su descarga (fuera del candado: cerrar un socket puede tardar). */
  private fun quitar(f: Frase): Boolean {
    f.cancelada = true
    val c = f.conexion
    f.conexion = null
    if (c != null) {
      try {
        red.execute {
          try {
            c.disconnect()
          } catch (_: Exception) {
          }
        }
      } catch (_: Exception) {
      }
    }
    return true
  }

  /* ── la pista ───────────────────────────────────────────────────────────────────────────── */

  private fun bucleEscritor() {
    candado.withLock {
      while (vivo) {
        val f = siguiente()
        if (f == null) {
          if (pista != null && !drenando && todoEscrito()) drenar()
          cambio.await(20, TimeUnit.MILLISECONDS)
          continue
        }
        if (!escribir(f)) cambio.await(8, TimeUnit.MILLISECONDS)
      }
    }
  }

  /** La primera de la cola que todavía tiene algo por escribir, si ya puede escribirse. */
  private fun siguiente(): Frase? {
    if (drenando) return null
    val f = cola.firstOrNull { !it.cancelada && it.fin < 0 } ?: return null
    if (!f.soltada || f.hz == 0) return null
    if (!f.enPista) {
      // Otra frecuencia: se deja sonar lo que hay y se abre una pista nueva.
      if (pista != null && pistaHz != f.hz) return null
      // Arranca con el prebúfer juntado (o entera, si era más corta): la red no la entrecorta.
      if (f.largo - f.escritos < f.prebufferBytes() && !f.bajada) return null
    } else if (f.largo - f.escritos < 2 && !f.bajada) return null
    return f
  }

  /** ¿Todo lo de esta pista ya está escrito (y no hay con qué seguir ahora)? Entonces se drena para que suene el final. */
  private fun todoEscrito(): Boolean = cola.none { it.enPista && it.pistaGen == pistaGen && !it.termino && it.fin < 0 }

  /** Escribe un trozo (sin bloquear). false: no escribió nada (pista llena o esperando red). */
  private fun escribir(f: Frase): Boolean {
    if (pista == null && !abrirPista(f.hz, f.prebufferMs)) {
      cola.remove(f)
      quitar(f)
      avisar(mapOf("tipo" to "error", "id" to f.id, "codigo" to "pista", "status" to 0, "motivo" to "no se pudo abrir la salida de audio a ${f.hz} Hz"))
      return true
    }
    val p = pista ?: return false
    if (!f.enPista) {
      f.enPista = true
      f.pistaGen = pistaGen
      f.inicio = cuadrosEscritos
    }
    val hasta = f.largo - ((f.largo - f.escritos) % 2)
    if (f.escritos >= hasta) {
      if (f.bajada) {
        f.fin = f.inicio + f.escritos / 2
        return true
      }
      return false
    }
    val n = min(hasta - f.escritos, 4096)
    val w = try {
      p.write(f.datos, f.escritos, n, AudioTrack.WRITE_NON_BLOCKING)
    } catch (e: Exception) {
      -1
    }
    if (w < 0) {
      romperPista("la salida de audio falló al escribir ($w)")
      return true
    }
    f.escritos += w
    cuadrosEscritos += w / 2
    return w > 0
  }

  private fun abrirPista(hz: Int, prebufferMs: Int): Boolean {
    val minimo = AudioTrack.getMinBufferSize(hz, AudioFormat.CHANNEL_OUT_MONO, AudioFormat.ENCODING_PCM_16BIT)
    if (minimo <= 0) return false
    // Al menos 100 ms de búfer: el escritor despierta cada 8 ms y nunca lo deja vacío mientras haya red.
    val capacidad = max(minimo * 2, hz / 10 * 2)
    val t = try {
      AudioTrack.Builder()
        .setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build())
        .setAudioFormat(AudioFormat.Builder().setEncoding(AudioFormat.ENCODING_PCM_16BIT).setSampleRate(hz).setChannelMask(AudioFormat.CHANNEL_OUT_MONO).build())
        .setBufferSizeInBytes(capacidad)
        .setTransferMode(AudioTrack.MODE_STREAM)
        .build()
    } catch (e: Exception) {
      return false
    }
    if (t.state != AudioTrack.STATE_INITIALIZED) {
      t.release()
      return false
    }
    // Desde Android 12 la pista arranca con el prebúfer, no con el búfer lleno.
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      try {
        t.setStartThresholdInFrames(max(1, min(t.bufferSizeInFrames, prebufferMs * hz / 1000)))
      } catch (_: Exception) {
      }
    }
    try {
      t.play()
    } catch (e: Exception) {
      t.release()
      return false
    }
    pedirFoco()
    pista = t
    pistaHz = hz
    pistaGen += 1
    cuadrosEscritos = 0
    drenando = false
    ultimaCabeza = -1
    cabezaQuietaDesde = SystemClock.elapsedRealtime()
    return true
  }

  /** Nada más que escribir: stop() en streaming suena lo que queda y para (y arranca aunque el búfer no esté lleno). */
  private fun drenar() {
    try {
      pista?.stop()
    } catch (_: Exception) {
    }
    drenando = true
    drenarDesde = SystemClock.elapsedRealtime()
    // La quietud de antes (esperando red) no cuenta: desde aquí la cabeza tiene que avanzar hasta el final.
    cabezaQuietaDesde = drenarDesde
  }

  /** Calla la pista ya (pausa + vaciar) y la suelta. Lo que sonaba termina «cortada»; lo escrito sin sonar se reescribe. */
  private fun cortarPista(avisarCortadas: Boolean) {
    val p = pista ?: return
    try {
      p.pause()
      p.flush()
    } catch (_: Exception) {
    }
    soltarPista(p)
    for (f in ArrayList(cola)) {
      if (!f.enPista || f.pistaGen != pistaGen || f.termino) continue
      if (f.sono) {
        f.termino = true
        cola.remove(f)
        if (avisarCortadas) avisar(mapOf("tipo" to "termino", "id" to f.id, "ms" to msDe(f, ultimaCabeza.coerceAtLeast(f.inicio)), "cortada" to true))
      } else {
        f.enPista = false
        f.escritos = 0
        f.fin = -1
      }
    }
  }

  /** La pista dejó de servir: lo que sonaba termina «cortado»; lo que no sonó falla ANTES de sonar (JS lo repite). */
  private fun romperPista(motivo: String) {
    val p = pista ?: return
    try {
      p.pause()
      p.flush()
    } catch (_: Exception) {
    }
    soltarPista(p)
    for (f in ArrayList(cola)) {
      if (!f.enPista || f.pistaGen != pistaGen || f.termino) continue
      f.termino = true
      cola.remove(f)
      quitar(f)
      if (f.sono) avisar(mapOf("tipo" to "termino", "id" to f.id, "ms" to msDe(f, ultimaCabeza.coerceAtLeast(f.inicio)), "cortada" to true))
      else avisar(mapOf("tipo" to "error", "id" to f.id, "codigo" to "pista", "status" to 0, "motivo" to motivo))
    }
  }

  private fun soltarPista(p: AudioTrack) {
    try {
      p.release()
    } catch (_: Exception) {
    }
    pista = null
    pistaHz = 0
    drenando = false
    soltarFoco()
  }

  private fun msDe(f: Frase, cabeza: Long): Int = if (f.hz <= 0) 0 else ((cabeza - f.inicio).coerceAtLeast(0) * 1000 / f.hz).toInt()

  /** El reloj (30 Hz): lee la cabeza de la pista (lo que sonó de verdad) y avisa. */
  private fun mirar() {
    try {
      candado.withLock {
        val p = pista ?: return
        val cabeza = (p.playbackHeadPosition.toLong() and 0xFFFFFFFFL)
        val ahora = SystemClock.elapsedRealtime()
        // Drenando, algunos teléfonos ponen la cabeza en 0 al terminar: eso también es «sonó todo».
        val reinicio = drenando && cabeza < ultimaCabeza
        if (cabeza != ultimaCabeza) cabezaQuietaDesde = ahora
        if (!reinicio) ultimaCabeza = cabeza
        var avisoPosicion = false
        for (f in ArrayList(cola)) {
          if (!f.enPista || f.pistaGen != pistaGen || f.termino) continue
          val terminada = f.fin >= 0 && (reinicio || cabeza >= f.fin)
          if (!f.sono && (cabeza > f.inicio || terminada)) {
            f.sono = true
            avisar(mapOf("tipo" to "sonando", "id" to f.id))
          }
          if (!f.sono) continue
          if (terminada) {
            f.termino = true
            cola.remove(f)
            avisar(mapOf("tipo" to "termino", "id" to f.id, "ms" to msDe(f, f.fin), "truncada" to f.truncada))
            continue
          }
          if (!avisoPosicion) {
            avisoPosicion = true
            val porBloque = max(1, f.hz / 50)
            val bloque = ((cabeza - f.inicio) / porBloque).toInt()
            val nivel = if (bloque in 0 until f.nNiveles) f.niveles[bloque].toDouble() else 0.0
            avisar(mapOf("tipo" to "posicion", "id" to f.id, "ms" to msDe(f, cabeza), "nivel" to nivel))
          }
        }
        if (drenando) {
          // Drenada: sonó todo (o la cabeza se quedó quieta: hay teléfonos que no la mueven al final).
          val todo = reinicio || cabeza >= cuadrosEscritos || ahora - cabezaQuietaDesde > 400 ||
            ahora - drenarDesde > cuadrosEscritos * 1000 / max(1, pistaHz) + 1500
          if (todo) {
            for (f in ArrayList(cola)) {
              if (!f.enPista || f.pistaGen != pistaGen || f.termino) continue
              if (!f.sono) avisar(mapOf("tipo" to "sonando", "id" to f.id))
              f.sono = true
              f.termino = true
              cola.remove(f)
              avisar(mapOf("tipo" to "termino", "id" to f.id, "ms" to msDe(f, if (f.fin >= 0) f.fin else cabeza), "truncada" to f.truncada))
            }
            soltarPista(p)
            cambio.signalAll()
          }
        }
      }
    } catch (_: Exception) {
      // El reloj no se cae: si una lectura falló, la siguiente vuelta lo intenta otra vez.
    }
  }

  /* ── el foco de audio ───────────────────────────────────────────────────────────────────── */

  /**
   * Mientras habla: foco transitorio «puede bajar el volumen» (la música de otra app se agacha, como cuando habla
   * expo-av). Se suelta al soltar la pista. Si el sistema no lo da, la voz suena igual.
   */
  private fun pedirFoco() {
    if (foco != null) return
    try {
      val am = contexto?.getSystemService(Context.AUDIO_SERVICE) as? AudioManager ?: return
      val r = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK)
        .setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build())
        .setOnAudioFocusChangeListener { }
        .build()
      am.requestAudioFocus(r)
      foco = r
    } catch (_: Exception) {
    }
  }

  private fun soltarFoco() {
    val r = foco ?: return
    foco = null
    try {
      (contexto?.getSystemService(Context.AUDIO_SERVICE) as? AudioManager)?.abandonAudioFocusRequest(r)
    } catch (_: Exception) {
    }
  }
}
