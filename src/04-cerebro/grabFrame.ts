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

/** Medida que cabe en `max` px por el lado más largo, sin agrandar nunca. */
export function medidaAchicada(w: number, h: number, max = 640): { w: number; h: number } {
  const ancho = Math.max(1, Math.round(w) || 1);
  const alto = Math.max(1, Math.round(h) || 1);
  const k = Math.min(1, max / Math.max(ancho, alto));
  return { w: Math.max(1, Math.round(ancho * k)), h: Math.max(1, Math.round(alto * k)) };
}

/**
 * Una foto ya tomada (data URL, p. ej. el PNG a resolución completa de la cámara) lista para el
 * cerebro: JPEG de 640 px como mucho por el lado largo, igual que un cuadro de `grabFrame`.
 * Devuelve null si el navegador no la pudo leer.
 */
export function achicarFoto(dataUrl: string, max = 640, calidad = 0.7): Promise<string | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        const m = medidaAchicada(img.naturalWidth, img.naturalHeight, max);
        const c = document.createElement('canvas');
        c.width = m.w;
        c.height = m.h;
        const ctx = c.getContext('2d');
        if (!ctx) return resolve(null);
        ctx.drawImage(img, 0, 0, m.w, m.h);
        resolve(c.toDataURL('image/jpeg', calidad));
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = dataUrl;
  });
}
