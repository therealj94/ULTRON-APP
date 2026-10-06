package android.media;

/** De mentira (pruebas/voz/jvm). */
public class AudioManager {
  public static final int AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK = 3;

  public interface OnAudioFocusChangeListener {
    void onAudioFocusChange(int cambio);
  }

  public int requestAudioFocus(AudioFocusRequest r) {
    return 1;
  }

  public int abandonAudioFocusRequest(AudioFocusRequest r) {
    return 1;
  }
}
