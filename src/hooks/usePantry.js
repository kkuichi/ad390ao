// Hook: práca so špajzou (pridanie, úprava, mazanie, zlučovanie duplikátov).
import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import {
  getPantryItems,
  addPantryItem,
  updatePantryItem,
  deletePantryItem,
  mergeDuplicatePantryItems,
  buildPantryContext,
} from '../services/firestore/pantry';

function normalizePantryName(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');
}

function canonicalUnit(unit) {
  const v = String(unit || 'ks').trim().toLowerCase();
  if (v === 'kg' || v === 'g') return 'g';
  if (v === 'l' || v === 'ml') return 'ml';
  if (v === 'ks' || v === 'pc' || v === 'pcs' || v === 'kus' || v === 'kusy') return 'ks';
  return v || 'ks';
}

function toCanonicalQty(qty, unit) {
  const n = Number(qty) || 0;
  const v = String(unit || 'ks').trim().toLowerCase();
  if (v === 'kg' || v === 'l') return n * 1000;
  return n;
}

function dedupePantryItems(items) {
  const groups = new Map();
  for (const it of items || []) {
    const nameKey = normalizePantryName(it?.name);
    const unitKey = canonicalUnit(it?.unit);
    const key = `${nameKey}|${unitKey}`;
    if (!groups.has(key)) {
      groups.set(key, {
        id: it?.id,
        name: String(it?.name || '').trim(),
        qty: toCanonicalQty(it?.qty, it?.unit),
        unit: unitKey,
        expiresAt: typeof it?.expiresAt === 'string' ? it.expiresAt : null,
        updatedAt: it?.updatedAt || null,
      });
      continue;
    }
    const prev = groups.get(key);
    prev.qty += toCanonicalQty(it?.qty, it?.unit);
    if (!prev.expiresAt) prev.expiresAt = typeof it?.expiresAt === 'string' ? it.expiresAt : null;
    else if (typeof it?.expiresAt === 'string') {
      prev.expiresAt =
        new Date(it.expiresAt).getTime() < new Date(prev.expiresAt).getTime() ? it.expiresAt : prev.expiresAt;
    }
  }
  return [...groups.values()];
}


export function usePantry(uid, opts = {}) {
  const householdId = opts?.householdId ?? null;
  const ctx = useMemo(() => {
    if (!uid) return null;
    return buildPantryContext(uid, householdId);
  }, [uid, householdId]);
  const storeKey = useMemo(() => {
    if (!uid) return null;
    if (ctx?.type === 'household') return `h:${ctx.householdId}`;
    return `u:${uid}`;
  }, [uid, ctx]);

  const cached = storeKey ? _store.get(storeKey) : null;
  const [items, setItems] = useState(cached || []);
  const [loading, setLoading] = useState(cached == null);
  const lastKeyRef = useRef(storeKey);

  const refetch = useCallback(async () => {
    if (!ctx || !storeKey) {
      if (storeKey) {
        _store.delete(storeKey);
        _emit(storeKey, []);
      }
      setItems([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const list = await getPantryItems(ctx);
      const deduped = dedupePantryItems(list);
      _store.set(storeKey, deduped);
      _emit(storeKey, deduped);
    } catch (e) {
      if (typeof __DEV__ !== 'undefined' && __DEV__ && console?.warn) {
        console.warn('[usePantry] refetch failed:', e);
      }
      _store.set(storeKey, []);
      _emit(storeKey, []);
    } finally {
      setLoading(false);
    }
  }, [ctx, storeKey]);

  useEffect(() => {
    if (!ctx || !storeKey) {
      setItems([]);
      setLoading(false);
      return undefined;
    }
    const unsub = _subscribe(storeKey, (next) => {
      setItems(next);
      setLoading(false);
    });
    if (lastKeyRef.current !== storeKey || !_store.has(storeKey)) {
      lastKeyRef.current = storeKey;
      getPantryItems(ctx)
        .then((list) => {
          const deduped = dedupePantryItems(list);
          _store.set(storeKey, deduped);
          _emit(storeKey, deduped);
        })
        .catch((e) => {
          if (typeof __DEV__ !== 'undefined' && __DEV__ && console?.warn) {
            console.warn('[usePantry] initial fetch failed:', e);
          }
          _store.set(storeKey, []);
          _emit(storeKey, []);
        });
      return unsub;
    }
    setItems(_store.get(storeKey) || []);
    setLoading(false);
    return unsub;
  }, [ctx, storeKey]);

  const add = useCallback(
    async (data) => {
      if (!ctx) throw new Error('Not authenticated');
      const id = await addPantryItem(ctx, data);
      const current = _store.get(storeKey) || [];
      const normalizedName = normalizePantryName(data?.name || '');
      const normalizedUnit = canonicalUnit(data?.unit || 'ks');
      const existingIdx = current.findIndex(
        (it) =>
          normalizePantryName(it?.name || '') === normalizedName
          && canonicalUnit(it?.unit || 'ks') === normalizedUnit
      );
      let next = current;
      if (existingIdx >= 0) {
        next = [...current];
        const prev = next[existingIdx];
        next[existingIdx] = {
          ...prev,
          qty: toCanonicalQty(prev?.qty, prev?.unit) + toCanonicalQty(data?.qty || 1, data?.unit || 'ks'),
          unit: normalizedUnit,
          expiresAt: prev?.expiresAt || data?.expiresAt || null,
        };
      } else {
        next = [...current, { id, ...data }];
      }
      _store.set(storeKey, next);
      _emit(storeKey, next);
      getPantryItems(ctx)
        .then((list) => {
          const deduped = dedupePantryItems(list);
          _store.set(storeKey, deduped);
          _emit(storeKey, deduped);
        })
        .catch(() => {});
      return id;
    },
    [ctx, storeKey]
  );

  const update = useCallback(
    async (itemId, data) => {
      if (!ctx) return;
      await updatePantryItem(ctx, itemId, data);
      const current = _store.get(storeKey) || [];
      const next = dedupePantryItems(current.map((it) => (it.id === itemId ? { ...it, ...data } : it)));
      _store.set(storeKey, next);
      _emit(storeKey, next);
    },
    [ctx, storeKey]
  );

  const remove = useCallback(
    async (itemId) => {
      if (!ctx) return;
      await deletePantryItem(ctx, itemId);
      const current = _store.get(storeKey) || [];
      const next = dedupePantryItems(current.filter((it) => it.id !== itemId));
      _store.set(storeKey, next);
      _emit(storeKey, next);
    },
    [ctx, storeKey]
  );

  const mergeDuplicates = useCallback(async () => {
    if (!ctx) return false;
    const changed = await mergeDuplicatePantryItems(ctx);
    const list = await getPantryItems(ctx);
    const deduped = dedupePantryItems(list);
    _store.set(storeKey, deduped);
    _emit(storeKey, deduped);
    return changed;
  }, [ctx, storeKey]);

  return { items, loading, refetch, add, update, remove, mergeDuplicates, pantryCtx: ctx };
}

const _store = new Map();
const _subs = new Map();

function _subscribe(storeKey, fn) {
  if (!storeKey) return () => {};
  if (!_subs.has(storeKey)) _subs.set(storeKey, new Set());
  const set = _subs.get(storeKey);
  set.add(fn);
  return () => set.delete(fn);
}

function _emit(storeKey, value) {
  const set = _subs.get(storeKey);
  if (!set) return;
  for (const fn of set) {
    try {
      fn(value);
    } catch {
      // subscriber chyby nesmú zhodiť ostatných
    }
  }
}

export default usePantry;
