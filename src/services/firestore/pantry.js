// Firestore operácie nad špajzou používateľa.
import {
  collection,
  doc,
  getDocs,
  getDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  writeBatch,
  serverTimestamp,
} from 'firebase/firestore';
import { db } from '../../firebase';



export function buildUserPantryContext(uid) {
  return uid ? { type: 'user', uid } : null;
}

export function buildHouseholdPantryContext(householdId) {
  return householdId ? { type: 'household', householdId } : null;
}

// @param {string | undefined} uid @param {string | null | undefined} householdId

export function buildPantryContext(uid, householdId) {
  if (householdId) return buildHouseholdPantryContext(householdId);
  return buildUserPantryContext(uid);
}

function itemsRef(ctx) {
  if (!ctx?.type) throw new Error('pantry context required');
  if (ctx.type === 'household') {
    return collection(db, 'households', ctx.householdId, 'pantryItems');
  }
  return collection(db, 'pantry', ctx.uid, 'items');
}

function itemRef(ctx, itemId) {
  if (!ctx?.type) throw new Error('pantry context required');
  if (ctx.type === 'household') {
    return doc(db, 'households', ctx.householdId, 'pantryItems', itemId);
  }
  return doc(db, 'pantry', ctx.uid, 'items', itemId);
}

function normalizePantryName(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');
}

function canonicalUnit(unit) {
  const u = String(unit || 'ks').trim().toLowerCase();
  if (u === 'kg' || u === 'g') return 'g';
  if (u === 'l' || u === 'ml') return 'ml';
  return 'ks';
}

function toCanonicalQty(qty, unit) {
  const n = Number(qty) || 0;
  const u = String(unit || 'ks').trim().toLowerCase();
  if (u === 'kg') return n * 1000;
  if (u === 'l') return n * 1000;
  return n;
}

// @typedef {{ id: string, name: string, qty: number, unit: string }} PantryItem


// @param {PantryContext | null} ctx
// @returns {Promise<PantryItem[]>}

