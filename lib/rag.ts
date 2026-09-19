/**
 * RAG local de snippets VERIFICADOS (Fase 6).
 * Sin Qdrant ni OpenAI: búsqueda léxica sobre un corpus curado en el repo.
 * Qdrant + embeddings queda documentado como siguiente paso de escala; no se finge infra que no corre.
 */

export type Snippet = {
  id: string;
  descripcion: string;
  lang: 'python';
  codigo: string;
  tags: string[];
};

export const SNIPPETS: Snippet[] = [
  {
    id: 'anagramas',
    descripcion: 'Anagramas: misma frecuencia de letras, ignorando mayúsculas y espacios. Unicode vía casefold.',
    lang: 'python',
    tags: ['anagrama', 'string', 'frecuencia', 'contador'],
    codigo: `from collections import Counter

def son_anagramas(a: str, b: str) -> bool:
    def clave(s: str) -> Counter:
        return Counter(ch for ch in s.casefold() if not ch.isspace())
    return clave(a) == clave(b)

# No he ejecutado esto en este turno. Casos: "", "a a"/"aa", "café"/"face".`,
  },
  {
    id: 'palindromo',
    descripcion: 'Palíndromo alfanumérico, casefold, sin puntuación.',
    lang: 'python',
    tags: ['palindromo', 'string', 'two pointers'],
    codigo: `def es_palindromo(s: str) -> bool:
    t = [c for c in s.casefold() if c.isalnum()]
    return t == t[::-1]`,
  },
  {
    id: 'binsearch',
    descripcion: 'Búsqueda binaria en lista ordenada. Devuelve índice o -1. Complejidad esperada O(log N).',
    lang: 'python',
    tags: ['busqueda', 'binaria', 'binary search', 'log n'],
    codigo: `def busqueda_binaria(xs: list, objetivo) -> int:
    lo, hi = 0, len(xs) - 1
    while lo <= hi:
        mid = (lo + hi) // 2
        if xs[mid] == objetivo:
            return mid
        if xs[mid] < objetivo:
            lo = mid + 1
        else:
            hi = mid - 1
    return -1`,
  },
  {
    id: 'mergesort',
    descripcion: 'Merge sort estable. Complejidad esperada O(N log N) tiempo, O(N) extra.',
    lang: 'python',
    tags: ['ordenar', 'sort', 'merge', 'n log n'],
    codigo: `def merge_sort(xs: list) -> list:
    if len(xs) <= 1:
        return list(xs)
    mid = len(xs) // 2
    izq, der = merge_sort(xs[:mid]), merge_sort(xs[mid:])
    out, i, j = [], 0, 0
    while i < len(izq) and j < len(der):
        if der[j] < izq[i]:
            out.append(der[j]); j += 1
        else:
            out.append(izq[i]); i += 1
    out.extend(izq[i:]); out.extend(der[j:])
    return out`,
  },
  {
    id: 'fact-iter',
    descripcion: 'Factorial iterativo. Evita RecursionError. n<0 → ValueError.',
    lang: 'python',
    tags: ['factorial', 'iterativo', 'recursion'],
    codigo: `def factorial(n: int) -> int:
    if n < 0:
        raise ValueError('n negativo')
    acc = 1
    for i in range(2, n + 1):
        acc *= i
    return acc`,
  },
  {
    id: 'fib-iter',
    descripcion: 'Fibonacci iterativo O(N) tiempo, O(1) memoria. fib(0)=0, fib(1)=1.',
    lang: 'python',
    tags: ['fibonacci', 'recursión', 'iterativo'],
    codigo: `def fib(n: int) -> int:
    if n < 0:
        raise ValueError('n negativo')
    a, b = 0, 1
    for _ in range(n):
        a, b = b, a + b
    return a`,
  },
  {
    id: 'dfs',
    descripcion: 'DFS iterativo sobre grafo como dict[nodo, list[vecino]].',
    lang: 'python',
    tags: ['grafo', 'dfs', 'recorrido'],
    codigo: `def dfs(grafo: dict, inicio):
    visto, pila, orden = set(), [inicio], []
    while pila:
        n = pila.pop()
        if n in visto:
            continue
        visto.add(n)
        orden.append(n)
        pila.extend(reversed(grafo.get(n, [])))
    return orden`,
  },
  {
    id: 'bfs',
    descripcion: 'BFS con deque. Distancia no ponderada.',
    lang: 'python',
    tags: ['grafo', 'bfs', 'cola'],
    codigo: `from collections import deque

def bfs(grafo: dict, inicio):
    visto, q, orden = {inicio}, deque([inicio]), []
    while q:
        n = q.popleft()
        orden.append(n)
        for v in grafo.get(n, []):
            if v not in visto:
                visto.add(v)
                q.append(v)
    return orden`,
  },
  {
    id: 'dijkstra',
    descripcion: 'Dijkstra clásico con heapq. Aristas no negativas. Distancia inf si inalcanzable.',
    lang: 'python',
    tags: ['grafo', 'dijkstra', 'camino', 'heap'],
    codigo: `import heapq, math

def dijkstra(grafo: dict, origen):
    dist = {origen: 0}
    pq = [(0, origen)]
    while pq:
        d, u = heapq.heappop(pq)
        if d != dist.get(u, math.inf):
            continue
        for v, w in grafo.get(u, []):
            nd = d + w
            if nd < dist.get(v, math.inf):
                dist[v] = nd
                heapq.heappush(pq, (nd, v))
    return dist`,
  },
  {
    id: 'two-sum',
    descripcion: 'Two-sum: índices de dos números que suman target. Un pase O(N).',
    lang: 'python',
    tags: ['array', 'two sum', 'hash'],
    codigo: `def two_sum(nums: list[int], target: int) -> tuple[int, int] | None:
    visto: dict[int, int] = {}
    for i, n in enumerate(nums):
        j = visto.get(target - n)
        if j is not None:
            return (j, i)
        visto[n] = i
    return None`,
  },
  {
    id: 'normalize',
    descripcion: 'Normalizar texto ES: minúsculas, quitar acentos, colapsar espacios. Necesario para comparar "café"/"cafe".',
    lang: 'python',
    tags: ['normalizar', 'acentos', 'unicode', 'string'],
    codigo: `import unicodedata, re

def normalizar(s: str) -> str:
    s = unicodedata.normalize('NFD', s)
    s = ''.join(ch for ch in s if unicodedata.category(ch) != 'Mn')
    return re.sub(r'\\s+', ' ', s).strip().lower()`,
  },
  {
    id: 'parse-json-seguro',
    descripcion: 'json.loads con fallback a None. No lanza.',
    lang: 'python',
    tags: ['json', 'parse', 'api'],
    codigo: `import json

def parse_json(raw: str):
    try:
        return json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        return None`,
  },
  {
    id: 'retry',
    descripcion: 'Reintento con backoff lineal. Última excepción se relanza.',
    lang: 'python',
    tags: ['retry', 'api', 'red', 'backoff'],
    codigo: `import time

def con_reintento(fn, veces=3, espera=0.4):
    ultimo = None
    for i in range(veces):
        try:
            return fn()
        except Exception as e:
            ultimo = e
            time.sleep(espera * (i + 1))
    raise ultimo`,
  },
  {
    id: 'timeout-fn',
    descripcion: 'Ejecutar fn con timeout vía signal (Unix). No es thread-safe.',
    lang: 'python',
    tags: ['timeout', 'signal', 'unix'],
    codigo: `import signal

class Timeout(Exception):
    pass

def con_timeout(fn, segundos=10):
    def _handler(signum, frame):
        raise Timeout('timeout')
    old = signal.signal(signal.SIGALRM, _handler)
    signal.alarm(segundos)
    try:
        return fn()
    finally:
        signal.alarm(0)
        signal.signal(signal.SIGALRM, old)`,
  },
  {
    id: 'gcd',
    descripcion: 'MCD de Euclides. Complejidad logarítmica en el menor.',
    lang: 'python',
    tags: ['mcd', 'gcd', 'euclides', 'math'],
    codigo: `def mcd(a: int, b: int) -> int:
    a, b = abs(a), abs(b)
    while b:
        a, b = b, a % b
    return a`,
  },
  {
    id: 'binario',
    descripcion: 'Entero a binario sin prefijo 0b. n=0 → "0".',
    lang: 'python',
    tags: ['binario', 'bits', 'entero'],
    codigo: `def a_binario(n: int) -> str:
    if n == 0:
        return '0'
    signo, n = ('-' if n < 0 else ''), abs(n)
    bits = []
    while n:
        bits.append(str(n & 1))
        n >>= 1
    return signo + ''.join(reversed(bits))`,
  },
  {
    id: 'unique',
    descripcion: 'Únicos preservando orden (dict fromkeys).',
    lang: 'python',
    tags: ['unique', 'dedup', 'lista'],
    codigo: `def unicos(xs: list) -> list:
    return list(dict.fromkeys(xs))`,
  },
  {
    id: 'chunk',
    descripcion: 'Partir lista en bloques de tamaño n. Último bloque puede ser menor.',
    lang: 'python',
    tags: ['chunk', 'lista', 'batch'],
    codigo: `def en_bloques(xs: list, n: int) -> list[list]:
    if n <= 0:
        raise ValueError('n debe ser > 0')
    return [xs[i:i+n] for i in range(0, len(xs), n)]`,
  },
  {
    id: 'flatten',
    descripcion: 'Aplanar un nivel de listas anidadas.',
    lang: 'python',
    tags: ['flatten', 'lista', 'anidada'],
    codigo: `def aplanar(xs: list) -> list:
    out = []
    for x in xs:
        if isinstance(x, list):
            out.extend(x)
        else:
            out.append(x)
    return out`,
  },
  {
    id: 'safe-div',
    descripcion: 'División que no lanza: None si divisor 0.',
    lang: 'python',
    tags: ['division', 'zero', 'edge'],
    codigo: `def div_segura(a, b):
    try:
        return a / b
    except ZeroDivisionError:
        return None`,
  },
  {
    id: 'clamp',
    descripcion: 'Acotar x a [lo, hi].',
    lang: 'python',
    tags: ['clamp', 'rango', 'math'],
    codigo: `def acotar(x, lo, hi):
    if lo > hi:
        lo, hi = hi, lo
    return lo if x < lo else hi if x > hi else x`,
  },
  {
    id: 'slug',
    descripcion: 'Slug ASCII a partir de título (usa normalizar).',
    lang: 'python',
    tags: ['slug', 'url', 'string'],
    codigo: `import re, unicodedata

def slug(s: str) -> str:
    s = unicodedata.normalize('NFD', s)
    s = ''.join(ch for ch in s if unicodedata.category(ch) != 'Mn')
    s = re.sub(r'[^a-zA-Z0-9]+', '-', s).strip('-').lower()
    return s or 'n-a'`,
  },
  {
    id: 'median',
    descripcion: 'Mediana de lista no vacía. Copia y ordena O(N log N).',
    lang: 'python',
    tags: ['mediana', 'estadistica', 'sort'],
    codigo: `def mediana(xs: list[float]) -> float:
    if not xs:
        raise ValueError('lista vacía')
    ys = sorted(xs)
    m = len(ys) // 2
    return ys[m] if len(ys) % 2 else (ys[m-1] + ys[m]) / 2`,
  },
  {
    id: 'groupby',
    descripcion: 'Agrupar lista de dicts por clave.',
    lang: 'python',
    tags: ['groupby', 'dict', 'agregar'],
    codigo: `from collections import defaultdict

def agrupar(rows: list[dict], clave: str) -> dict[str, list[dict]]:
    out = defaultdict(list)
    for r in rows:
        out[str(r.get(clave))].append(r)
    return dict(out)`,
  },
  {
    id: 'http-status',
    descripcion: 'Clasificar código HTTP en ok/cliente/servidor/otro.',
    lang: 'python',
    tags: ['http', 'status', 'api'],
    codigo: `def clase_http(code: int) -> str:
    if 200 <= code < 300:
        return 'ok'
    if 400 <= code < 500:
        return 'cliente'
    if 500 <= code < 600:
        return 'servidor'
    return 'otro'`,
  },
  {
    id: 'luhn',
    descripcion: 'Luhn para validar dígitos de tarjeta (no autoriza pagos).',
    lang: 'python',
    tags: ['luhn', 'validar', 'digitos'],
    codigo: `def luhn(num: str) -> bool:
    ds = [int(c) for c in num if c.isdigit()]
    if len(ds) < 2:
        return False
    s = 0
    for i, d in enumerate(reversed(ds)):
        if i % 2 == 1:
            d *= 2
            if d > 9:
                d -= 9
        s += d
    return s % 10 == 0`,
  },
  {
    id: 'levenshtein',
    descripcion: 'Distancia de edición Levenshtein. O(len(a)*len(b)).',
    lang: 'python',
    tags: ['levenshtein', 'edit distance', 'string'],
    codigo: `def levenshtein(a: str, b: str) -> int:
    if a == b:
        return 0
    if not a:
        return len(b)
    if not b:
        return len(a)
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            ins, delete, sub = cur[j-1] + 1, prev[j] + 1, prev[j-1] + (ca != cb)
            cur.append(min(ins, delete, sub))
        prev = cur
    return prev[-1]`,
  },
  {
    id: 'stack-eval',
    descripcion: 'Evaluar RPN (+ - * / enteros). División truncada hacia 0.',
    lang: 'python',
    tags: ['rpn', 'stack', 'evaluar'],
    codigo: `def rpn(tokens: list[str]) -> int:
    st: list[int] = []
    for t in tokens:
        if t in '+-*/':
            b, a = st.pop(), st.pop()
            if t == '+': st.append(a + b)
            elif t == '-': st.append(a - b)
            elif t == '*': st.append(a * b)
            else:
                if b == 0:
                    raise ZeroDivisionError
                st.append(int(a / b))
        else:
            st.append(int(t))
    return st[-1]`,
  },
  {
    id: 'parentheses',
    descripcion: 'Paréntesis / corchetes / llaves balanceados.',
    lang: 'python',
    tags: ['parentesis', 'stack', 'validar'],
    codigo: `def balanceado(s: str) -> bool:
    par = {')': '(', ']': '[', '}': '{'}
    st: list[str] = []
    for ch in s:
        if ch in '([{':
            st.append(ch)
        elif ch in par:
            if not st or st.pop() != par[ch]:
                return False
    return not st`,
  },
  {
    id: 'sliding-max',
    descripcion: 'Máximo de ventana k con deque. O(N).',
    lang: 'python',
    tags: ['ventana', 'sliding', 'deque', 'maximo'],
    codigo: `from collections import deque

def max_ventana(xs: list[int], k: int) -> list[int]:
    if k <= 0:
        raise ValueError('k')
    dq, out = deque(), []
    for i, x in enumerate(xs):
        while dq and dq[0] <= i - k:
            dq.popleft()
        while dq and xs[dq[-1]] <= x:
            dq.pop()
        dq.append(i)
        if i >= k - 1:
            out.append(xs[dq[0]])
    return out`,
  },
];

function norm(s: string) {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

export function buscarSnippets(pregunta: string, limite = 5): Snippet[] {
  const q = norm(pregunta);
  const words = q.split(/[^a-z0-9]+/).filter((w) => w.length > 2);
  const scored = SNIPPETS.map((s) => {
    const blob = norm(`${s.id} ${s.descripcion} ${s.tags.join(' ')}`);
    let score = 0;
    for (const t of s.tags) if (q.includes(norm(t))) score += 3;
    for (const w of words) if (blob.includes(w)) score += 1;
    return { s, score };
  })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
  return scored.slice(0, Math.max(0, limite)).map((x) => x.s);
}
