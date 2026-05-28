// cheaper_alternatives/{sourceDocId} — voliteľná cache lacnejších náhrad

import { doc, getDoc } from 'firebase/firestore';
import { db } from '../../firebase';

const COLLECTION = 'cheaper_alternatives';
const TTL_MS = 6 * 60 * 60 * 1000; // 6 hodín

const _cache = new Map();

export async function getCheaperAlternativesDoc(sourceDocId) {
  if (!sourceDocId || typeof sourceDocId !== 'string') return null;

  const now = Date.now();
  const cached = _cache.get(sourceDocId);
  if (cached && now - cached.ts < TTL_MS) return cached.value;

  try {
    const snap = await getDoc(doc(db, COLLECTION, sourceDocId));
    const value = snap.exists() ? snap.data() : null;
    _cache.set(sourceDocId, { ts: now, value });
    return value;
  } catch (err) {
    if (typeof __DEV__ !== 'undefined' && __DEV__ && console?.warn) {
      console.warn('[cheaperAlternatives.getDoc] failed', sourceDocId, err);
    }
    return null;
  }
}

export function clearCheaperAlternativesCache() {
  _cache.clear();
}
