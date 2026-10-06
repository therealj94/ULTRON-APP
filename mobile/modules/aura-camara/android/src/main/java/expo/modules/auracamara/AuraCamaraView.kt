package expo.modules.auracamara

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.hardware.display.DisplayManager
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.util.Base64
import android.util.Log
import android.util.Size
import android.view.View
import android.view.ViewGroup
import androidx.annotation.OptIn
import androidx.camera.core.AspectRatio
import androidx.camera.core.Camera
import androidx.camera.core.CameraSelector
import androidx.camera.core.CameraState
import androidx.camera.core.ExperimentalGetImage
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageCapture
import androidx.camera.core.ImageCaptureException
import androidx.camera.core.ImageProxy
import androidx.camera.core.Preview
import androidx.camera.core.UseCase
import androidx.camera.core.resolutionselector.AspectRatioStrategy
import androidx.camera.core.resolutionselector.ResolutionSelector
import androidx.camera.core.resolutionselector.ResolutionStrategy
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.core.content.ContextCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.LifecycleRegistry
import com.google.android.gms.tasks.Tasks
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.face.Face
import com.google.mlkit.vision.face.FaceDetection
import com.google.mlkit.vision.face.FaceDetector
import com.google.mlkit.vision.face.FaceDetectorOptions
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.Promise
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView
import java.io.File
import java.lang.ref.WeakReference
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.math.abs
import kotlin.math.max

private const val TAG = "AuraCamara"

/**
 * LA CÁMARA EN VIVO DE AU-RA (Android): CameraX con la vista previa + un análisis de cuadros con ML Kit
 * en modo flujo y SEGUIMIENTO (`enableTracking`: cada persona conserva su `trackingId` mientras se la ve).
 *
 * Por qué así (y no vision-camera): en 4.1.0 vision-camera + worklets-core cerraba la app al montar la
 * mesa (runtime JSI de worklets incompatible con la arquitectura nueva de RN 0.81; ver 0602318). Aquí no
 * hay worklets ni JSI propio: todo el trabajo va en un hilo de Kotlin y a JS solo llegan eventos chicos.
 *
 *  · Análisis: YUV ~640×480 (lado corto `ladoCorto`), STRATEGY_KEEP_ONLY_LATEST, a lo sumo `fps` cuadros
 *    por segundo, en un hilo propio. ML Kit rápido, sin puntos ni contornos, con clasificación (sonrisa,
 *    ojos) y seguimiento.
 *  · Evento `onCaras` a lo sumo `hz` veces por segundo y solo si algo cambió de verdad (o un latido cada
 *    500 ms con caras, 1 s sin caras): por cara `id` (trackingId), `caja` en fracciones de la VISTA TAL
 *    COMO SE VE (giro y espejo de la frontal ya resueltos aquí: JS dibuja directo), `foto` en fracciones
 *    del cuadro derecho SIN espejo (para la escena), los ángulos, sonrisa y ojos. `w/h` la vista en px,
 *    `iw/ih` el cuadro derecho, `ms` lo que tardó ML Kit, `fps` los cuadros analizados por segundo.
 *  · `onEstado`: { tipo: 'lista' | 'error' | 'detenida', motivo? }. Sin permiso de cámara: un error, nunca
 *    un cierre.
 *  · Ciclo de vida propio: la cámara corre solo con la vista pegada a la ventana, `activa` y la actividad
 *    en primer plano; al destruirse la vista se suelta todo.
 */
@SuppressLint("ViewConstructor")
class AuraCamaraView(context: Context, appContext: AppContext) : ExpoView(context, appContext), LifecycleOwner {
  companion object {
    /** La vista montada (para `recorte` y `foto` del módulo). Solo una a la vez en la mesa. */
    @Volatile
    var actual: WeakReference<AuraCamaraView>? = null
  }

  private val onCaras by EventDispatcher()
  private val onEstado by EventDispatcher()

  private val registro = LifecycleRegistry(this)
  override val lifecycle: Lifecycle
    get() = registro

  private val previa = PreviewView(context).apply {
    // TextureView: respeta la opacidad, el recorte y los bordes redondeados de React Native (SurfaceView no).
    implementationMode = PreviewView.ImplementationMode.COMPATIBLE
    scaleType = PreviewView.ScaleType.FILL_CENTER
    elevation = 0f
  }

