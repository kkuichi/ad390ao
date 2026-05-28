// Zlúčenie položiek nákupného zoznamu so zhodným produktom + jednotkou.


import { toNameNormKey } from './ingredientNorm';
import { normalizeUnit, convert } from '../services/pricing/normalize';


function toBaseQty(qty, unit) {
  const unitRaw = (unit || 'ks').trim().toLowerCase();
  const unitBase = normalizeUnit(unitRaw);
  if (!unitBase) return null;

  const num = typeof qty === 'number' ? qty : Number(qty);
  if (!Number.isFinite(num)) return { qtyBase: 0, unitBase };

  let qtyBase = num;
  if (unitRaw === 'kg' && unitBase === 'g') qtyBase = convert(num, 'kg', 'g');
  else if (unitRaw === 'l' && unitBase === 'ml') qtyBase = convert(num, 'l', 'ml');
  else if (unitRaw === 'polievková lyžica' || unitRaw === 'polievkova lyzica' || unitRaw === 'pl' || unitRaw === 'pl.') qtyBase = num * 15;
  else if (unitRaw === 'čajová lyžica' || unitRaw === 'cajova lyzica' || unitRaw === 'čl' || unitRaw === 'cl' || unitRaw === 'lyzicka' || unitRaw === 'lyžička') qtyBase = num * 5;
  else if (unitRaw === 'hrnček' || unitRaw === 'hrncek' || unitRaw === 'hrnok') qtyBase = num * 250;
  else if (unitRaw === 'štipka' || unitRaw === 'stipka') qtyBase = num * 1;

  return { qtyBase, unitBase };
}


export function mergeShoppingItems(items) {
  if (!Array.isArray(items) || items.length === 0) return [];

  const merged = new Map(); // key -> mergedItem
  const passthrough = []; // položky bez baseUnit (napr. „balenie")

  for (const item of items) {
    if (!item || !item.name) continue;
    const nameKey = toNameNormKey(item.name);
    const base = toBaseQty(item.qty, item.unit);

    if (!nameKey || !base) {
      passthrough.push({
        id: item.id,
        name: item.name,
        qty: item.qty ?? null,
        unit: item.unit ?? 'ks',
        checked: !!item.checked,
      });
      continue;
    }

    const key = `${nameKey}|${base.unitBase}`;
    const existing = merged.get(key);

    if (existing) {
      const existingQty = typeof existing.qty === 'number' ? existing.qty : 0;
      const newQty = existingQty + (base.qtyBase || 0);
      merged.set(key, {
        ...existing,
        qty: Math.round(newQty * 100) / 100,
        // checked zostane true len ak boli všetky pôvodné checked
        checked: existing.checked && !!item.checked,
      });
    } else {
      merged.set(key, {
        id: item.id, // zachová stabilný ID prvej položky (kvôli checkbox stavu)
        name: item.name, // zachová pôvodné formátovanie z receptu
        qty: Math.round((base.qtyBase || 0) * 100) / 100,
        unit: base.unitBase,
        checked: !!item.checked,
      });
    }
  }

  return [...merged.values(), ...passthrough];
}

export default mergeShoppingItems;
