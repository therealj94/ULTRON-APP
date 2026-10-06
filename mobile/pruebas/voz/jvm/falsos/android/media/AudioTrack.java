package android.media;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/**
 * AudioTrack de mentira para correr Reproductor.kt en la JVM (pruebas/voz/jvm). Se porta como el de Android en
 * MODE_STREAM en lo que importa: búfer de `capacidad` cuadros; write NO bloqueante acepta lo que cabe; la pista
 * arranca cuando lo escrito llega al umbral (por omisión, el búfer lleno; setStartThresholdInFrames lo baja) o al
 * llamar stop(); la cabeza avanza `hz` cuadros por segundo sin pasar de lo escrito (si falta, se queda quieta:
 * underrun); stop() deja sonar lo que queda; pause()+flush() calla y tira lo escrito.
 */
public class AudioTrack {
  public static final int MODE_STREAM = 1;
  public static final int WRITE_BLOCKING = 0;
  public static final int WRITE_NON_BLOCKING = 1;
  public static final int STATE_INITIALIZED = 1;
  public static final int PLAYSTATE_STOPPED = 1;
  public static final int PLAYSTATE_PAUSED = 2;
  public static final int PLAYSTATE_PLAYING = 3;
  public static final int ERROR_INVALID_OPERATION = -3;

  /** Para las pruebas: las pistas creadas, en orden. */
  public static final List<AudioTrack> creadas = Collections.synchronizedList(new ArrayList<>());
  /** Algunos teléfonos ponen la cabeza en 0 al terminar de drenar. */
  public static volatile boolean cabezaACeroAlDrenar = false;

  public final int hz;
  public final int capacidad;
  private int umbral;
  private long escritos;
  private double cabeza;
  private long ultimoNs = System.nanoTime();
  private boolean tocando;
  private boolean arrancada;
  private boolean parada;
  private boolean pausada;
  public volatile boolean liberada;
  public long maxEscritos;

  AudioTrack(int hz, int bytes) {
    this.hz = hz;
    this.capacidad = bytes / 2;
    this.umbral = capacidad;
  }

  public static int getMinBufferSize(int hz, int canal, int codificacion) {
    return 2048;
  }

  public int getState() {
    return STATE_INITIALIZED;
  }

  public int getBufferSizeInFrames() {
    return capacidad;
  }

  public synchronized int setStartThresholdInFrames(int n) {
    umbral = Math.max(1, Math.min(capacidad, n));
    return umbral;
  }

  private void avanzar() {
    long ahora = System.nanoTime();
    if (tocando && arrancada && !pausada) cabeza = Math.min(escritos, cabeza + (ahora - ultimoNs) / 1e9 * hz);
    ultimoNs = ahora;
    if (tocando && !pausada && !arrancada && escritos > 0 && (escritos >= umbral || parada)) arrancada = true;
  }

  public synchronized void play() {
    avanzar();
    tocando = true;
    pausada = false;
    parada = false;
  }

  public synchronized int write(byte[] b, int off, int n, int modo) {
    if (liberada || parada) return ERROR_INVALID_OPERATION;
    avanzar();
    long libres = capacidad - (escritos - (long) cabeza);
    int cuadros = (int) Math.max(0, Math.min(libres, n / 2));
    escritos += cuadros;
    maxEscritos = Math.max(maxEscritos, escritos);
    avanzar();
    return cuadros * 2;
  }

  public synchronized int getPlaybackHeadPosition() {
    avanzar();
    if (parada && cabezaACeroAlDrenar && cabeza >= escritos) return 0;
    return (int) (long) cabeza;
  }

  public synchronized int getPlayState() {
    return pausada ? PLAYSTATE_PAUSED : (tocando && !parada ? PLAYSTATE_PLAYING : PLAYSTATE_STOPPED);
  }

  public synchronized void stop() {
    avanzar();
    parada = true;
    avanzar();
  }

  public synchronized void pause() {
    avanzar();
    pausada = true;
  }

  public synchronized void flush() {
    escritos = (long) cabeza;
  }

  public synchronized void release() {
    liberada = true;
    tocando = false;
  }

  public static class Builder {
    private int hz = 22050;
    private int bytes = 4096;

    public Builder setAudioAttributes(AudioAttributes a) {
      return this;
    }

    public Builder setAudioFormat(AudioFormat f) {
      hz = f.hz;
      return this;
    }

    public Builder setBufferSizeInBytes(int b) {
      bytes = b;
      return this;
    }

    public Builder setTransferMode(int m) {
      return this;
    }

    public AudioTrack build() {
      AudioTrack t = new AudioTrack(hz, bytes);
      creadas.add(t);
      return t;
    }
  }
}
