package android.media;

/** De mentira (pruebas/voz/jvm). */
public class AudioFocusRequest {
  public static class Builder {
    public Builder(int foco) {}

    public Builder setAudioAttributes(AudioAttributes a) {
      return this;
    }

    public Builder setOnAudioFocusChangeListener(AudioManager.OnAudioFocusChangeListener l) {
      return this;
    }

    public AudioFocusRequest build() {
      return new AudioFocusRequest();
    }
  }
}
