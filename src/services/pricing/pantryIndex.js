// Mapa špajze: kľúč name_unit → množstvo v g/ml/ks.
import { normalizeName, normalizeUnit, convert } from './normalize';

export function buildPantryIndex(items) {
  const index = new Map();
  
  if (!items || !Array.isArray(items)) return index;
  
  for (const item of items) {
    const name = item.name || '';
    if (!name) continue;
    
    const nameNorm = normalizeName(name);
    const nameNormalized = nameNorm.replace(/\s+/g, '_');
    const qty = item.qty || 0;
    const unitRaw = item.unit || 'ks';
    const unitNorm = normalizeUnit(unitRaw);
    
    if (!unitNorm) continue;
    
    // Prepočítaj na základnú jednotku
    let qtyBase = qty;
    if (unitRaw === 'kg' && unitNorm === 'g') {
      qtyBase = convert(qty, 'kg', 'g');
    } else if (unitRaw === 'l' && unitNorm === 'ml') {
      qtyBase = convert(qty, 'l', 'ml');
    }
    
    const key = `${nameNormalized}_${unitNorm}`;
    const existing = index.get(key);
    
    if (existing) {
      // Ak už existuje, sčítaj množstvá
      index.set(key, {
        qtyBase: existing.qtyBase + qtyBase,
        unitBase: unitNorm,
      });
    } else {
      index.set(key, {
        qtyBase,
        unitBase: unitNorm,
      });
    }
  }
  
  return index;
}

export default {
  buildPantryIndex,
};
