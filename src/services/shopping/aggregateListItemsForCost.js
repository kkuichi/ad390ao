// Agregácia položiek nákupného zoznamu pre prepočet celkovej ceny so zohľadnením špajze.
import { buildPantryIndex } from '../pricing/pantryIndex';
import { normalizeName, normalizeUnit, convert } from '../pricing/normalize';


export function aggregateShoppingListItemsForCost(items, pantryItems) {
  const pantryIndex = buildPantryIndex(pantryItems || []);
  return (items || [])
    .map((item) => {
      const name = typeof item === 'string' ? item : item?.name;
      if (!name) return null;

      const nameNorm = normalizeName(name);
      const nameNormalized = nameNorm.replace(/\s+/g, '_');
      const qty = item?.qty ?? 1;
      const unitRaw = item?.unit || 'ks';
      const unitNorm = normalizeUnit(unitRaw);
      if (!unitNorm) return null;

      let qtyBase = qty;
      if (unitRaw === 'kg' && unitNorm === 'g') {
        qtyBase = convert(qtyBase, 'kg', 'g');
      } else if (unitRaw === 'l' && unitNorm === 'ml') {
        qtyBase = convert(qtyBase, 'l', 'ml');
      } else if (unitRaw === 'polievková lyžica' || unitRaw === 'pl' || unitRaw === 'pl.') {
        qtyBase = qtyBase * 15;
      } else if (unitRaw === 'čajová lyžica' || unitRaw === 'cl' || unitRaw === 'čl' || unitRaw === 'čl.') {
        qtyBase = qtyBase * 5;
      } else if (unitRaw === 'hrnček' || unitRaw === 'hrnok') {
        qtyBase = qtyBase * 250;
      } else if (unitRaw === 'štipka') {
        qtyBase = qtyBase * 1;
      }

      const pantryKey = `${nameNormalized}_${unitNorm}`;
      const pantryItem = pantryIndex.get(pantryKey);
      const fromPantry = pantryItem ? Math.min(qtyBase, pantryItem.qtyBase) : 0;
      const toBuy = Math.max(0, qtyBase - fromPantry);

      return {
        nameNorm: nameNormalized,
        qtyBase,
        unitBase: unitNorm,
        fromPantry,
        toBuy,
      };
    })
    .filter(Boolean);
}
