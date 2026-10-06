package android.content;

/** De mentira (pruebas/voz/jvm): el reproductor de la prueba no tiene contexto (sin foco de audio). */
public abstract class Context {
  public static final String AUDIO_SERVICE = "audio";

  public abstract Object getSystemService(String nombre);
}
