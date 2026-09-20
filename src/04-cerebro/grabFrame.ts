/**
 * Captura un cuadro del video de la cámara (lo expone `07-pantallas/VisionOverlay` en
 * window.__ultronVideo) como JPEG data URL, para mandarlo al cerebro con visión.
 * Devuelve null si no hay cámara activa o el video aún no tiene datos.
 */
export function grabFrame(): string | null {
  const video = (window as any).__ultronVideo as HTMLVideoElement | undefined;
  if (!video || video.readyState < 2 || video.videoWidth === 0 || video.videoHeight === 0) return null;
  const w = 640;
  const h = Math.max(1, Math.round((video.videoHeight / video.videoWidth) * w));
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  if (!ctx) return null;
  try {
    ctx.drawImage(video, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.7);
  } catch {
    return null;
  }
}
