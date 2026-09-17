/**
 * Motor vocal humano (capa encima de Qwen3-TTS VoiceDesign).
 * NO reemplaza voces JARVIS/emociones: traduce tags de performance →
 * texto hablable + instructAddon para el modelo T4.
 *
 * Tags soportados (inline):
 *   [breath] [sigh] [vibrato] [falsetto] [belt] [rasp] [grit]
 *   [whisper] [vocal_fry] [chuckle]
 *   [genre:rock|pop|jazz|rnb|opera|metal|ballad]
 *
 * Ritmo en texto: freeee~  …  ,  (tildeo / elipsis / comas)
 */

export type VocalPerformance = {
  /** Texto limpio para TTS (sin brackets) */
  spoken: string;
  /** Fragmentos para VoiceDesign instruct */
  instructAddon: string;
  genre: string | null;
  tags: string[];
  /** true si había tags o marcas de canto */
  isPerformance: boolean;
};

const ARTIFACT_INSTRUCT: Record<string, string> = {
  breath: 'brief natural breath intake before the phrase',
  sigh: 'soft sighing exhale, emotional release',
  vibrato: 'gentle natural vibrato on sustained vowels',
  falsetto: 'light airy head-voice falsetto color',
  belt: 'strong chest-voice belt on emphatic words, still musical',
  rasp: 'subtle throat rasp and gravel on accents',
  grit: 'gritty edge on stressed syllables',
  whisper: 'intimate low breathy whisper tone',
  vocal_fry: 'soft vocal fry at phrase edges',
  chuckle: 'subtle mid-line chuckle, warm human laugh',
};

const GENRE_INSTRUCT: Record<string, string> = {
  rock: 'rock vocal style: energetic attack, sustained belt, grit on accents',
  pop: 'pop vocal style: clean pitch curves, bright resonance, clear diction',
  jazz: 'jazz vocal style: swing feel, bluesy slides, breathy legato',
  rnb: 'R&B vocal style: smooth melisma, vocal fry touches, dynamic shifts',
  opera: 'operatic color: open vowels, richer resonance, controlled vibrato',
  metal: 'metal-tinged intensity: aggressive breath, strained edge without screaming',
  ballad: 'ballad style: warm intimate tone, emotional micro-pauses, soft dynamics',
};

const TAG_RE = /\[(\s*genre\s*:\s*([a-zA-Z]+)|[a-zA-Z_]+)\]/gi;

/** Expande vocales sostenidas tipo "freeee~" a forma hablable con cola. */
function expandMusicalOrthography(text: string): string {
  let out = text;
  // freeee~ → free… (cola suave)
  out = out.replace(/([aeiouáéíóúAEIOUÁÉÍÓÚ])\1{2,}~/g, '$1$1…');
  out = out.replace(/([aeiouáéíóúAEIOUÁÉÍÓÚ])\1{2,}/g, (m) => `${m.slice(0, 2)}…`);
  // tilde suelta = cola legato
  out = out.replace(/~/g, '…');
  // normalizar espacios
  out = out.replace(/\s{2,}/g, ' ').replace(/\s+([,…])/g, '$1').trim();
  return out;
}

/**
 * Parsea tags de performance y produce texto + instruct para Qwen3-TTS.
 * Idempotente si no hay tags: spoken ≈ input, instructAddon vacío.
 */
export function applyVocalPerformance(raw: string): VocalPerformance {
  if (!raw?.trim()) {
    return { spoken: '', instructAddon: '', genre: null, tags: [], isPerformance: false };
  }

  const tags: string[] = [];
  let genre: string | null = null;
  const instructParts: string[] = [];

  let stripped = raw.replace(TAG_RE, (_full, inner: string, genreName?: string) => {
    if (genreName) {
      const g = genreName.toLowerCase().trim();
      genre = g;
      tags.push(`genre:${g}`);
      if (GENRE_INSTRUCT[g]) instructParts.push(GENRE_INSTRUCT[g]);
      return '';
    }
    const key = String(inner || '')
      .toLowerCase()
      .trim()
      .replace(/\s+/g, '_');
    if (key.startsWith('genre:')) return '';
    tags.push(key);
    // Artefactos que se oyen mejor como texto hablado corto
    if (key === 'breath') return ' … ';
    if (key === 'sigh') return ' …aah… ';
    if (key === 'chuckle') return ' jeje… ';
    if (ARTIFACT_INSTRUCT[key]) instructParts.push(ARTIFACT_INSTRUCT[key]);
    return ' ';
  });

  // Marcas humanas residuales → pausas
  stripped = stripped
    .replace(/\.\.\./g, '…')
    .replace(/\s*,\s*/g, ', ')
    .replace(/\s+/g, ' ')
    .trim();

  const spoken = expandMusicalOrthography(stripped);

  const baseHuman =
    tags.length || /…|~/.test(raw)
      ? 'sing or speak with natural human imperfection, subtle pitch bends, realistic breathing, never robotic'
      : '';

  if (baseHuman) instructParts.unshift(baseHuman);

  const instructAddon = [...new Set(instructParts)].join('; ');
  const isPerformance = tags.length > 0 || /~|…|\.\.\./.test(raw) || /([aeiouáéíóú])\1{2,}/i.test(raw);

  return {
    spoken: spoken || stripped,
    instructAddon,
    genre,
    tags,
    isPerformance,
  };
}

/** Plantillas de canción con tags (español LATAM, ritmo humano). */
export const SONG_TEMPLATES = {
  ballad: [
    '[genre:ballad][breath] Hmm… déjame tomar aire…',
    'En la noche quietaaa~ brillan dos luces de ciaaan~',
    '[sigh] …',
    'Si me llamas… yo respondo con calmaa~',
    '[breath] ULTRON te escucha… sin prisa… contigo.',
  ],
  soft: [
    '[genre:ballad][whisper] Jeje… una canción corta…',
    '[breath] Respira… uno… dos…',
    'No estás solo en la juntaa~',
    '[sigh] Yo estoy aquí… cuando digas hey Ultron.',
  ],
  pop: [
    '[genre:pop][breath] Hey… sube un poco la luz…',
    'Hoy la junta puede esperaar~ un minuto naadaa más~',
    '[chuckle] Contigo… el ritmo es más fácil.',
  ],
  jazz: [
    '[genre:jazz][breath] Mmm… deja que flote…',
    'Notas suaves en la nochee~ …',
    '[sigh] Como un café lento… contigo.',
  ],
} as const;

export function pickSongLines(kind: 'ballad' | 'soft' | 'pop' | 'jazz' = 'ballad'): string[] {
  return [...SONG_TEMPLATES[kind]];
}

/** Hint corto para el system prompt (solo cuando canta / actúa). */
export function vocalPerformanceSystemHint(): string {
  return `Cuando cantes o hagas una actuación vocal, puedes usar tags opcionales en el texto (el motor los interpreta; el usuario no los ve):
[breath] [sigh] [vibrato] [whisper] [chuckle] [belt] [rasp] [genre:ballad|pop|jazz|rock|rnb].
Alarga vocales con "aaah~" y pausas con "…". Suena humano, imperfecto, nunca robótico.`;
}
