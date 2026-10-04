/**
 * EL VIGÍA DE UN PAGO: después de abrir Veta Wallet con el envío llenado, mira la cadena (solo lectura) hasta
 * ver ESE envío y RECIÉN ENTONCES publica el comprobante en el hilo de PULSE2CHAT (`/pago` con el hash; el
 * relevo lo vuelve a comprobar contra la cadena). Un comprobante de algo que todavía no pasó sería mentira.
 *
 *   preparar  → anota el bloque de ahora: solo cuentan los bloques DESPUÉS de abrir la wallet (uno anterior
 *               con la misma cantidad sería otro pago, no este)
 *   esperando → la persona firma en la wallet; aquí se mira cada pocos segundos (al volver a AU-RA, ya)
 *   visto     → la cadena tiene el envío: se publica el comprobante
 *   publicado → el relevo lo aceptó y quedó en el hilo como tarjeta de pago
 *   sin-comprobante → se vio en la cadena pero el relevo no lo aceptó (se puede reintentar)
 *   vencido   → pasó el tope sin verlo (no lo firmó, o tardó): se puede seguir mirando un rato más
 *   cancelado → la persona dejó de esperar (lo que firme después ya no se publica solo)
 *
 * Un solo pago a la vez. El pago a medias se GUARDA (`guardar`): si Android cierra AU-RA mientras la persona
 * está en la wallet, al volver se retoma donde iba (`retomar`). Un hash publicado no vuelve a probar otro pago.
 *
 * Sin React Native: todo lo de afuera entra por `deps` (las pruebas lo corren con una cadena falsa).
 */
import { esDireccion, esHash, montoValido, simbolo, type Busqueda } from './logica';

export type FaseVigia = 'libre' | 'esperando' | 'visto' | 'publicado' | 'sin-comprobante' | 'vencido' | 'cancelado';

export type Pendiente = {
  /** Correo y nombre de quien recibe (su hilo). */
  correo: string;
  nombre: string;
  /** Su dirección de Veta Wallet, de su ficha en PULSE2CHAT. */
  direccion: string;
  /** La dirección de quien paga (la suya, de su cartera conectada): sin ella no se reconoce el envío. */
  mia: string;
  monto: string;
  moneda: string;
  /** El siguiente bloque por mirar (0 = desde el último). */
  siguiente: number;
  /** Hasta cuándo se mira (epoch ms). */
  hasta: number;
  hash?: string;
};

export type EstadoVigia = { fase: FaseVigia; pago: Pendiente | null; hash?: string; detalle?: string };

export type DepsVigia = {
  bloque: () => Promise<number>;
  buscar: (b: Busqueda, inicio: number) => Promise<{ hash: string | null; siguiente: number }>;
  /** Publica el comprobante en el hilo. true = el relevo lo aceptó. */
  publicar: (p: { para: string; monto: string; moneda: string; hash: string }) => Promise<boolean>;
  /** Guarda el pago a medias y los hashes ya usados (null = no hay pago a medias). */
  guardar: (d: { pago: Pendiente | null; usados: string[] }) => Promise<void>;
  ahora?: () => number;
  esperar?: (ms: number, f: () => void) => () => void;
};

/** Cuánto se mira la cadena después de abrir la wallet (y cuánto más con «seguir mirando»). */
export const TOPE_VIGIA_MS = 15 * 60_000;
export const PRORROGA_MS = 10 * 60_000;
export const PRIMERA_MIRADA_MS = 8_000;
export const CADA_MS = 6_000;
const MAX_USADOS = 200;

export class VigiaPago {
  private e: EstadoVigia = { fase: 'libre', pago: null };
  private oyentes = new Set<() => void>();
  private cancelarTimer: (() => void) | null = null;
  /** La vuelta que está mirando (0 = ninguna): la de una cuenta anterior no apaga la de la nueva. */
  private mirando = 0;
  private vueltas = 0;
  private usados: string[] = [];
  private generacion = 0;

  constructor(private deps: DepsVigia) {}

