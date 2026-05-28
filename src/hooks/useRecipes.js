import { useEffect, useState, useCallback, useRef } from 'react';
import { listRecipesWithMine, getRecipe } from '../services/firestore/recipes';

// Zabráni zbytočnému setState pri rovnakom obsahu (nové pole z Firestore = iná referencia).

function listVisualFingerprint(list) {
  if (!Array.isArray(list)) return '';
  return list
    .map((r) =>
      [r?.id, r?.imageUrl, r?.name, r?.pricePerPortionEstimate, r?.durationMin, r?.servings].join('\u0001')
    )
    .join('|');
}


export function useRecipes(opts = {}) {
  const sharedKey = `shared|${opts.limit ?? 100}|${opts.category || ''}`;
  const cacheKey = `${opts.uid || 'anon'}|${opts.limit ?? 100}|${opts.category || ''}`;
  const cached = _store.get(cacheKey) || _store.get(sharedKey) || [];
  const [recipes, setRecipes] = useState(cached);
  const [loading, setLoading] = useState(cached.length === 0);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const refetch = useCallback(
    async (force = false) => {
      // Pokus o cache cez `listRecipesWithMine` s default `force: false`.
      // Ak je dáta v cache, prvé volanie sa vráti synchrónne rýchlo a UI sa neflashne.
      try {
        const cached = await listRecipesWithMine(opts.uid, {
          limit: opts.limit ?? 100,
          category: opts.category,
          force: false,
        });
        if (!mountedRef.current) return;
        setRecipes((prev) =>
          listVisualFingerprint(prev) === listVisualFingerprint(cached) ? prev : cached
        );
        _store.set(cacheKey, cached);
        _store.set(sharedKey, cached);
        setLoading(false);
      } catch {
        // ignor — pôjdeme rovno na čerstvý fetch
      }

      if (!force) return;

      const fresh = await listRecipesWithMine(opts.uid, {
        limit: opts.limit ?? 100,
        category: opts.category,
        force: true,
      });
      if (!mountedRef.current) return;
      setRecipes((prev) =>
        listVisualFingerprint(prev) === listVisualFingerprint(fresh) ? prev : fresh
      );
      _store.set(cacheKey, fresh);
      _store.set(sharedKey, fresh);
      setLoading(false);
    },
    [opts.limit, opts.category, opts.uid, cacheKey, sharedKey]
  );

  useEffect(() => {
    refetch();
  }, [refetch]);

  const getRecipeById = useCallback(async (id) => getRecipe(id), []);

  return { recipes, loading, refetch, getRecipeById };
}

const _store = new Map();

export default useRecipes;
