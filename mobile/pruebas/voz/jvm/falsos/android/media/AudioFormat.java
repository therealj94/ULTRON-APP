package android.media;

/** De mentira (pruebas/voz/jvm): solo lo que usa Reproductor.kt. */
public class AudioFormat {
  public static final int ENCODING_PCM_16BIT = 2;
  public static final int CHANNEL_OUT_MONO = 4;
  public final int hz;

  AudioFormat(int hz) {
    this.hz = hz;
  }

  public static class Builder {
    private int hz = 22050;

    public Builder setEncoding(int e) {
      return this;
    }

    public Builder setSampleRate(int h) {
      hz = h;
      return this;
    }

    public Builder setChannelMask(int m) {
      return this;
    }

    public AudioFormat build() {
      return new AudioFormat(hz);
    }
  }
}