  // ---- props
  private var lado = "frontal"
  private var activa = true
  private var hz = 15.0
  private var fpsMax = 15.0
  private var ladoCorto = 480
  private var minCara = 0.08f
  private var necesitaRearmar = true

  // ---- estado de la cámara (hilo principal)
  private var proveedor: ProcessCameraProvider? = null
  private var camara: Camera? = null
  private var casos: List<UseCase> = emptyList()
  private var analisis: ImageAnalysis? = null
  private var captura: ImageCapture? = null
  private var destruida = false
  private var pegada = false
  private var actividadObservada: Lifecycle? = null
  private var errorAvisado: String? = null
  private var estadoObservado: androidx.lifecycle.LiveData<CameraState>? = null
  /** La cámara corriendo (se lee desde otros hilos; el ciclo de vida solo se toca en el principal). */
  @Volatile private var corriendo = false

  // ---- análisis (hilo propio)
  private val ejecutor: ExecutorService = Executors.newSingleThreadExecutor { r -> Thread(r, "AuraCamara").apply { isDaemon = true } }
  private var detector: FaceDetector? = null
  private var minCaraDetector = -1f
  private val almacen = AlmacenCuadros()
  private val analizando = AtomicBoolean(false)
  @Volatile private var ultimoAnalisis = 0L
  @Volatile private var ultimaEmision = 0L
  @Volatile private var anterior: List<Map<String, Any>> = emptyList()
  @Volatile private var fallosSeguidos = 0
  @Volatile private var vistaW = 0
  @Volatile private var vistaH = 0
  @Volatile private var espejo = true
  private var cuadrosVentana = 0
  private var inicioVentana = 0L
  @Volatile private var fpsMedido = 0.0

  private val alActividad = LifecycleEventObserver { _, _ -> actualizarCiclo() }

  private val alPantalla = object : DisplayManager.DisplayListener {
    override fun onDisplayAdded(displayId: Int) = Unit
    override fun onDisplayRemoved(displayId: Int) = Unit
    override fun onDisplayChanged(displayId: Int) {
      try {
        val d = previa.display ?: return
        if (d.displayId != displayId) return
        analisis?.targetRotation = d.rotation
        captura?.targetRotation = d.rotation
      } catch (_: Throwable) {
      }
    }
  }

  init {
    // LifecycleRegistry solo se toca en el hilo principal (si no, lanza): React Native crea las vistas ahí,
    // pero si alguna vez no, se pasa al principal en vez de cerrar la app.
    enPrincipal {
      if (!destruida && registro.currentState == Lifecycle.State.INITIALIZED) registro.currentState = Lifecycle.State.CREATED
    }
    previa.setOnHierarchyChangeListener(object : OnHierarchyChangeListener {
      override fun onChildViewRemoved(parent: View?, child: View?) = Unit
      override fun onChildViewAdded(parent: View?, child: View?) {
        parent?.measure(
          MeasureSpec.makeMeasureSpec(measuredWidth, MeasureSpec.EXACTLY),
          MeasureSpec.makeMeasureSpec(measuredHeight, MeasureSpec.EXACTLY)
        )
        parent?.layout(0, 0, parent.measuredWidth, parent.measuredHeight)
      }
    })
    addView(previa, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
  }

  private fun enPrincipal(f: () -> Unit) {
    try {
      if (Looper.myLooper() == Looper.getMainLooper()) f() else Handler(Looper.getMainLooper()).post {
        try {
          f()
        } catch (_: Throwable) {
        }
      }
    } catch (_: Throwable) {
    }
  }

  // ---------------------------------------------------------------- diseño (React Native no lo hace por nosotros)

  override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
    measureChild(previa, widthMeasureSpec, heightMeasureSpec)
    setMeasuredDimension(
      ViewGroup.resolveSize(previa.measuredWidth, widthMeasureSpec),
      ViewGroup.resolveSize(previa.measuredHeight, heightMeasureSpec)
    )
  }

