package android.media;

/** De mentira (pruebas/voz/jvm): guarda lo que se le pidió (el oyente, para mandarle avisos de foco). */
public class AudioFocusRequest {
  public final int foco;
  public final boolean pausaAlAgachar;
  public final AudioManager.OnAudioFocusChangeListener oyente;

  AudioFocusRequest(int foco, boolean pausaAlAgachar, AudioManager.OnAudioFocusChangeListener oyente) {
    this.foco = foco;
    this.pausaAlAgachar = pausaAlAgachar;
    this.oyente = oyente;
  }

  public static class Builder {
    private final int foco;
    private boolean pausaAlAgachar;
    private AudioManager.OnAudioFocusChangeListener oyente;

    public Builder(int foco) {
      this.foco = foco;
    }

    public Builder setAudioAttributes(AudioAttributes a) {
      return this;
    }

    public Builder setWillPauseWhenDucked(boolean b) {
      pausaAlAgachar = b;
      return this;
    }

    public Builder setOnAudioFocusChangeListener(AudioManager.OnAudioFocusChangeListener l) {
      oyente = l;
      return this;
    }

    public AudioFocusRequest build() {
      return new AudioFocusRequest(foco, pausaAlAgachar, oyente);
    }
  }
}
