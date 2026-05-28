// Súčet nákupného zoznamu: agregácia z plánu/receptov, špajza, zaokrúhlenie na balenia.
import { estimateIngredientCost, findBestOffer } from '../pricing/getPrice';
import { normalizeName, normalizeUnit, convert } from '../pricing/normalize';
import { PACK_SIZES, getCanonicalName } from '../normalize';
import { convertQtyToOfferUnit } from '../prices';
import { buildPantryIndex } from '../pricing/pantryIndex';

export function aggregateIngredients(recipes, pantryIndex) {
  const merged = new Map(); // nameNorm_unitBase -> {qtyBase, unitBase, fromPantry}
  
  for (const { recipe, count = 1 } of recipes) {
    const ingredients = recipe.ingredients || [];
    const recipeServings = Math.max(1, recipe.servings || 1);
    
    for (const ing of ingredients) {
      const name = typeof ing === 'string' ? ing : (ing.name || '');
      if (!name) continue;
      
      const nameNorm = normalizeName(name);
      const nameNormalized = nameNorm.replace(/\s+/g, '_');
      const qty = (ing.qty ?? 1) * count;
      const unitRaw = ing.unit || 'ks';
      const unitNorm = normalizeUnit(unitRaw);
      
      if (!unitNorm) continue;
      
      // Prepočítaj na základnú jednotku
      let qtyBase = qty;
      if (unitRaw === 'kg' && unitNorm === 'g') {
        qtyBase = convert(qty, 'kg', 'g');
      } else if (unitRaw === 'l' && unitNorm === 'ml') {
        qtyBase = convert(qty, 'l', 'ml');
      } else if (unitRaw === 'polievková lyžica' || unitRaw === 'pl' || unitRaw === 'pl.') {
        qtyBase = qty * 15;
      } else if (unitRaw === 'čajová lyžica' || unitRaw === 'cl' || unitRaw === 'čl' || unitRaw === 'čl.') {
        qtyBase = qty * 5;
      }
      
      const key = `${nameNormalized}_${unitNorm}`;
      const existing = merged.get(key);
      
      // Odpočítaj zo špajzy
      const pantryKey = key;
      const pantryItem = pantryIndex?.get(pantryKey);
      const fromPantry = pantryItem ? Math.min(qtyBase, pantryItem.qtyBase) : 0;
      const toBuy = Math.max(0, qtyBase - fromPantry);
      
      if (existing) {
        merged.set(key, {
          nameNorm: nameNormalized,
          qtyBase: existing.qtyBase + qtyBase,
          unitBase: unitNorm,
          fromPantry: existing.fromPantry + fromPantry,
          toBuy: existing.toBuy + toBuy,
        });
      } else {
        merged.set(key, {
          nameNorm: nameNormalized,
          qtyBase,
          unitBase: unitNorm,
          fromPantry,
          toBuy,
        });
      }
    }
  }
  
  return Array.from(merged.values());
}


export function alignPackageSizeToUnit(pkg, unitBase) {
  if (!pkg || pkg.qty == null) return null;
  const q = Number(pkg.qty);
  if (!Number.isFinite(q) || q <= 0) return null;
  const u = String(pkg.unit || unitBase).toLowerCase();
  if (unitBase === 'g') {
    if (u === 'g') return { qty: q, unit: 'g' };
    if (u === 'kg') return { qty: q * 1000, unit: 'g' };
    return null;
  }
  if (unitBase === 'ml') {
    if (u === 'ml') return { qty: q, unit: 'ml' };
    if (u === 'l') return { qty: q * 1000, unit: 'ml' };
    if (u === 'dcl') return { qty: q * 100, unit: 'ml' };
    return null;
  }
  if (unitBase === 'ks' && u === 'ks') return { qty: q, unit: 'ks' };
  return null;
}


