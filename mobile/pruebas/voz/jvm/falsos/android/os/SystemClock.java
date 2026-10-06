package android.os;

/** De mentira (pruebas/voz/jvm). */
public class SystemClock {
  public static long elapsedRealtime() {
    return System.nanoTime() / 1_000_000L;
  }
}
