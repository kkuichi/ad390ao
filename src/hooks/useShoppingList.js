// Hook: správa nákupných zoznamov (vytváranie, položky, odškrtávanie, stav).
import { useEffect, useState, useCallback, useMemo } from 'react';
import {
  getShoppingLists,
  getShoppingList,
  createShoppingList,
  updateShoppingList,
  addItemToList,
  addItemsToList,
  toggleListItemChecked,
  setListStatus,
  getCompletedLists,
  removeListItem,
  buildShoppingContext,
} from '../services/firestore/shoppingLists';
import { mergeShoppingItems } from '../utils/mergeShoppingItems';

// @param {string | undefined} uid
// @param {{ householdId?: string | null }} [opts] - ak je householdId, zoznam je households/{id}/lists

export function useShoppingList(uid, opts = {}) {
  const { householdId = null, listId: explicitListId } = opts;
  const shoppingCtx = useMemo(
    () => buildShoppingContext(uid, householdId || null),
    [uid, householdId]
  );

  const [lists, setLists] = useState([]);
  const [activeList, setActiveList] = useState(null);
  const [loading, setLoading] = useState(true);

  const refetch = useCallback(
    async (fromServer = false) => {
      if (!shoppingCtx) {
        setLists([]);
        setActiveList(null);
        setLoading(false);
        return;
      }
      setLoading(true);
      try {
        const all = await getShoppingLists(shoppingCtx, fromServer);
        setLists(all);
        const activeLists = all.filter((l) => l.status !== 'completed');
        const toMs = (v) =>
          v?.updatedAt && typeof v.updatedAt.toMillis === 'function'
            ? v.updatedAt.toMillis()
            : typeof v?.updatedAt === 'number'
              ? v.updatedAt
              : 0;
        const sortedByUpdated = [...activeLists].sort((a, b) => toMs(b) - toMs(a));
        const active = sortedByUpdated[0];
        const id = explicitListId || active?.id;
        if (id) {
          let one = await getShoppingList(shoppingCtx, id, fromServer);
          let normalized = one?.status !== 'completed' ? one : null;
          if (normalized && Array.isArray(normalized.items) && normalized.items.length > 0) {
            const merged = mergeShoppingItems(normalized.items);
            if (merged.length < normalized.items.length) {
              try {
                await updateShoppingList(shoppingCtx, id, merged);
                normalized = { ...normalized, items: merged };
              } catch (err) {
                if (typeof __DEV__ !== 'undefined' && __DEV__ && console?.warn) {
                  console.warn('[useShoppingList] auto-merge persist failed:', err);
                }
                normalized = { ...normalized, items: merged };
              }
            }
          }
          setActiveList(normalized);
        } else {
          setActiveList(null);
        }
      } catch (e) {
        if (typeof __DEV__ !== 'undefined' && __DEV__ && console?.warn) {
          console.warn('[useShoppingList] refetch failed:', e);
        }
        setLists([]);
        setActiveList(null);
      } finally {
        setLoading(false);
      }
    },
    [shoppingCtx, explicitListId]
  );

  useEffect(() => {
    refetch();
  }, [refetch]);

  const createList = useCallback(async () => {
    if (!shoppingCtx) throw new Error('Not authenticated');
    const id = await createShoppingList(shoppingCtx, { items: [] });
    await refetch();
    return id;
  }, [shoppingCtx, refetch]);

  const updateItems = useCallback(
    async (lid, items) => {
      if (!shoppingCtx) return;
      await updateShoppingList(shoppingCtx, lid, items);
      await refetch();
    },
    [shoppingCtx, refetch]
  );

  const addItem = useCallback(
    async (lid, item) => {
      if (!shoppingCtx) return;
      await addItemToList(shoppingCtx, lid, item);
      await refetch();
    },
    [shoppingCtx, refetch]
  );

  const addItems = useCallback(
    async (lid, items) => {
      if (!shoppingCtx || !items?.length) return;
      await addItemsToList(shoppingCtx, lid, items);
      await refetch();
    },
    [shoppingCtx, refetch]
  );

  const toggleChecked = useCallback(
    async (lid, itemId, checked) => {
      if (!shoppingCtx) return;
      await toggleListItemChecked(shoppingCtx, lid, itemId, checked);
      await refetch();
    },
    [shoppingCtx, refetch]
  );

  const removeItem = useCallback(
    async (lid, itemId) => {
      if (!shoppingCtx || !lid || itemId == null) return;
      await removeListItem(shoppingCtx, lid, itemId);
      await refetch();
    },
    [shoppingCtx, refetch]
  );

  const completeList = useCallback(
    async (lid, completedTotalEur) => {
      if (!shoppingCtx || !lid) return;
      await setListStatus(shoppingCtx, lid, 'completed', {
        completedTotalEur:
          typeof completedTotalEur === 'number' && completedTotalEur >= 0 ? completedTotalEur : undefined,
      });
      await refetch();
    },
    [shoppingCtx, refetch]
  );

  const fetchCompletedLists = useCallback(
    async (maxItems = 20, fromServer = false) => {
      if (!shoppingCtx) return [];
      return getCompletedLists(shoppingCtx, maxItems, fromServer);
    },
    [shoppingCtx]
  );

  return {
    lists,
    activeList,
    shoppingCtx,
    fetchCompletedLists,
    loading,
    refetch,
    createList,
    updateItems,
    addItem,
    addItems,
    toggleChecked,
    removeItem,
    completeList,
  };
}

export default useShoppingList;
