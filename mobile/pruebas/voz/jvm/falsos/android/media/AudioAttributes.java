package android.media;

/** De mentira (pruebas/voz/jvm): anota con qué atributos se abrió la pista. */
public class AudioAttributes {
  public static final int USAGE_MEDIA = 1;
  public static final int USAGE_VOICE_COMMUNICATION = 2;
  public static final int CONTENT_TYPE_SPEECH = 1;
  public final int uso;
  public final int contenido;

  AudioAttributes(int uso, int contenido) {
    this.uso = uso;
    this.contenido = contenido;
  }

  public static class Builder {
    private int uso;
    private int contenido;

    public Builder setUsage(int u) {
      uso = u;
      return this;
    }

    public Builder setContentType(int c) {
      contenido = c;
      return this;
    }

    public AudioAttributes build() {
      return new AudioAttributes(uso, contenido);
    }
  }
}
