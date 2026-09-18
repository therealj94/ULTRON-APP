export function grabFrame(): string | null {
  const video = (window as any).__ultronVideo as HTMLVideoElement | undefined;
  if (!video || video.readyState < 2) return null;
  const w = 640;
  const h = Math.max(1, Math.round((video.videoHeight / Math.max(video.videoWidth, 1)) * w));
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h || 360;
  const ctx = c.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(video, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.7);
}
