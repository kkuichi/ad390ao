// Normalizácia názvov a jednotiek ingrediencií, synonymá, fuzzy match pre špajzu.


const STOP_WORDS = new Set([
  'čerstvý', 'čerstvá', 'čerstvé', 'cerstvy', 'cerstva', 'cerstve',
  'strúhaný', 'strúhaná', 'strúhané', 'struhany', 'struhana', 'struhane',
  'nakrájaný', 'nakrajany', 'mletý', 'mleta', 'mlete', 'mlity',
  'olúpaný', 'olupany', 'umytý', 'umyty', 'optional', 'voliteľne', 'volitelne',
]);

// Synonymá: kľúč → kanonický tvar (lowercase bez diakritiky)

const SYNONYMS = {
  'olej olivový': 'olivový olej',
  'olej slnečnicový': 'slnečnicový olej',
  'vajce': 'vajcia',
  'vajko': 'vajcia',
  'jajko': 'vajcia',
  'jajka': 'vajcia',
  'cibuľa': 'cibula',
  'cesnak': 'cesnak',
  'paradajka': 'paradajky',
  'paradajky': 'paradajky',
  'cícer': 'cicer',
  'šošovica': 'sosovica',
  'múka': 'muka',
  'muka': 'muka',
  'ryža': 'ryza',
  'zemiaky': 'zemiaky',
  'zemiak': 'zemiaky',
  'mlieko': 'mlieko',
  'maslo': 'maslo',
  'máslo': 'maslo',
};

function stripDiacritics(s) {
  if (!s || typeof s !== 'string') return '';
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}


export function toNameNorm(name) {
  if (!name || typeof name !== 'string') return '';
  let t = name.trim().toLowerCase();
  t = stripDiacritics(t);
  if (!t) return '';

  const lowerOriginal = name.trim().toLowerCase();
  for (const [from, to] of Object.entries(SYNONYMS)) {
    const fromNorm = stripDiacritics(from);
    if (t === fromNorm || t.includes(fromNorm)) {
      t = stripDiacritics(to);
      break;
    }
  }

  const words = t.split(/\s+/).filter((w) => w.length > 0 && !STOP_WORDS.has(w));
  return words.join(' ').trim() || t;
}


export function toNameNormKey(name) {
  return toNameNorm(name).replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
}

// Lyžica = 15 ml, čajová = 5 ml (sypké bez hustoty necháme v ml)

const SPOON_ML = { lyzica: 15, lyžica: 15, polievkova: 15, cajova: 5, čajová: 5, cajova: 5 };


export function normalizeUnit(input) {
  const qty = input?.qty != null ? Number(input.qty) : 1;
  const raw = (input?.unit || 'ks').trim().toLowerCase();
  const kind = (input?.kind || '').toLowerCase();

  if (raw === 'podľa chuti' || raw === 'podle chuti') return null;

  const u = raw.replace(/\s+/g, '');
  if (u === 'g') return { qty, unit: 'g' };
  if (u === 'kg') return { qty: qty * 1000, unit: 'g' };
  if (u === 'ml') return { qty, unit: 'ml' };
  if (u === 'l' || u === 'litr') return { qty: qty * 1000, unit: 'ml' };
  if (u === 'ks' || u === 'kus' || u === 'kusy') return { qty, unit: 'ks' };
  if (/str[uú]čik|stroucek|stroužek/.test(raw)) return { qty, unit: 'ks' };

  const spoonMatch = raw.match(/(polievkov[áa]|čajov[áa]|cajov[áa])?\s*lyžic[aiau]/i) || raw.match(/lyzic/i);
  if (spoonMatch) {
    const isTea = /cajov|čajov|tea/.test(raw);
    const ml = isTea ? 5 : 15;
    return { qty: qty * ml, unit: 'ml' };
  }

  if (raw === 'plný' || raw === 'plna' || raw === 'hrnok') return { qty: qty * 250, unit: 'ml' };
  if (raw === 'šálka' || raw === 'salka') return { qty: qty * 250, unit: 'ml' };

  return { qty, unit: 'ks' };
}

// Levenshtein distance (počet úprav).

function levenshtein(a, b) {
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const matrix = [];
  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      const cost = a[j - 1] === b[i - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }
  return matrix[b.length][a.length];
}

// Similarita 0..1 (1 = identické). Používa Levenshtein.

export function similarity(a, b) {
  if (!a && !b) return 1;
  if (!a || !b) return 0;
  const sa = String(a).toLowerCase();
  const sb = String(b).toLowerCase();
  const maxLen = Math.max(sa.length, sb.length);
  if (maxLen === 0) return 1;
  const dist = levenshtein(sa, sb);
  return 1 - dist / maxLen;
}

// Konzervatívny prah: len pri > 0.85 považujeme za match

const FUZZY_THRESHOLD = 0.85;


export function fuzzyMatchPantry(ingredientNameNorm, pantryNameNorms, threshold = FUZZY_THRESHOLD) {
  if (!ingredientNameNorm || typeof ingredientNameNorm !== 'string') return null;
  const list = Array.isArray(pantryNameNorms)
    ? pantryNameNorms
    : typeof Set !== 'undefined' && pantryNameNorms instanceof Set
      ? Array.from(pantryNameNorms)
      : pantryNameNorms ? [pantryNameNorms] : [];
  if (!list || list.length === 0) return null;

  const ingKey = ingredientNameNorm.replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
  let best = null;
  let bestScore = threshold;

  for (const pantryNorm of list) {
    const pKey = (typeof pantryNorm === 'string' ? pantryNorm : '').replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
    if (!pKey) continue;
    // bez includes() — len exact alebo Levenshtein nad FUZZY_THRESHOLD
    const score = ingKey === pKey ? 1 : similarity(ingKey, pKey);
    if (score > bestScore) {
      bestScore = score;
      best = { match: pKey, score };
    }
  }
  return best;
}

export default { toNameNorm, toNameNormKey, normalizeUnit, similarity, fuzzyMatchPantry };