function inferDefaultPackageSize(item, bestOffer) {
  const o = bestOffer?.offer;
  if (!o) return null;
  if (o.packageSize) return o.packageSize;
  const raw = String(o.rawUnit || '').toLowerCase().trim();
  if (item.unitBase === 'g' && raw === 'kg') {
    return { qty: 1000, unit: 'g' };
  }
  if (item.unitBase === 'ml' && raw === 'l') {
    return { qty: 1000, unit: 'ml' };
  }
  if (item.unitBase === 'ml' && raw === 'dcl') {
    return { qty: 100, unit: 'ml' };
  }
  if (item.unitBase === 'ks') {
    const stripped = String(item.nameNorm || '').replace(/_(ks|kg|g|l|ml)$/, '');
    const known = PACK_SIZES[stripped];
    if (known && known > 1) return { qty: known, unit: 'ks' };
    return { qty: 1, unit: 'ks' };
  }
  return null;
}


export function roundToPackages(qtyBase, unitBase, offer) {
  if (!offer || !offer.packageSize) {
    return { roundedQty: qtyBase, packages: 1 };
  }

  const aligned = alignPackageSizeToUnit(offer.packageSize, unitBase);
  if (!aligned) {
    return { roundedQty: qtyBase, packages: 1 };
  }

  const packageSize = aligned.qty || 1;
  const packages = Math.ceil(qtyBase / packageSize);
  const roundedQty = packages * packageSize;

  return { roundedQty, packages };
}


export async function calcListCost(items, prefer, doRoundToPackages = false, uid) {
  let estTotalEur = 0;
  let savedByPantry = 0;
  const numItems = items.length;
  const itemsWithPrice = [];

  for (const item of items) {
    const toBuyQty = item.toBuy || item.qtyBase;

    if (toBuyQty <= 0) {
      itemsWithPrice.push({
        ...item,
        estEur: 0,
        packages: null,
        rounded: false,
      });
      continue;
    }

    // Nájdi ponuku
    const bestOffer = await findBestOffer(item.nameNorm, prefer, uid);

    if (!bestOffer) {
      itemsWithPrice.push({
        ...item,
        estEur: null,
        packages: null,
        rounded: false,
      });
      continue;
    }

    let finalQty = toBuyQty;
    let packages = null;
    let rounded = false;

    if (doRoundToPackages) {
      const pkgRaw = inferDefaultPackageSize(item, bestOffer);
      const pkgAligned = pkgRaw ? alignPackageSizeToUnit(pkgRaw, item.unitBase) : null;
      if (pkgAligned && pkgAligned.qty > 0) {
        const roundedResult = roundToPackages(toBuyQty, item.unitBase, { packageSize: pkgAligned });
        finalQty = roundedResult.roundedQty;
        packages = roundedResult.packages;
        rounded = roundedResult.roundedQty !== toBuyQty;
      }
    }

    const canonical = getCanonicalName(item.nameNorm);
    const finalQtyInOfferUnit = convertQtyToOfferUnit(finalQty, item.unitBase, bestOffer.unitBase, canonical);
    const fromPantryInOfferUnit = item.fromPantry > 0
      ? convertQtyToOfferUnit(item.fromPantry, item.unitBase, bestOffer.unitBase, canonical)
      : 0;

    const estEur = finalQtyInOfferUnit * bestOffer.pricePerBase;

    estTotalEur += estEur;

    if (fromPantryInOfferUnit > 0) {
      const pantryCost = fromPantryInOfferUnit * bestOffer.pricePerBase;
      savedByPantry += pantryCost;
    }

    itemsWithPrice.push({
      ...item,
      estEur,
      toBuyQty: finalQty,
      packages,
      rounded,
      store: bestOffer.store,
    });
  }
  
  return {
    estTotalEur: Math.round(estTotalEur * 100) / 100,
    savedByPantry: Math.round(savedByPantry * 100) / 100,
    numItems,
    items: itemsWithPrice,
  };
}

export default {
  aggregateIngredients,
  roundToPackages,
  calcListCost,
};
