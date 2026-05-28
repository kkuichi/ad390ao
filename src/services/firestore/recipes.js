// Recepty: verejná knižnica + vlastné recepty používateľa (cache 5 min).
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  limit,
  where,
  addDoc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
} from 'firebase/firestore';
import { db } from '../../firebase';
import { sanitizeForFirestore } from '../../utils/firestoreSanitize';

const COLLECTION = 'recipes';

const _recipeCache = new Map(); // id -> { ts, value }
const RECIPE_TTL = 5 * 60 * 1000;

const _listCache = new Map(); // key -> { ts, value }
const LIST_TTL = 60 * 1000;

function listCacheKey(scope, opts = {}) {
  return `${scope}|${opts.limit ?? 100}|${(opts.category || '').trim()}|${opts.uid || ''}`;
}

function sanitizeRecipeImageUrl(raw) {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  // Staršie dáta môžu mať http URL; na iOS to často neprejde ATS.
  if (trimmed.startsWith('http://')) return `https://${trimmed.slice(7)}`;
  return trimmed;
}

function normalizeRecipeDoc(id, data = {}) {
  const fallbackImage =
    sanitizeRecipeImageUrl(data.imageUrl) ||
    sanitizeRecipeImageUrl(data.image) ||
    sanitizeRecipeImageUrl(data.photoUrl) ||
    sanitizeRecipeImageUrl(data.thumbnailUrl) ||
    sanitizeRecipeImageUrl(data?.image?.url);
  return {
    id,
    ...data,
    imageUrl: fallbackImage,
  };
}

function invalidateListCache() {
  _listCache.clear();
}

export function clearRecipeCaches() {
  _recipeCache.clear();
  _listCache.clear();
}


export function peekRecipeFromCache(id) {
  if (!id) return null;
  const cached = _recipeCache.get(id);
  if (!cached) return null;
  if (Date.now() - cached.ts > RECIPE_TTL) return null;
  return cached.value || null;
}

// Kategórie zobrazené v aplikácii (v rovnakom poradí ako v scraperi).

export const RECIPE_CATEGORIES = [
  'Raňajky',
  'Obed / večera',
  'Predjedlo',
  'Nápoj',
  'Dezerty',
  'Polievky',
  'Šaláty',
  'Pizza a cestoviny',
  'Bezmäsité jedlá',
  'Vegetariánske',
  'Vegánske',
  'Fit recepty',
  'Mleté mäso',
  'Vlastné',
];




export async function getRecipe(id, opts = {}) {
  if (!id) return null;
  if (!opts.force) {
    const cached = _recipeCache.get(id);
    if (cached && Date.now() - cached.ts < RECIPE_TTL) return cached.value;
  }
  const ref = doc(db, COLLECTION, id);
  const snap = await getDoc(ref);
  const value = snap.exists() ? normalizeRecipeDoc(snap.id, snap.data()) : null;
  _recipeCache.set(id, { ts: Date.now(), value });
  return value;
}


export async function listRecipes(opts = {}) {
  const key = listCacheKey('public', opts);
  if (!opts.force) {
    const cached = _listCache.get(key);
    if (cached && Date.now() - cached.ts < LIST_TTL) return cached.value;
  }
  const lim = opts.limit ?? 100;
  const category = opts.category?.trim() || null;
  const ref = collection(db, COLLECTION);
  const q = category
    ? query(ref, where('categories', 'array-contains', category), limit(lim))
    : query(ref, limit(lim));
  const snap = await getDocs(q);
  const value = snap.docs.map((d) => normalizeRecipeDoc(d.id, d.data()));
  for (const r of value) _recipeCache.set(r.id, { ts: Date.now(), value: r });
  _listCache.set(key, { ts: Date.now(), value });
  return value;
}


export async function listUserRecipes(uid, opts = {}) {
  if (!uid) return [];
  const key = listCacheKey('mine', { ...opts, uid });
  if (!opts.force) {
    const cached = _listCache.get(key);
    if (cached && Date.now() - cached.ts < LIST_TTL) return cached.value;
  }
  const lim = opts.limit ?? 100;
  const ref = collection(db, COLLECTION);
  const q = query(ref, where('authorUid', '==', uid), limit(lim));
  const snap = await getDocs(q);
  const value = snap.docs.map((d) => normalizeRecipeDoc(d.id, d.data()));
  for (const r of value) _recipeCache.set(r.id, { ts: Date.now(), value: r });
  _listCache.set(key, { ts: Date.now(), value });
  return value;
}


