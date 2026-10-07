/** Qué va a largo plazo vs plática. */
import { jsonDeEnv, listaDeEnv, listaDeTextos } from '../lib/datos-privados';

/**
 * Los hechos con que nace la memoria de la junta (quién es quién, sus roles y gustos). Eran nombres y apellidos de la
 * familia escritos aquí, en un repositorio público (auditoría del 7-oct, C-1): ahora llegan por AURA_HECHOS_SEMILLA
 * (JSON, una lista de frases). Sin ella, la memoria nace vacía y aprende de lo que le digan.
 */
function semilla(): string[] {
  return jsonDeEnv('AURA_HECHOS_SEMILLA', listaDeTextos, [] as string[], 'la memoria de la junta nace sin hechos de semilla');
}

/**
 * Los nombres que hacen que lo dicho sea «de largo plazo» (AURA_PERSONAS_CLAVE, separados por comas; se comparan sin
 * acentos ni mayúsculas). Los genéricos («junta», «se llama», «orden global»…) siguen aquí.
 */
function nombresClave(): string[] {
  return listaDeEnv('AURA_PERSONAS_CLAVE', 'sin nombres propios de la junta para reconocer hechos de largo plazo').map(sinAcentos);
}

function sinAcentos(t: string): string {
  return t.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function escapar(t: string): string {
  return t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function semillaLarga() {
  return semilla().map((hecho) => ({ hecho, t: 0 }));
}

export function esHechoLargo(texto: string): boolean {
  const t = texto.toLowerCase();
  if (t.length < 8) return false;
  if (/^(hola|hey|qué onda|como estas|gracias|ok|va|sí|no)\b/.test(t) && t.length < 24) return false;
  if (/recuerda|guard[ae]|anot[ae]|junta|rol(es)?|se llama|mi hermano|fund[eé]|cofund|soy el|soy la|nuestra empresa|orden global|prospera|aucorp|ordenex|mina|concesi[oó]n/.test(t)) return true;
  const plano = sinAcentos(t);
  return nombresClave().some((n) => new RegExp(escapar(n)).test(plano));
}

export function fusionarLarga(existente: { hecho: string; t: number }[], extra: string[]) {
  const out = [...existente];
  const seen = new Set(out.map((x) => x.hecho.toLowerCase()));
  for (const hecho of [...semilla(), ...extra]) {
    const k = hecho.toLowerCase();
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.unshift({ hecho, t: Date.now() });
  }
  return out.slice(0, 80);
}
