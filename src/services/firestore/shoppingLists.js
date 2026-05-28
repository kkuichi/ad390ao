// Firestore operácie nad osobnými a zdieľanými nákupnými zoznamami.
import {
  collection,
  doc,
  getDocs,
  getDocsFromServer,
  getDoc,
  getDocFromServer,
  addDoc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
  query,
  where,
  orderBy,
  limit,
} from 'firebase/firestore';
import { db } from '../../firebase';
import { sanitizeForFirestore } from '../../utils/firestoreSanitize';
import { mergeShoppingItems } from '../../utils/mergeShoppingItems';



export function buildUserShoppingContext(uid) {
  return uid ? { type: 'user', uid } : null;
}

export function buildHouseholdShoppingContext(householdId) {
  return householdId ? { type: 'household', householdId } : null;
}

export function buildShoppingContext(uid, householdId) {
  if (householdId) return buildHouseholdShoppingContext(householdId);
  return buildUserShoppingContext(uid);
}

function listsRef(ctx) {
  if (!ctx?.type) throw new Error('shopping context required');
  if (ctx.type === 'household') {
    return collection(db, 'households', ctx.householdId, 'lists');
  }
  return collection(db, 'shoppingLists', ctx.uid, 'lists');
}

function listRef(ctx, listId) {
  if (!ctx?.type) throw new Error('shopping context required');
  if (ctx.type === 'household') {
    return doc(db, 'households', ctx.householdId, 'lists', listId);
  }
  return doc(db, 'shoppingLists', ctx.uid, 'lists', listId);
}

// @typedef {{ id?: string, name: string, qty?: number, unit?: string, checked?: boolean }} ShoppingItem
// @typedef {{ id: string, items: ShoppingItem[], updatedAt?: any }} ShoppingList


// @param {ShoppingListContext} ctx
// @param {boolean} [fromServer=false]

export async function getShoppingLists(ctx, fromServer = false) {
  if (!ctx?.type) return [];
  const ref = listsRef(ctx);
  const snap = fromServer ? await getDocsFromServer(ref) : await getDocs(ref);
  return snap.docs.map((d) => ({ id: d.id, items: d.data().items ?? [], ...d.data() }));
}

// @param {ShoppingListContext} ctx
// @param {boolean} [fromServer=false]

export async function getShoppingList(ctx, listId, fromServer = false) {
  if (!ctx?.type || !listId) return null;
  const ref = listRef(ctx, listId);
  const snap = fromServer ? await getDocFromServer(ref) : await getDoc(ref);
  return snap.exists() ? { id: snap.id, items: snap.data().items ?? [], ...snap.data() } : null;
}

// @param {ShoppingListContext} ctx
// @returns {Promise<string>} listId

export async function createShoppingList(ctx, data = {}) {
  if (!ctx?.type) throw new Error('shopping context required');
  const payload = {
    items: sanitizeForFirestore(data.items ?? []),
    status: 'active',
    updatedAt: serverTimestamp(),
  };
  const ref = await addDoc(listsRef(ctx), payload);
  return ref.id;
}

// @param {ShoppingListContext} ctx

export async function updateShoppingList(ctx, listId, items) {
  if (!ctx?.type || !listId) return;
  await updateDoc(listRef(ctx, listId), {
    items: sanitizeForFirestore(items ?? []),
    updatedAt: serverTimestamp(),
  });
}

// Pridá položku do zoznamu

export async function addItemToList(ctx, listId, item) {
  const list = await getShoppingList(ctx, listId);
  if (!list) return;
  const newItem = sanitizeForFirestore({
    id: item.id || `${Date.now()}`,
    name: item.name ?? '',
    qty: item.qty ?? null,
    unit: item.unit ?? 'ks',
    checked: item.checked ?? false,
  });
  const items = [...(list.items || []).map(sanitizeForFirestore), newItem];
  await updateShoppingList(ctx, listId, items);
}

// Pridá viac položiek naraz (jedno volanie, jeden zápis).

