// Generuje položky nákupného zoznamu z receptov plánu.

export function aggregateIngredientsFromRecipes(recipes, recipeCounts) {
  const merged = new Map(); // key -> { name, qty, unit }

  for (const recipe of recipes) {
    const count = recipeCounts[recipe.id] ?? 1;
    const ingredients = recipe.ingredients ?? [];
    const baseServings = Math.max(1, recipe.servings ?? 1);

    for (const ing of ingredients) {
      const name = (ing.name || '').trim();
      if (!name) continue;
      const unit = (ing.unit || '').trim() || 'ks';
      const isPodlaChuti = unit.toLowerCase() === 'podľa chuti';
      const key = `${name.toLowerCase()}|${unit.toLowerCase()}`;

      if (isPodlaChuti) {
        if (!merged.has(key)) merged.set(key, { name, qty: null, unit });
        continue;
      }

      const qty = (ing.qty ?? 1) * count;
      if (merged.has(key)) {
        const existing = merged.get(key);
        merged.set(key, {
          name: existing.name,
          qty: existing.qty != null ? existing.qty + qty : qty,
          unit: existing.unit,
        });
      } else {
        merged.set(key, { name, qty, unit });
      }
    }
  }

  return Array.from(merged.values()).map((item, idx) => ({
    id: `i-${Date.now()}-${idx}`,
    name: item.name,
    qty: item.qty ?? undefined,
    unit: item.unit,
    checked: false,
  }));
}

export default aggregateIngredientsFromRecipes;