export async function listRecipesWithMine(uid, opts = {}) {
  const [pub, mine] = await Promise.all([
    listRecipes(opts),
    uid
      ? listUserRecipes(uid, { limit: opts.limit ?? 100, force: opts.force })
      : Promise.resolve([]),
  ]);
  const seen = new Set();
  const out = [];
  for (const r of [...mine, ...pub]) {
    if (!r?.id || seen.has(r.id)) continue;
    seen.add(r.id);
    if (opts.category?.trim()) {
      const cats = r.categories || [];
      if (!cats.includes(opts.category.trim())) continue;
    }
    out.push(r);
  }
  return out.slice(0, (opts.limit ?? 100) * 2);
}


export async function createUserRecipe(uid, data) {
  if (!uid) throw new Error('uid required');
  const ingredients = Array.isArray(data.ingredients)
    ? data.ingredients.map((ing) =>
        typeof ing === 'string'
          ? { name: ing, qty: 1, unit: 'ks' }
          : {
              name: String(ing?.name || '').trim(),
              qty: Number(ing?.qty) > 0 ? Number(ing.qty) : 1,
              unit: String(ing?.unit || 'ks').trim() || 'ks',
            }
      )
    : [];
  const payload = sanitizeForFirestore({
    name: String(data.name || 'Bez názvu').trim(),
    durationMin: data.durationMin != null ? Number(data.durationMin) : null,
    servings: Math.max(1, Number(data.servings) || 4),
    ingredients,
    steps: Array.isArray(data.steps) ? data.steps.map(String) : [],
    categories:
      Array.isArray(data.categories) && data.categories.length > 0
        ? data.categories
        : ['Vlastné'],
    imageUrl: data.imageUrl ?? null,
    tags: ['môj recept'],
    authorUid: uid,
    isUserRecipe: true,
    updatedAt: serverTimestamp(),
  });
  const ref = await addDoc(collection(db, COLLECTION), payload);
  invalidateListCache();
  return ref.id;
}


export async function setRecipePriceEstimate(recipeId, pricePerPortion) {
  if (!recipeId) return;
  const value = Number(pricePerPortion);
  if (!Number.isFinite(value) || value <= 0) return;
  try {
    const ref = doc(db, COLLECTION, recipeId);
    await updateDoc(ref, {
      pricePerPortionEstimate: Math.round(value * 100) / 100,
      pricePerPortionEstimateAt: serverTimestamp(),
    });
    const cached = _recipeCache.get(recipeId);
    if (cached?.value) {
      cached.value = {
        ...cached.value,
        pricePerPortionEstimate: Math.round(value * 100) / 100,
      };
      _recipeCache.set(recipeId, cached);
    }
  } catch (err) {
    if (typeof __DEV__ !== 'undefined' && __DEV__ && console?.warn) {
      console.warn('[recipes.setRecipePriceEstimate] failed', recipeId, err);
    }
  }
}

// Aktualizuje vlastný recept (iba autor).

export async function updateUserRecipe(uid, recipeId, partial) {
  if (!uid || !recipeId) return;
  const existing = await getRecipe(recipeId, { force: true });
  if (!existing || existing.authorUid !== uid) throw new Error('Not allowed');
  const ref = doc(db, COLLECTION, recipeId);
  const next = sanitizeForFirestore({
    ...partial,
    updatedAt: serverTimestamp(),
  });
  await updateDoc(ref, next);
  _recipeCache.delete(recipeId);
  invalidateListCache();
}

// Zmaže vlastný recept (iba autor).

export async function deleteUserRecipe(uid, recipeId) {
  if (!uid || !recipeId) return;
  const existing = await getRecipe(recipeId, { force: true });
  if (!existing || existing.authorUid !== uid) throw new Error('Not allowed');
  await deleteDoc(doc(db, COLLECTION, recipeId));
  _recipeCache.delete(recipeId);
  invalidateListCache();
}
