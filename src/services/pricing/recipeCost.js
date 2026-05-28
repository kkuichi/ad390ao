// Cena receptu: ingrediencie × porcie, odpočet špajze, lookup cien z prices.
import { estimateIngredientCost } from './getPrice';
import { normalizeName, normalizeUnit, convert } from './normalize';
import { buildPantryIndex } from './pantryIndex';

// Koľko ingrediencií je plne pokrytých zo špajze (bez výpočtu cien).
export function summarizePantryCoverage(recipe, servings, pantryItems) {
  const empty = { lineCount: 0, atHomeCount: 0 };
  if (!recipe) return empty;
  const pantryMap = buildPantryIndex(pantryItems || []);

  const ingredients = recipe.ingredients || [];
  const recipeServings = Math.max(1, recipe.servings || 1);
  const targetServings = Math.max(
    1,
    Number.isFinite(Number(servings)) && Number(servings) > 0 ? Number(servings) : recipeServings
  );
  const scale = targetServings / recipeServings;

  let lineCount = 0;
  let atHomeCount = 0;

  for (const ing of ingredients) {
    const name = typeof ing === 'string' ? ing : (ing.name || '');
    if (!name) continue;

    const nameNorm = normalizeName(name);
    const nameNormalized = nameNorm.replace(/\s+/g, '_');
    const qty = (ing.qty ?? 1) * scale;
    const unitRaw = ing.unit || 'ks';
    const unitNorm = normalizeUnit(unitRaw);

    if (!unitNorm) continue;

    let neededQty = qty;
    if (unitRaw === 'kg' && unitNorm === 'g') {
      neededQty = convert(qty, 'kg', 'g');
    } else if (unitRaw === 'l' && unitNorm === 'ml') {
      neededQty = convert(qty, 'l', 'ml');
    } else if (unitRaw === 'polievková lyžica' || unitRaw === 'pl' || unitRaw === 'pl.') {
      neededQty = qty * 15;
    } else if (unitRaw === 'čajová lyžica' || unitRaw === 'cl' || unitRaw === 'čl' || unitRaw === 'čl.') {
      neededQty = qty * 5;
    } else if (unitRaw === 'hrnček' || unitRaw === 'hrnok') {
      neededQty = qty * 250;
    } else if (unitRaw === 'štipka') {
      neededQty = qty * 1;
    }

    const pantryKey = `${nameNormalized}_${unitNorm}`;
    const pantryItem = pantryMap.get(pantryKey);
    const fromPantryQty = pantryItem ? Math.min(neededQty, pantryItem.qtyBase) : 0;
    const toBuyQty = Math.max(0, neededQty - fromPantryQty);

    lineCount += 1;
    if (neededQty > 0 && toBuyQty <= 0) atHomeCount += 1;
  }

  return { lineCount, atHomeCount };
}

export async function estimateRecipeCost(recipe, servings, pantry, prefer, uid) {
  const ingredients = recipe.ingredients || [];
  const recipeServings = Math.max(1, recipe.servings || 1);
  // Recepty bez vyplneného `servings` (napr. nátierky) – defaultneme na nominálne
  // porcie receptu, aby sme nepočítali so `scale = NaN`.
  const targetServings = Math.max(
    1,
    Number.isFinite(Number(servings)) && Number(servings) > 0 ? Number(servings) : recipeServings
  );
  const scale = targetServings / recipeServings;
  
  const pantryMap = pantry instanceof Map ? pantry : (pantry?.items || new Map());
  const lineItems = [];
  let costPantry = 0;
  let costToBuy = 0;
  
  for (const ing of ingredients) {
    const name = typeof ing === 'string' ? ing : (ing.name || '');
    if (!name) continue;
    
    const nameNorm = normalizeName(name);
    const nameNormalized = nameNorm.replace(/\s+/g, '_');
    const qty = (ing.qty ?? 1) * scale;
    const unitRaw = ing.unit || 'ks';
    const unitNorm = normalizeUnit(unitRaw);
    
    if (!unitNorm) continue; // balenie preskočíme
    
    // Prepočítaj množstvo na základnú jednotku
    let neededQty = qty;
    if (unitRaw === 'kg' && unitNorm === 'g') {
      neededQty = convert(qty, 'kg', 'g');
    } else if (unitRaw === 'l' && unitNorm === 'ml') {
      neededQty = convert(qty, 'l', 'ml');
    } else if (unitRaw === 'polievková lyžica' || unitRaw === 'pl' || unitRaw === 'pl.') {
      neededQty = qty * 15;
    } else if (unitRaw === 'čajová lyžica' || unitRaw === 'cl' || unitRaw === 'čl' || unitRaw === 'čl.') {
      neededQty = qty * 5;
    } else if (unitRaw === 'hrnček' || unitRaw === 'hrnok') {
      neededQty = qty * 250;
    } else if (unitRaw === 'štipka') {
      neededQty = qty * 1;
    }
    
    // Skontroluj špajzu
    const pantryKey = `${nameNormalized}_${unitNorm}`;
    const pantryItem = pantryMap.get(pantryKey);
    const fromPantryQty = pantryItem ? Math.min(neededQty, pantryItem.qtyBase) : 0;
    const toBuyQty = Math.max(0, neededQty - fromPantryQty);
    
    // Odhad ceny vypočítame len raz pre celé potrebné množstvo a potom
    // ju pomerne rozdelíme na časť zo špajze vs časť na kúpu.
    let estEur = 0;
    let store = null;
    if (neededQty > 0) {
      const cost = await estimateIngredientCost(
        { name, qty: neededQty, unit: unitNorm },
        prefer,
        uid
      );
      if (cost) {
        const totalForNeeded = cost.estEur;
        store = cost.store;
        const ratioToBuy = neededQty > 0 ? toBuyQty / neededQty : 0;
        const ratioPantry = neededQty > 0 ? fromPantryQty / neededQty : 0;
        estEur = Math.round(totalForNeeded * ratioToBuy * 100) / 100;
        costToBuy += estEur;
        costPantry += Math.round(totalForNeeded * ratioPantry * 100) / 100;
      }
    }
    
    lineItems.push({
      name,
      nameNormalized,
      neededQty,
      unitBase: unitNorm,
      fromPantryQty,
      toBuyQty,
      estEur,
      inPantry: fromPantryQty > 0,
      store,
    });
  }
  
  const totalEur = costPantry + costToBuy;
  const perServing = targetServings > 0 ? totalEur / targetServings : 0;
  
  return {
    costPantry,
    costToBuy,
    perServing: Math.round(perServing * 100) / 100,
    totalEur: Math.round(totalEur * 100) / 100,
    lineItems,
  };
}


export function getCacheKey(recipeId, servings, pantryHash) {
  return `recipe:${recipeId}:servings:${servings}:pantry:${pantryHash || 'none'}`;
}

export default {
  estimateRecipeCost,
  summarizePantryCoverage,
  getCacheKey,
};
