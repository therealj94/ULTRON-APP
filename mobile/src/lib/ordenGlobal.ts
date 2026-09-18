/** Cerebro local de Orden Global — respuestas concretas, no el eslogan de siempre. */

export type Doctrine = {
  id: string;
  code: string;
  category: string;
  title: string;
  summary: string;
  principles: string[];
};

export const DOCTRINES: Doctrine[] = [
  {
    id: 'og_01',
    code: 'ALFA-770-GEO',
    category: 'Geopolítica',
    title: 'Soberanía Tecnológica e Infraestructura Crítica',
    summary:
      'Autonomía de cómputo neural: nodos propios, failover multi-región y cero subordinación a monopolios de nube. Los datos de junta no salen del perímetro sin doble firma.',
    principles: [
      'Failover autónomo entre AWS, bare-metal y nodos locales.',
      'Cifrado post-cuántico en canales de audio y telemetría de mesa.',
      'Telemetría biométrica se analiza y se borra; no se archiva.',
    ],
  },
  {
    id: 'og_02',
    code: 'BETA-912-FIN',
    category: 'Tesorería',
    title: 'Reserva Líquida y Arbitraje Multidivisa',
    summary:
      'Cobertura patrimonial con oro, tierras raras y reservas sintéticas AAA. El escritorio prioriza liquidez institucional ante shocks emergentes.',
    principles: [
      'Diversificación continua ante fluctuación cambiaria.',
      'Modelos predictivos de liquidez en mercados emergentes.',
      'Auditoría criptográfica con doble firma de directores.',
    ],
  },
  {
    id: 'og_03',
    code: 'GAMMA-404-GOB',
    category: 'Gobernanza',
    title: 'Voto Blindado y Minutas Inmutables',
    summary:
      'Consenso de junta con sello de tiempo. Cada orden verbal que proceso queda en registro inmutable antes de despacharse.',
    principles: [
      'Autorización biométrica explícita para memorandos.',
      'Firma criptográfica de minutas antes de transmitir.',
      'Registro inmutable de órdenes verbales de ULTRON.',
    ],
  },
  {
    id: 'og_04',
    code: 'DELTA-108-DEF',
    category: 'Defensa',
    title: 'Contención Perimetral y Respuesta Activa',
    summary:
      'Respuesta a intrusión, acoso físico o ciberamenaza contra sede o terminales. Incluye disuasión en escritorio (blaster táctico) y revocación de tokens de nube.',
    principles: [
      'Modo combate / blaster en terminales tácticos.',
      'Aislamiento de sockets ante anomalía.',
      'Revocación automática de tokens temporales.',
    ],
  },
  {
    id: 'og_05',
    code: 'EPSILON-221-OPS',
    category: 'Operaciones',
    title: 'Directorio Alfa-1 y Cadena de Mando',
    summary:
      'Orden Global es el directorio de la junta: José y Medardo como núcleo, ULTRON FP como asistente de mesa. Cadena de mando: junta → ULTRON → nodos (Qwen 27B conocimiento, T4 voz, ojo Playwright).',
    principles: [
      'ULTRON no sustituye a la junta: ejecuta y custodia.',
      'El cerebro Qwen 27B es la fuente de conocimiento; no se toca desde el escritorio.',
      'Acceso desk solo a correos @ordenglobal.org de miembros.',
    ],
  },
];

export const OG_BRIEF = `CONOCIMIENTO ORDEN GLOBAL (úsalo, no repitas el eslogan):
Orden Global es el directorio ejecutivo (Alfa-1) de la junta. ULTRON FP es el asistente de mesa, no el dueño.
Doctrinas: ALFA-770-GEO soberanía tecnológica; BETA-912-FIN tesorería/oro; GAMMA-404-GOB voto blindado y minutas; DELTA-108-DEF perímetro y respuesta activa; EPSILON-221-OPS cadena de mando junta→ULTRON→nodos.
Nodos: Qwen 27B (conocimiento), T4 (voz), ojo Playwright (web). Datos biométricos se analizan y se purgan.
Si preguntan por una doctrina, cita código + un principio concreto. No recites siempre "Directorio Alfa-1 yo custodio el escritorio".`;

export function answerOrdenGlobal(cmd: string): string | null {
  const q = cmd.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (!/orden global|doctrina|alfa-?1|soberania|tesoreria|minuta|perimetro|directorio|estatuto|geopolitic|junta direct/.test(q)) {
    return null;
  }
  const hit =
    DOCTRINES.find((d) => q.includes(d.code.toLowerCase()) || q.includes(d.category.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''))) ||
    (/oro|tesoro|divisa|reserva/.test(q) ? DOCTRINES[1] : null) ||
    (/voto|minuta|gobern/.test(q) ? DOCTRINES[2] : null) ||
    (/defensa|intrus|blaster|amenaza/.test(q) ? DOCTRINES[3] : null) ||
    (/mando|alfa|quien manda|cadena/.test(q) ? DOCTRINES[4] : null) ||
    (/soberan|nube|infra|tecnolog/.test(q) ? DOCTRINES[0] : null);

  if (hit) {
    return `${hit.code}. ${hit.title}: ${hit.summary} Principio clave: ${hit.principles[0]}`;
  }
  if (/que es|qué es|explica|cuentame|cuéntame|resumen/.test(q) || q.trim().length < 28) {
    return 'Orden Global es el Directorio Alfa-1 de la junta: soberanía tecnológica (ALFA-770), tesorería y oro (BETA-912), voto blindado (GAMMA-404) y perímetro (DELTA-108). Yo ejecuto en mesa; la junta decide. ¿Quieres geopolítica, tesorería, gobernanza o defensa?';
  }
  return `Puedo abrir cualquiera de las cinco doctrinas: Geopolítica ALFA-770, Tesorería BETA-912, Gobernanza GAMMA-404, Defensa DELTA-108 u Operaciones EPSILON-221. ¿Cuál te interesa?`;
}
