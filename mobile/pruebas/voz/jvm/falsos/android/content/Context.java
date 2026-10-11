package android.content;

/** De mentira (pruebas/voz/jvm): la prueba lo extiende para darle al reproductor un AudioManager de mentira (el foco). */
public abstract class Context {
  public static final String AUDIO_SERVICE = "audio";

  public abstract Object getSystemService(String nombre);
}
