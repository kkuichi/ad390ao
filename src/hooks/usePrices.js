// Hooky pre odhad cien receptov a plánov.


import { useState, useEffect } from 'react';
import { estimateIngredientCost } from '../services/prices';
import { getRecipe } from '../services/firestore/recipes';
import { aggregateIngredients, calcListCost } from '../services/shopping/calcList';
import { buildPantryIndex } from '../services/pricing/pantryIndex';


export function useRecipeCost(recipeId, profile, uid) {
  const [totalEur, setTotalEur] = useState(null);
  const [perServingEur, setPerServingEur] = useState(null);
  const [unresolved, setUnresolved] = useState([]);
  const [loading, setLoading] = useState(true);
  
  useEffect(() => {
    if (!recipeId) {
      setTotalEur(null);
      setPerServingEur(null);
      setUnresolved([]);
      setLoading(false);
      return;
    }
    
    let cancelled = false;
    setLoading(true);
    
    (async () => {
      try {
        const recipe = await getRecipe(recipeId);
        if (cancelled || !recipe) {
          setTotalEur(null);
          setPerServingEur(null);
          setUnresolved([]);
          setLoading(false);
          return;
        }
        
        const ingredients = recipe.ingredients || [];
        if (ingredients.length === 0) {
          setTotalEur(0);
          setPerServingEur(0);
          setUnresolved([]);
          setLoading(false);
          return;
        }
        
        let total = 0;
        const unresolvedNames = [];
        
        for (const ing of ingredients) {
          const name = typeof ing === 'string' ? ing : (ing.name || '');
          if (!name) continue;
          
          const cost = await estimateIngredientCost(
            { name, qty: ing.qty, unit: ing.unit },
            profile || {},
            uid
          );
          
          if (cost.euro > 0) {
            total += cost.euro;
          } else if (cost.matched == null) {
            unresolvedNames.push(name);
          }
        }
        
        if (!cancelled) {
          const servings = Math.max(1, recipe.servings || 1);
          setTotalEur(Math.round(total * 100) / 100);
          setPerServingEur(Math.round((total / servings) * 100) / 100);
          setUnresolved(unresolvedNames);
          setLoading(false);
        }
      } catch (error) {
        if (!cancelled) {
          if (typeof __DEV__ !== 'undefined' && __DEV__ && console?.warn) {
            console.warn('[useRecipeCost] failed:', recipeId, error);
          }
          setTotalEur(null);
          setPerServingEur(null);
          setUnresolved([]);
          setLoading(false);
        }
      }
    })();
    
    return () => { cancelled = true; };
  }, [recipeId, profile?.preferredStore, uid]);
  
  return { totalEur, perServingEur, unresolved, loading };
}


function getMealEntriesFromPlan(days) {
  const out = [];
  const arr = Array.isArray(days) ? days : days ? Object.values(days) : [];
  for (const day of arr) {
    if (!day || typeof day !== 'object') continue;
    const meals = day.meals || { breakfast: [], lunch: [], dinner: day.recipes || [] };
    const all = [
      ...(meals.breakfast || []),
      ...(meals.lunch || []),
      ...(meals.dinner || []),
    ];
    for (const entry of all) {
      if (!entry) continue;
      if (typeof entry === 'string') {
        out.push({ recipeId: entry, servings: null });
      } else if (typeof entry === 'object' && entry.recipeId) {
        const raw = Number(entry.servings);
        const servings = Number.isFinite(raw) && raw > 0 ? raw : null;
        out.push({ recipeId: String(entry.recipeId), servings });
      }
    }
  }
  return out;
}


export function usePlanCost(weekPlan, profile, pantryItems, roundToPackages = false, uid) {
  const [totalEur, setTotalEur] = useState(null);
  const [savedByPantry, setSavedByPantry] = useState(null);
  const [unresolved, setUnresolved] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!weekPlan || !weekPlan.days) {
      setTotalEur(null);
      setSavedByPantry(null);
      setUnresolved([]);
      setLoading(false);
      return;
    }

    const days = weekPlan.days;
    const entries = getMealEntriesFromPlan(days);
    const uniqueRecipeIds = Array.from(new Set(entries.map((e) => e.recipeId)));
    if (uniqueRecipeIds.length === 0) {
      setTotalEur(0);
      setSavedByPantry(0);
      setUnresolved([]);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);

    (async () => {
      try {
        const pantryIndex = buildPantryIndex(pantryItems || []);
        const hasPantry = pantryIndex && pantryIndex.size > 0;

        // Načítaj recepty raz, aby sme vedeli ich nominálne porcie pre prepočet
        // entry.servings → scale (kto-koľkokrát „celý recept" treba uvariť).
        const recipesById = {};
        for (const id of uniqueRecipeIds) {
          if (cancelled) return;
          const r = await getRecipe(id);
          if (r) recipesById[id] = r;
        }
        if (cancelled) return;

        const recipeScales = {};
        for (const e of entries) {
          const recipe = recipesById[e.recipeId];
          if (!recipe) continue;
          const nominal = Math.max(1, Number(recipe.servings) || 1);
          const planned = e.servings != null && e.servings > 0 ? Number(e.servings) : nominal;
          recipeScales[e.recipeId] = (recipeScales[e.recipeId] || 0) + planned / nominal;
        }

        if (hasPantry) {
          // Odhad „čo kúpiť" – agregácia so špajzou, potom ceny
          const recipes = [];
          for (const recipeId of uniqueRecipeIds) {
            const recipe = recipesById[recipeId];
            if (recipe) recipes.push({ recipe, count: recipeScales[recipeId] ?? 1 });
          }
          const aggregated = aggregateIngredients(recipes, pantryIndex);
          const result = await calcListCost(
            aggregated,
            profile?.preferredStore,
            roundToPackages,
            uid
          );
          if (!cancelled) {
            setTotalEur(result.estTotalEur);
            setSavedByPantry(result.savedByPantry ?? 0);
            setUnresolved([]);
            setLoading(false);
          }
          return;
        }

        // Bez špajzy: súčet cien všetkých ingrediencií škálovaných cez scale
        let total = 0;
        const allUnresolved = [];
        for (const recipeId of uniqueRecipeIds) {
          if (cancelled) break;
          const recipe = recipesById[recipeId];
          if (!recipe) continue;
          const scale = recipeScales[recipeId] ?? 1;
          const ingredients = recipe.ingredients || [];
          for (const ing of ingredients) {
            const name = typeof ing === 'string' ? ing : ing.name || '';
            if (!name) continue;
            const qty = (ing.qty ?? 1) * scale;
            const cost = await estimateIngredientCost(
              { name, qty, unit: ing.unit },
              profile || {},
              uid
            );
            if (cost.euro > 0) {
              total += cost.euro;
            } else if (cost.matched == null) {
              if (!allUnresolved.includes(name)) allUnresolved.push(name);
            }
          }
        }
        if (!cancelled) {
          setTotalEur(Math.round(total * 100) / 100);
          setSavedByPantry(null);
          setUnresolved(allUnresolved);
          setLoading(false);
        }
      } catch (error) {
        if (!cancelled) {
          if (typeof __DEV__ !== 'undefined' && __DEV__ && console?.warn) {
            console.warn('[usePlanCost] failed:', error);
          }
          setTotalEur(null);
          setSavedByPantry(null);
          setUnresolved([]);
          setLoading(false);
        }
      }
    })();

    return () => { cancelled = true; };
  }, [weekPlan, profile?.preferredStore, pantryItems, roundToPackages, uid]);

  return { totalEur, savedByPantry, unresolved, loading };
}

export default {
  useRecipeCost,
  usePlanCost,
};
