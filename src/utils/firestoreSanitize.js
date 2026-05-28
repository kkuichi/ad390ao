// Firestore neakceptuje undefined – updateDoc/setDoc zlyhá.

export function sanitizeForFirestore(value) {
  if (value === undefined) return null;
  if (value === null) return null;
  if (Array.isArray(value)) return value.map(sanitizeForFirestore);
  if (typeof value === 'object' && value !== null) {
    if (value.constructor && value.constructor.name !== 'Object') {
      return value;
    }
    if (typeof value.isEqual === 'function' || typeof value.toDate === 'function') {
      return value;
    }
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      const s = sanitizeForFirestore(v);
      if (s !== undefined) out[k] = s;
    }
    return out;
  }
  return value;
}

export default sanitizeForFirestore;