export async function addItemsToList(ctx, listId, newItems) {
  const list = await getShoppingList(ctx, listId);
  if (!list) return;
  const existing = list.items || [];
  const toAdd = (newItems || []).map((item, i) => ({
    id: item.id || `i-${Date.now()}-${i}`,
    name: item.name ?? '',
    qty: item.qty ?? null,
    unit: item.unit ?? 'ks',
    checked: item.checked ?? false,
  }));
  const merged = mergeShoppingItems([...existing, ...toAdd]).map(sanitizeForFirestore);
  await updateShoppingList(ctx, listId, merged);
}

export async function removeListItem(ctx, listId, itemId) {
  const list = await getShoppingList(ctx, listId);
  if (!list) return;
  const raw = list.items || [];
  let next;
  if (String(itemId).startsWith('i-')) {
    const parsedIdx = parseInt(String(itemId).slice(2), 10);
    if (!Number.isNaN(parsedIdx) && parsedIdx >= 0 && parsedIdx < raw.length) {
      next = raw.filter((_, idx) => idx !== parsedIdx);
    } else {
      next = raw.filter((i) => i.id !== itemId);
    }
  } else {
    next = raw.filter((i) => i.id !== itemId);
  }
  await updateShoppingList(ctx, listId, next);
}

export async function toggleListItemChecked(ctx, listId, itemId, checked) {
  const list = await getShoppingList(ctx, listId);
  if (!list) return;
  const raw = list.items || [];
  let items;
  if (String(itemId).startsWith('i-')) {
    const parsedIdx = parseInt(itemId.slice(2), 10);
    if (!isNaN(parsedIdx) && parsedIdx >= 0 && parsedIdx < raw.length) {
      items = raw.map((item, idx) => (idx === parsedIdx ? { ...item, checked, id: item.id || itemId } : item));
    } else {
      items = raw.map((i) => (i.id === itemId || (i.id == null && i.name === itemId) ? { ...i, checked } : i));
    }
  } else {
    items = raw.map((i) => (i.id === itemId || (i.id == null && i.name === itemId) ? { ...i, checked } : i));
  }
  const sanitized = sanitizeForFirestore(items);
  await updateShoppingList(ctx, listId, sanitized);
}

export async function deleteShoppingList(ctx, listId) {
  if (!ctx?.type || !listId) return;
  await deleteDoc(listRef(ctx, listId));
}

// Záznam o čiastočnom nákupe (história v rámci daného kontextu).
// @param {ShoppingListContext} ctx

export async function addCompletedPurchaseSnapshot(ctx, data) {
  if (!ctx?.type) throw new Error('shopping context required');
  const items = (data.items || []).map((item, i) =>
    sanitizeForFirestore({
      id: item.id || `snap-${Date.now()}-${i}`,
      name: item.name ?? '',
      qty: item.qty ?? null,
      unit: item.unit ?? 'ks',
      checked: true,
    })
  );
  const ref = await addDoc(listsRef(ctx), {
    items,
    status: 'completed',
    completedTotalEur:
      typeof data.completedTotalEur === 'number' && data.completedTotalEur >= 0
        ? data.completedTotalEur
        : 0,
    purchaseNote: data.label || 'Časť nákupu',
    updatedAt: serverTimestamp(),
    completedAt: serverTimestamp(),
  });
  return ref.id;
}

export async function setListStatus(ctx, listId, status, opts = {}) {
  if (!ctx?.type || !listId || !status) return;
  const data = { status };
  if (status === 'completed') {
    if (typeof opts.completedTotalEur === 'number' && opts.completedTotalEur >= 0) {
      data.completedTotalEur = opts.completedTotalEur;
    }
  }
  const sanitized = sanitizeForFirestore(data);
  sanitized.updatedAt = serverTimestamp();
  if (status === 'completed') {
    sanitized.completedAt = serverTimestamp();
  }
  await updateDoc(listRef(ctx, listId), sanitized);
}

// Dokončené nákupy v danom kontexte (osobné alebo domácnosť).
// @param {ShoppingListContext} ctx

export async function getCompletedLists(ctx, maxItems = 20, fromServer = false) {
  if (!ctx?.type) return [];
  const ref = listsRef(ctx);
  const q = query(
    ref,
    where('status', '==', 'completed'),
    orderBy('completedAt', 'desc'),
    limit(maxItems)
  );
  const snap = fromServer ? await getDocsFromServer(q) : await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}