  override fun onLayout(changed: Boolean, left: Int, top: Int, right: Int, bottom: Int) {
    val w = right - left
    val h = bottom - top
    if (w != vistaW || h != vistaH) {
      previa.layout(0, 0, w, h)
      vistaW = w
      vistaH = h
    }
  }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    pegada = true
    actual = WeakReference(this)
    try {
      (context.getSystemService(Context.DISPLAY_SERVICE) as? DisplayManager)?.registerDisplayListener(alPantalla, null)
    } catch (_: Throwable) {
    }
    observarActividad()
    actualizarCiclo()
  }

  override fun onDetachedFromWindow() {
    pegada = false
    try {
      (context.getSystemService(Context.DISPLAY_SERVICE) as? DisplayManager)?.unregisterDisplayListener(alPantalla)
    } catch (_: Throwable) {
    }
    actualizarCiclo()
    super.onDetachedFromWindow()
  }

  // ---------------------------------------------------------------- props

  fun ponerLado(v: String?) {
    val nuevo = if (v == "trasera") "trasera" else "frontal"
    if (nuevo != lado) {
      lado = nuevo
      necesitaRearmar = true
    }
  }

  fun ponerActiva(v: Boolean?) {
    activa = v ?: true
  }

  fun ponerHz(v: Double?) {
    hz = (v ?: 15.0).coerceIn(1.0, 30.0)
  }

  fun ponerFps(v: Double?) {
    fpsMax = (v ?: 15.0).coerceIn(1.0, 30.0)
  }

  fun ponerLadoCorto(v: Int?) {
    val n = (v ?: 480).coerceIn(240, 1080)
    if (n != ladoCorto) {
      ladoCorto = n
      necesitaRearmar = true
    }
  }

  fun ponerMinCara(v: Double?) {
    minCara = (v ?: 0.08).toFloat().coerceIn(0.03f, 0.5f)
  }

  /** Después de cada tanda de props. */
  fun aplicar() {
    actualizarCiclo()
  }

  // ---------------------------------------------------------------- ciclo de vida

  private fun observarActividad() {
    try {
      val act = appContext.currentActivity as? LifecycleOwner ?: return
      val lc = act.lifecycle
      if (actividadObservada === lc) return
      actividadObservada?.removeObserver(alActividad)
      lc.addObserver(alActividad)
      actividadObservada = lc
    } catch (_: Throwable) {
    }
  }

  private fun actividadAlFrente(): Boolean {
    val lc = actividadObservada ?: return true
    return lc.currentState.isAtLeast(Lifecycle.State.RESUMED)
  }

  /** Lleva el ciclo propio al estado que toca y arma la cámara si hace falta. Siempre en el hilo principal. */
  private fun actualizarCiclo() {
    if (destruida) return
    try {
      val corre = pegada && activa && actividadAlFrente()
      if (corre) {
        if (!tienePermiso()) {
          registro.currentState = Lifecycle.State.CREATED
          corriendo = false
          avisarError("sin-permiso", "sin permiso de cámara")
          return
        }
        registro.currentState = Lifecycle.State.RESUMED
        corriendo = true
        if (necesitaRearmar || camara == null) armar()
      } else if (registro.currentState.isAtLeast(Lifecycle.State.STARTED)) {
        registro.currentState = Lifecycle.State.CREATED
        corriendo = false
        emitirEstado(mapOf("tipo" to "detenida"))
      }
    } catch (t: Throwable) {
      avisarError("ciclo", t.message ?: t.toString())
    }
  }

  private fun tienePermiso(): Boolean =
    try {
      ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED
    } catch (_: Throwable) {
      false
    }

  /** Pidiendo el ProcessCameraProvider (la primera vez tarda): no se pide dos veces. */
  private var pidiendoProveedor = false

  private fun armar() {
    val p = proveedor
    if (p != null) {
      necesitaRearmar = false
      return enlazar(p)
    }
    if (pidiendoProveedor) return
    pidiendoProveedor = true
    try {
      val futuro = ProcessCameraProvider.getInstance(context)
      futuro.addListener({
        pidiendoProveedor = false
        try {
          if (destruida) return@addListener
          val prov = futuro.get()
          proveedor = prov
          necesitaRearmar = false
          // Pudo cambiar todo mientras tanto (segundo plano, `activa`): se enlaza solo si sigue tocando.
          if (corriendo) enlazar(prov)
        } catch (t: Throwable) {
          avisarError("proveedor", t.message ?: t.toString())
        }
      }, ContextCompat.getMainExecutor(context))
    } catch (t: Throwable) {
      pidiendoProveedor = false
      avisarError("proveedor", t.message ?: t.toString())
    }
  }

  private fun selectorDeResolucion(ancho: Int, alto: Int): ResolutionSelector =
    ResolutionSelector.Builder()
      .setAspectRatioStrategy(AspectRatioStrategy.RATIO_4_3_FALLBACK_AUTO_STRATEGY)
      .setResolutionStrategy(ResolutionStrategy(Size(ancho, alto), ResolutionStrategy.FALLBACK_RULE_CLOSEST_HIGHER_THEN_LOWER))
      .build()

  /** Une la vista previa, el análisis y la cámara de fotos a ESTE ciclo de vida. */
  @SuppressLint("UnsafeOptInUsageError")
  private fun enlazar(p: ProcessCameraProvider) {
    if (destruida) return
    try {
      if (casos.isNotEmpty()) p.unbind(*casos.toTypedArray())
    } catch (_: Throwable) {
    }
    casos = emptyList()
    camara = null
    analisis?.clearAnalyzer()
    analisis = null
    captura = null
    almacen.vaciar()
    anterior = emptyList()

    val frontal = lado != "trasera"
    espejo = frontal
    val selector = if (frontal) CameraSelector.DEFAULT_FRONT_CAMERA else CameraSelector.DEFAULT_BACK_CAMERA
    try {
      if (!p.hasCamera(selector)) {
        avisarError("sin-camara", if (frontal) "el teléfono no tiene cámara frontal" else "el teléfono no tiene cámara trasera")
        return
      }
    } catch (_: Throwable) {
    }
    val rot = try {
      previa.display?.rotation ?: android.view.Surface.ROTATION_0
    } catch (_: Throwable) {
      android.view.Surface.ROTATION_0
    }
    val corto = ladoCorto
    val largo = corto * 4 / 3

    val vistaPrevia = Preview.Builder()
      .setResolutionSelector(
        ResolutionSelector.Builder().setAspectRatioStrategy(AspectRatioStrategy.RATIO_4_3_FALLBACK_AUTO_STRATEGY).build()
      )
      .build()
      .also { it.surfaceProvider = previa.surfaceProvider }

    val an = ImageAnalysis.Builder()
      .setResolutionSelector(selectorDeResolucion(largo, corto))
      .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
      .setOutputImageFormat(ImageAnalysis.OUTPUT_IMAGE_FORMAT_YUV_420_888)
      .setTargetRotation(rot)
      .build()
    an.setAnalyzer(ejecutor) { img -> analizar(img) }

    val cap = ImageCapture.Builder()
      .setCaptureMode(ImageCapture.CAPTURE_MODE_MINIMIZE_LATENCY)
      .setResolutionSelector(selectorDeResolucion(1280, 960))
      .setTargetRotation(rot)
      .build()

    // Con la cámara de fotos si el teléfono la admite junto a las otras dos; si no, sin ella (`foto` usa el cuadro).
    val intentos = listOf(listOf(vistaPrevia, an, cap), listOf(vistaPrevia, an))
    var ultimo: Throwable? = null
    for (lista in intentos) {
      try {
        val cam = p.bindToLifecycle(this, selector, *lista.toTypedArray())
        camara = cam
        casos = lista
        analisis = an
        captura = if (lista.contains(cap)) cap else null
        observarEstado(cam)
        errorAvisado = null
        return
      } catch (t: Throwable) {
        ultimo = t
        try {
          p.unbind(*lista.toTypedArray())
        } catch (_: Throwable) {
        }
      }
    }
    an.clearAnalyzer()
    avisarError("enlazar", ultimo?.message ?: "no se pudo abrir la cámara")
  }

  private fun observarEstado(cam: Camera) {
    try {
      estadoObservado?.removeObservers(this)
      val vivo = cam.cameraInfo.cameraState
      estadoObservado = vivo
      vivo.observe(this) { estado ->
        when {
          estado.error != null -> {
            val e = estado.error!!
            val motivo = when (e.code) {
              CameraState.ERROR_CAMERA_IN_USE -> "otra app usa la cámara"
              CameraState.ERROR_MAX_CAMERAS_IN_USE -> "demasiadas cámaras abiertas"
              CameraState.ERROR_CAMERA_DISABLED -> "la cámara está desactivada"
              CameraState.ERROR_CAMERA_FATAL_ERROR -> "la cámara falló"
              CameraState.ERROR_DO_NOT_DISTURB_MODE_ENABLED -> "modo no molestar"
              CameraState.ERROR_STREAM_CONFIG -> "configuración no admitida"
              else -> "error de cámara ${e.code}"
            }
            avisarError("estado-${e.code}", motivo)
          }
          estado.type == CameraState.Type.OPEN -> {
            errorAvisado = null
            emitirEstado(mapOf("tipo" to "lista", "lado" to lado, "fotos" to (captura != null)))
          }
          else -> Unit
        }
      }
    } catch (_: Throwable) {
    }
  }

  // ---------------------------------------------------------------- análisis (hilo AuraCamara)

  private fun detectorPara(min: Float): FaceDetector {
    val d = detector
    if (d != null && minCaraDetector == min) return d
    try {
      d?.close()
    } catch (_: Throwable) {
    }
    val opciones = FaceDetectorOptions.Builder()
      .setPerformanceMode(FaceDetectorOptions.PERFORMANCE_MODE_FAST)
      .setLandmarkMode(FaceDetectorOptions.LANDMARK_MODE_NONE)
      .setContourMode(FaceDetectorOptions.CONTOUR_MODE_NONE)
      .setClassificationMode(FaceDetectorOptions.CLASSIFICATION_MODE_ALL)
      .setMinFaceSize(min)
      .enableTracking()
      .build()
    val nuevo = FaceDetection.getClient(opciones)
    detector = nuevo
    minCaraDetector = min
    return nuevo
  }

  @OptIn(ExperimentalGetImage::class)
  private fun analizar(img: ImageProxy) {
    try {
      if (destruida) return
      val ahora = SystemClock.elapsedRealtime()
      if (ahora - ultimoAnalisis < (1000.0 / fpsMax).toLong()) return
      ultimoAnalisis = ahora
      val media = img.image ?: return
      val rot = img.imageInfo.rotationDegrees
      val t0 = SystemClock.elapsedRealtime()
      val caras: List<Face> = Tasks.await(detectorPara(minCara).process(InputImage.fromMediaImage(media, rot)), 3, TimeUnit.SECONDS)
      val ms = SystemClock.elapsedRealtime() - t0
      fallosSeguidos = 0
      val derecho = rot % 180 == 0
      val iw = if (derecho) img.width else img.height
      val ih = if (derecho) img.height else img.width
      val lista = caras.mapIndexed { i, c ->
        val b = c.boundingBox
        CaraCuadro(c.trackingId ?: -(i + 1), b.left.toFloat(), b.top.toFloat(), b.width().toFloat(), b.height().toFloat())
      }
      val cuando = System.currentTimeMillis()
      almacen.guardar(img, rot, lista, cuando)
      contarCuadro(ahora)
      emitirSiCambio(caras, lista, iw, ih, ms, cuando)
    } catch (t: Throwable) {
      fallosSeguidos += 1
      if (fallosSeguidos == 5) avisarError("detector", "ML Kit no responde: ${t.message ?: t}")
    } finally {
      try {
        img.close()
      } catch (_: Throwable) {
      }
    }
  }

  private fun contarCuadro(ahora: Long) {
    if (inicioVentana == 0L) inicioVentana = ahora
    cuadrosVentana += 1
    val pasado = ahora - inicioVentana
    if (pasado >= 2000) {
      fpsMedido = cuadrosVentana * 1000.0 / pasado
      cuadrosVentana = 0
      inicioVentana = ahora
    }
  }

  private fun r3(v: Float): Double = Math.round(v * 1000.0) / 1000.0
  private fun r1(v: Float): Double = Math.round(v * 10.0) / 10.0

  private fun emitirSiCambio(caras: List<Face>, lista: List<CaraCuadro>, iw: Int, ih: Int, ms: Long, cuando: Long) {
    val vw = vistaW
    val vh = vistaH
    val salida = ArrayList<Map<String, Any>>(caras.size)
    for (i in caras.indices) {
      val c = caras[i]
      val k = lista[i]
      val fx = k.x / iw
      val fy = k.y / ih
      val fw = k.w / iw
      val fh = k.h / ih
      val v = Geometria.aVista(fx, fy, fw, fh, iw, ih, vw, vh, espejo)
      val ojoI = c.leftEyeOpenProbability ?: -1f
      val ojoD = c.rightEyeOpenProbability ?: -1f
      val ojos = if (ojoI >= 0f && ojoD >= 0f) (ojoI + ojoD) / 2f else max(ojoI, ojoD)
      val m = HashMap<String, Any>(12)
      m["id"] = k.id
      m["foto"] = mapOf("x" to r3(fx), "y" to r3(fy), "w" to r3(fw), "h" to r3(fh))
      if (v != null) m["caja"] = mapOf("x" to r3(v[0]), "y" to r3(v[1]), "w" to r3(v[2]), "h" to r3(v[3]))
      m["yaw"] = r1(c.headEulerAngleY)
      m["pitch"] = r1(c.headEulerAngleX)
      m["roll"] = r1(c.headEulerAngleZ)
      m["sonrisa"] = r3(c.smilingProbability ?: -1f)
      m["ojos"] = r3(ojos)
      m["ojoI"] = r3(ojoI)
      m["ojoD"] = r3(ojoD)
      salida.add(m)
    }
    val ahora = SystemClock.elapsedRealtime()
    val desde = ahora - ultimaEmision
    val minimo = (1000.0 / hz).toLong()
    if (desde < minimo) return
    val latido = if (salida.isEmpty()) 1000L else 500L
    if (desde < latido && !cambio(anterior, salida)) return
    ultimaEmision = ahora
    anterior = salida
    val evento = HashMap<String, Any>(10)
    evento["caras"] = salida
    evento["w"] = vw
    evento["h"] = vh
    evento["iw"] = iw
    evento["ih"] = ih
    evento["ms"] = ms
    evento["fps"] = Math.round(fpsMedido * 10.0) / 10.0
    evento["ts"] = cuando.toDouble()
    evento["lado"] = lado
    evento["espejo"] = espejo
    post {
      try {
        if (!destruida) onCaras(evento)
      } catch (_: Throwable) {
      }
    }
  }

  /** ¿Cambió algo que se note? Otras personas, una caja que se movió ≥1 % o creció ≥3 %, giro ≥3°, gestos ≥0,1. */
  private fun cambio(a: List<Map<String, Any>>, b: List<Map<String, Any>>): Boolean {
    if (a.size != b.size) return true
    for (i in b.indices) {
      val x = a[i]
      val y = b[i]
      if (x["id"] != y["id"]) return true
      @Suppress("UNCHECKED_CAST")
      val fa = x["foto"] as Map<String, Double>
      @Suppress("UNCHECKED_CAST")
      val fb = y["foto"] as Map<String, Double>
      if (abs(fa["x"]!! - fb["x"]!!) >= 0.01 || abs(fa["y"]!! - fb["y"]!!) >= 0.01) return true
      if (abs(fa["h"]!! - fb["h"]!!) >= 0.03 * max(fa["h"]!!, 0.01)) return true
      for (k in arrayOf("yaw", "pitch")) if (abs((x[k] as Double) - (y[k] as Double)) >= 3.0) return true
      for (k in arrayOf("sonrisa", "ojos")) if (abs((x[k] as Double) - (y[k] as Double)) >= 0.1) return true
    }
    return false
  }

  // ---------------------------------------------------------------- recortes y fotos (los pide el módulo)

  /** Un recorte de la cara `id` del último cuadro (sin espejo, derecho), o null. */
  fun recorte(id: Int, margen: Double, ladoPx: Int, calidad: Int, comoArchivo: Boolean, carpeta: File): Map<String, Any?>? {
    val r = almacen.recorte(id, margen.toFloat(), ladoPx.coerceIn(64, 640), calidad) ?: return null
    val m = salida(r.jpeg, comoArchivo, carpeta, "rec")
    m["w"] = r.w
    m["h"] = r.h
    m["ts"] = r.ts.toDouble()
    r.caja?.let { m["caja"] = mapOf("x" to it[0].toDouble(), "y" to it[1].toDouble(), "w" to it[2].toDouble(), "h" to it[3].toDouble()) }
    r.tam?.let { m["tam"] = it.toDouble() }
    return m
  }

  /** La foto entera: con la cámara de fotos si `alta` y la hay (1280×960 aprox.), si no el último cuadro. */
  fun foto(calidad: Int, alta: Boolean, comoArchivo: Boolean, carpeta: File, promesa: Promise) {
    val desdeCuadro = {
      try {
        val r = almacen.foto(calidad)
        if (r == null) promesa.resolve(null)
        else {
          val m = salida(r.jpeg, comoArchivo, carpeta, "foto")
          m["w"] = r.w
          m["h"] = r.h
          m["origen"] = "cuadro"
          promesa.resolve(m)
        }
      } catch (t: Throwable) {
        promesa.resolve(null)
      }
    }
    val cap = captura
    if (!alta || cap == null || !corriendo) {
      try {
        ejecutor.execute { desdeCuadro() }
      } catch (_: Throwable) {
        promesa.resolve(null)
      }
      return
    }
    try {
      cap.takePicture(ejecutor, object : ImageCapture.OnImageCapturedCallback() {
        override fun onCaptureSuccess(image: ImageProxy) {
          try {
            val buf = image.planes[0].buffer
            val bytes = ByteArray(buf.remaining())
            buf.get(bytes)
            val giro = image.imageInfo.rotationDegrees
            image.close()
            val b = AlmacenCuadros.derecho(bytes, giro)
            if (b == null) return desdeCuadro()
            try {
              val m = salida(AlmacenCuadros.comprimir(b, calidad), comoArchivo, carpeta, "foto")
              m["w"] = b.width
              m["h"] = b.height
              m["origen"] = "captura"
              promesa.resolve(m)
            } finally {
              b.recycle()
            }
          } catch (t: Throwable) {
            try {
              image.close()
            } catch (_: Throwable) {
            }
            desdeCuadro()
          }
        }

        override fun onError(exception: ImageCaptureException) {
          desdeCuadro()
        }
      })
    } catch (t: Throwable) {
      try {
        ejecutor.execute { desdeCuadro() }
      } catch (_: Throwable) {
        promesa.resolve(null)
      }
    }
  }

  private fun salida(jpeg: ByteArray, comoArchivo: Boolean, carpeta: File, prefijo: String): HashMap<String, Any?> {
    val m = HashMap<String, Any?>()
    if (comoArchivo) {
      val dir = File(carpeta, "aura-camara").apply { mkdirs() }
      val f = File(dir, "$prefijo-${System.currentTimeMillis()}-${(Math.random() * 1e6).toInt()}.jpg")
      f.writeBytes(jpeg)
      m["uri"] = "file://" + f.absolutePath
    } else {
      m["b64"] = Base64.encodeToString(jpeg, Base64.NO_WRAP)
    }
    m["bytes"] = jpeg.size
    return m
  }

  // ---------------------------------------------------------------- avisos y limpieza

  private fun emitirEstado(m: Map<String, Any>) {
    post {
      try {
        if (!destruida) onEstado(m)
      } catch (_: Throwable) {
      }
    }
  }

  private fun avisarError(codigo: String, motivo: String) {
    Log.w(TAG, "$codigo: $motivo")
    if (errorAvisado == codigo) return
    errorAvisado = codigo
    emitirEstado(mapOf("tipo" to "error", "codigo" to codigo, "motivo" to motivo.take(200)))
  }

  /** La vista se va para siempre: se suelta la cámara, el detector y el hilo. */
  fun liberar() {
    if (destruida) return
    destruida = true
    corriendo = false
    try {
      estadoObservado?.removeObservers(this)
    } catch (_: Throwable) {
    }
    try {
      analisis?.clearAnalyzer()
    } catch (_: Throwable) {
    }
    try {
      val p = proveedor
      if (p != null && casos.isNotEmpty()) p.unbind(*casos.toTypedArray())
    } catch (_: Throwable) {
    }
    casos = emptyList()
    camara = null
    enPrincipal {
      if (registro.currentState != Lifecycle.State.INITIALIZED) registro.currentState = Lifecycle.State.DESTROYED
    }
    try {
      actividadObservada?.removeObserver(alActividad)
    } catch (_: Throwable) {
    }
    actividadObservada = null
    try {
      (context.getSystemService(Context.DISPLAY_SERVICE) as? DisplayManager)?.unregisterDisplayListener(alPantalla)
    } catch (_: Throwable) {
    }
    if (actual?.get() === this) actual = null
    try {
      ejecutor.execute {
        try {
          detector?.close()
        } catch (_: Throwable) {
        }
        detector = null
        almacen.vaciar()
      }
      ejecutor.shutdown()
    } catch (_: Throwable) {
    }
  }
}