  private ahora() {
    return (this.deps.ahora || Date.now)();
  }
  private timer(ms: number, f: () => void) {
    const esp =
      this.deps.esperar ||
      ((m: number, g: () => void) => {
        const t = setTimeout(g, m);
        return () => clearTimeout(t);
      });
    this.cancelarTimer?.();
    this.cancelarTimer = esp(ms, f);
  }

  estado(): EstadoVigia {
    return this.e;
  }

  suscribir(f: () => void): () => void {
    this.oyentes.add(f);
    return () => {
      this.oyentes.delete(f);
    };
  }

  private fijar(e: EstadoVigia) {
    this.e = e;
    for (const f of [...this.oyentes]) {
      try {
        f();
      } catch {
        /* un oyente roto no para el vigía */
      }
    }
  }

  private persistir() {
    const vivo = this.e.fase === 'esperando' || this.e.fase === 'visto';
    void this.deps.guardar({ pago: vivo ? this.e.pago : null, usados: this.usados }).catch(() => {});
  }

  /** ¿Hay un pago en curso (mirando la cadena o publicando)? */
  ocupado(): boolean {
    return this.e.fase === 'esperando' || this.e.fase === 'visto';
  }

  /**
   * Anota el pago y el bloque de ahora. Devuelve el pendiente (para abrir la wallet después). Lanza si falta
   * algo: sin la dirección propia o la del destinatario no se puede reconocer el envío.
   */
  async preparar(p: { correo: string; nombre: string; direccion: string; mia: string; monto: string; moneda: string }): Promise<Pendiente> {
    if (this.ocupado()) throw new Error('Ya estoy esperando otro envío. Termina ese o cancélalo primero.');
    if (!esDireccion(p.direccion)) throw new Error('Esa persona no tiene una dirección de Veta Wallet válida.');
    if (!esDireccion(p.mia)) throw new Error('Primero conecta tu cartera: sin tu dirección no puedo reconocer el envío.');
    const monto = montoValido(p.monto);
    if (!monto) throw new Error('Escribe una cantidad mayor que cero.');
    const moneda = simbolo(p.moneda);
    if (!moneda) throw new Error(`No conozco la moneda ${p.moneda}.`);
    let bloque = 0;
    try {
      bloque = await this.deps.bloque();
    } catch {
      /* sin bloque: se busca desde el último al mirar */
    }
    return {
      correo: p.correo.trim().toLowerCase(),
      nombre: p.nombre,
      direccion: p.direccion.trim(),
      mia: p.mia.trim(),
      monto,
      moneda,
      siguiente: bloque > 0 ? bloque + 1 : 0,
      hasta: this.ahora() + TOPE_VIGIA_MS,
    };
  }

  /** La wallet ya se abrió con el envío: empieza a mirar. */
  empezar(p: Pendiente) {
    this.generacion++;
    this.fijar({ fase: 'esperando', pago: p });
    this.persistir();
    this.timer(PRIMERA_MIRADA_MS, () => void this.mirar());
  }

  /** Lo guardado al arrancar (Android cerró AU-RA mientras la persona estaba en la wallet). */
  retomar(d: { pago: Pendiente | null; usados?: string[] } | null) {
    if (d?.usados) this.usados = d.usados.filter(esHash).slice(-MAX_USADOS);
    const p = d?.pago;
    if (!p || this.ocupado() || !esDireccion(p.direccion) || !esDireccion(p.mia) || !montoValido(p.monto) || !simbolo(p.moneda)) return;
    if (p.hash && esHash(p.hash)) {
      // Ya se había visto: falta publicar.
      this.generacion++;
      this.fijar({ fase: 'visto', pago: p, hash: p.hash });
      void this.publicar(p, p.hash, this.generacion);
      return;
    }
    if (this.ahora() > p.hasta) {
      this.fijar({ fase: 'vencido', pago: p });
      this.persistir();
      return;
    }
    this.empezar(p);
  }

  /** La persona volvió a AU-RA (de la wallet): se mira ya, sin esperar la vuelta. */
  alVolver() {
    if (this.e.fase === 'esperando') this.timer(400, () => void this.mirar());
  }

