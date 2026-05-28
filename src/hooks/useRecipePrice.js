// Hook pre odhad ceny receptu so skeleton hodnotami a krátkou cache.


import { useState, useEffect, useMemo } from 'react';
import { getRecipe } from '../services/firestore/recipes';
import { getProfile } from '../services/firestore/profiles';
import { getPantryItems, buildUserPantryContext } from '../services/firestore/pantry';
import { estimateRecipeCost } from '../services/pricing/recipeCost';
import { buildPantryIndex } from '../services/pricing/pantryIndex';

const _resultCache = new Map(); // key -> { ts, value }
const RESULT_TTL = 5 * 60 * 1000;

function pantrySignature(pantry) {
  if (!pantry) return 'none';
  const map = pantry instanceof Map ? pantry : pantry?.items;
  if (!map || map.size === 0) return 'empty';
  const parts = [];
  for (const [k, v] of map.entries()) {
    parts.push(`${k}:${Math.round((v?.qtyBase ?? 0) * 100) / 100}`);
  }
  parts.sort();
  return parts.join('|');
}

function buildKey(recipeId, servings, prefer, pantry) {
  return `${recipeId}|${servings}|${(prefer || '').toUpperCase()}|${pantrySignature(pantry)}`;
}


export function useRecipePrice(recipeId, servings, userId, opts) {
  const {
    pantryItems: externalPantry,
    preferredStore: externalPrefer,
    recipe: externalRecipe,
  } = opts || {};
  const [loading, setLoading] = useState(true);
  const [perServing, setPerServing] = useState(null);
  const [total, setTotal] = useState(null);
  const [lineItems, setLineItems] = useState([]);

  const pantryIndex = useMemo(
    () => (externalPantry ? buildPantryIndex(externalPantry) : null),
    [externalPantry]
  );

  useEffect(() => {
    if (!recipeId) {
      setLoading(false);
      setPerServing(null);
      setTotal(null);
      setLineItems([]);
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        const recipe = externalRecipe || (await getRecipe(recipeId));
        if (cancelled || !recipe) {
          setLoading(false);
          return;
        }

        const targetServings = servings ?? recipe.servings ?? 1;

        let prefer = externalPrefer ?? null;
        let pantry = pantryIndex;

        if (!pantry && userId) {
          try {
            const [profile, items] = await Promise.all([
              getProfile(userId),
              getPantryItems(buildUserPantryContext(userId)),
            ]);
            if (!externalPrefer) prefer = profile?.preferredStore;
            pantry = buildPantryIndex(items);
          } catch (err) {
            if (typeof __DEV__ !== 'undefined' && __DEV__ && console?.warn) {
              console.warn('[useRecipePrice] Failed to load profile/pantry:', err);
            }
          }
        }

        const key = buildKey(recipeId, targetServings, prefer, pantry);
        const cached = _resultCache.get(key);
        if (cached && Date.now() - cached.ts < RESULT_TTL) {
          if (!cancelled) {
            setPerServing(cached.value.perServing);
            setTotal(cached.value.totalEur);
            setLineItems(cached.value.lineItems);
            setLoading(false);
          }
          return;
        }

        // Pokiaľ ešte nemáme cache, krátko zobraz skeleton.
        if (!cancelled) setLoading(true);

        const result = await estimateRecipeCost(recipe, targetServings, pantry, prefer, userId);
        _resultCache.set(key, { ts: Date.now(), value: result });

        if (!cancelled) {
          setPerServing(result.perServing);
          setTotal(result.totalEur);
          setLineItems(result.lineItems);
          setLoading(false);
        }
      } catch (error) {
        if (!cancelled) {
          if (typeof __DEV__ !== 'undefined' && __DEV__ && console?.warn) {
            console.warn('[useRecipePrice] Failed:', recipeId, error);
          }
          setPerServing(null);
          setTotal(null);
          setLineItems([]);
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [recipeId, servings, userId, pantryIndex, externalPrefer, externalRecipe]);

  return {
    loading,
    perServing,
    total,
    lineItems,
  };
}

export function clearRecipePriceCache() {
  _resultCache.clear();
}

export default useRecipePrice;
