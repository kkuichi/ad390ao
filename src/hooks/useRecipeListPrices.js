// Batch ceny pre zoznam receptov (max CONCURRENCY paralelne, modulová cache).


import { useEffect, useState } from 'react';
import { estimateRecipeCost } from '../services/pricing/recipeCost';

const _priceCache = new Map(); // recipeId|prefer -> { perServing, ts }
const TTL = 30 * 60 * 1000;
const CONCURRENCY = 3;

function cacheKey(recipeId, prefer, uid) {
  return `${recipeId}|${(prefer || '').toUpperCase()}|${uid || ''}`;
}

export function clearRecipeListPriceCache() {
  _priceCache.clear();
}


export function useRecipeListPrices(recipes, opts = {}) {
  const { uid, preferredStore } = opts;
  const [prices, setPrices] = useState({});

  const recipesKey = Array.isArray(recipes)
    ? recipes.map((r) => `${r?.id}:${r?.pricePerPortionEstimate ?? ''}`).join('|')
    : '';

  useEffect(() => {
    if (!Array.isArray(recipes) || recipes.length === 0) {
      setPrices({});
      return undefined;
    }

    const initial = {};
    for (const r of recipes) {
      if (!r?.id) continue;
      const cached = _priceCache.get(cacheKey(r.id, preferredStore, uid));
      if (cached && Date.now() - cached.ts < TTL && cached.perServing > 0) {
        initial[r.id] = cached.perServing;
      } else if (
        !uid &&
        typeof r.pricePerPortionEstimate === 'number' &&
        r.pricePerPortionEstimate > 0
      ) {
        initial[r.id] = r.pricePerPortionEstimate;
      }
    }
    setPrices(initial);

    // 2) Postavíme front pre tých, kde nemáme rozumnú cenu.
    const queue = recipes.filter((r) => {
      if (!r?.id) return false;
      const cached = _priceCache.get(cacheKey(r.id, preferredStore, uid));
      if (cached && Date.now() - cached.ts < TTL && cached.perServing > 0) return false;
      if (uid) {
        return true;
      }
      const stored = Number(r.pricePerPortionEstimate || 0);
      return !(stored > 0);
    });

    if (queue.length === 0) return undefined;

    let cancelled = false;
    let running = 0;
    let i = 0;

    const next = () => {
      while (running < CONCURRENCY && i < queue.length && !cancelled) {
        const r = queue[i];
        i += 1;
        running += 1;
        const targetServings = Math.max(1, Number(r?.servings) || 1);
        estimateRecipeCost(r, targetServings, null, preferredStore, uid)
          .then((result) => {
            if (cancelled) return;
            const ps = result?.perServing;
            if (Number.isFinite(ps) && ps > 0) {
              _priceCache.set(cacheKey(r.id, preferredStore, uid), {
                perServing: ps,
                ts: Date.now(),
              });
              setPrices((prev) => ({ ...prev, [r.id]: ps }));
            }
          })
          .catch((err) => {
            if (typeof __DEV__ !== 'undefined' && __DEV__ && console?.warn) {
              console.warn('[useRecipeListPrices] failed', r?.id, err);
            }
          })
          .finally(() => {
            running -= 1;
            if (!cancelled) next();
          });
      }
    };
    next();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recipesKey, uid, preferredStore]);

  return prices;
}

export default useRecipeListPrices;