export async function getPantryItems(ctx) {
  if (!ctx) return [];
  const snap = await getDocs(itemsRef(ctx));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

// @param {PantryContext | null} ctx

export async function getPantryItem(ctx, itemId) {
  if (!ctx || !itemId) return null;
  const snap = await getDoc(itemRef(ctx, itemId));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}


export async function addPantryItem(ctx, data) {
  if (!ctx) throw new Error('pantry context required');
  const name = (data.name || '').trim();
  const qty = Number(data.qty) || 1;
  const unit = data.unit || 'ks';
  const expiresAt = data.expiresAt ?? null;
  const keyName = normalizePantryName(name);
  const keyUnit = canonicalUnit(unit);
  const qtyCanonical = toCanonicalQty(qty, unit);

  const snap = await getDocs(itemsRef(ctx));
  const existing = snap.docs.find((d) => {
    const v = d.data() || {};
    return normalizePantryName(v.name) === keyName
      && canonicalUnit(v.unit) === keyUnit;
  });

  if (existing) {
    const v = existing.data() || {};
    const prevCanonicalQty = toCanonicalQty(v.qty, v.unit);
    const nextQty = prevCanonicalQty + qtyCanonical;
    const prevExp = typeof v.expiresAt === 'string' ? v.expiresAt : null;
    const nextExp = (() => {
      if (!prevExp) return expiresAt;
      if (!expiresAt) return prevExp;
      return new Date(prevExp).getTime() <= new Date(expiresAt).getTime() ? prevExp : expiresAt;
    })();

    await updateDoc(itemRef(ctx, existing.id), {
      qty: nextQty,
      unit: keyUnit,
      expiresAt: nextExp ?? null,
      updatedAt: serverTimestamp(),
    });
    return existing.id;
  }

  const ref = await addDoc(itemsRef(ctx), {
    name,
    qty: qtyCanonical,
    unit: keyUnit,
    expiresAt,
    updatedAt: serverTimestamp(),
  });
  return ref.id;
}

// @param {PantryContext} ctx

export async function updatePantryItem(ctx, itemId, data) {
  if (!ctx || !itemId) return;
  const ref = itemRef(ctx, itemId);
  await updateDoc(ref, { ...data, updatedAt: serverTimestamp() });
}

// @param {PantryContext} ctx

export async function deletePantryItem(ctx, itemId) {
  if (!ctx || !itemId) return;
  await deleteDoc(itemRef(ctx, itemId));
}

// @param {PantryContext} ctx
// @returns {Promise<boolean>}

export async function mergeDuplicatePantryItems(ctx) {
  if (!ctx) return false;
  const snap = await getDocs(itemsRef(ctx));
  const docs = snap.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));
  const groups = new Map();

  docs.forEach((it) => {
    const name = normalizePantryName(it.name);
    const unit = canonicalUnit(it.unit);
    const key = `${name}|${unit}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(it);
  });

  let changed = false;
  for (const [, list] of groups) {
    if (list.length <= 1) continue;
    const [base, ...rest] = list;
    const mergedQty = list.reduce((acc, it) => acc + toCanonicalQty(it.qty, it.unit), 0);
    const earliestExpiry = list
      .map((it) => (typeof it.expiresAt === 'string' ? it.expiresAt : null))
      .filter(Boolean)
      .sort((a, b) => new Date(a).getTime() - new Date(b).getTime())[0] || null;

    await updateDoc(itemRef(ctx, base.id), {
      qty: mergedQty,
      unit: canonicalUnit(base.unit),
      expiresAt: earliestExpiry,
      updatedAt: serverTimestamp(),
    });
    for (const dup of rest) {
      await deleteDoc(itemRef(ctx, dup.id));
    }
    changed = true;
  }

  return changed;
}

// @param {PantryContext} ctx
// @param {Array<{name: string, qty?: number, unit?: string, expiresAt?: string | null}>} items

export async function addPantryItems(ctx, items) {
  if (!ctx || !Array.isArray(items) || items.length === 0) return;
  const incoming = items
    .map((it) => ({
      name: String(it?.name || '').trim(),
      qty: Number(it?.qty) || 0,
      unit: it?.unit || 'ks',
      expiresAt: it?.expiresAt ?? null,
    }))
    .filter((it) => it.name && it.qty > 0);
  if (incoming.length === 0) return;

  const snap = await getDocs(itemsRef(ctx));
  const existingByKey = new Map();
  snap.docs.forEach((d) => {
    const v = d.data() || {};
    const key = `${normalizePantryName(v.name)}|${canonicalUnit(v.unit)}`;
    existingByKey.set(key, {
      id: d.id,
      qty: toCanonicalQty(v.qty, v.unit),
      unit: canonicalUnit(v.unit),
      expiresAt: typeof v.expiresAt === 'string' ? v.expiresAt : null,
    });
  });

  const batch = writeBatch(db);
  const aggregated = new Map();
  incoming.forEach((it) => {
    const key = `${normalizePantryName(it.name)}|${canonicalUnit(it.unit)}`;
    const prev = aggregated.get(key) || {
      name: it.name,
      qty: 0,
      unit: canonicalUnit(it.unit),
      expiresAt: null,
    };
    prev.qty += toCanonicalQty(it.qty, it.unit);
    if (!prev.expiresAt) prev.expiresAt = typeof it.expiresAt === 'string' ? it.expiresAt : null;
    else if (typeof it.expiresAt === 'string') {
      prev.expiresAt =
        new Date(it.expiresAt).getTime() < new Date(prev.expiresAt).getTime() ? it.expiresAt : prev.expiresAt;
    }
    aggregated.set(key, prev);
  });

  aggregated.forEach((entry, key) => {
    const existing = existingByKey.get(key);
    if (existing) {
      const nextExp = (() => {
        if (!existing.expiresAt) return entry.expiresAt;
        if (!entry.expiresAt) return existing.expiresAt;
        return new Date(existing.expiresAt).getTime() <= new Date(entry.expiresAt).getTime()
          ? existing.expiresAt
          : entry.expiresAt;
      })();
      batch.update(itemRef(ctx, existing.id), {
        qty: (existing.qty || 0) + (entry.qty || 0),
        unit: existing.unit || entry.unit || 'ks',
        expiresAt: nextExp ?? null,
        updatedAt: serverTimestamp(),
      });
    } else {
      const ref = doc(itemsRef(ctx));
      batch.set(ref, {
        name: entry.name,
        qty: entry.qty,
        unit: entry.unit,
        expiresAt: entry.expiresAt ?? null,
        updatedAt: serverTimestamp(),
      });
    }
  });

  await batch.commit();
}

// Testovacia špajza – len osobná.

const TEST_PANTRY_ITEMS = [
  { name: 'Ryža', qty: 500, unit: 'g' },
  { name: 'Cestoviny', qty: 400, unit: 'g' },
  { name: 'Olivový olej', qty: 500, unit: 'ml' },
  { name: 'Šošovica / cícer', qty: 400, unit: 'g' },
  { name: 'Paradajky', qty: 500, unit: 'g' },
  { name: 'Mlieko', qty: 1, unit: 'l' },
  { name: 'Vajce', qty: 10, unit: 'ks' },
  { name: 'Cibuľa', qty: 1, unit: 'ks' },
  { name: 'Cesnak', qty: 2, unit: 'ks' },
  { name: 'Hrášok mrazený', qty: 400, unit: 'g' },
];

// @param {PantryContext} ctx – iba type user

export async function seedTestPantry(ctx) {
  if (!ctx || ctx.type !== 'user') return;
  for (const item of TEST_PANTRY_ITEMS) {
    await addPantryItem(ctx, item);
  }
}
