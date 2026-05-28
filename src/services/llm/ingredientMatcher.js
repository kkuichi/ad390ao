// Cache mapovania ingrediencia → produkt (predgenerované batch-match-ingredients.js).

import { doc, getDoc } from 'firebase/firestore';
import { db } from '../../firebase';
import { toSlugForPrice } from '../normalize';

const CACHE_COLLECTION = 'ingredient_price_mappings';

function cacheKey(name, qty, unit) {
  const slug = toSlugForPrice(name);
  return `${slug}_${qty ?? 1}_${(unit || 'ks').toLowerCase()}`;
}

const NO_MATCH = { matchedDocId: null, qtyInProductUnit: 0, confidence: 0, explanation: 'not in cache' };

export async function matchIngredientToProduct(ingredient) {
  if (!ingredient?.name) return NO_MATCH;

  const key = cacheKey(ingredient.name, ingredient.qty, ingredient.unit);

  try {
    const snap = await getDoc(doc(db, CACHE_COLLECTION, key));
    if (!snap.exists()) return NO_MATCH;

    const data = snap.data();

    return {
      matchedDocId: data.matchedDocId || null,
      qtyInProductUnit: data.qtyInProductUnit ?? 0,
      confidence: data.confidence ?? 0,
      explanation: data.explanation ?? 'from cache',
    };
  } catch {
    return NO_MATCH;
  }
}

export default { matchIngredientToProduct };
