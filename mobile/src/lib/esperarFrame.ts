/**
 * Espera la primera foto buena de la cámara recién encendida. Al prenderla, la cámara tarda un poco en
 * montarse y en dar luz (las primeras fotos salen negras y CamaraVision las descarta): se pregunta cada
 * tanto hasta que llega una o se acaba el tiempo. Sin esto, «¿qué ves?» con la cámara apagada contestaba
 * «aún no identifico nada» sin siquiera prenderla (José, 2-oct: «una foto… no lo hace»).
 *
 * `tomar` es lo que deja CamaraVision en grabRef (null mientras la cámara no está lista).
 */
export async function esperarFrame(
  tomar: () => (() => Promise<string | null>) | null,
  { maxMs = 7000, cadaMs = 350, dormir = (ms: number) => new Promise<void>((r) => setTimeout(r, ms)), ahora = Date.now }: { maxMs?: number; cadaMs?: number; dormir?: (ms: number) => Promise<void>; ahora?: () => number } = {}
): Promise<string | null> {
  const fin = ahora() + maxMs;
  for (;;) {
    const f = tomar();
    if (f) {
      const foto = await f().catch(() => null);
      if (foto) return foto;
    }
    if (ahora() + cadaMs > fin) return null;
    await dormir(cadaMs);
  }
}
