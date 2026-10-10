package __PAQUETE__.asistente

import android.annotation.SuppressLint
import android.app.PendingIntent
import android.os.Build
import android.service.quicksettings.Tile
import android.service.quicksettings.TileService
import __PAQUETE__.R

/**
 * EL MOSAICO «HABLAR CON AURA» DE AJUSTES RÁPIDOS (bajar la cortina → editar → arrastrarlo).
 *
 * Abre la burbuja como el botón lateral, con `origen=mosaico`. Con el teléfono bloqueado pide desbloquear antes
 * (`unlockAndRun`): la misma decisión de privacidad que la burbuja sin showWhenLocked.
 *
 * Desde Android 14 (API 34) `startActivityAndCollapse` solo acepta un PendingIntent (con un Intent lanza
 * UnsupportedOperationException); antes, el Intent de siempre.
 */
class MosaicoAura : TileService() {
  override fun onStartListening() {
    super.onStartListening()
    qsTile?.let {
      it.state = Tile.STATE_INACTIVE
      it.label = getString(R.string.aura_hablar)
      it.updateTile()
    }
  }

  override fun onClick() {
    super.onClick()
    if (isLocked) unlockAndRun { abrir() } else abrir()
  }

  @SuppressLint("StartActivityAndCollapseDeprecated")
  private fun abrir() {
    val intento = Invocacion.burbuja(this, Invocacion.MOSAICO)
    if (Build.VERSION.SDK_INT >= 34) {
      val pendiente = PendingIntent.getActivity(this, 0, intento, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
      startActivityAndCollapse(pendiente)
    } else {
      @Suppress("DEPRECATION")
      startActivityAndCollapse(intento)
    }
  }
}