  /** «Seguir mirando» tras el tope: un rato más, desde donde iba. */
  seguir() {
    const p = this.e.pago;
    if (this.e.fase !== 'vencido' || !p) return;
    this.empezar({ ...p, hasta: this.ahora() + PRORROGA_MS });
  }

  /** Reintenta publicar un comprobante que el relevo no aceptó. */
  reintentarPublicar() {
    const p = this.e.pago;
    const h = this.e.hash;
    if (this.e.fase !== 'sin-comprobante' || !p || !h) return;
    this.generacion++;
    this.fijar({ fase: 'visto', pago: p, hash: h });
    void this.publicar(p, h, this.generacion);
  }

  cancelar() {
    this.generacion++;
    this.cancelarTimer?.();
    this.cancelarTimer = null;
    const p = this.e.pago;
    this.fijar({ fase: this.e.fase === 'libre' ? 'libre' : 'cancelado', pago: p });
    this.persistir();
  }

  /**
   * Se cerró la sesión (auditoría WAL02): el vigía deja de mirar y de publicar YA, sin tocar lo guardado (el
   * pago a medias lleva el correo de su dueño y solo se retoma si esa persona vuelve a entrar). Subir la
   * generación tira lo que esté en vuelo: una búsqueda o un comprobante de la cuenta anterior no se publica
   * ni se pinta bajo la siguiente.
   */
  soltar() {
    this.generacion++;
    this.cancelarTimer?.();
    this.cancelarTimer = null;
    this.mirando = 0;
    this.usados = [];
    this.fijar({ fase: 'libre', pago: null });
  }

  /** Vuelve a «libre» (la hoja se cerró después de terminar). Un pago en curso no se suelta así. */
  olvidar() {
    if (this.ocupado()) return;
    this.cancelarTimer?.();
    this.fijar({ fase: 'libre', pago: null });
    this.persistir();
  }

  /** Una vuelta: lee los bloques nuevos y, si el envío está, lo publica. */
  async mirar(): Promise<void> {
    const p = this.e.pago;
    if (this.e.fase !== 'esperando' || !p || this.mirando) return;
    const gen = this.generacion;
    if (this.ahora() > p.hasta) {
      this.fijar({ fase: 'vencido', pago: p });
      this.persistir();
      return;
    }
    const vuelta = (this.mirando = ++this.vueltas);
    try {
      const r = await this.deps.buscar({ desde: p.mia, para: p.direccion, simbolo: p.moneda, monto: p.monto }, p.siguiente);
      if (gen !== this.generacion || this.e.fase !== 'esperando') return;
      const hash = r.hash && esHash(r.hash) ? r.hash.toLowerCase() : null;
      if (hash && !this.usados.includes(hash)) {
        const visto = { ...p, hash, siguiente: r.siguiente };
        this.usados = [...this.usados, hash].slice(-MAX_USADOS);
        this.fijar({ fase: 'visto', pago: visto, hash });
        this.persistir();
        await this.publicar(visto, hash, gen);
        return;
      }
      const sigue = { ...p, siguiente: r.siguiente > 0 ? r.siguiente : p.siguiente };
      this.e = { ...this.e, pago: sigue };
      this.persistir();
    } catch {
      /* sin red un momento: se vuelve a mirar */
    } finally {
      if (this.mirando === vuelta) this.mirando = 0;
    }
    if (gen === this.generacion && this.e.fase === 'esperando') this.timer(CADA_MS, () => void this.mirar());
  }

  private async publicar(p: Pendiente, hash: string, gen: number) {
    // El relevo comprueba el hash contra la cadena: solo si lo aceptó se dice que el comprobante quedó.
    const ok = await this.deps.publicar({ para: p.correo, monto: p.monto, moneda: p.moneda, hash }).catch(() => false);
    if (gen !== this.generacion) return;
    this.fijar(ok ? { fase: 'publicado', pago: p, hash } : { fase: 'sin-comprobante', pago: p, hash });
    this.persistir();
  }
}
