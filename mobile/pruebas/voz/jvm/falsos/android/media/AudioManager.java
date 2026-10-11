package android.media;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/**
 * De mentira (pruebas/voz/jvm): el foco de audio. `resultado` es lo que contesta requestAudioFocus (por omisión,
 * concedido); anota cada pedido y cada vez que se suelta, y deja mandar avisos de foco al último pedido (`avisar`), como
 * haría el sistema al entrar una llamada o al volver.
 */
public class AudioManager {
  public static final int AUDIOFOCUS_GAIN = 1;
  public static final int AUDIOFOCUS_GAIN_TRANSIENT = 2;
  public static final int AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK = 3;
  public static final int AUDIOFOCUS_LOSS = -1;
  public static final int AUDIOFOCUS_LOSS_TRANSIENT = -2;
  public static final int AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK = -3;
  public static final int AUDIOFOCUS_REQUEST_FAILED = 0;
  public static final int AUDIOFOCUS_REQUEST_GRANTED = 1;
  public static final int AUDIOFOCUS_REQUEST_DELAYED = 2;

  public interface OnAudioFocusChangeListener {
    void onAudioFocusChange(int cambio);
  }

  public volatile int resultado = AUDIOFOCUS_REQUEST_GRANTED;
  public final List<AudioFocusRequest> pedidos = Collections.synchronizedList(new ArrayList<>());
  public final List<AudioFocusRequest> soltados = Collections.synchronizedList(new ArrayList<>());

  public int requestAudioFocus(AudioFocusRequest r) {
    pedidos.add(r);
    return resultado;
  }

  public int abandonAudioFocusRequest(AudioFocusRequest r) {
    soltados.add(r);
    return AUDIOFOCUS_REQUEST_GRANTED;
  }

  /** El sistema avisa al último pedido (aunque ya se haya soltado: el reproductor tiene que ignorarlo). */
  public void avisar(int cambio) {
    AudioFocusRequest r;
    synchronized (pedidos) {
      if (pedidos.isEmpty()) return;
      r = pedidos.get(pedidos.size() - 1);
    }
    avisar(r, cambio);
  }

  public void avisar(AudioFocusRequest r, int cambio) {
    if (r.oyente != null) r.oyente.onAudioFocusChange(cambio);
  }
}
