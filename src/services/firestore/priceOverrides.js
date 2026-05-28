// Ručné ceny používateľa – neprepisujú globálny katalóg `prices`,


import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore';
import { db } from '../../firebase';

const CACHE = new Map();
const TTL_MS = 2 * 60 * 1000;



export function invalidateUserPriceOverridesCache(uid) {
  if (uid) CACHE.delete(uid);
}


export async function getUserPriceOverridesMap(uid, opts = {}) {
  if (!uid) return {};
  if (!opts.forceRefresh) {
    const hit = CACHE.get(uid);
    if (hit && Date.now() - hit.ts < TTL_MS) return hit.map;
  }
  const snap = await getDocs(collection(db, 'profiles', uid, 'priceOverrides'));
  const map = {};
  snap.forEach((d) => {
    map[d.id] = d.data();
  });
  CACHE.set(uid, { map, ts: Date.now() });
  return map;
}


export async function setUserPriceOverride(uid, priceDocId, priceEur, meta = {}) {
  if (!uid || !priceDocId) return;
  const n = Number(priceEur);
  if (!Number.isFinite(n) || n <= 0) return;
  const ref = doc(db, 'profiles', uid, 'priceOverrides', priceDocId);
  const payload = {
    priceEur: Math.round(n * 10000) / 10000,
    updatedAt: serverTimestamp(),
  };
  if (meta.displayName && String(meta.displayName).trim()) {
    payload.displayName = String(meta.displayName).trim();
  }
  if (meta.unit && String(meta.unit).trim()) {
    payload.unit = String(meta.unit).trim().toLowerCase();
  }
  if (meta.isCustom === true) {
    payload.isCustom = true;
  }
  if (meta.isCustom === false) {
    payload.isCustom = false;
  }
  await setDoc(ref, payload, { merge: true });
  invalidateUserPriceOverridesCache(uid);
}

// @param {string} uid
// @param {string} priceDocId

export async function deleteUserPriceOverride(uid, priceDocId) {
  if (!uid || !priceDocId) return;
  await deleteDoc(doc(db, 'profiles', uid, 'priceOverrides', priceDocId));
  invalidateUserPriceOverridesCache(uid);
}
